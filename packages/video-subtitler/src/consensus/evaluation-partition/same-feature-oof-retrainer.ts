import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
  c61211TrainingSchema,
  c61211ModelsSchema,
  c61211ThresholdsSchema,
  c61211RankingsSchema,
  c61211ConfigurationsSchema,
  c61211DecisionsSchema,
  c61211ShadowsSchema,
  c61211LabelsSchema,
  c61211MapSchema,
  type C61211Labels,
  type C61211Map,
  type C612GroupDecision,
  type C61211Profile,
} from "@mvl/shared";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import {
  c6121TrainingContract,
  retrainC6121Oof,
} from "../evaluation-recovery/same-profile-oof-retrainer.js";
import { renderC612Shadow } from "../top-k/group-shadow-configurations.js";
import { c61211Artifact, c61211Body, demand } from "./c61211-policy.js";
import {
  scoringC61211Adapter,
  trainingC61211Labels,
} from "./scoring-adapter.js";
import { shaBytes } from "./artifact-io.js";
export async function trainingC61211Contract(
  frozen: C612FrozenInputs,
  repository: string,
  baselineRepository: string,
) {
  return c61211TrainingSchema.parse(
    c61211Artifact(
      "c6-1-2-1-1-training-contract-parity",
      c61211Body(
        await c6121TrainingContract(frozen, repository, baselineRepository),
      ),
    ),
  );
}
/** Numeric labels only. All model fitting, imputation, threshold search and
 * frozen-machine-group configuration assembly stay on the original code path. */
export function retrainC61211(
  frozen: C612FrozenInputs,
  map: C61211Map,
  labels: C61211Labels,
  trainingCodeHash: string,
  progress?: (s: string) => void,
) {
  c61211LabelsSchema.parse(labels);
  c61211MapSchema.parse(map);
  demand(
    map.mode === "D1_CONSERVATIVE_MONOTONIC" &&
      labels.partitionMapHash === map.semanticHash,
    "C61211_TRAINING_PRIMARY_MAP_REQUIRED",
  );
  const adapter = scoringC61211Adapter(map);
  demand(
    labels.scoringAdapterHash === adapter.semanticHash,
    "C61211_TRAINING_ADAPTER_DRIFT",
  );
  const old = retrainC6121Oof(
    frozen,
    adapter,
    trainingC61211Labels(labels),
    trainingCodeHash,
    progress,
  );
  const fields = (value: object) => {
    const body = c61211Body(value);
    delete body.supergroupMapHash;
    return { ...body, partitionMapHash: map.semanticHash };
  };
  const models = c61211ModelsSchema.parse(
    c61211Artifact("c6-1-2-1-1-oof-retrain-models", fields(old.models)),
  );
  const thresholds = c61211ThresholdsSchema.parse(
    c61211Artifact("c6-1-2-1-1-oof-retrain-thresholds", fields(old.thresholds)),
  );
  const rankings = c61211RankingsSchema.parse(
    c61211Artifact("c6-1-2-1-1-oof-rankings", {
      ...fields(old.rankings),
      modelsHash: models.semanticHash,
    }),
  );
  const configurations = c61211ConfigurationsSchema.parse(
    c61211Artifact("c6-1-2-1-1-oof-configurations", {
      ...fields(old.configurations),
      rankingHash: rankings.semanticHash,
    }),
  );
  const decisions = c61211DecisionsSchema.parse(
    c61211Artifact("c6-1-2-1-1-oof-decisions", {
      ...fields(old.decisions),
      rankingHash: rankings.semanticHash,
      configurationsHash: configurations.semanticHash,
    }),
  );
  return { models, thresholds, rankings, configurations, decisions };
}
export async function writeC61211Shadows(
  directory: string,
  frozen: C612FrozenInputs,
  map: C61211Map,
  tracks: readonly {
    track: C61211Profile["track"];
    decisions: readonly C612GroupDecision[];
    frozenTask?: string;
  }[],
) {
  const rows = [];
  for (const entry of tracks) {
    for (const profileId of [
      ...new Set(entry.decisions.map((d) => d.profileId)),
    ]
      .filter((id) => /^L[0-8]$/.test(id))
      .sort()) {
      const selections = entry.decisions
        .filter((d) => d.profileId === profileId)
        .flatMap((d) => d.selections);
      const shadow = renderC612Shadow(
        frozen.production,
        frozen.universe,
        selections,
        profileId,
      );
      const relativeDirectory =
        "research-shadow/c6-1-2-1-1/" +
        (entry.track === "FROZEN_DECISION_REEVALUATION" ? "frozen/" : "oof/") +
        profileId.toLowerCase();
      await mkdir(path.join(directory, relativeDirectory), { recursive: true });
      const files = [];
      for (const [name, bytes] of Object.entries({
        "subtitle-package.json":
          JSON.stringify(shadow.subtitlePackage, null, 2) + "\n",
        "subtitle.ass": shadow.ass,
        "subtitle.srt": shadow.srt,
        "subtitle.vtt": shadow.vtt,
      })) {
        if (entry.frozenTask && name !== "subtitle-package.json") {
          const previous = await readFile(
            path.join(
              entry.frozenTask,
              "research-shadow",
              profileId.toLowerCase(),
              name,
            ),
          );
          demand(
            previous.equals(Buffer.from(bytes)),
            "C61211_FROZEN_SHADOW_BYTES_CHANGED:" + profileId + "/" + name,
          );
        }
        const relativePath = path.join(relativeDirectory, name);
        await writeFile(path.join(directory, relativePath), bytes, {
          flag: "wx",
        });
        files.push({ relativePath, sha256: shaBytes(bytes) });
      }
      rows.push({
        profileId,
        track: entry.track,
        relativeDirectory,
        selectedCandidateIds: selections.map((s) => s.candidateId),
        timingHash: shadow.timingHash,
        textHash: shadow.textHash,
        files,
      });
    }
  }
  return c61211ShadowsSchema.parse(
    c61211Artifact("c6-1-2-1-1-research-shadow-manifest", {
      partitionMapHash: map.semanticHash,
      rows,
      productionMutation: 0,
      newCandidates: 0,
      localOnly: true,
    }),
  );
}
