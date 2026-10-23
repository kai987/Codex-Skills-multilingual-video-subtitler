import {
  ACOUSTIC_POLICY,
  ACOUSTIC_CLASSES,
  observationSchema,
  localizeObservation,
  decideAcoustic,
  lexical,
  type AcousticCase,
  type AcousticObservation,
} from "./bounded-acoustic.js";
import { objectHash } from "./experimental-profile.js";

export const AUDIT_VERSION = "c6011621-shadow-v1";
export type CapabilityStatus =
  | "SUPPORTED_BY_ACTUAL_ADAPTER"
  | "RAW_AVAILABLE_BUT_NOT_EXPOSED"
  | "UNSUPPORTED_BY_ACTUAL_ADAPTER"
  | "SEMANTICS_UNVERIFIED";
export type Reachability =
  | "POTENTIALLY_REACHABLE"
  | "UNREACHABLE_PROVIDER_CAPABILITY_MISMATCH"
  | "POLICY_DISABLED"
  | "DECISION_PATH_NOT_IMPLEMENTED"
  | "REACHABILITY_UNRESOLVED";
export interface ProviderCapability {
  family: AcousticObservation["family"];
  identity: {
    adapterHash: string;
    runtime: unknown;
    model: unknown;
    config: unknown;
  };
  timingKind: AcousticObservation["timingKind"];
  completeLocalization: CapabilityStatus;
  pointTiming: CapabilityStatus;
  intervalTiming: CapabilityStatus;
  repeatCount: CapabilityStatus;
  sameEvent: CapabilityStatus;
}
export function providerCapabilities(
  identities: Record<"whisper" | "reazon", ProviderCapability["identity"]>,
): ProviderCapability[] {
  return (["whisper", "reazon"] as const).map((family) => ({
    family,
    identity: identities[family],
    timingKind: family === "reazon" ? "TOKEN_POINTS" : "SEGMENT_INTERVALS",
    completeLocalization:
      family === "reazon"
        ? "UNSUPPORTED_BY_ACTUAL_ADAPTER"
        : "SUPPORTED_BY_ACTUAL_ADAPTER",
    pointTiming:
      family === "reazon"
        ? "SUPPORTED_BY_ACTUAL_ADAPTER"
        : "UNSUPPORTED_BY_ACTUAL_ADAPTER",
    intervalTiming:
      family === "reazon"
        ? "UNSUPPORTED_BY_ACTUAL_ADAPTER"
        : "SUPPORTED_BY_ACTUAL_ADAPTER",
    repeatCount: "UNSUPPORTED_BY_ACTUAL_ADAPTER",
    sameEvent: "UNSUPPORTED_BY_ACTUAL_ADAPTER",
  }));
}
/** Static compatibility, not permission to infer. No provider construction. */
export function checkActionCapabilities(
  caps: ProviderCapability[],
  policy: unknown,
  purpose: "ACTION_VALIDATION" | "OBSERVATION_ONLY",
) {
  const known = objectHash(policy) === objectHash(ACOUSTIC_POLICY);
  const absent = ["whisper", "reazon"].filter(
    (f) => !caps.some((c) => c.family === f),
  );
  const unsupported = caps
    .filter(
      (c) =>
        c.timingKind !== "SEGMENT_INTERVALS" ||
        c.completeLocalization === "UNSUPPORTED_BY_ACTUAL_ADAPTER",
    )
    .map((c) => c.family);
  const uncertain = caps.some(
    (c) => c.completeLocalization !== "SUPPORTED_BY_ACTUAL_ADAPTER",
  );
  const status: Reachability =
    !known || absent.length
      ? "REACHABILITY_UNRESOLVED"
      : unsupported.length
        ? "UNREACHABLE_PROVIDER_CAPABILITY_MISMATCH"
        : uncertain
          ? "REACHABILITY_UNRESOLVED"
          : "POTENTIALLY_REACHABLE";
  const actions = [
    {
      action: "REPLACE_WITH_LOCALIZED_FRESH_CANDIDATE",
      status,
      requires:
        "two complete interval windows per family, agreement, isolated current-stage span, Japanese candidate",
    },
    {
      action: "KEEP_STAGE_INPUT",
      status,
      requires: "same allComparable gate and unchanged normalized text",
    },
    {
      action: "ABSTAIN_KEEP_STAGE_INPUT",
      status: "POTENTIALLY_REACHABLE" as Reachability,
      requires: "fallback when neither replace nor supported keep",
    },
    {
      action: "COLLAPSE_CONFIRMED_SAME_EVENT_REPRESENTATION",
      status: (known
        ? "POLICY_DISABLED"
        : "REACHABILITY_UNRESOLVED") as Reachability,
      requires:
        "no action implementation or same-event identity in current policy",
    },
    {
      action: "utteranceStructure",
      status: "DECISION_PATH_NOT_IMPLEMENTED" as Reachability,
      requires: "currently a literal UNKNOWN",
    },
  ];
  return {
    purpose,
    policyHash: objectHash(policy),
    actions,
    missingFamilies: absent,
    incompatibleFamilies: unsupported,
    actionValidationCompatible: status === "POTENTIALLY_REACHABLE",
    observationStudyPermitted: purpose === "OBSERVATION_ONLY",
    executeAuthorized: false,
    stop:
      status === "UNREACHABLE_PROVIDER_CAPABILITY_MISMATCH"
        ? "STOP_SAME_POLICY_REINFERENCE"
        : "NO_EXECUTION_IN_AUDIT",
    classifications: ACOUSTIC_CLASSES.map((name) => ({
      name,
      status:
        name === "UNKNOWN"
          ? "POTENTIALLY_REACHABLE"
          : name === "WHOLE_HYPOTHESIS_UNSUPPORTED_BY_NEW_ASR"
            ? status
            : "DECISION_PATH_NOT_IMPLEMENTED",
    })),
  };
}
export function auditDecision(
  c: AcousticCase,
  observations: AcousticObservation[],
) {
  const decision = decideAcoustic(c, observations);
  const relevant = observations.filter(
    (o) => o.caseBindingHash === c.bindingHash,
  );
  const localized = relevant.map((o) => ({
    requestId: o.requestId,
    family: o.family,
    windowId: o.windowId,
    audioHash: o.audioHash,
    ...localizeObservation(o, c.core),
  }));
  const supports = localized.filter((o) => o.complete && lexical(o.text));
  const familyCounts = (["whisper", "reazon"] as const).map((family) => ({
    family,
    completeWindows: new Set(
      supports.filter((o) => o.family === family).map((o) => o.windowId),
    ).size,
    audioHashes: new Set(
      relevant.filter((o) => o.family === family).map((o) => o.audioHash),
    ).size,
  }));
  const allComparable =
    familyCounts.every((x) => x.completeWindows === 2 && x.audioHashes === 2) &&
    supports.length === 4;
  const isolated =
    c.occurrenceIds.length === 1 &&
    c.core.start === c.before.start &&
    c.core.end === c.before.end;
  return {
    caseId: c.id,
    decision,
    conditions: {
      familyCounts,
      supportCount: supports.length,
      allComparable,
      agreed:
        allComparable &&
        new Set(supports.map((o) => lexical(o.text))).size === 1,
      isolated,
      occurrenceCondition: isolated
        ? "SATISFIED"
        : "NOT_APPLICABLE_MULTI_OCCURRENCE_OR_EXPANDED_CORE",
      firstCaseBlocker: !allComparable
        ? "INSUFFICIENT_COMPLETE_SUPPORT"
        : !isolated
          ? "ISOLATED_STAGE_SPAN_REQUIRED"
          : "NONE",
    },
    perObservation: localized.map((o) => ({
      ...o,
      evidenceState:
        o.status === "CONTEXT_CONTAMINATED"
          ? "CONTEXT_BOUNDARY_UNRESOLVED"
          : o.status === "UNLOCALIZABLE"
            ? "UNLOCALIZABLE"
            : o.complete
              ? "SATISFIED"
              : "INSUFFICIENT_OBSERVATION",
      geometricReason:
        o.status === "CONTEXT_CONTAMINATED"
          ? "SEGMENT_CROSSES_CORE_BOUNDARY"
          : null,
    })),
    utteranceStructureReason: "DECISION_PATH_NOT_IMPLEMENTED",
    completeMeaning:
      "geometrically extractable segment set, not proof of complete speech or lexical coverage",
  };
}

/** Mirrors the frozen runner's mapping without executing/importing any provider. */
export function replayNormalization(
  base: AcousticObservation,
  raw: {
    text?: string;
    segments?: { text: string; start: number; end: number }[];
    results?: {
      status: string;
      text: string;
      tokenPoints: { token: string; paddedAudioSeconds: number }[];
    }[];
  },
) {
  if (base.family === "whisper")
    return observationSchema.parse({
      ...base,
      text: raw.text ?? "",
      segments: (raw.segments ?? []).map((s) => ({
        text: s.text,
        start: s.start + base.window.start,
        end: s.end + base.window.start,
      })),
      points: [],
      timingKind: "SEGMENT_INTERVALS",
    });
  const result = raw.results?.[0];
  if (!result) throw Error("Missing persisted Reazon result");
  return observationSchema.parse({
    ...base,
    text: result.text,
    segments: [],
    points: result.tokenPoints.map((p) => ({
      text: p.token,
      time: p.paddedAudioSeconds - 0.9 + base.window.start,
    })),
    timingKind: "TOKEN_POINTS",
  });
}
export interface PointInput {
  token: string;
  paddedAudioSeconds: number;
}
export function auditPoints(
  points: PointInput[],
  input: {
    window: { start: number; end: number };
    core: { start: number; end: number };
    padding: number;
    semantics: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED";
  },
) {
  const duration = input.window.end - input.window.start,
    decoded = duration + 2 * input.padding;
  // Only machine floating-point roundoff, not an acoustic tolerance or an offset search.
  const epsilon =
    8 *
    Number.EPSILON *
    Math.max(
      1,
      Math.abs(input.window.start),
      Math.abs(input.window.end),
      decoded,
    );
  const boundary = [
    0,
    input.padding,
    input.core.start - input.window.start + input.padding,
    input.core.end - input.window.start + input.padding,
    input.padding + duration,
    decoded,
  ];
  const rows = points.map((p, index) => {
    const t = p.paddedAudioSeconds,
      raw = t - input.padding,
      global = input.window.start + raw;
    const flags: string[] = [];
    let region: string;
    if (!Number.isFinite(t)) region = "NONFINITE";
    else if (t < -epsilon || t > decoded + epsilon)
      region = "OUTSIDE_DECODED_WAVEFORM";
    else if (boundary.some((b) => Math.abs(t - b) <= epsilon))
      region = "BOUNDARY_CONTACT";
    else if (t < input.padding) region = "LEADING_PADDING";
    else if (t > input.padding + duration) region = "TRAILING_PADDING";
    else if (global < input.core.start) region = "PHYSICAL_CONTEXT_BEFORE_CORE";
    else if (global > input.core.end) region = "PHYSICAL_CONTEXT_AFTER_CORE";
    else region = "PHYSICAL_CORE";
    if (index > 0 && t < (points[index - 1]?.paddedAudioSeconds ?? t) - epsilon)
      flags.push("NONMONOTONIC");
    return { index, token: p.token, original: t, raw, global, region, flags };
  });
  const conflicts = rows.some(
    (r) =>
      ["NONFINITE", "OUTSIDE_DECODED_WAVEFORM"].includes(r.region) ||
      r.flags.length > 0,
  );
  const fragments: { indices: number[]; text: string }[] = [];
  for (const row of rows) {
    if (row.region !== "PHYSICAL_CORE") continue;
    const prev = fragments.at(-1);
    if (prev?.indices.at(-1) === row.index - 1) {
      prev.indices.push(row.index);
      prev.text += row.token;
    } else fragments.push({ indices: [row.index], text: row.token });
  }
  return {
    rows,
    epsilon,
    endpointConvention:
      "half-open regions; all exact/roundoff contacts separately labeled; no contact has duration",
    semantics: input.semantics,
    conditionalOnPaddedInputContract: input.semantics !== "VERIFIED",
    requestIntegrity: conflicts ? "CONFLICT" : "POINT_ORDER_AND_RANGE_VALID",
    fragments: conflicts || input.semantics === "UNVERIFIED" ? [] : fragments,
    missingIndices: rows
      .filter((r) => r.region !== "PHYSICAL_CORE")
      .map((r) => r.index),
    partialTextRole: "DIAGNOSTIC_ONLY_NOT_COMPLETE_CORE_TRANSCRIPT",
    timingKind: "TOKEN_POINTS",
    complete: false,
    decisionEligible: false,
    cardinality: "RAW_CARDINALITY_UNVERIFIABLE",
    reason:
      "worker persisted zip(tokens,timestamps), not the two original arrays",
  };
}

export interface WhisperFull {
  transcription?: {
    text?: string;
    offsets?: { from?: number; to?: number };
    tokens?: {
      text?: string;
      id?: number;
      offsets?: { from?: number; to?: number };
      t_dtw?: number;
    }[];
  }[];
}
export function auditWhisper(
  full: WhisperFull,
  adapterTokens: number,
  observation: AcousticObservation,
  core: { start: number; end: number },
) {
  // IEEE-754 roundoff only; never an acoustic acceptance tolerance.
  const epsilon =
    8 *
    Number.EPSILON *
    Math.max(
      1,
      Math.abs(observation.window.start),
      Math.abs(observation.window.end),
    );
  const rows = (full.transcription ?? []).flatMap((s, segmentIndex) =>
    (s.tokens ?? []).map((t, index) => {
      const start = t.offsets?.from,
        end = t.offsets?.to;
      const validNumbers =
        typeof start === "number" &&
        typeof end === "number" &&
        Number.isFinite(start) &&
        Number.isFinite(end);
      const from = validNumbers ? start / 1000 : null,
        to = validNumbers ? end / 1000 : null;
      const special = t.text?.startsWith("[_") ?? false;
      const flags: string[] = [];
      if (!validNumbers) flags.push("MISSING_OR_NONFINITE");
      if (from !== null && to !== null) {
        if (from < 0 || to < from) flags.push("INVALID_INTERVAL");
        if (to === from) flags.push("ZERO_DURATION");
        if (
          from < 0 ||
          to > observation.window.end - observation.window.start + epsilon
        )
          flags.push("OUTSIDE_PHYSICAL_WINDOW");
        if (
          from < (s.offsets?.from ?? 0) / 1000 ||
          to > (s.offsets?.to ?? 0) / 1000
        )
          flags.push("OUTSIDE_PARENT_SEGMENT");
        const prev = s.tokens?.[index - 1]?.offsets?.from;
        if (prev !== undefined && start !== undefined && start < prev)
          flags.push("NONMONOTONIC");
      }
      if (special) flags.push("SPECIAL_TOKEN");
      return {
        segmentIndex,
        index,
        text: t.text ?? "",
        originalOffsets: t.offsets ?? null,
        dtw: t.t_dtw ?? null,
        start: from === null ? null : from + observation.window.start,
        end: to === null ? null : to + observation.window.start,
        flags,
        shadowEligible: flags.length === 0,
        role: "STORED_ESTIMATED_INTERVAL_NOT_ACOUSTIC_TRUTH",
      };
    }),
  );
  return {
    requested: true,
    returned: rows.length,
    parsed: adapterTokens,
    transportedToObservation: 0,
    consumedByLocalizer: 0,
    validated: "NOT_VALIDATED_FOR_LEXICAL_COMPLETENESS_OR_EVENT_COUNT",
    rows,
    availability: rows.length
      ? "RAW_AVAILABLE_BUT_NOT_EXPOSED"
      : "UNSUPPORTED_BY_ACTUAL_ADAPTER",
    legacy: localizeObservation(observation, core),
    crossBoundaryMeaning:
      "SEGMENT_CROSSES_CORE_BOUNDARY_NOT_CONFIRMED_SEMANTIC_CONTAMINATION",
    shadowCoreIntervals: rows.filter(
      (r) =>
        r.shadowEligible &&
        r.start !== null &&
        r.end !== null &&
        r.start >= core.start &&
        r.end <= core.end,
    ),
    decisionEligible: false,
    completeCoverageProven: false,
  };
}
