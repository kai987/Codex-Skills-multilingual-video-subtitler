import type { SubtitlePackage } from "@mvl/shared";

import type { C60112MachineReviewSignal } from "./review-item-builder.js";
import type { C60112ReviewCandidateInput } from "./review-candidate-bundle.js";
import type {
  C60112ReviewItemType,
  C60112ReviewReasonCode,
} from "./c60112-policy.js";

interface LegacyReviewEvent {
  id: string;
  category:
    "mixed" | "low-confidence-text" | "missing-dialogue" | "hallucination";
  interval: { start: number; end: number };
  reviewGroupIds: string[];
  findingIds: string[];
  finalCueIds: string[];
  sceneIds: string[];
  subIntervals: { start: number; end: number }[];
  userAction: string;
}

interface ArbitrationCandidate {
  candidateId: string;
  displayText: string;
  semanticHash: string;
}

interface ArbitrationEvent {
  eventId: string;
  currentFinalCueIds: string[];
  currentWhisperCandidate: ArbitrationCandidate;
  alternateWhisperCandidates: ArbitrationCandidate[];
  reazonCoreExactCandidate: ArbitrationCandidate | null;
  reazonCoreContextCandidate: ArbitrationCandidate | null;
  whisperStability: {
    class: string;
    negativeEvidence: boolean;
    sourceEvidenceIds: string[];
  };
  reazonStability: {
    class: string;
    hardBlocked: boolean;
    sourceEvidenceIds: string[];
  };
  crossModelRelation: string;
  whisperHallucinationRisk: number;
  reazonHallucinationRisk: number;
  coreLocalizationStatus: string;
  textSpanLineageStatus: string;
  semanticHash: string;
}

interface CorpusEvent {
  eventId: string;
  sourceInterval: { start: number; end: number };
  coreInterval: { start: number; end: number };
  role: string;
  semanticHash: string;
}

interface IndependentEvent {
  eventId: string;
  outcome: string;
  scorability: string;
  pairwiseMargin: number | null;
  semanticHash: string;
}

interface PairedWhisperCandidate extends ArbitrationCandidate {
  sourceInterval: { start: number; end: number };
}

interface PairedWhisperEvent {
  eventId: string;
  whisperCoreExact: PairedWhisperCandidate | null;
  whisperCoreContext: PairedWhisperCandidate | null;
  stabilityClass: string;
  semanticHash: string;
}

interface AcousticRiskEvent {
  eventId: string;
  candidateId: string;
  facts: {
    name: string;
    severity: "NONE" | "WEAK" | "STRONG";
    evidenceIds: string[];
  }[];
  semanticHash: string;
}

interface OverlapPair {
  pairId: string;
  leftCueId: string;
  rightCueId: string;
  interval: { start: number; end: number };
  automaticallyResolved: boolean;
}

interface SpeechGap {
  id: string;
  start: number;
  end: number;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function records(value: unknown, key: string): unknown[] {
  if (value === null || typeof value !== "object") return [];
  return asArray<unknown>((value as Record<string, unknown>)[key]);
}

function intervalOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function intersects(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function categoryTypes(event: LegacyReviewEvent): C60112ReviewItemType[] {
  switch (event.category) {
    case "hallucination":
      return ["TEXT_HALLUCINATION_RISK"];
    case "missing-dialogue":
      return ["MISSING_SPEECH_RISK"];
    case "mixed":
      return ["GENERAL_UNCERTAINTY", "TIMING_BOUNDARY_RISK"];
    case "low-confidence-text":
      return ["GENERAL_UNCERTAINTY"];
  }
}

function categoryReasons(event: LegacyReviewEvent): C60112ReviewReasonCode[] {
  switch (event.category) {
    case "hallucination":
      return ["WHISPER_HALLUCINATION_SIGNAL"];
    case "missing-dialogue":
      return ["MISSING_DIALOGUE_SUSPECTED"];
    case "mixed":
      return ["TIMING_EVIDENCE_CONFLICT", "MACHINE_EVIDENCE_INCOMPLETE"];
    case "low-confidence-text":
      return ["MACHINE_EVIDENCE_INCOMPLETE"];
  }
}

function pushType(
  types: Set<C60112ReviewItemType>,
  reasons: Set<C60112ReviewReasonCode>,
  type: C60112ReviewItemType,
  reason: C60112ReviewReasonCode,
): void {
  types.add(type);
  reasons.add(reason);
}

function safeCore(
  event: LegacyReviewEvent,
  corpus: readonly CorpusEvent[],
): { start: number; end: number } {
  const intervals = corpus
    .map((entry) => entry.coreInterval)
    .filter((interval) => intervalOverlap(interval, event.interval) > 0);
  if (intervals.length === 0) {
    const sub = event.subIntervals[0];
    return sub === undefined
      ? { ...event.interval }
      : {
          start: Math.max(event.interval.start, sub.start),
          end: Math.min(event.interval.end, sub.end),
        };
  }
  const start = Math.max(
    event.interval.start,
    Math.min(...intervals.map((interval) => interval.start)),
  );
  const end = Math.min(
    event.interval.end,
    Math.max(...intervals.map((interval) => interval.end)),
  );
  return end > start ? { start, end } : { ...event.interval };
}

export function adaptC60112MachineArtifacts(input: {
  subtitlePackage: SubtitlePackage;
  finalReviewQueue: unknown;
  arbitrationEvidence: unknown;
  calibrationCorpus: unknown;
  independentAcoustic: unknown;
  pairedWhisper: unknown;
  acousticRisk: unknown;
  overlapClassification: unknown;
  speechCoverage: unknown;
}): C60112MachineReviewSignal[] {
  const reviewEvents = records(
    input.finalReviewQueue,
    "events",
  ) as LegacyReviewEvent[];
  const arbitrationEvents = records(
    input.arbitrationEvidence,
    "events",
  ) as ArbitrationEvent[];
  const corpusEvents = records(
    input.calibrationCorpus,
    "events",
  ) as CorpusEvent[];
  const independentEvents = records(
    input.independentAcoustic,
    "events",
  ) as IndependentEvent[];
  const pairedWhisperEvents = records(
    input.pairedWhisper,
    "events",
  ) as PairedWhisperEvent[];
  const riskEvents = records(
    input.acousticRisk,
    "events",
  ) as AcousticRiskEvent[];
  const overlapPairs = records(
    input.overlapClassification,
    "pairs",
  ) as OverlapPair[];
  const speechGaps = records(input.speechCoverage, "gaps") as SpeechGap[];
  const cueById = new Map(
    input.subtitlePackage.cues.map((cue) => [cue.id, cue]),
  );
  const corpusByEvent = new Map(
    corpusEvents.map((event) => [event.eventId, event]),
  );
  const independentByEvent = new Map(
    independentEvents.map((event) => [event.eventId, event]),
  );
  const pairedByEvent = new Map(
    pairedWhisperEvents.map((event) => [event.eventId, event]),
  );

  return reviewEvents.map((reviewEvent): C60112MachineReviewSignal => {
    const types = new Set(categoryTypes(reviewEvent));
    const reasons = new Set(categoryReasons(reviewEvent));
    const evidenceIds = new Set(reviewEvent.findingIds);
    const candidateIds = new Set<string>();
    const eventIds = new Set<string>([reviewEvent.id]);
    const matchedArbitration = arbitrationEvents.filter((event) => {
      if (intersects(reviewEvent.finalCueIds, event.currentFinalCueIds))
        return true;
      const corpus = corpusByEvent.get(event.eventId);
      if (corpus === undefined) return false;
      const overlap = intervalOverlap(
        reviewEvent.interval,
        corpus.coreInterval,
      );
      return (
        overlap >=
        Math.min(0.5, corpus.coreInterval.end - corpus.coreInterval.start)
      );
    });
    for (const arbitration of matchedArbitration) {
      eventIds.add(arbitration.eventId);
      evidenceIds.add(arbitration.semanticHash);
      candidateIds.add(arbitration.currentWhisperCandidate.candidateId);
      arbitration.alternateWhisperCandidates.forEach((candidate) =>
        candidateIds.add(candidate.candidateId),
      );
      if (arbitration.reazonCoreExactCandidate !== null)
        candidateIds.add(arbitration.reazonCoreExactCandidate.candidateId);
      if (arbitration.reazonCoreContextCandidate !== null)
        candidateIds.add(arbitration.reazonCoreContextCandidate.candidateId);
      if (!arbitration.crossModelRelation.includes("AGREEMENT")) {
        pushType(
          types,
          reasons,
          "TEXT_CROSS_MODEL_DISAGREEMENT",
          "WHISPER_REAZON_LEXICAL_CONFLICT",
        );
      }
      if (arbitration.whisperStability.negativeEvidence) {
        pushType(
          types,
          reasons,
          "TEXT_WHISPER_INSTABILITY",
          "WHISPER_CORE_UNSTABLE",
        );
      }
      if (
        arbitration.reazonStability.hardBlocked ||
        arbitration.reazonStability.class.includes("UNSTABLE")
      ) {
        pushType(
          types,
          reasons,
          "TEXT_REAZON_INSTABILITY",
          "REAZON_CORE_UNSTABLE",
        );
      }
      if (
        arbitration.whisperHallucinationRisk >= 0.5 ||
        arbitration.reazonHallucinationRisk >= 0.5
      ) {
        pushType(
          types,
          reasons,
          "TEXT_HALLUCINATION_RISK",
          "WHISPER_HALLUCINATION_SIGNAL",
        );
      }
      if (arbitration.coreLocalizationStatus !== "MACHINE_LOCALIZABLE") {
        pushType(types, reasons, "LOCALIZATION_RISK", "LOCALIZATION_AMBIGUOUS");
      }
      if (
        /UNAVAILABLE|AMBIGUOUS|BLOCKED/u.test(arbitration.textSpanLineageStatus)
      ) {
        pushType(
          types,
          reasons,
          "SPAN_LINEAGE_BLOCKED",
          "SPAN_LINEAGE_UNAVAILABLE",
        );
      }
      const independent = independentByEvent.get(arbitration.eventId);
      if (independent !== undefined) {
        evidenceIds.add(independent.semanticHash);
        if (independent.scorability !== "SCORABLE") {
          pushType(
            types,
            reasons,
            "TEXT_LOW_ACOUSTIC_SUPPORT",
            "MACHINE_EVIDENCE_INCOMPLETE",
          );
        } else if (independent.outcome !== "INDEPENDENT_NEAR_TIE") {
          reasons.add("INDEPENDENT_ACOUSTIC_DISAGREEMENT");
        } else {
          reasons.add("INDEPENDENT_ACOUSTIC_LOW_MARGIN");
        }
      }
      const paired = pairedByEvent.get(arbitration.eventId);
      if (paired !== undefined) {
        evidenceIds.add(paired.semanticHash);
        if (paired.whisperCoreExact !== null)
          candidateIds.add(paired.whisperCoreExact.candidateId);
        if (paired.whisperCoreContext !== null)
          candidateIds.add(paired.whisperCoreContext.candidateId);
      }
    }
    const matchedRisks = riskEvents.filter(
      (risk) =>
        reviewEvent.finalCueIds.includes(risk.candidateId) ||
        eventIds.has(risk.eventId),
    );
    for (const risk of matchedRisks) {
      evidenceIds.add(risk.semanticHash);
      for (const fact of risk.facts.filter(
        (candidate) => candidate.severity !== "NONE",
      )) {
        fact.evidenceIds.forEach((id) => evidenceIds.add(id));
        if (fact.name === "overlapRisk")
          pushType(types, reasons, "OVERLAP_RISK", "OVERLAP_UNRESOLVED");
        if (fact.name === "associationAmbiguity")
          pushType(
            types,
            reasons,
            "LOCALIZATION_RISK",
            "LOCALIZATION_AMBIGUOUS",
          );
        if (fact.name === "speechIncomplete")
          pushType(
            types,
            reasons,
            "MISSING_SPEECH_RISK",
            "MISSING_DIALOGUE_SUSPECTED",
          );
        if (fact.name === "decoderWeak") reasons.add("DECODER_WEAK");
        if (fact.name === "requestEdgeRisk") reasons.add("REQUEST_EDGE_RISK");
      }
    }
    const matchedOverlaps = overlapPairs.filter(
      (pair) =>
        !pair.automaticallyResolved &&
        (reviewEvent.finalCueIds.includes(pair.leftCueId) ||
          reviewEvent.finalCueIds.includes(pair.rightCueId) ||
          intervalOverlap(reviewEvent.interval, pair.interval) > 0),
    );
    if (matchedOverlaps.length > 0) {
      pushType(types, reasons, "OVERLAP_RISK", "OVERLAP_UNRESOLVED");
      matchedOverlaps.forEach((pair) => evidenceIds.add(pair.pairId));
    }
    if (
      speechGaps.some(
        (gap) =>
          intervalOverlap(reviewEvent.interval, {
            start: gap.start,
            end: gap.end,
          }) > 0.25,
      )
    ) {
      pushType(
        types,
        reasons,
        "MISSING_SPEECH_RISK",
        "MISSING_DIALOGUE_SUSPECTED",
      );
    }
    const currentText = reviewEvent.finalCueIds
      .map((cueId) => cueById.get(cueId)?.text)
      .filter((value): value is string => value !== undefined)
      .join("\n");
    const matchedCorpus = matchedArbitration
      .map((event) => corpusByEvent.get(event.eventId))
      .filter((value): value is CorpusEvent => value !== undefined);
    return {
      reviewGroupId: reviewEvent.reviewGroupIds[0] ?? reviewEvent.id,
      eventIds: [...eventIds],
      finalCueIds: [...reviewEvent.finalCueIds],
      itemTypes: [...types],
      sourceInterval: { ...reviewEvent.interval },
      coreInterval: safeCore(reviewEvent, matchedCorpus),
      currentText: currentText === "" ? null : currentText,
      candidateIds: [...candidateIds],
      evidenceIds: [...evidenceIds],
      reviewReasons: [...reasons],
      sceneIds: [...reviewEvent.sceneIds],
      speakerGroupIds: [],
    };
  });
}

function badgesForStability(
  value: string,
): C60112ReviewCandidateInput["evidenceBadges"] {
  if (value.includes("HALLUCINATION"))
    return ["HALLUCINATION_RISK", "LEXICALLY_UNSTABLE"];
  if (value.includes("LEXICALLY_UNSTABLE")) return ["LEXICALLY_UNSTABLE"];
  if (value.includes("CONTEXT_EXTENSION")) return ["CONTEXT_EXTENSION_ONLY"];
  if (value.includes("STABLE")) return ["STABLE"];
  return [];
}

export function adaptC60112ReviewCandidates(input: {
  arbitrationEvidence: unknown;
  calibrationCorpus: unknown;
  pairedWhisper: unknown;
  independentAcoustic: unknown;
}): C60112ReviewCandidateInput[] {
  const arbitrationEvents = records(
    input.arbitrationEvidence,
    "events",
  ) as ArbitrationEvent[];
  const corpusEvents = records(
    input.calibrationCorpus,
    "events",
  ) as CorpusEvent[];
  const pairedEvents = records(
    input.pairedWhisper,
    "events",
  ) as PairedWhisperEvent[];
  const independentEvents = records(
    input.independentAcoustic,
    "events",
  ) as IndependentEvent[];
  const corpusByEvent = new Map(
    corpusEvents.map((event) => [event.eventId, event]),
  );
  const pairedByEvent = new Map(
    pairedEvents.map((event) => [event.eventId, event]),
  );
  const independentByEvent = new Map(
    independentEvents.map((event) => [event.eventId, event]),
  );
  const candidates = new Map<string, C60112ReviewCandidateInput>();
  const add = (candidate: C60112ReviewCandidateInput): void => {
    const existing = candidates.get(candidate.candidateId);
    if (existing === undefined) {
      candidates.set(candidate.candidateId, candidate);
      return;
    }
    if (existing.displayText !== candidate.displayText) {
      throw new Error(`CANDIDATE_TEXT_CONFLICT:${candidate.candidateId}`);
    }
  };
  for (const event of arbitrationEvents) {
    const interval = corpusByEvent.get(event.eventId)?.coreInterval ?? null;
    const independent = independentByEvent.get(event.eventId);
    const acousticBadge: C60112ReviewCandidateInput["evidenceBadges"] =
      independent?.outcome === "INDEPENDENT_FAVORS_REAZON"
        ? ["ACOUSTIC_FAVORED"]
        : independent?.outcome === "INDEPENDENT_NEAR_TIE"
          ? ["NEAR_TIE"]
          : [];
    add({
      candidateId: event.currentWhisperCandidate.candidateId,
      label: "WHISPER",
      displayText: event.currentWhisperCandidate.displayText,
      sourceInterval: interval,
      evidenceIds: [
        event.semanticHash,
        ...event.whisperStability.sourceEvidenceIds,
      ],
      provenanceIds: [
        event.currentWhisperCandidate.semanticHash,
        event.eventId,
      ],
      evidenceBadges: badgesForStability(event.whisperStability.class),
    });
    for (const candidate of event.alternateWhisperCandidates) {
      add({
        candidateId: candidate.candidateId,
        label: "WHISPER_ALT",
        displayText: candidate.displayText,
        sourceInterval: interval,
        evidenceIds: [event.semanticHash],
        provenanceIds: [candidate.semanticHash, event.eventId],
        evidenceBadges: badgesForStability(event.whisperStability.class),
      });
    }
    for (const candidate of [
      event.reazonCoreExactCandidate,
      event.reazonCoreContextCandidate,
    ]) {
      if (candidate === null) continue;
      add({
        candidateId: candidate.candidateId,
        label: "REAZON",
        displayText: candidate.displayText,
        sourceInterval: interval,
        evidenceIds: [
          event.semanticHash,
          ...event.reazonStability.sourceEvidenceIds,
        ],
        provenanceIds: [candidate.semanticHash, event.eventId],
        evidenceBadges: [
          ...badgesForStability(event.reazonStability.class),
          ...acousticBadge,
        ],
      });
    }
    const paired = pairedByEvent.get(event.eventId);
    if (paired !== undefined) {
      for (const candidate of [
        paired.whisperCoreExact,
        paired.whisperCoreContext,
      ]) {
        if (candidate === null) continue;
        add({
          candidateId: candidate.candidateId,
          label: "WHISPER_ALT",
          displayText: candidate.displayText,
          sourceInterval: candidate.sourceInterval,
          evidenceIds: [paired.semanticHash],
          provenanceIds: [candidate.semanticHash, paired.eventId],
          evidenceBadges: badgesForStability(paired.stabilityClass),
        });
      }
    }
  }
  return [...candidates.values()].toSorted((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
}
