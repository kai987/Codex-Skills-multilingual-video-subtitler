import path from "node:path";
import { z } from "zod";
import {
  NodeProcessRunner,
  dialogueViews142Schema,
  viewAudit142Schema,
  acousticFeatures142Schema,
  type Policy142,
  type C601141AudioViews,
} from "@mvl/shared";
import { header142 } from "./c601142-policy.js";
import { hash141, hashed141, id141, required141 } from "./c601141-policy.js";
import { fileHash141, durableJson141 } from "./c601141-io.js";
const rawMetrics = z.object({
  role: z.string(),
  pcmSha256: z.string(),
  parentPcmSha256: z.string(),
  frameCount: z.number(),
  durationDeltaSamples: z.number(),
  parentCorrelation: z.number(),
  maximumCrossCorrelation: z.number(),
  maximumCrossCorrelationLagSamples16k: z.number(),
  spectralShapeDifference: z.number(),
  features: acousticFeatures142Schema,
  amplitudeOnlyNoOp: z.boolean(),
});
const rawSchema = z
  .object({
    controls: z.array(
      z
        .object({
          role: z.string(),
          inputFrames: z.number(),
          outputFrames: z.number(),
          impulseOffsets16k: z.array(z.number()),
          measuredDelayNativeSamples: z.array(z.number()),
          firGroupDelaySamples16k: z.number(),
          firCompensatedSamples16k: z.number(),
          controlPcmHash: z.string(),
          passed: z.literal(true),
        })
        .strict(),
    ),
    oldAudit: z.array(rawMetrics.extend({ viewId: z.string() }).strict()),
    generated: z.array(
      rawMetrics
        .extend({
          relativePath: z.string(),
          audioSha256: z.string(),
          parentViewId: z.string(),
          recipe: z
            .object({
              firTaps: z.number(),
              bandHz: z.array(z.number()).length(2),
              preemphasis: z.number(),
              preemphasisMode: z.literal("ZERO_PHASE_SYMMETRIC"),
              compressionThreshold: z.number(),
              compressionRatio: z.number(),
              peakNormalize: z.number(),
            })
            .strict(),
        })
        .strict(),
    ),
    modelInferenceCount: z.literal(0),
    networkUsed: z.literal(false),
  })
  .strict();
export async function buildViews142(input: {
  policy: Policy142;
  oldViews: C601141AudioViews;
  oldDirectory: string;
  outputDirectory: string;
  auditDirectory: string;
  python: string;
  worker: string;
}) {
  const requestFile = path.join(
    input.auditDirectory,
    "dsp-request.local-only.json",
  );
  await durableJson141(requestFile, {
    views: input.oldViews.views.map((v) => ({
      viewId: v.viewId,
      role: v.role,
      pcmSha256: v.pcmSha256,
      path: path.join(input.oldDirectory, v.relativePath),
    })),
    nativeSampleRate: input.oldViews.sourceIdentity.sampleRate,
    outputDirectory: input.outputDirectory,
  });
  const runner = new NodeProcessRunner();
  const result = await runner.run(
    input.python,
    [input.worker, "--mode", "views", "--request", requestFile],
    { timeoutMs: 600000 },
  );
  const raw = rawSchema.parse(JSON.parse(result.stdout));
  await durableJson141(
    path.join(input.auditDirectory, "dsp-measurements.local-only.json"),
    raw,
  );
  const syntheticControlsHash = hash141(raw.controls),
    workerHash = await fileHash141(input.worker);
  const seen = new Map<string, string>();
  const rows = raw.oldAudit.map((row) => {
    const duplicateOfViewId = seen.get(row.pcmSha256) ?? null;
    if (!duplicateOfViewId) seen.set(row.pcmSha256, row.viewId);
    const old = required141(
      input.oldViews.views.find((v) => v.viewId === row.viewId),
    );
    const amplitudeOnlyNoOp =
      row.amplitudeOnlyNoOp && row.role !== "NATIVE_MONO";
    const effectiveNoOp = duplicateOfViewId !== null || amplitudeOnlyNoOp;
    return hashed141({
      ...row,
      amplitudeOnlyNoOp,
      duplicateOfViewId,
      effectiveNoOp,
      measuredImpulseDelayNativeSamples:
        old.timeMapping.measuredImpulsePeakDelaySamples,
      verifiedTimebase:
        row.durationDeltaSamples === 0 &&
        old.timeMapping.measuredImpulsePeakDelaySamples === 0,
      detectorEligible: old.detectorEligible && !effectiveNoOp,
      rejectionReason: duplicateOfViewId
        ? "DUPLICATE_PCM"
        : amplitudeOnlyNoOp
          ? "AMPLITUDE_ONLY_EFFECTIVE_NOOP"
          : null,
    });
  });
  const views = raw.generated.map((row) => {
    const viewId = id141("dialogue-view-v2", {
      source: input.oldViews.sourceIdentity,
      role: row.role,
      pcmSha256: row.pcmSha256,
      recipe: row.recipe,
    });
    const duplicateOfViewId = seen.get(row.pcmSha256) ?? null;
    if (!duplicateOfViewId) seen.set(row.pcmSha256, viewId);
    const controls = required141(raw.controls.find((c) => c.role === row.role));
    const delay = Math.max(
      ...controls.measuredDelayNativeSamples.map(Math.abs),
    );
    const verifiedTimebase = row.durationDeltaSamples === 0 && delay <= 1;
    const effectiveNoOp = duplicateOfViewId !== null || row.amplitudeOnlyNoOp;
    const detectorEligible = verifiedTimebase && !effectiveNoOp;
    const rejectionReason = !verifiedTimebase
      ? "UNVERIFIED_TIMEBASE"
      : duplicateOfViewId
        ? "DUPLICATE_PCM"
        : effectiveNoOp
          ? "AMPLITUDE_ONLY_EFFECTIVE_NOOP"
          : null;
    const {
      recipe,
      audioSha256: _sha,
      relativePath: _p,
      parentViewId: _v,
      ...metrics
    } = row;
    void [_sha, _p, _v];
    rows.push(
      hashed141({
        ...metrics,
        viewId,
        duplicateOfViewId,
        effectiveNoOp,
        measuredImpulseDelayNativeSamples: delay,
        verifiedTimebase,
        detectorEligible,
        rejectionReason,
      }),
    );
    const parent = required141(
      input.oldViews.views.find((v) => v.viewId === row.parentViewId),
    );
    return hashed141({
      viewId,
      role: row.role,
      parentViewId: row.parentViewId,
      parentPcmSha256: row.parentPcmSha256,
      relativePath: row.relativePath,
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      frameCount: row.frameCount,
      durationSeconds: row.frameCount / 16000,
      audioSha256: row.audioSha256,
      pcmSha256: row.pcmSha256,
      recipe: JSON.stringify(recipe),
      recipeHash: hash141(recipe),
      workerHash,
      timeMapping: {
        ...parent.timeMapping,
        measuredImpulsePeakDelaySamples: delay,
        syntheticValidationHash: syntheticControlsHash,
      },
      duplicateOfViewId,
      effectiveNoOp,
      detectorEligible,
      rejectionReason,
    });
  });
  const manifest = dialogueViews142Schema.parse(
    hashed141({
      ...header142(input.policy, input.oldViews.sourceIdentity),
      artifactType: "machine-dialogue-emphasis-audio-views-v2",
      baselineViewsHash: input.oldViews.semanticHash,
      syntheticControlsHash,
      views,
      summary: {
        logicalViewCount: views.length,
        uniqueEffectiveViewCount: views.filter((v) => v.detectorEligible)
          .length,
        rejectedViewCount: views.filter((v) => !v.detectorEligible).length,
        modelInferenceCount: 0,
        neuralSourceSeparationCount: 0,
      },
    }),
  );
  const audit = viewAudit142Schema.parse(
    hashed141({
      ...header142(input.policy, input.oldViews.sourceIdentity),
      artifactType: "machine-audio-view-effectiveness-audit",
      baselineViewsHash: input.oldViews.semanticHash,
      featureAlgorithm: "pcm-rms-stft-modulation-autocorrelation-v1",
      syntheticControlsHash,
      rows,
      newInferenceCount: 0,
      canonicalMutationCount: 0,
    }),
  );
  await durableJson141(
    path.join(
      input.outputDirectory,
      "machine-dialogue-emphasis-audio-views-v2.json",
    ),
    manifest,
  );
  await durableJson141(
    path.join(
      input.auditDirectory,
      "machine-audio-view-effectiveness-audit.json",
    ),
    audit,
  );
  return { manifest, audit };
}
