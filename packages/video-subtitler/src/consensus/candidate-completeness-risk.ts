import type { C61HypothesisUniverse } from "@mvl/shared";
import {
  machineExistingCandidateCompletenessRiskSchema,
  type C611CandidateMachineMetadata,
  type C611CompletenessRow,
  type C611Proposals,
} from "../../../shared/src/c6-1-1-machine-schemas.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import {
  c611Header,
  c611WithHash,
  metadataForC611Candidate,
} from "./hierarchical-correlation-groups.js";
import { normalizeC61HypothesisText } from "./hypothesis-universe.js";

export const C611_COMPLETENESS_POLICY = {
  version: "c611-completeness-soft-evidence-v1",
  strongContractionBelow: 0.65,
  edgeRiskAtLeast: 0.5,
  tokens: "Intl.Segmenter-ja-word-like",
  characters: "NFKC-whitespace-normalized-Unicode-code-points",
  editTrace: "LCS-delete-on-equal-tie",
  contractionIsHardReject: false,
  missingEvidence: "null-and-missingFlags",
} as const;
const words = (value: string) =>
  [...new Intl.Segmenter("ja", { granularity: "word" }).segment(value)]
    .filter((token) => token.isWordLike)
    .map((t) => t.segment);
export function c611TextCompleteness(current: string, proposed: string) {
  const a = Array.from(normalizeC61HypothesisText(current)),
    b = Array.from(normalizeC61HypothesisText(proposed));
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    const row = dp[i];
    if (!row) throw new Error("C611_LCS_ROW_MISSING");
    for (let j = b.length - 1; j >= 0; j--)
      row[j] =
        a[i] === b[j]
          ? 1 + (dp[i + 1]?.[j + 1] ?? 0)
          : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
  }
  let i = 0,
    j = 0,
    deletion = 0,
    insertion = 0,
    longestDeletedSpan = 0,
    longestInsertedSpan = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
      deletion = 0;
      insertion = 0;
    } else if (
      i < a.length &&
      (j === b.length || (dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0))
    ) {
      i++;
      deletion++;
      insertion = 0;
      longestDeletedSpan = Math.max(longestDeletedSpan, deletion);
    } else {
      j++;
      insertion++;
      deletion = 0;
      longestInsertedSpan = Math.max(longestInsertedSpan, insertion);
    }
  }
  let prefix = 0,
    suffix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix])
    prefix++;
  while (
    suffix < Math.min(a.length, b.length) &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const lcs = dp[0]?.[0] ?? 0,
    currentTokenCount = words(current).length,
    proposedTokenCount = words(proposed).length;
  return {
    currentCharacterCount: a.length,
    proposedCharacterCount: b.length,
    characterLengthRatio: a.length ? b.length / a.length : null,
    currentTokenCount,
    proposedTokenCount,
    tokenLengthRatio: currentTokenCount
      ? proposedTokenCount / currentTokenCount
      : null,
    normalizedLcsCoverage: a.length ? lcs / a.length : null,
    deletedCharacterRatio: a.length ? (a.length - lcs) / a.length : null,
    insertedCharacterRatio: b.length
      ? (b.length - lcs) / b.length
      : b.length === a.length
        ? 0
        : null,
    prefixRetention: a.length ? prefix / a.length : null,
    suffixRetention: a.length ? suffix / a.length : null,
    longestDeletedSpan,
    longestInsertedSpan,
  };
}
export function buildC611Completeness(input: {
  universe: C61HypothesisUniverse;
  proposals: C611Proposals;
  metadata?: readonly C611CandidateMachineMetadata[];
}) {
  const rows: C611CompletenessRow[] = input.proposals.records.map(
    (proposal) => {
      const event = input.universe.events.find(
        (e) => e.eventId === proposal.eventId,
      );
      if (!event) throw new Error("C611_COMPLETENESS_EVENT_MISSING");
      const candidate = input.universe.candidates.find(
        (c) => c.candidateId === proposal.proposedCandidateId,
      );
      const meta = candidate
        ? metadataForC611Candidate(candidate, input.metadata ?? [])
        : null;
      const current = event.currentText ?? "";
      const textMetrics = candidate
        ? c611TextCompleteness(current, candidate.displayText)
        : {
            ...c611TextCompleteness(current, ""),
            proposedCharacterCount: null,
            proposedTokenCount: null,
            characterLengthRatio: null,
            tokenLengthRatio: null,
            normalizedLcsCoverage: null,
            deletedCharacterRatio: null,
            insertedCharacterRatio: null,
            prefixRetention: null,
            suffixRetention: null,
            longestDeletedSpan: null,
            longestInsertedSpan: null,
          };
      const speechCompletenessStatus =
        meta?.speechCompletenessStatus ?? "UNKNOWN";
      const acoustic = {
        speechCompletenessStatus,
        requestEdgeRisk: meta?.requestEdgeRisk ?? null,
        leftEdgePinned: meta?.leftEdgePinned ?? null,
        rightEdgePinned: meta?.rightEdgePinned ?? null,
        incompleteSpeech: meta?.incompleteSpeech ?? null,
        decoderTruncationRisk: meta?.decoderTruncationRisk ?? null,
        tokenSupportCoverage: meta?.tokenSupportCoverage ?? null,
        hallucinationRisk: meta?.hallucinationRisk ?? null,
      };
      const riskClasses: C611CompletenessRow["riskClasses"] = [];
      if (textMetrics.characterLengthRatio !== null)
        riskClasses.push(
          textMetrics.characterLengthRatio >= 1
            ? "NO_CONTRACTION_RISK"
            : textMetrics.characterLengthRatio <
                C611_COMPLETENESS_POLICY.strongContractionBelow
              ? "STRONG_CONTRACTION_RISK"
              : "MILD_CONTRACTION_RISK",
        );
      if (
        (acoustic.requestEdgeRisk !== null &&
          acoustic.requestEdgeRisk >=
            C611_COMPLETENESS_POLICY.edgeRiskAtLeast) ||
        acoustic.leftEdgePinned === true ||
        acoustic.rightEdgePinned === true
      )
        riskClasses.push("EDGE_TRUNCATION_RISK");
      if (
        speechCompletenessStatus === "INCOMPLETE" ||
        acoustic.incompleteSpeech === true
      )
        riskClasses.push("INCOMPLETE_SPEECH_RISK");
      if (
        (textMetrics.deletedCharacterRatio ?? 0) > 0 &&
        speechCompletenessStatus !== "COMPLETE"
      )
        riskClasses.push("UNSUPPORTED_DELETION_RISK");
      const eventDuration =
        event.sourceInterval.end - event.sourceInterval.start;
      const missingEvidence = Object.entries(acoustic)
        .filter(([, v]) => v === null || v === "UNKNOWN")
        .map(([key]) => key);
      return c611WithHash({
        proposalId: proposal.proposalId,
        eventId: proposal.eventId,
        ...textMetrics,
        ...acoustic,
        eventDuration,
        charactersPerSecond:
          textMetrics.proposedCharacterCount === null
            ? null
            : textMetrics.proposedCharacterCount / eventDuration,
        riskClasses,
        missingEvidence,
        softEvidenceOnly: true as const,
      });
    },
  );
  return machineExistingCandidateCompletenessRiskSchema.parse(
    c611WithHash({
      ...c611Header,
      artifactType: "machine-existing-candidate-completeness-risk",
      proposalHash: input.proposals.semanticHash,
      riskPolicyHash: hash(C611_COMPLETENESS_POLICY),
      rows,
    }),
  );
}
