import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  subtitleFinalizationRiskAssessmentSchema,
  type C60FinalizationPolicyMode,
  type C60ProtectedDisposition,
  type C60ProtectedRiskPolicy,
  type FinalizationFinding,
  type HumanBaselineAuthority,
  type SubtitleFinalizationEvidenceFreshness,
  type SubtitleFinalizationReport,
  type SubtitleFinalizationRiskAssessment,
  type SubtitleReviewEffectiveDisposition,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import { assessBaselinePreservation } from "./baseline-preservation.js";
import {
  C60_PROTECTED_RISK_POLICY,
  c60PolicyEntry,
  c60SemanticHash,
  c60StableHash,
  verifyC60ProtectedRiskPolicy,
} from "./finalization-risk-policy.js";
import { buildFinalizationRootRisks } from "./finalization-root-risk.js";
import { buildReviewEffectiveDisposition } from "./review-effective-disposition.js";

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/u;
const SIGNAL_ARTIFACT_FILES = [
  "subtitle-finalization-report.json",
  "subtitle-review-package.json",
  "subtitle-canonical-forced-alignment.json",
  "subtitle-local-ctc-boundary-evidence.json",
  "subtitle-local-speaker-evidence.json",
  "subtitle-local-separated-stream-evidence.json",
  "subtitle-overlap-acoustic-resolution.json",
  "subtitle-presentation-resolution.json",
  "subtitle-timestamp-evidence-integrity.json",
  "memory-assisted-ctc-target-audit.json",
  "subtitle-review-delivery-integrity.json",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectCodes(
  value: unknown,
  counts: Map<string, number>,
  parentKey = "",
): void {
  if (typeof value === "string") {
    if (
      CODE_PATTERN.test(value) &&
      /(?:blocker|code|reason|finding|error)/iu.test(parentKey)
    ) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectCodes(child, counts, parentKey);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectCodes(child, counts, key);
  }
}

export async function collectC60ObservedSignalCounts(
  subtitleDirectory: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const name of SIGNAL_ARTIFACT_FILES) {
    const filePath = path.join(subtitleDirectory, name);
    try {
      collectCodes(
        JSON.parse(await readFile(filePath, "utf8")) as unknown,
        counts,
      );
    } catch {
      // A missing optional provider artifact is represented by its explicit
      // availability signal in the artifacts that do exist.
    }
  }
  return counts;
}

function dispositionIsFinal(disposition: C60ProtectedDisposition): boolean {
  return disposition === "FINAL_BLOCKER" || disposition === "UNKNOWN";
}

function effectiveDisposition(input: {
  code: string;
  original: C60ProtectedDisposition;
  humanAuthorityVerified: boolean;
  positiveDefectCount: number;
  integrityFailureCount: number;
  freshness: SubtitleFinalizationEvidenceFreshness;
}): C60ProtectedDisposition {
  if (input.code === "CTC_TARGET_UNREPRESENTABLE") {
    return input.freshness.integrityPassed &&
      input.freshness.entries.length > 0 &&
      input.freshness.entries.every(
        (entry) => entry.freshnessStatus === "superseded",
      )
      ? "SUPERSEDED"
      : "MUTATION_GUARD";
  }
  if (input.code === "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED") {
    return input.humanAuthorityVerified &&
      input.positiveDefectCount === 0 &&
      input.integrityFailureCount === 0
      ? "MUTATION_GUARD"
      : "CONTEXT_DEPENDENT";
  }
  if (input.code === "ILLEGAL_SUBTITLE_OVERLAP") {
    return input.humanAuthorityVerified &&
      input.positiveDefectCount === 0 &&
      input.integrityFailureCount === 0
      ? "REVIEW_ADVISORY"
      : "CONTEXT_DEPENDENT";
  }
  return input.original;
}

function signalReasonCodes(input: {
  code: string;
  effective: C60ProtectedDisposition;
  matched: boolean;
}): string[] {
  if (!input.matched) return ["UNCLASSIFIED_FINALIZATION_SIGNAL"];
  if (input.code === "ILLEGAL_SUBTITLE_OVERLAP") {
    return [
      "FORMAT_OVERLAP_ADVISORY",
      "OVERLAP_SEMANTICS_UNRESOLVED",
      "PRESERVATION_SAFE_WITH_HUMAN_AUTHORITY",
      "TEMPORAL_OVERLAP_OBSERVED",
    ];
  }
  if (input.code === "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED") {
    return [
      "MUTATION_NOT_PROVEN_SAFE",
      "OUTPUT_NOT_PROVEN_UNSAFE",
      "SAFE_REPAIR_NOT_ESTABLISHED",
    ];
  }
  if (input.effective === "SUPERSEDED") {
    return ["LATER_SAME_CUE_EVIDENCE_SUPERSEDES_SIGNAL"];
  }
  return [`EFFECTIVE_${input.effective}`];
}

function finalFindingReference(code: string): string[] {
  if (code === "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED") {
    return ["subtitle-canonical-forced-alignment.json"];
  }
  if (code === "ILLEGAL_SUBTITLE_OVERLAP") {
    return ["subtitle-presentation-resolution.json"];
  }
  return ["subtitle-finalization-report.json"];
}

function buildComponentRisks(input: {
  reviewPackage: SubtitleReviewPackage;
  speakerArtifact: unknown;
  ctcArtifact: unknown;
}): SubtitleFinalizationRiskAssessment["componentRisks"] {
  const speakerComponents = new Map<string, Record<string, unknown>>();
  if (isRecord(input.speakerArtifact)) {
    for (const component of Array.isArray(input.speakerArtifact.components)
      ? input.speakerArtifact.components
      : []) {
      if (isRecord(component) && typeof component.componentId === "string") {
        speakerComponents.set(component.componentId, component);
      }
    }
  }
  const ctcComponents = new Map<string, Record<string, unknown>>();
  if (isRecord(input.ctcArtifact)) {
    for (const component of Array.isArray(input.ctcArtifact.components)
      ? input.ctcArtifact.components
      : []) {
      if (isRecord(component) && typeof component.componentId === "string") {
        ctcComponents.set(component.componentId, component);
      }
    }
  }
  return input.reviewPackage.items
    .map((item) => {
      const componentId = item.speakerEvidenceComponentId ?? "unknown-component";
      const speaker = speakerComponents.get(componentId);
      const ctc = ctcComponents.get(componentId);
      const speakerRelationshipResolved =
        speaker?.resolutionStatus === "resolved";
      const ctcBlockers = Array.isArray(ctc?.blockers)
        ? ctc.blockers.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const preservationSupported =
        speakerRelationshipResolved &&
        (item.blockers.includes("CTC_LEGAL_OVERLAP_DELETED") ||
          ctcBlockers.includes("CTC_LEGAL_OVERLAP_DELETED"));
      const subtitleOverlapResolved =
        ctc?.subtitleOverlapResolved === true &&
        ctc?.timingMutationApplied === true &&
        Array.isArray(ctc.mutations) &&
        ctc.mutations.length > 0;
      const positiveCodes = item.blockers.filter((code) => {
        const policy = c60PolicyEntry(code);
        return (
          policy?.disposition === "FINAL_BLOCKER" &&
          policy.evidencePolarity === "positive-risk-evidence"
        );
      });
      return {
        reviewId: item.reviewId,
        componentId,
        cueIds: item.targetCueIds,
        currentOutputRisk: positiveCodes.length
          ? ("PROVEN_UNSAFE" as const)
          : preservationSupported
            ? ("LOW_RISK" as const)
            : ("UNKNOWN" as const),
        proposedMutationRisk: "HIGH" as const,
        positiveCurrentOutputDefectEvidence: positiveCodes.length > 0,
        safeAutomaticMutationAvailable: false,
        speakerRelationshipResolved,
        subtitleOverlapResolved,
        preservationSupported,
        preservationSupportEvidenceIds: preservationSupported
          ? [
              `speaker:${componentId}:resolved`,
              `ctc:${componentId}:CTC_LEGAL_OVERLAP_DELETED`,
            ]
          : [],
        reasonCodes: [
          ...(speakerRelationshipResolved
            ? ["SPEAKER_RELATIONSHIP_RESOLVED"]
            : ["SPEAKER_RELATIONSHIP_UNRESOLVED"]),
          ...(subtitleOverlapResolved
            ? ["SUBTITLE_OVERLAP_RESOLVED"]
            : ["SUBTITLE_OVERLAP_NOT_AUTOMATICALLY_RESOLVED"]),
          ...(preservationSupported
            ? ["PRESERVATION_SUPPORT_EVIDENCE_PRESENT"]
            : ["OVERLAP_ADVISORY_RETAINED"]),
          ...positiveCodes,
        ].toSorted(),
      };
    })
    .toSorted((left, right) => left.reviewId.localeCompare(right.reviewId));
}

export interface EvaluateProtectedFinalizationRiskInput {
  generatedAt: string;
  mode: C60FinalizationPolicyMode;
  taskName: string;
  sourceFileName: string;
  sourceFileSha256: string;
  sourceFileSize: number;
  canonicalCueHashBefore: string;
  canonicalCueHashAfter: string;
  canonicalTimingHashBefore: string;
  canonicalTimingHashAfter: string;
  presentationHash: string;
  legacyReport: SubtitleFinalizationReport;
  reviewPackage: SubtitleReviewPackage;
  authority: HumanBaselineAuthority;
  freshness: SubtitleFinalizationEvidenceFreshness;
  observedSignalCounts: ReadonlyMap<string, number>;
  additionalSignals?: readonly string[];
  policy?: C60ProtectedRiskPolicy;
  speakerArtifact: unknown;
  ctcArtifact: unknown;
  canonicalTextMutationCount: number;
  canonicalTimingMutationCount: number;
  serializationRoundTripPassed: boolean;
  formatSemanticParityPassed: boolean;
  presentationIntegrityPassed: boolean;
  reviewDeliveryIntegrityPassed: boolean;
}

export function evaluateProtectedFinalizationRisk(
  input: EvaluateProtectedFinalizationRiskInput,
): {
  riskAssessment: SubtitleFinalizationRiskAssessment;
  reviewDisposition: SubtitleReviewEffectiveDisposition;
} {
  const policy = input.policy ?? C60_PROTECTED_RISK_POLICY;
  const policyIntegrityPassed = verifyC60ProtectedRiskPolicy(policy);
  const counts = new Map(input.observedSignalCounts);
  for (const signal of input.additionalSignals ?? []) {
    counts.set(signal, (counts.get(signal) ?? 0) + 1);
  }
  const componentRisks = buildComponentRisks(input);
  const positiveDefectCount = componentRisks.filter(
    (component) => component.positiveCurrentOutputDefectEvidence,
  ).length;
  const preliminaryIntegrityFailureCount = [...counts].filter(([code]) => {
    const entry = c60PolicyEntry(code, policy);
    return entry?.disposition === "FINAL_BLOCKER";
  }).length;

  if (!policyIntegrityPassed) counts.set("POLICY_INTEGRITY_FAILED", 1);
  if (!input.freshness.integrityPassed) {
    counts.set("EVIDENCE_FRESHNESS_INTEGRITY_FAILED", 1);
  }
  if (
    input.mode === "protected-enforce" &&
    !input.authority.authorityVerified
  ) {
    counts.set("MACHINE_ONLY_BLIND_ACCEPTANCE_REQUIRED", 1);
  }
  const unknownCodes = [...counts.keys()].filter(
    (code) => c60PolicyEntry(code, policy) === undefined,
  );
  if (unknownCodes.length > 0) {
    counts.set("UNCLASSIFIED_FINALIZATION_SIGNAL", unknownCodes.length);
  }

  const signalAssessments = [...counts.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([code, occurrenceCount]) => {
      const entry = c60PolicyEntry(code, policy);
      const original = entry?.disposition ?? "UNKNOWN";
      const effective = effectiveDisposition({
        code,
        original,
        humanAuthorityVerified: input.authority.authorityVerified,
        positiveDefectCount,
        integrityFailureCount: preliminaryIntegrityFailureCount,
        freshness: input.freshness,
      });
      return {
        signalId: `signal-${c60StableHash({ code }).slice(0, 20)}`,
        code,
        occurrenceCount,
        policyMatched: entry !== undefined,
        rootRiskFamily: entry?.rootRiskFamily ?? "unclassified-signal",
        blockingScope: entry?.blockingScope ?? "current-output-safety",
        evidencePolarity: entry?.evidencePolarity ?? "positive-risk-evidence",
        originalDisposition: original,
        effectiveDisposition: effective,
        currentOutputRisk: entry?.currentOutputRisk ?? "PROVEN_UNSAFE",
        proposedMutationRisk: entry?.proposedMutationRisk ?? "HIGH",
        finalBlocking: dispositionIsFinal(effective),
        reasonCodes: signalReasonCodes({
          code,
          effective,
          matched: entry !== undefined,
        }),
      };
    });
  const integrityFinalBlockerCount = signalAssessments.filter(
    (signal) =>
      signal.finalBlocking &&
      (signal.blockingScope === "delivery-integrity" ||
        signal.code === "UNCLASSIFIED_FINALIZATION_SIGNAL" ||
        signal.code === "MACHINE_ONLY_BLIND_ACCEPTANCE_REQUIRED"),
  ).length;
  const unknownObservedSignalCount = unknownCodes.length;
  const preservation = assessBaselinePreservation({
    generatedAt: input.generatedAt,
    canonicalCueHashBefore: input.canonicalCueHashBefore,
    canonicalCueHashAfter: input.canonicalCueHashAfter,
    canonicalTimingHashBefore: input.canonicalTimingHashBefore,
    canonicalTimingHashAfter: input.canonicalTimingHashAfter,
    canonicalTextMutationCount: input.canonicalTextMutationCount,
    canonicalTimingMutationCount: input.canonicalTimingMutationCount,
    humanAuthorityVerified: input.authority.authorityVerified,
    sourceReadOnlyVerified: input.authority.sourceVideoReadOnlyVerified,
    humanSubtitleReadOnlyVerified: input.authority.readOnlyVerified,
    positiveCurrentOutputDefectEvidenceCount: positiveDefectCount,
    integrityFinalBlockerCount,
    unknownObservedSignalCount,
    freshnessIntegrityPassed: input.freshness.integrityPassed,
    policyIntegrityPassed,
    serializationRoundTripPassed: input.serializationRoundTripPassed,
    formatSemanticParityPassed: input.formatSemanticParityPassed,
    presentationIntegrityPassed: input.presentationIntegrityPassed,
    reviewDeliveryIntegrityPassed: input.reviewDeliveryIntegrityPassed,
    apply: input.mode === "protected-enforce",
  });
  const reviewDisposition = buildReviewEffectiveDisposition({
    generatedAt: input.generatedAt,
    reviewPackage: input.reviewPackage,
    componentRisks,
    humanAuthorityVerified: input.authority.authorityVerified,
  });
  const effectiveFindings = input.legacyReport.findings.map((finding) => {
    const signal = signalAssessments.find(
      (candidate) => candidate.code === finding.code,
    );
    const freshnessStatus =
      finding.code === "CTC_TARGET_UNREPRESENTABLE"
        ? input.freshness.integrityPassed
          ? ("superseded" as const)
          : ("failed" as const)
        : ("not-applicable" as const);
    return {
      findingId: finding.findingId,
      originalSeverity: finding.severity,
      originalCode: finding.code,
      cueIds: finding.cueIds,
      effectiveDisposition: signal?.effectiveDisposition ?? "UNKNOWN",
      effectiveFinalBlocking: signal?.finalBlocking ?? true,
      effectiveReviewAdvisory:
        signal?.effectiveDisposition === "REVIEW_ADVISORY",
      riskScope: signal?.blockingScope ?? "current-output-safety",
      rootRiskFamily: signal?.rootRiskFamily ?? "unclassified-signal",
      freshnessStatus,
      rationale:
        c60PolicyEntry(finding.code, policy)?.rationale ??
        "The runtime signal is not classified by the source-controlled C6.0 policy.",
      evidenceRefs: finalFindingReference(finding.code),
      reasonCodes: signal?.reasonCodes ?? ["UNCLASSIFIED_FINALIZATION_SIGNAL"],
    };
  });
  const rootRisks = buildFinalizationRootRisks({
    signals: signalAssessments,
    findings: input.legacyReport.findings,
  });
  const effectiveFinalBlockerCount = signalAssessments.filter(
    (signal) => signal.finalBlocking,
  ).length;
  const protectedOutcome =
    input.legacyReport.status === "rejected"
      ? ("REJECTED" as const)
      : !input.authority.authorityVerified
        ? ("MACHINE_ONLY_NOT_AUTHORIZED" as const)
        : effectiveFinalBlockerCount > 0 || !preservation.eligible
          ? ("HUMAN_REVIEW_REQUIRED" as const)
          : signalAssessments.some(
                (signal) =>
                  signal.effectiveDisposition === "REVIEW_ADVISORY" ||
                  signal.effectiveDisposition === "MUTATION_GUARD" ||
                  signal.effectiveDisposition === "DIAGNOSTIC_ONLY",
              )
            ? ("FINAL_SAFE_WITH_ADVISORIES" as const)
            : ("FINAL_SAFE" as const);
  const summary = {
    observedSignalCount: input.observedSignalCounts.size,
    policyCoveredObservedSignalCount: [...input.observedSignalCounts.keys()].filter(
      (code) => c60PolicyEntry(code, policy) !== undefined,
    ).length,
    unknownObservedSignalCount,
    unknownSignalFailClosedCount: unknownCodes.length,
    legacyBlockingFindingCount: input.legacyReport.findings.filter(
      (finding) => finding.severity === "blocking",
    ).length,
    effectiveProtectedFinalBlockerCount: effectiveFinalBlockerCount,
    effectiveMutationGuardCount: signalAssessments.filter(
      (signal) => signal.effectiveDisposition === "MUTATION_GUARD",
    ).length,
    effectiveReviewAdvisoryCount: signalAssessments.filter(
      (signal) => signal.effectiveDisposition === "REVIEW_ADVISORY",
    ).length,
    effectiveDiagnosticCount: signalAssessments.filter(
      (signal) => signal.effectiveDisposition === "DIAGNOSTIC_ONLY",
    ).length,
    effectiveSupersededCount: signalAssessments.filter(
      (signal) => signal.effectiveDisposition === "SUPERSEDED",
    ).length,
    positiveCurrentOutputDefectEvidenceCount: positiveDefectCount,
    rootRiskFamilyCount: rootRisks.length,
    legacyReviewItemCount: input.legacyReport.metrics.reviewItemCount,
    protectedReviewArtifactItemCount: input.reviewPackage.items.length,
    effectiveMandatoryReviewCount:
      reviewDisposition.summary.effectiveMandatoryReviewCount,
    effectiveAdvisoryReviewCount:
      reviewDisposition.summary.effectiveAdvisoryReviewCount,
    preservationSupportedReviewCount:
      reviewDisposition.summary.preservationSupportedReviewCount,
    speakerRelationshipResolvedComponentCount: componentRisks.filter(
      (component) => component.speakerRelationshipResolved,
    ).length,
    subtitleOverlapResolvedComponentCount: componentRisks.filter(
      (component) => component.subtitleOverlapResolved,
    ).length,
    canonicalTextMutationCount: input.canonicalTextMutationCount,
    canonicalTimingMutationCount: input.canonicalTimingMutationCount,
  };
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-finalization-risk-assessment" as const,
    riskVersion: "C6.0-protected" as const,
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
    generatedAt: input.generatedAt,
    sourceIdentity: {
      taskName: input.taskName,
      sourceFileName: input.sourceFileName,
      sourceFileSha256: input.sourceFileSha256,
      sourceFileSize: input.sourceFileSize,
      canonicalCueHash: input.canonicalCueHashAfter,
      canonicalTimingHash: input.canonicalTimingHashAfter,
      presentationHash: input.presentationHash,
    },
    humanAuthority: {
      authorityType: input.authority.authorityType,
      authorityVerified: input.authority.authorityVerified,
      authoritySemanticHash: input.authority.semanticHash,
    },
    mode: input.mode,
    machineOnlyReleaseAuthorized: false as const,
    blindAcceptanceRequired: true as const,
    legacyState: {
      status: input.legacyReport.status,
      finalizationMethod: input.legacyReport.finalizationMethod,
      qualityPassed: input.legacyReport.qualityGate.passed,
      blockingFindingCount: input.legacyReport.metrics.blockingFindingCount,
      reviewItemCount: input.legacyReport.metrics.reviewItemCount,
    },
    policyIntegrityPassed,
    signalAssessments,
    freshnessAssessments: input.freshness.entries,
    effectiveFindings,
    rootRisks,
    componentRisks,
    baselinePreservation: preservation,
    summary,
    protectedOutcome,
  };
  return {
    riskAssessment: subtitleFinalizationRiskAssessmentSchema.parse({
      ...base,
      semanticHash: c60SemanticHash(base),
    }),
    reviewDisposition,
  };
}
