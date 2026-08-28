import {
  c6016PolicyVersion,
  machineDecoderEvidenceSchema,
  type C6016Mode,
  type DecoderEvidenceEntry,
  type MachineDecoderEvidence,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

type Availability = "available" | "unavailable" | "unsupported" | "unknown";

export interface DecoderFieldInput<T extends number | boolean> {
  value?: T | null;
  availability?: Availability;
  reason?: string | null;
}

export interface DecoderEvidenceInput {
  eventId: string;
  candidateId: string;
  requestId: string;
  candidateFamily: "PRIMARY" | "RECOVERY" | "TARGETED_RE_ASR" | "RAW_RE_ASR";
  decoderProvider: string;
  averageLogProbability?: DecoderFieldInput<number>;
  noSpeechProbability?: DecoderFieldInput<number>;
  compressionRatio?: DecoderFieldInput<number>;
  temperature?: DecoderFieldInput<number>;
  fallbackCount?: DecoderFieldInput<number>;
  decoderSegmentStart?: DecoderFieldInput<number>;
  decoderSegmentEnd?: DecoderFieldInput<number>;
  tokenTimestampAvailable?: DecoderFieldInput<boolean>;
  tokenCount?: DecoderFieldInput<number>;
  requestEdgeDistance?: DecoderFieldInput<number>;
  languageProbability?: DecoderFieldInput<number>;
  confidenceDiagnostics?: readonly string[];
  provenance: {
    sourceArtifact: string;
    sourceRequestId: string;
    providerResponseRetained: boolean;
    sourceGlobalVerified: boolean;
  };
}

function normalizeField<T extends number | boolean>(
  input: DecoderFieldInput<T> | undefined,
  defaultUnavailableReason: string,
): { availability: Availability; value: T | null; reason: string | null } {
  if (input?.value !== undefined && input.value !== null) {
    return {
      availability: "available",
      value: input.value,
      reason: input.reason ?? null,
    };
  }
  const availability = input?.availability ?? "unknown";
  return {
    availability,
    value: null,
    reason: input?.reason ?? defaultUnavailableReason,
  };
}

export function normalizeDecoderEvidence(
  input: DecoderEvidenceInput,
): DecoderEvidenceEntry {
  const fields = {
    averageLogProbability: normalizeField(
      input.averageLogProbability,
      "average-log-probability-not-retained",
    ),
    noSpeechProbability: normalizeField(
      input.noSpeechProbability,
      "no-speech-probability-not-retained",
    ),
    compressionRatio: normalizeField(
      input.compressionRatio,
      "compression-ratio-not-emitted-by-provider",
    ),
    temperature: normalizeField(input.temperature, "temperature-not-retained"),
    fallbackCount: normalizeField(
      input.fallbackCount,
      "fallback-count-not-emitted-by-provider",
    ),
    decoderSegmentStart: normalizeField(
      input.decoderSegmentStart,
      "decoder-segment-start-not-retained",
    ),
    decoderSegmentEnd: normalizeField(
      input.decoderSegmentEnd,
      "decoder-segment-end-not-retained",
    ),
    tokenTimestampAvailable: normalizeField(
      input.tokenTimestampAvailable,
      "token-timestamp-availability-not-retained",
    ),
    tokenCount: normalizeField(
      input.tokenCount,
      "decoder-token-count-not-retained",
    ),
    requestEdgeDistance: normalizeField(
      input.requestEdgeDistance,
      "request-interval-not-associated",
    ),
    languageProbability: normalizeField(
      input.languageProbability,
      "language-probability-not-emitted-by-provider",
    ),
  };
  const availabilityValues = Object.values(fields).map(
    (field) => field.availability,
  );
  const availability: Availability = availabilityValues.includes("available")
    ? "available"
    : availabilityValues.every((value) => value === "unsupported")
      ? "unsupported"
      : availabilityValues.includes("unavailable")
        ? "unavailable"
        : "unknown";
  const core = {
    eventId: input.eventId,
    candidateId: input.candidateId,
    requestId: input.requestId,
    candidateFamily: input.candidateFamily,
    decoderProvider: input.decoderProvider,
    availability,
    fields,
    confidenceDiagnostics: [...new Set(input.confidenceDiagnostics ?? [])],
    provenance: input.provenance,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

function coverage(
  candidates: readonly DecoderEvidenceEntry[],
  families: ReadonlySet<DecoderEvidenceEntry["candidateFamily"]>,
): number {
  const matching = candidates.filter((candidate) =>
    families.has(candidate.candidateFamily),
  );
  return matching.length === 0
    ? 0
    : matching.filter((candidate) => candidate.availability === "available")
        .length / matching.length;
}

export function buildMachineDecoderEvidence(input: {
  mode: C6016Mode;
  candidates: readonly DecoderEvidenceInput[];
  generatedAt?: string;
}): MachineDecoderEvidence {
  const candidates = input.candidates
    .map(normalizeDecoderEvidence)
    .toSorted(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.candidateId.localeCompare(right.candidateId) ||
        left.requestId.localeCompare(right.requestId),
    );
  const summary = {
    candidateCount: candidates.length,
    availableCount: candidates.filter(
      (candidate) => candidate.availability === "available",
    ).length,
    unavailableCount: candidates.filter(
      (candidate) => candidate.availability === "unavailable",
    ).length,
    unsupportedCount: candidates.filter(
      (candidate) => candidate.availability === "unsupported",
    ).length,
    unknownCount: candidates.filter(
      (candidate) => candidate.availability === "unknown",
    ).length,
    primaryCoverage: coverage(candidates, new Set(["PRIMARY"])),
    recoveryCoverage: coverage(candidates, new Set(["RECOVERY"])),
    reAsrCoverage: coverage(
      candidates,
      new Set(["TARGETED_RE_ASR", "RAW_RE_ASR"]),
    ),
  };
  const core = {
    mode: input.mode,
    missingFieldPolicy:
      "explicit-unavailable-unsupported-or-unknown-never-zero" as const,
    candidates,
    summary,
  };
  return machineDecoderEvidenceSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-decoder-evidence",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
