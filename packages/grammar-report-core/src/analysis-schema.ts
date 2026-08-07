import { languageTagSchema } from "@mvl/shared";
import { z } from "zod";

const exampleSchema = z
  .object({
    text: z.string().min(1),
    reading: z.string().min(1).nullable(),
    translation: z.string().min(1).nullable(),
  })
  .strict();

const grammarWithoutIdSchema = z
  .object({
    language: languageTagSchema,
    surface: z.string().min(1),
    pattern: z.string().min(1),
    category: z.string().min(1),
    formation: z.string().min(1),
    meaning: z.string().min(1),
    explanation: z.string().min(1),
    nuance: z.string().min(1).nullable(),
    context: z.string().min(1).nullable(),
    examples: z.array(exampleSchema).min(1).max(1),
    levelSystem: z.enum(["JLPT", "HSK", "CEFR", "unknown"]),
    level: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const vocabularySchema = z
  .object({
    surface: z.string().min(1),
    language: languageTagSchema,
    reading: z.string().min(1).nullable(),
    meaning: z.string().min(1),
  })
  .strict();

export const sentenceAnalysisSchema = z
  .object({
    sentenceId: z.string().min(1),
    reading: z.string().min(1).nullable(),
    translation: z.string().min(1).nullable(),
    grammar: z.array(grammarWithoutIdSchema),
    vocabulary: z.array(vocabularySchema),
  })
  .strict();

export const analysisBatchSchema = z
  .object({ sentences: z.array(sentenceAnalysisSchema) })
  .strict();
