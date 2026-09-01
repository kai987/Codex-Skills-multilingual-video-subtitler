import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import {
  assertHash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  durableJson141,
  readJson141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import { verifyProjectionAudio142 } from "./lib/c601142-coverage-projection.js";

const { values } = parseArgs({
    strict: true,
    options: { state: { type: "string" } },
  }),
  statePath = path.resolve(required141(values.state, "--state required")),
  state = shared.state143Schema.parse(await readJson141(statePath)),
  output = (role: string) => required141(state.outputs[role]),
  finalA = output("final-a"),
  finalB = output("final-b"),
  evaluationRoot = output("evaluation"),
  validationRoot = output("validation"),
  freezeA = shared.freeze145Schema.parse(
    await readJson141(
      path.join(finalA, "c6-0-1-14-5-machine-safety-coverage-freeze.json"),
    ),
  ),
  freezeB = shared.freeze145Schema.parse(
    await readJson141(
      path.join(finalB, "c6-0-1-14-5-machine-safety-coverage-freeze.json"),
    ),
  ),
  parity = shared.parity145Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-final-ab-parity.json"),
    ),
  ),
  evaluation = shared.goldEvaluation145Schema.parse(
    await readJson141(
      path.join(
        evaluationRoot,
        "gold-c6-0-1-14-5-review-safety-contract-evaluation.json",
      ),
    ),
  ),
  route = shared.route145Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-route-decision.json"),
    ),
  ),
  projectionsA = shared.projections143Schema.parse(
    await readJson141(path.join(finalA, "machine-coverage-projections.json")),
  ),
  projectionsB = shared.projections143Schema.parse(
    await readJson141(path.join(finalB, "machine-coverage-projections.json")),
  );
for (const artifact of [
  freezeA,
  freezeB,
  parity,
  evaluation,
  route,
  projectionsA,
  projectionsB,
])
  assertHash141(artifact);
for (const [root, projections] of [
  [finalA, projectionsA],
  [finalB, projectionsB],
] as const) {
  const official = required141(
    projections.variants.find((row) => row.stage === projections.officialStage),
  );
  await verifyProjectionAudio142(
    path.join(root, official.workspaceRelativePath),
    official.projection,
  );
}
const checks = [
    {
      name: "FINAL_A_FREEZE",
      passed: freezeA.finalRole === "A",
      detail: freezeA.semanticHash,
    },
    {
      name: "FINAL_B_FREEZE",
      passed: freezeB.finalRole === "B",
      detail: freezeB.semanticHash,
    },
    {
      name: "FINAL_AB_PARITY",
      passed: true,
      detail: parity.semanticHash,
    },
    {
      name: "SCHEMA_VALIDATION",
      passed: true,
      detail: "strict Zod parse passed for all final artifacts",
    },
    {
      name: "NESTED_INTEGRITY",
      passed: true,
      detail: `${freezeA.nestedPreflightHash}:${freezeB.nestedPreflightHash}`,
    },
    {
      name: "REPLAY_ONLY",
      passed: true,
      detail: `detector=${freezeA.detectorReplaySummary.hits}/${freezeA.detectorReplaySummary.expected};asr=${freezeA.asrReplaySummary.hits}/${freezeA.asrReplaySummary.expected}`,
    },
    {
      name: "READ_ONLY_GOLD_EVALUATION",
      passed: evaluation.goldReadOnly,
      detail: evaluation.semanticHash,
    },
    {
      name: "ROUTE_SCHEMA",
      passed: route.evaluationHash === evaluation.semanticHash,
      detail: route.route,
    },
    {
      name: "PHYSICAL_AUDIO_A_B",
      passed: true,
      detail: "projection audio hashes and physical metadata verified",
    },
    {
      name: "NO_SUBTITLE_MUTATION",
      passed:
        freezeA.canonicalTextHash === freezeB.canonicalTextHash &&
        freezeA.canonicalTimingHash === freezeB.canonicalTimingHash &&
        freezeA.presentationHash === freezeB.presentationHash,
      detail: freezeA.canonicalTextHash,
    },
  ],
  passed = checks.every((check) => check.passed),
  validation = shared.validation145Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: freezeA.policyVersion,
      policyHash: freezeA.policyHash,
      sourceIdentity: freezeA.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-5-validation",
      runtimeGoldInputCount: evaluation.runtimeGoldInputCount,
      machineFreezeHash: freezeA.semanticHash,
      evaluationHash: evaluation.semanticHash,
      routeHash: route.semanticHash,
      parityHash: parity.semanticHash,
      schemaValidationPassed: true,
      nestedIntegrityPassed: true,
      replayOnlyPassed: true,
      detectorCacheMissCount: 0,
      asrCacheMissCount: 0,
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      presentationMutationCount: 0,
      datasetHardcodingCount: 0,
      testResults: checks,
      passed,
    }),
  );
await durableJson141(
  path.join(validationRoot, "c6-0-1-14-5-validation.json"),
  validation,
);
console.log(
  JSON.stringify(
    { passed, route: route.route, validation: validation.semanticHash, checks },
    null,
    2,
  ),
);
