import {
  humanBaselineAuthoritySchema,
  subtitleFinalizationEvidenceFreshnessSchema,
  type C60FinalizationPolicyMode,
  type HumanBaselineAuthority,
  type SubtitleFinalizationEvidenceFreshness,
  type SubtitleFinalizationReport,
  type SubtitleReviewPackage,
} from "@mvl/shared";
import {
  C60_PROTECTED_RISK_POLICY,
  c60SemanticHash,
} from "@mvl/video-subtitler";

export const C60_TEST_HASH = {
  cue: "8".repeat(64),
  timing: "5".repeat(64),
  presentation: "9".repeat(64),
  source: "2".repeat(64),
} as const;

export const C60_TEST_COMPONENTS = Array.from(
  { length: 7 },
  (_, index) => `component-${index + 1}`,
);

export function protectedAuthority(
  verified = true,
): HumanBaselineAuthority {
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "human-baseline-authority" as const,
    authorityVersion: "c6.0-human-baseline-authority-v1" as const,
    generatedAt: "2026-08-27T00:00:00.000Z",
    authorityType: verified
      ? ("user-confirmed-human-reviewed" as const)
      : ("none" as const),
    sourceFileName: verified ? "reviewed.ass" : null,
    sourceFileSha256: verified ? "a".repeat(64) : null,
    sourceFileSize: verified ? 123 : null,
    sourceCueHash: verified ? C60_TEST_HASH.cue : null,
    sourceTimingHash: verified ? C60_TEST_HASH.timing : null,
    sourceVideoFileName: "video.mkv",
    sourceVideoSha256: C60_TEST_HASH.source,
    sourceVideoSize: 456,
    cueCount: verified ? 14 : 0,
    textAuthority: verified,
    timingAuthority: verified,
    readOnlyVerified: verified,
    sourceVideoReadOnlyVerified: true,
    coverageVerified: verified,
    lineageVerified: verified,
    authorityVerified: verified,
    verificationFailures: verified ? [] : ["HUMAN_BASELINE_NOT_SUPPLIED"],
  };
  return humanBaselineAuthoritySchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}

export function protectedFreshness(
  passed = true,
): SubtitleFinalizationEvidenceFreshness {
  const entries = ["cue-1", "cue-2"].map((cueId) => ({
    freshnessId: `freshness-${cueId}`,
    code: "CTC_TARGET_UNREPRESENTABLE",
    cueId,
    componentId: "component-1",
    originalEvidenceRef: "subtitle-local-ctc-boundary-evidence.json",
    originalEvidenceHash: "1".repeat(64),
    laterEvidenceRef: "memory-assisted-ctc-target-audit.json",
    laterEvidenceHash: "2".repeat(64),
    canonicalCueHash: C60_TEST_HASH.cue,
    canonicalTimingHash: C60_TEST_HASH.timing,
    semanticSubject: `cue:${cueId}:ctc-target-encodability`,
    originalMeaning: "not representable",
    laterMeaning: "representable",
    cueIdentityMatched: true,
    canonicalHashMatched: passed,
    timingHashMatched: true,
    semanticSubjectMatched: true,
    lineageCompatible: true,
    canonicalTextChanged: false,
    canonicalTimingChanged: false,
    freshnessStatus: passed ? ("superseded" as const) : ("hash-mismatch" as const),
    supersededByEvidenceIds: ["memory-1"],
    reasonCodes: passed
      ? ["LATER_C5_19_TARGET_ENCODABILITY_VERIFIED"]
      : ["FRESHNESS_CANONICAL_HASH_MISMATCH"],
  }));
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-finalization-evidence-freshness" as const,
    freshnessVersion: "c6.0-evidence-freshness-v1" as const,
    generatedAt: "2026-08-27T00:00:00.000Z",
    policyHash: C60_PROTECTED_RISK_POLICY.policyHash,
    baseCueHash: C60_TEST_HASH.cue,
    baseTimingHash: C60_TEST_HASH.timing,
    entries,
    summary: {
      assessedCount: 2,
      currentCount: 0,
      supersededCount: passed ? 2 : 0,
      failedCount: passed ? 0 : 2,
    },
    integrityPassed: passed,
  };
  return subtitleFinalizationEvidenceFreshnessSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}

export function protectedLegacyReport(): SubtitleFinalizationReport {
  const findings = C60_TEST_COMPONENTS.flatMap((componentId, index) => [
    {
      findingId: `forced-${componentId}`,
      severity: "blocking" as const,
      code: "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
      cueIds: [`cue-${index * 2 + 1}`, `cue-${index * 2 + 2}`],
      message: "Safe repair was not established.",
    },
    {
      findingId: `overlap-${componentId}`,
      severity: "blocking" as const,
      code: "ILLEGAL_SUBTITLE_OVERLAP",
      cueIds: [`cue-${index * 2 + 1}`, `cue-${index * 2 + 2}`],
      message: "Temporal overlap remains for review.",
    },
  ]);
  return {
    status: "needs-review",
    finalizationMethod: "none",
    findings,
    metrics: { blockingFindingCount: 14, reviewItemCount: 7 },
    qualityGate: { passed: false },
  } as unknown as SubtitleFinalizationReport;
}

export function protectedReviewPackage(input?: {
  positiveRiskComponent?: number;
}): SubtitleReviewPackage {
  return {
    items: C60_TEST_COMPONENTS.map((componentId, index) => ({
      reviewId: `review-${index + 1}`,
      speakerEvidenceComponentId: componentId,
      targetCueIds: [`cue-${index * 2 + 1}`, `cue-${index * 2 + 2}`],
      blockers: [
        "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
        "ILLEGAL_SUBTITLE_OVERLAP",
        ...(index === 0 ? ["CTC_TARGET_UNREPRESENTABLE"] : []),
        ...(index === 2 ? ["CTC_LEGAL_OVERLAP_DELETED"] : []),
        ...(index === input?.positiveRiskComponent
          ? ["INVALID_CUE_TIMING"]
          : []),
      ],
      requiresHumanReview: true,
    })),
  } as unknown as SubtitleReviewPackage;
}

export function protectedSpeakerArtifact(): unknown {
  return {
    components: C60_TEST_COMPONENTS.map((componentId, index) => ({
      componentId,
      resolutionStatus: index === 2 ? "resolved" : "unresolved",
    })),
  };
}

export function protectedCtcArtifact(): unknown {
  return {
    components: C60_TEST_COMPONENTS.map((componentId, index) => ({
      componentId,
      subtitleOverlapResolved: false,
      timingMutationApplied: false,
      timingActionable: false,
      mutations: [],
      blockers: index === 2 ? ["CTC_LEGAL_OVERLAP_DELETED"] : [],
    })),
  };
}

export function protectedRiskInput(input?: {
  mode?: C60FinalizationPolicyMode;
  authority?: HumanBaselineAuthority;
  freshness?: SubtitleFinalizationEvidenceFreshness;
  observed?: ReadonlyMap<string, number>;
  additionalSignals?: readonly string[];
  positiveRiskComponent?: number;
}) {
  return {
    generatedAt: "2026-08-27T00:00:00.000Z",
    mode: input?.mode ?? ("protected-enforce" as const),
    taskName: "fixture-task",
    sourceFileName: "video.mkv",
    sourceFileSha256: C60_TEST_HASH.source,
    sourceFileSize: 456,
    canonicalCueHashBefore: C60_TEST_HASH.cue,
    canonicalCueHashAfter: C60_TEST_HASH.cue,
    canonicalTimingHashBefore: C60_TEST_HASH.timing,
    canonicalTimingHashAfter: C60_TEST_HASH.timing,
    presentationHash: C60_TEST_HASH.presentation,
    legacyReport: protectedLegacyReport(),
    reviewPackage: protectedReviewPackage({
      ...(input?.positiveRiskComponent === undefined
        ? {}
        : { positiveRiskComponent: input.positiveRiskComponent }),
    }),
    authority: input?.authority ?? protectedAuthority(),
    freshness: input?.freshness ?? protectedFreshness(),
    observedSignalCounts:
      input?.observed ??
      new Map([
        ["FORCED_ALIGNMENT_COMPONENT_UNRESOLVED", 7],
        ["ILLEGAL_SUBTITLE_OVERLAP", 7],
        ["CTC_TARGET_UNREPRESENTABLE", 2],
        ["CTC_LEGAL_OVERLAP_DELETED", 1],
      ]),
    additionalSignals: input?.additionalSignals ?? [],
    speakerArtifact: protectedSpeakerArtifact(),
    ctcArtifact: protectedCtcArtifact(),
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
    serializationRoundTripPassed: true,
    formatSemanticParityPassed: true,
    presentationIntegrityPassed: true,
    reviewDeliveryIntegrityPassed: true,
  };
}
