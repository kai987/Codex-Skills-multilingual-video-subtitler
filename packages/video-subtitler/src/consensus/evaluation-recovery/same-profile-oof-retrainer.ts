/** This module's API has no Gold text, Gold path, or Gold reader. Only strict
 * numeric labels and already frozen machine inputs cross the process boundary. */
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  c6121LabelsSchema,
  c6121TrainingParitySchema,
  c6121ModelsSchema,
  c6121ThresholdsSchema,
  c6121RankingsSchema,
  c6121DecisionsSchema,
  c6121ConfigurationsSchema,
  c6121ShadowProvenanceSchema,
  type C6121Labels,
  type C6121Map,
} from "@mvl/shared";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import {
  C612_RERANKERS,
  C612_RERANKER_PROFILE_HASH,
} from "../top-k/linear-reranker.js";
import { C612_POLICY, c612Defined } from "../top-k/c612-policy.js";
import { runC612Oof } from "../top-k/top-k-oof-reranking.js";
import {
  buildGroupConfigurations,
  renderC612Shadow,
} from "../top-k/group-shadow-configurations.js";
import { c6121Artifact, demand, hash } from "./c6121-policy.js";
export const C6121_TRAINING_CODE = [
  "linear-reranker.ts",
  "top-k-oof-reranking.ts",
  "group-shadow-configurations.ts",
  "c612-policy.ts",
].map((name) => "packages/video-subtitler/src/consensus/top-k/" + name);

export async function c6121TrainingContract(
  frozen: C612FrozenInputs,
  repository: string,
  baselineRepository: string,
) {
  const files = [];
  for (const relative of C6121_TRAINING_CODE) {
    const bytes = await readFile(path.join(repository, relative)),
      baseline = await readFile(path.join(baselineRepository, relative));
    demand(bytes.equals(baseline), "C6121_TRAINING_CODE_CHANGED:" + relative);
    files.push({ relative, hash: hash(bytes.toString("utf8")) });
  }
  return c6121TrainingParitySchema.parse(
    c6121Artifact("c6-1-2-1-training-contract-parity", {
      featureHash: frozen.features.semanticHash,
      foldHash: frozen.folds.semanticHash,
      profileDefinitionHash: C612_RERANKER_PROFILE_HASH,
      thresholdGridHash: hash(C612_POLICY.rankers.trainOnlyThresholdCandidates),
      trainingCodeHash: hash(files),
      candidateSetHash: frozen.topK.semanticHash,
      candidateRankHash: frozen.ranks.semanticHash,
      correlationHash: frozen.identities.semanticHash,
      completenessHash: frozen.completeness.semanticHash,
      contractionHash: frozen.contraction.semanticHash,
      checks: files.map((f) => ({
        name: f.relative,
        passed: true,
        observed: f.hash,
        expected: f.hash,
      })),
      passed: true,
      onlyNumericLabelsRebound: true,
    }),
  );
}
export function retrainC6121Oof(
  frozen: C612FrozenInputs,
  map: C6121Map,
  input: C6121Labels,
  trainingCodeHash: string,
  progress?: (message: string) => void,
) {
  const labels = c6121LabelsSchema.parse(input);
  demand(
    labels.supergroupMapHash === map.semanticHash,
    "C6121_TRAINING_MAP_BINDING",
  );
  demand(
    new Set(labels.labels.map((l) => l.candidateId)).size ===
      labels.labels.length,
    "C6121_DUPLICATE_TRAINING_LABEL",
  );
  for (const row of labels.labels) {
    const group = map.groups.find((g) => g.supergroupId === row.supergroupId);
    const fold = frozen.folds.folds.find((f) =>
      f.eventIds.includes(row.eventId),
    );
    demand(
      row.label.eligible === row.oofTrainingEligible,
      "C6121_INELIGIBLE_LABEL_ENTERED_TRAINER",
    );
    if (row.oofTrainingEligible) {
      demand(
        group?.oofTrainingEligible &&
          group.foldId === fold?.foldId &&
          row.foldId === fold.foldId &&
          row.label.foldId === fold.foldId,
        "C6121_SUPERGROUP_FOLD_MISMATCH",
      );
      demand(
        group.candidateEligibleEventIds.includes(row.eventId),
        "C6121_EVENT_NOT_LABEL_ELIGIBLE",
      );
    }
  }
  const before = hash([
    frozen.features,
    frozen.folds,
    frozen.topK,
    frozen.identities,
    frozen.completeness,
    frozen.contraction,
    frozen.ranks,
  ]);
  const oof = runC612Oof({
    features: frozen.features.rows,
    sets: frozen.topK.sets,
    completeness: frozen.completeness.rows,
    contractions: frozen.contraction.rows,
    labels: labels.labels.map((r) => r.label),
    folds: frozen.folds,
    featureHash: frozen.features.semanticHash,
    profiles: C612_RERANKERS.filter((p) => /^L[0-8]$/.test(p.id)),
    ...(progress ? { progress } : {}),
  });
  for (const model of oof.models.models) {
    const test = c612Defined(
      frozen.folds.folds.find((f) => f.foldId === model.outerFoldId),
    );
    demand(
      model.trainingEventIds.every((id) => !test.eventIds.includes(id)),
      "C6121_OUTER_TEST_LABEL_LEAK",
    );
  }
  demand(
    before ===
      hash([
        frozen.features,
        frozen.folds,
        frozen.topK,
        frozen.identities,
        frozen.completeness,
        frozen.contraction,
        frozen.ranks,
      ]),
    "C6121_FROZEN_TRAINING_INPUT_MUTATED",
  );
  const grouped = buildGroupConfigurations({
    rankings: oof.rankings.rows,
    rankingHash: oof.rankings.semanticHash,
    groups: frozen.mapping.groups,
    mappingHash: frozen.mapping.semanticHash,
    production: frozen.production,
    universe: frozen.universe,
  });
  const models = c6121ModelsSchema.parse(
    c6121Artifact("c6-1-2-1-oof-retrain-models", {
      supergroupMapHash: map.semanticHash,
      featureHash: frozen.features.semanticHash,
      foldHash: frozen.folds.semanticHash,
      profileDefinitionHash: C612_RERANKER_PROFILE_HASH,
      trainingCodeHash,
      models: oof.models.models,
      rawGoldTextFeatureCount: 0,
      trainingNumericLabelCount: labels.labels.filter(
        (l) =>
          l.oofTrainingEligible &&
          frozen.features.rows.some((f) => f.candidateId === l.candidateId),
      ).length,
      outerTestLabelInputToPredictionCount: 0,
    }),
  );
  const thresholds = c6121ThresholdsSchema.parse(
    c6121Artifact("c6-1-2-1-oof-retrain-thresholds", {
      supergroupMapHash: map.semanticHash,
      foldHash: frozen.folds.semanticHash,
      thresholdGridHash: hash(C612_POLICY.rankers.trainOnlyThresholdCandidates),
      rows: oof.thresholds.rows,
    }),
  );
  const rankings = c6121RankingsSchema.parse(
    c6121Artifact("c6-1-2-1-oof-retrain-rankings", {
      supergroupMapHash: map.semanticHash,
      featureHash: frozen.features.semanticHash,
      foldHash: frozen.folds.semanticHash,
      modelsHash: models.semanticHash,
      rows: oof.rankings.rows,
      outerTestLabelInputToPredictionCount: 0,
    }),
  );
  const configurations = c6121ConfigurationsSchema.parse(
    c6121Artifact("c6-1-2-1-oof-retrain-configurations", {
      supergroupMapHash: map.semanticHash,
      rankingHash: rankings.semanticHash,
      frozenMachineMappingHash: frozen.mapping.semanticHash,
      originalAssemblerArtifactHash: grouped.configurations.semanticHash,
      rows: grouped.configurations.rows,
      goldUsed: false,
    }),
  );
  const decisions = c6121DecisionsSchema.parse(
    c6121Artifact("c6-1-2-1-oof-retrain-decisions", {
      supergroupMapHash: map.semanticHash,
      rankingHash: rankings.semanticHash,
      configurationsHash: configurations.semanticHash,
      rows: grouped.groupDecisions.rows,
      productionMutationAllowed: false,
    }),
  );
  return { models, thresholds, rankings, configurations, decisions };
}

export async function writeC6121Shadows(
  directory: string,
  frozen: C612FrozenInputs,
  map: C6121Map,
  trained: ReturnType<typeof retrainC6121Oof>,
) {
  const profiles = [],
    rows = [];
  for (const profileId of [
    ...new Set(trained.rankings.rows.map((r) => r.profileId)),
  ].sort()) {
    const decisions = trained.decisions.rows.filter(
      (r) => r.profileId === profileId,
    );
    const selections = decisions.flatMap((d) => d.selections);
    const shadow = renderC612Shadow(
      frozen.production,
      frozen.universe,
      selections,
      profileId,
    );
    const relativePath =
      "research-shadow/c6-1-2-1-retrained/" + profileId.toLowerCase();
    await mkdir(path.join(directory, relativePath), { recursive: true });
    for (const [name, content] of Object.entries({
      "subtitle-package.json":
        JSON.stringify(shadow.subtitlePackage, null, 2) + "\n",
      "subtitle.ass": shadow.ass,
      "subtitle.srt": shadow.srt,
      "subtitle.vtt": shadow.vtt,
    }))
      await writeFile(path.join(directory, relativePath, name), content, {
        flag: "wx",
      });
    profiles.push({
      profileId,
      relativePath,
      cueCount: shadow.cues.length,
      timingHash: shadow.timingHash,
      presentationHash: hash([shadow.ass, shadow.srt, shadow.vtt]),
    });
    for (const selection of selections) {
      const event = c612Defined(
        frozen.universe.events.find((e) => e.eventId === selection.eventId),
      );
      const candidate = c612Defined(
        frozen.universe.candidates.find(
          (c) => c.candidateId === selection.candidateId,
        ),
      );
      const decision = c612Defined(
        decisions.find((d) =>
          d.selections.some((s) => s.eventId === selection.eventId),
        ),
      );
      const component = c612Defined(
        map.groups.find((g) => g.machineGroupIds.includes(decision.groupId)),
      );
      const ranking = c612Defined(
        trained.rankings.rows.find(
          (r) => r.profileId === profileId && r.eventId === event.eventId,
        ),
      );
      const threshold = c612Defined(
        trained.thresholds.rows.find(
          (t) => t.profileId === profileId && t.outerFoldId === ranking.foldId,
        ),
      );
      const span = c612Defined(event.finalSpan);
      rows.push({
        profileId,
        eventId: event.eventId,
        candidateId: candidate.candidateId,
        machineGroupId: decision.groupId,
        supergroupId: component.supergroupId,
        foldId: ranking.foldId,
        modelHash: ranking.modelHash,
        thresholdHash: hash(threshold),
        decisionReason: decision.reasons.length
          ? decision.reasons
          : ["FROZEN_WHOLE_CANDIDATE_ASSEMBLER_SELECTED_SHADOW_ONLY"],
        sourceSpan: {
          cueId: span.finalCueId,
          start: span.spanStart,
          end: span.spanEnd,
        },
        textBefore: span.spanText,
        textAfter: candidate.displayText,
      });
    }
  }
  return c6121ShadowProvenanceSchema.parse(
    c6121Artifact("c6-1-2-1-retrained-shadow-provenance", {
      supergroupMapHash: map.semanticHash,
      rows,
      profiles,
      localOnly: true,
      newCandidateCount: 0,
      productionMutationCount: 0,
    }),
  );
}
