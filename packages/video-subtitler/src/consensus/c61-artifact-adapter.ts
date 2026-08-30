import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  subtitlePackageSchema,
  type SubtitlePackage,
  type C61HypothesisEvent,
  type C61HypothesisInput,
  type C61HypothesisUniverse,
} from "@mvl/shared";

import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { independentCtcRepresentations } from "../machine-quality/independent-ctc-projection.js";
import { normalizeC61HypothesisText } from "./hypothesis-universe.js";

type RecordValue = Record<string, unknown>;
interface Interval {
  start: number;
  end: number;
}

/** Deliberate allowlist: no Gold, human memory, correction logs or evaluation. */
export const C61_MACHINE_ARTIFACT_FILES = [
  "subtitle-package.json",
  "subtitle-package.needs-review.json",
  "machine-canonical-events.json",
  "machine-candidate-association-ledger.json",
  "machine-event-to-final-cue-lineage.json",
  "machine-event-final-text-span-lineage.json",
  "cue-candidate-evidence.json",
  "whisper-runtime-execution-audit.json",
  "machine-candidate-pool-c6-0-1-5.json",
  "machine-decoder-evidence.json",
  "machine-targeted-event-reasr.json",
  "machine-fresh-targeted-reasr.json",
  "machine-core-text-projection.json",
  "machine-independent-asr-candidates.json",
  "machine-independent-asr-runtime.json",
  "c6-0-1-10-holdout-reazon-runtime.json",
  "machine-cross-model-arbitration-evidence.json",
  "machine-paired-whisper-evidence.json",
  "machine-independent-acoustic-discriminator.json",
  "machine-independent-verifier-runtime.json",
] as const;

function record(value: unknown): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("C61_MACHINE_ARTIFACT_OBJECT_REQUIRED");
  }
  return value as RecordValue;
}

function maybeRecord(value: unknown): RecordValue | null {
  return value === null || value === undefined ? null : record(value);
}

function array(value: unknown): RecordValue[] {
  if (!Array.isArray(value)) throw new Error("C61_MACHINE_ARRAY_REQUIRED");
  return value.map(record);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function interval(value: unknown): Interval | null {
  const input = maybeRecord(value);
  if (input === null) return null;
  const start = number(input.start);
  const end = number(input.end);
  return start !== null && end !== null && start >= 0 && end > start
    ? { start, end }
    : null;
}

function required(value: unknown, field: string): string {
  const result = str(value);
  if (result === null) throw new Error(`C61_REQUIRED_MACHINE_FIELD:${field}`);
  return result;
}

function byteHash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertMachineOnly(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertMachineOnly);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (
      (key === "runtimeGoldInputCount" ||
        key === "goldRuntimeInputCount" ||
        key === "humanMemoryPromptLeakCount") &&
      entry !== 0
    ) {
      throw new Error(`C61_NON_MACHINE_INPUT:${key}`);
    }
    if (
      (key === "goldTextIncluded" ||
        key === "goldUsed" ||
        key === "goldSeenAtSelection" ||
        key === "candidateTextPromptUsed") &&
      entry !== false
    ) {
      throw new Error(`C61_FORBIDDEN_RUNTIME_AUTHORITY:${key}`);
    }
    assertMachineOnly(entry);
  }
}

export interface C61RawAcousticScore {
  sourceCandidateId: string;
  sourceDisplayTextHash: string;
  eventId: string;
  modelIdentityHash: string;
  audioSha256: string;
  expectedAudioSha256: string;
  representationHash: string;
  expectedRepresentationHash: string;
  nllPerTargetToken: number | null;
  scorability: "SCORABLE" | "UNSCORABLE";
  evidenceHash: string;
  sourceArtifactHash: string;
}

export interface C61MachineArtifactInput {
  subtitlePackage: SubtitlePackage;
  taskDirectory: string;
  events: C61HypothesisEvent[];
  candidates: C61HypothesisInput[];
  sourceArtifactHashes: Record<string, string>;
  acousticScores: C61RawAcousticScore[];
  baselineInventory: {
    canonicalCueCount: number;
    canonicalEventCount: number;
    historicalRawCandidateCount: number;
    historicalDispositionCounts: Record<string, number>;
    inputRowsByArtifact: Record<string, number>;
    sourceMediaSha256: string;
    sourceDurationSeconds: number;
    newAsrInferenceCount: 0;
    networkUsed: false;
    runtimeGoldInputCount: 0;
  };
}

export function adaptC61MachineArtifacts(input: {
  artifacts: Readonly<Record<string, unknown>>;
  sourceArtifactHashes: Record<string, string>;
  taskDirectory?: string;
}): C61MachineArtifactInput {
  const artifactHash = (name: string): string =>
    required(input.sourceArtifactHashes[name], `${name}:sha256`);
  const get = (name: string): RecordValue => {
    if (!(name in input.artifacts))
      throw new Error(`C61_REQUIRED_ARTIFACT_MISSING:${name}`);
    const value = record(input.artifacts[name]);
    assertMachineOnly(value);
    return value;
  };
  const pkg = subtitlePackageSchema.parse(
    get("subtitle-package.needs-review.json"),
  );
  const canonical = get("machine-canonical-events.json");
  const raw = get("cue-candidate-evidence.json");
  const association = get("machine-candidate-association-ledger.json");
  const lineage = get("machine-event-to-final-cue-lineage.json");
  const spans = get("machine-event-final-text-span-lineage.json");
  const runtime = get("whisper-runtime-execution-audit.json");
  const pool = get("machine-candidate-pool-c6-0-1-5.json");
  const decoder = get("machine-decoder-evidence.json");
  const targeted = get("machine-targeted-event-reasr.json");
  const fresh = get("machine-fresh-targeted-reasr.json");
  const projected = get("machine-core-text-projection.json");
  const secondAsr = get("machine-independent-asr-candidates.json");
  const secondRuntime = get("machine-independent-asr-runtime.json");
  const holdout = get("c6-0-1-10-holdout-reazon-runtime.json");
  const arbitration = get("machine-cross-model-arbitration-evidence.json");
  const paired = get("machine-paired-whisper-evidence.json");
  const acoustic = get("machine-independent-acoustic-discriminator.json");
  const verifier = get("machine-independent-verifier-runtime.json");
  const byId = (rows: RecordValue[], key: string): Map<string, RecordValue> =>
    new Map(rows.map((row) => [required(row[key], key), row]));
  const assocById = byId(array(association.records), "candidateId");
  const spanByEvent = byId(array(spans.events), "eventId");
  const lineageByEvent = byId(array(lineage.events), "eventId");
  const decoderById = byId(array(decoder.candidates), "candidateId");
  const currentCueIds = new Set(pkg.cues.map((cue) => cue.id));
  const events: C61HypothesisEvent[] = array(canonical.events).map((entry) => {
    const eventId = required(entry.eventId, "eventId");
    const sourceInterval = interval(entry.acousticInterval);
    if (sourceInterval === null)
      throw new Error(`C61_INVALID_EVENT_INTERVAL:${eventId}`);
    const span = spanByEvent.get(eventId);
    const finalCueId = str(span?.finalCueId);
    const spanStart = number(span?.spanStart);
    const spanEnd = number(span?.spanEnd);
    const spanText = typeof span?.spanText === "string" ? span.spanText : null;
    const finalSpan =
      finalCueId !== null &&
      currentCueIds.has(finalCueId) &&
      spanStart !== null &&
      spanEnd !== null &&
      spanEnd >= spanStart &&
      spanText !== null
        ? {
            finalCueId,
            spanStart,
            spanEnd,
            spanText,
            lineageStatus: required(span?.lineageStatus, "span-lineage-status"),
            modifiable: span?.modifiable === true,
            evidenceHash: required(span?.semanticHash, "span-semantic-hash"),
          }
        : null;
    if (finalSpan?.modifiable) {
      const cue = pkg.cues.find((entry) => entry.id === finalSpan.finalCueId);
      if (
        cue === undefined ||
        Array.from(cue.text)
          .slice(finalSpan.spanStart, finalSpan.spanEnd)
          .join("") !== finalSpan.spanText
      ) {
        throw new Error(`C61_STALE_FINAL_SPAN_LINEAGE:${eventId}`);
      }
    }
    const body = {
      eventId,
      sourceInterval,
      sourceCandidateIds: strings(entry.candidateIds).toSorted(),
      finalCueIds: strings(lineageByEvent.get(eventId)?.finalCueIds)
        .filter((id) => currentCueIds.has(id))
        .toSorted(),
      currentText: finalSpan?.spanText ?? null,
      finalSpan,
    };
    return { ...body, semanticHash: hash(body) };
  });
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const runtimeBody = record(runtime.runtime);
  const baselineModel =
    str(runtimeBody.modelSha256) === null
      ? null
      : hash({
          model: runtimeBody.modelSha256,
          binary: runtimeBody.binarySha256,
          version: runtimeBody.actualVersion,
        });
  const freshModel = hash(record(fresh.inferenceRuntime));
  const pairedModel = hash(record(paired.modelIdentity));
  const reazonModel = (value: unknown): string => {
    const identity = record(value);
    return hash({
      modelId: required(identity.modelId, "reazon modelId"),
      modelRevision: required(identity.modelRevision, "reazon modelRevision"),
      modelSnapshotHash: required(
        identity.modelSnapshotHash,
        "reazon modelSnapshotHash",
      ),
    });
  };
  const secondModel = reazonModel(secondRuntime.modelIdentity);
  const holdoutModel = reazonModel(holdout.modelIdentity);
  const pronunciation = new Map<
    string,
    { displayText: string; pronunciationText: string; evidenceId: string }
  >();
  for (const event of array(arbitration.events)) {
    for (const value of [
      event.currentWhisperCandidate,
      ...array(event.alternateWhisperCandidates),
      event.reazonCoreExactCandidate,
      event.reazonCoreContextCandidate,
    ]) {
      const candidate = maybeRecord(value);
      if (candidate === null) continue;
      const text = str(candidate.pronunciationText);
      // Existing echo text containing kanji is not a machine pronunciation.
      if (text !== null && !/\p{Script=Han}/u.test(text))
        pronunciation.set(required(candidate.candidateId, "candidateId"), {
          displayText: required(candidate.displayText, "displayText"),
          pronunciationText: text,
          evidenceId: required(candidate.semanticHash, "semanticHash"),
        });
    }
  }
  const candidates: C61HypothesisInput[] = [];
  const inputRowsByArtifact: Record<string, number> = {};
  const push = (
    file: string,
    candidate: Omit<
      C61HypothesisInput,
      "inputRecordId" | "runtimeGoldInputCount" | "humanDerived"
    >,
  ): void => {
    const pron = pronunciation.get(candidate.sourceCandidateId);
    const exactPron = pron?.displayText === candidate.displayText;
    const inlineTrusted =
      candidate.pronunciationText !== null &&
      !/\p{Script=Han}/u.test(candidate.pronunciationText);
    candidates.push({
      ...candidate,
      inputRecordId: `${file}#${candidate.sourceCandidateId}`,
      pronunciationText: inlineTrusted
        ? candidate.pronunciationText
        : exactPron
          ? pron.pronunciationText
          : null,
      pronunciationEvidenceId: inlineTrusted
        ? candidate.pronunciationEvidenceId
        : exactPron
          ? pron.evidenceId
          : null,
      runtimeGoldInputCount: 0,
      humanDerived: false,
    });
    inputRowsByArtifact[file] = (inputRowsByArtifact[file] ?? 0) + 1;
  };
  const make = (
    file: string,
    candidateId: string,
    eventId: string | null,
    text: string,
  ): Omit<
    C61HypothesisInput,
    "inputRecordId" | "runtimeGoldInputCount" | "humanDerived"
  > => ({
    sourceCandidateId: candidateId,
    eventId,
    displayText: text,
    providerFamily: "WHISPER",
    modelIdentity: baselineModel,
    requestId: null,
    windowType: "HISTORICAL",
    sourceInterval: null,
    pronunciationText: null,
    pronunciationEvidenceId: null,
    candidateRole: "HISTORICAL_MACHINE_CANDIDATE",
    correlationLineage: [],
    provenanceHashes: [
      required(input.sourceArtifactHashes[file], `${file}:hash`),
    ],
    lineageVerified: eventId !== null && eventById.has(eventId),
    sourceGlobalVerified: false,
    hardRejectionReasons: [],
    localizationBlockers: [],
  });
  for (const row of array(raw.candidates)) {
    const candidateId = required(row.cueId, "cueId");
    const link = assocById.get(candidateId);
    const eventId = str(link?.assignedEventId);
    const file = "cue-candidate-evidence.json";
    push(file, {
      ...make(
        file,
        candidateId,
        eventId,
        typeof row.text === "string" ? row.text : "",
      ),
      requestId: strings(row.sourceRequestIds).join("+") || null,
      windowType: strings(row.sourceProfileIds).join("+") || "HISTORICAL",
      sourceInterval: interval(row.interval),
      correlationLineage: strings(row.sourceProfileIds),
      sourceGlobalVerified: interval(row.interval) !== null,
      hardRejectionReasons: [
        ...strings(row.hardBlockReasons),
        ...strings(link?.hardIncompatibilities),
      ],
      localizationBlockers:
        link?.disposition === "AMBIGUOUS"
          ? ["AMBIGUOUS_HISTORICAL_EVENT_ASSIGNMENT"]
          : [],
      provenanceHashes: [
        artifactHash(file),
        artifactHash("machine-candidate-association-ledger.json"),
        artifactHash("whisper-runtime-execution-audit.json"),
      ],
    });
  }
  for (const row of array(pool.candidates)) {
    const candidateId = required(row.candidateId, "candidateId");
    const file = "machine-candidate-pool-c6-0-1-5.json";
    const decoderRow = decoderById.get(candidateId);
    push(file, {
      ...make(
        file,
        candidateId,
        str(row.eventId),
        typeof row.text === "string" ? row.text : "",
      ),
      requestId:
        str(decoderRow?.requestId) ??
        (strings(row.requestIds).join("+") || null),
      windowType: strings(row.sourceWindowIds).join("+") || "HISTORICAL",
      candidateRole:
        row.origin === "baseline-machine-candidate"
          ? "PRIMARY_WHISPER"
          : "WHISPER_RE_ASR_CANDIDATES",
      sourceInterval: interval(row.interval),
      sourceGlobalVerified: row.sourceGlobalVerified === true,
      correlationLineage: strings(row.correlatedSupportGroups),
      provenanceHashes: [
        artifactHash(file),
        artifactHash("machine-decoder-evidence.json"),
        artifactHash("whisper-runtime-execution-audit.json"),
      ],
      localizationBlockers:
        row.promptIsolated === false ? ["PROMPT_NOT_ISOLATED"] : [],
    });
  }
  for (const event of array(targeted.events)) {
    const requests = array(event.verificationRequests);
    for (const row of array(event.candidateOutputs)) {
      const file = "machine-targeted-event-reasr.json";
      push(file, {
        ...make(
          file,
          required(row.candidateId, "candidateId"),
          str(event.eventId),
          typeof row.text === "string" ? row.text : "",
        ),
        requestId: strings(row.requestIds).join("+") || null,
        sourceInterval: interval(row.sourceGlobalInterval),
        sourceGlobalVerified: row.lineageComplete === true,
        windowType: "TARGETED_CONTEXT",
        candidateRole: "WHISPER_RE_ASR_CANDIDATES",
        correlationLineage: requests
          .map((request) => str(request.requestFamily))
          .filter((value): value is string => value !== null),
      });
    }
  }
  for (const row of array(fresh.candidates)) {
    const file = "machine-fresh-targeted-reasr.json";
    push(file, {
      ...make(
        file,
        required(row.candidateId, "candidateId"),
        str(row.eventId),
        typeof row.text === "string" ? row.text : "",
      ),
      modelIdentity: freshModel,
      requestId: strings(row.requestIds).join("+") || null,
      sourceInterval: interval(row.sourceGlobalInterval),
      sourceGlobalVerified: row.globalTokenMappingVerified === true,
      windowType: "FRESH_WINDOW_FAMILY",
      candidateRole: "WHISPER_RE_ASR_CANDIDATES",
      correlationLineage: strings(row.correlatedLineageIds),
    });
  }
  for (const row of array(projected.candidates)) {
    const file = "machine-core-text-projection.json";
    const isFreshProjection = str(row.origin)?.startsWith("FRESH") === true;
    const projectionModel = isFreshProjection ? freshModel : baselineModel;
    push(file, {
      ...make(
        file,
        required(row.candidateId, "candidateId"),
        str(row.eventId),
        typeof row.coreProjectedText === "string" ? row.coreProjectedText : "",
      ),
      modelIdentity: projectionModel,
      requestId: str(row.requestId),
      sourceInterval: interval(row.sourceGlobalInterval),
      sourceGlobalVerified: row.projectionStatus === "EXACT_TOKEN_PROJECTED",
      candidateRole: "WHISPER_CORE_PROJECTED",
      windowType: "CORE_PROJECTED",
      correlationLineage: [
        "core-projection",
        projectionModel ?? "unavailable-model",
      ],
      localizationBlockers:
        row.projectionStatus === "EXACT_TOKEN_PROJECTED"
          ? []
          : ["CORE_PROJECTION_UNVERIFIED"],
    });
  }
  const addProvider = (
    file: string,
    rows: RecordValue[],
    modelIdentity: string,
    providerFamily: "WHISPER" | "REAZON",
  ): void => {
    for (const row of rows) {
      const candidateId = required(row.candidateId, "candidateId");
      const eventId = str(row.eventId);
      const windowType = str(row.windowType) ?? "UNKNOWN_WINDOW";
      const pronunciationText = str(row.pronunciationText);
      const base = make(
        file,
        candidateId,
        eventId,
        typeof row.displayText === "string" ? row.displayText : "",
      );
      const sourceInterval = interval(row.sourceInterval);
      push(file, {
        ...base,
        modelIdentity,
        providerFamily,
        requestId:
          str(row.requestId) ??
          (str(row.cacheKey) !== null ? candidateId : null),
        sourceInterval,
        sourceGlobalVerified: sourceInterval !== null,
        windowType,
        candidateRole: `${providerFamily}_${windowType}`,
        pronunciationText,
        pronunciationEvidenceId:
          pronunciationText === null ? null : str(row.semanticHash),
        // Exact/context windows share provider+model+event, not independent votes.
        correlationLineage: [
          modelIdentity,
          "same-event-core-window-family",
          "prompt-free",
        ],
        hardRejectionReasons:
          row.requestStatus !== undefined && row.requestStatus !== "SUCCESS"
            ? ["ASR_REQUEST_NOT_SUCCESSFUL"]
            : [],
      });
    }
  };
  addProvider(
    "machine-independent-asr-candidates.json",
    array(secondAsr.candidates),
    secondModel,
    "REAZON",
  );
  addProvider(
    "c6-0-1-10-holdout-reazon-runtime.json",
    array(holdout.candidates),
    holdoutModel,
    "REAZON",
  );
  const pairedRows = array(paired.events).flatMap((event) =>
    ["whisperCoreExact", "whisperCoreContext"].flatMap((key) => {
      const row = maybeRecord(event[key]);
      return row === null ? [] : [{ ...row, eventId: event.eventId }];
    }),
  );
  addProvider(
    "machine-paired-whisper-evidence.json",
    pairedRows,
    pairedModel,
    "WHISPER",
  );
  for (const event of events) {
    if (event.finalSpan === null || event.currentText === null) continue;
    const file = "machine-event-final-text-span-lineage.json";
    push(file, {
      ...make(
        file,
        `current-final:${event.eventId}`,
        event.eventId,
        event.currentText,
      ),
      providerFamily: "CURRENT",
      modelIdentity: `derived:${input.sourceArtifactHashes["subtitle-package.json"]}`,
      requestId: `final-cue:${event.finalSpan.finalCueId}`,
      candidateRole: "CURRENT_FINAL",
      windowType: "FINAL_EVENT_SPAN",
      sourceInterval: event.sourceInterval,
      sourceGlobalVerified: true,
      correlationLineage: ["derived-final-no-independent-vote"],
      localizationBlockers: event.finalSpan.modifiable
        ? []
        : ["FINAL_SPAN_LINEAGE_UNSAFE"],
    });
  }
  // Broad context containing an exact core plus extra words has no verified
  // event-local lexical projection. Record rather than voting neighboring words.
  for (const candidate of candidates) {
    if (!candidate.windowType.includes("CONTEXT")) continue;
    const exact = candidates.find(
      (other) =>
        other.eventId === candidate.eventId &&
        other.providerFamily === candidate.providerFamily &&
        other.windowType === "CORE_EXACT",
    );
    if (exact === undefined) continue;
    const text = normalizeC61HypothesisText(candidate.displayText);
    const core = normalizeC61HypothesisText(exact.displayText);
    if (core.length > 0 && text !== core && text.includes(core))
      candidate.localizationBlockers.push(
        "CONTEXT_EXTENSION_WITHOUT_TOKEN_CORE_PROJECTION",
      );
  }
  const verifierHash = required(verifier.semanticHash, "verifier semanticHash");
  if (
    acoustic.verifierRuntimeSemanticHash !== verifierHash ||
    acoustic.pairedWhisperSemanticHash !== paired.semanticHash
  ) {
    throw new Error("C61_ACOUSTIC_RUNTIME_OR_AUDIO_LINEAGE_MISMATCH");
  }
  const arbitrationById = byId(array(arbitration.events), "eventId");
  const pairedById = byId(array(paired.events), "eventId");
  const modelIdentityHash = hash({
    modelIdentity: verifier.modelIdentity,
    runtimeIdentity: verifier.runtimeIdentity,
  });
  const acousticScores: C61RawAcousticScore[] = [];
  for (const event of array(acoustic.events)) {
    const eventId = required(event.eventId, "eventId");
    const sourceEvent = arbitrationById.get(eventId);
    for (const [key, candidateKey] of [
      ["whisper", "currentWhisperCandidate"],
      ["reazon", "reazonCoreExactCandidate"],
    ] as const) {
      const score = record(event[key]);
      const source = maybeRecord(sourceEvent?.[candidateKey]);
      if (source === null) continue;
      const sourcePronunciation = str(source.pronunciationText);
      const representations = independentCtcRepresentations({
        displayText: required(source.displayText, "displayText"),
        ...(sourcePronunciation === null
          ? {}
          : { pronunciationText: sourcePronunciation }),
      });
      const representation = representations.find(
        (entry) => entry.type === score.representation,
      );
      const expectedRepresentationHash = byteHash(representation?.text ?? "");
      const expectedAudioSha256 = required(
        pairedById.get(eventId)?.exactAudioSha256,
        "paired exactAudioSha256",
      );
      const sourceCandidateId = required(
        score.candidateId,
        "score candidateId",
      );
      const verified =
        representation !== undefined &&
        sourceCandidateId === source.candidateId &&
        score.representationHash === expectedRepresentationHash &&
        event.audioSha256 === expectedAudioSha256 &&
        strings(score.blockers).length === 0 &&
        event.scorability === "SCORABLE";
      acousticScores.push({
        sourceCandidateId,
        sourceDisplayTextHash: byteHash(
          required(source.displayText, "source acoustic text"),
        ),
        eventId,
        modelIdentityHash,
        audioSha256: required(event.audioSha256, "score audioSha256"),
        expectedAudioSha256,
        representationHash: required(
          score.representationHash,
          "representationHash",
        ),
        expectedRepresentationHash,
        nllPerTargetToken: verified ? number(score.nllPerTargetToken) : null,
        scorability: verified ? "SCORABLE" : "UNSCORABLE",
        evidenceHash: required(event.semanticHash, "acoustic event hash"),
        sourceArtifactHash: artifactHash(
          "machine-independent-acoustic-discriminator.json",
        ),
      });
    }
  }
  const historicalDispositionCounts: Record<string, number> = {};
  for (const row of array(association.records)) {
    const disposition = required(row.disposition, "disposition");
    historicalDispositionCounts[disposition] =
      (historicalDispositionCounts[disposition] ?? 0) + 1;
  }
  return {
    subtitlePackage: pkg,
    taskDirectory: input.taskDirectory ?? "",
    events,
    candidates,
    sourceArtifactHashes: input.sourceArtifactHashes,
    acousticScores,
    baselineInventory: {
      canonicalCueCount: pkg.cues.length,
      canonicalEventCount: events.length,
      historicalRawCandidateCount: array(raw.candidates).length,
      historicalDispositionCounts,
      inputRowsByArtifact,
      sourceMediaSha256: required(
        arbitration.sourceMediaSha256,
        "sourceMediaSha256",
      ),
      sourceDurationSeconds: pkg.source.durationSeconds,
      newAsrInferenceCount: 0,
      networkUsed: false,
      runtimeGoldInputCount: 0,
    },
  };
}

export async function loadC61MachineArtifacts(
  taskRoot: string,
): Promise<C61MachineArtifactInput> {
  const entries = await readdir(taskRoot, { withFileTypes: true });
  const hasPackage = entries.some(
    (entry) => entry.name === "subtitle-package.json" && entry.isFile(),
  );
  const directories = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (!hasPackage && directories.length !== 1)
    throw new Error("C61_TASK_DIRECTORY_AMBIGUOUS");
  const directory = directories[0];
  if (!hasPackage && directory === undefined)
    throw new Error("C61_TASK_DIRECTORY_MISSING");
  const taskDirectory = hasPackage
    ? taskRoot
    : path.join(taskRoot, directory?.name ?? "");
  const artifacts: Record<string, unknown> = {};
  const sourceArtifactHashes: Record<string, string> = {};
  for (const file of C61_MACHINE_ARTIFACT_FILES) {
    const bytes = await readFile(path.join(taskDirectory, file));
    artifacts[file] = JSON.parse(bytes.toString("utf8")) as unknown;
    sourceArtifactHashes[file] = byteHash(bytes);
  }
  return adaptC61MachineArtifacts({
    artifacts,
    sourceArtifactHashes,
    taskDirectory,
  });
}

/** Candidate ids and provenance are bound after the universe's deterministic ids. */
export function bindC61AcousticEvidence(
  universe: C61HypothesisUniverse,
  scores: readonly C61RawAcousticScore[],
): {
  candidateId: string;
  eventId: string;
  candidateProvenanceHash: string;
  expectedIdentity: {
    modelIdentityHash: string;
    audioSha256: string;
    representationHash: string;
  };
  cachedIdentity: {
    modelIdentityHash: string;
    audioSha256: string;
    representationHash: string;
  };
  nllPerTargetToken: number | null;
  scorability: "SCORABLE" | "UNSCORABLE";
  evidenceHash: string;
  cacheHit: boolean;
}[] {
  return universe.candidates.flatMap((candidate) => {
    if (candidate.inclusionStatus !== "INCLUDED" || candidate.eventId === null)
      return [];
    const score = scores.find(
      (entry) =>
        entry.sourceCandidateId === candidate.sourceCandidateId &&
        entry.eventId === candidate.eventId &&
        entry.sourceDisplayTextHash === byteHash(candidate.displayText),
    );
    if (score === undefined) return [];
    return [
      {
        candidateId: candidate.candidateId,
        eventId: candidate.eventId,
        candidateProvenanceHash: candidate.provenanceHash,
        expectedIdentity: {
          modelIdentityHash: score.modelIdentityHash,
          audioSha256: score.expectedAudioSha256,
          representationHash: score.expectedRepresentationHash,
        },
        cachedIdentity: {
          modelIdentityHash: score.modelIdentityHash,
          audioSha256: score.audioSha256,
          representationHash: score.representationHash,
        },
        nllPerTargetToken: score.nllPerTargetToken,
        scorability: score.scorability,
        evidenceHash: score.evidenceHash,
        // Frozen score-artifact reuse; no claim that a model cache file was reopened.
        cacheHit: score.scorability === "SCORABLE",
      },
    ];
  });
}
