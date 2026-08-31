import { createHash } from "node:crypto";
import {
  c612IdentityRowSchema,
  c612IdentitySchema,
  c612ReconciliationSchema,
  c612CorrelationAuditSchema,
  type C612Identity,
  type C61Hypothesis,
  type C611CorrelationObservation,
} from "@mvl/shared";
import { artifact, hash, ratio, c612Defined } from "./c612-policy.js";
export interface CorePcmSource {
  pcm: Buffer;
  sampleRate: number;
  streamIdentity: string;
  channelMixPolicy: string;
  sourceMediaHash: string;
}
export function recoverIdentity(
  candidate: C61Hypothesis,
  sourceMediaHash: string,
  metadata: C611CorrelationObservation | undefined,
  pcm?: CorePcmSource,
): C612Identity {
  if (!candidate.eventId) throw new Error("C612_IDENTITY_EVENT_REQUIRED");
  const explicitCore = metadata?.coreInterval ?? null;
  const interval = explicitCore ?? candidate.sourceInterval;
  const rate = pcm?.sampleRate ?? 16000;
  const start = interval ? Math.round(interval.start * rate) : null,
    end = interval ? Math.round(interval.end * rate) : null;
  // A candidate's decoder/segment interval alone is not proof of its ASR core PCM.
  const verified = !!(
    explicitCore &&
    metadata?.requestId &&
    metadata.metadataEvidenceHashes.length &&
    pcm?.sourceMediaHash === sourceMediaHash &&
    start !== null &&
    end !== null &&
    start >= 0 &&
    end > start &&
    end * 2 <= pcm.pcm.length
  );
  const coreAudioHash = verified
    ? createHash("sha256")
        .update(pcm.pcm.subarray(start * 2, end * 2))
        .digest("hex")
    : null;
  const sourceAudioStreamIdentity = pcm?.streamIdentity ?? null;
  const modelRevision =
    candidate.providerFamily === "CURRENT"
      ? null
      : (metadata?.modelIdentity ?? candidate.modelIdentity);
  const coreIdentity = interval
    ? hash([
        sourceMediaHash,
        sourceAudioStreamIdentity,
        rate,
        start,
        end,
        pcm?.channelMixPolicy ?? null,
        coreAudioHash,
      ])
    : null;
  const decode = metadata?.decodeConfigurationHash ?? null,
    prompt = metadata?.promptPolicyHash ?? null;
  // Incomplete configuration does not create a pretend independent observation.
  const observationIdentity =
    candidate.providerFamily !== "CURRENT" &&
    coreIdentity &&
    modelRevision &&
    decode &&
    prompt &&
    metadata?.requestAudioSha256
      ? hash([
          candidate.providerFamily,
          modelRevision,
          coreIdentity,
          metadata.requestAudioSha256,
          decode,
          prompt,
        ])
      : null;
  const missing = [
    !explicitCore && "explicitCoreInterval",
    !verified && "verifiedCorePcm",
    !sourceAudioStreamIdentity && "sourceAudioStreamIdentity",
    !decode && "decodeConfigHash",
    !prompt && "promptHash",
    !modelRevision && "modelRevision",
  ].filter((x): x is string => !!x);
  return c612IdentityRowSchema.parse({
    eventId: candidate.eventId,
    candidateId: candidate.candidateId,
    sourceMediaHash,
    sourceAudioStreamIdentity,
    requestedInterval: metadata?.requestInterval ?? null,
    extractedInterval: metadata?.requestInterval ?? null,
    coreInterval: interval,
    sourceSampleStart: start,
    sourceSampleEnd: end,
    sampleRate: rate,
    channelMixPolicy: pcm?.channelMixPolicy ?? null,
    coreAudioHash,
    providerFamily: candidate.providerFamily,
    modelId: candidate.modelIdentity,
    modelRevision,
    decodeConfigHash: decode,
    promptHash: prompt,
    requestId: metadata?.requestId ?? candidate.requestId,
    parentRequestId: null,
    windowLineage: [
      ...new Set([
        candidate.windowType,
        ...(metadata ? [metadata.legacyCorrelationGroupId] : []),
      ]),
    ].sort(),
    cacheIdentity: metadata?.requestAudioSha256 ?? null,
    identityStatus: verified
      ? "VERIFIED_CORE_PCM_IDENTITY"
      : interval
        ? "PROVISIONAL_INTERVAL_IDENTITY"
        : "UNKNOWN_IDENTITY",
    observationIdentity,
    coreIdentity,
    evidenceHashes: metadata?.metadataEvidenceHashes ?? [],
    missing,
  });
}
export function identityRelationship(a: C612Identity, b: C612Identity) {
  if (a.observationIdentity && a.observationIdentity === b.observationIdentity)
    return "SAME_ACOUSTIC_OBSERVATION" as const;
  if (
    a.coreAudioHash &&
    a.coreAudioHash === b.coreAudioHash &&
    a.providerFamily !== b.providerFamily
  )
    return "SAME_CORE_DIFFERENT_PROVIDER" as const;
  if (
    a.identityStatus === "UNKNOWN_IDENTITY" ||
    b.identityStatus === "UNKNOWN_IDENTITY"
  )
    return "UNKNOWN_CORRELATION" as const;
  if (
    a.identityStatus !== "VERIFIED_CORE_PCM_IDENTITY" ||
    b.identityStatus !== "VERIFIED_CORE_PCM_IDENTITY"
  )
    return "PROVISIONAL_IDENTITY" as const;
  if (
    a.providerFamily === b.providerFamily &&
    a.coreAudioHash === b.coreAudioHash &&
    a.decodeConfigHash !== b.decodeConfigHash
  )
    return "SAME_PROVIDER_DIFFERENT_DECODE" as const;
  if (
    a.coreInterval &&
    b.coreInterval &&
    a.coreInterval.start < b.coreInterval.end &&
    b.coreInterval.start < a.coreInterval.end
  )
    return "OVERLAPPING_AUDIO_OBSERVATION" as const;
  if (a.providerFamily === b.providerFamily)
    return "SAME_PROVIDER_DIFFERENT_WINDOW" as const;
  return "DISTINCT_ACOUSTIC_OBSERVATION" as const;
}
export function reconcileIdentities(
  input: readonly C612Identity[],
  scope: string[],
) {
  const rows = input
    .filter((r) => scope.includes(r.candidateId))
    .toSorted((a, b) => a.candidateId.localeCompare(b.candidateId));
  const identity = c612IdentitySchema.parse(
    artifact("machine-c6-1-2-candidate-correlation-identity", {
      rows,
      topKScopeCandidateIds: scope.toSorted(),
      runtimeGoldInputCount: 0,
    }),
  );
  const pairs = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = c612Defined(rows[i]),
        b = c612Defined(rows[j]);
      if (a.providerFamily === "CURRENT" || b.providerFamily === "CURRENT")
        continue;
      if (
        a.eventId !== b.eventId &&
        !(a.coreIdentity && a.coreIdentity === b.coreIdentity)
      )
        continue;
      pairs.push({
        leftCandidateId: a.candidateId,
        rightCandidateId: b.candidateId,
        relationship: identityRelationship(a, b),
      });
    }
  const keys = [
    ...new Set(
      rows.map((r) => r.observationIdentity).filter((x): x is string => !!x),
    ),
  ].sort();
  const observationGroups = keys.map((observationIdentity) => ({
    observationIdentity,
    candidateIds: rows
      .filter((r) => r.observationIdentity === observationIdentity)
      .map((r) => r.candidateId),
    voteWeight: 1 as const,
  }));
  const reconciliation = c612ReconciliationSchema.parse(
    artifact("machine-c6-1-2-same-audio-reconciliation", {
      identityHash: identity.semanticHash,
      pairs,
      observationGroups,
      sameAudioGroupsReconciled: observationGroups.filter(
        (g) => g.candidateIds.length > 1,
      ).length,
      duplicateVotesPrevented: observationGroups.reduce(
        (n, g) => n + Math.max(0, g.candidateIds.length - 1),
        0,
      ),
      sameCoreCrossProviderCount: pairs.filter(
        (p) => p.relationship === "SAME_CORE_DIFFERENT_PROVIDER",
      ).length,
      doubleCount: 0,
    }),
  );
  const verified = rows.filter(
      (r) => r.identityStatus === "VERIFIED_CORE_PCM_IDENTITY",
    ).length,
    provisional = rows.filter(
      (r) => r.identityStatus === "PROVISIONAL_INTERVAL_IDENTITY",
    ).length;
  return {
    identity,
    reconciliation,
    audit: c612CorrelationAuditSchema.parse(
      artifact("machine-c6-1-2-correlation-audit", {
        identityHash: identity.semanticHash,
        reconciliationHash: reconciliation.semanticHash,
        total: rows.length,
        verified,
        provisional,
        unknown: rows.length - verified - provisional,
        coverage: ratio(verified + provisional, rows.length),
        verifiedCoverage: ratio(verified, rows.length),
      }),
    ),
  };
}
