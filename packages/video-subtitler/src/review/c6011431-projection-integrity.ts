import {
  baselineHashFailure1431Schema,
  c601141PhysicalAudioSchema,
  c60114CoveragePhysicalAudioSchema,
  c60114CoveragePlaybackSegmentSchema,
  nestedPreflight1431Schema,
  projectionChangeAudit1431Schema,
  projectionIntegrityPolicy1431Schema,
  projectionRebindingLedger1431Schema,
  type BaselineHashFailure1431,
  type C60114MachineCoverageProjection,
  type NestedPreflight1431,
  type ProjectionChangeAudit1431,
  type ProjectionRebindingLedger1431,
  type Projections143,
} from "@mvl/shared";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
} from "./c601141-policy.js";

export const C6011431_POLICY_VERSION =
  "c6.0.1.14.3.1-projection-hash-integrity-v1" as const;

export function projectionIntegrityPolicy1431() {
  return projectionIntegrityPolicy1431Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: C6011431_POLICY_VERSION,
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-3-1-projection-integrity-policy",
      executionPolicy: "replay-only",
      sourceDomain: "SOURCE_WORKSPACE_AUDIO_ROW",
      projectedDomain: "STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW",
      requiredOperationOrder: [
        "ASSERT_SOURCE_HASH",
        "PROJECT_FIELDS",
        "REMOVE_OLD_SEMANTIC_HASH",
        "COMPUTE_CANONICAL_PROJECTED_HASH",
        "STRICT_SCHEMA_PARSE",
        "ASSERT_PROJECTED_HASH",
      ],
      canonicalHashHelper: "hashed141",
      preGoldNestedPreflightRequired: true,
      unknownHashableRowFailsClosed: true,
      maximumInferenceCount: 0,
      maximumModelLoadCount: 0,
      maximumProviderProcessStartCount: 0,
      canonicalMutationAllowed: false,
    }),
  );
}

type SourceAudioRow = Parameters<typeof c601141PhysicalAudioSchema.parse>[0];
type ParsedSourceAudioRow = ReturnType<typeof c601141PhysicalAudioSchema.parse>;
type ProjectedAudioRow = ReturnType<
  typeof c60114CoveragePhysicalAudioSchema.parse
>;

function expectedHash1431(value: { semanticHash?: string }) {
  const { semanticHash: _old, ...core } = value;
  void _old;
  return hash141(core);
}

/**
 * Crosses the source-workspace -> strict-coverage hash-domain boundary.
 * The operation order is intentionally explicit and mirrors the persisted
 * integrity policy. Do not collapse it into a spread that retains the source
 * row's semanticHash.
 */
export function rebindCoverageAudio1431(
  input: SourceAudioRow,
): ProjectedAudioRow {
  const source = c601141PhysicalAudioSchema.parse(input);
  assertHash141(source);
  const {
    nativeSourceInterval: _nativeSourceInterval,
    semanticHash: _sourceSemanticHash,
    ...projectedCore
  } = source;
  void _nativeSourceInterval;
  void _sourceSemanticHash;
  const rebound = hashed141(projectedCore);
  const projected = c60114CoveragePhysicalAudioSchema.parse(rebound);
  assertHash141(projected);
  return projected;
}

export function buildProjectionRebindingLedger1431(input: {
  sourceRows: readonly ParsedSourceAudioRow[];
  projectedRows: readonly ProjectedAudioRow[];
  sourceIdentity: ParsedSourceAudioRow["sourceIdentity"];
}): ProjectionRebindingLedger1431 {
  const projectedById = new Map(
    input.projectedRows.map((row) => [row.audioId, row] as const),
  );
  if (projectedById.size !== input.projectedRows.length)
    throw new Error("C6011431_DUPLICATE_PROJECTED_AUDIO_ID");
  const entries = input.sourceRows.map((sourceInput) => {
    const source = c601141PhysicalAudioSchema.parse(sourceInput);
    assertHash141(source);
    const projected = required141(
      projectedById.get(source.audioId),
      `C6011431_PROJECTED_AUDIO_MISSING:${source.audioId}`,
    );
    c60114CoveragePhysicalAudioSchema.parse(projected);
    assertHash141(projected);
    if (source.semanticHash === projected.semanticHash)
      throw new Error(`C6011431_HASH_DOMAIN_NOT_REBOUND:${source.audioId}`);
    const rebuilt = rebindCoverageAudio1431(source);
    if (hash141(rebuilt) !== hash141(projected))
      throw new Error(
        `C6011431_PROJECTED_AUDIO_CONTENT_CHANGED:${source.audioId}`,
      );
    return {
      audioId: source.audioId,
      sourceDomain: "SOURCE_WORKSPACE_AUDIO_ROW" as const,
      projectedDomain: "STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW" as const,
      sourceSemanticHash: source.semanticHash,
      projectedSemanticHash: projected.semanticHash,
      sourceHashValid: true as const,
      projectedHashValid: true as const,
      projectedSchemaValid: true as const,
      hashDomainRebound: true as const,
      removedFields: ["nativeSourceInterval"] as const,
      audioByteHashPreserved: (source.sha256 === projected.sha256) as true,
      physicalMetadataPreserved: (source.frameCount === projected.frameCount &&
        source.sampleRate === projected.sampleRate &&
        source.channels === projected.channels &&
        source.actualDuration === projected.actualDuration) as true,
    };
  });
  if (
    entries.some(
      (row) => !row.audioByteHashPreserved || !row.physicalMetadataPreserved,
    )
  )
    throw new Error("C6011431_PROJECTED_PHYSICAL_METADATA_CHANGED");
  return projectionRebindingLedger1431Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: C6011431_POLICY_VERSION,
      visibility: "LOCAL_ONLY",
      artifactType: "machine-projection-hash-rebinding-ledger",
      sourceIdentity: input.sourceIdentity,
      entries,
      sourceRowCount: entries.length,
      projectedRowCount: input.projectedRows.length,
      reboundRowCount: entries.length,
      sourceHashesValid: entries.length,
      projectedHashesValid: entries.length,
      projectedSchemasValid: entries.length,
      failureCount: 0,
      inferenceCount: 0,
      goldInputCount: 0,
    }),
  );
}

function failure1431(input: {
  code: NestedPreflight1431["failures"][number]["code"];
  path: string;
  domain: NestedPreflight1431["failures"][number]["domain"];
  expectedHash?: string | null;
  actualHash?: string | null;
}) {
  return {
    ...input,
    expectedHash: input.expectedHash ?? null,
    actualHash: input.actualHash ?? null,
  };
}

export function reproduceBaselineHashFailure1431(input: {
  sourceRows: readonly ParsedSourceAudioRow[];
  projections: Projections143;
}): BaselineHashFailure1431 {
  const official = required141(
    input.projections.variants.find((row) => row.stage === "A7"),
  );
  let sourceValid = 0;
  for (const source of input.sourceRows) {
    c601141PhysicalAudioSchema.parse(source);
    if (expectedHash1431(source) === source.semanticHash) sourceValid++;
  }
  let projectedValid = 0;
  let stale = 0;
  const failures: BaselineHashFailure1431["failures"] = [];
  const sourceById = new Map(input.sourceRows.map((row) => [row.audioId, row]));
  for (
    let index = 0;
    index < official.projection.physicalAudio.length;
    index++
  ) {
    const row = required141(official.projection.physicalAudio[index]);
    const expected = expectedHash1431(row);
    if (expected === row.semanticHash) projectedValid++;
    else {
      const source = sourceById.get(row.audioId);
      if (source?.semanticHash === row.semanticHash) stale++;
      failures.push(
        failure1431({
          code:
            source?.semanticHash === row.semanticHash
              ? "PROJECTED_ROW_HASH_STALE"
              : "NESTED_ROW_HASH_INVALID",
          path: `variants.A7.projection.physicalAudio[${index}]`,
          domain: "STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW",
          expectedHash: expected,
          actualHash: row.semanticHash,
        }),
      );
    }
  }
  let playbackValid = 0;
  for (const row of official.projection.playbackSegments)
    if (expectedHash1431(row) === row.semanticHash) playbackValid++;
  const affectedStages = input.projections.variants
    .filter((variant) =>
      variant.projection.physicalAudio.some(
        (row) => expectedHash1431(row) !== row.semanticHash,
      ),
    )
    .map((variant) => variant.stage);
  return baselineHashFailure1431Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: C6011431_POLICY_VERSION,
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-3-1-baseline-hash-failure-reproduction",
      sourceIdentity: input.projections.sourceIdentity,
      sourceWorkspaceAudioRows: input.sourceRows.length,
      sourceWorkspaceAudioHashesValid: sourceValid,
      strictProjectedAudioRows: official.projection.physicalAudio.length,
      staleProjectedAudioHashReuseCount: stale,
      strictProjectedAudioHashesValid: projectedValid,
      playbackRows: official.projection.playbackSegments.length,
      playbackHashesValid: playbackValid,
      affectedStages,
      reproduced:
        stale > 0 && projectedValid < official.projection.physicalAudio.length,
      failures,
      goldReadAttempted: false,
      inferenceCount: 0,
    }),
  );
}

function unknownHashableRows1431(
  value: unknown,
  knownPaths: ReadonlySet<string>,
  path = "$",
): string[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const failures =
    typeof row.semanticHash === "string" && !knownPaths.has(path) ? [path] : [];
  if (Array.isArray(value))
    return value.reduce<string[]>(
      (all, child, index) => [
        ...all,
        ...unknownHashableRows1431(child, knownPaths, `${path}[${index}]`),
      ],
      failures,
    );
  return Object.entries(row).reduce<string[]>(
    (all, [key, child]) => [
      ...all,
      ...unknownHashableRows1431(child, knownPaths, `${path}.${key}`),
    ],
    failures,
  );
}

export function preflightNestedSemanticIntegrity1431(
  projections: Projections143,
): NestedPreflight1431 {
  const failures: NestedPreflight1431["failures"] = [];
  let validOuter = 0;
  const expectedRoot = expectedHash1431(projections);
  if (expectedRoot === projections.semanticHash) validOuter++;
  else
    failures.push(
      failure1431({
        code: "NESTED_ROW_HASH_INVALID",
        path: "$",
        domain: "C601143_PROJECTION_SET",
        expectedHash: expectedRoot,
        actualHash: projections.semanticHash,
      }),
    );
  for (let index = 0; index < projections.variants.length; index++) {
    const variant = required141(projections.variants[index]);
    const expected = expectedHash1431(variant);
    if (expected === variant.semanticHash) validOuter++;
    else
      failures.push(
        failure1431({
          code: "NESTED_ROW_HASH_INVALID",
          path: `$.variants[${index}]`,
          domain: "C601143_PROJECTION_VARIANT",
          expectedHash: expected,
          actualHash: variant.semanticHash,
        }),
      );
  }
  const officialIndex = projections.variants.findIndex(
    (variant) => variant.stage === projections.officialStage,
  );
  const official = required141(projections.variants[officialIndex]);
  let validAudio = 0;
  for (
    let index = 0;
    index < official.projection.physicalAudio.length;
    index++
  ) {
    const row = required141(official.projection.physicalAudio[index]);
    const path = `$.variants[${officialIndex}].projection.physicalAudio[${index}]`;
    const parsed = c60114CoveragePhysicalAudioSchema.safeParse(row);
    if (!parsed.success) {
      failures.push(
        failure1431({
          code: "PROJECTED_ROW_SCHEMA_INVALID",
          path,
          domain: "STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW",
          actualHash: row.semanticHash,
        }),
      );
      continue;
    }
    const expected = expectedHash1431(row);
    if (!row.semanticHash)
      failures.push(
        failure1431({
          code: "PROJECTED_ROW_HASH_MISSING",
          path,
          domain: "STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW",
          expectedHash: expected,
        }),
      );
    else if (expected !== row.semanticHash)
      failures.push(
        failure1431({
          code: "NESTED_ROW_HASH_INVALID",
          path,
          domain: "STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW",
          expectedHash: expected,
          actualHash: row.semanticHash,
        }),
      );
    else validAudio++;
  }
  let validPlayback = 0;
  for (
    let index = 0;
    index < official.projection.playbackSegments.length;
    index++
  ) {
    const row = required141(official.projection.playbackSegments[index]);
    const path = `$.variants[${officialIndex}].projection.playbackSegments[${index}]`;
    const parsed = c60114CoveragePlaybackSegmentSchema.safeParse(row);
    const expected = expectedHash1431(row);
    if (!parsed.success || expected !== row.semanticHash)
      failures.push(
        failure1431({
          code: !parsed.success
            ? "PROJECTED_ROW_SCHEMA_INVALID"
            : "NESTED_ROW_HASH_INVALID",
          path,
          domain: "STRICT_C601143_COVERAGE_PLAYBACK_PROJECTION_ROW",
          expectedHash: expected,
          actualHash: row.semanticHash,
        }),
      );
    else validPlayback++;
  }
  const knownPaths = new Set<string>([
    "$",
    ...projections.variants.map((_, index) => `$.variants[${index}]`),
    ...official.projection.physicalAudio.map(
      (_, index) =>
        `$.variants[${officialIndex}].projection.physicalAudio[${index}]`,
    ),
    ...official.projection.playbackSegments.map(
      (_, index) =>
        `$.variants[${officialIndex}].projection.playbackSegments[${index}]`,
    ),
  ]);
  // Unknown-row discovery is scoped to the official strict projection plus
  // its containing envelopes. Other variants are checked through their outer
  // hashes and use the same A4-A7 final row instances.
  const unknown = unknownHashableRows1431(
    {
      semanticHash: projections.semanticHash,
      variant: {
        semanticHash: official.semanticHash,
        projection: official.projection,
      },
    },
    new Set([
      "$",
      "$.variant",
      ...official.projection.physicalAudio.map(
        (_, index) => `$.variant.projection.physicalAudio[${index}]`,
      ),
      ...official.projection.playbackSegments.map(
        (_, index) => `$.variant.projection.playbackSegments[${index}]`,
      ),
    ]),
  );
  void knownPaths;
  for (const path of unknown)
    failures.push(
      failure1431({
        code: "UNKNOWN_HASHABLE_ROW_TYPE",
        path,
        domain: null,
      }),
    );
  const nestedFailures = failures.some((row) =>
    [
      "NESTED_ROW_HASH_INVALID",
      "PROJECTED_ROW_HASH_MISSING",
      "PROJECTED_ROW_SCHEMA_INVALID",
    ].includes(row.code),
  );
  if (expectedRoot === projections.semanticHash && nestedFailures)
    failures.push(
      failure1431({
        code: "OUTER_HASH_VALID_NESTED_HASH_INVALID",
        path: "$",
        domain: "C601143_PROJECTION_SET",
        expectedHash: expectedRoot,
        actualHash: projections.semanticHash,
      }),
    );
  return nestedPreflight1431Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: C6011431_POLICY_VERSION,
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-3-1-nested-semantic-integrity-preflight",
      scope: "PRE_GOLD_MACHINE_FREEZE",
      projectionSetHash: projections.semanticHash,
      sourceIdentity: projections.sourceIdentity,
      projectionVariantCount: projections.variants.length,
      inspectedOuterHashCount: projections.variants.length + 1,
      validOuterHashCount: validOuter,
      projectedAudioRowCount: official.projection.physicalAudio.length,
      validProjectedAudioHashCount: validAudio,
      playbackRowCount: official.projection.playbackSegments.length,
      validPlaybackHashCount: validPlayback,
      unknownHashableRowCount: unknown.length,
      failures,
      integrityPassed: failures.length === 0,
      goldReadAttempted: false,
      inferenceCount: 0,
    }),
  );
}

export function assertPreGoldIntegrity1431(preflight: NestedPreflight1431) {
  nestedPreflight1431Schema.parse(preflight);
  if (!preflight.integrityPassed || preflight.failures.length)
    throw new Error("C6011431_PRE_GOLD_NESTED_INTEGRITY_FAILED");
}

function stripAllowedProjectionHashes1431(value: Projections143) {
  const copy = structuredClone(value) as Projections143;
  copy.semanticHash = "<allowed-projection-set-hash>";
  for (const variant of copy.variants) {
    variant.semanticHash = "<allowed-variant-hash>";
    for (const audio of variant.projection.physicalAudio)
      audio.semanticHash = "<allowed-projected-audio-hash>";
  }
  return copy;
}

function officialProjection1431(value: Projections143) {
  return required141(
    value.variants.find((variant) => variant.stage === value.officialStage),
  ).projection;
}

export function auditProjectionChanges1431(input: {
  before: Projections143;
  after: Projections143;
  plannerEquivalent: boolean;
  canonicalTextEquivalent: boolean;
  canonicalTimingEquivalent: boolean;
  presentationEquivalent: boolean;
}): ProjectionChangeAudit1431 {
  const before = officialProjection1431(input.before),
    after = officialProjection1431(input.after),
    forbiddenChanges: string[] = [];
  if (
    hash141(stripAllowedProjectionHashes1431(input.before)) !==
    hash141(stripAllowedProjectionHashes1431(input.after))
  )
    forbiddenChanges.push("NON_HASH_PROJECTION_CONTENT_CHANGED");
  const audioBytesEquivalent =
    hash141(
      before.physicalAudio.map(({ semanticHash: _hash, ...row }) => row),
    ) ===
    hash141(after.physicalAudio.map(({ semanticHash: _hash, ...row }) => row));
  const playbackRowsByteEquivalent =
    hash141(before.playbackSegments) === hash141(after.playbackSegments);
  const targetEquivalent = hash141(before.targets) === hash141(after.targets);
  const regionEquivalent = hash141(before.regions) === hash141(after.regions);
  const playbackIntervalsEquivalent =
    hash141(
      before.playbackSegments.map((row) => ({
        sourceInterval: row.sourceInterval,
        audioLocalInterval: row.audioLocalInterval,
      })),
    ) ===
    hash141(
      after.playbackSegments.map((row) => ({
        sourceInterval: row.sourceInterval,
        audioLocalInterval: row.audioLocalInterval,
      })),
    );
  const rowCountsEquivalent =
    before.physicalAudio.length === after.physicalAudio.length &&
    before.playbackSegments.length === after.playbackSegments.length &&
    before.targets.length === after.targets.length &&
    before.regions.length === after.regions.length;
  const beforeAudio = new Map(
    before.physicalAudio.map((row) => [row.audioId, row.semanticHash]),
  );
  const changedProjectedAudioHashCount = after.physicalAudio.filter(
    (row) => beforeAudio.get(row.audioId) !== row.semanticHash,
  ).length;
  const changedVariantHashCount = input.after.variants.filter(
    (row, index) =>
      row.semanticHash !== input.before.variants[index]?.semanticHash,
  ).length;
  for (const [passed, code] of [
    [audioBytesEquivalent, "AUDIO_BYTES_CHANGED"],
    [playbackRowsByteEquivalent, "PLAYBACK_ROWS_CHANGED"],
    [targetEquivalent, "TARGETS_CHANGED"],
    [regionEquivalent, "REGIONS_CHANGED"],
    [playbackIntervalsEquivalent, "PLAYBACK_INTERVALS_CHANGED"],
    [rowCountsEquivalent, "ROW_COUNTS_CHANGED"],
    [input.plannerEquivalent, "PLANNER_CHANGED"],
    [input.canonicalTextEquivalent, "CANONICAL_TEXT_CHANGED"],
    [input.canonicalTimingEquivalent, "CANONICAL_TIMING_CHANGED"],
    [input.presentationEquivalent, "PRESENTATION_CHANGED"],
  ] as const)
    if (!passed && !forbiddenChanges.includes(code))
      forbiddenChanges.push(code);
  const pass =
    forbiddenChanges.length === 0 &&
    audioBytesEquivalent &&
    playbackRowsByteEquivalent &&
    targetEquivalent &&
    regionEquivalent &&
    playbackIntervalsEquivalent &&
    rowCountsEquivalent &&
    input.plannerEquivalent &&
    input.canonicalTextEquivalent &&
    input.canonicalTimingEquivalent &&
    input.presentationEquivalent;
  return projectionChangeAudit1431Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: C6011431_POLICY_VERSION,
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-3-1-projection-change-audit",
      beforeProjectionSetHash: input.before.semanticHash,
      afterProjectionSetHash: input.after.semanticHash,
      allowedChangeClasses: [
        "PROJECTED_AUDIO_ROW_SEMANTIC_HASH",
        "PROJECTION_VARIANT_SEMANTIC_HASH",
        "PROJECTION_SET_SEMANTIC_HASH",
        "UPSTREAM_FREEZE_BINDING_HASH",
      ],
      changedProjectedAudioHashCount,
      changedVariantHashCount,
      changedOuterHashCount:
        input.before.semanticHash === input.after.semanticHash ? 0 : 1,
      playbackRowsByteEquivalent,
      plannerEquivalent: input.plannerEquivalent,
      targetEquivalent,
      regionEquivalent,
      audioBytesEquivalent,
      playbackIntervalsEquivalent,
      rowCountsEquivalent,
      canonicalTextEquivalent: input.canonicalTextEquivalent,
      canonicalTimingEquivalent: input.canonicalTimingEquivalent,
      presentationEquivalent: input.presentationEquivalent,
      forbiddenChanges,
      passed: pass,
    }),
  );
}

export function rehashProjectionSet1431(input: Projections143): Projections143 {
  const variants = input.variants.map((variant) => {
    const projection: C60114MachineCoverageProjection = {
      ...variant.projection,
      physicalAudio: variant.projection.physicalAudio.map((row) =>
        c60114CoveragePhysicalAudioSchema.parse(hashed141(row)),
      ),
      playbackSegments: variant.projection.playbackSegments.map((row) =>
        c60114CoveragePlaybackSegmentSchema.parse(row),
      ),
    };
    return hashed141({ ...variant, projection });
  });
  return hashed141({ ...input, variants });
}
