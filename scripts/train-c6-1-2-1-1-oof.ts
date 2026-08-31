import path from "node:path";
import {
  c61211MapSchema,
  c61211LabelsSchema,
  c61211TrainingSchema,
} from "@mvl/shared";
import { c612Arguments } from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { readC612FrozenInputs } from "../packages/video-subtitler/src/consensus/top-k/c612-frozen-inputs.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
import {
  readC61211,
  writeC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/artifact-io.js";
import {
  retrainC61211,
  trainingC61211Contract,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/same-feature-oof-retrainer.js";
import { demand } from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
const keys = [
  "--run",
  "--task",
  "--frozen-repository",
  "--training-baseline-repository",
  "--network",
];
const arg = c612Arguments(keys, keys),
  guard = installC6121OfflineGuard(),
  directory = path.resolve(arg("--run"));
const frozen = await readC612FrozenInputs(
  arg("--task"),
  arg("--frozen-repository"),
);
const map = c61211MapSchema.parse(
  await readC61211(
    path.join(directory, "c6-1-2-1-1-partitioned-supergroup-map.json"),
  ),
);
const labels = c61211LabelsSchema.parse(
  await readC61211(
    path.join(directory, "gold-c6-1-2-1-1-partition-candidate-labels.json"),
  ),
);
const contract = c61211TrainingSchema.parse(
  await readC61211(
    path.join(directory, "c6-1-2-1-1-training-contract-parity.json"),
  ),
);
const actual = await trainingC61211Contract(
  frozen,
  path.resolve(import.meta.dirname, ".."),
  arg("--training-baseline-repository"),
);
demand(
  actual.semanticHash === contract.semanticHash,
  "C61211_TRAINING_CODE_OR_FEATURE_DRIFT",
);
const trained = retrainC61211(
  frozen,
  map,
  labels,
  contract.trainingCodeHash,
  (message) => process.stdout.write(message + "\n"),
);
for (const artifact of Object.values(trained))
  await writeC61211(directory, artifact);
demand(
  guard().attemptedNetworkRequests === 0,
  "C61211_RESEARCH_NETWORK_ATTEMPT",
);
process.stdout.write(
  JSON.stringify({
    stage: "numeric-label-only-child-complete",
    models: trained.models.models.length,
    trainingNumericLabelCount: trained.models.trainingNumericLabelCount,
    rawGoldTextInputCount: 0,
    outerTestLabelInputCount: 0,
    acousticInference: 0,
  }) + "\n",
);
