import path from "node:path";
import { stat } from "node:fs/promises";
import {
  c612CandidateLabelsSchema,
  c612GroupLabelsSchema,
  c612RankingsSchema,
  c612GroupDecisionsSchema,
  c612ConfigurationsSchema,
  c612ShadowSchema,
  c612LegacyMaterialSchema,
  c612ReadOnlySchema,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { readC612GoldAfterFreeze } from "../packages/video-subtitler/src/consensus/top-k/c612-evaluation-barrier.js";
import { readC612FrozenInputs } from "../packages/video-subtitler/src/consensus/top-k/c612-frozen-inputs.js";
import {
  c612Arguments,
  writeArtifact,
  verifyRerankingFreeze,
  assertJsonSemanticHash,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import {
  createC612CandidateLabels,
  evaluateRetrieval,
  bindGoldToFixedGroups,
  legacyMaterialText,
} from "../packages/video-subtitler/src/consensus/top-k/fixed-group-evaluation.js";
import { evaluateC612Quality } from "../packages/video-subtitler/src/consensus/top-k/c612-quality-evaluation.js";
import { c61Json } from "../packages/video-subtitler/src/consensus/c61-artifact-io.js";
import {
  artifact,
  hash,
  c612Defined,
} from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { fileHash } from "../packages/video-subtitler/src/consensus/top-k/c612-acoustic-io.js";
const keys = [
  "--run",
  "--peer",
  "--gold",
  "--baseline-run",
  "--phase",
  "--network",
];
const arg = c612Arguments(
    [...keys, "--source", "--production-directory"],
    keys,
  ),
  root = path.resolve(arg("--run")),
  peer = path.resolve(arg("--peer")),
  repository = path.resolve(import.meta.dirname, ".."),
  phase = arg("--phase");
if (!["labels", "final"].includes(phase))
  throw new Error("C612_INVALID_EVALUATOR_PHASE");
const frozen = await readC612FrozenInputs(root, repository);
if (phase === "final") {
  const reranking = await verifyRerankingFreeze(root);
  await verifyRerankingFreeze(peer);
  if (reranking.machineFreezeHash !== frozen.freeze.semanticHash)
    throw new Error("C612_RERANKING_MACHINE_BINDING");
}
// The only raw Gold access in this CLI occurs beyond both machine barriers.
const barrier = await readC612GoldAfterFreeze({
  a: root,
  b: peer,
  repository,
  gold: arg("--gold"),
});
const baselineFile = path.join(
    arg("--baseline-run"),
    "evaluation/evaluation-S0.local-only.json",
  ),
  expectedBaseline = frozen.baseline.inputFiles.find(
    (f) => f.relativePath === "evaluation/evaluation-S0.local-only.json",
  );
if ((await fileHash(baselineFile)) !== expectedBaseline?.sha256)
  throw new Error("C612_LEGACY_BASELINE_FILE_CHANGED");
const legacy = machineVsGoldEvaluationSchema.parse(await c61Json(baselineFile));
if (legacy.goldIdentity.sha256 !== barrier.goldHash)
  throw new Error("C612_GOLD_BASELINE_IDENTITY_MISMATCH");
const directory = path.join(root, "evaluation");
if (phase === "labels") {
  const labels = createC612CandidateLabels({
    groups: frozen.mapping.groups,
    production: frozen.production,
    universe: frozen.universe,
    ranks: frozen.ranks.rows,
    sets: frozen.topK.sets,
    folds: frozen.folds,
    gold: barrier.gold,
    freezeHash: frozen.freeze.semanticHash,
    goldHash: barrier.goldHash,
    goldFirstReadAt: barrier.goldFirstReadAt,
    mappingHash: frozen.mapping.semanticHash,
  });
  await writeArtifact(directory, labels.groupLabels);
  await writeArtifact(directory, labels.labels);
  const retrieval = evaluateRetrieval({
    labels: labels.labels.labels,
    ranks: frozen.ranks.rows,
    sets: frozen.topK.sets,
    freezeHash: frozen.freeze.semanticHash,
  });
  await writeArtifact(directory, retrieval);
  process.stdout.write(
    JSON.stringify({
      stage: "gold-isolated-labels",
      evaluableCandidates: labels.labels.labels.filter((l) => l.eligible)
        .length,
      evaluableGroups: labels.groupLabels.rows.filter((r) =>
        r.status.startsWith("FIXED_"),
      ).length,
      retrieval: retrieval.profiles,
    }) + "\n",
  );
} else {
  const labels = c612CandidateLabelsSchema.parse(
      await assertJsonSemanticHash(
        path.join(directory, "gold-c6-1-2-top-k-candidate-labels.json"),
      ),
    ),
    groups = c612GroupLabelsSchema.parse(
      await assertJsonSemanticHash(
        path.join(directory, "gold-c6-1-2-fixed-group-labels.json"),
      ),
    );
  if (
    groups.goldIdentityHash !== barrier.goldHash ||
    hash(
      bindGoldToFixedGroups(
        frozen.mapping.groups,
        frozen.production,
        barrier.gold,
      ),
    ) !== groups.goldBindingHash
  )
    throw new Error("C612_FIXED_GOLD_BINDING_CHANGED");
  const rankings = c612RankingsSchema.parse(
      await assertJsonSemanticHash(
        path.join(root, "reranking/c6-1-2-oof-candidate-rankings.json"),
      ),
    ),
    decisions = c612GroupDecisionsSchema.parse(
      await assertJsonSemanticHash(
        path.join(root, "reranking/c6-1-2-oof-group-decisions.json"),
      ),
    ),
    configurations = c612ConfigurationsSchema.parse(
      await assertJsonSemanticHash(
        path.join(
          root,
          "reranking/machine-c6-1-2-group-shadow-configurations.json",
        ),
      ),
    );
  const quality = evaluateC612Quality({
    frozen,
    gold: barrier.gold,
    bindings: groups.rows,
    goldBindingHash: groups.goldBindingHash,
    labels: labels.labels,
    rankings: rankings.rows,
    rankingsHash: rankings.semanticHash,
    decisions: decisions.rows,
    decisionsHash: decisions.semanticHash,
    configurations: configurations.rows,
    configurationsHash: configurations.semanticHash,
  });
  for (const value of Object.values(quality))
    await writeArtifact(directory, value);
  const manifest = c612ShadowSchema.parse(
    await c61Json(
      path.join(root, "reranking/machine-c6-1-2-shadow-output.json"),
    ),
  );
  const count = (cues: typeof frozen.production.cues) =>
    legacy.alignments
      .filter((a) => a.classification === "matched")
      .reduce(
        (n, a) =>
          n +
          legacyMaterialText(
            a.machineCueIndexes.map((i) => c612Defined(cues[i]).text).join(""),
            a.goldCueIndexes
              .map((i) => c612Defined(barrier.gold[i]).text)
              .join(""),
          ),
        0,
      );
  const baselineCount = count(frozen.production.cues),
    profiles = [];
  for (const p of manifest.profiles) {
    const pkg = subtitlePackageSchema.parse(
      await c61Json(path.join(root, p.subtitlePackagePath)),
    );
    const materialErrors = count(pkg.cues);
    profiles.push({
      profileId: p.profileId,
      materialErrors,
      materialDelta: materialErrors - baselineCount,
      fixedMatching: true,
    });
  }
  const material = c612LegacyMaterialSchema.parse(
    artifact("c6-1-2-fixed-legacy-material-evaluation", {
      evaluationOnly: true,
      privacy: "LOCAL_ONLY",
      machineFreezeHash: frozen.freeze.semanticHash,
      alignmentFrozenOnce: true,
      baselineAlignmentHash: hash(
        legacy.alignments.map((a) => ({
          machineCueIndexes: a.machineCueIndexes,
          goldCueIndexes: a.goldCueIndexes,
          classification: a.classification,
        })),
      ),
      baselineMaterialErrors: baselineCount,
      baselineExpectedParity:
        baselineCount === legacy.materialTextErrors.length &&
        baselineCount === 77,
      profiles,
      legacyOnlyNotTrainingLabels: true,
    }),
  );
  if (!material.baselineExpectedParity)
    throw new Error("C612_LEGACY_FIXED_MATERIAL_BASELINE_NOT_REPRODUCED");
  await writeArtifact(directory, material);
  const sourceMediaHashAfter = await fileHash(arg("--source")),
    goldHashAfter = await fileHash(arg("--gold"));
  if (
    sourceMediaHashAfter !== frozen.freeze.sourceIdentity ||
    goldHashAfter !== barrier.goldHash
  )
    throw new Error("C612_SOURCE_OR_GOLD_CHANGED_AFTER_EVALUATION");
  for (const file of frozen.baseline.productionFiles)
    if (
      (await fileHash(
        path.join(arg("--production-directory"), file.relativePath),
      )) !== file.sha256
    )
      throw new Error("C612_PRODUCTION_FILE_CHANGED");
  await writeArtifact(
    directory,
    c612ReadOnlySchema.parse(
      artifact("c6-1-2-read-only-proof", {
        sourceMediaHashBefore: frozen.freeze.sourceIdentity,
        sourceMediaHashAfter,
        sourceBytes: (await stat(arg("--source"))).size,
        goldHashBefore: barrier.goldHash,
        goldHashAfter,
        goldBytes: barrier.before.size,
        sourceReadOnly: true,
        goldReadOnly: true,
        productionFiles: frozen.baseline.productionFiles,
        productionUnchanged: true,
        rawGoldOpenedByVerifier: false,
      }),
    ),
  );
  process.stdout.write(
    JSON.stringify({
      stage: "final-fixed-group-evaluation",
      primary: quality.cv.profiles.find((p) => p.profileId === "L6"),
      observedPostHoc: quality.cv.bestObservedProfilePostHoc,
      material: profiles.filter((p) => /^L[0-8]$/.test(p.profileId)),
    }) + "\n",
  );
}
