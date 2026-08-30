import { describe, expect, it } from "vitest";
import { z } from "zod";
import { c611GeneratedSchemas, c61GeneratedSchemas } from "@mvl/shared";
import * as machine from "../packages/shared/src/c6-1-1-machine-schemas.js";
import * as calibration from "../packages/shared/src/c6-1-1-calibration-schemas.js";
import * as evaluation from "../packages/shared/src/c6-1-1-evaluation-schemas.js";
import * as io from "../packages/shared/src/c6-1-1-io-schemas.js";
import * as route from "../packages/shared/src/c6-1-1-route-schemas.js";
import * as diagnostic from "../packages/shared/src/c6-1-1-diagnostic-schemas.js";
import * as validationSchemas from "../packages/shared/src/c6-1-1-validation-schemas.js";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { freezeC611Policy } from "../packages/video-subtitler/src/consensus/c611-policy.js";
import { C611_FIXED_ALIGNMENT_POLICY } from "../packages/video-subtitler/src/consensus/fixed-baseline-alignment-map.js";
import { freezeC611CalibrationPolicy } from "../packages/video-subtitler/src/consensus/selective-mbr-calibration.js";
import { C611_GROUPED_ORACLE_POLICY } from "../packages/video-subtitler/src/consensus/selective-mbr-oracles.js";

const sha = hash("synthetic-contract"),
  timestamp = "2026-01-01T00:00:00.000Z";
const header = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.1.1-fixed-alignment-selective-existing-mbr-v1",
  semanticHash: sha,
};
const fingerprint = { size: 10, mtimeMs: 1, sha256: sha };
const file = { relativePath: "synthetic/file.json", sha256: sha, size: 10 };
const metrics = {
  exactCer: 0,
  normalizedCer: 0,
  coverage: 1,
  missing: 0,
  hallucination: 0,
  materialErrors: 0,
  cueCount: 1,
  severeTiming: 0,
  startMae: 0,
  endMae: 0,
  boundaryP95: 0,
  medianIoU: 1,
  overlap: 0,
};
function baseline() {
  return io.c611BaselineSchema.parse({
    ...header,
    artifactType: "c6-1-1-baseline",
    acceptanceCommit: "a".repeat(40),
    baselineBranch: "synthetic-branch",
    c61MachineFreezeHash: sha,
    sourceBefore: fingerprint,
    productionFiles: [file],
    canonicalTextHash: sha,
    canonicalTimingHash: sha,
    candidateUniverseHash: sha,
    inputHashes: { input: sha },
    officialArtifactHashes: { official: sha },
    candidateCounts: { included: 1 },
    baselineMetrics: metrics,
    legacyP6Metrics: metrics,
    legacyEventEvaluation: {
      evaluable: 1,
      changed: 0,
      improved: 0,
      regressed: 0,
      neutral: 1,
      unevaluable: 0,
      renderedChangedCues: 0,
    },
    legacyOracle: {
      currentError: 0,
      bestExistingError: 0,
      bestLegalError: 0,
      unrestrictedError: 0,
      candidateOracleGain: 0,
    },
    pairwiseCount: 1,
    checks: [{ name: "synthetic", passed: true, observed: "1", expected: "1" }],
    baselineReplayPassed: true,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
    networkUsed: false,
    newAsrInferenceCount: 0,
    goldFileOpened: false,
  });
}
function policy() {
  return freezeC611Policy({
    fixedAlignment: C611_FIXED_ALIGNMENT_POLICY,
    machine: { syntheticMachinePolicy: true },
    calibration: freezeC611CalibrationPolicy(),
    oracle: C611_GROUPED_ORACLE_POLICY,
  });
}
function freeze() {
  return io.c611MachineFeatureFreezeSchema.parse({
    ...header,
    artifactType: "c6-1-1-machine-feature-freeze",
    runtimeNodeVersion: "v24.0.0",
    sharedSourceEntry: "packages/shared/src/index.ts",
    runtimeSourceExecutionVerified: true,
    frozenAt: timestamp,
    proposalHash: sha,
    featureSchemaHash: sha,
    featureTableHash: sha,
    candidateUniverseHash: sha,
    correlationPolicyHash: sha,
    riskPolicyHash: sha,
    foldHash: sha,
    policyHash: sha,
    baselineHash: sha,
    machineFiles: [file],
    machineAggregateHash: sha,
    sourceCodeFiles: [file],
    sourceCodeAggregateHash: sha,
    inputHashes: { input: sha },
    frozenBeforeGold: true,
    aBMachineParity: true,
    runtimeGoldInputCount: 0,
    newAsrInferenceCount: 0,
    networkUsed: false,
  });
}
function readOnly() {
  return io.c611ReadOnlyProofSchema.parse({
    ...header,
    artifactType: "c6-1-1-read-only-proof",
    machineFreezeHash: sha,
    frozenAt: timestamp,
    goldFirstReadAt: "2026-01-01T00:00:01.000Z",
    sourceBefore: fingerprint,
    sourceAfter: fingerprint,
    goldBefore: fingerprint,
    goldAfter: fingerprint,
    sourceUnchanged: true,
    goldUnchanged: true,
    productionUnchanged: true,
    productionFiles: [file],
    runtimeCodeUnchanged: true,
    freshWhisperInferences: 0,
    freshReazonInferences: 0,
    freshCtcInferences: 0,
    networkUsed: false,
  });
}
function validation() {
  return io.c611ValidationSchema.parse({
    ...header,
    artifactType: "c6-1-1-validation",
    checks: [],
    engineeringPassed: false,
    schemaInstanceCount: 0,
    generatedSchemaCount: 0,
    aBMachineParity: false,
    aBEvaluationParity: false,
    aBOutputParity: false,
    productionTextMutation: 0,
    productionTimingMutation: 0,
    regressionEvidenceHash: null,
    validatorRawSourceRechecked: false,
    validatorRawGoldRechecked: false,
    qualityGateStatus: "SYNTHETIC_NOT_ASSESSED",
    sourceReadOnly: true,
    goldReadOnly: true,
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
  });
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function jsonArtifactName(schema: z.ZodType): unknown {
  const generated = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  });
  return object(object(generated.properties).artifactType).const;
}

describe("C6.1.1 complete standalone artifact registry", () => {
  it("registers every exported top-level artifact contract exactly once", () => {
    const exported = [
      machine,
      calibration,
      evaluation,
      io,
      route,
      diagnostic,
      validationSchemas,
    ].flatMap((module) =>
      Object.values(module).flatMap((value) =>
        value instanceof z.ZodType
          ? typeof jsonArtifactName(value) === "string"
            ? [jsonArtifactName(value)]
            : []
          : [],
      ),
    );
    const names = c611GeneratedSchemas.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(exported.sort());
    expect(
      new Set([...c61GeneratedSchemas.map(([name]) => name), ...names]).size,
    ).toBe(c61GeneratedSchemas.length + names.length);
  });
  it.each(c611GeneratedSchemas)(
    "generates strict Draft2020-12 contract for %s",
    (name, schema) => {
      const generated = z.toJSONSchema(schema, {
        target: "draft-2020-12",
        unrepresentable: "any",
      });
      expect(generated.type).toBe("object");
      expect(generated.additionalProperties).toBe(false);
      expect(jsonArtifactName(schema)).toBe(name);
      expect(generated.required).toContain("semanticHash");
      expect(object(object(generated.properties).policyVersion).const).toBe(
        "c6.1.1-fixed-alignment-selective-existing-mbr-v1",
      );
    },
  );
});

describe("C6.1.1 root IO and freeze strict contracts", () => {
  it("validates synthetic IO instances and rejects unknown top-level fields", () => {
    const instances: [z.ZodType, object][] = [
      [io.c611BaselineSchema, baseline()],
      [io.c611PolicyFreezeSchema, policy()],
      [io.c611MachineFeatureFreezeSchema, freeze()],
      [io.c611ReadOnlyProofSchema, readOnly()],
      [io.c611ValidationSchema, validation()],
    ];
    for (const [schema, value] of instances) {
      expect(schema.safeParse(value).success).toBe(true);
      expect(
        schema.safeParse({ ...value, goldHint: "synthetic forbidden" }).success,
      ).toBe(false);
      expect(
        schema.safeParse({ ...value, semanticHash: "not-a-hash" }).success,
      ).toBe(false);
    }
  });
  it("rejects unknown nested fingerprint, metric, evidence and file fields", () => {
    expect(
      io.c611BaselineSchema.safeParse({
        ...baseline(),
        sourceBefore: { ...fingerprint, absolutePath: "/synthetic/source" },
      }).success,
    ).toBe(false);
    expect(
      io.c611BaselineSchema.safeParse({
        ...baseline(),
        baselineMetrics: { ...metrics, goldText: "synthetic" },
      }).success,
    ).toBe(false);
    expect(
      io.c611BaselineSchema.safeParse({
        ...baseline(),
        checks: [
          {
            name: "x",
            passed: true,
            observed: "1",
            expected: "1",
            unchecked: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      io.c611MachineFeatureFreezeSchema.safeParse({
        ...freeze(),
        machineFiles: [{ ...file, secret: "synthetic" }],
      }).success,
    ).toBe(false);
  });
  it("keeps release authorization held even when a validation artifact passes", () => {
    const valid = { ...validation(), engineeringPassed: true };
    expect(io.c611ValidationSchema.safeParse(valid).success).toBe(true);
    expect(
      io.c611ValidationSchema.safeParse({
        ...valid,
        machineOnlyReleaseAuthorized: true,
      }).success,
    ).toBe(false);
    expect(
      io.c611ValidationSchema.safeParse({ ...valid, c602Status: "GO" }).success,
    ).toBe(false);
    expect(
      io.c611BaselineSchema.safeParse({
        ...baseline(),
        productionStatus: "finalized",
      }).success,
    ).toBe(false);
    expect(
      io.c611BaselineSchema.safeParse({
        ...baseline(),
        finalizationMethod: "automatic",
      }).success,
    ).toBe(false);
  });
  it("pins no-Gold no-model no-network literals in the machine freeze", () => {
    for (const [key, value] of Object.entries({
      runtimeGoldInputCount: 1,
      newAsrInferenceCount: 1,
      networkUsed: true,
      frozenBeforeGold: false,
      aBMachineParity: false,
    })) {
      expect(
        io.c611MachineFeatureFreezeSchema.safeParse({
          ...freeze(),
          [key]: value,
        }).success,
      ).toBe(false);
    }
    expect(
      io.c611MachineFeatureFreezeSchema.safeParse({
        ...freeze(),
        frozenAt: "not-a-date",
      }).success,
    ).toBe(false);
    expect(
      io.c611BaselineSchema.safeParse({ ...baseline(), goldFileOpened: true })
        .success,
    ).toBe(false);
    expect(
      io.c611ReadOnlyProofSchema.safeParse({
        ...readOnly(),
        freshCtcInferences: 1,
      }).success,
    ).toBe(false);
  });
  it("cannot weaken the pre-frozen thresholds or enable novel/profile rematching", () => {
    for (const key of [
      "currentIsProviderVote",
      "novelApplicationAllowed",
      "productionMutationAllowed",
      "profileRematchingAllowed",
      "testFoldThresholdTuningAllowed",
    ]) {
      expect(
        io.c611PolicyFreezeSchema.safeParse({ ...policy(), [key]: true })
          .success,
      ).toBe(false);
    }
    expect(
      io.c611PolicyFreezeSchema.safeParse({
        ...policy(),
        strongGate: { ...policy().strongGate, minimumSelected: 1 },
      }).success,
    ).toBe(false);
    expect(
      io.c611PolicyFreezeSchema.safeParse({
        ...policy(),
        promisingGate: { ...policy().promisingGate, minimumPrecision: 0.5 },
      }).success,
    ).toBe(false);
  });
  it("rejects negative/nonfinite counts and absolute or traversal file references", () => {
    expect(
      io.c611FingerprintSchema.safeParse({
        ...fingerprint,
        mtimeMs: Number.NaN,
      }).success,
    ).toBe(false);
    expect(
      io.c611FingerprintSchema.safeParse({ ...fingerprint, size: -1 }).success,
    ).toBe(false);
    expect(
      io.c611ValidationSchema.safeParse({
        ...validation(),
        schemaInstanceCount: Infinity,
      }).success,
    ).toBe(false);
    for (const relativePath of [
      "/synthetic/private.json",
      "../synthetic.json",
      "C:\\synthetic.json",
      "folder/../../file.json",
      "bad\0file.json",
    ]) {
      expect(
        io.c611MachineFeatureFreezeSchema.safeParse({
          ...freeze(),
          machineFiles: [{ ...file, relativePath }],
        }).success,
      ).toBe(false);
    }
  });
  it("records failed checks truthfully without a schema that forces passed booleans", () => {
    const result = validation();
    expect(result.engineeringPassed).toBe(false);
    expect(
      io.c611ReadOnlyProofSchema.safeParse({
        ...readOnly(),
        sourceUnchanged: false,
        goldUnchanged: false,
        productionUnchanged: false,
        runtimeCodeUnchanged: false,
      }).success,
    ).toBe(true);
  });
});
