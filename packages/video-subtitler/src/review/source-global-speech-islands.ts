import {
  asrRequestTimelineContractV2Schema,
  machineGlobalTokenTimelineV2Schema,
  machineVadGlobalTimebaseSchema,
  c60114SourceEvidenceSchema,
  c60114SpeechIslandsSchema,
  c60114IntervalSchema,
  c60114BoundarySchema,
  c60114ParentGapSchema,
  type C60114Boundary,
  type C60114Interval,
  type C60114ParentGap,
  type C60114Policy,
  type C60114SourceEvidence,
  type C60114SourceIdentity,
  type C60114SpeechIsland,
  type C60114SpeechIslands,
} from "@mvl/shared";
import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "../machine-quality/evidence-correlation.js";
import { mapChildSampleToParent } from "../machine-quality/sample-transform-chain.js";
import {
  assertC60114SourceIdentity,
  c60114ArtifactHeader,
  c60114Coverage,
  c60114Id,
  c60114Intersection,
  c60114Subtract,
  c60114Union,
  uniqueC60114,
  withC60114SemanticHash,
} from "./c60114-policy.js";

/** A binding is supplied only after authenticating the source audio selection and
 * the artifact's coordinate lineage. Mere directory membership is not proof. */
export interface C60114ArtifactBinding {
  sourceIdentity: C60114SourceIdentity;
  artifactSemanticHash: string;
  coordinateSystem: "SOURCE_GLOBAL_SECONDS";
  verified: boolean;
  verificationEvidenceIds: readonly string[];
}
export interface C60114MachineEvidenceArtifacts {
  vadTimebase?: unknown;
  requestTimeline?: unknown;
  tokenTimeline?: unknown;
  decodedSegments?: unknown;
  rawTranscription?: unknown;
  canonicalSegments?: unknown;
  speakerEvidence?: unknown;
  acousticScenes?: unknown;
  candidateEvidence?: unknown;
}
export type C60114ArtifactBindings = Partial<
  Record<keyof C60114MachineEvidenceArtifacts, C60114ArtifactBinding>
>;
export interface C60114CandidateLocalization {
  candidateId: string;
  sourceInterval: C60114Interval;
  targetAnchorIds: string[];
  evidenceIds: string[];
  rootLineageIds: string[];
}
function record(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function records(v: unknown, key: string): Record<string, unknown>[] {
  const a = record(v)[key];
  return Array.isArray(a) ? a.map(record) : [];
}
function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
}
function interval(v: unknown): C60114Interval | null {
  const p = c60114IntervalSchema.safeParse(v);
  return p.success ? p.data : null;
}
function rowInterval(v: Record<string, unknown>): C60114Interval | null {
  return (
    interval(v.sourceGlobalInterval) ??
    interval(v.sourceInterval) ??
    interval(v.interval) ??
    interval({ start: v.start, end: v.end })
  );
}
function nativeHash(v: unknown, key = "semanticHash", header = false): boolean {
  const value = record(v);
  const expected = value[key];
  const omitted = new Set([
    key,
    ...(header
      ? ["schemaVersion", "policyVersion", "generatedAt", "artifactType"]
      : []),
  ]);
  const core = Object.fromEntries(
    Object.entries(value).filter(([field]) => !omitted.has(field)),
  );
  return (
    typeof expected === "string" &&
    machineQualitySemanticHash(core) === expected
  );
}

export function createC60114SourceEvidence(
  input: Omit<C60114SourceEvidence, "semanticHash">,
): C60114SourceEvidence {
  const verified = input.mappingStatus === "VERIFIED";
  return c60114SourceEvidenceSchema.parse(
    withC60114SemanticHash({
      ...input,
      rootLineageIds: uniqueC60114(input.rootLineageIds),
      sceneIds: uniqueC60114(input.sceneIds),
      speakerIds: uniqueC60114(input.speakerIds),
      reasons: uniqueC60114(input.reasons),
      speechPositive: verified && input.speechPositive,
      lexicalPositive: verified && input.lexicalPositive,
      reliableLocalizedLexical: verified && input.reliableLocalizedLexical,
      contradiction: verified && input.contradiction,
    }),
  );
}

/** This adapter never recursively scans arbitrary objects or files. Each named
 * source has an explicit structural path and an auditable coordinate gate. */
export function adaptC60114MachineEvidence(input: {
  sourceIdentity: C60114SourceIdentity;
  artifacts: C60114MachineEvidenceArtifacts;
  bindings?: C60114ArtifactBindings;
}): {
  evidence: C60114SourceEvidence[];
  unavailableArtifactIds: string[];
  candidateLocalizations: C60114CandidateLocalization[];
} {
  const evidence: C60114SourceEvidence[] = [];
  const candidateLocalizations: C60114CandidateLocalization[] = [];
  const unavailableArtifactIds: string[] = [];
  const sourceHash = machineQualitySemanticHash(input.sourceIdentity);
  const bindingValid = (key: keyof C60114MachineEvidenceArtifacts): boolean => {
    const binding = input.bindings?.[key];
    if (
      !binding ||
      !binding.verified ||
      binding.verificationEvidenceIds.length === 0
    )
      return false;
    assertC60114SourceIdentity(binding.sourceIdentity, input.sourceIdentity);
    if (
      binding.artifactSemanticHash !==
      machineQualitySemanticHash(input.artifacts[key])
    )
      throw new Error(`C60114_ARTIFACT_BINDING_HASH_MISMATCH:${key}`);
    return true;
  };
  const add = (
    key: keyof C60114MachineEvidenceArtifacts,
    row: Record<string, unknown>,
    family: C60114SourceEvidence["family"],
    span: C60114Interval | null,
    verified: boolean,
    extra: Partial<C60114SourceEvidence> = {},
  ) => {
    const artifactSemanticHash = machineQualitySemanticHash(
      input.artifacts[key],
    );
    const rawId =
      typeof row.id === "string"
        ? row.id
        : typeof row.requestId === "string"
          ? `${row.requestId}:${machineQualitySemanticHash(row)}`
          : machineQualitySemanticHash(row);
    const roots = uniqueC60114([
      ...strings(row.rootLineageIds),
      ...strings(row.sourceRequestIds),
      ...(typeof row.requestId === "string" ? [row.requestId] : []),
    ]);
    const bounded =
      span !== null && span.end <= input.sourceIdentity.durationSeconds;
    const active = verified && bounded;
    evidence.push(
      createC60114SourceEvidence({
        evidenceId: c60114Id("evidence", { key, rawId, family }),
        family,
        sourceInterval: span,
        speechPositive: false,
        lexicalPositive: false,
        reliableLocalizedLexical: false,
        contradiction: false,
        strength: 0.6,
        rootLineageIds: roots.length
          ? roots
          : [`artifact:${artifactSemanticHash}`],
        correlationGroup: `${key}:${roots.join("|") || artifactSemanticHash}`,
        providerFamily: "unclassified-machine-source",
        artifactId: key,
        artifactSemanticHash,
        sceneIds: [],
        speakerIds: [],
        reasons: [
          active
            ? "VERIFIED_SOURCE_GLOBAL_COORDINATE_LINEAGE"
            : !bounded
              ? "INVALID_OR_OUT_OF_SOURCE_INTERVAL"
              : "SOURCE_GLOBAL_COORDINATE_LINEAGE_UNVERIFIED",
        ],
        ...extra,
        mappingStatus: active ? "VERIFIED" : "QUARANTINED",
        sourceIdentityHash: active ? sourceHash : null,
      }),
    );
  };
  const vadParsed = machineVadGlobalTimebaseSchema.safeParse(
    input.artifacts.vadTimebase,
  );
  const vad = vadParsed.success ? vadParsed.data : null;
  const vadBinding =
    input.artifacts.vadTimebase !== undefined && bindingValid("vadTimebase");
  const vadIdentity =
    vad !== null &&
    vad.sourceIdentity.sourceMediaSha256 ===
      input.sourceIdentity.sourceMediaSha256 &&
    vad.sourceIdentity.sourceReadOnlyVerified &&
    Math.abs(
      vad.sourceIdentity.sourceTotalSamples /
        vad.sourceIdentity.sourceSampleRate -
        input.sourceIdentity.durationSeconds,
    ) <=
      1 / vad.sourceIdentity.sourceSampleRate &&
    nativeHash(vad, "semanticHash", true);
  if (vad !== null) {
    for (const v of vad.vadSegments) {
      const transform = vad.parentChildTransforms.find(
        (t) => t.semanticHash === v.parentTransformHash,
      );
      const verified =
        vadBinding &&
        vadIdentity &&
        v.mappingStatus === "VERIFIED" &&
        v.sourceMediaSha256 === input.sourceIdentity.sourceMediaSha256 &&
        nativeHash(v, "timebaseSemanticHash") &&
        transform?.verified === true &&
        nativeHash(transform) &&
        transform.parentArtifactSha256 ===
          input.sourceIdentity.sourceMediaSha256 &&
        transform.parentSampleRate === vad.sourceIdentity.sourceSampleRate &&
        transform.parentTotalSamples ===
          vad.sourceIdentity.sourceTotalSamples &&
        transform.childArtifactId === v.parentArtifactId &&
        transform.childArtifactSha256 === v.parentArtifactSha256 &&
        transform.childSampleRate === v.parentSampleRate &&
        transform.childTotalSamples === v.parentTotalSamples &&
        v.vadStartSampleInParent >= 0 &&
        v.vadEndSampleInParent <= transform.childTotalSamples &&
        mapChildSampleToParent({
          transform,
          childSample: v.vadStartSampleInParent,
          boundary: "start",
        }) === v.sourceGlobalStartSample &&
        mapChildSampleToParent({
          transform,
          childSample: v.vadEndSampleInParent,
          boundary: "end",
        }) === v.sourceGlobalEndSample;
      add(
        "vadTimebase",
        { ...v, id: v.vadSegmentId },
        "MAPPED_VAD",
        {
          start:
            v.sourceGlobalStartSample / vad.sourceIdentity.sourceSampleRate,
          end: v.sourceGlobalEndSample / vad.sourceIdentity.sourceSampleRate,
        },
        verified,
        {
          speechPositive: true,
          providerFamily: "whisper-vad",
          correlationGroup: `whisper:${v.requestId}`,
          rootLineageIds: [v.requestId],
        },
      );
    }
  } else {
    unavailableArtifactIds.push("vadTimebase");
    for (const v of records(input.artifacts.vadTimebase, "vadSegments"))
      add("vadTimebase", v, "MAPPED_VAD", rowInterval(v), false);
  }
  const requestParsed = asrRequestTimelineContractV2Schema.safeParse(
    input.artifacts.requestTimeline,
  );
  const requestArtifact = requestParsed.success ? requestParsed.data : null;
  const requestValid =
    requestArtifact !== null &&
    bindingValid("requestTimeline") &&
    requestArtifact.sourceMediaSha256 ===
      input.sourceIdentity.sourceMediaSha256 &&
    nativeHash(requestArtifact, "semanticHash", true) &&
    vadIdentity &&
    requestArtifact.vadGlobalTimebaseSemanticHash === vad.semanticHash;
  const requests = new Map(
    (requestArtifact?.requests ?? []).map((r) => [r.requestId, r]),
  );
  if (requestArtifact === null) unavailableArtifactIds.push("requestTimeline");
  const tokenParsed = machineGlobalTokenTimelineV2Schema.safeParse(
    input.artifacts.tokenTimeline,
  );
  const tokenArtifact = tokenParsed.success ? tokenParsed.data : null;
  const tokenValid =
    tokenArtifact !== null &&
    bindingValid("tokenTimeline") &&
    requestValid &&
    tokenArtifact.sourceMediaSha256 ===
      input.sourceIdentity.sourceMediaSha256 &&
    tokenArtifact.requestTimelineSemanticHash ===
      requestArtifact.semanticHash &&
    nativeHash(tokenArtifact, "semanticHash", true);
  if (tokenArtifact !== null) {
    for (const t of tokenArtifact.tokens) {
      const r = requests.get(t.requestId);
      const span = t.sourceGlobalInterval;
      const coordinateAgreement =
        span !== null &&
        t.sourceGlobalStartSample !== null &&
        t.sourceGlobalEndSample !== null &&
        Math.abs(span.start - t.sourceGlobalStartSample / t.sourceSampleRate) <=
          1 / t.sourceSampleRate &&
        Math.abs(span.end - t.sourceGlobalEndSample / t.sourceSampleRate) <=
          1 / t.sourceSampleRate;
      const sampleMappingMatches =
        r !== undefined &&
        t.decoderLocalStartSample !== null &&
        t.decoderLocalEndSample !== null &&
        Number.isSafeInteger(t.decoderLocalStartSample) &&
        Number.isSafeInteger(t.decoderLocalEndSample) &&
        t.decoderLocalStartSample >= 0 &&
        t.decoderLocalEndSample <= r.extractedSampleCount &&
        t.decoderLocalStartSample < t.decoderLocalEndSample &&
        t.sourceGlobalStartSample ===
          r.sourceGlobalStartSample +
            Number(
              (BigInt(t.decoderLocalStartSample) * BigInt(r.sourceSampleRate)) /
                BigInt(r.extractedSampleRate),
            ) &&
        t.sourceGlobalEndSample ===
          r.sourceGlobalStartSample +
            Number(
              (BigInt(t.decoderLocalEndSample) * BigInt(r.sourceSampleRate) +
                BigInt(r.extractedSampleRate) -
                1n) /
                BigInt(r.extractedSampleRate),
            );
      const verified =
        tokenValid &&
        t.trusted &&
        t.mappingStatus === "TRUSTED" &&
        nativeHash(t) &&
        r !== undefined &&
        nativeHash(r) &&
        r.mappingStatus === "VERIFIED" &&
        r.sourceSampleRate === t.sourceSampleRate &&
        r.sourceMediaSha256 === input.sourceIdentity.sourceMediaSha256 &&
        t.requestTimelineSemanticHash === r.semanticHash &&
        t.cacheIdentity === r.cacheIdentity &&
        t.parentTransformHashes.every((h) =>
          r.parentTransformHashes.includes(h),
        ) &&
        sampleMappingMatches &&
        coordinateAgreement &&
        span.start >= r.sourceGlobalStartSample / r.sourceSampleRate &&
        span.end <= r.sourceGlobalEndSample / r.sourceSampleRate;
      add(
        "tokenTimeline",
        { ...t, id: t.tokenId },
        "TRUSTED_MAPPED_TOKEN",
        span,
        verified,
        {
          speechPositive: t.lexical,
          lexicalPositive: t.lexical && t.text.trim().length > 0,
          providerFamily: "whisper",
          correlationGroup: `whisper:${t.requestId}`,
          rootLineageIds: [t.requestId],
          reliableLocalizedLexical: false,
        },
      );
    }
  } else {
    unavailableArtifactIds.push("tokenTimeline");
    for (const t of records(input.artifacts.tokenTimeline, "tokens"))
      add("tokenTimeline", t, "TRUSTED_MAPPED_TOKEN", rowInterval(t), false);
  }
  const generic = (
    key: keyof C60114MachineEvidenceArtifacts,
    rows: Record<string, unknown>[],
    family: C60114SourceEvidence["family"],
    providerFamily: string,
  ) => {
    if (input.artifacts[key] === undefined) {
      unavailableArtifactIds.push(key);
      return;
    }
    const bound = bindingValid(key);
    for (const row of rows) {
      const span = rowInterval(row);
      const explicitlyGlobal =
        row.coordinateSystem === "original-media-global" ||
        row.sourceTimebase === "SOURCE_GLOBAL_SECONDS" ||
        row.validatedSourceGlobal === true;
      const mappingUsable =
        row.timingUsable === true ||
        row.mappingStatus === "VERIFIED" ||
        row.mappingStatus === "TRUSTED";
      // Legacy raw/canonical segments have no timing proof; an artifact binding
      // proves provenance, not that an arbitrary row is locally timed speech.
      const verified = bound && explicitlyGlobal && mappingUsable;
      const text =
        typeof row.text === "string"
          ? row.text
          : typeof row.rawText === "string"
            ? row.rawText
            : "";
      const lexical = text.trim().length > 0;
      add(key, row, family, span, verified, {
        providerFamily,
        lexicalPositive: lexical,
        speechPositive:
          family !== "RAW_ASR_SEGMENT" && family !== "CANDIDATE_PROVENANCE",
        reliableLocalizedLexical:
          lexical &&
          row.textLocalizationValidated === true &&
          row.lexicalReliabilityVerified === true,
        sceneIds: typeof row.sceneId === "string" ? [row.sceneId] : [],
        speakerIds: typeof row.speakerId === "string" ? [row.speakerId] : [],
      });
    }
  };
  generic(
    "decodedSegments",
    records(input.artifacts.decodedSegments, "decodedSegmentIntervals"),
    "DECODED_SEGMENT",
    "whisper",
  );
  generic(
    "canonicalSegments",
    records(input.artifacts.canonicalSegments, "rawSegments"),
    "RAW_ASR_SEGMENT",
    "whisper",
  );
  generic(
    "rawTranscription",
    records(input.artifacts.rawTranscription, "segments"),
    "RAW_ASR_SEGMENT",
    "whisper",
  );
  generic(
    "candidateEvidence",
    records(input.artifacts.candidateEvidence, "candidates"),
    "CANDIDATE_PROVENANCE",
    "whisper",
  );
  // Candidate windows themselves stay quarantined. A separate derivative may
  // use only the literal candidate substring covered by already trusted,
  // cue-associated mapped tokens; it inherits their request correlation roots.
  if (
    tokenArtifact !== null &&
    tokenValid &&
    input.artifacts.candidateEvidence !== undefined &&
    bindingValid("candidateEvidence")
  ) {
    const verifiedEvidence = new Set(
      evidence
        .filter(
          (e) =>
            e.mappingStatus === "VERIFIED" &&
            e.family === "TRUSTED_MAPPED_TOKEN",
        )
        .map((e) => e.evidenceId),
    );
    for (const candidate of records(
      input.artifacts.candidateEvidence,
      "candidates",
    )) {
      const candidateId =
        typeof candidate.cueId === "string"
          ? candidate.cueId
          : typeof candidate.candidateId === "string"
            ? candidate.candidateId
            : null;
      const text =
        typeof candidate.text === "string"
          ? normalizeCandidateText(candidate.text)
          : "";
      if (
        candidateId === null ||
        text.length < 2 ||
        strings(candidate.hardBlockReasons).length > 0 ||
        (typeof candidate.hallucinationRisk === "number" &&
          candidate.hallucinationRisk >= 0.8)
      )
        continue;
      const tokens = tokenArtifact.tokens
        .filter(
          (t) =>
            t.cueId === candidateId &&
            t.lexical &&
            t.sourceGlobalInterval !== null &&
            verifiedEvidence.has(
              c60114Id("evidence", {
                key: "tokenTimeline",
                rawId: t.tokenId,
                family: "TRUSTED_MAPPED_TOKEN",
              }),
            ),
        )
        .toSorted(
          (a, b) =>
            (a.sourceGlobalInterval?.start ?? 0) -
              (b.sourceGlobalInterval?.start ?? 0) ||
            a.tokenId.localeCompare(b.tokenId),
        );
      for (const requestId of uniqueC60114(tokens.map((t) => t.requestId))) {
        const localTokens = tokens.filter((t) => t.requestId === requestId);
        const spans = c60114Union(
          localTokens.flatMap((t) =>
            t.sourceGlobalInterval === null ? [] : [t.sourceGlobalInterval],
          ),
          0.25,
        );
        for (const sourceInterval of spans) {
          const members = localTokens.filter(
            (t) =>
              t.sourceGlobalInterval !== null &&
              c60114Intersection(t.sourceGlobalInterval, sourceInterval) !==
                null,
          );
          const normalizedSpan = normalizeCandidateText(
            members.map((t) => t.text).join(""),
          );
          if (normalizedSpan.length < 2 || !text.includes(normalizedSpan))
            continue;
          const tokenIds = uniqueC60114(members.map((t) => t.tokenId));
          const id = c60114Id("localized-candidate", {
            candidateId,
            requestId,
            sourceInterval,
            tokenIds,
          });
          add(
            "candidateEvidence",
            { id, requestId },
            "CANDIDATE_PROVENANCE",
            sourceInterval,
            true,
            {
              lexicalPositive: true,
              speechPositive: false,
              reliableLocalizedLexical: false,
              providerFamily: "whisper",
              correlationGroup: `whisper:${requestId}`,
              rootLineageIds: uniqueC60114([
                requestId,
                ...strings(candidate.sourceRequestIds),
              ]),
              reasons: [
                "LITERAL_CANDIDATE_SUBSTRING_LOCALIZED_BY_TRUSTED_CUE_ASSOCIATED_TOKENS",
                "CANDIDATE_ENVELOPE_NOT_USED_AS_LOCAL_TIMING",
              ],
            },
          );
          const derivedId = c60114Id("evidence", {
            key: "candidateEvidence",
            rawId: id,
            family: "CANDIDATE_PROVENANCE",
          });
          candidateLocalizations.push({
            candidateId,
            sourceInterval,
            targetAnchorIds: [candidateId, ...tokenIds],
            evidenceIds: [
              derivedId,
              ...members.map((t) =>
                c60114Id("evidence", {
                  key: "tokenTimeline",
                  rawId: t.tokenId,
                  family: "TRUSTED_MAPPED_TOKEN",
                }),
              ),
            ].toSorted(),
            rootLineageIds: uniqueC60114([
              requestId,
              ...strings(candidate.sourceRequestIds),
            ]),
          });
        }
      }
    }
  }
  const speaker = record(input.artifacts.speakerEvidence);
  generic(
    "speakerEvidence",
    [
      ...records(speaker, "activityIntervals"),
      ...records(speaker, "segments"),
      ...records(speaker.run, "segments"),
    ],
    "SPEAKER_ACTIVITY",
    "speaker-acoustic-model",
  );
  if (input.artifacts.acousticScenes === undefined)
    unavailableArtifactIds.push("acousticScenes");
  else {
    const bound = bindingValid("acousticScenes");
    for (const scene of records(input.artifacts.acousticScenes, "scenes")) {
      const confidence =
        typeof scene.confidence === "number"
          ? Math.max(0, Math.min(1, scene.confidence))
          : 0;
      const dialogue = [
        "clean-dialogue",
        "quiet-dialogue",
        "noisy-dialogue",
      ].includes(String(scene.label));
      const contradiction = ["non-speech", "singing"].includes(
        String(scene.label),
      );
      add(
        "acousticScenes",
        scene,
        "ACOUSTIC_SCENE",
        rowInterval(scene),
        bound,
        {
          providerFamily: "acoustic-scene-analysis",
          correlationGroup: "acoustic-scene-analysis",
          speechPositive: dialogue && confidence >= 0.8,
          contradiction: contradiction && confidence >= 0.8,
          strength: confidence,
          sceneIds: typeof scene.id === "string" ? [scene.id] : [],
        },
      );
    }
  }
  return {
    evidence: evidence.toSorted((a, b) =>
      a.evidenceId.localeCompare(b.evidenceId),
    ),
    unavailableArtifactIds: uniqueC60114(unavailableArtifactIds),
    candidateLocalizations: candidateLocalizations.toSorted(
      (a, b) =>
        a.candidateId.localeCompare(b.candidateId) ||
        a.sourceInterval.start - b.sourceInterval.start ||
        a.sourceInterval.end - b.sourceInterval.end,
    ),
  };
}

/** Shared requests OR shared model families form one transitive vote group. */
export function c60114IndependentGroups(
  evidence: readonly C60114SourceEvidence[],
): string[] {
  const rows = evidence
    .filter(
      (e) =>
        e.mappingStatus === "VERIFIED" &&
        (e.speechPositive || e.lexicalPositive) &&
        !e.contradiction,
    )
    .toSorted((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    const p = parent[i] ?? i;
    if (p === i) return i;
    return (parent[i] = find(p));
  };
  const seen = new Map<string, number>();
  rows.forEach((e, i) => {
    for (const id of [
      `provider:${e.providerFamily}`,
      `correlation:${e.correlationGroup}`,
      ...e.rootLineageIds.map((r) => `root:${r}`),
    ]) {
      const p = seen.get(id);
      if (p === undefined) seen.set(id, i);
      else parent[find(i)] = find(p);
    }
  });
  const groups = new Map<number, string[]>();
  rows.forEach((e, i) => {
    const p = find(i);
    groups.set(p, [...(groups.get(p) ?? []), e.evidenceId]);
  });
  return [...groups.values()]
    .map((ids) => c60114Id("independent", ids.toSorted()))
    .toSorted();
}
export function c60114IslandForInterval(input: {
  sourceInterval: C60114Interval;
  evidence: readonly C60114SourceEvidence[];
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  parentGapIds?: string[];
  itemIds?: string[];
  boundaries?: readonly C60114Boundary[];
}): C60114SpeechIsland {
  const rows = input.evidence.filter(
    (e) =>
      e.mappingStatus === "VERIFIED" &&
      e.sourceInterval !== null &&
      c60114Intersection(e.sourceInterval, input.sourceInterval) !== null,
  );
  const positive = rows.filter((e) => e.speechPositive || e.lexicalPositive);
  const seconds = input.sourceInterval.end - input.sourceInterval.start;
  const contradiction = rows.some(
    (e) =>
      e.contradiction &&
      e.strength >= input.policy.speech.strongContradictionThreshold &&
      e.sourceInterval !== null &&
      c60114Coverage(input.sourceInterval, [e.sourceInterval]) >= 0.5,
  );
  const roots = uniqueC60114(positive.flatMap((e) => e.rootLineageIds));
  const allEvidenceIds = uniqueC60114(rows.map((e) => e.evidenceId));
  const lexical = rows.filter(
    (e) =>
      e.lexicalPositive &&
      e.sourceInterval !== null &&
      c60114Coverage(e.sourceInterval, [input.sourceInterval]) >= 0.5,
  );
  const durationStatus =
    seconds < input.policy.speech.minSeconds
      ? ("TOO_SHORT" as const)
      : seconds > input.policy.speech.maxSeconds
        ? ("TOO_LONG" as const)
        : ("BOUNDED" as const);
  const parentGapIds = uniqueC60114(input.parentGapIds ?? []);
  const itemIds = uniqueC60114(input.itemIds ?? []);
  const core = {
    islandId: c60114Id("speech-island", {
      source: input.sourceIdentity,
      interval: input.sourceInterval,
      parentGapIds,
    }),
    parentGapIds,
    itemIds,
    sourceInterval: input.sourceInterval,
    evidenceIds: allEvidenceIds,
    rootLineageIds: roots.length
      ? roots
      : uniqueC60114(rows.flatMap((e) => e.rootLineageIds)),
    correlationGroups: uniqueC60114(rows.map((e) => e.correlationGroup)),
    independentSourceCount: c60114IndependentGroups(positive).length,
    lexicalEvidenceIds: lexical.map((e) => e.evidenceId).toSorted(),
    reliableLocalizedLexical: lexical.some(
      (e) =>
        e.reliableLocalizedLexical &&
        e.sourceInterval !== null &&
        c60114Coverage(input.sourceInterval, [e.sourceInterval]) >=
          input.policy.orphanCoverageThreshold,
    ),
    speechPositive: rows.some((e) => e.speechPositive),
    strongContradiction: contradiction,
    localizationStatus:
      durationStatus === "BOUNDED"
        ? ("VERIFIED" as const)
        : ("UNRESOLVED" as const),
    durationStatus,
    sceneIds: uniqueC60114(rows.flatMap((e) => e.sceneIds)),
    speakerIds: uniqueC60114(rows.flatMap((e) => e.speakerIds)),
    splitBoundaryIds: uniqueC60114(
      (input.boundaries ?? [])
        .filter(
          (b) =>
            b.at === input.sourceInterval.start ||
            b.at === input.sourceInterval.end,
        )
        .map((b) => b.boundaryId),
    ),
    reasons: [
      "SPEECH_EVIDENCE_LOCALIZED_WITHOUT_PARENT_GAP_CREDIT",
      ...(durationStatus !== "BOUNDED"
        ? [`ISLAND_${durationStatus}_REMAINS_UNRESOLVED`]
        : []),
      ...(contradiction ? ["STRONG_ACOUSTIC_CONTRADICTION"] : []),
    ],
  };
  return withC60114SemanticHash(core);
}

export function buildC60114SourceGlobalSpeechIslands(input: {
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  evidence: readonly C60114SourceEvidence[];
  parentGaps: readonly C60114ParentGap[];
  boundaries?: readonly C60114Boundary[];
  finalCues?: readonly ({ id: string } & C60114Interval)[];
  unavailableArtifactIds?: readonly string[];
}): C60114SpeechIslands {
  const header = c60114ArtifactHeader(input.policy, input.sourceIdentity);
  const sourceHash = machineQualitySemanticHash(input.sourceIdentity);
  const unique = new Map<string, C60114SourceEvidence>();
  for (const raw of input.evidence) {
    const e = c60114SourceEvidenceSchema.parse(raw);
    const { semanticHash, ...core } = e;
    if (machineQualitySemanticHash(core) !== semanticHash)
      throw new Error("C60114_EVIDENCE_HASH_MISMATCH");
    if (
      e.mappingStatus === "VERIFIED" &&
      (e.sourceIdentityHash !== sourceHash ||
        e.sourceInterval === null ||
        e.sourceInterval.end > input.sourceIdentity.durationSeconds)
    )
      throw new Error("C60114_EVIDENCE_SOURCE_IDENTITY_MISMATCH");
    const previous = unique.get(e.evidenceId);
    if (previous && previous.semanticHash !== e.semanticHash)
      throw new Error("C60114_CONFLICTING_EVIDENCE_ID");
    unique.set(e.evidenceId, e);
  }
  const evidence = [...unique.values()].toSorted((a, b) =>
    a.evidenceId.localeCompare(b.evidenceId),
  );
  const parentGaps = input.parentGaps
    .map((g) => c60114ParentGapSchema.parse(g))
    .toSorted((a, b) => a.gapId.localeCompare(b.gapId));
  for (const g of parentGaps)
    if (g.sourceInterval.end > input.sourceIdentity.durationSeconds)
      throw new Error("C60114_PARENT_GAP_OUT_OF_SOURCE");
  const bounds: C60114Boundary[] = (input.boundaries ?? []).map((b) => {
    c60114BoundarySchema.parse(b);
    assertC60114SourceIdentity(b.sourceIdentity, input.sourceIdentity);
    return b;
  });
  for (const cue of input.finalCues ?? []) {
    c60114IntervalSchema.parse({ start: cue.start, end: cue.end });
    for (const at of [cue.start, cue.end])
      bounds.push({
        boundaryId: c60114Id("cue-boundary", { id: cue.id, at }),
        at,
        kind: "CUE",
        sourceIdentity: input.sourceIdentity,
        verified: true,
      });
  }
  const silences = evidence
    .filter(
      (e) =>
        e.mappingStatus === "VERIFIED" &&
        e.family === "SILENCE" &&
        e.sourceInterval !== null,
    )
    .flatMap((e) => (e.sourceInterval === null ? [] : [e.sourceInterval]));
  for (const e of evidence.filter(
    (e) =>
      e.mappingStatus === "VERIFIED" &&
      ["SILENCE", "ACOUSTIC_SCENE", "SPEAKER_ACTIVITY"].includes(e.family) &&
      e.sourceInterval !== null,
  )) {
    if (e.sourceInterval === null) continue;
    for (const at of [e.sourceInterval.start, e.sourceInterval.end])
      bounds.push({
        boundaryId: c60114Id("evidence-boundary", { id: e.evidenceId, at }),
        at,
        kind:
          e.family === "SILENCE"
            ? "SILENCE"
            : e.family === "ACOUSTIC_SCENE"
              ? "SCENE"
              : "SPEAKER",
        sourceIdentity: input.sourceIdentity,
        verified: true,
      });
  }
  const boundaries = [
    ...new Map(bounds.map((b) => [b.boundaryId, b])).values(),
  ].toSorted((a, b) => a.at - b.at || a.boundaryId.localeCompare(b.boundaryId));
  const speech = evidence
    .filter(
      (e) =>
        e.mappingStatus === "VERIFIED" &&
        e.speechPositive &&
        e.family !== "ACOUSTIC_SCENE" &&
        e.sourceInterval !== null,
    )
    .flatMap((e) => (e.sourceInterval === null ? [] : [e.sourceInterval]));
  // Use only real silence/cue/scene/speaker boundaries. An overlong remainder
  // stays unresolved; no equal-time fallback fabricates utterance boundaries.
  const merged = c60114Union(
    speech,
    input.policy.speech.mergeGapSeconds,
  ).flatMap((v) => c60114Subtract(v, silences));
  const globalIntervals = merged
    .flatMap((v) => {
      const cuts = uniqueC60114(
        boundaries
          .filter((b) => b.at > v.start && b.at < v.end)
          .map((b) => String(b.at)),
      )
        .map(Number)
        .toSorted((a, b) => a - b);
      const points = [v.start, ...cuts, v.end];
      return points.slice(1).flatMap((end, i) => {
        const start = points[i];
        return start === undefined ? [] : [{ start, end }];
      });
    })
    .filter((v) => c60114Coverage(v, speech) > 0);
  const globalIslands = globalIntervals
    .map((sourceInterval) =>
      c60114IslandForInterval({
        ...input,
        evidence,
        sourceInterval,
        boundaries,
      }),
    )
    .toSorted(
      (a, b) =>
        a.sourceInterval.start - b.sourceInterval.start ||
        a.islandId.localeCompare(b.islandId),
    );
  const islands = parentGaps
    .flatMap((g) =>
      globalIslands.flatMap((island) => {
        const span = c60114Intersection(
          g.sourceInterval,
          island.sourceInterval,
        );
        return span
          ? [
              c60114IslandForInterval({
                ...input,
                evidence,
                sourceInterval: span,
                parentGapIds: [g.gapId],
                itemIds: g.itemIds,
                boundaries,
              }),
            ]
          : [];
      }),
    )
    .toSorted(
      (a, b) =>
        a.sourceInterval.start - b.sourceInterval.start ||
        a.islandId.localeCompare(b.islandId),
    );
  return c60114SpeechIslandsSchema.parse(
    withC60114SemanticHash({
      ...header,
      artifactType: "source-global-speech-islands",
      parentGaps,
      islands,
      globalIslands,
      boundaries,
      audit: {
        evidence,
        verifiedCount: evidence.filter((e) => e.mappingStatus === "VERIFIED")
          .length,
        quarantinedCount: evidence.filter(
          (e) => e.mappingStatus === "QUARANTINED",
        ).length,
        duplicateInputCount: input.evidence.length - evidence.length,
        unavailableArtifactIds: uniqueC60114(
          input.unavailableArtifactIds ?? [],
        ),
      },
      summary: {
        islandCount: islands.length,
        globalIslandCount: globalIslands.length,
        unresolvedParentCount: parentGaps.filter(
          (g) => !islands.some((i) => i.parentGapIds.includes(g.gapId)),
        ).length,
        tooShortCount: islands.filter((i) => i.durationStatus === "TOO_SHORT")
          .length,
        tooLongCount: islands.filter((i) => i.durationStatus === "TOO_LONG")
          .length,
        parentGapSpeechEvidenceCount: 0,
      },
    }),
  );
}
