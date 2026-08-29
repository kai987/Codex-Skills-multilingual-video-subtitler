import type { z } from "zod";

import type { whisperCoreStabilityV2Schema } from "@mvl/shared";

import {
  genericHallucinationRisk,
  normalizeIndependentAsrLexical,
  normalizedEditSimilarity,
} from "./cross-model-normalization.js";

export type WhisperCoreStabilityV2 = z.infer<
  typeof whisperCoreStabilityV2Schema
>;

export function classifyWhisperCoreStabilityV2(input: {
  exactText: string | null;
  contextText: string | null;
  exactDurationSeconds: number;
  contextDurationSeconds: number;
}): WhisperCoreStabilityV2 {
  if (input.exactText === null || input.contextText === null) {
    return "WHISPER_UNCOMPARABLE";
  }
  const exact = normalizeIndependentAsrLexical(input.exactText);
  const context = normalizeIndependentAsrLexical(input.contextText);
  if (exact === "" || context === "") {
    return exact === context ? "WHISPER_CORE_STABLE" : "WHISPER_EMPTY_UNSTABLE";
  }
  if (exact === context) return "WHISPER_CORE_STABLE";
  const exactRisk = genericHallucinationRisk({
    text: input.exactText,
    durationSeconds: input.exactDurationSeconds,
  });
  const contextRisk = genericHallucinationRisk({
    text: input.contextText,
    durationSeconds: input.contextDurationSeconds,
  });
  if (Math.max(exactRisk, contextRisk) >= 0.6) {
    return "WHISPER_HALLUCINATION_UNSTABLE";
  }
  if (context.includes(exact) || exact.includes(context)) {
    return "WHISPER_CONTEXT_EXTENSION_ONLY";
  }
  const similarity = normalizedEditSimilarity(exact, context);
  if (similarity >= 0.72) return "WHISPER_PARTIAL_AGREEMENT";
  return "WHISPER_LEXICALLY_UNSTABLE";
}
