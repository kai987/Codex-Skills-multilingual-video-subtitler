import {
  c60114ProbeRelocalizationSchema,
  c60114RelocalizedRequestSchema,
  type C60114ProbeExecution,
  type C60114ProbeTarget,
  type C60114ProbeRequest,
  type C60114RelocalizedRequest,
  type C60114Policy,
} from "@mvl/shared";
import { normalizeIndependentAsrLexical as normalize } from "../machine-quality/cross-model-normalization.js";
import {
  c60114ArtifactHeader,
  c60114Union,
  c60114Intersection,
  withC60114SemanticHash,
} from "./c60114-policy.js";
import { buildC60114CompletionPolicy } from "./c60114-completion-policy.js";
import { c60114ProbeSemanticHash } from "./missing-dialogue-local-probe.js";

const overlap = (
  a: { start: number; end: number },
  b: { start: number; end: number },
) => {
  const span = c60114Intersection(a, b);
  return span ? span.end - span.start : 0;
};

/** Derivation only; raw cached request status/text/identity is never rewritten. */
export function relocalizeC60114Probe(
  request: C60114ProbeRequest,
  target: C60114ProbeTarget,
): C60114RelocalizedRequest {
  if (
    request.targetId !== target.targetId ||
    request.coreInterval.start !== target.sourceInterval.start ||
    request.coreInterval.end !== target.sourceInterval.end ||
    request.semanticHash !== c60114ProbeSemanticHash(request)
  )
    throw new Error("C60114_RELOCALIZATION_REQUEST_BINDING_MISMATCH");
  const policy = buildC60114CompletionPolicy(),
    tolerance = policy.boundaryRoundingToleranceSeconds;
  const neighbors = c60114Union(target.neighborCueIntervals);
  const coreNeighborOverlapSeconds = neighbors.reduce(
    (n, s) => n + overlap(s, request.coreInterval),
    0,
  );
  const guardNeighborOverlapSeconds = neighbors.reduce(
    (n, s) =>
      n +
      Math.max(
        0,
        overlap(s, request.extractionInterval) -
          overlap(s, request.coreInterval),
      ),
    0,
  );
  const tokens = request.tokens.filter((t) => normalize(t.text) !== "");
  const bounded = tokens.every(
    (t) =>
      t.sourceInterval !== null &&
      t.sourceInterval.start >= request.extractionInterval.start - tolerance &&
      t.sourceInterval.end <= request.extractionInterval.end + tolerance &&
      t.sourceInterval.end > t.sourceInterval.start,
  );
  const monotonic = tokens.every(
    (t, i) =>
      i === 0 ||
      (t.sourceInterval?.start ?? -1) >=
        (tokens[i - 1]?.sourceInterval?.end ?? Infinity) - tolerance,
  );
  const wholeTokenChainVerified =
    request.provider === "whisper-large-v3" &&
    tokens.length > 0 &&
    bounded &&
    monotonic &&
    tokens.every((t) => t.trusted) &&
    normalize(tokens.map((t) => t.text).join("")) ===
      normalize(request.rawText);
  const selected = tokens.filter(
    (t) =>
      t.trusted &&
      t.sourceInterval !== null &&
      t.sourceInterval.start >= request.coreInterval.start - tolerance &&
      t.sourceInterval.end <= request.coreInterval.end + tolerance,
  );
  const crossing = tokens.filter(
    (t) =>
      t.trusted &&
      t.sourceInterval !== null &&
      overlap(t.sourceInterval, request.coreInterval) > tolerance &&
      !selected.includes(t),
  );
  const first = selected[0],
    last = selected.at(-1);
  const contiguous =
    first !== undefined &&
    last !== undefined &&
    tokens.indexOf(last) - tokens.indexOf(first) + 1 === selected.length;
  let status: C60114RelocalizedRequest["status"] =
    "CORE_LOCALIZATION_UNRESOLVED";
  let localizedText: string | null = null,
    localizationVerified = false,
    eligible = false,
    caution = false;
  const reasons: string[] = [];
  const coreClean = coreNeighborOverlapSeconds <= 1e-7;
  const guardBounded =
    request.coreInterval.start - request.extractionInterval.start <=
      policy.guardContactMaximumSeconds + tolerance &&
    request.extractionInterval.end - request.coreInterval.end <=
      policy.guardContactMaximumSeconds + tolerance;
  if (request.status !== "SUCCESS" && request.status !== "EMPTY_OUTPUT") {
    status = "FAILED";
    reasons.push("PERSISTED_PROVIDER_FAILURE_NOT_NEGATIVE_SPEECH");
  } else if (!normalize(request.rawText)) {
    status = "EMPTY";
    reasons.push("EMPTY_OUTPUT_NOT_NON_SPEECH_PROOF");
  } else if (!coreClean) {
    status = "CORE_CONTAMINATED_BY_NEIGHBOR";
    reasons.push("POSITIVE_NEIGHBOR_INTERVAL_INSIDE_CORE");
  } else if (wholeTokenChainVerified && contiguous && crossing.length === 0) {
    status = "TRUSTED_GLOBAL_TOKEN_PROJECTION";
    localizedText = selected.map((t) => t.text).join("");
    localizationVerified = true;
    eligible = true;
    reasons.push(
      "COMPLETE_MONOTONIC_WHISPER_TOKEN_CHAIN",
      "NO_CORE_EDGE_TOKEN_CUT",
    );
  } else if (request.windowType === "CORE_CONTEXT") {
    status = "CONTEXT_TEXT_UNPROJECTABLE";
    reasons.push("FULL_CONTEXT_NOT_PROJECTABLE_WITH_VERIFIED_TOKEN_CHAIN");
  } else if (crossing.length > 0) {
    status = "CORE_LOCALIZATION_UNRESOLVED";
    reasons.push("TRUSTED_TOKEN_CROSSES_CORE_BOUNDARY");
  } else if (guardBounded && guardNeighborOverlapSeconds <= 1e-7) {
    status = "CORE_EXACT_ISLAND_LOCALIZED";
    localizedText = request.rawText;
    localizationVerified = true;
    eligible = true;
    reasons.push("CLEAN_EXACT_ISLAND_NOT_WORD_TIMESTAMPS");
  } else if (
    guardBounded &&
    guardNeighborOverlapSeconds <= policy.guardContactMaximumSeconds + tolerance
  ) {
    status = "CORE_CLEAN_GUARD_CONTACT_ONLY";
    caution = true;
    eligible = request.hallucinationRisk < 0.6;
    reasons.push(
      "CORE_CLEAN_SMALL_GUARD_CONTACT_NOT_PROVEN_CONTAMINATION",
      "FULL_CANDIDATE_RETAINED_WITH_GUARD_CAUTION",
    );
  } else reasons.push("GUARD_CONTACT_OR_TOKEN_PROVENANCE_UNRESOLVED");
  if (request.provider === "reazonspeech-k2-v2")
    reasons.push("REAZON_POINT_TIMESTAMPS_NOT_TOKEN_INTERVAL_PROOF");
  if (!wholeTokenChainVerified) reasons.push("TOKEN_CHAIN_NOT_FULLY_VERIFIED");
  const projectedSourceIntervals =
    status === "TRUSTED_GLOBAL_TOKEN_PROJECTION"
      ? c60114Union(
          selected.flatMap((t) => (t.sourceInterval ? [t.sourceInterval] : [])),
        )
      : status === "CORE_EXACT_ISLAND_LOCALIZED"
        ? [{ ...request.coreInterval }]
        : [];
  return c60114RelocalizedRequestSchema.parse(
    withC60114SemanticHash({
      requestId: request.requestId,
      targetId: target.targetId,
      sourceIslandId: target.sourceIslandId,
      provider: request.provider,
      windowType: request.windowType,
      sourceInterval: request.coreInterval,
      extractionInterval: request.extractionInterval,
      originalRequestSemanticHash: request.semanticHash,
      originalRawOutputHash: request.rawOutputHash,
      status,
      localizedText,
      candidateText: request.rawText,
      coreNeighborOverlapSeconds,
      guardNeighborOverlapSeconds,
      coreBoundaryCrossingTokenCount: crossing.length,
      trustedProjectedTokenCount:
        status === "TRUSTED_GLOBAL_TOKEN_PROJECTION" ? selected.length : 0,
      projectedSourceIntervals,
      wholeTokenChainVerified,
      eligibleForCrossModelReconciliation: eligible,
      localizationVerified,
      guardContactCaution: caution,
      reasons,
    }),
  );
}

export function relocalizeC60114ExistingProbes(input: {
  probes: C60114ProbeExecution;
  targets: readonly C60114ProbeTarget[];
  policy: C60114Policy;
}) {
  if (input.probes.semanticHash !== c60114ProbeSemanticHash(input.probes))
    throw new Error("C60114_RAW_PROBE_HASH_MISMATCH");
  const targets = new Map(input.targets.map((t) => [t.targetId, t]));
  const requests = input.probes.requests.map((r) => {
    const target = targets.get(r.targetId);
    if (!target) throw new Error("C60114_FROZEN_TARGET_MISSING");
    return relocalizeC60114Probe(r, target);
  });
  return c60114ProbeRelocalizationSchema.parse(
    withC60114SemanticHash({
      ...c60114ArtifactHeader(input.policy, input.probes.sourceIdentity),
      artifactType: "machine-existing-probe-relocalization",
      completionPolicyHash: buildC60114CompletionPolicy().semanticHash,
      originalProbeSemanticHash: input.probes.semanticHash,
      originalSelectionHash: input.probes.selectionHash,
      requests,
      newInferenceCount: 0,
      originalResultsModified: false,
    }),
  );
}
