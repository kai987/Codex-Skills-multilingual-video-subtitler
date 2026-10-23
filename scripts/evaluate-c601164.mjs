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
import {
  read,
  write,
  hashFile,
  objectHash,
  checkFiles,
  variants,
  verifyPlan,
} from "./c601164-common.mjs";
const [output, gold] = process.argv.slice(2),
  freeze = read(path.join(output, "generation-freeze.json"));
const verify = () => {
  verifyPlan(output);
  checkFiles(output, freeze.metadata);
  for (const [r, h] of Object.entries(freeze.manifests)) {
    if (hashFile(path.join(output, r, "experiment-manifest.json")) !== h)
      throw Error("Manifest changed");
    for (const f of freeze.runs[r])
      if (hashFile(path.join(output, r, f.path)) !== f.sha256)
        throw Error("Payload changed");
  }
};
verify();
const plan = read(path.join(output, "alignment-plan.json"));
if (objectHash(plan.evaluationPolicy) !== objectHash(QUALITY_EVALUATION_POLICY))
  throw Error("Metric policy changed");
const dest = path.join(output, "evaluation");
fs.mkdirSync(dest);
const readAt = new Date().toISOString();
if (Date.parse(readAt) < Date.parse(freeze.frozenAt))
  throw Error("Gold freeze ordering invalid");
write(dest, "first-reference-read.json", {
  readAt,
  machineFreezeHash: hashFile(path.join(output, "generation-freeze.json")),
  previousDeveloperExposure: true,
  unseenBlindTest: false,
});
const goldHash = hashFile(gold),
  reference = parseAss(
    normalizeC601GoldAssTimestamps(fs.readFileSync(gold, "utf8")).content,
  ).map((c, i) => ({ ...c, id: `reference-${i}` }));
const metrics = {},
  cues = {};
for (const v of variants) {
  const dir = path.join(output, "run-a", v),
    pkg = read(path.join(dir, "subtitle-package.needs-review.json")),
    formats = {};
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
const groups = read(path.join(output, "source-groups.json")),
  native = read(path.join(output, "patches/native.json")),
  aligned = read(path.join(output, "patches/aligned.json"));
const overlap = (c, w) => c.end > w.start && c.start < w.end,
  contained = (c, w) => c.start >= w.start && c.end <= w.end;
const baseline = metrics["T0-baseline"],
  main = metrics["T2-aligned-group"];
const sameSupport = baseline.matches
  .filter((g) => g.timingEligible)
  .flatMap((g) => {
    const h = main.matches.find(
      (h) =>
        h.timingEligible &&
        objectHash(h.referenceIds) === objectHash(g.referenceIds) &&
        objectHash(h.hypothesisIds) === objectHash(g.hypothesisIds),
    );
    return h
      ? [
          {
            referenceIds: g.referenceIds,
            hypothesisIds: g.hypothesisIds,
            startErrorDelta: h.startError - g.startError,
            endErrorDelta: h.endError - g.endError,
          },
        ]
      : [];
  });
const local = groups.map((g) => {
  const rs = reference.filter((c) => overlap(c, g.readEnvelope)),
    refCross = rs.some((c) => !contained(c, g.readEnvelope));
  const hs = Object.fromEntries(
    variants.map((v) => [v, cues[v].filter((c) => overlap(c, g.readEnvelope))]),
  );
  const crossing = Object.values(hs).some((cs) =>
    cs.some((c) => !contained(c, g.readEnvelope)),
  );
  const fixedPairs = [];
  // Fixed reference-content support, independent of new cue IDs or regrouping.
  // No character-proportional cuts: pair only complete groups with equal text
  // and exactly the same reference identities across controls.
  for (const b of baseline.matches.filter(
    (m) =>
      m.timingEligible &&
      m.referenceIds.some((id) => rs.some((r) => r.id === id)),
  )) {
    const h = main.matches.find(
      (h) =>
        h.timingEligible &&
        objectHash(h.referenceIds) === objectHash(b.referenceIds),
    );
    const bt = cues["T0-baseline"].filter((c) =>
        b.hypothesisIds.includes(c.id),
      ),
      at = h
        ? cues["T2-aligned-group"].filter((c) => h.hypothesisIds.includes(c.id))
        : [];
    const comparable =
      !!h &&
      qualityText(bt.map((c) => c.text).join("")) ===
        qualityText(at.map((c) => c.text).join(""));
    fixedPairs.push({
      referenceIds: b.referenceIds,
      beforeIds: b.hypothesisIds,
      afterIds: h?.hypothesisIds ?? [],
      status: comparable
        ? "SAME_CONTENT_FIXED_REFERENCE_SUPPORT"
        : "TIMING_EFFECT_NOT_COMPARABLE_TEXT_OR_MATCH_SET_CHANGED",
      startErrorDelta: comparable ? h.startError - b.startError : null,
      endErrorDelta: comparable ? h.endError - b.endError : null,
    });
  }
  return {
    groupId: g.id,
    seed: g.seed,
    frozenResearchWindow: g.readEnvelope,
    referenceStatus: refCross
      ? "REFERENCE_BOUNDARY_AMBIGUITY"
      : "COMPLETE_REFERENCE_CUES",
    generatedBoundaryAmbiguity: crossing,
    referenceIds: rs.map((r) => r.id),
    reference: rs,
    hypotheses: hs,
    exactLocalMetrics:
      refCross || crossing
        ? null
        : Object.fromEntries(
            variants.map((v) => [v, evaluateQuality(hs[v], rs)]),
          ),
    fullIntersectingCueDiagnostic: Object.fromEntries(
      variants.map((v) => [v, evaluateQuality(hs[v], rs)]),
    ),
    diagnosticNotAdditive: true,
    fixedReferenceContentPairs: fixedPairs,
    nativeDecision: native.find((p) => p.group.id === g.id),
    alignedDecision: aligned.find((p) => p.group.id === g.id),
    directListening: { performed: false, humanValidated: false },
    confirmedNeighborLoss: "NOT_ESTABLISHED_BY_DIRECT_LISTENING",
    repetitionCount: "UNKNOWN",
  };
});
const effects = groups.map((g) => {
  const n = native.find((p) => p.group.id === g.id),
    a = aligned.find((p) => p.group.id === g.id);
  return {
    groupId: g.id,
    nativeApplicable: n.action === "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP",
    alignedApplicable: a.action === "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP",
    interpretation:
      n.action === a.action
        ? "COMMON_APPLICATION_SET_COMPARE_TEXT_AND_TIMING_SEPARATELY"
        : "APPLICATION_SET_CHANGE_NOT_PURE_TIMING_GAIN",
    sourceTextSame:
      objectHash(n.newCues.map((c) => c.text)) ===
      objectHash(a.newCues.map((c) => c.text)),
  };
});
const diff = read(path.join(output, "run-a/export-diffs.json"));
const gain = main.normalized.CER < baseline.normalized.CER;
const regression = main.normalized.CER > baseline.normalized.CER;
const result = {
  policy: QUALITY_EVALUATION_POLICY,
  goldHash,
  firstReadAt: readAt,
  metrics,
  sameSupport,
  matchingSetChange: {
    before: baseline.timing.matchedGroups,
    after: main.timing.matchedGroups,
    unchangedIdentityGroups: sameSupport.length,
    removedOrRegrouped: baseline.timing.matchedGroups - sameSupport.length,
    addedOrRegrouped: main.timing.matchedGroups - sameSupport.length,
  },
  local,
  applicationSetEffects: effects,
  exportDiff: diff,
  strictNormalizedTextGain: gain,
  conclusion: regression
    ? "QUALITY_REGRESSION_HOLD"
    : gain
      ? "DEVELOPMENT_TEXT_GAIN_REVIEW_REQUIRED"
      : "ENGINEERING_PASS_NO_STRICT_TEXT_GAIN",
  status: "needs-review",
  finalizationMethod: "none",
  humanValidated: false,
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  heldoutValidation: "HELDOUT_VALIDATION_NOT_RUN",
  inheritedRawComparison:
    "R0 not rerun; historical .16.1 metrics only, no new raw quality claim",
  metricCaveats:
    "Deletion coverage is not accuracy; insertion/repetition diagnostics are not confirmed hallucinations; conditional alignability is not lexical correctness; total overlap is not erroneous overlap.",
};
write(dest, "metrics.json", result);
const csv = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
write(
  dest,
  "group-diff.csv",
  [
    "group,mode,action,oldCueCount,newCueCount,oldText,newText,oldTimes,newTimes,reasons,risks",
    ...[...native, ...aligned].map((p) =>
      [
        p.group.id,
        p.mode,
        p.action,
        p.oldCues.length,
        p.newCues.length,
        p.oldCues.map((b) => b.cue.text).join("|"),
        p.newCues.map((c) => c.text).join("|"),
        JSON.stringify(p.oldCues.map((b) => [b.cue.start, b.cue.end])),
        JSON.stringify(p.newCues.map((c) => [c.start, c.end])),
        p.reasons.join("|"),
        p.risks.join("|"),
      ]
        .map(csv)
        .join(","),
    ),
  ].join("\n") + "\n",
);
write(
  dest,
  "changes.md",
  `# Frozen four-control evaluation\n\n${result.conclusion}\n\nT0 normalized CER ${baseline.normalized.CER}; T2 ${main.normalized.CER}. Same-support unchanged-identity timing groups: ${sameSupport.length}.\n\nSee metrics.json for actual ASS/SRT/VTT S/D/I/N, fixed research envelopes, reference boundary ambiguity, fixed-reference content pairs and application-set changes. Alignment is conditional on machine text, not recognition verification. No direct listening or default promotion.\n`,
);
verify();
if (hashFile(gold) !== goldHash) throw Error("Reference mutated");
console.log(
  JSON.stringify({
    conclusion: result.conclusion,
    variants: Object.fromEntries(
      variants.map((v) => [v, metrics[v].normalized]),
    ),
    effects,
  }),
);
