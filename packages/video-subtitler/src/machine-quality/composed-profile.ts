/** Opt-in fixed factorial profile. No recognition or reference access. */
import { z } from "zod";
import { primaryMinimal } from "./experimental-profile.js";
import {
  freshMatchedEvidenceSchema,
  replayPrimaryAssembly,
} from "./matched-replay.js";

export const composedPolicySchema = z
  .object({
    interCuePolicy: z.enum(["legacy", "overlap-required"]),
    intraCuePolicy: z.enum(["legacy", "source-preserving"]),
  })
  .strict();
export const COMPOSED_MATRIX = Object.freeze([
  { id: "P0-primary-minimal", policy: null },
  {
    id: "G00-legacy",
    policy: { interCuePolicy: "legacy", intraCuePolicy: "legacy" },
  },
  {
    id: "G10-cross-guard",
    policy: { interCuePolicy: "overlap-required", intraCuePolicy: "legacy" },
  },
  {
    id: "G01-intra-guard",
    policy: { interCuePolicy: "legacy", intraCuePolicy: "source-preserving" },
  },
  {
    id: "G11-composed",
    policy: {
      interCuePolicy: "overlap-required",
      intraCuePolicy: "source-preserving",
    },
  },
] as const);
export const COMPOSED_STATE = Object.freeze({
  version: "C6.0.1.17.2",
  mainCandidate: "G11-composed",
  replayIdentity: "VERIFIED_EVIDENCE_REPLAY",
  dataExposure: "KNOWN_DEVELOPMENT_RECHECK",
  acousticTruth: "UNKNOWN",
  qualification: "source-preservation-is-not-acoustic-confirmation",
  newASRRequests: 0,
  newModelInference: 0,
  newAcousticForwards: 0,
  newModelLoads: 0,
  newProviderStarts: 0,
  newAudioWindows: 0,
  status: "needs-review",
  finalizationMethod: "none",
  humanValidated: false,
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  BENCHMARK_REFERENCE_SEGMENTED: true,
  UNSEGMENTED_END_TO_END_VALIDATION: "NOT_RUN",
  HELDOUT_VALIDATION_NOT_RUN: true,
});
export function replayComposedAssembly(
  value: unknown,
  policy: unknown,
  hashes: Record<string, string> = {},
) {
  const evidence = freshMatchedEvidenceSchema.parse(value);
  const parsed = composedPolicySchema.parse(policy);
  return replayPrimaryAssembly(
    evidence,
    parsed.intraCuePolicy === "source-preserving",
    hashes,
    undefined,
    undefined,
    undefined,
    { deduplication: parsed.interCuePolicy },
  );
}
export function replayComposedMatrix(
  value: unknown,
  hashes: Record<string, string> = {},
) {
  const evidence = freshMatchedEvidenceSchema.parse(value);
  return COMPOSED_MATRIX.map((profile) => ({
    ...profile,
    result:
      profile.policy === null
        ? {
            primary: primaryMinimal(evidence),
            cues: primaryMinimal(evidence),
            trace: [],
          }
        : replayComposedAssembly(evidence, profile.policy, hashes),
  }));
}
