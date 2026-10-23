import { createHash } from "node:crypto";

import {
  InputError,
  subtitleCtcAlignmentInputSchema,
  type CtcTargetEncoding,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCtcAlignmentInput,
} from "@mvl/shared";

import { normalizeCtcAlignmentText } from "./ctc-alignment.js";
import { sha256Value } from "./finalization-support.js";

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildSubtitleCtcAlignmentInput(input: {
  source: SubtitleCanonicalAlignmentInput;
  sourceAlignmentInputHash: string;
  runtimeIdentityHash: string;
  modelSnapshotHash: string;
  tokenizerIdentityHash: string;
  encodingByCueId: ReadonlyMap<string, CtcTargetEncoding>;
  generatedAt?: string;
}): SubtitleCtcAlignmentInput {
  const cues = input.source.cues.map((cue) => {
    const normalized = normalizeCtcAlignmentText(cue.alignmentText);
    const encoding = input.encodingByCueId.get(cue.cueId);
    if (encoding === undefined) {
      throw new InputError(`CTC target encoding missing for ${cue.cueId}.`);
    }
    if (
      encoding.targetText !== normalized.text ||
      encoding.targetTextSha256 !== sha256Text(normalized.text)
    ) {
      throw new InputError(`CTC tokenizer target mismatch for ${cue.cueId}.`);
    }
    return {
      cueId: cue.cueId,
      componentId: cue.componentId,
      originalInterval: cue.originalInterval,
      canonicalText: cue.canonicalText,
      canonicalTextSha256: cue.canonicalTextSha256,
      alignmentText: cue.alignmentText,
      alignmentTextSha256: cue.alignmentTextSha256,
      ctcTargetText: normalized.text,
      ctcTargetTextSha256: sha256Text(normalized.text),
      normalizationOperations: normalized.operations,
      lexicalCharacterDeletionCount: normalized.lexicalCharacterDeletionCount,
      encoding,
      canonicalTextMutated: false as const,
    };
  });
  const summary = {
    componentCount: 7 as const,
    cueCount: 16 as const,
    targetEncodableCueCount: cues.filter((cue) => cue.encoding.targetEncodable)
      .length,
    targetUnrepresentableCueCount: cues.filter(
      (cue) => !cue.encoding.targetEncodable,
    ).length,
    unknownTokenCount: cues.reduce(
      (sum, cue) => sum + cue.encoding.unknownTokenCount,
      0,
    ),
    specialTokenCount: cues.reduce(
      (sum, cue) => sum + cue.encoding.specialTokenCount,
      0,
    ),
    lexicalCharacterDeletionCount: 0 as const,
    canonicalTextMutationCount: 0 as const,
  };
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-ctc-alignment-input" as const,
    alignmentVersion: "C5.18.1" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    baseCueHash: input.source.baseCueHash,
    baseTimingHash: input.source.baseTimingHash,
    sourceAlignmentInputHash: input.sourceAlignmentInputHash,
    ctcRuntimeIdentityHash: input.runtimeIdentityHash,
    ctcModelSnapshotHash: input.modelSnapshotHash,
    tokenizerIdentityHash: input.tokenizerIdentityHash,
    cues,
    summary,
  };
  return subtitleCtcAlignmentInputSchema.parse({
    ...base,
    semanticHash: sha256Value({ ...base, generatedAt: null }),
  });
}
