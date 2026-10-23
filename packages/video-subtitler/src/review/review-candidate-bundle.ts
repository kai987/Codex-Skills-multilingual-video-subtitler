import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "../machine-quality/evidence-correlation.js";
import {
  assertC60112Interval,
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  type C60112Interval,
  type C60112ReviewItem,
  type C60112ReviewPolicy,
  type C60112SuggestedAction,
} from "./c60112-policy.js";

export const C60112_CANDIDATE_LABELS = [
  "CURRENT",
  "WHISPER",
  "WHISPER_ALT",
  "REAZON",
] as const;

export type C60112CandidateLabel = (typeof C60112_CANDIDATE_LABELS)[number];

export const C60112_EVIDENCE_BADGES = [
  "STABLE",
  "CONTEXT_EXTENSION_ONLY",
  "LEXICALLY_UNSTABLE",
  "HALLUCINATION_RISK",
  "ACOUSTIC_FAVORED",
  "ACOUSTIC_DISFAVORED",
  "NEAR_TIE",
  "LOW_TOKEN_SUPPORT",
  "TIMING_UNCERTAIN",
  "LOCALIZATION_SAFE",
  "LOCALIZATION_AMBIGUOUS",
  "EVIDENCE_UNAVAILABLE",
] as const;

export type C60112EvidenceBadge = (typeof C60112_EVIDENCE_BADGES)[number];

export interface C60112ReviewCandidateInput {
  candidateId: string;
  label: C60112CandidateLabel;
  displayText: string;
  sourceInterval: C60112Interval | null;
  evidenceIds: readonly string[];
  provenanceIds: readonly string[];
  evidenceBadges: readonly C60112EvidenceBadge[];
}

export interface C60112CandidateProvenance {
  candidateId: string;
  label: C60112CandidateLabel;
  sourceInterval: C60112Interval | null;
  evidenceIds: string[];
  provenanceIds: string[];
  evidenceBadges: C60112EvidenceBadge[];
}

export interface C60112DisplayCandidate {
  displayCandidateId: string;
  displayText: string;
  normalizedTextHash: string;
  labels: C60112CandidateLabel[];
  evidenceBadges: C60112EvidenceBadge[];
  provenance: C60112CandidateProvenance[];
  semanticHash: string;
}

export interface C60112ReviewCandidateBundle {
  reviewItemId: string;
  displayCandidates: C60112DisplayCandidate[];
  missingCandidateIds: string[];
  availableActions: C60112SuggestedAction[];
  selectionAuthority: "HUMAN_ONLY";
  calibratedConfidencePercentageDisplayed: false;
  semanticHash: string;
}

export interface C60112ReviewCandidateBundlesArtifact {
  schemaVersion: "1.0.0";
  policyVersion: C60112ReviewPolicy["policyVersion"];
  artifactType: "c6-0-1-12-machine-review-candidate-bundles";
  policyHash: string;
  runtimeGoldInputCount: 0;
  bundles: C60112ReviewCandidateBundle[];
  summary: {
    reviewItemCount: number;
    displayCandidateCount: number;
    collapsedDuplicateCount: number;
    missingCandidateReferenceCount: number;
    candidateActionableItemCount: number;
  };
  semanticHash: string;
}

const LABEL_ORDER: Readonly<Record<C60112CandidateLabel, number>> = {
  CURRENT: 0,
  WHISPER: 1,
  WHISPER_ALT: 2,
  REAZON: 3,
};

function uniqueSorted(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].toSorted();
}

function assertNoUncalibratedConfidence(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertNoUncalibratedConfidence);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLocaleLowerCase("en-US");
    if (
      normalized === "confidence" ||
      normalized === "confidencepercent" ||
      normalized === "probability"
    ) {
      throw new Error(`UNCALIBRATED_CANDIDATE_CONFIDENCE_FORBIDDEN:${key}`);
    }
    assertNoUncalibratedConfidence(entry);
  }
}

function validateCandidate(candidate: C60112ReviewCandidateInput): void {
  if (candidate.candidateId.trim() === "") {
    throw new Error("CANDIDATE_ID_REQUIRED");
  }
  if (candidate.displayText.trim() === "") {
    throw new Error(`CANDIDATE_TEXT_REQUIRED:${candidate.candidateId}`);
  }
  if (candidate.sourceInterval !== null) {
    assertC60112Interval(
      candidate.sourceInterval,
      `candidate-${candidate.candidateId}`,
    );
  }
}

function synthesizedCurrentCandidate(
  item: C60112ReviewItem,
): C60112ReviewCandidateInput | null {
  if (item.currentText === null || item.currentText.trim() === "") return null;
  return {
    candidateId: `current-final:${item.reviewItemId}`,
    label: "CURRENT",
    displayText: item.currentText,
    sourceInterval: item.coreInterval,
    evidenceIds: item.evidenceIds,
    provenanceIds: item.finalCueIds.map((cueId) => `final-cue:${cueId}`),
    evidenceBadges: [],
  };
}

function provenanceFor(
  candidate: C60112ReviewCandidateInput,
): C60112CandidateProvenance {
  return {
    candidateId: candidate.candidateId,
    label: candidate.label,
    sourceInterval:
      candidate.sourceInterval === null
        ? null
        : { ...candidate.sourceInterval },
    evidenceIds: uniqueSorted(candidate.evidenceIds),
    provenanceIds: uniqueSorted(candidate.provenanceIds),
    evidenceBadges: [...new Set(candidate.evidenceBadges)].toSorted(),
  };
}

function finalizeDisplayCandidate(
  reviewItemId: string,
  normalizedText: string,
  members: readonly C60112ReviewCandidateInput[],
): C60112DisplayCandidate {
  const orderedMembers = [...members].toSorted(
    (left, right) =>
      LABEL_ORDER[left.label] - LABEL_ORDER[right.label] ||
      left.candidateId.localeCompare(right.candidateId),
  );
  const first = orderedMembers[0];
  if (first === undefined) throw new Error("EMPTY_DISPLAY_CANDIDATE");
  const normalizedTextHash = machineQualitySemanticHash(normalizedText);
  const itemScopedCandidateHash = machineQualitySemanticHash({
    reviewItemId,
    normalizedText,
  });
  const core = {
    displayCandidateId: `display-candidate-${itemScopedCandidateHash.slice(0, 20)}`,
    displayText: first.displayText,
    normalizedTextHash,
    labels: [...new Set(orderedMembers.map((member) => member.label))].toSorted(
      (left, right) => LABEL_ORDER[left] - LABEL_ORDER[right],
    ),
    evidenceBadges: [
      ...new Set(orderedMembers.flatMap((member) => member.evidenceBadges)),
    ].toSorted(),
    provenance: orderedMembers.map(provenanceFor),
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

function buildBundle(
  item: C60112ReviewItem,
  candidateById: ReadonlyMap<string, C60112ReviewCandidateInput>,
): C60112ReviewCandidateBundle {
  const missingCandidateIds = item.candidateIds
    .filter((candidateId) => !candidateById.has(candidateId))
    .toSorted();
  const candidates = item.candidateIds
    .map((candidateId) => candidateById.get(candidateId))
    .filter(
      (candidate): candidate is C60112ReviewCandidateInput =>
        candidate !== undefined,
    );
  const current = synthesizedCurrentCandidate(item);
  if (current !== null) candidates.push(current);
  const byNormalizedText = new Map<string, C60112ReviewCandidateInput[]>();
  for (const candidate of candidates) {
    const normalized = normalizeCandidateText(candidate.displayText);
    const members = byNormalizedText.get(normalized) ?? [];
    members.push(candidate);
    byNormalizedText.set(normalized, members);
  }
  const displayCandidates = [...byNormalizedText.entries()]
    .map(([normalized, members]) =>
      finalizeDisplayCandidate(item.reviewItemId, normalized, members),
    )
    .toSorted((left, right) => {
      const leftOrder = Math.min(
        ...left.labels.map((label) => LABEL_ORDER[label]),
      );
      const rightOrder = Math.min(
        ...right.labels.map((label) => LABEL_ORDER[label]),
      );
      return (
        leftOrder - rightOrder ||
        left.displayCandidateId.localeCompare(right.displayCandidateId)
      );
    });
  const displayedLabels = new Set(
    displayCandidates.flatMap((candidate) => candidate.labels),
  );
  const availableActions = new Set<C60112SuggestedAction>([
    "MANUAL_EDIT",
    "UNRESOLVED",
  ]);
  if (displayedLabels.has("CURRENT")) availableActions.add("KEEP_CURRENT");
  if (displayedLabels.has("REAZON")) availableActions.add("USE_REAZON");
  if (displayedLabels.has("WHISPER_ALT")) {
    availableActions.add("USE_WHISPER_ALTERNATE");
  }
  if (item.itemTypes.includes("TIMING_BOUNDARY_RISK")) {
    availableActions.add("TIMING_EDIT");
  }
  if (item.itemTypes.includes("MISSING_SPEECH_RISK")) {
    availableActions.add("ADD_NEW_CUE");
    availableActions.add("MARK_FALSE_POSITIVE");
  }
  const core = {
    reviewItemId: item.reviewItemId,
    displayCandidates,
    missingCandidateIds,
    availableActions: [...availableActions].toSorted(),
    selectionAuthority: "HUMAN_ONLY" as const,
    calibratedConfidencePercentageDisplayed: false as const,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export function buildC60112ReviewCandidateBundles(input: {
  items: readonly C60112ReviewItem[];
  candidates: readonly C60112ReviewCandidateInput[];
  policy: C60112ReviewPolicy;
}): C60112ReviewCandidateBundlesArtifact {
  assertC60112ReviewPolicy(input.policy);
  assertC60112MachineOnlyInput(
    { items: input.items, candidates: input.candidates },
    "build-review-candidate-bundles",
  );
  assertNoUncalibratedConfidence(input.candidates);
  const candidateById = new Map<string, C60112ReviewCandidateInput>();
  for (const candidate of input.candidates) {
    validateCandidate(candidate);
    const candidateId = candidate.candidateId.trim();
    if (candidateById.has(candidateId)) {
      throw new Error(`DUPLICATE_CANDIDATE_ID:${candidateId}`);
    }
    candidateById.set(candidateId, candidate);
  }
  const bundles = input.items
    .map((item) => buildBundle(item, candidateById))
    .toSorted((left, right) =>
      left.reviewItemId.localeCompare(right.reviewItemId),
    );
  const rawCandidateCount = bundles.reduce(
    (sum, bundle) =>
      sum +
      bundle.displayCandidates.reduce(
        (candidateSum, candidate) => candidateSum + candidate.provenance.length,
        0,
      ),
    0,
  );
  const displayCandidateCount = bundles.reduce(
    (sum, bundle) => sum + bundle.displayCandidates.length,
    0,
  );
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: input.policy.policyVersion,
    artifactType: "c6-0-1-12-machine-review-candidate-bundles" as const,
    policyHash: input.policy.semanticHash,
    runtimeGoldInputCount: 0 as const,
    bundles,
    summary: {
      reviewItemCount: input.items.length,
      displayCandidateCount,
      collapsedDuplicateCount: rawCandidateCount - displayCandidateCount,
      missingCandidateReferenceCount: bundles.reduce(
        (sum, bundle) => sum + bundle.missingCandidateIds.length,
        0,
      ),
      candidateActionableItemCount: bundles.filter(
        (bundle) => bundle.displayCandidates.length > 1,
      ).length,
    },
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}
