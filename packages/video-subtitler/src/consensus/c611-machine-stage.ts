import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  c611BaselineSchema,
  c611LegacyControlSchema,
  c61ProfileSelectionsSchema,
  c61ShadowManifestSchema,
  c61ConsensusProfileFreezeSchema,
  machineMultiAsrHypothesisUniverseSchema,
  machineMultiAsrTokenLatticeSchema,
  subtitlePackageSchema,
  type C611CalibrationSample,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import {
  c601CanonicalTextHash as canonicalTextHash,
  c601CanonicalTimingHash as canonicalTimingHash,
} from "../blind-acceptance/gold-isolation.js";
import {
  loadC61MachineArtifacts,
  C61_MACHINE_ARTIFACT_FILES,
} from "./c61-artifact-adapter.js";
import { c61Json, c61FileHash } from "./c61-artifact-io.js";
import {
  buildC611MachineProposals,
  C611_MACHINE_POLICY_DESCRIPTOR,
} from "./existing-candidate-proposal.js";
import {
  freezeC611CalibrationPolicy,
  prepareC611CalibrationSamples,
} from "./selective-mbr-calibration.js";
import { buildC611Folds } from "./selective-mbr-folds.js";
import { C611_FIXED_ALIGNMENT_POLICY } from "./fixed-baseline-alignment-map.js";
import { C611_GROUPED_ORACLE_POLICY } from "./selective-mbr-oracles.js";
import { freezeC611Policy, C611_POLICY_VERSION } from "./c611-policy.js";
import { assembleC611ExistingShadow } from "./selective-mbr-shadow-assembly.js";

/** Explicit machine-only entry point. No Gold path argument or evaluation reader. */
export async function buildC611MachineStage(input: {
  task: string;
  previous: string;
  baselineFile: string;
  reverse?: boolean;
}) {
  const baseline = c611BaselineSchema.parse(await c61Json(input.baselineFile));
  if (!baseline.baselineReplayPassed)
    throw new Error("C611_BASELINE_NOT_PASSED");
  const machine = await loadC61MachineArtifacts(input.task);
  const metadataArtifacts: Record<string, unknown> = {};
  for (const name of C61_MACHINE_ARTIFACT_FILES)
    if (machine.sourceArtifactHashes[name]) {
      const file = path.join(machine.taskDirectory, name);
      if ((await c61FileHash(file)) !== machine.sourceArtifactHashes[name])
        throw new Error("C611_MACHINE_METADATA_INPUT_CHANGED");
      metadataArtifacts[name] = await c61Json(file);
    }
  const universe = machineMultiAsrHypothesisUniverseSchema.parse(
    await c61Json(
      path.join(input.previous, "machine-multi-asr-hypothesis-universe.json"),
    ),
  );
  const production = subtitlePackageSchema.parse(
    await c61Json(
      path.join(input.previous, "subtitle-package.production.json"),
    ),
  );
  if (
    universe.semanticHash !== baseline.candidateUniverseHash ||
    canonicalTextHash(production.cues) !== baseline.canonicalTextHash ||
    canonicalTimingHash(production.cues) !== baseline.canonicalTimingHash
  )
    throw new Error("C611_BASELINE_BINDING_CHANGED");
  const allLattices = machineMultiAsrTokenLatticeSchema.parse(
    await c61Json(
      path.join(input.previous, "machine-multi-asr-token-lattice.json"),
    ),
  );
  const selections = c61ProfileSelectionsSchema.parse(
    await c61Json(path.join(input.previous, "c6-1-profile-selections.json")),
  );
  const legacyPolicy = c61ConsensusProfileFreezeSchema.parse(
    await c61Json(
      path.join(input.previous, "c6-1-consensus-profile-freeze.json"),
    ),
  );
  const inputHashes = { ...baseline.inputHashes };
  for (const name of [
    "machine-multi-asr-hypothesis-universe.json",
    "machine-multi-asr-token-lattice.json",
    "c6-1-profile-selections.json",
    "c6-1-shadow-manifest.json",
    "subtitle-package.production.json",
    "c6-1-consensus-profile-freeze.json",
  ])
    inputHashes[`c61/${name}`] = await c61FileHash(
      path.join(input.previous, name),
    );
  const oldManifest = c61ShadowManifestSchema.parse(
    await c61Json(path.join(input.previous, "c6-1-shadow-manifest.json")),
  );
  const p6 = oldManifest.profiles.find((p) => p.profileId === "P6");
  if (!p6) throw new Error("C611_LEGACY_P6_MISSING");
  const p0Paths = selections.paths.filter((p) => p.profileId === "P0");
  const lattices = allLattices.lattices.filter((l) =>
    p0Paths.some(
      (p) => p.eventId === l.eventId && p.latticeHash === l.semanticHash,
    ),
  );
  const stage = buildC611MachineProposals({
    universe,
    machine: input.reverse
      ? {
          ...machine,
          events: [...machine.events].reverse(),
          candidates: [...machine.candidates].reverse(),
        }
      : machine,
    productionPackage: production,
    metadataArtifacts,
  });
  const samples = prepareC611CalibrationSamples(
    stage.proposals.records,
    stage.features.rows,
  );
  const applied = new Set(
    p6.assemblyDecisions
      .filter((d) => d.status === "APPLIED_SHADOW_ONLY")
      .map((d) => d.eventId),
  );
  const legacySamples: C611CalibrationSample[] = samples.map((sample) => {
    const legacy = selections.paths.find(
      (p) => p.profileId === "P6" && p.eventId === sample.eventId,
    );
    const candidate = legacy?.path
      ? universe.candidates
          .filter(
            (c) =>
              c.eventId === sample.eventId &&
              c.inclusionStatus === "INCLUDED" &&
              c.providerFamily !== "CURRENT" &&
              legacy.path?.sourceCandidateIds.includes(c.candidateId) &&
              c.displayText === legacy.path.displayText,
          )
          .sort((a, b) => a.candidateId.localeCompare(b.candidateId))[0]
      : undefined;
    if (applied.has(sample.eventId) && !candidate)
      throw new Error("C611_LEGACY_P6_NOT_WHOLE_EXISTING_CANDIDATE");
    const fields = {
      ...sample,
      proposalId: `legacy-p6:${sample.eventId}`,
      proposedCandidateId: applied.has(sample.eventId)
        ? (candidate?.candidateId ?? null)
        : null,
      eligibilityStatus: applied.has(sample.eventId)
        ? ("ELIGIBLE" as const)
        : ("NO_ALTERNATIVE" as const),
    };
    return {
      ...fields,
      proposalHash: hash({
        eventId: fields.eventId,
        candidateId: fields.proposedCandidateId,
        selected: applied.has(sample.eventId),
        sourceManifestHash: oldManifest.semanticHash,
      }),
      featureHash: hash({
        purpose: "S1_LEGACY_NO_PREDICTOR",
        sourceFeatureHash: sample.featureHash,
      }),
    };
  });
  const legacyShadow = assembleC611ExistingShadow({
    profileId: "S1",
    production,
    universe,
    lattices,
    selections: legacySamples.map((s) => ({
      eventId: s.eventId,
      candidateId: s.proposedCandidateId,
      selected: applied.has(s.eventId),
    })),
  });
  if (
    legacyShadow.blockedRequestedEventIds.length ||
    canonicalTextHash(legacyShadow.subtitlePackage.cues) !==
      p6.canonicalTextHash ||
    canonicalTimingHash(legacyShadow.subtitlePackage.cues) !==
      p6.canonicalTimingHash
  )
    throw new Error("C611_ACTUAL_P6_REPRODUCTION_FAILED");
  const legacyBody = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-legacy-p6-control" as const,
    originalManifestHash: oldManifest.semanticHash,
    originalSelectionsHash: selections.semanticHash,
    samples: legacySamples,
    selectedProposalIds: legacySamples
      .filter((s) => applied.has(s.eventId))
      .map((s) => s.proposalId)
      .sort(),
    originalCanonicalTextHash: p6.canonicalTextHash,
    reproducedCanonicalTextHash: canonicalTextHash(
      legacyShadow.subtitlePackage.cues,
    ),
    canonicalTextParity: true as const,
    canonicalTimingParity: true as const,
    runtimeGoldInputCount: 0 as const,
  };
  const legacy = c611LegacyControlSchema.parse({
    ...legacyBody,
    semanticHash: hash(legacyBody),
  });
  const calibrationPolicy = freezeC611CalibrationPolicy();
  const units = stage.proposals.records.map((p) => ({
    eventId: p.eventId,
    proposalId: p.proposalId,
    sourceAudioIdentity: p.sourceAudioIdentity,
    sourceInterval: p.sourceInterval,
    acousticIntervals: p.acousticIntervals,
    cueIntervals: production.cues
      .filter((c) => p.finalCueIds.includes(c.id))
      .map((c) => ({ start: c.start, end: c.end })),
    finalCueIds: p.finalCueIds,
    sharedSpanKeys: p.spanApplication
      ? [
          `${p.spanApplication.finalCueId}:${p.spanApplication.spanStart}:${p.spanApplication.spanEnd}`,
        ]
      : [],
  }));
  const folds = buildC611Folds(
    input.reverse ? [...units].reverse() : units,
    calibrationPolicy,
  );
  const policy = freezeC611Policy({
    fixedAlignment: C611_FIXED_ALIGNMENT_POLICY,
    machine: C611_MACHINE_POLICY_DESCRIPTOR,
    calibration: calibrationPolicy,
    oracle: C611_GROUPED_ORACLE_POLICY,
  });
  return {
    ...stage,
    universe,
    production,
    lattices,
    baseline,
    legacy,
    samples,
    folds,
    calibrationPolicy,
    policy,
    legacyPolicy,
    inputHashes,
  };
}
export type C611MachineStage = Awaited<
  ReturnType<typeof buildC611MachineStage>
>;
export async function writeC611MachineStage(
  root: string,
  stage: C611MachineStage,
) {
  await mkdir(root, { recursive: false });
  const artifacts = [
    stage.baseline,
    stage.correlationGroups,
    stage.correlationAudit,
    stage.riskLedger,
    stage.proposals,
    stage.completeness,
    stage.features,
    stage.folds,
    stage.calibrationPolicy,
    stage.policy,
    stage.legacy,
    stage.legacyPolicy,
  ];
  for (const artifact of artifacts)
    await atomicWriteJson(
      path.join(root, `${artifact.artifactType}.json`),
      artifact,
    );
  await atomicWriteJson(
    path.join(root, "subtitle-package.production.json"),
    stage.production,
  );
  return artifacts.map((a) => ({
    artifactType: a.artifactType,
    semanticHash: a.semanticHash,
  }));
}
