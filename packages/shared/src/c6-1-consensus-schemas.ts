export * from "./c6-1-alignment-schemas.js";
export * from "./c6-1-decoder-schemas.js";
export * from "./c6-1-evaluation-schemas.js";
export * from "./c6-1-hypothesis-schemas.js";
export * from "./c6-1-io-schemas.js";

import { z } from "zod";
import {
  c61TextRepresentationSchema,
  c61PairwiseAlignmentSchema,
  c61MultipleAlignmentSchema,
  c61TokenLatticeSchema,
  c61ConfusionNetworkSchema,
  c61ConsensusSpanSchema,
} from "./c6-1-alignment-schemas.js";
import { c61SelectedPathSchema } from "./c6-1-decoder-schemas.js";
const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal("c6.1-consensus-investigation-v1"),
  semanticHash: z.string().regex(/^[a-f0-9]{64}$/u),
};
export const machineMultiAsrTextRepresentationsSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-text-representations"),
    representations: z.array(c61TextRepresentationSchema),
  })
  .strict();
export const machineMultiAsrPairwiseAlignmentsSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-pairwise-alignments"),
    alignments: z.array(c61PairwiseAlignmentSchema),
  })
  .strict();
export const machineMultiAsrMultipleAlignmentsSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-multiple-alignments"),
    alignments: z.array(c61MultipleAlignmentSchema),
  })
  .strict();
export const machineMultiAsrTokenLatticeSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-token-lattice"),
    lattices: z.array(c61TokenLatticeSchema),
  })
  .strict();
export const machineMultiAsrConfusionNetworkSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-confusion-network"),
    networks: z.array(c61ConfusionNetworkSchema),
  })
  .strict();
export const machineMultiAsrSpanConsensusSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-span-consensus"),
    spans: z.array(c61ConsensusSpanSchema),
  })
  .strict();
export const c61ProfileSelectionsSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-profile-selections"),
    paths: z.array(
      z
        .object({
          profileId: z.string(),
          eventId: z.string(),
          latticeHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .nullable()
            .optional(),
          path: c61SelectedPathSchema.nullable(),
          maxProviderSwitches: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
