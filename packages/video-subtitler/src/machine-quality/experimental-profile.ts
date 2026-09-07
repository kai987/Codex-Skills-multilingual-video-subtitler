import { createHash } from "node:crypto";
import { z } from "zod";
import { subtitleCueSchema } from "@mvl/shared";

export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const objectHash = (value: unknown): string =>
  sha256(JSON.stringify(value));
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict();
export const machineQualityEvidenceSchema = z
  .object({
    version: z.literal("c60116-evidence-v1"),
    partition: z.literal("development-known"),
    source: z
      .object({
        sha256: digest,
        durationSeconds: z.number().positive(),
        audioStream: z.number().int(),
        sourceSampleRate: z.number().positive(),
        mediaStart: z.number(),
        fileName: z.string(),
      })
      .strict(),
    primaryRequests: z.array(
      z
        .object({
          id: z.string(),
          cacheKey: digest,
          cacheFileHash: digest,
          audioHash: digest,
          resultHash: digest,
          modelHash: digest.nullable(),
          model: z.string(),
          runtime: z.string().nullable(),
          tokenizer: z.string().nullable(),
          promptHash: digest,
          decodeHash: digest,
          sampleRate: z.number().positive(),
          interval,
          timebase: z.literal("original-audio-local"),
          vadEnabled: z.literal(false),
          segments: z.array(
            z
              .object({
                id: z.string(),
                start: z.number().nonnegative(),
                end: z.number().positive(),
                text: z.string().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    canonicalLineage: z.array(
      z
        .object({ id: z.string(), rawSegmentIds: z.array(z.string()).min(1) })
        .strict(),
    ),
    stableCues: z.array(subtitleCueSchema),
    unprovenRepetition: z.array(
      z
        .object({
          cueId: z.string(),
          outputCueIds: z.array(z.string()),
          removedText: z.array(z.string()),
          reason: z.literal(
            "no-independent-token-timestamps-for-second-utterance",
          ),
        })
        .strict(),
    ),
    provenance: z
      .object({
        baselineCommit: digest.or(z.string().regex(/^[0-9a-f]{40}$/u)),
        stablePackageHash: digest,
        stableAssHash: digest,
        stableSrtHash: digest,
        stableVttHash: digest,
        primaryArtifactHash: digest,
        canonicalArtifactHash: digest,
        repetitionArtifactHash: digest,
        inputManifestHash: digest,
        stableReplay: z.literal(
          "historical-canonical-verified-not-full-pipeline-replayed",
        ),
        humanInputCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export type MachineQualityEvidence = z.infer<
  typeof machineQualityEvidenceSchema
>;

export function primaryMinimal(
  e: Pick<MachineQualityEvidence, "source" | "primaryRequests">,
) {
  const seen = new Map<string, string>();
  const cues = e.primaryRequests
    .flatMap((request) => {
      const prior = seen.get(request.id);
      if (prior !== undefined) {
        if (prior !== objectHash(request))
          throw new Error("Conflicting duplicate request identity");
        return [];
      }
      seen.set(request.id, objectHash(request));
      return request.segments.map((s) => {
        if (
          s.end <= s.start ||
          s.end > request.interval.end - request.interval.start + 0.05
        )
          throw new Error("Unverified segment timebase");
        // The extraction offset already uses source-global seconds. Never add mediaStart twice.
        const start = s.start + request.interval.start,
          end = s.end + request.interval.start;
        if (end > e.source.durationSeconds + 0.05)
          throw new Error("Segment outside source");
        return subtitleCueSchema.parse({
          id: s.id,
          start,
          end,
          text: s.text,
          language: "ja",
          languages: ["ja"],
          speaker: null,
          confidence: null,
        });
      });
    })
    .toSorted(
      (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
    );
  if (new Set(cues.map((c) => c.id)).size !== cues.length)
    throw new Error("Duplicate primary segment identity");
  return cues;
}
