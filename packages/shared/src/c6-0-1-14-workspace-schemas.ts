import { z } from "zod";
import {
  c60114IntervalSchema,
  c60114ReviewTargetsSchema,
  c60114SourceIdentitySchema,
} from "./c6-0-1-14-evidence-schemas.js";
import {
  c60114DeliveryHeader,
  c60114PlaybackTimelineV2Schema,
  c60114ReviewAudioManifestV3Schema,
  c60114ReviewRegionsV3Schema,
} from "./c6-0-1-14-review-delivery-schemas.js";
import {
  c60114LocalizedLexicalEvidenceSchema,
  c60114MissingSpeechEvidenceV3Schema,
} from "./c6-0-1-14-probe-schemas.js";

export const c60114WorkspaceExtensionSchema = z
  .object({
    ...c60114DeliveryHeader,
    workspaceMode: z.literal("SOURCE_TARGET_PLAYBACK_V3"),
    targets: c60114ReviewTargetsSchema,
    regions: c60114ReviewRegionsV3Schema,
    audio: c60114ReviewAudioManifestV3Schema,
    playback: c60114PlaybackTimelineV2Schema,
    lexical: c60114LocalizedLexicalEvidenceSchema,
    missing: c60114MissingSpeechEvidenceV3Schema,
    islands: z.array(
      z
        .object({
          islandId: z.string().min(1),
          sourceInterval: c60114IntervalSchema,
          speechPositive: z.boolean(),
          sourceIdentity: c60114SourceIdentitySchema,
          parentGapIds: z.array(z.string()),
        })
        .strict(),
    ),
    orphans: z.array(
      z
        .object({
          orphanId: z.string().min(1),
          sourceInterval: c60114IntervalSchema,
          classification: z.string().min(1),
          sourceIslandId: z.string().min(1),
        })
        .strict(),
    ),
    unresolvedItemIds: z.array(z.string().min(1)),
    rankerStatus: z.literal("RANKER_NOT_RECALIBRATED_IN_C6_0_1_14"),
    humanTrialStarted: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
    semanticHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type C60114WorkspaceExtension = z.infer<
  typeof c60114WorkspaceExtensionSchema
>;
