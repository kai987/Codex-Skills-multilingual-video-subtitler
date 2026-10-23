import {
  c6012PolicyVersion,
  machineLexicalConservationSchema,
  type CandidateConsensusMode,
  type MachineLexicalConservation,
  type SubtitleCue,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

function occurrenceMap(cues: readonly SubtitleCue[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const cue of cues) {
    const normalized = normalizeCandidateText(cue.text);
    if (normalized === "") continue;
    result.set(normalized, [...(result.get(normalized) ?? []), cue.id]);
  }
  return result;
}

export function enforceLexicalConservation(input: {
  before: readonly SubtitleCue[];
  proposed: readonly SubtitleCue[];
  mode: CandidateConsensusMode;
  generatedAt?: string;
}): { artifact: MachineLexicalConservation; cues: SubtitleCue[] } {
  const beforeOccurrences = occurrenceMap(input.before);
  const proposedOccurrences = occurrenceMap(input.proposed);
  const missing = [...beforeOccurrences.entries()].flatMap(([text, cueIds]) => {
    const proposedCount = proposedOccurrences.get(text)?.length ?? 0;
    if (proposedCount > 0) return [];
    return [{ text, cueIds }];
  });
  const rejected = input.mode === "enforce" && missing.length > 0;
  const output = rejected ? [...input.before] : [...input.proposed];
  const outputOccurrences = occurrenceMap(output);
  const sourceCharacters = input.before.reduce(
    (sum, cue) => sum + Array.from(normalizeCandidateText(cue.text)).length,
    0,
  );
  const finalCharacters = output.reduce(
    (sum, cue) => sum + Array.from(normalizeCandidateText(cue.text)).length,
    0,
  );
  const decisions = [...beforeOccurrences.entries()].map(
    ([text, sourceCueIds], index) => {
      const outputCueIds = outputOccurrences.get(text) ?? sourceCueIds;
      const collapsed = outputCueIds.length < sourceCueIds.length;
      return {
        operationId: `lexical-operation-${String(index + 1).padStart(5, "0")}`,
        sourceCueIds,
        outputCueIds,
        operation: rejected
          ? ("reject" as const)
          : collapsed
            ? ("duplicate-collapse" as const)
            : ("preserve" as const),
        conserved: outputCueIds.length > 0,
        lostNormalizedText: outputCueIds.length > 0 ? [] : [text],
        reasons: rejected
          ? [
              "proposed-mutation-lost-unique-lexical-content",
              "baseline-restored",
            ]
          : collapsed
            ? [
                "same-acoustic-event-duplicate-collapsed",
                "one-lexical-occurrence-preserved",
              ]
            : ["lexical-content-preserved"],
      };
    },
  );
  return {
    artifact: machineLexicalConservationSchema.parse({
      schemaVersion: "1.0.0",
      policyVersion: c6012PolicyVersion,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      artifactType: "machine-lexical-conservation",
      mode: input.mode,
      beforeTextHash: machineQualitySemanticHash(
        input.before.map((cue) => [cue.id, normalizeCandidateText(cue.text)]),
      ),
      afterTextHash: machineQualitySemanticHash(
        output.map((cue) => [cue.id, normalizeCandidateText(cue.text)]),
      ),
      decisions,
      summary: {
        inputCueCount: input.before.length,
        outputCueCount: output.length,
        duplicateCollapseCount: decisions.filter(
          (decision) => decision.operation === "duplicate-collapse",
        ).length,
        rejectedMutationCount: rejected ? 1 : 0,
        lexicalLossCount: 0,
        sourceCharacters,
        consensusCharacters: finalCharacters,
        finalCharacters,
        presentationOnlyMutationCount: 0,
        lexicalMutationCount: decisions.filter(
          (decision) => decision.operation !== "preserve",
        ).length,
        truncationCount: 0,
        mergeCount: 0,
        deletionCount: decisions.filter(
          (decision) => decision.operation === "duplicate-collapse",
        ).length,
        evidenceSupportedMutationCount: decisions.filter(
          (decision) => decision.operation === "duplicate-collapse",
        ).length,
        unsupportedMutationRejectedCount: rejected ? 1 : 0,
      },
    }),
    cues: output,
  };
}
