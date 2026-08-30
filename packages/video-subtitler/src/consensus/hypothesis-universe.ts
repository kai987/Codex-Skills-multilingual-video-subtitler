import {
  c61HypothesisInputSchema,
  c61HypothesisEventSchema,
  c61HypothesisPolicyVersion,
  machineMultiAsrHypothesisUniverseSchema,
  type C61Hypothesis,
  type C61HypothesisEvent,
  type C61HypothesisInput,
  type C61HypothesisUniverse,
} from "@mvl/shared";

import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";

/** NFKC and spacing only: homophones and lexical punctuation are not erased. */
export function normalizeC61HypothesisText(value: string): string {
  return value
    .replace(/\\[Nn]/gu, "\n")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted();
}

function compatibleInterval(
  candidate: C61HypothesisInput,
  event: C61HypothesisEvent,
): boolean {
  if (candidate.sourceInterval === null) return false;
  const interval = candidate.sourceInterval;
  const overlap = Math.max(
    0,
    Math.min(interval.end, event.sourceInterval.end) -
      Math.max(interval.start, event.sourceInterval.start),
  );
  // Explicit event identity is necessary but never makes a disjoint interval valid.
  return overlap > 0 && overlap / (interval.end - interval.start) >= 0.5;
}

function initialCandidate(
  input: C61HypothesisInput,
  event: C61HypothesisEvent | undefined,
): Omit<C61Hypothesis, "semanticHash"> {
  const candidateId = `c61-candidate:${hash(input.inputRecordId).slice(0, 24)}`;
  let inclusionStatus: C61Hypothesis["inclusionStatus"] = "INCLUDED";
  const inclusionReasons: string[] = [];
  if (input.hardRejectionReasons.length > 0) {
    inclusionStatus = "HARD_REJECTED";
    inclusionReasons.push(...input.hardRejectionReasons);
  } else if (
    input.modelIdentity === null ||
    input.requestId === null ||
    input.provenanceHashes.length === 0 ||
    !input.lineageVerified
  ) {
    inclusionStatus = "UNSUPPORTED_PROVENANCE";
    inclusionReasons.push("MODEL_REQUEST_OR_EXPLICIT_LINEAGE_UNVERIFIED");
  } else if (
    event === undefined ||
    !input.sourceGlobalVerified ||
    input.localizationBlockers.length > 0 ||
    !compatibleInterval(input, event)
  ) {
    inclusionStatus = "UNLOCALIZABLE";
    inclusionReasons.push(
      "SOURCE_EVENT_INTERVAL_NOT_SAFELY_LOCALIZED",
      ...input.localizationBlockers,
    );
  } else if (normalizeC61HypothesisText(input.displayText) === "") {
    inclusionStatus = "HARD_REJECTED";
    inclusionReasons.push("EMPTY_HYPOTHESIS_TEXT");
  } else {
    inclusionReasons.push(
      input.providerFamily === "CURRENT"
        ? "DERIVED_CURRENT_CONTROL_NOT_AN_INDEPENDENT_VOTE"
        : "EXPLICIT_MACHINE_LINEAGE_AND_COMPATIBLE_INTERVAL",
    );
  }
  const trustedPronunciation =
    input.pronunciationEvidenceId !== null &&
    input.pronunciationText !== null &&
    input.pronunciationText.trim() !== "";
  const groupFamily =
    input.providerFamily === "REAZON"
      ? "REAZON_CORE_FAMILY"
      : input.providerFamily === "CURRENT"
        ? "DERIVED_CURRENT_FAMILY"
        : input.candidateRole.includes("CORE")
          ? "WHISPER_CORE_WINDOW_FAMILY"
          : input.candidateRole.includes("RE_ASR")
            ? "WHISPER_RE_ASR_FAMILY"
            : "WHISPER_PRIMARY_FAMILY";
  return {
    inputRecordId: input.inputRecordId,
    candidateId,
    sourceCandidateId: input.sourceCandidateId,
    eventId: input.eventId,
    providerFamily: input.providerFamily,
    modelIdentity: input.modelIdentity,
    requestId: input.requestId,
    windowType: input.windowType,
    sourceInterval: input.sourceInterval,
    displayText: input.displayText,
    normalizedText: normalizeC61HypothesisText(input.displayText),
    pronunciationText: trustedPronunciation ? input.pronunciationText : null,
    pronunciationEvidenceId: trustedPronunciation
      ? input.pronunciationEvidenceId
      : null,
    candidateRole: input.candidateRole,
    inclusionStatus,
    inclusionReasons: sortedUnique(inclusionReasons),
    representativeCandidateId: null,
    correlationGroupId: `${groupFamily}:${hash({
      provider: input.providerFamily,
      model: input.modelIdentity,
      eventId: input.eventId,
      lineage: sortedUnique(input.correlationLineage),
    }).slice(0, 24)}`,
    independentVoteEligible:
      input.providerFamily !== "CURRENT" && inclusionStatus === "INCLUDED",
    provenanceHash: hash({
      sourceCandidateId: input.sourceCandidateId,
      eventId: input.eventId,
      modelIdentity: input.modelIdentity,
      requestId: input.requestId,
      sourceInterval: input.sourceInterval,
      hashes: sortedUnique(input.provenanceHashes),
    }),
  };
}

export function buildC61HypothesisUniverse(input: {
  events: readonly C61HypothesisEvent[];
  candidates: readonly C61HypothesisInput[];
  sourceArtifactHashes: Readonly<Record<string, string>>;
}): C61HypothesisUniverse {
  const events = input.events
    .map((event) => c61HypothesisEventSchema.parse(event))
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId));
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error("C61_DUPLICATE_EVENT_ID");
  }
  const inputs = input.candidates.map((candidate) =>
    c61HypothesisInputSchema.parse(candidate),
  );
  if (
    new Set(inputs.map((candidate) => candidate.inputRecordId)).size !==
    inputs.length
  ) {
    throw new Error("C61_DUPLICATE_INPUT_RECORD_ID");
  }
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const candidates = inputs
    .map((candidate) =>
      initialCandidate(
        candidate,
        candidate.eventId === null
          ? undefined
          : eventById.get(candidate.eventId),
      ),
    )
    .toSorted(
      (left, right) =>
        Number(right.pronunciationText !== null) -
          Number(left.pronunciationText !== null) ||
        left.candidateId.localeCompare(right.candidateId),
    );
  const normalized = new Map<string, string>();
  const pronunciation = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.inclusionStatus !== "INCLUDED") continue;
    // Do not collapse the same words across independent providers, or erase a
    // homophonic surface. Pronunciation equivalence remains an alignment label.
    const key = hash({
      eventId: candidate.eventId,
      providerFamily: candidate.providerFamily,
      normalizedText: candidate.normalizedText,
    });
    const representative = normalized.get(key);
    if (representative !== undefined) {
      candidate.inclusionStatus = "NORMALIZED_DUPLICATE";
      candidate.representativeCandidateId = representative;
      candidate.independentVoteEligible = false;
      candidate.inclusionReasons.push("SAME_PROVIDER_NORMALIZED_DUPLICATE");
    } else {
      normalized.set(key, candidate.candidateId);
      if (candidate.pronunciationText !== null) {
        const phoneticKey = hash({
          eventId: candidate.eventId,
          providerFamily: candidate.providerFamily,
          pronunciationText: candidate.pronunciationText,
        });
        if (pronunciation.has(phoneticKey)) {
          candidate.inclusionReasons.push(
            "PRONUNCIATION_EQUIVALENT_SURFACE_RETAINED",
          );
        } else pronunciation.set(phoneticKey, candidate.candidateId);
      }
    }
  }
  const finalized = candidates
    .map((candidate) => ({ ...candidate, semanticHash: hash(candidate) }))
    .toSorted((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    );
  const eventScopes: C61HypothesisUniverse["eventScopes"] = events.map(
    (event) => {
      const included = finalized.filter(
        (candidate) =>
          candidate.eventId === event.eventId &&
          candidate.inclusionStatus === "INCLUDED",
      );
      const independent = included.filter(
        (candidate) => candidate.providerFamily !== "CURRENT",
      );
      const providerFamilies = sortedUnique(
        independent.map((candidate) => candidate.providerFamily),
      ) as ("WHISPER" | "REAZON")[];
      const normalizedDistinctCount = new Set(
        independent.map((candidate) => candidate.normalizedText),
      ).size;
      const core = {
        eventId: event.eventId,
        scope:
          independent.length === 0
            ? ("UNLOCALIZABLE" as const)
            : normalizedDistinctCount < 2
              ? ("SINGLE_HYPOTHESIS_CONTROL" as const)
              : providerFamilies.length > 1
                ? ("WHISPER_REAZON_MULTI_PROVIDER" as const)
                : ("WHISPER_ONLY_MULTI_HYPOTHESIS" as const),
        includedCandidateIds: included.map(
          (candidate) => candidate.candidateId,
        ),
        independentCandidateCount: independent.length,
        normalizedDistinctCount,
        providerFamilies,
      };
      return { ...core, semanticHash: hash(core) };
    },
  );
  const statusCount = (status: C61Hypothesis["inclusionStatus"]): number =>
    finalized.filter((candidate) => candidate.inclusionStatus === status)
      .length;
  const scopeCount = (
    scope: C61HypothesisUniverse["eventScopes"][number]["scope"],
  ): number => eventScopes.filter((event) => event.scope === scope).length;
  const providerCount = (
    provider: C61Hypothesis["providerFamily"],
    included = false,
  ): number =>
    finalized.filter(
      (candidate) =>
        candidate.providerFamily === provider &&
        (!included || candidate.inclusionStatus === "INCLUDED"),
    ).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    artifactType: "machine-multi-asr-hypothesis-universe" as const,
    policyVersion: c61HypothesisPolicyVersion,
    runtimeGoldInputCount: 0 as const,
    humanMemoryInputCount: 0 as const,
    sourceArtifactHashes: Object.fromEntries(
      Object.entries(input.sourceArtifactHashes).toSorted(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    events,
    candidates: finalized,
    eventScopes,
    summary: {
      inputCandidateCount: inputs.length,
      includedCandidateCount: statusCount("INCLUDED"),
      normalizedDuplicateCount: statusCount("NORMALIZED_DUPLICATE"),
      pronunciationEquivalentCount: statusCount("PRONUNCIATION_EQUIVALENT"),
      hardRejectedCount: statusCount("HARD_REJECTED"),
      unlocalizableCandidateCount: statusCount("UNLOCALIZABLE"),
      unsupportedProvenanceCount: statusCount("UNSUPPORTED_PROVENANCE"),
      unaccountedCandidateCount: 0 as const,
      canonicalEventCount: events.length,
      multiHypothesisEventCount: eventScopes.filter(
        (event) => event.normalizedDistinctCount >= 2,
      ).length,
      multiProviderEventCount: scopeCount("WHISPER_REAZON_MULTI_PROVIDER"),
      whisperOnlyMultiHypothesisEventCount: scopeCount(
        "WHISPER_ONLY_MULTI_HYPOTHESIS",
      ),
      singleHypothesisControlCount: scopeCount("SINGLE_HYPOTHESIS_CONTROL"),
      unlocalizableEventCount: scopeCount("UNLOCALIZABLE"),
      whisperInputCount: providerCount("WHISPER"),
      reazonInputCount: providerCount("REAZON"),
      currentInputCount: providerCount("CURRENT"),
      includedWhisperCount: providerCount("WHISPER", true),
      includedReazonCount: providerCount("REAZON", true),
      correlationGroupCount: new Set(
        finalized
          .filter((candidate) => candidate.independentVoteEligible)
          .map((candidate) => candidate.correlationGroupId),
      ).size,
      trustedPronunciationCount: finalized.filter(
        (candidate) => candidate.pronunciationText !== null,
      ).length,
    },
  };
  return machineMultiAsrHypothesisUniverseSchema.parse({
    ...core,
    semanticHash: hash(core),
  });
}
