import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  asrRequestTimelineContractSchema,
  atomicWriteJson,
  c6012PolicyVersion,
  c6012QualityPolicySchema,
  machineAcousticEventFamiliesSchema,
  machineCrossWindowConsensusSchema,
  machineCueTimelineEvidenceSchema,
  machineGlobalTokenTimelineSchema,
  machineLexicalConservationSchema,
  machineOverlapEventClassificationSchema,
  machineTimingNonDegradationSchema,
  readJson,
  type CandidateConsensusMode,
  type GlobalTokenTimelineMode,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

async function subtitleDirectory(outputDirectory: string): Promise<string> {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const match = entries.find(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (match === undefined) {
    throw new Error(
      `No subtitle artifact directory found below ${outputDirectory}.`,
    );
  }
  return path.join(outputDirectory, match.name);
}

export async function emitCandidatePrecisionPolicyArtifact(input: {
  outputDirectory: string;
  candidateConsensus: CandidateConsensusMode;
  globalTokenTimeline: GlobalTokenTimelineMode;
  generatedAt?: string;
}): Promise<{ subtitleDirectory: string; policySemanticHash: string }> {
  const directory = await subtitleDirectory(input.outputDirectory);
  const artifacts = await Promise.all([
    readJson(path.join(directory, "machine-acoustic-event-families.json")).then(
      (value) => machineAcousticEventFamiliesSchema.parse(value),
    ),
    readJson(path.join(directory, "machine-cross-window-consensus.json")).then(
      (value) => machineCrossWindowConsensusSchema.parse(value),
    ),
    readJson(path.join(directory, "asr-request-timeline-contract.json")).then(
      (value) => asrRequestTimelineContractSchema.parse(value),
    ),
    readJson(path.join(directory, "machine-global-token-timeline.json")).then(
      (value) => machineGlobalTokenTimelineSchema.parse(value),
    ),
    readJson(path.join(directory, "machine-cue-timeline-evidence.json")).then(
      (value) => machineCueTimelineEvidenceSchema.parse(value),
    ),
    readJson(path.join(directory, "machine-timing-non-degradation.json")).then(
      (value) => machineTimingNonDegradationSchema.parse(value),
    ),
    readJson(path.join(directory, "machine-lexical-conservation.json")).then(
      (value) => machineLexicalConservationSchema.parse(value),
    ),
    readJson(
      path.join(directory, "machine-overlap-event-classification.json"),
    ).then((value) => machineOverlapEventClassificationSchema.parse(value)),
  ]);
  const policyPayload = {
    candidateConsensus: input.candidateConsensus,
    globalTokenTimeline: input.globalTokenTimeline,
    goldRuntimeInputCount: 0 as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyRelease: false as const,
    gates: {
      minimumCoverage: 0.9 as const,
      maximumMissing: 15 as const,
      maximumHallucinations: 2 as const,
      maximumMaterialErrors: 45 as const,
      maximumSevereTimingErrors: 30 as const,
      maximumStartMaeSeconds: 1.2 as const,
      maximumEndMaeSeconds: 1.2 as const,
      maximumP95BoundaryErrorSeconds: 3.5 as const,
      maximumNormalizedCer: 0.55 as const,
      maximumOverlapPairs: 20 as const,
    },
    artifactSemanticHashes: artifacts.map((artifact) =>
      machineQualitySemanticHash(artifact),
    ),
  };
  const policySemanticHash = machineQualitySemanticHash(policyPayload);
  const policy = c6012QualityPolicySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6012PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "c6-0-1-2-quality-policy",
    ...policyPayload,
    semanticHash: policySemanticHash,
  });
  await atomicWriteJson(
    path.join(directory, "c6-0-1-2-quality-policy.json"),
    policy,
  );
  return { subtitleDirectory: directory, policySemanticHash };
}
