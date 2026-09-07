import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import { normalizeC601GoldAssTimestamps } from "../packages/video-subtitler/dist/blind-acceptance/gold-evaluation.js";
import {
  evaluateQuality,
  QUALITY_EVALUATION_POLICY,
} from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
const [runArg, goldArg, destArg] = process.argv.slice(2);
if (!runArg || !goldArg || !destArg)
  throw new Error(
    "Usage: evaluate-c60116-experiment.mjs frozen-run development-reference.ass new-evaluation-dir",
  );
const run = path.resolve(runArg),
  dest = path.resolve(destArg),
  gold = path.resolve(goldArg);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const read = (p) => JSON.parse(fs.readFileSync(p));
const manifest = read(path.join(run, "experiment-manifest.json"));
const verify = () => {
  for (const f of manifest.files) {
    const p = path.resolve(run, f.path);
    if (!p.startsWith(run + path.sep) || hash(fs.readFileSync(p)) !== f.sha256)
      throw new Error("Output freeze mismatch: " + f.path);
  }
};
verify();
fs.mkdirSync(dest);
// Policy is committed/written before the reference is opened or scores calculated.
fs.writeFileSync(
  path.join(dest, "evaluation-policy.json"),
  JSON.stringify(QUALITY_EVALUATION_POLICY, null, 2),
  { flag: "wx" },
);
const firstReadAt = new Date().toISOString();
if (Date.parse(firstReadAt) < Date.parse(manifest.freezeCompletedAt))
  throw new Error("Invalid freeze ordering");
const goldBytes = fs.readFileSync(gold),
  goldHash = hash(goldBytes);
const normalized = normalizeC601GoldAssTimestamps(goldBytes.toString());
const reference = parseAss(normalized.content).map((c, i) => ({
  ...c,
  id: "reference-" + i,
}));
const lines = normalized.content.split(/\r?\n/);
let fields = [];
const styleByLine = new Map();
for (const [i, line] of lines.entries()) {
  if (line.startsWith("Format:") && line.includes("Text"))
    fields = line
      .slice(7)
      .split(",")
      .map((x) => x.trim());
  if (line.startsWith("Dialogue:"))
    styleByLine.set(
      i + 1,
      line.slice(9).split(",")[fields.indexOf("Style")]?.trim(),
    );
}
const strata = {};
for (const c of reference) {
  const style = styleByLine.get(c.sourceLine) ?? "unknown";
  const kind =
    style === "Music"
      ? "lyrics-op"
      : style === "Thought"
        ? "thought-narration-unverified"
        : style === "Default"
          ? "dialogue-narration-unseparated"
          : "other-unknown";
  (strata[kind] ??= []).push(c.id);
}
const metrics = {},
  allCues = {};
for (const variant of manifest.variants) {
  const folder = path.join(run, variant.variant),
    pkg = read(path.join(folder, "subtitle-package.needs-review.json"));
  const byFormat = {};
  for (const [ext, parser] of Object.entries({
    srt: parseSrt,
    ass: parseAss,
    vtt: parseVtt,
  })) {
    const cues = parser(
      fs.readFileSync(path.join(folder, "machine-candidate." + ext), "utf8"),
    ).map((c, i) => ({ ...c, id: pkg.cues[i].id }));
    byFormat[ext] = evaluateQuality(cues, reference);
    if (ext === "srt") allCues[variant.variant] = cues;
  }
  const main = byFormat.srt;
  const scoped = {};
  // Stratum metrics share the all-reference alignment, not a newly chosen denominator.
  for (const [name, ids] of Object.entries(strata)) {
    const rs = reference.filter((c) => ids.includes(c.id));
    const hs = new Set(
      main.matches
        .filter((g) => g.referenceIds.some((id) => ids.includes(id)))
        .flatMap((g) => g.hypothesisIds),
    );
    const cross = main.matches.filter(
      (g) =>
        g.referenceIds.some((id) => ids.includes(id)) &&
        g.referenceIds.some((id) => !ids.includes(id)),
    ).length;
    scoped[name] = {
      ...evaluateQuality(
        allCues[variant.variant].filter((c) => hs.has(c.id)),
        rs,
      ),
      crossStratumGroups: cross,
      assignment:
        "all-reference text alignment; boundary-spanning groups explicitly flagged",
    };
  }
  metrics[variant.variant] = {
    ...main,
    strata: scoped,
    formatParity: {
      textMetricsEqual: ["ass", "vtt"].every(
        (ext) =>
          JSON.stringify(byFormat[ext].normalized) ===
          JSON.stringify(main.normalized),
      ),
      assTiming: byFormat.ass.timing,
      vttTiming: byFormat.vtt.timing,
    },
  };
}
const b0 = metrics["baselines/B0-primary-minimal"],
  b1 = metrics["baselines/B1-current-stable"],
  b2 = metrics["candidate/B2-recovered"];
const journal = read(
  path.join(run, "candidate/B2-recovered/mutation-journal.json"),
);
const changes = journal.filter((j) => j.applied);
const paired = changes.map((j) => ({
  old: j.input.map((c) => ({
    id: c.id,
    text: c.text,
    start: c.start,
    end: c.end,
  })),
  new: j.output.map((c) => ({
    id: c.id,
    text: c.text,
    start: c.start,
    end: c.end,
  })),
  reason: j.reason,
  sourceIds: j.sourceIds,
  referenceGroups: b2.matches
    .filter((g) =>
      g.hypothesisIds.some((id) => j.output.some((c) => c.id === id)),
    )
    .map((g) => ({
      referenceIds: g.referenceIds,
      reference: reference.filter((c) => g.referenceIds.includes(c.id)),
      timingEligible: g.timingEligible,
    })),
}));
const sameSupport = b1.matches
  .filter((a) => a.timingEligible)
  .flatMap((a) => {
    const b = b2.matches.find(
      (b) =>
        b.timingEligible &&
        JSON.stringify(b.referenceIds) === JSON.stringify(a.referenceIds) &&
        JSON.stringify(b.hypothesisIds) === JSON.stringify(a.hypothesisIds),
    );
    return b
      ? [
          {
            referenceIds: a.referenceIds,
            hypothesisIds: a.hypothesisIds,
            startDelta: b.startError - a.startError,
            endDelta: b.endError - a.endError,
          },
        ]
      : [];
  });
const strictImprovement = b2.normalized.CER < b1.normalized.CER;
const regression =
  b2.normalized.CER > b1.normalized.CER ||
  b2.normalized.D > b1.normalized.D ||
  b2.normalized.I > b1.normalized.I ||
  b2.timing.severeBoundaryGroups > b1.timing.severeBoundaryGroups;
const rawTextNonDegradation =
  b2.normalized.CER <= b0.normalized.CER &&
  b2.coverage.referenceCharacterCoverage >=
    b0.coverage.referenceCharacterCoverage;
const status = regression
  ? "QUALITY_REGRESSION_HOLD"
  : strictImprovement && !rawTextNonDegradation
    ? "PARTIAL_RECOVERY_STILL_WORSE_THAN_RAW"
    : strictImprovement
      ? "DEVELOPMENT_QUALITY_GAIN_ONLY"
      : "ENGINEERING_PASS_NO_QUALITY_GAIN";
const result = {
  evaluationVersion: QUALITY_EVALUATION_POLICY.version,
  firstReadAt,
  goldHash,
  goldTimestampSyntaxNormalizationCount: normalized.replacementCount,
  partition: "development-known",
  primaryScope: QUALITY_EVALUATION_POLICY.scope,
  metrics,
  pairedChanges: paired,
  matchingInducedDelta: {
    sameSupportGroups: sameSupport.length,
    sameSupport,
    changedMatchingGroups: b2.timing.matchedGroups - sameSupport.length,
  },
  gates: {
    status,
    strictCERImprovementVsB1: strictImprovement,
    materialRegressionDetected: regression,
    rawTextNonDegradation,
    rawTimingNonDegradation:
      b2.timing.startMAE <= b0.timing.startMAE &&
      b2.timing.endMAE <= b0.timing.endMAE &&
      b2.timing.boundaryP95 <= b0.timing.boundaryP95,
    heldout: "HELDOUT_VALIDATION_NOT_RUN",
    generalizationPassed: false,
    machineOnlyReleaseAuthorized: false,
    fullB1MatchedEvidenceReplay: false,
    causalScope:
      "B2 versus same-scaffold repair-disabled; B1 historical descriptive",
  },
  mutations: {
    operations: changes.length,
    removedCueCount: changes.reduce((n, c) => n + c.input.length, 0),
    addedCueCount: changes.reduce((n, c) => n + c.output.length, 0),
    textChangedOperations: changes.filter(
      (c) =>
        c.input.map((x) => x.text).join("") !==
        c.output.map((x) => x.text).join(""),
    ).length,
    timingOrStructureChangedOperations: changes.filter(
      (c) =>
        JSON.stringify(c.input.map((x) => [x.start, x.end])) !==
        JSON.stringify(c.output.map((x) => [x.start, x.end])),
    ).length,
  },
};
fs.writeFileSync(
  path.join(dest, "metrics.json"),
  JSON.stringify(result, null, 2),
  { flag: "wx" },
);
const quote = (v) => '"' + String(v).replaceAll('"', '""') + '"';
fs.writeFileSync(
  path.join(dest, "cue-diff.csv"),
  [
    "old_cue_ids,new_cue_ids,old_text,new_text,old_times,new_times,operation_reason,posthoc_reference",
    ...paired.map((c) =>
      [
        c.old.map((x) => x.id).join("|"),
        c.new.map((x) => x.id).join("|"),
        c.old.map((x) => x.text).join("|"),
        c.new.map((x) => x.text).join("|"),
        JSON.stringify(c.old.map((x) => [x.start, x.end])),
        JSON.stringify(c.new.map((x) => [x.start, x.end])),
        c.reason,
        JSON.stringify(c.referenceGroups),
      ]
        .map(quote)
        .join(","),
    ),
  ].join("\n") + "\n",
);
fs.writeFileSync(
  path.join(dest, "changes.md"),
  "# Development-only result\n\n" +
    status +
    "\n\n" +
    JSON.stringify(result.mutations, null, 2) +
    "\n\nNo human text entered generation. See cue-diff.csv for local-only paired reference comparison. No held-out claim.\n",
);
verify();
if (hash(fs.readFileSync(gold)) !== goldHash)
  throw new Error("Reference changed");
fs.writeFileSync(
  path.join(dest, "validation.json"),
  JSON.stringify(
    {
      passed: true,
      frozenOutputsUnchanged: true,
      referenceUnchanged: true,
      referenceReadAfterFreeze: true,
      formatParity: Object.values(metrics).every(
        (m) => m.formatParity.textMetricsEqual,
      ),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      gates: result.gates,
      mutations: result.mutations,
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [
          k,
          { exact: v.exact, normalized: v.normalized, timing: v.timing },
        ]),
      ),
    },
    null,
    2,
  ),
);
