import {
  c612CompletenessSchema,
  c612CompletenessRowSchema,
  c612EdgeSchema,
  type C612Completeness,
  type C612CtcScore,
  type C612Identity,
} from "@mvl/shared";
import { artifact, hash, C612_POLICY, c612Defined } from "./c612-policy.js";
import {
  duration,
  intersect,
  unionIntervals,
  type Interval,
} from "./c612-structural.js";
export interface C612VadEvidence {
  intervals: Interval[];
  sourceIdentity: string;
  verified: boolean;
  evidenceHash: string;
}
export interface C612MappedSupport {
  candidateId: string;
  intervals: Interval[];
  coverage: number;
  evidenceHashes: string[];
}
export function candidateCompleteness(
  identity: C612Identity,
  ctc: C612CtcScore,
  vad: C612VadEvidence,
  mapped?: C612MappedSupport,
): C612Completeness {
  if (
    ctc.candidateId !== identity.candidateId ||
    ctc.eventId !== identity.eventId
  )
    throw new Error("C612_CTC_CANDIDATE_BINDING");
  const core = ctc.scoredInterval,
    p = C612_POLICY.completeness;
  const trustedVad =
    vad.verified && vad.sourceIdentity === identity.sourceMediaHash;
  const speech = core && trustedVad ? intersect(vad.intervals, core) : [];
  const ctcSpans =
    core && ctc.status === "SCORABLE"
      ? ctc.supportedTokens
          .filter((t) => t.posterior >= p.minimumTokenPosterior)
          .map((t) => ({
            start: core.start + t.start,
            end: core.start + t.end,
          }))
      : [];
  const ctcSupport =
    ctc.status === "SCORABLE" && ctc.tokenCount > 0
      ? ctcSpans.length / ctc.tokenCount
      : null;
  const useMapped =
    !!mapped &&
    mapped.candidateId === identity.candidateId &&
    mapped.coverage > (ctcSupport ?? 0);
  const tokenSpans = useMapped ? mapped.intervals : ctcSpans;
  const support = useMapped ? mapped.coverage : ctcSupport;
  const first = tokenSpans.length
      ? Math.min(...tokenSpans.map((t) => t.start))
      : null,
    last = tokenSpans.length ? Math.max(...tokenSpans.map((t) => t.end)) : null;
  const measurable =
    trustedVad &&
    !!core &&
    speech.length > 0 &&
    first !== null &&
    last !== null;
  const lead = measurable
    ? duration(intersect(speech, { start: core.start, end: first }))
    : null;
  const trail = measurable
    ? duration(intersect(speech, { start: last, end: core.end }))
    : null;
  const supportedIntervals = unionIntervals(
    tokenSpans.map((t) => ({
      start: t.start - p.tokenToleranceSeconds,
      end: t.end + p.tokenToleranceSeconds,
    })),
  );
  const covered = measurable
    ? speech.reduce((n, s) => n + duration(intersect(supportedIntervals, s)), 0)
    : null;
  const internal = measurable
    ? Math.max(
        0,
        duration(intersect(speech, { start: first, end: last })) -
          speech.reduce(
            (n, s) =>
              n +
              duration(
                intersect(supportedIntervals, {
                  start: Math.max(s.start, first),
                  end: Math.min(s.end, last),
                }),
              ),
            0,
          ),
      )
    : null;
  const left =
    first !== null && identity.requestedInterval
      ? first - identity.requestedInterval.start
      : null;
  const right =
    last !== null && identity.requestedInterval
      ? identity.requestedInterval.end - last
      : null;
  const contamination =
    measurable &&
    support !== null &&
    support >= p.minimumSupportedTokenFraction &&
    identity.requestedInterval
      ? Number(
          tokenSpans.some(
            (t) =>
              t.start < core.start - p.tokenToleranceSeconds ||
              t.end > core.end + p.tokenToleranceSeconds,
          ),
        )
      : null;
  let status: C612Completeness["acousticCompletenessStatus"] =
    "INSUFFICIENT_EVIDENCE";
  if (ctc.status === "UNSCORABLE") status = "UNSCORABLE";
  else if (measurable && support !== null) {
    const edge =
      (left !== null && left < p.minimumRequestEdgeDistance) ||
      (right !== null && right < p.minimumRequestEdgeDistance);
    if (contamination && edge) status = "BOTH_TRUNCATED_AND_CONTAMINATED";
    else if (contamination) status = "ADJACENT_CONTAMINATED";
    else if (c612Defined(lead) > p.maximumUncoveredEdgeSeconds)
      status = "PARTIAL_LEADING";
    else if (c612Defined(trail) > p.maximumUncoveredEdgeSeconds)
      status = "PARTIAL_TRAILING";
    else if (c612Defined(internal) > p.maximumInternalUncoveredSeconds)
      status = "PARTIAL_INTERNAL";
    else if (edge) status = "EDGE_TRUNCATED";
    else if (
      support >= p.minimumSupportedTokenFraction &&
      c612Defined(covered) / duration(speech) >= p.minimumSpeechCoverage
    )
      status =
        identity.identityStatus === "VERIFIED_CORE_PCM_IDENTITY" &&
        left !== null &&
        right !== null &&
        contamination === 0
          ? "VERIFIED_COMPLETE"
          : "LIKELY_COMPLETE";
  }
  const missing = [
    !trustedVad && "trustedVad",
    !core && "coreInterval",
    ctc.status !== "SCORABLE" && "candidateConditionedCtc",
    first === null && "supportedTokens",
    !identity.requestedInterval && "requestBoundaryLineage",
  ].filter((x): x is string => !!x);
  return c612CompletenessRowSchema.parse({
    eventId: identity.eventId,
    candidateId: identity.candidateId,
    speechActivityCoverage: measurable
      ? c612Defined(covered) / duration(speech)
      : null,
    speechBeforeFirstSupportedToken: lead,
    speechAfterLastSupportedToken: trail,
    unsupportedInternalSpeechDuration: internal,
    candidateTokenSupportCoverage: support,
    candidatePronunciationCoverage:
      ctc.representation === "PRONUNCIATION" ? ctc.vocabularyCoverage : null,
    candidateCtcLossPerToken: ctc.perTokenLoss,
    candidateCtcScorability: ctc.status,
    firstTokenToSpeechOnsetGap: measurable
      ? first - c612Defined(speech[0]).start
      : null,
    lastTokenToSpeechOffsetGap: measurable
      ? c612Defined(speech.at(-1)).end - last
      : null,
    requestLeftEdgeDistance: left,
    requestRightEdgeDistance: right,
    coreLeftEdgeDistance: first !== null && core ? first - core.start : null,
    coreRightEdgeDistance: last !== null && core ? core.end - last : null,
    leadingDeletionRisk:
      lead === null ? null : Math.min(1, lead / p.maximumUncoveredEdgeSeconds),
    trailingDeletionRisk:
      trail === null
        ? null
        : Math.min(1, trail / p.maximumUncoveredEdgeSeconds),
    internalDeletionRisk:
      internal === null
        ? null
        : Math.min(1, internal / p.maximumInternalUncoveredSeconds),
    adjacentUtteranceContaminationRisk: contamination,
    acousticCompletenessStatus: status,
    evidenceHashes: [
      ...new Set([
        ...identity.evidenceHashes,
        hash(ctc),
        vad.evidenceHash,
        ...(useMapped ? mapped.evidenceHashes : []),
      ]),
    ].sort(),
    missing,
  });
}
export function buildCompleteness(
  identities: readonly C612Identity[],
  scores: readonly C612CtcScore[],
  vad: C612VadEvidence,
  mapped: readonly C612MappedSupport[] = [],
) {
  const rows = identities
    .map((i) => {
      const ctc = scores.find((s) => s.candidateId === i.candidateId);
      if (!ctc) throw new Error("C612_CTC_LEDGER_MISSING_ROW");
      return candidateCompleteness(
        i,
        ctc,
        vad,
        mapped.find((r) => r.candidateId === i.candidateId),
      );
    })
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const completeness = c612CompletenessSchema.parse(
    artifact("machine-c6-1-2-candidate-acoustic-completeness", {
      rows,
      runtimeGoldInputCount: 0,
    }),
  );
  const edge = c612EdgeSchema.parse(
    artifact("machine-c6-1-2-candidate-edge-risk", {
      completenessHash: completeness.semanticHash,
      rows: rows.map((r) => ({
        candidateId: r.candidateId,
        eventId: r.eventId,
        leftDistance: r.requestLeftEdgeDistance,
        rightDistance: r.requestRightEdgeDistance,
        risk:
          r.requestLeftEdgeDistance === null ||
          r.requestRightEdgeDistance === null
            ? null
            : Number(
                Math.min(
                  r.requestLeftEdgeDistance,
                  r.requestRightEdgeDistance,
                ) < C612_POLICY.completeness.minimumRequestEdgeDistance,
              ),
        status:
          r.requestLeftEdgeDistance === null ||
          r.requestRightEdgeDistance === null
            ? "UNKNOWN"
            : "REQUEST_BOUNDARY_MEASURED",
      })),
    }),
  );
  return { completeness, edge };
}
