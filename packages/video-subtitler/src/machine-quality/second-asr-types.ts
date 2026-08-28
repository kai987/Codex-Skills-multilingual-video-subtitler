import type {
  crossModelDisagreementClassSchema,
  ctcArbitrationOutcomeSchema,
  goldCrossModelTaxonomySchema,
} from "@mvl/shared";
import type { z } from "zod";

export type CrossModelDisagreementClass = z.infer<
  typeof crossModelDisagreementClassSchema
>;
export type CtcArbitrationOutcome = z.infer<typeof ctcArbitrationOutcomeSchema>;
export type GoldCrossModelTaxonomy = z.infer<
  typeof goldCrossModelTaxonomySchema
>;
