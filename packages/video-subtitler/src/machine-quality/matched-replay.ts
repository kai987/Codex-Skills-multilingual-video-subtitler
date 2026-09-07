import { z } from "zod";
import {
  applyAcousticDecisions,
  type AcousticDecision,
} from "./bounded-acoustic.js";
import type { SubtitleCue } from "@mvl/shared";
import {
  deduplicateTopScoreWinners,
  repairIntraCueHypothesisRepetition,
} from "@mvl/transcription-core";
import {
  buildAcousticSemanticCueSegments,
  layoutSubtitleCuesWithDiagnostics,
} from "@mvl/subtitle-core";
import {
  machineQualityEvidenceSchema,
  objectHash,
  primaryMinimal,
} from "./experimental-profile.js";

export const matchedEvidenceSchema = machineQualityEvidenceSchema
  .pick({ partition: true, source: true, primaryRequests: true })
  .extend({
    version: z.literal("c601161-primary-evidence-v1"),
    promptStatus: z.literal("HISTORICAL_TITLE_PROMPTED_EVIDENCE"),
  })
  .strict();
export type MatchedEvidence = z.infer<typeof matchedEvidenceSchema>;
export const REPLAY_SCOPE = {
  replayScope: "PRIMARY_ONLY_MATCHED_PROFILE",
  historicalReproductionVerified: false,
  fixedSelection:
    "exact request identity dedup; primary-only singleton selection; no competing tracks",
  executedChain: [
    "primaryMinimal",
    "deduplicateTopScoreWinners",
    "repairIntraCueHypothesisRepetition",
    "buildAcousticSemanticCueSegments",
    "layoutSubtitleCuesWithDiagnostics",
    "formatAss/formatSrt/formatVtt",
  ],
  unavailableOrDisabled: [
    "fresh recognition, ASR canonicalization and alternative-window generation",
    "full historical candidate association / Top-Score clustering and selection",
    "reference-guided branches, lyrics recovery, foreign-language replacement",
    "independent acoustic tokens, scene/speaker evidence, timing recovery",
    "historical text-integrity repair and final enforcing quarantine",
    "C6.0.1.16 inverse recovery and historical stable-cue injection",
  ],
  defaultPromotionAuthorized: false,
} as const;
export const MATCHED_GATE_POLICY = {
  version: "c601161-gates-v1",
  normalizedCER: "strict decrease R2 vs R1",
  exactCER: "non-increase R2 vs R1",
  tradeoff:
    "any S/D/I, severe boundary, supported-set boundary error or presentation-overflow increase holds",
  tolerance: 0,
  rawComparison: "CER, non-deletion coverage proxy and timing separately",
  heldout: "HELDOUT_VALIDATION_NOT_RUN",
  defaultPromotionAuthorized: false,
} as const;
export type Operation =
  | "KEEP"
  | "DELETE"
  | "REPLACE"
  | "MERGE"
  | "SPLIT"
  | "DEDUP"
  | "TIME_MAP"
  | "FORMAT_ONLY"
  | "ABSTAIN";
export interface StageTrace {
  stageName: string;
  implementationHash: string;
  inputHash: string;
  outputHash: string;
  inputCueCount: number;
  outputCueCount: number;
  inputCharacters: number;
  outputCharacters: number;
  occurrenceIds: string[];
  executionMode: "deterministic-reexecution";
  operation: Operation;
  input: readonly SubtitleCue[];
  output: readonly SubtitleCue[];
  evidence: unknown;
  operations: {
    operation: Operation;
    affectedInput: SubtitleCue;
    correspondingOutput: SubtitleCue[];
    sourceRequestIds: string[];
    sourceOccurrenceIds: string[];
    reversibleFromTrace: true;
    reason: string;
    acousticTruth: "UNKNOWN";
  }[];
}
const chars = (cues: readonly SubtitleCue[]) =>
  cues.reduce(
    (n, c) => n + Array.from(c.text.replace(/\r?\n/gu, "")).length,
    0,
  );
export function replayPrimaryAssembly(
  value: unknown,
  repair: boolean,
  implementationHashes: Record<string, string> = {},
  acoustic?: { mode: "observe" | "apply"; decisions: AcousticDecision[] },
) {
  const e = matchedEvidenceSchema.parse(value);
  const trace: StageTrace[] = [];
  const record = (
    stageName: string,
    input: readonly SubtitleCue[],
    output: readonly SubtitleCue[],
    operation: Operation,
    evidence: unknown,
    relations: {
      inputIds: string[];
      outputIds: string[];
      reason: string;
    }[] = [],
  ) => {
    const operations = input.map((c) => {
      const relation = relations.find((r) => r.inputIds.includes(c.id));
      const ids = relation?.outputIds ?? [c.id];
      const correspondingOutput = output.filter((o) => ids.includes(o.id));
      const sourceOccurrenceIds = [
        ...new Set([c.id, ...(c.textAudit?.sourceWinnerCueIds ?? [])]),
      ];
      const sourceRequestIds = e.primaryRequests
        .filter((r) =>
          r.segments.some((s) => sourceOccurrenceIds.includes(s.id)),
        )
        .map((r) => r.id);
      const type: Operation =
        correspondingOutput.length === 0
          ? "DELETE"
          : correspondingOutput.length > 1
            ? "SPLIT"
            : objectHash(c) === objectHash(correspondingOutput[0])
              ? "KEEP"
              : operation;
      return {
        operation: type,
        affectedInput: structuredClone(c),
        correspondingOutput: structuredClone(correspondingOutput),
        sourceRequestIds,
        sourceOccurrenceIds,
        reversibleFromTrace: true as const,
        reason: relation?.reason ?? stageName,
        acousticTruth: "UNKNOWN" as const,
      };
    });
    trace.push({
      stageName,
      implementationHash:
        implementationHashes[stageName] ??
        objectHash({ stageName, testOnly: true }),
      inputHash: objectHash(input),
      outputHash: objectHash(output),
      inputCueCount: input.length,
      outputCueCount: output.length,
      inputCharacters: chars(input),
      outputCharacters: chars(output),
      occurrenceIds: [
        ...new Set(
          input.flatMap((c) => c.provenance?.sourceRequestIds ?? [c.id]),
        ),
      ],
      executionMode: "deterministic-reexecution",
      operation,
      input: structuredClone(input),
      output: structuredClone(output),
      evidence,
      operations,
    });
  };
  const primary = primaryMinimal(e);
  const local = e.primaryRequests.flatMap((r) =>
    r.segments.map((s) => ({
      ...s,
      language: "ja" as const,
      languages: ["ja" as const],
      speaker: null,
      confidence: null,
    })),
  );
  record("primaryMinimal", local, primary, "TIME_MAP", {
    requests: e.primaryRequests.map(({ segments, ...r }) => ({
      ...r,
      occurrenceIds: segments.map((s) => s.id),
    })),
    sourceOffsetAppliedExactlyOnce: true,
    independentAcousticTruth: false,
  });
  // This is the existing business deduplicator, not a snapshot of its old result.
  const dedup = deduplicateTopScoreWinners(primary, "pre-normalization");
  const retained = (id: string): string => {
    const seen = new Set<string>();
    while (!seen.has(id)) {
      seen.add(id);
      const r = dedup.artifact.records.find((r) =>
        r.removedCueIds.includes(id),
      );
      if (!r) return id;
      id = r.keptCueId;
    }
    throw new Error("Cyclic dedup lineage");
  };
  record(
    "deduplicateTopScoreWinners",
    primary,
    dedup.cues,
    "DEDUP",
    dedup.artifact,
    primary.map((c) => ({
      inputIds: [c.id],
      outputIds: [retained(c.id)],
      reason:
        dedup.artifact.records
          .filter((r) => r.removedCueIds.includes(c.id))
          .flatMap((r) => r.reasons)
          .join(";") || "kept-primary-winner",
    })),
  );
  const repetition = repairIntraCueHypothesisRepetition({
    cues: dedup.cues,
    repetitionPolicy: repair ? "source-preserving" : "legacy",
  });
  if (acoustic) {
    if (!repair)
      throw new Error("Acoustic experiment requires source-preserving profile");
    repetition.cues = applyAcousticDecisions(
      dedup.cues,
      repetition.cues,
      acoustic.decisions,
      acoustic.mode === "apply",
    );
  }
  record(
    "repairIntraCueHypothesisRepetition",
    dedup.cues,
    repetition.cues,
    repair ? "ABSTAIN" : "REPLACE",
    acoustic
      ? { repetition: repetition.artifact, acoustic }
      : repetition.artifact,
    repetition.artifact.records.map((r) => ({
      inputIds: [r.cueId],
      outputIds: r.outputCueIds,
      reason: r.selectedReason,
    })),
  );
  const segmentation = buildAcousticSemanticCueSegments(repetition.cues, {
    mode: "acoustic-semantic",
    japaneseTextAnalyzer: "intl-segmenter",
  });
  // Legacy semantic-merge IDs can collide. Bind the ACTUAL output by ID + exact
  // interval to the freshly executed plan, never by array index or text similarity.
  const identityBindings = segmentation.cues.map((c) => {
    const entries = segmentation.plan.entries.filter((r) =>
      r.outputCueIds.some((id, i) => {
        const t = r.outputIntervals[i];
        return id === c.id && t?.start === c.start && t.end === c.end;
      }),
    );
    if (entries.length !== 1)
      throw new Error("Ambiguous fresh segmentation identity");
    const entry = entries[0];
    if (!entry) throw new Error("Missing segmentation binding");
    return {
      legacyId: c.id,
      sourceIds: entry.sourceCueIds,
      start: c.start,
      end: c.end,
      id:
        "assembly-" +
        objectHash({
          sources: entry.sourceCueIds,
          start: c.start,
          end: c.end,
        }).slice(0, 24),
    };
  });
  const bound = segmentation.cues.map((c, i) => {
    const binding = identityBindings[i];
    if (!binding) throw new Error("Missing bound segmentation identity");
    return { ...c, id: binding.id };
  });
  if (new Set(bound.map((c) => c.id)).size !== bound.length)
    throw new Error("Duplicate assembly identity");
  record(
    "buildAcousticSemanticCueSegments",
    repetition.cues,
    bound,
    "MERGE",
    {
      ...segmentation.plan,
      rawOutput: segmentation.cues,
      identityBindings,
      identityAdapter: "source-ids-and-exact-interval; no text/timing mutation",
    },
    segmentation.plan.entries.map((r) => ({
      inputIds: r.sourceCueIds,
      outputIds: identityBindings
        .filter((b) => objectHash(b.sourceIds) === objectHash(r.sourceCueIds))
        .map((b) => b.id),
      reason: r.reasons.join(";"),
    })),
  );
  const presentation = layoutSubtitleCuesWithDiagnostics(bound, {
    segmentationMode: "presegmented",
    allowTemporalCueSplitting: false,
  });
  // Never let display-only processing silently remove lexical content.
  const lexical = (cs: readonly SubtitleCue[]) =>
    cs
      .map((c) => c.text)
      .join("")
      .normalize("NFKC")
      .replace(/[\p{P}\p{Z}\s]/gu, "");
  if (lexical(bound) !== lexical(presentation.cues))
    throw new Error("Presentation lost lexical content");
  record(
    "layoutSubtitleCuesWithDiagnostics",
    bound,
    presentation.cues,
    "FORMAT_ONLY",
    presentation.timingRecords,
  );
  return { primary, cues: presentation.cues, trace };
}
