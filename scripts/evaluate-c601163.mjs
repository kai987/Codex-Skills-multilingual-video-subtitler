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
  for (const [relative, hash] of Object.entries(freeze.metadata)) {
    const p = path.resolve(output, relative);
    if (
      !p.startsWith(path.resolve(output) + path.sep) ||
      sha256(fs.readFileSync(p)) !== hash
    )
      throw Error("Frozen metadata changed");
  }
  for (const [run, hash] of Object.entries(freeze.manifests)) {
    if (
      sha256(
        fs.readFileSync(path.join(output, run, "experiment-manifest.json")),
      ) !== hash
    )
      throw Error("Frozen clock manifest changed");
  }
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
    sha256(fs.readFileSync(path.join(output, "token-span-evidence.json"))) !==
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
for (const v of ["S0-legacy-policy", "S1-token-observe", "S2-token-apply"]) {
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
  for (const name of ["exact", "normalized"]) {
    const m = metrics[v][name];
    m.editDistance = m.S + m.D + m.I;
  }
}
const a = metrics["S1-token-observe"],
  b = metrics["S2-token-apply"];
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
const diff = exportDiff(cues["S1-token-observe"], cues["S2-token-apply"]);
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
  matchingSetChange: {
    before: a.timing.matchedGroups,
    after: b.timing.matchedGroups,
    unchangedIdentityGroups: sameSupport.length,
    removedOrRegrouped: a.timing.matchedGroups - sameSupport.length,
    addedOrRegrouped: b.timing.matchedGroups - sameSupport.length,
  },
  exportDiff: diff,
  local,
  conclusion: changed
    ? b.normalized.CER > a.normalized.CER
      ? "QUALITY_REGRESSION_HOLD"
      : "QUALITY_TRADEOFF_HOLD"
    : "ENGINEERING_PASS_NO_QUALITY_GAIN",
  inference: "machine observations, not direct acoustic truth",
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  humanValidated: false,
  status: "needs-review",
  finalizationMethod: "none",
  heldoutValidation: "HELDOUT_VALIDATION_NOT_RUN",
  sourcePreservation: decisions.map((d) => ({
    caseId: d.caseId,
    action: d.action,
    sourceTextPreserved: d.before.text === d.after.text,
    stageStartUnchanged: d.before.start === d.after.start,
    stageEndUnchanged: d.before.end === d.after.end,
    lexicalTruthValidated: false,
    repeatedSpeechCount: "UNKNOWN",
  })),
  inheritedRawComparison:
    "R0 not rerun in this experiment; no new raw quality claim",
  metricCaveats:
    "Non-deletion coverage is not character accuracy; insertions are not confirmed hallucinations; total overlaps are not confirmed erroneous overlaps.",
};
write("metrics.json", result);
const csv = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
write(
  "case-comparison.csv",
  [
    "case,action,capability,selectedSource,coreComparability,localReferenceStatus,directListening",
    ...local.map((c) =>
      [
        c.caseId,
        c.decision.action,
        c.decision.capability.status,
        c.decision.chosenSpanId,
        c.decision.candidates.map((o) => o.reasons.join("|")).join(";"),
        c.windows[0].referenceStatus,
        "NOT_LISTENED",
      ]
        .map(csv)
        .join(","),
    ),
  ].join("\n") + "\n",
);
write(
  "cue-diff.csv",
  [
    "cueId,operation,beforeText,afterText,beforeStart,beforeEnd,afterStart,afterEnd",
    ...[
      ...new Set(
        [...cues["S1-token-observe"], ...cues["S2-token-apply"]].map(
          (c) => c.id,
        ),
      ),
    ].map((id) => {
      const before = cues["S1-token-observe"].find((c) => c.id === id),
        after = cues["S2-token-apply"].find((c) => c.id === id);
      return [
        id,
        !before
          ? "ADD"
          : !after
            ? "DELETE"
            : objectHash(before) === objectHash(after)
              ? "KEEP"
              : "CHANGE",
        before?.text,
        after?.text,
        before?.start,
        before?.end,
        after?.start,
        after?.end,
      ]
        .map(csv)
        .join(",");
    }),
  ].join("\n") + "\n",
);
write(
  "changes.md",
  `# Frozen same-evidence S0/S1/S2 comparison\n\n${result.conclusion}\n\nExport diff S1/S2: ${JSON.stringify(diff)}. Normalized S/D/I/N: S1 ${a.normalized.S}/${a.normalized.D}/${a.normalized.I}/${a.normalized.N}; S2 ${b.normalized.S}/${b.normalized.D}/${b.normalized.I}/${b.normalized.N}.\n\nSame-support timing groups: ${sameSupport.length}. Reference-boundary ambiguity is retained. Full intersecting-cue diagnostics are not exact local CER and are not additive. No direct listening was performed. No production release.\n`,
);
verify();
if (sha256(fs.readFileSync(gold)) !== goldHash)
  throw Error("Reference changed");
console.log(
  JSON.stringify({
    conclusion: result.conclusion,
    exportDiff: diff,
    S1: a.normalized,
    S2: b.normalized,
    sameSupport: sameSupport.length,
  }),
);
