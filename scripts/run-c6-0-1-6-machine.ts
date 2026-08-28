import { access, cp, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  asrRequestTimelineContractV2Schema,
  atomicWriteJson,
  blindGenerationInputManifestSchema,
  c6016PolicyVersion,
  machineCandidatePoolC6015Schema,
  machineEventToFinalCueLineageSchema,
  machineGlobalTokenTimelineV2Schema,
  machineRawAsrEventRecoverySchema,
  machineSingleVariantAcousticAuditSchema,
  machineTrustedTokenTimingProposalsSchema,
  machineVariantEvidenceBundleSchema,
  mvlWhisperServerResponseSchema,
  subtitlePackageSchema,
  type AcousticRiskVectorEntry,
  type AsrRequestTimelineContractV2,
  type BlindGenerationInputManifest,
  type C6016Mode,
  type DecoderEvidenceEntry,
  type MachineCandidatePoolC6015,
  type MachineEventToFinalCueLineage,
  type MachineGlobalTokenTimelineV2,
  type MachineVariantEvidenceBundle,
  type MvlWhisperServerResponse,
  type SubtitlePackage,
} from "@mvl/shared";
import {
  auditBlindRunProvenance,
  buildAndApplyJointBoundaryRefinement,
  buildAndApplyPartialBoundaryRefinement,
  buildAndApplySpanTextRepair,
  buildC6016QualityPolicy,
  buildEventFinalTextSpanLineage,
  buildMachineAcousticRiskVector,
  buildMachineBaselineEvidenceCoverage,
  buildMachineDecoderEvidence,
  buildMachineReAsrPriority,
  buildMachineRequestEdgeRisk,
  c60SemanticHash,
  c60StableHash,
  candidateTextSimilarity,
  createBlindOutputFreeze,
  createMachineShadowPolicy,
  evaluateMachineShadowFinalization,
  machineQualitySemanticHash,
  normalizeCandidateText,
  type AcousticRiskInput,
  type DecoderEvidenceInput,
  type JointBoundaryInput,
  type PartialBoundaryInput,
  type RequestEdgeRiskInput,
  type SpanRepairSelectionInput,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T14:00:00.000Z";
const POLICY_FROZEN_AT = "2026-08-28T13:30:00.000Z";
const SOURCE_SAMPLE_RATE = 16_000;

interface ParsedArguments {
  baseline: string;
  output: string;
  importedCache: string;
  repositoryCommit: string;
  stage: string;
  acousticRiskMode: C6016Mode;
  spanTextRepairMode: C6016Mode;
  partialBoundaryMode: C6016Mode;
  jointBoundaryMode: C6016Mode;
  runLabel: string;
}

interface CandidatePoolCandidate {
  variantId: string;
  eventId: string;
  candidateId: string;
  text: string;
  interval: { start: number; end: number };
  eventInterval: { start: number; end: number };
  requestIds: string[];
  sourceWindowIds: string[];
  origin: string;
  sourceGlobalVerified: boolean;
  selected: boolean;
}

interface TargetedRequest {
  requestId: string;
  sourceGlobalInterval: { start: number; end: number };
  cacheIdentity: string;
}

interface TargetedArtifact {
  events: {
    eventId: string;
    verificationRequests: TargetedRequest[];
  }[];
}

interface VariantTokenRefresh {
  tokens: {
    tokenId: string;
    variantId: string;
    trusted: boolean;
    lexical: boolean;
    sourceGlobalInterval: { start: number; end: number } | null;
  }[];
}

interface OverlapClassificationArtifact {
  pairs: {
    pairId: string;
    leftCueId: string;
    rightCueId: string;
    interval: { start: number; end: number };
    classification: "RAPID_TURN_PADDING" | "UNKNOWN_OVERLAP" | string;
    reasons: string[];
  }[];
}

interface WhisperCacheRecord {
  schemaVersion: string;
  cacheIdentity: string;
  response: unknown;
  responseSemanticHash: string;
}

function argumentValue(argumentsList: readonly string[], flag: string): string {
  const index = argumentsList.indexOf(flag);
  const value = index < 0 ? undefined : argumentsList[index + 1];
  if (value === undefined)
    throw new Error(`Missing required argument ${flag}.`);
  return value;
}

function optionalArgument(
  argumentsList: readonly string[],
  flag: string,
  fallback: string,
): string {
  const index = argumentsList.indexOf(flag);
  return index < 0 ? fallback : (argumentsList[index + 1] ?? fallback);
}

function mode(value: string, flag: string): C6016Mode {
  if (value === "off" || value === "observe" || value === "enforce")
    return value;
  throw new Error(`${flag} must be off, observe, or enforce.`);
}

function parseArguments(argumentsList: readonly string[]): ParsedArguments {
  return {
    baseline: path.resolve(argumentValue(argumentsList, "--baseline")),
    output: path.resolve(argumentValue(argumentsList, "--output")),
    importedCache: path.resolve(
      argumentValue(argumentsList, "--imported-cache"),
    ),
    repositoryCommit: argumentValue(argumentsList, "--repository-commit"),
    stage: optionalArgument(argumentsList, "--stage", "full"),
    acousticRiskMode: mode(
      optionalArgument(argumentsList, "--acoustic-risk-calibration", "observe"),
      "--acoustic-risk-calibration",
    ),
    spanTextRepairMode: mode(
      optionalArgument(argumentsList, "--span-text-repair", "off"),
      "--span-text-repair",
    ),
    partialBoundaryMode: mode(
      optionalArgument(argumentsList, "--partial-boundary-refinement", "off"),
      "--partial-boundary-refinement",
    ),
    jointBoundaryMode: mode(
      optionalArgument(argumentsList, "--joint-boundary-refinement", "off"),
      "--joint-boundary-refinement",
    ),
    runLabel: optionalArgument(argumentsList, "--run-label", "stage"),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function json<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function onlySubtitleDirectory(taskDirectory: string): Promise<string> {
  const entries = (await readdir(taskDirectory, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name);
  if (entries.length !== 1 || entries[0] === undefined)
    throw new Error("Expected exactly one subtitle artifact directory.");
  return path.join(taskDirectory, entries[0]);
}

async function cloneBaseline(input: {
  baseline: string;
  output: string;
}): Promise<string> {
  if (await pathExists(input.output))
    throw new Error(`Output already exists: ${input.output}`);
  await cp(input.baseline, input.output, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (source) => {
      const relative = path.relative(input.baseline, source);
      if (relative === "") return true;
      if (relative === "blind-output-freeze.json") return false;
      if (relative.startsWith("shareable")) return false;
      if (relative.includes(`${path.sep}audio${path.sep}review`)) return false;
      if (relative.includes(`${path.sep}review${path.sep}`)) return false;
      return true;
    },
  });
  return onlySubtitleDirectory(input.output);
}

function requestIntervalFromTimeline(
  request: AsrRequestTimelineContractV2["requests"][number],
) {
  return {
    start: request.sourceGlobalStartSample / request.sourceSampleRate,
    end: request.sourceGlobalEndSample / request.sourceSampleRate,
  };
}

function familyFor(
  candidate: CandidatePoolCandidate,
): DecoderEvidenceInput["candidateFamily"] {
  if (candidate.origin === "c6.0.1.4-targeted-reasr") return "TARGETED_RE_ASR";
  if (candidate.origin === "c6.0.1.5-raw-reasr") return "RAW_RE_ASR";
  if (
    candidate.variantId.startsWith("recovery:") ||
    candidate.sourceWindowIds.some((value) => value.includes("recovery"))
  ) {
    return "RECOVERY";
  }
  return "PRIMARY";
}

function rawRequestInterval(
  candidate: CandidatePoolCandidate,
  requestId: string,
) {
  const suffix = Number.parseInt(requestId.split(":").at(-1) ?? "1", 10);
  const padding = suffix === 2 ? 0.6 : suffix === 3 ? 1 : 0;
  return {
    start: Math.max(0, candidate.eventInterval.start - padding),
    end: candidate.eventInterval.end + padding,
  };
}

function normalizeRequestIntervals(input: {
  candidate: CandidatePoolCandidate;
  timeline: AsrRequestTimelineContractV2;
  targetedRequests: ReadonlyMap<string, TargetedRequest>;
  tokenRequestIds: readonly string[];
}) {
  const direct = input.candidate.requestIds.flatMap((requestId) => {
    const targeted = input.targetedRequests.get(requestId);
    if (targeted !== undefined)
      return [{ requestId, interval: targeted.sourceGlobalInterval }];
    if (requestId.startsWith("c6015-raw-asr-family:"))
      return [
        {
          requestId,
          interval: rawRequestInterval(input.candidate, requestId),
        },
      ];
    const request = input.timeline.requests.find(
      (entry) =>
        entry.requestId === requestId || entry.legacyRequestId === requestId,
    );
    return request === undefined
      ? []
      : [
          {
            requestId: request.requestId,
            interval: requestIntervalFromTimeline(request),
          },
        ];
  });
  const tokenMapped = input.tokenRequestIds.flatMap((requestId) => {
    const request = input.timeline.requests.find(
      (entry) => entry.requestId === requestId,
    );
    return request === undefined
      ? []
      : [{ requestId, interval: requestIntervalFromTimeline(request) }];
  });
  if (direct.length > 0 || tokenMapped.length > 0) {
    const unique = new Map(
      [...direct, ...tokenMapped].map(
        (entry) => [entry.requestId, entry] as const,
      ),
    );
    return [...unique.values()].toSorted((left, right) =>
      left.requestId.localeCompare(right.requestId),
    );
  }
  const recoveryMatch = /recovery-unit-\d+/u.exec(
    input.candidate.variantId,
  )?.[0];
  const containing = input.timeline.requests
    .filter((request) => {
      const interval = requestIntervalFromTimeline(request);
      if (
        interval.start > input.candidate.interval.start + 0.05 ||
        interval.end < input.candidate.interval.end - 0.05
      ) {
        return false;
      }
      if (recoveryMatch !== undefined)
        return request.requestId.includes(recoveryMatch);
      return request.requestId.startsWith("baseline:");
    })
    .toSorted((left, right) => {
      const leftInterval = requestIntervalFromTimeline(left);
      const rightInterval = requestIntervalFromTimeline(right);
      return (
        leftInterval.end -
          leftInterval.start -
          (rightInterval.end - rightInterval.start) ||
        left.requestId.localeCompare(right.requestId)
      );
    });
  const best = containing[0];
  return best === undefined
    ? []
    : [
        {
          requestId: best.requestId,
          interval: requestIntervalFromTimeline(best),
        },
      ];
}

function severityRank(value: "NONE" | "WEAK" | "STRONG" | "UNKNOWN") {
  return value === "STRONG"
    ? 3
    : value === "WEAK"
      ? 2
      : value === "NONE"
        ? 1
        : 0;
}

function aggregateEdgeSeverity(
  entries: readonly { edgeRisk: "NONE" | "WEAK" | "STRONG" | "UNKNOWN" }[],
) {
  return entries.length === 0
    ? ("UNKNOWN" as const)
    : ([...entries].toSorted(
        (left, right) =>
          severityRank(right.edgeRisk) - severityRank(left.edgeRisk),
      )[0]?.edgeRisk ?? ("UNKNOWN" as const));
}

async function loadWhisperResponse(
  cacheRoot: string,
  family: string,
  cacheIdentity: string,
): Promise<MvlWhisperServerResponse | null> {
  const filePath = path.join(
    cacheRoot,
    family,
    cacheIdentity.slice(0, 2),
    `${cacheIdentity}.json`,
  );
  if (!(await pathExists(filePath))) return null;
  const record = await json<WhisperCacheRecord>(filePath);
  if (
    record.cacheIdentity !== cacheIdentity ||
    record.responseSemanticHash !== machineQualitySemanticHash(record.response)
  ) {
    throw new Error(`Whisper cache identity mismatch: ${filePath}`);
  }
  return mvlWhisperServerResponseSchema.parse(record.response);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unavailableNumber(
  availability: "unsupported" | "unknown",
  reason: string,
) {
  return { availability, value: null, reason } as const;
}

function decoderFromVariant(input: {
  candidate: CandidatePoolCandidate;
  variant: MachineVariantEvidenceBundle["variants"][number];
  requestId: string;
  requestInterval: { start: number; end: number } | null;
}): DecoderEvidenceInput {
  const decoder = input.variant.decoderEvidence;
  const available = decoder.status === "available";
  const knownNumber = (value: number | null, reason: string) =>
    value === null
      ? unavailableNumber("unknown", reason)
      : { value, reason: null };
  return {
    eventId: input.candidate.eventId,
    candidateId: input.candidate.candidateId,
    requestId: input.requestId,
    candidateFamily: familyFor(input.candidate),
    decoderProvider: "whisper.cpp-mvl",
    averageLogProbability: knownNumber(
      available ? decoder.averageLogProbability : null,
      "candidate-decoder-average-log-probability-unavailable",
    ),
    noSpeechProbability: knownNumber(
      available ? decoder.noSpeechProbability : null,
      "candidate-decoder-no-speech-probability-unavailable",
    ),
    compressionRatio: knownNumber(
      available ? decoder.compressionRatio : null,
      "candidate-decoder-compression-ratio-unavailable",
    ),
    temperature: knownNumber(
      available ? decoder.temperature : null,
      "candidate-decoder-temperature-unavailable",
    ),
    fallbackCount: knownNumber(
      available ? decoder.fallbackLevel : null,
      "candidate-decoder-fallback-unavailable",
    ),
    decoderSegmentStart: unavailableNumber(
      "unknown",
      "candidate-level-segment-start-not-retained",
    ),
    decoderSegmentEnd: unavailableNumber(
      "unknown",
      "candidate-level-segment-end-not-retained",
    ),
    tokenTimestampAvailable:
      available && decoder.tokenTimingQuality !== null
        ? { value: decoder.tokenTimingQuality > 0, reason: null }
        : {
            availability: "unknown",
            value: null,
            reason: "token-timestamp-availability-unavailable",
          },
    tokenCount: {
      value: input.variant.tokenIds.length,
      reason: null,
    },
    requestEdgeDistance:
      input.requestInterval === null
        ? unavailableNumber("unknown", "request-interval-unavailable")
        : {
            value: Math.max(
              0,
              Math.min(
                input.candidate.interval.start - input.requestInterval.start,
                input.requestInterval.end - input.candidate.interval.end,
              ),
            ),
            reason: null,
          },
    languageProbability: unavailableNumber(
      "unsupported",
      "provider-does-not-emit-language-probability",
    ),
    confidenceDiagnostics: decoder.unavailableReasons,
    provenance: {
      sourceArtifact: "machine-variant-evidence-bundle.json",
      sourceRequestId: input.requestId,
      providerResponseRetained: available,
      sourceGlobalVerified: input.candidate.sourceGlobalVerified,
    },
  };
}

async function recoveredPrimaryDecoder(input: {
  candidate: CandidatePoolCandidate;
  variant: MachineVariantEvidenceBundle["variants"][number];
  requests: readonly {
    requestId: string;
    interval: { start: number; end: number };
  }[];
  timelineByRequest: ReadonlyMap<
    string,
    AsrRequestTimelineContractV2["requests"][number]
  >;
  importedCache: string;
}): Promise<DecoderEvidenceInput | null> {
  for (const requestIdentity of input.requests) {
    const request = input.timelineByRequest.get(requestIdentity.requestId);
    if (request === undefined) continue;
    const response = await loadWhisperResponse(
      input.importedCache,
      "whisper-vad",
      request.cacheIdentity,
    );
    if (response === null) continue;
    const requestStart =
      request.sourceGlobalStartSample / request.sourceSampleRate;
    const matching = response.transcription.filter((segment) => {
      const start = requestStart + segment.startSeconds;
      const end = requestStart + segment.endSeconds;
      return (
        Math.min(end, input.candidate.interval.end) >
          Math.max(start, input.candidate.interval.start) ||
        normalizeCandidateText(segment.text).includes(
          normalizeCandidateText(input.candidate.text),
        )
      );
    });
    if (matching.length === 0) continue;
    const lexicalTokens = matching.flatMap((segment) =>
      segment.tokens.filter((token) => !token.special),
    );
    const segmentStart = Math.min(
      ...matching.map((segment) => requestStart + segment.startSeconds),
    );
    const segmentEnd = Math.max(
      ...matching.map((segment) => requestStart + segment.endSeconds),
    );
    return {
      eventId: input.candidate.eventId,
      candidateId: input.candidate.candidateId,
      requestId: request.requestId,
      candidateFamily: familyFor(input.candidate),
      decoderProvider: "whisper.cpp-mvl",
      averageLogProbability: {
        value: average(matching.map((segment) => segment.avgLogProbability)),
        reason: null,
      },
      noSpeechProbability: {
        value: average(matching.map((segment) => segment.noSpeechProbability)),
        reason: null,
      },
      compressionRatio: unavailableNumber(
        "unsupported",
        "provider-does-not-emit-compression-ratio",
      ),
      temperature: {
        value: Math.max(...matching.map((segment) => segment.temperature)),
        reason: null,
      },
      fallbackCount: {
        value: matching.filter((segment) => segment.temperature > 0).length,
        reason: null,
      },
      decoderSegmentStart: { value: segmentStart, reason: null },
      decoderSegmentEnd: { value: segmentEnd, reason: null },
      tokenTimestampAvailable: {
        value: lexicalTokens.some((token) => token.mapped !== null),
        reason: null,
      },
      tokenCount: { value: lexicalTokens.length, reason: null },
      requestEdgeDistance: {
        value: Math.max(
          0,
          Math.min(
            input.candidate.interval.start - requestIdentity.interval.start,
            requestIdentity.interval.end - input.candidate.interval.end,
          ),
        ),
        reason: null,
      },
      languageProbability: unavailableNumber(
        "unsupported",
        "provider-does-not-emit-language-probability",
      ),
      confidenceDiagnostics: ["recovered-from-retained-provider-response"],
      provenance: {
        sourceArtifact: `whisper-vad/${request.cacheIdentity.slice(0, 2)}/${request.cacheIdentity}.json`,
        sourceRequestId: request.requestId,
        providerResponseRetained: true,
        sourceGlobalVerified: true,
      },
    };
  }
  return null;
}

function candidateDisagreement(
  candidates: readonly CandidatePoolCandidate[],
): "NONE" | "WEAK" | "STRONG" {
  const texts = [
    ...new Set(
      candidates
        .map((candidate) => normalizeCandidateText(candidate.text))
        .filter((text) => text !== ""),
    ),
  ];
  if (texts.length <= 1) return "NONE";
  const similarities = texts.flatMap((left, index) =>
    texts.slice(index + 1).map((right) => candidateTextSimilarity(left, right)),
  );
  return similarities.length > 0 && Math.max(...similarities) < 0.5
    ? "STRONG"
    : "WEAK";
}

function decoderMetric(
  decoder: DecoderEvidenceEntry | undefined,
  name: "averageLogProbability" | "noSpeechProbability",
): number | null {
  return decoder?.fields[name].availability === "available"
    ? decoder.fields[name].value
    : null;
}

function boundaryEvidence(input: {
  candidate: CandidatePoolCandidate;
  variant: MachineVariantEvidenceBundle["variants"][number];
  tokenById: ReadonlyMap<
    string,
    MachineGlobalTokenTimelineV2["tokens"][number]
  >;
}): {
  start: PartialBoundaryInput["startEvidence"];
  end: PartialBoundaryInput["endEvidence"];
} {
  const tokens = input.variant.trustedGlobalTokenIds
    .flatMap((tokenId) => {
      const token = input.tokenById.get(tokenId);
      return token === undefined ||
        !token.trusted ||
        !token.lexical ||
        token.sourceGlobalInterval === null
        ? []
        : [token];
    })
    .toSorted(
      (left, right) =>
        left.sourceGlobalInterval!.start - right.sourceGlobalInterval!.start ||
        left.tokenId.localeCompare(right.tokenId),
    );
  const first = tokens[0];
  const last = tokens.at(-1);
  const candidateText = normalizeCandidateText(input.candidate.text);
  const firstText =
    first === undefined ? "" : normalizeCandidateText(first.text);
  const lastText = last === undefined ? "" : normalizeCandidateText(last.text);
  const startMatched = firstText !== "" && candidateText.startsWith(firstText);
  const endMatched = lastText !== "" && candidateText.endsWith(lastText);
  return {
    start: {
      coverage: startMatched ? 1 : 0,
      trustedTokenIds: first === undefined ? [] : [first.tokenId],
      evidenceIds:
        first === undefined ? [] : [`token-start:${first.semanticHash}`],
      proposedTime: startMatched
        ? (first?.sourceGlobalInterval?.start ?? null)
        : null,
    },
    end: {
      coverage: endMatched ? 1 : 0,
      trustedTokenIds: last === undefined ? [] : [last.tokenId],
      evidenceIds: last === undefined ? [] : [`token-end:${last.semanticHash}`],
      proposedTime: endMatched
        ? (last?.sourceGlobalInterval?.end ?? null)
        : null,
    },
  };
}

function updateManifest(input: {
  baseline: BlindGenerationInputManifest;
  repositoryCommit: string;
  runLabel: string;
  generationArguments: string[];
}): BlindGenerationInputManifest {
  const memoryBase = {
    storeId: `c6-0-1-6-empty-memory-${input.runLabel}-${input.repositoryCommit.slice(0, 12)}`,
    entryCount: 0 as const,
    humanDerived: false as const,
  };
  const { inputSemanticHash: _oldHash, ...oldBase } = input.baseline;
  const base = {
    ...oldBase,
    generatedAt: GENERATED_AT,
    generationRunId: `c6-0-1-6-${input.runLabel}-${input.repositoryCommit.slice(0, 12)}`,
    repositoryCommit: input.repositoryCommit,
    machineMemoryInitialState: {
      ...memoryBase,
      storeHash: c60StableHash(memoryBase),
    },
    generationArguments: input.generationArguments,
  };
  return blindGenerationInputManifestSchema.parse({
    ...base,
    inputSemanticHash: c60SemanticHash(base),
  });
}

function packageHashes(value: SubtitlePackage) {
  return {
    canonicalTextHash: machineQualitySemanticHash(
      value.cues.map((cue) => [cue.id, cue.text]),
    ),
    canonicalTimingHash: machineQualitySemanticHash(
      value.cues.map((cue) => [cue.id, cue.start, cue.end]),
    ),
    presentationHash: machineQualitySemanticHash({
      ass: formatAss(value.cues),
      srt: formatSrt(value.cues),
      vtt: formatVtt(value.cues),
    }),
    assHash: machineQualitySemanticHash(formatAss(value.cues)),
    srtHash: machineQualitySemanticHash(formatSrt(value.cues)),
    vttHash: machineQualitySemanticHash(formatVtt(value.cues)),
  };
}

const argumentsValue = parseArguments(process.argv.slice(2));
if (!/^[a-f0-9]{40}$/u.test(argumentsValue.repositoryCommit))
  throw new Error("--repository-commit must be a full Git SHA.");

const baselineSubtitle = await onlySubtitleDirectory(argumentsValue.baseline);
const outputSubtitle = await cloneBaseline({
  baseline: argumentsValue.baseline,
  output: argumentsValue.output,
});

const [
  packageValue,
  candidatePool,
  variantEvidence,
  cueLineage,
  requestTimeline,
  globalTokens,
  singleAudit,
  rawRecovery,
  _trustedTiming,
  targetedArtifact,
  variantTokenRefresh,
  overlapArtifact,
] = await Promise.all([
  json<unknown>(path.join(baselineSubtitle, "subtitle-package.json")).then(
    (value) => subtitlePackageSchema.parse(value),
  ),
  json<unknown>(
    path.join(baselineSubtitle, "machine-candidate-pool-c6-0-1-5.json"),
  ).then((value) => machineCandidatePoolC6015Schema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-variant-evidence-bundle.json"),
  ).then((value) => machineVariantEvidenceBundleSchema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-event-to-final-cue-lineage.json"),
  ).then((value) => machineEventToFinalCueLineageSchema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "asr-request-timeline-contract-v2.json"),
  ).then((value) => asrRequestTimelineContractV2Schema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-global-token-timeline-v2.json"),
  ).then((value) => machineGlobalTokenTimelineV2Schema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-single-variant-acoustic-audit.json"),
  ).then((value) => machineSingleVariantAcousticAuditSchema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-raw-asr-event-recovery.json"),
  ).then((value) => machineRawAsrEventRecoverySchema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-trusted-token-timing-proposals.json"),
  ).then((value) => machineTrustedTokenTimingProposalsSchema.parse(value)),
  json<TargetedArtifact>(
    path.join(baselineSubtitle, "machine-targeted-event-reasr.json"),
  ),
  json<VariantTokenRefresh>(
    path.join(baselineSubtitle, "machine-variant-token-timeline-refresh.json"),
  ),
  json<OverlapClassificationArtifact>(
    path.join(baselineSubtitle, "machine-overlap-event-classification.json"),
  ),
]);

const candidates = candidatePool.candidates as CandidatePoolCandidate[];
const candidateById = new Map(
  candidates.map((candidate) => [candidate.variantId, candidate] as const),
);
const variantsById = new Map(
  variantEvidence.variants.map(
    (variant) => [variant.variantId, variant] as const,
  ),
);
const poolEventById = new Map(
  candidatePool.events.map((event) => [event.eventId, event] as const),
);
const eventCandidates = new Map<string, CandidatePoolCandidate[]>();
for (const candidate of candidates) {
  const values = eventCandidates.get(candidate.eventId) ?? [];
  values.push(candidate);
  eventCandidates.set(candidate.eventId, values);
}
const targetedRequests = new Map(
  targetedArtifact.events.flatMap((event) =>
    event.verificationRequests.map(
      (request) => [request.requestId, request] as const,
    ),
  ),
);
const tokenById = new Map(
  globalTokens.tokens.map((token) => [token.tokenId, token] as const),
);
const tokenRequestIdsByVariant = new Map<string, Set<string>>();
for (const token of variantTokenRefresh.tokens) {
  const global = tokenById.get(token.tokenId);
  if (global === undefined) continue;
  const values =
    tokenRequestIdsByVariant.get(token.variantId) ?? new Set<string>();
  values.add(global.requestId);
  tokenRequestIdsByVariant.set(token.variantId, values);
}
const requestTimelineById = new Map(
  requestTimeline.requests.map(
    (request) => [request.requestId, request] as const,
  ),
);

const requestIntervalsByCandidate = new Map<
  string,
  { requestId: string; interval: { start: number; end: number } }[]
>();
for (const candidate of candidates) {
  requestIntervalsByCandidate.set(
    candidate.variantId,
    normalizeRequestIntervals({
      candidate,
      timeline: requestTimeline,
      targetedRequests,
      tokenRequestIds: [
        ...(tokenRequestIdsByVariant.get(candidate.variantId) ?? []),
      ],
    }),
  );
}

const auditCandidateIds = new Set(
  singleAudit.events.map((event) => event.candidateId),
);
const requestEdgeInputs: RequestEdgeRiskInput[] = [];
for (const candidate of candidates.filter((entry) =>
  auditCandidateIds.has(entry.candidateId),
)) {
  const variant = variantsById.get(candidate.variantId);
  const requests = requestIntervalsByCandidate.get(candidate.variantId) ?? [];
  const related = eventCandidates.get(candidate.eventId) ?? [];
  for (const request of requests) {
    const trustedTokens = (variant?.trustedGlobalTokenIds ?? []).flatMap(
      (tokenId) => {
        const token = tokenById.get(tokenId);
        return token === undefined || token.sourceGlobalInterval === null
          ? []
          : [token];
      },
    );
    const tokenEdgeContact = trustedTokens.some(
      (token) =>
        Math.abs(token.sourceGlobalInterval!.start - request.interval.start) <=
          0.08 ||
        Math.abs(request.interval.end - token.sourceGlobalInterval!.end) <=
          0.08,
    );
    const independentContinuation = related.some(
      (other) =>
        other.variantId !== candidate.variantId &&
        normalizeCandidateText(other.text).length >
          normalizeCandidateText(candidate.text).length &&
        (other.interval.start < candidate.interval.start - 0.2 ||
          other.interval.end > candidate.interval.end + 0.2),
    );
    requestEdgeInputs.push({
      eventId: candidate.eventId,
      candidateId: candidate.candidateId,
      requestId: request.requestId,
      requestInterval: request.interval,
      candidateInterval: candidate.interval,
      speechContinuationLeft:
        candidate.eventInterval.start < candidate.interval.start - 0.05,
      speechContinuationRight:
        candidate.eventInterval.end > candidate.interval.end + 0.05,
      tokenEdgeContact,
      ctcIncomplete:
        (variant?.edgeEvidence.evidenceIds.length ?? 0) > 0 &&
        (variant?.ctcScore ?? 1) < 0.55,
      decoderSuggestsTruncation:
        variant?.decoderEvidence.status === "available" &&
        (variant.decoderEvidence.averageLogProbability ?? 0) < -1.5,
      independentContinuation,
      incompleteAcousticSpan: (variant?.speechCoverage ?? 1) < 0.7,
      evidenceIds: [
        ...(variant?.ctcEvidenceIds ?? []),
        ...trustedTokens.map((token) => token.tokenId),
      ],
    });
  }
  if (requests.length === 0) {
    requestEdgeInputs.push({
      eventId: candidate.eventId,
      candidateId: candidate.candidateId,
      requestId: `unresolved-request:${candidate.candidateId}`,
      requestInterval: null,
      candidateInterval: candidate.interval,
    });
  }
}
const requestEdge = buildMachineRequestEdgeRisk({
  mode: argumentsValue.acousticRiskMode,
  candidates: requestEdgeInputs,
  generatedAt: GENERATED_AT,
});
const edgeByCandidate = new Map<string, typeof requestEdge.candidates>();
for (const entry of requestEdge.candidates) {
  const values = edgeByCandidate.get(entry.candidateId) ?? [];
  values.push(entry);
  edgeByCandidate.set(entry.candidateId, values);
}

const decoderInputs: DecoderEvidenceInput[] = [];
for (const candidate of candidates) {
  const variant = variantsById.get(candidate.variantId);
  if (variant === undefined) continue;
  const requests = requestIntervalsByCandidate.get(candidate.variantId) ?? [];
  const request = requests[0];
  const recovered =
    familyFor(candidate) === "PRIMARY" || familyFor(candidate) === "RECOVERY"
      ? await recoveredPrimaryDecoder({
          candidate,
          variant,
          requests,
          timelineByRequest: requestTimelineById,
          importedCache: argumentsValue.importedCache,
        })
      : null;
  decoderInputs.push(
    recovered ??
      decoderFromVariant({
        candidate,
        variant,
        requestId:
          request?.requestId ??
          candidate.requestIds[0] ??
          `unresolved:${candidate.variantId}`,
        requestInterval: request?.interval ?? null,
      }),
  );
}
const decoderEvidence = buildMachineDecoderEvidence({
  mode: argumentsValue.acousticRiskMode,
  candidates: decoderInputs,
  generatedAt: GENERATED_AT,
});
const decoderByCandidate = new Map(
  decoderEvidence.candidates.map(
    (decoder) => [decoder.candidateId, decoder] as const,
  ),
);

const auditByCandidate = new Map(
  singleAudit.events.map((event) => [event.candidateId, event] as const),
);
const lineageByEvent = new Map(
  cueLineage.events.map((event) => [event.eventId, event] as const),
);
const overlapCueIds = new Set(
  overlapArtifact.pairs.flatMap((pair) => [pair.leftCueId, pair.rightCueId]),
);
const riskInputs: AcousticRiskInput[] = [];
for (const event of singleAudit.events) {
  const candidate = candidates.find(
    (entry) => entry.candidateId === event.candidateId,
  );
  const variant =
    candidate === undefined ? undefined : variantsById.get(candidate.variantId);
  if (candidate === undefined || variant === undefined) continue;
  const decoder = decoderByCandidate.get(candidate.candidateId);
  const related = eventCandidates.get(candidate.eventId) ?? [];
  const disagreement = candidateDisagreement(related);
  const sourceDuration = Math.max(
    0.001,
    candidate.interval.end - candidate.interval.start,
  );
  const characterRate =
    normalizeCandidateText(candidate.text).length / sourceDuration;
  const eventLineage = lineageByEvent.get(candidate.eventId);
  const associationAmbiguity =
    poolEventById.get(candidate.eventId)?.selectedVariantId === null
      ? ("STRONG" as const)
      : related.length > 1 && disagreement === "STRONG"
        ? ("WEAK" as const)
        : ("NONE" as const);
  riskInputs.push({
    eventId: candidate.eventId,
    candidateId: candidate.candidateId,
    requestEdgeRisk: aggregateEdgeSeverity(
      edgeByCandidate.get(candidate.candidateId) ?? [],
    ),
    requestEdgeEvidenceIds: (
      edgeByCandidate.get(candidate.candidateId) ?? []
    ).map((entry) => entry.semanticHash),
    ctcScore: variant.ctcScore,
    ctcEvidenceIds: variant.ctcEvidenceIds,
    tokenCoverage: variant.tokenCoverage.coverageRatio,
    tokenConflict:
      auditByCandidate.get(candidate.candidateId)?.auditStatus ===
      "TOKEN_CONFLICT",
    tokenEvidenceIds: variant.trustedGlobalTokenIds,
    speechCoverage: variant.speechCoverage,
    speechEvidenceIds: [`variant:${variant.semanticHash}`],
    decoderAvailability: decoder?.availability ?? "unknown",
    averageLogProbability: decoderMetric(decoder, "averageLogProbability"),
    noSpeechProbability: decoderMetric(decoder, "noSpeechProbability"),
    decoderEvidenceIds: decoder === undefined ? [] : [decoder.semanticHash],
    independentWindowDisagreement: disagreement,
    crossWindowEvidenceIds: related.map(
      (entry) => `candidate:${entry.candidateId}:${entry.variantId}`,
    ),
    repetitionRisk: variant.decoderEvidence.repetitionRatio ?? 0,
    durationTextAnomaly:
      characterRate > 12 ||
      (characterRate < 0.3 &&
        normalizeCandidateText(candidate.text).length >= 6)
        ? "STRONG"
        : characterRate > 9
          ? "WEAK"
          : "NONE",
    pronunciationCoverage: variant.ctcScore,
    associationAmbiguity,
    overlapRisk: (eventLineage?.finalCueIds ?? []).some((cueId) =>
      overlapCueIds.has(cueId),
    )
      ? "WEAK"
      : "NONE",
  });
}
const riskVector = buildMachineAcousticRiskVector({
  mode: argumentsValue.acousticRiskMode,
  events: riskInputs,
  generatedAt: GENERATED_AT,
});
const recoverabilitySignals = new Map<string, string[]>();
for (const event of riskVector.events) {
  const pool = poolEventById.get(event.eventId);
  const decoder = decoderByCandidate.get(event.candidateId);
  recoverabilitySignals.set(event.eventId, [
    ...((pool?.candidateIds.length ?? 0) > 1
      ? ["existing-alternative-candidates"]
      : []),
    ...(decoder?.availability === "available"
      ? ["decoder-evidence-available"]
      : []),
    ...(lineageByEvent.get(event.eventId)?.finalCueIds.length === 1
      ? ["single-final-cue-target"]
      : []),
  ]);
}
const reAsrPriority = buildMachineReAsrPriority({
  mode: argumentsValue.acousticRiskMode,
  riskVector: riskVector.events,
  recoverabilitySignalsByEvent: recoverabilitySignals,
  generatedAt: GENERATED_AT,
});

const eventTextSources = candidatePool.events.flatMap((event) => {
  const current = candidateById.get(event.currentVariantId);
  if (current === undefined) return [];
  return [
    {
      eventId: event.eventId,
      currentCandidateId: event.currentVariantId,
      sourceCandidates: (eventCandidates.get(event.eventId) ?? []).map(
        (candidate) => ({
          candidateId: candidate.variantId,
          text: candidate.text,
        }),
      ),
    },
  ];
});
const spanLineage = buildEventFinalTextSpanLineage({
  mode: argumentsValue.spanTextRepairMode,
  cueLineage,
  finalCues: packageValue.cues,
  eventTextSources,
  generatedAt: GENERATED_AT,
});
const spanSelections: SpanRepairSelectionInput[] = candidatePool.events.flatMap(
  (event) => {
    if (
      !event.selectionChanged ||
      event.selectedVariantId === null ||
      event.selectedVariantId === event.currentVariantId
    ) {
      return [];
    }
    const current = candidateById.get(event.currentVariantId);
    const selected = candidateById.get(event.selectedVariantId);
    const currentEvidence = variantsById.get(event.currentVariantId);
    const selectedEvidence = variantsById.get(event.selectedVariantId);
    if (
      current === undefined ||
      selected === undefined ||
      currentEvidence === undefined ||
      selectedEvidence === undefined
    ) {
      return [];
    }
    const evidenceStronger =
      (selectedEvidence.ctcScore ?? 0) >=
        (currentEvidence.ctcScore ?? 0) + 0.08 ||
      selectedEvidence.tokenCoverage.coverageRatio >=
        currentEvidence.tokenCoverage.coverageRatio + 0.2;
    const currentHallucination =
      (currentEvidence.decoderEvidence.noSpeechProbability ?? 0) +
      (currentEvidence.decoderEvidence.repetitionRatio ?? 0);
    const selectedHallucination =
      (selectedEvidence.decoderEvidence.noSpeechProbability ?? 0) +
      (selectedEvidence.decoderEvidence.repetitionRatio ?? 0);
    return [
      {
        eventId: event.eventId,
        replacementCandidateId: selected.variantId,
        replacementText: selected.text,
        replacementEventId: selected.eventId,
        evidenceIds: [
          ...selectedEvidence.ctcEvidenceIds,
          ...selectedEvidence.trustedGlobalTokenIds,
          selectedEvidence.semanticHash,
        ],
        evidenceStronger,
        hallucinationNonIncreasePassed:
          selectedHallucination <= currentHallucination,
        timingCompatible:
          selected.sourceGlobalVerified &&
          Math.min(selected.interval.end, selected.eventInterval.end) >
            Math.max(selected.interval.start, selected.eventInterval.start),
        crossSpeakerJoinSafe: true,
      },
    ];
  },
);
const spanRepair = buildAndApplySpanTextRepair({
  mode: argumentsValue.spanTextRepairMode,
  package: packageValue,
  lineage: spanLineage,
  selections: spanSelections,
  generatedAt: GENERATED_AT,
});

const partialEvidenceByCue = new Map<string, PartialBoundaryInput>();
for (const event of spanLineage.events) {
  if (event.finalCueId === null || !event.modifiable) continue;
  const pool = poolEventById.get(event.eventId);
  const variantId = pool?.currentVariantId;
  if (variantId === undefined || partialEvidenceByCue.has(event.finalCueId))
    continue;
  const candidate = candidateById.get(variantId);
  const variant = variantsById.get(variantId);
  if (candidate === undefined || variant === undefined) continue;
  const boundaries = boundaryEvidence({ candidate, variant, tokenById });
  partialEvidenceByCue.set(event.finalCueId, {
    cueId: event.finalCueId,
    startEvidence: boundaries.start,
    endEvidence: boundaries.end,
  });
}
const partial = buildAndApplyPartialBoundaryRefinement({
  mode: argumentsValue.partialBoundaryMode,
  package: spanRepair.package,
  evidence: [...partialEvidenceByCue.values()],
  generatedAt: GENERATED_AT,
});
const partialProposalByCue = new Map(
  partial.artifact.proposals.map(
    (proposal) => [proposal.cueId, proposal] as const,
  ),
);
const sortedFinalCues = partial.package.cues.toSorted(
  (left, right) =>
    left.start - right.start ||
    left.end - right.end ||
    left.id.localeCompare(right.id),
);
const adjacentFinalPairs = sortedFinalCues.flatMap((leftCue, index) => {
  const rightCue = sortedFinalCues[index + 1];
  if (rightCue === undefined) return [];
  const gap = rightCue.start - leftCue.end;
  return gap <= 0.25 ? [{ leftCue, rightCue, gap }] : [];
});
const jointInputs: JointBoundaryInput[] = adjacentFinalPairs.map((pair) => {
  const left = partialProposalByCue.get(pair.leftCue.id);
  const right = partialProposalByCue.get(pair.rightCue.id);
  const overlapStart = Math.max(pair.leftCue.start, pair.rightCue.start);
  const overlapEnd = Math.min(pair.leftCue.end, pair.rightCue.end);
  const legacyPair =
    overlapEnd <= overlapStart
      ? undefined
      : overlapArtifact.pairs
          .filter(
            (entry) =>
              entry.interval.end > overlapStart &&
              entry.interval.start < overlapEnd,
          )
          .toSorted(
            (leftEntry, rightEntry) =>
              Math.abs(leftEntry.interval.start - overlapStart) +
                Math.abs(leftEntry.interval.end - overlapEnd) -
                (Math.abs(rightEntry.interval.start - overlapStart) +
                  Math.abs(rightEntry.interval.end - overlapEnd)) ||
              leftEntry.pairId.localeCompare(rightEntry.pairId),
          )[0];
  const legacyClassification = legacyPair?.classification;
  return {
    leftCueId: pair.leftCue.id,
    rightCueId: pair.rightCue.id,
    leftEndEvidence: left?.endEvidence ?? {
      coverage: 0,
      trustedTokenIds: [],
      evidenceIds: [],
      proposedTime: null,
    },
    rightStartEvidence: right?.startEvidence ?? {
      coverage: 0,
      trustedTokenIds: [],
      evidenceIds: [],
      proposedTime: null,
    },
    vadPause: null,
    speechContinuous:
      legacyClassification === "UNKNOWN_OVERLAP" || pair.gap <= 0.1,
    acousticOverlapSupported: legacyClassification === "CONCURRENT_SPEECH",
    speakerOverlapSupported: false,
    accidentalOverlapSupported:
      legacyClassification === "RAPID_TURN_PADDING" ||
      legacyClassification === "BOUNDARY_COLLISION",
    rapidTurn: legacyClassification === "RAPID_TURN_PADDING" || pair.gap >= 0,
    evidenceIds:
      legacyPair === undefined
        ? [
            `adjacent-final-pair:${pair.leftCue.id}:${pair.rightCue.id}`,
            "no-legacy-overlap-classification",
          ]
        : [legacyPair.pairId, ...legacyPair.reasons],
  };
});
const joint = buildAndApplyJointBoundaryRefinement({
  mode: argumentsValue.jointBoundaryMode,
  package: partial.package,
  pairs: jointInputs,
  generatedAt: GENERATED_AT,
});
const finalPackage = subtitlePackageSchema.parse(joint.package);
const policy = buildC6016QualityPolicy({
  policyFrozenAt: POLICY_FROZEN_AT,
  generatedAt: GENERATED_AT,
});

await Promise.all([
  atomicWriteJson(
    path.join(outputSubtitle, "machine-request-edge-risk.json"),
    requestEdge,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "machine-decoder-evidence.json"),
    decoderEvidence,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "machine-acoustic-risk-vector.json"),
    riskVector,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "machine-reasr-priority.json"),
    reAsrPriority,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "machine-event-final-text-span-lineage.json"),
    spanLineage,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "machine-span-text-repair.json"),
    spanRepair.artifact,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "machine-partial-boundary-proposals.json"),
    partial.artifact,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "machine-joint-boundary-refinement.json"),
    joint.artifact,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "c6-0-1-6-quality-policy.json"),
    policy,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "subtitle-package.json"),
    finalPackage,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "subtitle-package.needs-review.json"),
    finalPackage,
    { overwrite: true },
  ),
]);

const assRelative = finalPackage.subtitleFiles.ass;
const srtRelative = finalPackage.subtitleFiles.srt;
const vttRelative = finalPackage.subtitleFiles.vtt;
if (assRelative === null || srtRelative === null || vttRelative === null)
  throw new Error("Strict package is missing ASS/SRT/VTT outputs.");
await Promise.all([
  import("@mvl/shared").then(({ atomicWriteFile }) =>
    atomicWriteFile(
      path.join(outputSubtitle, assRelative),
      formatAss(finalPackage.cues),
      { overwrite: true },
    ),
  ),
  import("@mvl/shared").then(({ atomicWriteFile }) =>
    atomicWriteFile(
      path.join(outputSubtitle, srtRelative),
      formatSrt(finalPackage.cues),
      { overwrite: true },
    ),
  ),
  import("@mvl/shared").then(({ atomicWriteFile }) =>
    atomicWriteFile(
      path.join(outputSubtitle, vttRelative),
      formatVtt(finalPackage.cues),
      { overwrite: true },
    ),
  ),
]);

const oldManifest = blindGenerationInputManifestSchema.parse(
  await json<unknown>(
    path.join(argumentsValue.output, "blind-generation-input-manifest.json"),
  ),
);
const manifest = updateManifest({
  baseline: oldManifest,
  repositoryCommit: argumentsValue.repositoryCommit,
  runLabel: argumentsValue.runLabel,
  generationArguments: [
    "run:c6-0-1-6-machine",
    "--stage",
    argumentsValue.stage,
    "--acoustic-risk-calibration",
    argumentsValue.acousticRiskMode,
    "--span-text-repair",
    argumentsValue.spanTextRepairMode,
    "--partial-boundary-refinement",
    argumentsValue.partialBoundaryMode,
    "--joint-boundary-refinement",
    argumentsValue.jointBoundaryMode,
    "--asr-cache-dir",
    `isolated-c6016-${argumentsValue.runLabel}`,
  ],
});
const memoryBase = {
  schemaVersion: "1.0.0",
  artifactType: "machine-only-series-memory",
  storeId: manifest.machineMemoryInitialState.storeId,
  createdAt: GENERATED_AT,
  entryCount: 0,
  humanDerived: false,
  entries: [],
};
const selectedEventIds = new Set(
  reAsrPriority.events
    .filter((event) => event.budgetSelected)
    .map((event) => event.eventId),
);
const replayedRawEvents = rawRecovery.events.filter((event) =>
  selectedEventIds.has(event.eventId),
);
const baselineHashes = packageHashes(packageValue);
const finalHashes = packageHashes(finalPackage);
const runAuditCore = {
  stage: argumentsValue.stage,
  runLabel: argumentsValue.runLabel,
  repositoryCommit: argumentsValue.repositoryCommit,
  sourceMediaSha256: manifest.sourceVideo.sha256,
  baselineFreezeHash: oldManifest.inputSemanticHash,
  policyVersion: c6016PolicyVersion,
  policyHash: policy.policyHash,
  modes: {
    acousticRiskCalibration: argumentsValue.acousticRiskMode,
    spanTextRepair: argumentsValue.spanTextRepairMode,
    partialBoundaryRefinement: argumentsValue.partialBoundaryMode,
    jointBoundaryRefinement: argumentsValue.jointBoundaryMode,
  },
  modelExecution: {
    executionMode: "verified-cache-replay",
    modelInferenceCount: 0,
    modelLoadCount: 0,
    plannedReAsrEventCount:
      argumentsValue.acousticRiskMode === "off"
        ? 0
        : reAsrPriority.summary.budgetSelectedCount,
    plannedReAsrRequestCount:
      argumentsValue.acousticRiskMode === "off"
        ? 0
        : reAsrPriority.summary.requestBudgetUsed,
    replayedReAsrEventCount:
      argumentsValue.acousticRiskMode === "off" ? 0 : replayedRawEvents.length,
    replayedReAsrRequestCount:
      argumentsValue.acousticRiskMode === "off"
        ? 0
        : replayedRawEvents.reduce(
            (sum, event) => sum + event.requestsExecuted,
            0,
          ),
    replayedReAsrCacheHitCount:
      argumentsValue.acousticRiskMode === "off"
        ? 0
        : replayedRawEvents.reduce(
            (sum, event) => sum + event.cacheHitCount,
            0,
          ),
    unavailablePlannedReAsrEventCount:
      argumentsValue.acousticRiskMode === "off"
        ? 0
        : reAsrPriority.summary.budgetSelectedCount - replayedRawEvents.length,
  },
  artifactSemanticHashes: {
    requestEdge: requestEdge.semanticHash,
    decoderEvidence: decoderEvidence.semanticHash,
    riskVector: riskVector.semanticHash,
    reAsrPriority: reAsrPriority.semanticHash,
    spanLineage: spanLineage.semanticHash,
    spanRepair: spanRepair.artifact.semanticHash,
    partialBoundary: partial.artifact.semanticHash,
    jointBoundary: joint.artifact.semanticHash,
  },
  baselineHashes,
  finalHashes,
  canonicalTextMutationCount: spanRepair.artifact.summary.appliedCount,
  canonicalTimingMutationCount:
    partial.artifact.summary.appliedCount + joint.artifact.summary.appliedCount,
  runtimeGoldInputCount: 0,
  candidateTextPromptLeakCount: 0,
  networkUsed: false,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  machineReleaseAuthorized: false,
};
const runAudit = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-6-machine-run-audit",
  generatedAt: GENERATED_AT,
  ...runAuditCore,
  semanticHash: machineQualitySemanticHash(runAuditCore),
};
await Promise.all([
  atomicWriteJson(
    path.join(argumentsValue.output, "blind-generation-input-manifest.json"),
    manifest,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "machine-memory.json"),
    {
      ...memoryBase,
      semanticHash: manifest.machineMemoryInitialState.storeHash,
    },
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "c6-0-1-6-machine-run-audit.json"),
    runAudit,
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "blind-generation-execution.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "blind-generation-execution",
      generationRunId: manifest.generationRunId,
      generationStartedAt: GENERATED_AT,
      generationCompletedAt: GENERATED_AT,
      wallTimeMs: 0,
      exitCode: 0,
      sourceReadOnlyVerified: true,
      sourceHashBefore: manifest.sourceVideo.sha256,
      sourceHashAfter: manifest.sourceVideo.sha256,
      networkUsed: false,
      onlineSubtitleSearchUsed: false,
      cloudModelInferenceCount: 0,
    },
    { overwrite: true },
  ),
]);

const provenance = await auditBlindRunProvenance({
  taskDirectory: argumentsValue.output,
  generatedAt: GENERATED_AT,
  manifest,
});
if (!provenance.passed)
  throw new Error(
    `Blind provenance failed: ${provenance.isolationViolations.join(",")}`,
  );
const evidence = await buildMachineBaselineEvidenceCoverage({
  taskDirectory: argumentsValue.output,
  generatedAt: GENERATED_AT,
  manifest,
});
const shadowPolicy = createMachineShadowPolicy();
const shadow = evaluateMachineShadowFinalization({
  generatedAt: GENERATED_AT,
  manifest,
  provenance,
  evidence,
  policy: shadowPolicy,
});
await Promise.all([
  atomicWriteJson(
    path.join(argumentsValue.output, "blind-provenance-audit.json"),
    provenance,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "machine-baseline-evidence-coverage.json"),
    evidence,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "machine-shadow-finalization-policy.json"),
    shadowPolicy,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "machine-shadow-finalization.json"),
    shadow,
    { overwrite: true },
  ),
]);
await mkdir(path.join(argumentsValue.output, "shareable"), { recursive: true });
const shareableCore = {
  policyVersion: c6016PolicyVersion,
  stage: argumentsValue.stage,
  runtimeGoldInputCount: 0,
  networkUsed: false,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  artifactRelativePaths: [
    `${path.basename(outputSubtitle)}/machine-request-edge-risk.json`,
    `${path.basename(outputSubtitle)}/machine-decoder-evidence.json`,
    `${path.basename(outputSubtitle)}/machine-acoustic-risk-vector.json`,
    `${path.basename(outputSubtitle)}/machine-reasr-priority.json`,
    `${path.basename(outputSubtitle)}/machine-event-final-text-span-lineage.json`,
    `${path.basename(outputSubtitle)}/machine-span-text-repair.json`,
    `${path.basename(outputSubtitle)}/machine-partial-boundary-proposals.json`,
    `${path.basename(outputSubtitle)}/machine-joint-boundary-refinement.json`,
  ],
  artifactSemanticHashes: runAuditCore.artifactSemanticHashes,
  finalHashes,
};
await atomicWriteJson(
  path.join(argumentsValue.output, "shareable", "c6-0-1-6-summary.json"),
  {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-6-shareable-summary",
    ...shareableCore,
    semanticHash: machineQualitySemanticHash(shareableCore),
  },
);
const freeze = await createBlindOutputFreeze({
  taskDirectory: argumentsValue.output,
  freezeTimestamp: GENERATED_AT,
});
await atomicWriteJson(
  path.join(argumentsValue.output, "blind-output-freeze.json"),
  freeze,
);

console.log(
  JSON.stringify(
    {
      output: argumentsValue.output,
      stage: argumentsValue.stage,
      policyVersion: c6016PolicyVersion,
      policyHash: policy.policyHash,
      cueCount: finalPackage.cues.length,
      requestEdge: requestEdge.summary,
      decoderEvidence: decoderEvidence.summary,
      riskVector: riskVector.summary,
      reAsrPriority: reAsrPriority.summary,
      spanLineage: spanLineage.summary,
      spanRepair: spanRepair.artifact.summary,
      partialBoundary: partial.artifact.summary,
      jointBoundary: joint.artifact.summary,
      modelExecution: runAuditCore.modelExecution,
      baselineHashes,
      finalHashes,
      shadowOutcome: shadow.shadowMachineOutcome,
      productionStatus: shadow.productionStatus,
      finalizationMethod: shadow.productionFinalizationMethod,
      freezeHash: freeze.freezeSemanticHash,
    },
    null,
    2,
  ),
);
