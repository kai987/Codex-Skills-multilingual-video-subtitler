import type {
  C61Hypothesis,
  C61HypothesisEvent,
  SubtitlePackage,
} from "@mvl/shared";
import { resolveDisplayLayout } from "@mvl/subtitle-core";
import type {
  C611Proposal,
  C611SpanApplication,
} from "../../../shared/src/c6-1-1-machine-schemas.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c611TextHash } from "./hierarchical-correlation-groups.js";

export const C611_PRESERVATION_POLICY = {
  version: "c611-text-only-preservation-v1",
  defaultAction: "KEEP_CURRENT",
  currentIndependentVote: false,
  timingMutation: false,
  cueSplitMerge: false,
  novelComposition: false,
  overlappingModifiableSpans: "BLOCK_BEFORE_CALIBRATION",
  presentation: "existing-resolveDisplayLayout-no-split",
  switchCost: "TRAINING_FOLD_ONLY_NO_FIXED_RUNTIME_THRESHOLD",
} as const;
export function checkC611SpanApplication(input: {
  event: C61HypothesisEvent;
  candidate: C61Hypothesis;
  events: readonly C61HypothesisEvent[];
  production: SubtitlePackage;
}): { reasons: string[]; proof: C611SpanApplication | null } {
  const { event, candidate, production } = input;
  const reasons: string[] = [];
  if (candidate.providerFamily === "CURRENT")
    reasons.push("CURRENT_IS_NO_SWITCH_NOT_AN_ALTERNATIVE");
  if (candidate.inclusionStatus !== "INCLUDED")
    reasons.push("UNSUPPORTED_OR_REJECTED_CANDIDATE");
  if (candidate.eventId !== event.eventId)
    reasons.push("CROSS_EVENT_CONTAMINATION");
  if (candidate.displayText.trim() === "") reasons.push("EMPTY_PROPOSED_TEXT");
  if (
    Array.from(candidate.displayText).some((point) => {
      const code = point.codePointAt(0) ?? 0;
      return code >= 0xd800 && code <= 0xdfff;
    })
  )
    reasons.push("INVALID_ENCODING");
  if (
    !/^[a-f0-9]{64}$/u.test(candidate.provenanceHash) ||
    !candidate.modelIdentity ||
    !candidate.requestId ||
    !candidate.sourceInterval
  )
    reasons.push("MISSING_PROVENANCE");
  const span = event.finalSpan;
  const cue = production.cues.find((c) => c.id === span?.finalCueId);
  if (
    !span?.modifiable ||
    !cue ||
    !event.finalCueIds.includes(cue.id) ||
    event.currentText !== span.spanText ||
    !Number.isInteger(span.spanStart) ||
    !Number.isInteger(span.spanEnd) ||
    span.spanStart < 0 ||
    span.spanEnd <= span.spanStart ||
    span.spanEnd > Array.from(cue.text).length ||
    Array.from(cue.text).slice(span.spanStart, span.spanEnd).join("") !==
      span.spanText
  )
    reasons.push("INVALID_CUE_MAPPING_OR_UNAPPLICABLE_SPAN");
  if (!span || !cue || reasons.length) return { reasons, proof: null };
  if (
    input.events.some(
      (other) =>
        other.eventId !== event.eventId &&
        other.finalSpan?.modifiable &&
        other.finalSpan.finalCueId === cue.id &&
        other.finalSpan.spanStart < span.spanEnd &&
        other.finalSpan.spanEnd > span.spanStart,
    )
  )
    reasons.push("OVERLAPPING_MODIFIABLE_EVENT_SPANS");
  const points = Array.from(cue.text);
  points.splice(
    span.spanStart,
    span.spanEnd - span.spanStart,
    ...Array.from(candidate.displayText),
  );
  const layout = resolveDisplayLayout({ ...cue, text: points.join("") });
  if (!layout.resolved || layout.blocking)
    reasons.push("CANDIDATE_SPAN_CANNOT_BE_APPLIED_WITHOUT_STRUCTURE_CHANGE");
  if (reasons.length) return { reasons, proof: null };
  const body = {
    finalCueId: cue.id,
    spanStart: span.spanStart,
    spanEnd: span.spanEnd,
    baselineSpanTextHash: c611TextHash(span.spanText),
    cueTextHash: c611TextHash(cue.text),
    cueTimingHash: hash([cue.id, cue.start, cue.end]),
    lineageEvidenceHash: span.evidenceHash,
    replacementTextHash: c611TextHash(candidate.displayText),
  };
  return { reasons: [], proof: { ...body, applicationProofHash: hash(body) } };
}

/** No score threshold is fitted here. The caller must supply the training-fold
 * gate decision; an absent/false gate always preserves current. */
export function decideC611CurrentPreservation(
  proposal: C611Proposal,
  options: { trainedGateAllowsSwitch?: boolean; requestReview?: boolean } = {},
):
  | "KEEP_CURRENT"
  | "SELECT_EXISTING_CANDIDATE"
  | "ABSTAIN_REVIEW"
  | "BLOCKED_STRUCTURAL" {
  if (proposal.eligibilityStatus === "BLOCKED_STRUCTURAL")
    return "BLOCKED_STRUCTURAL";
  if (
    proposal.eligibilityStatus !== "ELIGIBLE" ||
    !proposal.proposedCandidateId ||
    !proposal.spanApplication
  )
    return "KEEP_CURRENT";
  if (options.trainedGateAllowsSwitch === true)
    return "SELECT_EXISTING_CANDIDATE";
  return options.requestReview ? "ABSTAIN_REVIEW" : "KEEP_CURRENT";
}
