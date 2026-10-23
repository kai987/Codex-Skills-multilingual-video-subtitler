export const c6011ArtifactHeader = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.1-machine-quality-recovery-v1" as const,
  generatedAt: "2026-08-27T00:00:00.000Z",
  mode: "enforce" as const,
  profile: "full" as const,
  run: {
    runId: "machine-quality-fixture",
    repositoryCommit: "a".repeat(40),
    sourceMediaSha256: "b".repeat(64),
    goldRuntimeInputCount: 0 as const,
  },
};

export const verifiedEvidenceQuality = {
  status: "verified" as const,
  inspectedArtifactCount: 1,
  schemaValidatedArtifactCount: 1,
  semanticEvidenceCount: 1,
  reasons: ["fixture-machine-evidence"],
};
