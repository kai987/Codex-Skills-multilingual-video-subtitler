import fs from "node:fs";
import path from "node:path";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import { normalizeC601GoldAssTimestamps } from "../packages/video-subtitler/dist/blind-acceptance/gold-evaluation.js";
import {
  evaluateQuality,
  qualityText,
  QUALITY_EVALUATION_POLICY,
} from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
import { exportDiff } from "../packages/video-subtitler/dist/machine-quality/bounded-acoustic.js";
import {
  sha256,
  objectHash,
} from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
const [output, gold] = process.argv.slice(2);
const read = (p) => JSON.parse(fs.readFileSync(p));
const freeze = read(path.join(output, "generation-freeze.json")),
  plan = read(path.join(output, "experiment-plan.json"));
const verify = () => {
  for (const [run, files] of Object.entries(freeze.runs))
    for (const f of files) {
      const p = path.resolve(output, run, f.path);
      if (
        !p.startsWith(path.resolve(output, run) + path.sep) ||
        sha256(fs.readFileSync(p)) !== f.sha256
      )
        throw Error("Frozen generation changed");
    }
  if (
    sha256(fs.readFileSync(path.join(output, "evidence/frozen.json"))) !==
      freeze.evidenceHash ||
    sha256(fs.readFileSync(path.join(output, "experiment-plan.json"))) !==
      freeze.planHash
  )
    throw Error("Evidence/plan changed");
};
verify();
if (objectHash(plan.evaluationPolicy) !== objectHash(QUALITY_EVALUATION_POLICY))
  throw Error("Evaluation policy changed");
const dest = path.join(output, "evaluation");
fs.mkdirSync(dest);
const write = (name, v) =>
  fs.writeFileSync(
    path.join(dest, name),
    typeof v === "string" ? v : JSON.stringify(v, null, 2),
    { flag: "wx", flush: true },
  );
const readAt = new Date().toISOString();
if (Date.parse(readAt) < Date.parse(freeze.frozenAt))
  throw Error("Gold ordering error");
write("first-reference-read.json", {
  readAt,
  machineFreezeHash: sha256(
    fs.readFileSync(path.join(output, "generation-freeze.json")),
  ),
  previousDeveloperExposure: true,
  unseenBlindTest: false,
});
const goldBytes = fs.readFileSync(gold),
  goldHash = sha256(goldBytes);
const reference = parseAss(
  normalizeC601GoldAssTimestamps(goldBytes.toString()).content,
).map((c, i) => ({ ...c, id: `reference-${i}` }));
const metrics = {},
  cues = {};
for (const v of ["E0-observe-only", "E1-acoustic-decision"]) {
  const dir = path.join(output, "run-a", v),
    pkg = read(path.join(dir, "subtitle-package.needs-review.json"));
  const formats = {};
  for (const [ext, parser] of Object.entries({
    srt: parseSrt,
    ass: parseAss,
    vtt: parseVtt,
  })) {
    const cs = parser(
      fs.readFileSync(path.join(dir, `machine-candidate.${ext}`), "utf8"),
    ).map((c, i) => ({
      ...c,
      id: pkg.cues[i].id,
      style: pkg.cues[i].style ?? "default",
    }));
    formats[ext] = evaluateQuality(cs, reference);
    if (ext === "srt") cues[v] = cs;
  }
  metrics[v] = {
    ...formats.srt,
    formats,
    presentationOverflowCues: cues[v].filter(
      (c) =>
        c.text.split("\n").length > 2 ||
        c.text.split("\n").some((l) => Array.from(l).length > 16),
    ).length,
  };
}
const a = metrics["E0-observe-only"],
  b = metrics["E1-acoustic-decision"];
const sameSupport = a.matches
  .filter((g) => g.timingEligible)
  .flatMap((g) => {
    const other = b.matches.find(
      (h) =>
        h.timingEligible &&
        objectHash(h.referenceIds) === objectHash(g.referenceIds) &&
        objectHash(h.hypothesisIds) === objectHash(g.hypothesisIds),
    );
    return other
      ? [
          {
            referenceIds: g.referenceIds,
            hypothesisIds: g.hypothesisIds,
            startErrorDelta: other.startError - g.startError,
            endErrorDelta: other.endError - g.endError,
          },
        ]
      : [];
  });
const cases = read(path.join(output, "cases.machine.json")),
  decisions = read(path.join(output, "run-a/decisions.json"));
const overlaps = (c, w) => c.end > w.start && c.start < w.end;
const contained = (c, w) => c.start >= w.start && c.end <= w.end;
const local = cases.map((c) => {
  const bounds = [
    { id: "core", ...c.core },
    ...plan.requests
      .filter(
        (r) => r.caseBindingHash === c.bindingHash && r.family === "whisper",
      )
      .map((r) => ({
        id: r.windowId,
        start: r.window.start,
        end: r.window.end,
      })),
  ];
  return {
    caseId: c.id,
    machineCore: c.core,
    decision: decisions.find((d) => d.bindingHash === c.bindingHash),
    directListening: {
      performed: false,
      who: null,
      when: null,
      referenceExposure: "KNOWN_DEVELOPMENT_MATERIAL",
      status: "NOT_LISTENED",
    },
    referenceEvaluation:
      "REFERENCE_SUPPORTED_OR_CONTRADICTED_IS_NOT_AUDIO_CONFIRMED",
    windows: bounds.map((w) => {
      const rs = reference.filter((r) => overlaps(r, w)),
        boundary = rs.filter((r) => !contained(r, w));
      const hypotheses = Object.fromEntries(
        Object.entries(cues).map(([v, cs]) => [
          v,
          cs.filter((h) => overlaps(h, w)),
        ]),
      );
      const generatedBoundary = Object.values(hypotheses).some((cs) =>
        cs.some((h) => !contained(h, w)),
      );
      return {
        window: w,
        referenceIds: rs.map((r) => r.id),
        reference: rs,
        referenceStatus: boundary.length
          ? "REFERENCE_BOUNDARY_AMBIGUITY"
          : "COMPLETE_REFERENCE_CUES",
        generatedBoundaryAmbiguity: generatedBoundary,
        hypotheses,
        exactLocalMetrics:
          boundary.length || generatedBoundary
            ? null
            : Object.fromEntries(
                Object.entries(hypotheses).map(([v, hs]) => [
                  v,
                  evaluateQuality(hs, rs),
                ]),
              ),
        fullIntersectingCueDiagnostic: Object.fromEntries(
          Object.entries(hypotheses).map(([v, hs]) => [
            v,
            evaluateQuality(hs, rs),
          ]),
        ),
        diagnosticOnly: boundary.length > 0 || generatedBoundary,
        notAdditiveToWholeEpisode: true,
        stageTextInIntersectingReference: qualityText(
          rs.map((r) => r.text).join(""),
        ).includes(qualityText(c.before.text)),
      };
    }),
  };
});
const diff = exportDiff(cues["E0-observe-only"], cues["E1-acoustic-decision"]);
const changed =
  diff.exportAddedCueCount +
  diff.exportRemovedCueCount +
  diff.exportChangedGroups;
const result = {
  policy: QUALITY_EVALUATION_POLICY,
  goldHash,
  firstReadAt: readAt,
  metrics,
  sameSupport,
  exportDiff: diff,
  local,
  conclusion: changed
    ? b.normalized.CER > a.normalized.CER
      ? "QUALITY_REGRESSION_HOLD"
      : "QUALITY_TRADEOFF_HOLD"
    : "BOUNDED_VERIFICATION_COMPLETE_EVIDENCE_INCONCLUSIVE",
  inference: "machine observations, not direct acoustic truth",
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  humanValidated: false,
  status: "needs-review",
  finalizationMethod: "none",
  heldoutValidation: "HELDOUT_VALIDATION_NOT_RUN",
};
write("metrics.json", result);
const csv = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
write(
  "case-comparison.csv",
  [
    "case,action,classification,structure,coreComparability,localReferenceStatus,directListening",
    ...local.map((c) =>
      [
        c.caseId,
        c.decision.action,
        c.decision.classification,
        c.decision.utteranceStructure,
        c.decision.localized.map((o) => o.status).join(";"),
        c.windows[0].referenceStatus,
        "NOT_LISTENED",
      ]
        .map(csv)
        .join(","),
    ),
  ].join("\n") + "\n",
);
write(
  "changes.md",
  `# Frozen same-evidence E0/E1 comparison\n\n${result.conclusion}\n\nExport diff: ${JSON.stringify(diff)}. Normalized S/D/I/N: E0 ${a.normalized.S}/${a.normalized.D}/${a.normalized.I}/${a.normalized.N}; E1 ${b.normalized.S}/${b.normalized.D}/${b.normalized.I}/${b.normalized.N}.\n\nSame-support timing groups: ${sameSupport.length}. Reference-boundary ambiguity is retained. Full intersecting-cue diagnostics are not exact local CER and are not additive. No direct listening was performed. No production release.\n`,
);
verify();
if (sha256(fs.readFileSync(gold)) !== goldHash)
  throw Error("Reference changed");
console.log(
  JSON.stringify({
    conclusion: result.conclusion,
    exportDiff: diff,
    E0: a.normalized,
    E1: b.normalized,
    sameSupport: sameSupport.length,
  }),
);
