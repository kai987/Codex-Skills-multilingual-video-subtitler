import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  c612CandidateLabelsSchema,
  c612ShadowSchema,
  c612ApplicationSchema,
  c612ProvenanceSchema,
} from "@mvl/shared";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../packages/video-subtitler/src/blind-acceptance/gold-isolation.js";
import { readC612FrozenInputs } from "../packages/video-subtitler/src/consensus/top-k/c612-frozen-inputs.js";
import {
  c612Arguments,
  writeArtifact,
  freezeReranking,
  assertJsonSemanticHash,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { runC612Oof } from "../packages/video-subtitler/src/consensus/top-k/top-k-oof-reranking.js";
import {
  buildGroupConfigurations,
  renderC612Shadow,
} from "../packages/video-subtitler/src/consensus/top-k/group-shadow-configurations.js";
import {
  artifact,
  hash,
  c612Defined,
} from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
const arg = c612Arguments(["--run", "--network"], ["--run", "--network"]),
  root = path.resolve(arg("--run")),
  repository = path.resolve(import.meta.dirname, "..");
const frozen = await readC612FrozenInputs(root, repository);
const labels = c612CandidateLabelsSchema.parse(
  await assertJsonSemanticHash(
    path.join(root, "evaluation/gold-c6-1-2-top-k-candidate-labels.json"),
  ),
);
if (
  labels.machineFreezeHash !== frozen.freeze.semanticHash ||
  labels.mappingHash !== frozen.mapping.semanticHash
)
  throw new Error("C612_LABEL_FREEZE_BINDING");
const oof = runC612Oof({
  features: frozen.features.rows,
  sets: frozen.topK.sets,
  completeness: frozen.completeness.rows,
  contractions: frozen.contraction.rows,
  labels: labels.labels,
  folds: frozen.folds,
  featureHash: frozen.features.semanticHash,
  progress: (s) => process.stdout.write(s + "\n"),
});
const grouped = buildGroupConfigurations({
  rankings: oof.rankings.rows,
  rankingHash: oof.rankings.semanticHash,
  groups: frozen.mapping.groups,
  mappingHash: frozen.mapping.semanticHash,
  production: frozen.production,
  universe: frozen.universe,
});
const dir = path.join(root, "reranking");
await mkdir(dir, { recursive: false });
for (const value of [
  oof.models,
  oof.thresholds,
  oof.rankings,
  oof.decisions,
  grouped.configurations,
  grouped.groupDecisions,
])
  await writeArtifact(dir, value);
const profiles = [],
  ledger = [],
  provenance = [];
for (const profileId of [
  ...new Set(oof.rankings.rows.map((r) => r.profileId)),
].sort()) {
  const selections = grouped.groupDecisions.rows
      .filter((r) => r.profileId === profileId)
      .flatMap((r) => r.selections),
    shadow = renderC612Shadow(
      frozen.production,
      frozen.universe,
      selections,
      profileId,
    );
  const relative = path.join("research-shadow", profileId.toLowerCase());
  await mkdir(path.join(root, relative), { recursive: true });
  for (const [name, content] of [
    [
      "subtitle-package.json",
      JSON.stringify(shadow.subtitlePackage, null, 2) + "\n",
    ],
    ["subtitle.ass", shadow.ass],
    ["subtitle.srt", shadow.srt],
    ["subtitle.vtt", shadow.vtt],
  ])
    await writeFile(
      path.join(root, relative, c612Defined(name)),
      c612Defined(content),
      { flag: "wx" },
    );
  profiles.push({
    profileId,
    subtitlePackagePath: path.join(relative, "subtitle-package.json"),
    assPath: path.join(relative, "subtitle.ass"),
    srtPath: path.join(relative, "subtitle.srt"),
    vttPath: path.join(relative, "subtitle.vtt"),
    canonicalTextHash: c601CanonicalTextHash(shadow.cues),
    canonicalTimingHash: c601CanonicalTimingHash(shadow.cues),
    presentationHash: hash([shadow.ass, shadow.srt, shadow.vtt]),
    cueCount: shadow.cues.length,
    appliedEventIds: selections.map((s) => s.eventId).sort(),
    localOnly: true,
    finalizationMethod: "none",
  });
  for (const ranking of oof.rankings.rows.filter(
    (r) => r.profileId === profileId,
  )) {
    const selected = selections.find((s) => s.eventId === ranking.eventId),
      candidate = c612Defined(
        frozen.universe.candidates.find(
          (c) =>
            c.candidateId ===
            (selected?.candidateId ?? ranking.currentCandidateId),
        ),
      );
    ledger.push({
      profileId,
      eventId: ranking.eventId,
      candidateId: candidate.candidateId,
      status: selected ? "APPLIED_SHADOW_ONLY" : "KEPT_CURRENT",
      reasons: selected ? [] : ranking.reasons,
    });
    if (selected)
      provenance.push({
        profileId,
        eventId: ranking.eventId,
        candidateId: candidate.candidateId,
        candidateTextHash: hash(candidate.displayText),
        provenanceHash: candidate.provenanceHash,
        originalWholeCandidate: true,
      });
  }
}
const manifest = c612ShadowSchema.parse(
  artifact("machine-c6-1-2-shadow-output", {
    decisionHash: grouped.groupDecisions.semanticHash,
    profiles,
    productionTextMutation: 0,
    productionTimingMutation: 0,
    productionCueCountMutation: 0,
    oofArtifactsCreatedAfterTrainLabels: true,
  }),
);
await writeArtifact(dir, manifest);
await writeArtifact(
  dir,
  c612ApplicationSchema.parse(
    artifact("machine-c6-1-2-shadow-application-ledger", {
      rows: ledger,
      novelApplicationCount: 0,
      productionMutationCount: 0,
    }),
  ),
);
await writeArtifact(
  dir,
  c612ProvenanceSchema.parse(
    artifact("machine-c6-1-2-shadow-provenance", {
      universeHash: frozen.universe.semanticHash,
      rows: provenance,
      novelCandidateCount: 0,
    }),
  ),
);
const freeze = await freezeReranking(
  root,
  frozen.freeze.semanticHash,
  oof.models.semanticHash,
  oof.rankings.semanticHash,
  grouped.groupDecisions.semanticHash,
);
process.stdout.write(
  JSON.stringify({
    models: oof.models.models.length,
    predictions: oof.rankings.rows.length,
    configurations: grouped.configurations.rows.length,
    shadowProfiles: profiles.length,
    freezeHash: freeze.semanticHash,
    rawGoldRead: false,
  }) + "\n",
);
