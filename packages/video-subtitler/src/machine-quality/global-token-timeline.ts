import {
  c6012PolicyVersion,
  machineGlobalTokenTimelineSchema,
  type AsrRequestTimelineContract,
  type GlobalTokenTimelineMode,
  type MachineGlobalTokenTimeline,
  type SubtitleCue,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

function validInterval(start: number, end: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function buildGlobalTokenTimeline(input: {
  cues: readonly SubtitleCue[];
  requestContract: AsrRequestTimelineContract;
  mode: GlobalTokenTimelineMode;
  generatedAt?: string;
}): MachineGlobalTokenTimeline {
  const contracts = new Map(
    input.requestContract.requests.flatMap((request) =>
      [request.requestId, ...request.requestAliases].map(
        (requestId) => [requestId, request] as const,
      ),
    ),
  );
  const lastMappedEndByRequest = new Map<string, number>();
  const tokens = input.cues.flatMap((cue) => {
    const requestIds = cue.provenance?.sourceRequestIds ?? [];
    const requestId = requestIds.length === 1 ? requestIds[0] : undefined;
    const contract =
      requestId === undefined ? undefined : contracts.get(requestId);
    return (cue.timingEvidence?.tokens ?? []).map((token, tokenIndex) => {
      const trustedContract = contract?.contractStatus === "verified";
      const localStart =
        contract === undefined
          ? null
          : token.start - contract.extractedInterval.start;
      const localEnd =
        contract === undefined
          ? null
          : token.end - contract.extractedInterval.start;
      const withinExtractedAudio =
        contract !== undefined &&
        localStart !== null &&
        localEnd !== null &&
        localStart >= -0.05 &&
        localEnd <= contract.extractedAudioDurationSeconds + 0.05 &&
        validInterval(localStart, localEnd);
      const lexical = normalizeCandidateText(token.text) !== "";
      const tentativeGlobalStart =
        trustedContract && localStart !== null
          ? contract.extractedInterval.start + Math.max(0, localStart)
          : null;
      const tentativeGlobalEnd =
        trustedContract && localEnd !== null
          ? contract.extractedInterval.start + localEnd
          : null;
      const segmentContained =
        tentativeGlobalStart !== null &&
        tentativeGlobalEnd !== null &&
        tentativeGlobalStart >= cue.start - 0.05 &&
        tentativeGlobalEnd <= cue.end + 0.05;
      const previousEnd =
        requestId === undefined
          ? undefined
          : lastMappedEndByRequest.get(requestId);
      const monotonic =
        previousEnd === undefined ||
        tentativeGlobalStart === null ||
        tentativeGlobalStart >= previousEnd - 0.05;
      const trusted =
        input.mode !== "off" &&
        trustedContract &&
        withinExtractedAudio &&
        segmentContained &&
        monotonic &&
        lexical &&
        token.probability !== null &&
        token.probability !== undefined &&
        token.probability >= 0.45;
      const globalStart = trusted ? tentativeGlobalStart : null;
      const globalEnd = trusted ? tentativeGlobalEnd : null;
      if (trusted && requestId !== undefined && globalEnd !== null) {
        lastMappedEndByRequest.set(requestId, globalEnd);
      }
      const failureReason = trusted
        ? null
        : contract === undefined
          ? ("missing-request-contract" as const)
          : contract.vadEnabled
            ? ("ambiguous-time-base" as const)
            : !withinExtractedAudio
              ? ("out-of-request" as const)
              : !segmentContained
                ? ("segment-containment-failure" as const)
                : !monotonic
                  ? ("non-monotonic" as const)
                  : ("invalid-token-time" as const);
      return {
        tokenId: `global-token:${cue.id}:${String(tokenIndex + 1).padStart(4, "0")}`,
        cueId: cue.id,
        requestId: requestId ?? `unresolved-request:${cue.id}`,
        text: token.text,
        localInterval:
          localStart !== null &&
          localEnd !== null &&
          validInterval(localStart, localEnd)
            ? { start: Math.max(0, localStart), end: localEnd }
            : null,
        globalInterval:
          globalStart !== null &&
          globalEnd !== null &&
          validInterval(globalStart, globalEnd)
            ? { start: globalStart, end: globalEnd }
            : null,
        coordinateSystem: trusted
          ? ("original-media-global" as const)
          : (contract?.coordinateSystem ?? ("unknown" as const)),
        mappingMethod: trusted
          ? ("verified-extraction-offset" as const)
          : contract?.vadEnabled === true
            ? ("quarantined-vad-token" as const)
            : ("unmapped" as const),
        trustScore: trusted ? 0.95 : 0,
        trusted,
        mappingStatus: trusted
          ? ("TRUSTED" as const)
          : contract?.vadEnabled === true
            ? ("UNTRUSTED" as const)
            : ("UNMAPPED" as const),
        failureReason,
        reasons: trusted
          ? [
              "request-timeline-contract-verified",
              "token-contained-in-extracted-audio",
              "no-vad-coordinate-preserved",
              "lexical-token-probability-passed",
            ]
          : [
              contract === undefined
                ? "request-timeline-contract-missing"
                : contract.vadEnabled
                  ? "vad-token-coordinate-quarantined"
                  : "token-containment-or-probability-failed",
            ],
      };
    });
  });
  const semanticHash = machineQualitySemanticHash(tokens);
  const mappingFailureReasons = tokens.reduce<Record<string, number>>(
    (counts, token) => {
      if (token.failureReason !== null) {
        counts[token.failureReason] = (counts[token.failureReason] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const requestIdsWithTokens = new Set(tokens.map((token) => token.requestId));
  const cueIdsWithTokens = new Set(tokens.map((token) => token.cueId));
  const trustedCueIds = new Set(
    tokens.filter((token) => token.trusted).map((token) => token.cueId),
  );
  return machineGlobalTokenTimelineSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6012PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-global-token-timeline",
    mode: input.mode,
    requestContractSemanticHash: input.requestContract.semanticHash,
    tokens,
    summary: {
      tokenCount: tokens.length,
      lexicalTokenCount: tokens.filter(
        (token) => normalizeCandidateText(token.text) !== "",
      ).length,
      trustedMappedTokenCount: tokens.filter((token) => token.trusted).length,
      quarantinedVadTokenCount: tokens.filter(
        (token) => token.mappingMethod === "quarantined-vad-token",
      ).length,
      unmappedTokenCount: tokens.filter(
        (token) => token.mappingMethod === "unmapped",
      ).length,
      trustedRequestCount: new Set(
        tokens.filter((token) => token.trusted).map((token) => token.requestId),
      ).size,
      rawTokenCount: tokens.length,
      mappedTokenCount: tokens.filter((token) => token.globalInterval !== null)
        .length,
      cautionTokenCount: 0,
      rejectedTokenCount: tokens.filter((token) => !token.trusted).length,
      mappingFailureReasons,
      requestCoverage:
        input.requestContract.requests.length === 0
          ? 0
          : input.requestContract.requests.filter((request) =>
              requestIdsWithTokens.has(request.requestId),
            ).length / input.requestContract.requests.length,
      cueCoverage:
        cueIdsWithTokens.size === 0
          ? 0
          : trustedCueIds.size / cueIdsWithTokens.size,
    },
    semanticHash,
  });
}
