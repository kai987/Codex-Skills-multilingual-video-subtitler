import {
  machineVadGlobalTimebaseSchema,
  asrRequestTimelineContractV2Schema,
  machineGlobalTokenTimelineV2Schema,
  c60114LineageReconciliationSchema,
  c60114LineageStatusSchema,
  type C60114SourceEvidence,
  type C60114Policy,
  type C60114SourceIdentity,
  type C60114LineageReconciliation,
  type SampleTransform,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { composeSampleChain } from "../machine-quality/sample-transform-chain.js";
import {
  createC60114SourceEvidence,
  type C60114MachineEvidenceArtifacts,
} from "./source-global-speech-islands.js";
import {
  c60114ArtifactHeader,
  c60114Id,
  withC60114SemanticHash,
} from "./c60114-policy.js";

type Entry = C60114LineageReconciliation["entries"][number];
function nativeHash(value: object, header = false): boolean {
  const row = value as Record<string, unknown>;
  const omit = new Set([
    "semanticHash",
    ...(header
      ? ["schemaVersion", "policyVersion", "generatedAt", "artifactType"]
      : []),
  ]);
  return (
    row.semanticHash ===
    hash(Object.fromEntries(Object.entries(row).filter(([k]) => !omit.has(k))))
  );
}
function orderedChain(
  transforms: SampleTransform[],
  childHash: string,
): SampleTransform[] {
  const remaining = [...transforms],
    chain: SampleTransform[] = [];
  let expected = childHash;
  while (remaining.length) {
    const matches = remaining.filter((t) => t.childArtifactSha256 === expected);
    if (matches.length !== 1)
      throw new Error("AMBIGUOUS_OR_MISSING_PARENT_TRANSFORM");
    const t = matches[0];
    if (!t) throw new Error("MISSING_TRANSFORM");
    if (!t.verified || !nativeHash(t))
      throw new Error("TRANSFORM_HASH_OR_VERIFICATION_FAILED");
    chain.push(t);
    remaining.splice(remaining.indexOf(t), 1);
    expected = t.parentArtifactSha256;
  }
  return chain;
}

/** A cue-association failure is not necessarily a coordinate failure. Only an
 * existing verified integer sample chain may repair that distinction. */
export function reconcileC60114SourceGlobalLineage(input: {
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  evidence: readonly C60114SourceEvidence[];
  artifacts: C60114MachineEvidenceArtifacts;
  sourceAudioBindingVerified: boolean;
}) {
  const vadResult = machineVadGlobalTimebaseSchema.safeParse(
    input.artifacts.vadTimebase,
  );
  const reqResult = asrRequestTimelineContractV2Schema.safeParse(
    input.artifacts.requestTimeline,
  );
  const tokResult = machineGlobalTokenTimelineV2Schema.safeParse(
    input.artifacts.tokenTimeline,
  );
  const vad = vadResult.success ? vadResult.data : null,
    requests = reqResult.success ? reqResult.data : null,
    tokens = tokResult.success ? tokResult.data : null;
  const sourceHash = hash(input.sourceIdentity);
  const nativeValid =
    input.sourceAudioBindingVerified &&
    vad !== null &&
    requests !== null &&
    tokens !== null &&
    nativeHash(vad, true) &&
    nativeHash(requests, true) &&
    nativeHash(tokens, true) &&
    vad.sourceIdentity.sourceMediaSha256 ===
      input.sourceIdentity.sourceMediaSha256 &&
    vad.sourceIdentity.sourceReadOnlyVerified &&
    requests.sourceMediaSha256 === input.sourceIdentity.sourceMediaSha256 &&
    tokens.sourceMediaSha256 === input.sourceIdentity.sourceMediaSha256 &&
    requests.vadGlobalTimebaseSemanticHash === vad.semanticHash &&
    tokens.requestTimelineSemanticHash === requests.semanticHash;
  const tokenMap = new Map(
    (tokens?.tokens ?? []).map((t) => [
      c60114Id("evidence", {
        key: "tokenTimeline",
        rawId: t.tokenId,
        family: "TRUSTED_MAPPED_TOKEN",
      }),
      t,
    ]),
  );
  const requestMap = new Map(
    (requests?.requests ?? []).map((r) => [r.requestId, r]),
  );
  const transforms = new Map(
    (vad?.parentChildTransforms ?? []).map((t) => [t.semanticHash, t]),
  );
  const nonMonotonic = new Set<string>();
  const previous = new Map<string, { start: number; end: number }>();
  for (const t of tokens?.tokens ?? []) {
    if (
      !["TRUSTED", "ASSOCIATION_PENDING"].includes(t.mappingStatus) ||
      t.decoderLocalStartSample === null ||
      t.decoderLocalEndSample === null
    )
      continue;
    const p = previous.get(t.requestId);
    if (
      p &&
      (t.decoderLocalStartSample < p.start || t.decoderLocalEndSample < p.end)
    )
      nonMonotonic.add(t.tokenId);
    previous.set(t.requestId, {
      start: t.decoderLocalStartSample,
      end: t.decoderLocalEndSample,
    });
  }
  const outputEvidence: C60114SourceEvidence[] = [];
  const entries: Entry[] = [];
  for (const e of input.evidence) {
    if (!nativeHash(e))
      throw new Error("C60114_LINEAGE_INPUT_EVIDENCE_HASH_MISMATCH");
    const t = tokenMap.get(e.evidenceId),
      r = t ? requestMap.get(t.requestId) : undefined;
    const reasons: string[] = [];
    let status: Entry["status"] = "QUARANTINED_INSUFFICIENT_PROVENANCE";
    let recomputed: Entry["recomputedSourceInterval"] = null,
      drift: number | null = null;
    let chain: SampleTransform[] = [],
      eligibleSpeech = false,
      eligibleLexical = false;
    if (
      e.sourceInterval &&
      e.sourceInterval.end > input.sourceIdentity.durationSeconds
    ) {
      status = "OUT_OF_SOURCE_BOUNDS";
      reasons.push("CLAIMED_INTERVAL_OUT_OF_SOURCE_BOUNDS");
    } else if (e.mappingStatus === "VERIFIED") {
      if (e.sourceIdentityHash !== sourceHash)
        throw new Error("C60114_LINEAGE_VERIFIED_SOURCE_MISMATCH");
      status = "VERIFIED_EXISTING_TRANSFORM";
      recomputed = e.sourceInterval;
      drift = 0;
      eligibleSpeech = e.speechPositive;
      eligibleLexical = e.reliableLocalizedLexical;
      reasons.push(
        "ORIGINAL_ADAPTER_RECOMPUTED_NATIVE_IDENTITY_AND_SAMPLE_MAPPING",
      );
      if (r)
        chain = r.parentTransformHashes.flatMap((h) => {
          const v = transforms.get(h);
          return v ? [v] : [];
        });
    } else if (t) {
      if (
        !nativeValid ||
        !nativeHash(t) ||
        !r ||
        !nativeHash(r) ||
        r.mappingStatus !== "VERIFIED" ||
        t.requestTimelineSemanticHash !== r.semanticHash ||
        t.cacheIdentity !== r.cacheIdentity ||
        t.sourceSampleRate !== r.sourceSampleRate ||
        r.sourceMediaSha256 !== input.sourceIdentity.sourceMediaSha256
      ) {
        status = "QUARANTINED_CONFLICTING_TRANSFORM";
        reasons.push("NATIVE_TOKEN_REQUEST_OR_SOURCE_IDENTITY_UNVERIFIED");
      } else if (
        !["TRUSTED", "ASSOCIATION_PENDING"].includes(t.mappingStatus)
      ) {
        reasons.push(
          "TOKEN_ACOUSTIC_OR_TIMING_QUALITY_UNTRUSTED_NOT_REPAIRED_BY_COORDINATE_ARITHMETIC",
        );
      } else if (nonMonotonic.has(t.tokenId)) {
        status = "NON_MONOTONIC_MAPPING";
        reasons.push("PERSISTED_TOKEN_SEQUENCE_NOT_MONOTONIC");
      } else if (
        t.decoderLocalStartSample === null ||
        t.decoderLocalEndSample === null ||
        !t.lexical ||
        t.text.trim() === ""
      ) {
        reasons.push("MISSING_LEXICAL_TOKEN_INTEGER_BOUNDARIES");
      } else {
        try {
          const nativeTransforms = r.parentTransformHashes.map((h) =>
            transforms.get(h),
          );
          if (
            nativeTransforms.some((v) => v === undefined) ||
            nativeTransforms.length === 0
          )
            throw new Error("PARENT_SAMPLE_TRANSFORM_NOT_RETAINED");
          chain = orderedChain(
            nativeTransforms.filter(
              (v): v is SampleTransform => v !== undefined,
            ),
            r.extractedAudioSha256,
          );
          const leaf = chain[0],
            root = chain.at(-1);
          if (
            root?.parentArtifactSha256 !==
              input.sourceIdentity.sourceMediaSha256 ||
            root.parentSampleRate !== r.sourceSampleRate ||
            leaf?.childSampleRate !== r.extractedSampleRate ||
            leaf.childTotalSamples !== r.extractedSampleCount ||
            Math.abs(
              root.parentTotalSamples / root.parentSampleRate -
                input.sourceIdentity.durationSeconds,
            ) >
              1 / root.parentSampleRate ||
            t.parentTransformHashes.length === 0 ||
            t.parentTransformHashes.some(
              (h) => !r.parentTransformHashes.includes(h),
            )
          )
            throw new Error(
              "PARENT_CHILD_AUDIO_HASH_RATE_OR_SAMPLE_COUNT_MISMATCH",
            );
          const bounds = composeSampleChain({
            transforms: chain,
            localStartSample: 0,
            localEndSample: r.extractedSampleCount,
          });
          if (
            bounds.startSample !== r.sourceGlobalStartSample ||
            bounds.endSample !== r.sourceGlobalEndSample
          )
            throw new Error("REQUEST_EXTRACTION_SAMPLE_CHAIN_CONFLICT");
          const mapped = composeSampleChain({
            transforms: chain,
            localStartSample: t.decoderLocalStartSample,
            localEndSample: t.decoderLocalEndSample,
          });
          recomputed = {
            start: mapped.startSample / root.parentSampleRate,
            end: mapped.endSample / root.parentSampleRate,
          };
          drift = e.sourceInterval
            ? Math.max(
                Math.abs(recomputed.start - e.sourceInterval.start),
                Math.abs(recomputed.end - e.sourceInterval.end),
              )
            : null;
          if (recomputed.end > input.sourceIdentity.durationSeconds) {
            status = "OUT_OF_SOURCE_BOUNDS";
            reasons.push("RECOMPUTED_INTERVAL_OUT_OF_SOURCE");
          } else if (
            mapped.startSample !== t.sourceGlobalStartSample ||
            mapped.endSample !== t.sourceGlobalEndSample ||
            drift === null ||
            drift > 1 / root.parentSampleRate + 1e-8
          ) {
            status = "QUARANTINED_CONFLICTING_TRANSFORM";
            reasons.push(
              "STORED_SOURCE_COORDINATES_CONFLICT_WITH_INTEGER_SAMPLE_CHAIN",
            );
          } else {
            status = "VERIFIED_FROM_PARENT_SAMPLE_CHAIN";
            eligibleSpeech = true;
            // Correct source coordinates do not establish whole-candidate lexical localization.
            eligibleLexical = false;
            reasons.push(
              "PARENT_CHILD_AUDIO_HASHES_AND_REQUEST_EXTRACTION_VERIFIED",
              "INTEGER_RATIONAL_SAMPLE_CHAIN_RECOMPUTED",
              "CUE_ASSOCIATION_NOT_REQUIRED_FOR_SOURCE_SPEECH_ACTIVITY",
              "TOKEN_IS_NOT_WHOLE_CANDIDATE_LOCALIZATION",
            );
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "UNKNOWN_TRANSFORM_FAILURE";
          status = message.includes("NOT_RETAINED")
            ? "QUARANTINED_INSUFFICIENT_PROVENANCE"
            : "QUARANTINED_CONFLICTING_TRANSFORM";
          reasons.push(message);
        }
      }
    } else {
      reasons.push(
        e.family === "RAW_ASR_SEGMENT"
          ? "SEGMENT_HAS_NO_RETAINED_HASH_BOUND_INTEGER_PARENT_SAMPLE_CHAIN"
          : e.family === "ACOUSTIC_SCENE"
            ? "SCENE_AUDIO_SHA_NOT_BOUND_TO_SOURCE_MEDIA_SAMPLE_CHAIN"
            : "CANDIDATE_OR_CONTAINER_PROVENANCE_IS_NOT_LOCAL_TIMING_PROOF",
      );
    }
    const repaired =
      status === "VERIFIED_FROM_PARENT_SAMPLE_CHAIN" && recomputed !== null;
    const { semanticHash: previousHash, ...evidenceCore } = e;
    void previousHash;
    outputEvidence.push(
      repaired
        ? createC60114SourceEvidence({
            ...evidenceCore,
            sourceInterval: recomputed,
            mappingStatus: "VERIFIED",
            sourceIdentityHash: sourceHash,
            speechPositive: eligibleSpeech,
            lexicalPositive: eligibleSpeech,
            reliableLocalizedLexical: eligibleLexical,
            reasons: [
              ...e.reasons.filter(
                (s) => s !== "SOURCE_GLOBAL_COORDINATE_LINEAGE_UNVERIFIED",
              ),
              ...reasons,
            ],
          })
        : e,
    );
    entries.push(
      withC60114SemanticHash({
        evidenceId: e.evidenceId,
        originalStatus: e.mappingStatus,
        family: e.family,
        artifactId: e.artifactId,
        sourceIdentity: input.sourceIdentity,
        parentRequestIds: t
          ? [t.requestId]
          : e.rootLineageIds.filter((id) => requestMap.has(id)),
        transformChain: chain.map((t) => ({
          transformHash: t.semanticHash,
          parentArtifactSha256: t.parentArtifactSha256,
          childArtifactSha256: t.childArtifactSha256,
          parentSampleRate: t.parentSampleRate,
          childSampleRate: t.childSampleRate,
          parentStartSample: t.childStartSampleInParent,
          parentEndSample: t.childEndSampleInParent,
          childTotalSamples: t.childTotalSamples,
        })),
        expectedSourceInterval: e.sourceInterval,
        recomputedSourceInterval: recomputed,
        driftSeconds: drift,
        status,
        reasons,
        eligibleForSpeechIsland: eligibleSpeech,
        eligibleForLexicalLocalization: eligibleLexical,
        nativeSpeechObservation:
          e.speechPositive || Boolean(t?.lexical && t.text.trim()),
      }),
    );
  }
  entries.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const artifact = c60114LineageReconciliationSchema.parse(
    withC60114SemanticHash({
      ...c60114ArtifactHeader(input.policy, input.sourceIdentity),
      artifactType: "machine-source-global-lineage-reconciliation",
      inputEvidenceHash: hash(input.evidence),
      artifactHashes: Object.fromEntries(
        Object.entries(input.artifacts)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, hash(v)]),
      ),
      entries,
      summary: {
        originalVerifiedCount: input.evidence.filter(
          (e) => e.mappingStatus === "VERIFIED",
        ).length,
        originalQuarantinedCount: input.evidence.filter(
          (e) => e.mappingStatus === "QUARANTINED",
        ).length,
        newlyVerifiedCount: entries.filter(
          (e) => e.status === "VERIFIED_FROM_PARENT_SAMPLE_CHAIN",
        ).length,
        remainingQuarantinedCount: entries.filter(
          (e) => !e.status.startsWith("VERIFIED_"),
        ).length,
        statusCounts: Object.fromEntries(
          c60114LineageStatusSchema.options.map((s) => [
            s,
            entries.filter((e) => e.status === s).length,
          ]),
        ),
        sourceGlobalInferenceCount: 0,
        coordinateGuessCount: 0,
      },
    }),
  );
  return { artifact, evidence: outputEvidence };
}
