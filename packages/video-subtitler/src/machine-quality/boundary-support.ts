import { z } from "zod";
import type { SubtitleCue } from "@mvl/shared";
import { objectHash } from "./experimental-profile.js";

export const BOUNDARY_POLICY = {
  version: "c6011641-boundary-support-v1",
  mainWindow: "W+4",
  windowExtensions: [0, 2, 4],
  maximumGroups: 1,
  maximumTasks: 3,
  maximumAttempts: 4,
  maximumSeconds: 90,
  maximumWindowSeconds: 30,
  edgeBandSeconds: 0.5,
  prefixAnchorBandFrames: 10,
  prefixDefinition: "all target tokens preceding the last approved cue",
  openSuffix:
    "ordered CTC target; prefix constrained to old source frames; any remaining audio unassigned",
  completionScore:
    "CTC log probability minus per-frame maximum log probability; no recognition decode",
  competingCompletionScoreBand: 2,
  competingCompletionSeparationFrames: 6,
  transitionMethod: "RMS_SUSTAINED_DROP_20MS_6DB_120MS_SEARCH800MS_V1",
  minimumTailPosterior: 0.35,
  maximumSingleFrameTailRatio: 0.5,
  stabilitySeconds: 0.12,
  occurrenceStartDisplacementSeconds: 0.5,
  fallback: "W+4 unavailable => abstain; never switch representative",
  evaluationMatching:
    "formal evaluator unchanged; fixed U0 matches; exact repeated text alternatives within fixed W+4 envelope; ambiguous groups excluded from confirmed gain",
  lexicalTruthValidated: false,
  defaultPromotionAuthorized: false,
} as const;
const span = z
  .object({
    targetIndex: z.number().int(),
    tokenId: z.number().int(),
    startFrame: z.number().int().nonnegative(),
    endFrameExclusive: z.number().int().positive(),
    meanPosterior: z.number().min(0).max(1),
    meanLogPosterior: z.number(),
    minLogPosterior: z.number(),
  })
  .strict();
export const boundaryProposalSchema = z
  .object({
    cueId: z.string(),
    cueHash: z.string(),
    windowId: z.string(),
    pathExists: z.boolean(),
    textMappingComplete: z.boolean(),
    boundarySupportAvailable: z.boolean(),
    utteranceEndObserved: z.boolean(),
    displayEndChosen: z.boolean(),
    lexicalTruthValidated: z.literal(false),
    ctcLabelSupportEnd: z.number().nullable(),
    conditionalAlignmentEnd: z.number().nullable(),
    acousticTransitionCandidate: z.number().nullable(),
    proposedSubtitleEnd: z.number().nullable(),
    boundaryUncertainty: z.number().nullable(),
    sourceRange: z.object({ start: z.number(), end: z.number() }).strict(),
    rawFrameRange: z.array(z.number().int()),
    tailTokenCount: z.number().int(),
    singleFrameRatio: z.number().nullable(),
    localSelectedPathSupport: z.number().nullable(),
    edgeDistance: z.number().nullable(),
    oldMeanPosterior: z.array(z.number()),
    oldNormalizedPathLogScore: z.number().nullable(),
    oldFrameEvidenceStatus: z.literal("FULL_FRAME_EVIDENCE_NOT_PERSISTED"),
    selectedTail: z.array(span),
    unassignedSuffix: z.array(z.number()),
    evidenceHash: z.string(),
    risks: z.array(z.string()),
    evidenceType: z.literal(
      "CONDITIONAL_PATH_PLUS_PCM_TRANSITION_NOT_LEXICAL_TRUTH",
    ),
    calculationVersion: z.literal("c6011641-boundary-support-v1"),
  })
  .strict();
export type BoundaryProposal = z.infer<typeof boundaryProposalSchema>;
export interface BoundaryObservation {
  windowId: string;
  window: { start: number; end: number };
  status: string;
  mappingComplete: boolean;
  spans: z.infer<typeof span>[];
  ambiguous: boolean;
  frameSeconds: number;
  transitionSeconds: number | null;
  unassignedSuffix: number[];
  evidenceHash: string;
}
export function proposeBoundary(
  cue: SubtitleCue,
  first: number,
  last: number,
  o: BoundaryObservation,
  old: {
    meanPosterior: number[];
    normalizedPathLogScore: number | null;
    firstTokenStart: number;
  },
  companion?: BoundaryObservation,
): BoundaryProposal {
  const tail = o.spans.slice(Math.max(first, last - 2), last + 1),
    terminal = o.spans[last];
  const pathExists = o.status === "SUCCESS" && !!terminal;
  const label = terminal
    ? o.window.start + terminal.endFrameExclusive * o.frameSeconds
    : null;
  const single = tail.length
    ? tail.filter((s) => s.endFrameExclusive - s.startFrame === 1).length /
      tail.length
    : null;
  const support = tail.length
    ? Math.min(...tail.map((s) => s.meanPosterior))
    : null;
  const candidate =
    o.transitionSeconds === null ? null : o.window.start + o.transitionSeconds;
  const risks: string[] = [];
  if (!pathExists || !o.mappingComplete)
    risks.push("CONDITIONAL_PATH_OR_MAPPING_UNAVAILABLE");
  if (o.ambiguous) risks.push("OCCURRENCE_AMBIGUOUS");
  if (label !== null && o.window.end - label <= BOUNDARY_POLICY.edgeBandSeconds)
    risks.push("POSSIBLY_RIGHT_CENSORED");
  if (
    support === null ||
    support < BOUNDARY_POLICY.minimumTailPosterior ||
    single === null ||
    single > BOUNDARY_POLICY.maximumSingleFrameTailRatio
  )
    risks.push("WEAK_TAIL_SUPPORT");
  if (candidate === null)
    risks.push("BOUNDARY_NOT_IDENTIFIABLE_FROM_AVAILABLE_EVIDENCE");
  const firstSpan = o.spans[first];
  if (
    firstSpan &&
    Math.abs(
      o.window.start +
        firstSpan.startFrame * o.frameSeconds -
        old.firstTokenStart,
    ) > BOUNDARY_POLICY.occurrenceStartDisplacementSeconds
  )
    risks.push("NEIGHBOR_OR_OCCURRENCE_CONFLICT");
  if (
    candidate !== null &&
    (label === null ||
      candidate < label ||
      candidate >= o.window.end ||
      candidate <= cue.start)
  )
    risks.push("CANDIDATE_OUTSIDE_OBSERVED_SUPPORT");
  if (o.windowId !== "W0") {
    if (o.windowId !== BOUNDARY_POLICY.mainWindow)
      risks.push("NOT_PREDECLARED_MAIN_WINDOW");
    const other = companion?.spans[last];
    if (
      companion?.windowId !== "W+2" ||
      companion.status !== "SUCCESS" ||
      companion.ambiguous ||
      !other ||
      label === null ||
      companion.transitionSeconds === null ||
      candidate === null ||
      Math.abs(
        label -
          (companion.window.start +
            other.endFrameExclusive * companion.frameSeconds),
      ) > BOUNDARY_POLICY.stabilitySeconds ||
      Math.abs(
        candidate - (companion.window.start + companion.transitionSeconds),
      ) > BOUNDARY_POLICY.stabilitySeconds
    )
      risks.push("CONTEXT_SENSITIVE_OR_UNAVAILABLE_BOUNDARY");
  }
  const usable = risks.length === 0;
  return boundaryProposalSchema.parse({
    cueId: cue.id,
    cueHash: objectHash(cue),
    windowId: o.windowId,
    pathExists,
    textMappingComplete: o.mappingComplete,
    boundarySupportAvailable: pathExists && tail.length > 0,
    utteranceEndObserved: false,
    displayEndChosen: usable,
    lexicalTruthValidated: false,
    ctcLabelSupportEnd: label,
    conditionalAlignmentEnd: label,
    acousticTransitionCandidate: candidate,
    proposedSubtitleEnd: usable ? candidate : null,
    boundaryUncertainty: candidate === null ? null : 0.12,
    sourceRange: o.window,
    rawFrameRange: terminal
      ? [terminal.startFrame, terminal.endFrameExclusive]
      : [],
    tailTokenCount: tail.length,
    singleFrameRatio: single,
    localSelectedPathSupport: support,
    edgeDistance: label === null ? null : o.window.end - label,
    oldMeanPosterior: old.meanPosterior,
    oldNormalizedPathLogScore: old.normalizedPathLogScore,
    oldFrameEvidenceStatus: "FULL_FRAME_EVIDENCE_NOT_PERSISTED",
    selectedTail: tail,
    unassignedSuffix: o.unassignedSuffix,
    evidenceHash: o.evidenceHash,
    risks,
    evidenceType: "CONDITIONAL_PATH_PLUS_PCM_TRANSITION_NOT_LEXICAL_TRUTH",
    calculationVersion: BOUNDARY_POLICY.version,
  });
}

/** One atomic end-only transaction. No next.start clipping or partial commit. */
export function applyBoundaryEnds(
  input: readonly SubtitleCue[],
  values: BoundaryProposal[],
  allowedIds: string[],
  enabled: boolean,
) {
  const proposals = values.map((p) => boundaryProposalSchema.parse(p));
  if (new Set(proposals.map((p) => p.cueId)).size !== proposals.length)
    throw Error("Duplicate boundary proposal");
  for (const p of proposals) {
    const cue = input.find((c) => c.id === p.cueId);
    if (!cue || !allowedIds.includes(p.cueId) || objectHash(cue) !== p.cueHash)
      throw Error("Unbound boundary proposal");
  }
  const selected = proposals.filter(
    (p) =>
      p.displayEndChosen &&
      p.proposedSubtitleEnd !== null &&
      p.risks.length === 0,
  );
  const result = input.map((c) => ({
    ...c,
    end: selected.find((p) => p.cueId === c.id)?.proposedSubtitleEnd ?? c.end,
  }));
  const conflict = result.some(
    (c, i) =>
      (selected.some((p) => p.cueId === c.id) &&
        (c.end <= c.start || c.end - c.start > 12)) ||
      result.some(
        (n, j) =>
          j !== i &&
          c.start < n.end - 1e-8 &&
          n.start < c.end - 1e-8 &&
          !(
            required(input[i]).start < required(input[j]).end - 1e-8 &&
            required(input[j]).start < required(input[i]).end - 1e-8
          ),
      ),
  );
  const outside = selected.some(
    (p) =>
      required(p.proposedSubtitleEnd) > p.sourceRange.end ||
      required(p.proposedSubtitleEnd) <= p.sourceRange.start,
  );
  const apply = enabled && !conflict && !outside;
  return {
    cues: structuredClone(apply ? result : [...input]),
    applied: apply
      ? selected.filter(
          (p) =>
            p.proposedSubtitleEnd !==
            required(input.find((c) => c.id === p.cueId)).end,
        )
      : [],
    rejectedReason:
      conflict || outside ? "NEIGHBOR_OR_OCCURRENCE_CONFLICT" : null,
    enabled,
  };
}
function required<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw Error("Missing bound value");
  return v;
}
