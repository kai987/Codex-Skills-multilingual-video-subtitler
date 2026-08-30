import { createHash } from "node:crypto";
import type { C61Hypothesis, C61HypothesisUniverse } from "@mvl/shared";
import {
  c611CandidateMachineMetadataSchema,
  c611IntervalSchema,
  c611MachinePolicyVersion,
  machineC611CandidateCorrelationAuditSchema,
  machineC611HierarchicalCorrelationGroupsSchema,
  type C611CandidateMachineMetadata,
  type C611CorrelationGroups,
  type C611CorrelationObservation,
} from "../../../shared/src/c6-1-1-machine-schemas.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";

export const C611_CORRELATION_POLICY = {
  version: "c611-hierarchical-correlation-v1",
  levels: [
    "PROVIDER",
    "MODEL_REVISION",
    "VERIFIED_CORE_AUDIO",
    "DECODE_WINDOW_OBSERVATION",
  ],
  unknownCore: "candidate-isolated-no-event-id-core-inference",
  distinctObservation: "request-interval-decode-prompt-window-retained",
  currentProviderVote: false,
} as const;
export const c611TextHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
export function c611WithHash<T extends object>(
  value: T,
): T & { semanticHash: string } {
  return { ...value, semanticHash: hash(value) };
}
export const c611Header = {
  schemaVersion: "1.0.0" as const,
  policyVersion: c611MachinePolicyVersion,
  runtimeGoldInputCount: 0 as const,
};
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const sha = (value: unknown): string | null =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
const interval = (value: unknown) => {
  const parsed = c611IntervalSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
const boolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;
const ratio = (value: unknown): number | null =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1
    ? value
    : null;
const objectHash = (value: unknown): string | null =>
  Object.keys(obj(value)).length
    ? hash(value)
    : text(value)
      ? hash(value)
      : null;

const METADATA_ARTIFACTS = [
  "cue-candidate-evidence.json",
  "machine-candidate-pool-c6-0-1-5.json",
  "machine-decoder-evidence.json",
  "machine-targeted-event-reasr.json",
  "machine-fresh-targeted-reasr.json",
  "machine-core-text-projection.json",
  "machine-independent-asr-candidates.json",
  "c6-0-1-10-holdout-reazon-runtime.json",
  "machine-paired-whisper-evidence.json",
] as const;

/** Pure allowlisted projection. Context is inherited only from explicit parent/sibling
 * request records; an event identity alone never supplies an acoustic core. */
export function extractC611CandidateMetadata(input: {
  artifacts: Readonly<Record<string, unknown>>;
  sourceArtifactHashes: Readonly<Record<string, string>>;
}): C611CandidateMachineMetadata[] {
  const result: C611CandidateMachineMetadata[] = [];
  for (const file of METADATA_ARTIFACTS) {
    const top = obj(input.artifacts[file]);
    if (!Object.keys(top).length) continue;
    const artifactHash = sha(input.sourceArtifactHashes[file]);
    if (!artifactHash)
      throw new Error("C611_METADATA_ARTIFACT_IDENTITY_REQUIRED");
    const runtime =
      file === "machine-independent-asr-candidates.json"
        ? obj(input.artifacts["machine-independent-asr-runtime.json"])
        : top;
    const rootContext: Obj = {
      model: top.modelIdentity ?? runtime.modelIdentity,
      decode: top.decoding ?? runtime.decoding,
      prompt: top.promptPolicy ?? runtime.promptPolicy,
    };
    const candidates = Array.isArray(top.candidates)
      ? top.candidates.map(obj)
      : [];
    const exactByEvent = new Map<string, Obj[]>();
    for (const row of candidates) {
      if (row.windowType !== "CORE_EXACT" || !text(row.eventId)) continue;
      const key = String(row.eventId);
      exactByEvent.set(key, [...(exactByEvent.get(key) ?? []), row]);
    }
    const visit = (value: unknown, context: Obj): void => {
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, context));
        return;
      }
      const row = obj(value);
      if (!Object.keys(row).length) return;
      if (
        (row.runtimeGoldInputCount !== undefined &&
          row.runtimeGoldInputCount !== 0) ||
        row.humanDerived === true
      )
        throw new Error("C611_NON_MACHINE_METADATA");
      const eventId = text(row.eventId) ?? text(context.eventId);
      const pairedExact = obj(row.whisperCoreExact);
      const exactRows = eventId ? (exactByEvent.get(eventId) ?? []) : [];
      const exact = Object.keys(pairedExact).length
        ? pairedExact
        : exactRows.length === 1
          ? (exactRows[0] ?? {})
          : {};
      const exactAudio =
        sha(row.exactAudioSha256) ??
        sha(exact.audioSha256) ??
        sha(obj(exact.audioIdentity).audioSha256);
      const nextContext: Obj = {
        ...context,
        eventId,
        coreInterval:
          interval(row.coreInterval) ??
          interval(exact.sourceInterval) ??
          context.coreInterval,
        coreAudio: exactAudio ?? context.coreAudio,
      };
      const candidateId = text(row.candidateId) ?? text(row.cueId);
      if (candidateId) {
        const edge = obj(row.edgeEvidence),
          decoder = obj(row.decoderEvidence),
          token = obj(row.tokenCoverage);
        const display =
          text(row.displayText) ??
          text(row.coreProjectedText) ??
          text(row.text);
        const left =
          boolean(row.leftEdgePinned) ??
          boolean(edge.leftEdgePinned) ??
          boolean(edge.leftEdgeRisk);
        const right =
          boolean(row.rightEdgePinned) ??
          boolean(edge.rightEdgePinned) ??
          boolean(edge.rightEdgeRisk);
        const incomplete = boolean(row.incompleteSpeech);
        const completeness = row.speechCompletenessStatus;
        const requestInterval =
          interval(row.requestInterval) ??
          interval(row.sourceInterval) ??
          interval(row.sourceGlobalInterval) ??
          interval(row.interval);
        const isExact = row.windowType === "CORE_EXACT";
        const audio =
          sha(row.audioSha256) ?? sha(obj(row.audioIdentity).audioSha256);
        const body = {
          sourceCandidateId: candidateId,
          eventId,
          sourceArtifactHash: artifactHash,
          sourceTextHash: display === null ? null : c611TextHash(display),
          modelRevisionHash:
            sha(row.modelIdentityHash) ?? objectHash(nextContext.model),
          coreAudioSha256:
            sha(row.coreAudioSha256) ??
            sha(nextContext.coreAudio) ??
            (isExact ? audio : null),
          coreInterval:
            interval(row.coreInterval) ??
            interval(nextContext.coreInterval) ??
            (isExact ? requestInterval : null),
          requestAudioSha256: audio,
          requestInterval,
          decodeConfigurationHash:
            sha(row.decodeConfigurationHash) ??
            objectHash(
              row.decodeConfiguration ?? row.decoding ?? nextContext.decode,
            ),
          promptPolicyHash:
            sha(row.promptPolicyHash) ??
            objectHash(row.promptPolicy ?? nextContext.prompt),
          requestId: text(row.requestId),
          windowType: text(row.windowType),
          speechCompletenessStatus:
            completeness === "COMPLETE" || completeness === "INCOMPLETE"
              ? completeness
              : incomplete === true
                ? "INCOMPLETE"
                : "UNKNOWN",
          requestEdgeRisk:
            ratio(row.requestEdgeRisk) ??
            (left !== null && right !== null ? Number(left || right) : null),
          leftEdgePinned: left,
          rightEdgePinned: right,
          incompleteSpeech: incomplete,
          decoderTruncationRisk:
            ratio(row.decoderTruncationRisk) ??
            ratio(decoder.decoderTruncationRisk),
          tokenSupportCoverage:
            ratio(row.tokenSupportCoverage) ?? ratio(token.coverageRatio),
          hallucinationRisk: ratio(row.hallucinationRisk),
        };
        result.push(
          c611CandidateMachineMetadataSchema.parse(c611WithHash(body)),
        );
      }
      for (const [key, nested] of Object.entries(row)) {
        if (
          [
            "events",
            "candidates",
            "candidateOutputs",
            "whisperCoreExact",
            "whisperCoreContext",
            "currentWhisperCandidate",
            "reazonCoreExactCandidate",
            "reazonCoreContextCandidate",
          ].includes(key)
        )
          visit(nested, nextContext);
      }
    };
    visit(top, rootContext);
  }
  return result.toSorted((a, b) =>
    a.semanticHash.localeCompare(b.semanticHash),
  );
}

/** Multiple records can complete missing metadata; conflicting known values are
 * UNKNOWN. Never cherry-pick a favourable acoustic risk from duplicate records. */
export function metadataForC611Candidate(
  candidate: C61Hypothesis,
  metadata: readonly C611CandidateMachineMetadata[],
): C611CandidateMachineMetadata | null {
  const matches = metadata.filter(
    (row) =>
      row.sourceCandidateId === candidate.sourceCandidateId &&
      (row.eventId === candidate.eventId || row.eventId === null) &&
      (row.sourceTextHash === null ||
        row.sourceTextHash === c611TextHash(candidate.displayText)),
  );
  if (!matches.length) return null;
  const first = matches[0];
  if (!first) return null;
  const body = { ...first };
  for (const key of Object.keys(
    body,
  ) as (keyof C611CandidateMachineMetadata)[]) {
    if (
      [
        "sourceCandidateId",
        "eventId",
        "semanticHash",
        "sourceArtifactHash",
        "sourceTextHash",
      ].includes(key)
    )
      continue;
    const values = matches
      .map((entry) => entry[key])
      .filter((v) => v !== null && v !== "UNKNOWN");
    const known = new Map(values.map((v) => [hash(v), v]));
    (body as unknown as Obj)[key] =
      known.size === 1
        ? known.values().next().value
        : key === "speechCompletenessStatus"
          ? "UNKNOWN"
          : null;
  }
  body.sourceArtifactHash = hash(
    matches.map((m) => m.sourceArtifactHash).toSorted(),
  );
  const withoutHash = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "semanticHash"),
  );
  return c611CandidateMachineMetadataSchema.parse(c611WithHash(withoutHash));
}

export function buildC611CorrelationGroups(input: {
  universe: C61HypothesisUniverse;
  sourceAudioIdentity: string;
  metadata?: readonly C611CandidateMachineMetadata[];
}) {
  const metadata = (input.metadata ?? []).map((m) =>
    c611CandidateMachineMetadataSchema.parse(m),
  );
  const observations: C611CorrelationObservation[] = [];
  for (const candidate of input.universe.candidates.toSorted((a, b) =>
    a.candidateId.localeCompare(b.candidateId),
  )) {
    if (
      candidate.inclusionStatus !== "INCLUDED" ||
      candidate.providerFamily === "CURRENT"
    )
      continue;
    if (
      !candidate.eventId ||
      !candidate.modelIdentity ||
      !candidate.sourceInterval
    )
      throw new Error("C611_INCLUDED_CANDIDATE_IDENTITY_INVALID");
    const meta = metadataForC611Candidate(candidate, metadata);
    const modelGroupId = `model:${hash([candidate.providerFamily, candidate.modelIdentity, meta?.modelRevisionHash ?? null])}`;
    const coreKnown = Boolean(meta?.coreInterval && meta.coreAudioSha256);
    const coreGroupId = `core:${hash([modelGroupId, coreKnown ? [input.sourceAudioIdentity, meta?.coreInterval, meta?.coreAudioSha256] : ["UNKNOWN_CORE", candidate.candidateId]])}`;
    const missingMetadata = [
      !coreKnown && "coreIdentity",
      meta?.decodeConfigurationHash == null && "decodeConfiguration",
      meta?.promptPolicyHash == null && "promptPolicy",
      meta?.requestInterval == null && "requestInterval",
    ].filter((v): v is string => typeof v === "string");
    const observationGroupId = `observation:${hash([coreGroupId, candidate.sourceInterval, meta?.requestInterval ?? null, meta?.requestAudioSha256 ?? null, meta?.decodeConfigurationHash ?? ["UNKNOWN", candidate.candidateId], meta?.promptPolicyHash ?? ["UNKNOWN", candidate.candidateId], candidate.windowType, candidate.requestId])}`;
    observations.push(
      c611WithHash({
        candidateId: candidate.candidateId,
        eventId: candidate.eventId,
        providerFamily: candidate.providerFamily,
        legacyCorrelationGroupId: candidate.correlationGroupId,
        modelGroupId,
        coreGroupId,
        observationGroupId,
        modelIdentity: candidate.modelIdentity,
        sourceInterval: candidate.sourceInterval,
        coreInterval: meta?.coreInterval ?? null,
        requestInterval: meta?.requestInterval ?? null,
        coreAudioSha256: meta?.coreAudioSha256 ?? null,
        requestAudioSha256: meta?.requestAudioSha256 ?? null,
        decodeConfigurationHash: meta?.decodeConfigurationHash ?? null,
        promptPolicyHash: meta?.promptPolicyHash ?? null,
        requestId: candidate.requestId,
        windowType: candidate.windowType,
        metadataEvidenceHashes: metadata
          .filter((m) => m.sourceCandidateId === candidate.sourceCandidateId)
          .map((m) => m.semanticHash)
          .toSorted(),
        missingMetadata,
        coreIdentityVerified: coreKnown,
        normalizedTextHash: hash(candidate.normalizedText),
      }),
    );
  }
  const groups = machineC611HierarchicalCorrelationGroupsSchema.parse(
    c611WithHash({
      ...c611Header,
      artifactType: "machine-c6-1-1-hierarchical-correlation-groups",
      candidateUniverseHash: input.universe.semanticHash,
      correlationPolicyHash: hash(C611_CORRELATION_POLICY),
      sourceAudioIdentity: input.sourceAudioIdentity,
      observations,
      currentIndependentVoteCount: 0,
    }),
  );
  return { groups, audit: auditC611CorrelationGroups(groups, input.universe) };
}

function auditC611CorrelationGroups(
  groups: C611CorrelationGroups,
  universe: C61HypothesisUniverse,
) {
  const summary = (key: "legacyCorrelationGroupId" | "coreGroupId") => {
    const buckets = new Map<string, C611CorrelationObservation[]>();
    for (const row of groups.observations)
      buckets.set(row[key], [...(buckets.get(row[key]) ?? []), row]);
    const values = [...buckets.values()];
    const singletonGroups = values.filter((rows) => rows.length === 1).length;
    const textGroups = new Map<string, Set<string>>();
    for (const row of groups.observations) {
      const textKey = hash([row.eventId, row.normalizedTextHash]);
      textGroups.set(
        textKey,
        new Set([...(textGroups.get(textKey) ?? []), row[key]]),
      );
    }
    const knownCore = new Map<string, C611CorrelationObservation[]>();
    for (const row of groups.observations.filter((r) => r.coreIdentityVerified))
      knownCore.set(row.coreGroupId, [
        ...(knownCore.get(row.coreGroupId) ?? []),
        row,
      ]);
    return {
      totalGroups: buckets.size,
      singletonGroups,
      singletonRate: buckets.size ? singletonGroups / buckets.size : 0,
      groupsByProvider: {
        WHISPER: values.filter((rows) => rows[0]?.providerFamily === "WHISPER")
          .length,
        REAZON: values.filter((rows) => rows[0]?.providerFamily === "REAZON")
          .length,
      },
      candidatesPerGroup: [...buckets]
        .map(([groupId, rows]) => ({ groupId, count: rows.length }))
        .toSorted((a, b) => a.groupId.localeCompare(b.groupId)),
      sameAudioDifferentRequestGroups: [...knownCore.values()].filter(
        (rows) =>
          new Set(rows.map((r) => r.requestId).filter(Boolean)).size > 1,
      ).length,
      sameModelSameCoreSplitGroups: [...knownCore.values()].filter(
        (rows) => new Set(rows.map((r) => r[key])).size > 1,
      ).length,
      exactContextSeparatedGroups: [...knownCore.values()].filter(
        (rows) =>
          rows.some((r) => r.windowType.includes("EXACT")) &&
          rows.some((r) => r.windowType.includes("CONTEXT")) &&
          new Set(rows.map((r) => r[key])).size > 1,
      ).length,
      duplicateTextAcrossGroups: [...textGroups.values()].filter(
        (v) => v.size > 1,
      ).length,
      divergentTextWithinGroup: values.filter(
        (rows) => new Set(rows.map((r) => r.normalizedTextHash)).size > 1,
      ).length,
    };
  };
  const legacy = summary("legacyCorrelationGroupId"),
    hierarchical = summary("coreGroupId");
  const allGroups = new Map<string, number>();
  for (const candidate of universe.candidates.filter(
    (c) => c.inclusionStatus === "INCLUDED",
  ))
    allGroups.set(
      candidate.correlationGroupId,
      (allGroups.get(candidate.correlationGroupId) ?? 0) + 1,
    );
  const allSingletons = [...allGroups.values()].filter(
    (size) => size === 1,
  ).length;
  return machineC611CandidateCorrelationAuditSchema.parse(
    c611WithHash({
      ...c611Header,
      artifactType: "machine-c6-1-1-candidate-correlation-audit",
      correlationGroupsHash: groups.semanticHash,
      legacy,
      legacyAllIncludedGroupCount: allGroups.size,
      legacyAllIncludedSingletonCount: allSingletons,
      legacyAllIncludedSingletonRate: allGroups.size
        ? allSingletons / allGroups.size
        : 0,
      hierarchical,
      includedAsrCandidateCount: groups.observations.length,
      currentControlCount: universe.candidates.filter(
        (c) =>
          c.inclusionStatus === "INCLUDED" && c.providerFamily === "CURRENT",
      ).length,
      unknownCoreIdentityCount: groups.observations.filter(
        (r) => !r.coreIdentityVerified,
      ).length,
      unknownDecodeConfigurationCount: groups.observations.filter(
        (r) => r.decodeConfigurationHash === null,
      ).length,
      unknownPromptPolicyCount: groups.observations.filter(
        (r) => r.promptPolicyHash === null,
      ).length,
      reconciledSameCoreSplitGroupCount: legacy.sameModelSameCoreSplitGroups,
      reasons: [
        "ASR_ONLY_CORRELATION_DENOMINATOR_CURRENT_EXCLUDED",
        "CORE_GROUP_IS_NOT_AN_INDEPENDENT_MODEL",
        "DISTINCT_REQUEST_INTERVAL_DECODE_PROMPT_OBSERVATIONS_PRESERVED",
        "UNKNOWN_IDENTITIES_ARE_NOT_MERGED",
      ],
    }),
  );
}
