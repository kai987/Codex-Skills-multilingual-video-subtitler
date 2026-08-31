import path from "node:path";
import {
  c6121LabelsSchema,
  c6121MapSchema,
  c6121TrainingParitySchema,
} from "@mvl/shared";
import { c612Arguments } from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { readC612FrozenInputs } from "../packages/video-subtitler/src/consensus/top-k/c612-frozen-inputs.js";
import {
  readC6121Artifact,
  writeC6121Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";
import {
  c6121TrainingContract,
  retrainC6121Oof,
  writeC6121Shadows,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/same-profile-oof-retrainer.js";
import { demand } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
const keys = [
  "--run",
  "--task-a",
  "--frozen-repository",
  "--baseline-repository",
  "--network",
];
const arg = c612Arguments(keys, keys),
  guard = installC6121OfflineGuard();
const directory = path.resolve(arg("--run")),
  repository = path.resolve(import.meta.dirname, "..");
const frozen = await readC612FrozenInputs(
  arg("--task-a"),
  arg("--frozen-repository"),
);
const map = c6121MapSchema.parse(
  await readC6121Artifact(
    path.join(directory, "c6-1-2-1-evaluator-supergroup-map.json"),
  ),
);
const labels = c6121LabelsSchema.parse(
  await readC6121Artifact(
    path.join(directory, "gold-c6-1-2-1-supergroup-candidate-labels.json"),
  ),
);
const contract = c6121TrainingParitySchema.parse(
  await readC6121Artifact(
    path.join(directory, "c6-1-2-1-training-contract-parity.json"),
  ),
);
const actual = await c6121TrainingContract(
  frozen,
  repository,
  arg("--baseline-repository"),
);
demand(
  actual.semanticHash === contract.semanticHash,
  "C6121_TRAINING_CONTRACT_CHANGED",
);
const trained = retrainC6121Oof(
  frozen,
  map,
  labels,
  contract.trainingCodeHash,
  (message) => process.stdout.write(message + "\n"),
);
for (const artifact of Object.values(trained))
  await writeC6121Artifact(directory, artifact);
await writeC6121Artifact(
  directory,
  await writeC6121Shadows(directory, frozen, map, trained),
);
demand(guard().attemptedNetworkRequests === 0, "C6121_NETWORK_ATTEMPT");
process.stdout.write(
  JSON.stringify({
    stage: "numeric-label-only-oof-child",
    profiles: 9,
    outerModels: trained.models.models.length,
    predictions: trained.rankings.rows.length,
    rawGoldTextInputCount: 0,
    acousticModelExecutionCount: 0,
    networkUsed: false,
  }) + "\n",
);
