import { z } from "zod";
import type { SubtitleCue } from "@mvl/shared";
import { objectHash } from "./experimental-profile.js";
import {
  applyBoundaryEnds,
  boundaryProposalSchema,
} from "./boundary-support.js";

export const occurrenceTailProposalSchema = z
  .object({
    version: z.literal("c6011642-original-tail-proposal-v1"),
    cueId: z.string(),
    cueHash: z.string(),
    evidenceHash: z.string(),
    mathematicalPathExists: z.boolean(),
    originalSupportEstablished: z.boolean(),
    occurrenceDistinguished: z.boolean(),
    tailIdentifiable: z.boolean(),
    proposedEnd: z.number().nullable(),
    sourceRange: z.object({ start: z.number(), end: z.number() }).strict(),
    configuredStabilityTolerance: z.number().nonnegative(),
    candidateEndRange: z.tuple([z.number(), z.number()]).nullable(),
    reasons: z.array(z.string()),
    audioConfirmed: z.literal(false),
    listener: z.null(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      p.proposedEnd !== null &&
      (!p.mathematicalPathExists ||
        !p.originalSupportEstablished ||
        !p.occurrenceDistinguished ||
        !p.tailIdentifiable ||
        p.reasons.length ||
        p.proposedEnd <= p.sourceRange.start ||
        p.proposedEnd >= p.sourceRange.end)
    )
      ctx.addIssue({
        code: "custom",
        message: "Unsupported original-tail application",
      });
  });

/** New protocol validation; reuse ONLY the old atomic transaction machinery.
 * The private carrier is not an old-protocol scientific proposal and is never
 * serialized. New journals always contain the versioned new proposal above.
 */
export function applyOccurrenceTail(
  cues: readonly SubtitleCue[],
  value: unknown,
  allowedId: string,
  enabled: boolean,
) {
  const p = occurrenceTailProposalSchema.parse(value);
  const cue = cues.find((c) => c.id === p.cueId);
  if (!cue || p.cueId !== allowedId || objectHash(cue) !== p.cueHash)
    throw Error("STALE_OR_FOREIGN_TAIL_BINDING");
  const carrier = boundaryProposalSchema.parse({
    cueId: p.cueId,
    cueHash: p.cueHash,
    evidenceHash: p.evidenceHash,
    windowId: "W+4",
    pathExists: p.mathematicalPathExists,
    textMappingComplete: true,
    boundarySupportAvailable: p.originalSupportEstablished,
    utteranceEndObserved: false,
    displayEndChosen: p.proposedEnd !== null,
    lexicalTruthValidated: false,
    ctcLabelSupportEnd: null,
    conditionalAlignmentEnd: null,
    acousticTransitionCandidate: p.proposedEnd,
    proposedSubtitleEnd: p.proposedEnd,
    boundaryUncertainty: null,
    sourceRange: p.sourceRange,
    rawFrameRange: [],
    tailTokenCount: 0,
    singleFrameRatio: null,
    localSelectedPathSupport: null,
    edgeDistance: null,
    oldMeanPosterior: [],
    oldNormalizedPathLogScore: null,
    oldFrameEvidenceStatus: "FULL_FRAME_EVIDENCE_NOT_PERSISTED",
    selectedTail: [],
    unassignedSuffix: [],
    risks: p.reasons,
    evidenceType: "CONDITIONAL_PATH_PLUS_PCM_TRANSITION_NOT_LEXICAL_TRUTH",
    calculationVersion: "c6011641-boundary-support-v1",
  });
  const result = applyBoundaryEnds(cues, [carrier], [allowedId], enabled);
  return {
    cues: result.cues,
    changes: result.applied.map(() => ({
      cueId: p.cueId,
      oldEnd: cue.end,
      newEnd: p.proposedEnd,
      evidenceHash: p.evidenceHash,
    })),
    rejectedReason: result.rejectedReason,
    enabled,
  };
}
