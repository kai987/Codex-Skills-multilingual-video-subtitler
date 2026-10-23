import { stat } from "node:fs/promises";

import type {
  IndependentAsrCandidate,
  MachineSecondAsrDiagnosticSet,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface IndependentAsrProviderRequest {
  requestId: string;
  eventId: string;
  diagnosticRole: MachineSecondAsrDiagnosticSet["events"][number]["role"];
  windowType: IndependentAsrCandidate["windowType"];
  sourceInterval: { start: number; end: number };
  sourceMediaSha256: string;
  audioPath: string;
  audioSha256: string;
  sampleRate: 16_000;
  sampleCount: number;
  extractionConfigHash: string;
}

export interface IndependentAsrRawTokenPoint {
  token: string;
  paddedAudioSeconds: number;
}

export interface IndependentAsrProviderResult {
  requestId: string;
  status:
    | "SUCCESS"
    | "EMPTY_OUTPUT"
    | "PROVIDER_ERROR"
    | "INVALID_AUDIO"
    | "UNSUPPORTED_DURATION"
    | "TIMEOUT"
    | "MODEL_FAILURE"
    | "SECOND_ASR_UNAVAILABLE";
  text: string;
  tokenPoints: IndependentAsrRawTokenPoint[];
  wallClockSeconds: number;
  warnings: string[];
}

export interface IndependentAsrProviderDiagnostics {
  providerId: "reazonspeech-k2-v2";
  adapterType: "DIRECT_SHERPA_ONNX_OFFICIAL_REAZON_FP32";
  pythonVersion: string;
  sherpaOnnxVersion: string;
  modelLoadSeconds: number;
  modelLoadCount: number;
  processStartCount: number;
  peakRssBytes: number | null;
}

export interface IndependentAsrProvider {
  readonly providerId: "reazonspeech-k2-v2";
  readonly maxAudioSeconds: 30;
  transcribeBatch(requests: readonly IndependentAsrProviderRequest[]): Promise<{
    results: IndependentAsrProviderResult[];
    diagnostics: IndependentAsrProviderDiagnostics;
  }>;
  close(): Promise<void>;
}

export function independentAsrCacheKey(input: {
  providerId: string;
  modelRevision: string;
  modelFileHashes: Readonly<Record<string, string>>;
  precision: "fp32";
  audioSha256: string;
  sourceInterval: { start: number; end: number };
  decodingConfig: Readonly<Record<string, unknown>>;
  normalizationConfig: Readonly<Record<string, unknown>>;
}): string {
  return machineQualitySemanticHash({
    providerId: input.providerId,
    modelRevision: input.modelRevision,
    modelFileHashes: Object.fromEntries(
      Object.entries(input.modelFileHashes).toSorted(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    precision: input.precision,
    audioSha256: input.audioSha256,
    sourceInterval: input.sourceInterval,
    decodingConfig: input.decodingConfig,
    normalizationConfig: input.normalizationConfig,
    hotwords: null,
    contextualBiasing: null,
    externalLanguageModel: null,
  });
}

export async function assertIndependentAsrAudioRequest(
  request: IndependentAsrProviderRequest,
): Promise<void> {
  const duration = request.sampleCount / request.sampleRate;
  if (request.sourceInterval.end <= request.sourceInterval.start) {
    throw new Error(`Invalid source interval for ${request.requestId}.`);
  }
  if (duration <= 0 || duration + 1.8 > 30.000_001) {
    throw new Error(
      `Request ${request.requestId} exceeds the padded 30 second provider limit.`,
    );
  }
  const info = await stat(request.audioPath);
  if (!info.isFile() || info.size <= 44) {
    throw new Error(`Request ${request.requestId} has no valid local WAV.`);
  }
}
