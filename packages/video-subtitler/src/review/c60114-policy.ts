import {
  c60114PolicySchema,
  c60114PolicyVersion,
  c60114SourceIdentitySchema,
  type C60114Policy,
  type C60114SourceIdentity,
  type C60114Interval,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";

export const C60114_POLICY_VERSION = c60114PolicyVersion;
export function withC60114SemanticHash<T extends object>(
  value: T,
): T & { semanticHash: string } {
  return { ...value, semanticHash: machineQualitySemanticHash(value) };
}
export function uniqueC60114(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted();
}
export function c60114Id(prefix: string, value: unknown): string {
  return `${prefix}-${machineQualitySemanticHash(value).slice(0, 24)}`;
}
export function buildC60114Policy(): C60114Policy {
  return c60114PolicySchema.parse(
    withC60114SemanticHash({
      schemaVersion: "1.0.0",
      policyVersion: C60114_POLICY_VERSION,
      artifactType: "c6-0-1-14-missing-localization-policy",
      coverageThresholds: [0.5, 0.8, 0.95],
      speech: {
        mergeGapSeconds: 0.25,
        minSeconds: 0.2,
        maxSeconds: 12,
        strongContradictionThreshold: 0.8,
      },
      probes: {
        maxTargets: 24,
        maxContextTargets: 8,
        maxRequests: 64,
        contextMarginSeconds: 1.5,
        maxContextSeconds: 15,
        providerCount: 2,
      },
      reviewRegion: {
        maxTargetGapSeconds: 0.75,
        maxRegionDurationSeconds: 30,
        contextSeconds: 2,
      },
      exactGuardSeconds: 0.05,
      cueCoverageToleranceSeconds: 0.05,
      orphanCoverageThreshold: 0.8,
      parentGapIsSearchEnvelopeOnly: true,
      disjointTargetsRemainSeparate: true,
      sharedRootIsCorrelated: true,
      goldBarrier: {
        runtimeGoldInputAllowed: false,
        freezeBeforeLabels: true,
        sameVersionRetuneAllowed: false,
      },
    }),
  );
}
export function assertC60114Policy(policy: C60114Policy): void {
  c60114PolicySchema.parse(policy);
  if (policy.semanticHash !== buildC60114Policy().semanticHash)
    throw new Error("C60114_POLICY_VERSION_REQUIRES_FROZEN_CONSTANTS");
  const { semanticHash, ...core } = policy;
  if (machineQualitySemanticHash(core) !== semanticHash)
    throw new Error("C60114_POLICY_HASH_MISMATCH");
}
export function c60114ArtifactHeader(
  policy: C60114Policy,
  sourceIdentity: C60114SourceIdentity,
) {
  assertC60114Policy(policy);
  c60114SourceIdentitySchema.parse(sourceIdentity);
  return {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60114_POLICY_VERSION,
    policyHash: policy.semanticHash,
    sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    runtimeGoldInputCount: 0 as const,
  };
}
export function assertC60114SourceIdentity(
  actual: C60114SourceIdentity,
  expected: C60114SourceIdentity,
): void {
  c60114SourceIdentitySchema.parse(actual);
  c60114SourceIdentitySchema.parse(expected);
  if (
    machineQualitySemanticHash(actual) !== machineQualitySemanticHash(expected)
  )
    throw new Error("C60114_SOURCE_IDENTITY_MISMATCH");
}
export function c60114Intersection(
  a: C60114Interval,
  b: C60114Interval,
): C60114Interval | null {
  const start = Math.max(a.start, b.start),
    end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}
export function c60114Union(
  intervals: readonly C60114Interval[],
  gap = 0,
): C60114Interval[] {
  const out: C60114Interval[] = [];
  for (const v of intervals.toSorted(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const prev = out.at(-1);
    if (prev && v.start <= prev.end + gap) prev.end = Math.max(prev.end, v.end);
    else out.push({ ...v });
  }
  return out;
}
export function c60114Coverage(
  target: C60114Interval,
  intervals: readonly C60114Interval[],
): number {
  return Math.min(
    1,
    c60114Union(
      intervals.flatMap((v) => {
        const i = c60114Intersection(target, v);
        return i ? [i] : [];
      }),
    ).reduce((n, i) => n + i.end - i.start, 0) /
      (target.end - target.start),
  );
}
export function c60114Subtract(
  target: C60114Interval,
  coverage: readonly C60114Interval[],
): C60114Interval[] {
  let remaining = [{ ...target }];
  for (const c of c60114Union(coverage)) {
    remaining = remaining.flatMap((v) => {
      const i = c60114Intersection(v, c);
      return !i
        ? [v]
        : [
            ...(v.start < i.start ? [{ start: v.start, end: i.start }] : []),
            ...(i.end < v.end ? [{ start: i.end, end: v.end }] : []),
          ];
    });
  }
  return remaining;
}
