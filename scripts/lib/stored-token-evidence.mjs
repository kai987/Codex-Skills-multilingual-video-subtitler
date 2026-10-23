/** Diagnostic-only whisper.cpp JSON reader. No acoustic verification or mutations. */
export const TOKEN_AUDIT_VERSION = "stored-token-evidence-v1";
const finite = Number.isFinite;
const sameTime = (a, b) => finite(a) && finite(b) && Math.abs(a - b) < 0.000001;
const globalTime = (ms, offset) =>
  finite(ms) ? Math.round((ms / 1000 + offset) * 1e6) / 1e6 : null;
const clockMs = (text) => {
  const m = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/u.exec(text ?? "");
  return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] : null;
};
function intervalIssues(item, durationMs, segment) {
  const a = item?.offsets?.from,
    b = item?.offsets?.to;
  const issues = [];
  if (!finite(a) || !finite(b)) return ["MISSING_OR_NONFINITE_OFFSETS"];
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b))
    issues.push("NONINTEGER_MILLISECONDS");
  if (a < 0 || b < 0) issues.push("NEGATIVE_OFFSET");
  if (a > durationMs || b > durationMs) issues.push("OUTSIDE_REQUEST");
  if (b === a) issues.push("ZERO_DURATION");
  if (b < a) issues.push("REVERSED_INTERVAL");
  if (
    clockMs(item.timestamps?.from) !== a ||
    clockMs(item.timestamps?.to) !== b
  )
    issues.push("CLOCK_OFFSET_MISMATCH");
  if (
    segment &&
    (a < segment.from || a > segment.to || b < segment.from || b > segment.to)
  )
    issues.push("OUTSIDE_SEGMENT");
  return issues;
}
function tokenKind(token, model) {
  // JSON can coalesce UTF-8 byte tokens. Its id is the first model token only.
  const eot =
    model?.multilingual === true
      ? 50257
      : model?.multilingual === false
        ? 50256
        : null;
  if (
    !Number.isInteger(token?.id) ||
    token.id < 0 ||
    !Number.isInteger(model?.vocab) ||
    token.id >= model.vocab ||
    eot === null
  )
    return "unknown";
  if (token.id < eot)
    return /^\[_.*\]$/u.test(token.text ?? "") ? "unknown" : "text";
  const begin = model.vocab - 1501;
  if (token.text === "[_BEG_]" && token.id === begin) return "control";
  const timestamp = /^\[_TT_(\d+)\]$/u.exec(token.text ?? "");
  if (timestamp && token.id === begin + Number(timestamp[1])) return "control";
  if (token.text === "[_EOT_]" && token.id === eot) return "control";
  return "unknown";
}

export function analyzeStoredTokens({ response, records, request }) {
  if (
    !finite(request.sourceOffset) ||
    request.sourceOffset < 0 ||
    !finite(request.duration) ||
    request.duration <= 0
  )
    throw Error("INVALID_TOKEN_REQUEST_TIMEBASE");
  if (!Array.isArray(response?.transcription) || !Array.isArray(records))
    throw Error("INVALID_STORED_TOKEN_RESPONSE");
  const requestIssues = [];
  if (response.transcription.length !== records.length)
    requestIssues.push("JSON_SRT_COUNT_MISMATCH");
  if (
    response.params?.language !== request.language ||
    response.result?.language !== request.language ||
    response.params?.translate !== false
  )
    requestIssues.push("RESPONSE_LANGUAGE_OR_TASK_MISMATCH");
  const rows = response.transcription.map((segment, index) => {
    const record = records[index];
    const issues = intervalIssues(segment, request.duration * 1000);
    if (
      !record ||
      segment.text?.trim() !== record.text?.trim() ||
      !sameTime(segment.offsets?.from / 1000, record.localStart) ||
      !sameTime(segment.offsets?.to / 1000, record.localEnd) ||
      !sameTime(
        globalTime(segment.offsets?.from, request.sourceOffset),
        record.sourceStart,
      ) ||
      !sameTime(
        globalTime(segment.offsets?.to, request.sourceOffset),
        record.sourceEnd,
      ) ||
      record.requestId !== request.requestId
    )
      issues.push("JSON_SRT_BINDING_MISMATCH");
    if (!Array.isArray(segment.tokens) || !segment.tokens.length)
      issues.push("MISSING_TOKEN_ITEMS");
    const items = (Array.isArray(segment.tokens) ? segment.tokens : []).map(
      (token, i) => {
        const kind = tokenKind(token, response.model);
        const tokenIssues = intervalIssues(
          token,
          request.duration * 1000,
          segment.offsets,
        );
        if (kind === "control") {
          const zero = tokenIssues.indexOf("ZERO_DURATION");
          if (zero >= 0) tokenIssues.splice(zero, 1); // Timestamp markers are not words.
        }
        if (kind === "unknown") tokenIssues.push("UNKNOWN_TOKEN_KIND");
        if (typeof token?.text !== "string" || token.text.includes("\uFFFD"))
          tokenIssues.push("INVALID_TOKEN_TEXT");
        return {
          itemIndex: i,
          tokenId: token.id ?? null,
          text: token.text ?? "",
          kind,
          sourceStart: globalTime(token.offsets?.from, request.sourceOffset),
          sourceEnd: globalTime(token.offsets?.to, request.sourceOffset),
          duration:
            finite(token.offsets?.from) && finite(token.offsets?.to)
              ? (token.offsets.to - token.offsets.from) / 1000
              : null,
          dtwTick: finite(token.t_dtw) ? token.t_dtw : null,
          dtwAvailable: finite(token.t_dtw) && token.t_dtw >= 0,
          punctuationOnly:
            typeof token.text === "string" &&
            /^[\p{P}\p{S}\s]*$/u.test(token.text),
          issues: tokenIssues,
        };
      },
    );
    const textItems = items.filter((t) => t.kind === "text");
    if (
      textItems
        .map((t) => t.text)
        .join("")
        .trim() !== segment.text?.trim()
    )
      issues.push("TOKEN_TEXT_COVERAGE_MISMATCH");
    for (let i = 1; i < textItems.length; i++) {
      if (
        finite(textItems[i].sourceStart) &&
        finite(textItems[i - 1].sourceEnd) &&
        textItems[i].sourceStart < textItems[i - 1].sourceEnd
      )
        textItems[i].issues.push("NONMONOTONIC_TOKEN_SEQUENCE");
    }
    // A review heuristic, never an onset estimator or an edit threshold.
    const segmentDuration =
      (segment.offsets?.to - segment.offsets?.from) / 1000;
    const first = textItems[0];
    if (
      first &&
      first.duration >= 2 &&
      first.duration >= segmentDuration / 2 &&
      !first.punctuationOnly
    )
      issues.push("DOMINANT_LONG_FIRST_TOKEN");
    for (const token of items) issues.push(...token.issues);
    const bindingValid =
      request.bindingValidated === true &&
      !requestIssues.length &&
      !issues.includes("JSON_SRT_BINDING_MISMATCH");
    return {
      recordId: record?.recordId ?? null,
      requestId: request.requestId,
      text: segment.text ?? "",
      sourceStart: record?.sourceStart ?? null,
      sourceEnd: record?.sourceEnd ?? null,
      items,
      tokens: textItems,
      issues: [...new Set(issues)],
      provenance: {
        validated: bindingValid,
        sourceHash: request.sourceHash,
        modelHash: request.modelHash,
        runtimeHash: request.runtimeHash,
        rawResponseHash: request.rawResponseHash,
        timebase: "source-global",
        timingVerified: false,
      },
      timingCapability: "UNVERIFIED_HEURISTIC_TOKEN_TIMES",
      canAutoRetime: false,
      proposedRepair: null,
    };
  });
  const all = rows.flatMap((r) => r.items),
    text = all.filter((t) => t.kind === "text");
  return {
    version: TOKEN_AUDIT_VERSION,
    requestId: request.requestId,
    requestIssues,
    rows,
    semantics: {
      outputTiming: "segment",
      offsetsUnit: "milliseconds",
      dtwUnit: "10-millisecond-ticks",
      jsonFullRequested: request.args?.includes("--output-json-full") === true,
      ordinaryTokenTimingFieldsPresent:
        text.length > 0 &&
        text.every((t) => finite(t.sourceStart) && finite(t.sourceEnd)),
      runtimeComputationVerification: "NOT_INDEPENDENTLY_OBSERVED",
      tokenEvidence: "NOT_ACOUSTICALLY_VALIDATED",
      dtwAvailability:
        all.length && all.every((t) => t.dtwTick === -1)
          ? "unavailable"
          : "mixed-or-unknown",
      jsonItemsMayMergeModelTokens: true,
      tokenProbabilityIsBoundaryConfidence: false,
    },
    summary: {
      segments: rows.length,
      jsonTokenItems: all.length,
      textTokenItems: text.length,
      controlItems: all.filter((t) => t.kind === "control").length,
      unknownItems: all.filter((t) => t.kind === "unknown").length,
      positiveTextItems: text.filter((t) => t.duration > 0).length,
      zeroDurationTextItems: text.filter((t) => t.duration === 0).length,
      reversedTextItems: text.filter((t) => t.duration < 0).length,
      outOfSegmentTextItems: text.filter((t) =>
        t.issues.includes("OUTSIDE_SEGMENT"),
      ).length,
      dtwUnavailableItems: all.filter((t) => t.dtwTick === -1).length,
      nonpositiveTextSegments: rows.filter((r) =>
        r.tokens.some((t) => t.duration !== null && t.duration <= 0),
      ).length,
      dominantFirstTokenSegments: rows.filter((r) =>
        r.issues.includes("DOMINANT_LONG_FIRST_TOKEN"),
      ).length,
    },
    canAutoRetime: false,
    textMutations: 0,
    timingMutations: 0,
  };
}
