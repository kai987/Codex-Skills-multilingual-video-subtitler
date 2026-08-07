import path from "node:path";

import {
  AppError,
  transcriptionPlanSchema,
  type DeviceProfile,
  type MediaProfile,
  type CoreMLCapabilityState,
  type TranscriptionPlan,
  type WhisperBenchmark,
  type WhisperModelCapability,
} from "@mvl/shared";

import type { CoreMLMode, TranscriptionStrategy } from "./types.js";

const DEFAULT_FULL_QUALITY_RTF = 1;
const DEFAULT_FULL_QUALITY_COREML_RTF = 0.45;
const DEFAULT_TURBO_RTF = 0.25;
const DEFAULT_TURBO_COREML_RTF = 0.12;
const DEFAULT_MAX_MERGED_REFINEMENT_SECONDS = 30;
const HARD_MAX_MERGED_REFINEMENT_SECONDS = 45;
const DEFAULT_NO_VAD_TIE_BREAK_BONUS = 0.04;

function fitsMemory(
  capability: WhisperModelCapability,
  device: DeviceProfile,
): boolean {
  if (capability.estimatedMemoryBytes === null) return true;
  const availableBytes =
    (device.memory.availableGiB ?? device.memory.totalGiB) * 1024 ** 3;
  return capability.estimatedMemoryBytes <= availableBytes * 0.9;
}

function usableCapabilities(
  device: DeviceProfile,
  coreML: CoreMLMode,
): WhisperModelCapability[] {
  return device.models.filter((capability) => {
    if (!fitsMemory(capability, device)) return false;
    if (coreML === "on") {
      return (
        capability.runtime === "coreml" &&
        capability.coreML.supported &&
        capability.coreML.status === "available" &&
        capability.coreML.runtimeValidated
      );
    }
    if (coreML === "off") return capability.runtime === "cpu";
    if (capability.runtime === "cpu") return true;
    return (
      capability.coreML.status === "available" &&
      capability.coreML.runtimeValidated
    );
  });
}

function capabilityRank(
  capability: WhisperModelCapability,
  preferCoreML: boolean,
): number {
  const coreML = capability.runtime === "coreml" ? (preferCoreML ? 0 : 2) : 1;
  const full = capability.quantization === null ? 0 : 1;
  return coreML * 10 + full;
}

function chooseFamily(
  capabilities: readonly WhisperModelCapability[],
  family: string,
  preferCoreML: boolean,
): WhisperModelCapability | null {
  return (
    capabilities
      .filter((capability) => capability.modelFamily === family)
      .toSorted(
        (left, right) =>
          capabilityRank(left, preferCoreML) -
            capabilityRank(right, preferCoreML) ||
          left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

function benchmarkRtf(
  capability: WhisperModelCapability,
  benchmark: WhisperBenchmark | null,
): number {
  const measured = benchmark?.entries.find(
    (entry) => entry.capabilityId === capability.id,
  )?.rtf;
  if (measured !== undefined) return measured;
  if (capability.modelFamily === "large-v3-turbo") {
    return capability.coreML.supported
      ? DEFAULT_TURBO_COREML_RTF
      : DEFAULT_TURBO_RTF;
  }
  return capability.coreML.supported
    ? DEFAULT_FULL_QUALITY_COREML_RTF
    : DEFAULT_FULL_QUALITY_RTF;
}

function pass(
  capability: WhisperModelCapability,
  role: "baseline" | "refinement" | "fallback",
  coreMLCapability: CoreMLCapabilityState,
) {
  return {
    capabilityId: capability.id,
    modelFamily: capability.modelFamily,
    model: path.basename(capability.modelPath),
    coreML: capability.runtime === "coreml",
    coreMLCapability,
    role,
  } as const;
}

function reportedCoreMLCapability(input: {
  capability: WhisperModelCapability;
  capabilities: readonly WhisperModelCapability[];
  mode: CoreMLMode;
}): CoreMLCapabilityState {
  if (input.capability.runtime === "coreml") return input.capability.coreML;
  if (input.mode === "off") {
    return {
      ...input.capability.coreML,
      supported: false,
      status: "disabled-by-user",
      runtimeValidated: false,
      reason: "Core ML was disabled by the user.",
    };
  }
  return (
    input.capabilities.find(
      (candidate) =>
        candidate.runtime === "coreml" &&
        candidate.modelPath === input.capability.modelPath,
    )?.coreML ?? input.capability.coreML
  );
}

function coreMLFallbackReason(status: CoreMLCapabilityState["status"]): string {
  return status === "not-compiled" ? "coreml-not-compiled" : `coreml-${status}`;
}

function assertExplicitCoreMLAvailable(
  device: DeviceProfile,
  coreML: CoreMLMode,
): void {
  if (coreML !== "on") return;
  const coreMLCapabilities = device.models.filter(
    (capability) => capability.runtime === "coreml",
  );
  if (
    coreMLCapabilities.some(
      (capability) =>
        capability.coreML.status === "available" &&
        capability.coreML.runtimeValidated,
    )
  ) {
    return;
  }
  const notCompiled = coreMLCapabilities.find(
    (capability) => capability.coreML.status === "not-compiled",
  );
  if (notCompiled === undefined) return;
  throw new AppError(
    "Core ML is available on this device, but the configured whisper.cpp binary was not compiled with Core ML support.",
    {
      code: "COREML_NOT_COMPILED",
      exitCode: 4,
      details: {
        coreMLStatus: "not-compiled",
        capabilityId: notCompiled.id,
        recovery: [
          "rebuild whisper.cpp with Core ML support",
          "rerun with --coreml auto",
          "rerun with --coreml off",
        ],
      },
    },
  );
}

function qualityUnavailable(input: {
  coreML: CoreMLMode;
  capabilities: readonly WhisperModelCapability[];
}): AppError {
  return new AppError(
    "No usable full-quality large-v3 model is available for the requested strategy.",
    {
      code: "QUALITY_MODEL_UNAVAILABLE",
      exitCode: 4,
      details: {
        coreML: input.coreML,
        availableModels: input.capabilities.map((item) => ({
          id: item.id,
          family: item.modelFamily,
          coreMLStatus: item.coreML.status,
        })),
      },
    },
  );
}

export function planTranscription(input: {
  device: DeviceProfile;
  media: MediaProfile;
  benchmark: WhisperBenchmark | null;
  strategy?: TranscriptionStrategy;
  coreML?: CoreMLMode;
  maxFullQualityRuntimeSeconds?: number;
  maxRefinementRounds?: number;
  refinementContextSeconds?: number;
  refinementMergeGapSeconds?: number;
  maxMergedRefinementSeconds?: number;
  noVadTieBreakBonus?: number;
  fullSecondPass?: boolean;
  refineFast?: boolean;
  allowQualityFallback?: boolean;
}): TranscriptionPlan {
  const requestedStrategy = input.strategy ?? "auto";
  const coreML = input.coreML ?? "auto";
  const maxFullQualityRuntimeSeconds =
    input.maxFullQualityRuntimeSeconds ?? 300;
  const maxRefinementRounds = input.maxRefinementRounds ?? 2;
  const refinementContextSeconds = input.refinementContextSeconds ?? 5;
  const refinementMergeGapSeconds = input.refinementMergeGapSeconds ?? 1.5;
  const maxMergedRefinementSeconds = Math.min(
    HARD_MAX_MERGED_REFINEMENT_SECONDS,
    input.maxMergedRefinementSeconds ?? DEFAULT_MAX_MERGED_REFINEMENT_SECONDS,
  );
  const noVadTieBreakBonus =
    input.noVadTieBreakBonus ?? DEFAULT_NO_VAD_TIE_BREAK_BONUS;
  assertExplicitCoreMLAvailable(input.device, coreML);
  const capabilities = usableCapabilities(input.device, coreML);
  const preferCoreML = coreML !== "off";
  const quality = chooseFamily(capabilities, "large-v3", preferCoreML);
  const turbo = chooseFamily(capabilities, "large-v3-turbo", preferCoreML);
  const reasons: string[] = [];
  const fallbacks: TranscriptionPlan["fallbacks"] = [];

  const effectiveSpeech = input.media.effectiveSpeechDurationSeconds;
  const fullQualitySeconds =
    quality === null
      ? null
      : effectiveSpeech * benchmarkRtf(quality, input.benchmark);
  const turboSeconds =
    turbo === null
      ? null
      : effectiveSpeech * benchmarkRtf(turbo, input.benchmark);

  let strategy: TranscriptionPlan["strategy"];
  let baseline: WhisperModelCapability;
  let refinement: WhisperModelCapability | null = null;

  if (requestedStrategy === "quality") {
    if (quality !== null) {
      strategy = "quality";
      baseline = quality;
      reasons.push(
        quality.coreML.supported
          ? "quality-model-coreml-available"
          : "quality-model-cpu-fallback",
      );
    } else if (input.allowQualityFallback === true && turbo !== null) {
      strategy = "fast";
      baseline = turbo;
      reasons.push("quality-model-unavailable", "quality-fallback-allowed");
      fallbacks.push({
        from: "quality",
        to: "fast",
        reason: "allow-quality-fallback",
      });
    } else {
      throw qualityUnavailable({ coreML, capabilities });
    }
  } else if (requestedStrategy === "fast") {
    if (turbo === null) {
      throw new AppError(
        "No usable large-v3-turbo model is available for the fast strategy.",
        {
          code: "FAST_MODEL_UNAVAILABLE",
          exitCode: 4,
          details: { coreML },
        },
      );
    }
    strategy = "fast";
    baseline = turbo;
    refinement = input.refineFast === true ? quality : null;
    reasons.push("fast-explicitly-requested");
    if (input.refineFast === true && quality === null) {
      reasons.push("refinement-model-unavailable");
    }
  } else if (requestedStrategy === "adaptive") {
    if (turbo === null) {
      if (quality === null) throw qualityUnavailable({ coreML, capabilities });
      strategy = "quality";
      baseline = quality;
      reasons.push("turbo-model-unavailable", "quality-fallback");
      fallbacks.push({
        from: "adaptive",
        to: "quality",
        reason: "turbo-model-unavailable",
      });
    } else {
      if (quality === null) throw qualityUnavailable({ coreML, capabilities });
      strategy = "adaptive";
      baseline = turbo;
      refinement = quality;
      reasons.push("adaptive-explicitly-requested");
    }
  } else {
    if (quality === null) {
      if (turbo === null) throw qualityUnavailable({ coreML, capabilities });
      strategy = "fast";
      baseline = turbo;
      reasons.push("quality-model-unavailable", "fast-only-capability");
    } else if (
      fullQualitySeconds !== null &&
      fullQualitySeconds <= maxFullQualityRuntimeSeconds
    ) {
      strategy = "quality";
      baseline = quality;
      reasons.push(
        "full-quality-runtime-within-target",
        `effective-speech-seconds:${effectiveSpeech.toFixed(3)}`,
      );
    } else if (turbo !== null) {
      strategy = "adaptive";
      baseline = turbo;
      refinement = quality;
      reasons.push(
        "full-quality-runtime-above-target",
        "turbo-baseline-available",
        `effective-speech-seconds:${effectiveSpeech.toFixed(3)}`,
      );
    } else {
      strategy = "quality";
      baseline = quality;
      reasons.push("turbo-model-unavailable", "quality-only-capability");
    }
  }

  if (coreML === "auto") {
    for (const selected of [baseline, refinement].filter(
      (candidate): candidate is WhisperModelCapability => candidate !== null,
    )) {
      if (selected.runtime !== "cpu") continue;
      const diagnostic = input.device.models.find(
        (candidate) =>
          candidate.modelPath === selected.modelPath &&
          candidate.runtime === "coreml" &&
          candidate.coreML.status !== "available",
      );
      if (diagnostic === undefined) continue;
      const fallback = {
        from: `${selected.modelFamily}-coreml`,
        to: `${selected.modelFamily}-cpu`,
        reason: coreMLFallbackReason(diagnostic.coreML.status),
      };
      if (
        !fallbacks.some(
          (item) =>
            item.from === fallback.from &&
            item.to === fallback.to &&
            item.reason === fallback.reason,
        )
      ) {
        fallbacks.push(fallback);
      }
    }
  }

  return transcriptionPlanSchema.parse({
    schemaVersion: "1.0.0",
    requestedStrategy,
    strategy,
    reason: reasons,
    baseline: pass(
      baseline,
      "baseline",
      reportedCoreMLCapability({
        capability: baseline,
        capabilities: input.device.models,
        mode: coreML,
      }),
    ),
    refinement:
      refinement === null
        ? null
        : {
            ...pass(
              refinement,
              "refinement",
              reportedCoreMLCapability({
                capability: refinement,
                capabilities: input.device.models,
                mode: coreML,
              }),
            ),
            fallbackCoreML: !refinement.coreML.supported,
            maxRounds: maxRefinementRounds,
            contextSeconds: refinementContextSeconds,
            mergeGapSeconds: refinementMergeGapSeconds,
            maxMergedRefinementSeconds,
            noVadTieBreakBonus,
          },
    estimatedRuntime: {
      baselineSeconds:
        baseline.modelFamily === "large-v3-turbo"
          ? turboSeconds
          : fullQualitySeconds,
      fullQualitySeconds,
    },
    maxFullQualityRuntimeSeconds,
    fullSecondPass: input.fullSecondPass ?? false,
    fallbacks,
  });
}
