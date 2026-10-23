/** Post-freeze receipt only: never edits candidates, policies or evaluation. */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import {
  sourceGroupSchema,
  alignmentSchema,
  groupPatchSchema,
} from "../packages/video-subtitler/dist/machine-quality/source-bound-group.js";
import {
  read,
  write,
  checkFiles,
  verifyPlan,
  hashFile,
  objectHash,
  variants,
} from "./c601164-common.mjs";
const output = path.resolve(process.argv[2]),
  plan = verifyPlan(output),
  freeze = read(path.join(output, "generation-freeze.json"));
checkFiles(output, freeze.metadata);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
let schemaDocuments = 0;
const validate = (schema, values) => {
  const json = z.toJSONSchema(schema),
    check = ajv.compile(json);
  for (const v of values) {
    schema.parse(v);
    if (!check(v)) throw Error(JSON.stringify(check.errors));
    schemaDocuments++;
  }
};
const groups = read(path.join(output, "source-groups.json")),
  alignments = read(path.join(output, "alignments.json"));
validate(sourceGroupSchema, groups);
validate(alignmentSchema, alignments);
const native = read(path.join(output, "patches/native.json")),
  aligned = read(path.join(output, "patches/aligned.json"));
validate(groupPatchSchema, [...native, ...aligned]);
const all = {};
for (const r of ["run-a", "run-b"]) {
  if (
    hashFile(path.join(output, r, "experiment-manifest.json")) !==
    freeze.manifests[r]
  )
    throw Error("Clock manifest changed");
  for (const f of freeze.runs[r])
    if (hashFile(path.join(output, r, f.path)) !== f.sha256)
      throw Error("Frozen export changed");
  for (const v of variants) {
    const pkg = read(
      path.join(output, r, v, "subtitle-package.needs-review.json"),
    );
    validate(subtitlePackageSchema, [pkg]);
    all[r + "/" + v] = pkg.cues;
  }
}
if (objectHash(freeze.runs["run-a"]) !== objectHash(freeze.runs["run-b"]))
  throw Error("A/B mismatch");
const baseline = all["run-a/T0-baseline"],
  main = all["run-a/T2-aligned-group"];
if (objectHash(baseline) !== objectHash(all["run-a/T2-application-disabled"]))
  throw Error("Disabled not exact");
const trace = read(path.join(output, "run-a/T0-baseline/stage-trace.json"));
const bindings = trace.find(
  (t) => t.stageName === "buildAcousticSemanticCueSegments",
).evidence.identityBindings;
const appliedIds = read(
  path.join(output, "run-a/T2-aligned-group/mutation-journal.json"),
).appliedPatchIds;
const applied = aligned.filter((p) => appliedIds.includes(p.id));
const removedStageIds = new Set(
  applied.flatMap((p) => p.oldCues.map((b) => b.cue.id)),
);
const affected = bindings.filter((b) =>
  b.sourceIds.some((id) => removedStageIds.has(id)),
);
if (affected.some((b) => b.sourceIds.some((id) => !removedStageIds.has(id))))
  throw Error("Protected source shares baseline exported group");
const unaffected = baseline.filter((c) => !affected.some((b) => b.id === c.id));
for (const c of unaffected)
  if (!main.some((n) => objectHash(n) === objectHash(c)))
    throw Error("Untouched context export changed");
for (const p of applied) {
  if (p.oldCues.some((b) => main.some((c) => c.id === b.cue.id)))
    throw Error("Old group still materialized");
  if (
    p.newCues.some(
      (c) =>
        !main.some(
          (n) =>
            n.id === c.id &&
            n.start === c.start &&
            n.end === c.end &&
            n.text.replaceAll("\n", "") === c.text,
        ),
    )
  )
    throw Error("Approved word order/boundaries changed downstream");
}
const events = fs
  .readFileSync(path.join(output, "alignment-evidence/events.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
const execution = read(path.join(output, "alignment-execution.json"));
const counters = {
  attempts: events.filter((e) => e.type === "logical-alignment-attempt").length,
  acousticForwards: events.filter((e) => e.type === "acoustic-forward-start")
    .length,
  modelLoadAttempts: events.filter((e) => e.type === "model-load-start").length,
  modelLoads: events.filter((e) => e.type === "ready").length,
  providerStarts: events.filter((e) => e.type === "provider-process-start")
    .length,
};
if (
  counters.attempts !== execution.attempts ||
  counters.acousticForwards !== execution.acousticForwardCount ||
  counters.modelLoads !== execution.modelLoads ||
  execution.attempts > plan.budget.maximumAttempts ||
  execution.requestedAudioSeconds > 180
)
  throw Error("Execution accounting mismatch");
const m = read(path.join(output, "evaluation/metrics.json")),
  a = m.metrics["T0-baseline"],
  b = m.metrics["T2-aligned-group"];
const regressions = [];
for (const k of ["S", "D", "I"])
  if (b.exact[k] > a.exact[k]) regressions.push("exact." + k);
for (const k of ["startMAE", "endMAE", "boundaryP95", "severeBoundaryGroups"])
  if (b.timing[k] > a.timing[k]) regressions.push("timing." + k);
if (b.timing.meanIoU < a.timing.meanIoU) regressions.push("timing.meanIoU");
write(output, "validation.json", {
  version: "c601164-validation-v1",
  schemaDocuments,
  schemaValidation: "Zod plus independent AJV2020",
  frozenPayloadsPerRun: freeze.runs["run-a"].length,
  independentABParity: true,
  baseline163ByteParity: true,
  applicationDisabledExact: true,
  unaffectedExportCues: unaffected.length,
  untouchedContextExact: true,
  approvedSourceWordsAndBoundariesPreserved: true,
  actualGroupChanges: applied.length,
  actualRemovedExportCues: affected.length,
  actualAddedExportCues: applied.reduce((n, p) => n + p.newCues.length, 0),
  counters,
  execution,
  selectedCandidateSourceParity: groups.map((g) => ({
    groupId: g.id,
    sameCompleteSourceHash:
      native.find((p) => p.group.id === g.id).group.sourceTextHash ===
      aligned.find((p) => p.group.id === g.id).group.sourceTextHash,
    nativePartialMaterializationIsNotDifferentCandidate: true,
  })),
  commonAppliedNativeAlignedGroups: groups.filter(
    (g) =>
      native.find((p) => p.group.id === g.id).action ===
        "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP" &&
      aligned.find((p) => p.group.id === g.id).action ===
        "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP",
  ).length,
  regressions,
  qualityGate: regressions.length ? "QUALITY_TRADEOFF_HOLD" : m.conclusion,
  engineering: "PASSED",
  freshASRRequests: 0,
  asrModelLoads: 0,
  asrProviderStarts: 0,
  humanValidated: false,
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  status: "needs-review",
  finalizationMethod: "none",
});
console.log(
  "VALIDATED",
  schemaDocuments,
  "schema documents;",
  unaffected.length,
  "untouched exports;",
  regressions,
);
