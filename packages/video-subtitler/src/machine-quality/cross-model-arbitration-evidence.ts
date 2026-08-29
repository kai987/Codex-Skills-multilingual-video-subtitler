import {
  c60110PolicyVersion,
  machineCrossModelArbitrationEvidenceSchema,
  type C60110ReasonCode,
  type C60110Scope,
  type CrossModelArbitrationEvidenceBundle,
  type MachineCrossModelArbitrationEvidence,
} from "@mvl/shared";

import {
  compareCrossModelText,
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
  normalizedEditSimilarity,
} from "./cross-model-normalization.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";
import { c60110CorrelationGroups } from "./cross-model-evidence-correlation.js";

export interface C60110CandidateInput {
  candidateId: string;
  providerFamily: "WHISPER" | "REAZON";
  text: string;
  pronunciationText?: string;
  hallucinationRisk: number;
  evidenceAvailability: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  sourceSemanticHash?: string;
}

export interface C60110MachineEvidenceInput {
  status:
    | "POSITIVE_CORRECTNESS_EVIDENCE"
    | "POSITIVE_ERROR_EVIDENCE"
    | "CONFLICTING_EVIDENCE"
    | "EVIDENCE_ABSENCE"
    | "UNKNOWN";
  strong: boolean;
  evidenceMissing: boolean;
  sourceEvidenceIds: string[];
  reasonCodes: C60110ReasonCode[];
}

export interface C60110EvidenceEventInput {
  eventId: string;
  diagnosticRole: "TARGET" | "CONTROL" | "HOLDOUT";
  currentFinalCueIds: string[];
  currentFinalSpanLineage: {
    finalCueId: string | null;
    spanStart: number | null;
    spanEnd: number | null;
    lineageStatus:
      | "EXACT"
      | "NORMALIZED_EXACT"
      | "DERIVED_FROM_SPLIT"
      | "DERIVED_FROM_MERGE"
      | "AMBIGUOUS"
      | "UNRESOLVED";
    modifiable: boolean;
    blockers: string[];
    semanticHash: string;
  };
  currentWhisperCandidate: C60110CandidateInput;
  alternateWhisperCandidates: C60110CandidateInput[];
  reazonCoreExactCandidate: C60110CandidateInput | null;
  reazonCoreContextCandidate: C60110CandidateInput | null;
  whisperStability: {
    class:
      | "CORE_TEXT_CONSISTENT"
      | "CONTEXT_ONLY_DIFFERENCE"
      | "LEXICAL_CORE_DISAGREEMENT"
      | "HALLUCINATION_DISAGREEMENT"
      | "ADJACENT_UTTERANCE_CONTAMINATION"
      | "SPEAKER_CONTENT_MIX"
      | "PARTIAL_CORE_AGREEMENT"
      | "UNLOCALIZABLE"
      | "UNEVALUABLE"
      | "NOT_RUN";
    sourceEvidenceIds: string[];
  };
  reazonStability: {
    class:
      | "REAZON_CORE_STABLE"
      | "REAZON_CONTEXT_EXTENSION_ONLY"
      | "REAZON_LEXICALLY_UNSTABLE"
      | "REAZON_HALLUCINATION_UNSTABLE"
      | "REAZON_EMPTY_UNSTABLE"
      | "UNCOMPARABLE"
      | "CONTEXT_NOT_RUN";
    sourceEvidenceIds: string[];
  };
  whisperDecoderEvidence: C60110MachineEvidenceInput;
  whisperTokenEvidence: C60110MachineEvidenceInput;
  requestEdgeEvidence: C60110MachineEvidenceInput;
  speechCompletenessEvidence: C60110MachineEvidenceInput;
  ctc: {
    whisperSupport: number | null;
    reazonSupport: number | null;
    outcome:
      | "CTC_FAVORS_WHISPER"
      | "CTC_FAVORS_REAZON"
      | "CTC_AMBIGUOUS"
      | "CTC_UNSCORABLE"
      | "CTC_NOT_RUN";
    sourceEvidenceIds: string[];
  };
  coreLocalizationStatus:
    | "VERIFIED"
    | "VERIFIED_WITH_CAUTION"
    | "MACHINE_LOCALIZABLE"
    | "AMBIGUOUS"
    | "UNLOCALIZABLE";
  crossEventAmbiguity: boolean;
  runtimeProvenanceComplete: boolean;
}

function candidateView(candidate: C60110CandidateInput) {
  const displayText = normalizeIndependentAsrDisplay(candidate.text);
  const core = {
    candidateId: candidate.candidateId,
    providerFamily: candidate.providerFamily,
    displayText,
    normalizedDisplayText: normalizeIndependentAsrLexical(displayText),
    pronunciationText:
      candidate.pronunciationText ??
      normalizeJapanesePronunciation(displayText),
    hallucinationRisk: candidate.hallucinationRisk,
    evidenceAvailability: candidate.evidenceAvailability,
  };
  return {
    ...core,
    semanticHash:
      candidate.sourceSemanticHash ?? machineQualitySemanticHash(core),
  };
}

function evidenceAtom(input: {
  family: CrossModelArbitrationEvidenceBundle["evidenceAtoms"][number]["family"];
  tier: CrossModelArbitrationEvidenceBundle["evidenceAtoms"][number]["tier"];
  reasonCode: C60110ReasonCode;
  correlationGroupId: string;
  sourceEvidenceIds?: string[];
}) {
  const core = {
    ...input,
    sourceEvidenceIds: input.sourceEvidenceIds ?? [],
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

function evidenceNegative(evidence: C60110MachineEvidenceInput): boolean {
  return evidence.status === "POSITIVE_ERROR_EVIDENCE";
}

export function buildCrossModelArbitrationEvidenceBundle(
  input: C60110EvidenceEventInput,
): CrossModelArbitrationEvidenceBundle {
  const whisper = candidateView(input.currentWhisperCandidate);
  const alternates = input.alternateWhisperCandidates.map(candidateView);
  const reazonExact =
    input.reazonCoreExactCandidate === null
      ? null
      : candidateView(input.reazonCoreExactCandidate);
  const reazonContext =
    input.reazonCoreContextCandidate === null
      ? null
      : candidateView(input.reazonCoreContextCandidate);
  const comparison =
    reazonExact === null ? null : compareCrossModelText(whisper, reazonExact);
  const alternateCorroborates =
    reazonExact !== null &&
    alternates.some(
      (candidate) =>
        candidate.candidateId !== whisper.candidateId &&
        (candidate.normalizedDisplayText ===
          reazonExact.normalizedDisplayText ||
          normalizedEditSimilarity(
            candidate.pronunciationText,
            reazonExact.pronunciationText,
          ) >= 0.9),
    );
  const whisperNegative =
    [
      input.whisperDecoderEvidence,
      input.whisperTokenEvidence,
      input.requestEdgeEvidence,
      input.speechCompletenessEvidence,
    ].some(evidenceNegative) ||
    [
      "LEXICAL_CORE_DISAGREEMENT",
      "HALLUCINATION_DISAGREEMENT",
      "PARTIAL_CORE_AGREEMENT",
    ].includes(input.whisperStability.class);
  const whisperStrongNegative =
    [
      input.whisperDecoderEvidence,
      input.whisperTokenEvidence,
      input.requestEdgeEvidence,
      input.speechCompletenessEvidence,
    ].some((evidence) => evidenceNegative(evidence) && evidence.strong) ||
    input.whisperStability.class === "HALLUCINATION_DISAGREEMENT";
  const reazonStable = [
    "REAZON_CORE_STABLE",
    "REAZON_CONTEXT_EXTENSION_ONLY",
  ].includes(input.reazonStability.class);
  const reazonHardBlocked =
    reazonExact === null ||
    !input.runtimeProvenanceComplete ||
    [
      "REAZON_LEXICALLY_UNSTABLE",
      "REAZON_HALLUCINATION_UNSTABLE",
      "REAZON_EMPTY_UNSTABLE",
      "UNCOMPARABLE",
      "CONTEXT_NOT_RUN",
    ].includes(input.reazonStability.class);
  const safeExact =
    input.currentFinalSpanLineage.modifiable &&
    input.currentFinalSpanLineage.lineageStatus === "EXACT";
  const safeNormalized =
    input.currentFinalSpanLineage.modifiable &&
    input.currentFinalSpanLineage.lineageStatus === "NORMALIZED_EXACT";
  const mutationSafetyStatus = safeExact
    ? ("SAFE_EXACT_SPAN" as const)
    : safeNormalized
      ? ("SAFE_NORMALIZED_EXACT_SPAN" as const)
      : ["DERIVED_FROM_SPLIT", "DERIVED_FROM_MERGE"].includes(
            input.currentFinalSpanLineage.lineageStatus,
          )
        ? ("OBSERVE_ONLY_DERIVED_SPAN" as const)
        : ("BLOCKED" as const);

  const evidenceAtoms: ReturnType<typeof evidenceAtom>[] = [];
  if (reazonStable) {
    evidenceAtoms.push(
      evidenceAtom({
        family: "REAZON_STABILITY",
        tier: "STRONG_SUPPORT",
        reasonCode:
          input.reazonStability.class === "REAZON_CORE_STABLE"
            ? "REAZON_STABLE"
            : "REAZON_CONTEXT_EXTENSION_ONLY",
        correlationGroupId: c60110CorrelationGroups.reazonDataFamily,
        sourceEvidenceIds: input.reazonStability.sourceEvidenceIds,
      }),
    );
  }
  if (alternateCorroborates) {
    evidenceAtoms.push(
      evidenceAtom({
        family: "CROSS_MODEL_RELATION",
        tier: "STRONG_SUPPORT",
        reasonCode: "WHISPER_ALTERNATE_CORROBORATES_REAZON",
        correlationGroupId: c60110CorrelationGroups.whisper,
        sourceEvidenceIds: alternates.map(
          (candidate) => candidate.semanticHash,
        ),
      }),
    );
  }
  if (whisperNegative) {
    const reasonCode = input.whisperStability.class.includes("HALLUCINATION")
      ? ("WHISPER_HALLUCINATION_RISK" as const)
      : ("WHISPER_LEXICALLY_UNSTABLE" as const);
    evidenceAtoms.push(
      evidenceAtom({
        family: "WHISPER_STABILITY",
        tier: whisperStrongNegative ? "STRONG_SUPPORT" : "SUPPORT",
        reasonCode,
        correlationGroupId: c60110CorrelationGroups.whisper,
        sourceEvidenceIds: input.whisperStability.sourceEvidenceIds,
      }),
    );
  }
  for (const [family, evidence] of [
    ["WHISPER_DECODER", input.whisperDecoderEvidence],
    ["WHISPER_TOKEN", input.whisperTokenEvidence],
    ["SPEECH_LOCALIZATION", input.requestEdgeEvidence],
    ["SPEECH_LOCALIZATION", input.speechCompletenessEvidence],
  ] as const) {
    for (const reasonCode of evidence.reasonCodes) {
      evidenceAtoms.push(
        evidenceAtom({
          family,
          tier:
            evidence.status === "POSITIVE_ERROR_EVIDENCE"
              ? evidence.strong
                ? "STRONG_SUPPORT"
                : "SUPPORT"
              : evidence.status === "CONFLICTING_EVIDENCE"
                ? "CONTRADICTION"
                : "UNKNOWN",
          reasonCode,
          correlationGroupId:
            family === "SPEECH_LOCALIZATION"
              ? c60110CorrelationGroups.localization
              : c60110CorrelationGroups.whisper,
          sourceEvidenceIds: evidence.sourceEvidenceIds,
        }),
      );
    }
  }
  if (input.ctc.outcome === "CTC_FAVORS_REAZON") {
    evidenceAtoms.push(
      evidenceAtom({
        family: "CTC_REAZON_DATA_FAMILY",
        tier: "SUPPORT",
        reasonCode: "CTC_SUPPORTS_REAZON",
        correlationGroupId: c60110CorrelationGroups.reazonDataFamily,
        sourceEvidenceIds: input.ctc.sourceEvidenceIds,
      }),
    );
  } else if (input.ctc.outcome === "CTC_FAVORS_WHISPER") {
    evidenceAtoms.push(
      evidenceAtom({
        family: "CTC_REAZON_DATA_FAMILY",
        tier: "CONTRADICTION",
        reasonCode: "CTC_SUPPORTS_WHISPER",
        correlationGroupId: c60110CorrelationGroups.reazonDataFamily,
        sourceEvidenceIds: input.ctc.sourceEvidenceIds,
      }),
    );
  }
  if (!safeExact && !safeNormalized) {
    evidenceAtoms.push(
      evidenceAtom({
        family: "SPAN_LINEAGE",
        tier: "HARD_BLOCK",
        reasonCode: "SPAN_LINEAGE_UNSAFE",
        correlationGroupId: c60110CorrelationGroups.spanLineage,
        sourceEvidenceIds: [input.currentFinalSpanLineage.semanticHash],
      }),
    );
  }
  if (input.crossEventAmbiguity) {
    evidenceAtoms.push(
      evidenceAtom({
        family: "SPEECH_LOCALIZATION",
        tier: "HARD_BLOCK",
        reasonCode: "CROSS_EVENT_AMBIGUITY",
        correlationGroupId: c60110CorrelationGroups.localization,
      }),
    );
  }
  if (reazonHardBlocked) {
    const reasonCode =
      reazonExact === null
        ? ("REAZON_EMPTY" as const)
        : !input.runtimeProvenanceComplete
          ? ("REAZON_RUNTIME_PROVENANCE_INCOMPLETE" as const)
          : input.reazonStability.class === "REAZON_HALLUCINATION_UNSTABLE"
            ? ("REAZON_HALLUCINATION_RISK" as const)
            : input.reazonStability.class === "REAZON_EMPTY_UNSTABLE"
              ? ("REAZON_EMPTY" as const)
              : input.reazonStability.class === "UNCOMPARABLE"
                ? ("REAZON_UNCOMPARABLE" as const)
                : ("REAZON_LEXICALLY_UNSTABLE" as const);
    evidenceAtoms.push(
      evidenceAtom({
        family: "REAZON_STABILITY",
        tier: "HARD_BLOCK",
        reasonCode,
        correlationGroupId: c60110CorrelationGroups.reazonDataFamily,
        sourceEvidenceIds: input.reazonStability.sourceEvidenceIds,
      }),
    );
  }

  const core = {
    evidenceBundleId: `c60110-evidence:${input.eventId}`,
    eventId: input.eventId,
    diagnosticRole: input.diagnosticRole,
    currentFinalCueIds: input.currentFinalCueIds,
    currentFinalSpanLineage: input.currentFinalSpanLineage,
    currentWhisperCandidate: whisper,
    alternateWhisperCandidates: alternates,
    reazonCoreExactCandidate: reazonExact,
    reazonCoreContextCandidate: reazonContext,
    whisperStability: {
      class: input.whisperStability.class,
      negativeEvidence: whisperNegative,
      strongNegativeEvidence: whisperStrongNegative,
      sourceEvidenceIds: input.whisperStability.sourceEvidenceIds,
    },
    reazonStability: {
      class: input.reazonStability.class,
      positiveStabilityEvidence: reazonStable,
      hardBlocked: reazonHardBlocked,
      sourceEvidenceIds: input.reazonStability.sourceEvidenceIds,
    },
    crossModelRelation:
      comparison?.disagreementClass ?? ("UNCOMPARABLE" as const),
    pronunciationRelation:
      reazonExact === null ||
      whisper.pronunciationText === "" ||
      reazonExact.pronunciationText === ""
        ? ("UNAVAILABLE" as const)
        : whisper.pronunciationText === reazonExact.pronunciationText
          ? ("EXACT" as const)
          : normalizedEditSimilarity(
                whisper.pronunciationText,
                reazonExact.pronunciationText,
              ) >= 0.9
            ? ("NEAR" as const)
            : ("DISAGREEMENT" as const),
    whisperHallucinationRisk: whisper.hallucinationRisk,
    reazonHallucinationRisk: reazonExact?.hallucinationRisk ?? null,
    whisperDecoderEvidence: input.whisperDecoderEvidence,
    whisperTokenEvidence: input.whisperTokenEvidence,
    requestEdgeEvidence: input.requestEdgeEvidence,
    speechCompletenessEvidence: input.speechCompletenessEvidence,
    ctcWhisperSupport: input.ctc.whisperSupport,
    ctcReazonSupport: input.ctc.reazonSupport,
    ctcOutcome: input.ctc.outcome,
    ctcScorability:
      input.ctc.outcome === "CTC_NOT_RUN"
        ? ("NOT_RUN" as const)
        : input.ctc.outcome === "CTC_UNSCORABLE"
          ? ("UNSCORABLE" as const)
          : ("SCORABLE" as const),
    coreLocalizationStatus: input.coreLocalizationStatus,
    textSpanLineageStatus: input.currentFinalSpanLineage.lineageStatus,
    mutationSafetyStatus,
    evidenceCorrelationGroups: [
      {
        groupId: c60110CorrelationGroups.whisper,
        families: [
          "WHISPER_STABILITY" as const,
          "WHISPER_DECODER" as const,
          "WHISPER_TOKEN" as const,
          "CROSS_MODEL_RELATION" as const,
        ],
        independentFromGroupIds: [
          c60110CorrelationGroups.reazonDataFamily,
          c60110CorrelationGroups.localization,
          c60110CorrelationGroups.spanLineage,
        ],
        independentVoteCount: 1 as const,
        note: "All Whisper candidates and decoder/token diagnostics share one model family.",
      },
      {
        groupId: c60110CorrelationGroups.reazonDataFamily,
        families: [
          "REAZON_STABILITY" as const,
          "CTC_REAZON_DATA_FAMILY" as const,
        ],
        independentFromGroupIds: [
          c60110CorrelationGroups.whisper,
          c60110CorrelationGroups.localization,
          c60110CorrelationGroups.spanLineage,
        ],
        independentVoteCount: 1 as const,
        note: "Reazon K2 and Japanese CTC are correlated and count as one data/model-family vote.",
      },
      {
        groupId: c60110CorrelationGroups.localization,
        families: ["SPEECH_LOCALIZATION" as const],
        independentFromGroupIds: [
          c60110CorrelationGroups.whisper,
          c60110CorrelationGroups.reazonDataFamily,
          c60110CorrelationGroups.spanLineage,
        ],
        independentVoteCount: 1 as const,
        note: "Acoustic interval and speech completeness evidence are localization evidence.",
      },
      {
        groupId: c60110CorrelationGroups.spanLineage,
        families: ["SPAN_LINEAGE" as const],
        independentFromGroupIds: [
          c60110CorrelationGroups.whisper,
          c60110CorrelationGroups.reazonDataFamily,
          c60110CorrelationGroups.localization,
        ],
        independentVoteCount: 1 as const,
        note: "Exact pipeline provenance gates write-back independently of lexical preference.",
      },
    ],
    evidenceAtoms,
    runtimeGoldInputCount: 0 as const,
  };
  return {
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  };
}

export function buildMachineCrossModelArbitrationEvidence(input: {
  generatedAt: string;
  scope: C60110Scope;
  sourceMediaSha256: string;
  upstreamSemanticHashes: Record<string, string>;
  events: readonly C60110EvidenceEventInput[];
}): MachineCrossModelArbitrationEvidence {
  const events = input.events
    .map(buildCrossModelArbitrationEvidenceBundle)
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId));
  const count = (
    predicate: (event: CrossModelArbitrationEvidenceBundle) => boolean,
  ) => events.filter(predicate).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-cross-model-arbitration-evidence" as const,
    scope: input.scope,
    sourceMediaSha256: input.sourceMediaSha256,
    upstreamSemanticHashes: input.upstreamSemanticHashes,
    goldTextIncluded: false as const,
    rawCrossModelConfidenceCompared: false as const,
    correlationPolicy:
      "REAZON_AND_CTC_CORRELATED_NOT_INDEPENDENT_VOTES" as const,
    events,
    summary: {
      eventCount: events.length,
      exactAgreementCount: count(
        (event) => event.crossModelRelation === "EXACT_AGREEMENT",
      ),
      normalizedAgreementCount: count(
        (event) => event.crossModelRelation === "NORMALIZED_AGREEMENT",
      ),
      orthographyOnlyCount: count(
        (event) => event.crossModelRelation === "ORTHOGRAPHY_ONLY_DIFFERENCE",
      ),
      lexicalDisagreementCount: count(
        (event) => event.crossModelRelation === "LEXICAL_DISAGREEMENT",
      ),
      safeSpanCount: count((event) =>
        event.mutationSafetyStatus.startsWith("SAFE_"),
      ),
      blockedSpanCount: count(
        (event) => !event.mutationSafetyStatus.startsWith("SAFE_"),
      ),
      whisperNegativeEvidenceCount: count(
        (event) => event.whisperStability.negativeEvidence,
      ),
      reazonStableCount: count(
        (event) => event.reazonStability.positiveStabilityEvidence,
      ),
      crossFamilyCorroborationCount: count((event) =>
        event.evidenceAtoms.some(
          (atom) => atom.reasonCode === "WHISPER_ALTERNATE_CORROBORATES_REAZON",
        ),
      ),
      ctcScorableCount: count((event) => event.ctcScorability === "SCORABLE"),
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineCrossModelArbitrationEvidenceSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
