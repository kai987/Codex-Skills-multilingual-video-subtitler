/** Pure suggestion policy. Whole donor cues only; no I/O, models, Gold, or edits. */
export const coreSplicePolicy = Object.freeze({
  version: "whole-cue-core-splice-v1",
  envelopeToleranceSeconds: 0.3,
  windowEdgeToleranceSeconds: 0.01,
  minimumAnchorCodepoints: 8,
  maximumViewRecords: 600,
  timingPolicy: "old-union-envelope-not-realigned",
  subtitleMutationAuthorized: false,
});

const epsilon = 1e-7;
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const id = (s) =>
  typeof s === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(s);
// Deliberately neither NFC/NFKC nor punctuation/lexical normalization.
const normalized = (s) => s.replace(/\s/gu, "");
const points = (s) => Array.from(normalized(s));
const intersects = (r, start, end) =>
  r.sourceStart < end - epsilon && r.sourceEnd > start + epsilon;

function validMapped(r) {
  return (
    r &&
    id(r.recordId) &&
    id(r.requestId) &&
    r.parseStatus === "PARSED" &&
    Array.isArray(r.issues) &&
    r.issues.length === 0 &&
    finite(r.sourceStart) &&
    finite(r.sourceEnd) &&
    r.sourceStart >= 0 &&
    r.sourceEnd > r.sourceStart &&
    finite(r.localStart) &&
    finite(r.localEnd) &&
    r.localStart >= 0 &&
    r.localEnd > r.localStart &&
    finite(r.audioGlobalStart) &&
    finite(r.audioGlobalEnd) &&
    r.audioGlobalStart >= 0 &&
    Math.abs(r.localEnd - r.localStart - (r.sourceEnd - r.sourceStart)) <
      epsilon &&
    Math.abs(
      r.audioGlobalEnd - r.audioGlobalStart - (r.sourceEnd - r.sourceStart),
    ) < epsilon &&
    typeof r.text === "string" &&
    normalized(r.text).length > 0
  );
}

function validRecords(records) {
  return (
    Array.isArray(records) &&
    records.length > 0 &&
    new Set(records.map((r) => r?.recordId)).size === records.length &&
    records.every(
      (r, i) =>
        validMapped(r) &&
        (i === 0 || r.sourceStart >= records[i - 1].sourceStart),
    )
  );
}

function validView(v, targetId) {
  const q = v?.request;
  return (
    q &&
    id(q.id) &&
    q.backend === "whisper" &&
    (q.targetId === undefined || q.targetId === targetId) &&
    finite(q.start) &&
    finite(q.end) &&
    q.start >= 0 &&
    q.end > q.start &&
    typeof q.wavHash === "string" &&
    /^[a-f0-9]{64}$/u.test(q.wavHash) &&
    v.exportBlocked !== true &&
    (!v.invalidRecordIds ||
      (Array.isArray(v.invalidRecordIds) && v.invalidRecordIds.length === 0)) &&
    validRecords(v.records) &&
    v.records.length <= coreSplicePolicy.maximumViewRecords &&
    v.records.every(
      (r, i) =>
        r.requestId === q.id &&
        r.sourceStart >= q.start - epsilon &&
        r.sourceEnd <= q.end + epsilon &&
        Math.abs(r.sourceStart - (q.start + r.localStart)) < epsilon &&
        Math.abs(r.sourceEnd - (q.start + r.localEnd)) < epsilon &&
        (i === 0 || r.sourceStart >= v.records[i - 1].sourceEnd - epsilon),
    )
  );
}

function prefixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function suffixLength(a, b) {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  )
    n++;
  return n;
}

function exactOccurrences(haystack, needle) {
  const starts = [];
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((c, j) => haystack[i + j] === c)) starts.push(i);
  }
  return starts;
}

function textSupport(view, candidate, start, end) {
  const rows = view.records.filter((r) => intersects(r, start, end));
  const chars = rows.flatMap((r) => points(r.text));
  const starts = exactOccurrences(chars, points(candidate));
  if (starts.length !== 1)
    return {
      reason: starts.length
        ? "NON_UNIQUE_SUPPORT_TEXT"
        : "NO_EXACT_CROSS_WINDOW_SUPPORT",
    };
  const first = starts[0],
    last = first + points(candidate).length;
  let cursor = 0;
  const matched = [];
  for (const row of rows) {
    const count = points(row.text).length;
    if (cursor < last && cursor + count > first)
      matched.push({ row, first: cursor, last: cursor + count });
    cursor += count;
  }
  if (
    matched.some(
      ({ row }, i) =>
        i > 0 &&
        row.sourceStart >
          matched[i - 1].row.sourceEnd +
            coreSplicePolicy.envelopeToleranceSeconds +
            epsilon,
    )
  ) {
    return { reason: "SUPPORT_TEXT_SPANS_AUDIO_GAP" };
  }
  // An interior match in a long cue is text-only support, never a donor or a
  // substring timestamp. Unrelated edge text in that cue is not adopted.
  const a = matched[0],
    b = matched.at(-1),
    edge = coreSplicePolicy.windowEdgeToleranceSeconds;
  if (
    (first === a.first &&
      a.row.sourceStart <= view.request.start + edge + epsilon) ||
    (last === b.last && b.row.sourceEnd >= view.request.end - edge - epsilon) ||
    matched.some(
      ({ row }) =>
        row.startPinnedToWindowEdge === true ||
        row.endPinnedToWindowEdge === true,
    )
  ) {
    return { reason: "SUPPORT_MATCH_TOUCHES_WINDOW_EDGE" };
  }
  return {
    support: {
      requestId: view.request.id,
      wavHash: view.request.wavHash,
      recordIds: matched.map(({ row }) => row.recordId),
      normalizedCodepointSpan: { start: first, end: last },
      kind: "same-model-cross-window-exact-text-only",
      independentModelEvidence: false,
      acousticTimingAuthority: false,
    },
  };
}

/**
 * Return a separate review suggestion replacing exactly two adjacent old cues.
 * Outer timestamps are retained, but 2 -> 1 is explicitly a segmentation change.
 * The caller must validate frozen provenance and preserve every other record.
 */
export function proposeCoreSplice(input = {}) {
  const { targetId, records, targetRecordIds, views } = input ?? {};
  const base = {
    version: coreSplicePolicy.version,
    targetId: typeof targetId === "string" ? targetId : null,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    automaticApplication: false,
    subtitleMutationAuthorized: false,
    independentAcousticVerification: false,
    referenceUsed: false,
  };
  const abstain = (reasons, extra = {}) => ({
    ...base,
    status: "ABSTAIN",
    reasons,
    proposal: null,
    ...extra,
  });
  if (
    !id(targetId) ||
    !validRecords(records) ||
    !Array.isArray(targetRecordIds) ||
    targetRecordIds.length !== 2 ||
    !targetRecordIds.every(id) ||
    targetRecordIds[0] === targetRecordIds[1]
  )
    return abstain(["INVALID_BASELINE_OR_TARGET"]);
  const index = records.findIndex((r) => r.recordId === targetRecordIds[0]);
  if (index < 0 || records[index + 1]?.recordId !== targetRecordIds[1])
    return abstain(["TARGETS_NOT_ADJACENT_IN_SOURCE_ORDER"]);
  const left = records[index],
    right = records[index + 1];
  if (!(
    left.sourceStart < right.sourceStart &&
    left.sourceEnd > right.sourceStart &&
    left.sourceEnd < right.sourceEnd
  )) {
    return abstain(["TARGETS_REQUIRE_OVERLAP_AND_TWO_EXCLUSIVE_EDGES"]);
  }
  const start = left.sourceStart,
    end = right.sourceEnd;
  if (
    records.some(
      (r, i) => i !== index && i !== index + 1 && intersects(r, start, end),
    )
  )
    return abstain(["TARGET_UNION_OVERLAPS_PRESERVED_NEIGHBOR"]);
  if (
    points(left.text).length < coreSplicePolicy.minimumAnchorCodepoints ||
    points(right.text).length < coreSplicePolicy.minimumAnchorCodepoints
  ) {
    return abstain(["SHORT_DIALOGUE_ANCHORS_UNSAFE"]);
  }
  if (
    !Array.isArray(views) ||
    views.length !== 2 ||
    !views.every((v) => validView(v, targetId))
  )
    return abstain(["TWO_COMPLETE_BOUND_WHISPER_VIEWS_REQUIRED"]);
  if (
    views[0].request.id === views[1].request.id ||
    views[0].request.wavHash === views[1].request.wavHash
  )
    return abstain(["DISTINCT_REQUESTS_AND_AUDIO_REQUIRED"]);
  if (
    views.some(
      ({ request: q }) =>
        start <= q.start + coreSplicePolicy.windowEdgeToleranceSeconds ||
        end >= q.end - coreSplicePolicy.windowEdgeToleranceSeconds,
    )
  ) {
    return abstain(["CORE_TOUCHES_REQUEST_WINDOW_EDGE"]);
  }

  const candidates = [],
    rejected = new Set();
  const tolerance = coreSplicePolicy.envelopeToleranceSeconds;
  for (const view of views) {
    const rows = view.records;
    for (let i = 0; i < rows.length; i++) {
      if (!intersects(rows[i], start, end)) continue;
      for (let j = i; j < rows.length && intersects(rows[j], start, end); j++) {
        const group = rows.slice(i, j + 1),
          first = group[0],
          last = group.at(-1);
        if (
          first.sourceStart < start - tolerance - epsilon ||
          first.sourceStart > start + tolerance + epsilon ||
          last.sourceEnd < end - tolerance - epsilon ||
          last.sourceEnd > end + tolerance + epsilon ||
          first.sourceStart >= right.sourceStart ||
          last.sourceEnd <= left.sourceEnd ||
          group.some(
            (r, k) =>
              k && r.sourceStart > group[k - 1].sourceEnd + tolerance + epsilon,
          )
        ) {
          rejected.add("DONOR_NOT_COMPLETE_CORE_ENVELOPE");
          continue;
        }
        const edge = coreSplicePolicy.windowEdgeToleranceSeconds;
        if (
          first.sourceStart <= view.request.start + edge + epsilon ||
          last.sourceEnd >= view.request.end - edge - epsilon ||
          group.some(
            (r) =>
              r.startPinnedToWindowEdge === true ||
              r.endPinnedToWindowEdge === true,
          )
        ) {
          rejected.add("DONOR_TOUCHES_WINDOW_EDGE");
          continue;
        }
        const text = group.map((r) => r.text).join("");
        const chars = points(text),
          prefix = prefixLength(points(left.text), chars),
          suffix = suffixLength(points(right.text), chars);
        if (
          prefix < coreSplicePolicy.minimumAnchorCodepoints ||
          suffix < coreSplicePolicy.minimumAnchorCodepoints ||
          chars.length < 2 * coreSplicePolicy.minimumAnchorCodepoints
        ) {
          rejected.add("OUTER_TEXT_ANCHORS_NOT_PRESERVED");
          continue;
        }
        if (normalized(text) === normalized(left.text + right.text)) {
          rejected.add("NO_TEXT_CHANGE");
          continue;
        }
        const other = views.find((v) => v.request.id !== view.request.id);
        const support = textSupport(other, text, start, end);
        candidates.push({
          text,
          normalizedText: normalized(text),
          donorRequestId: view.request.id,
          donorRecordIds: group.map((r) => r.recordId),
          donorEnvelope: { start: first.sourceStart, end: last.sourceEnd },
          edgeDeltas: {
            start: first.sourceStart - start,
            end: last.sourceEnd - end,
          },
          anchors: {
            minimumCodepoints: coreSplicePolicy.minimumAnchorCodepoints,
            commonPrefixCodepoints: prefix,
            commonSuffixCodepoints: suffix,
          },
          supports: support.support ? [support.support] : [],
          reasons: support.reason ? [support.reason] : [],
        });
      }
    }
  }
  const diagnostics = {
    candidateCount: candidates.length,
    candidates,
    rejectedConditions: [...rejected].sort(),
  };
  if (new Set(candidates.map((c) => c.normalizedText)).size > 1)
    return abstain(["AMBIGUOUS_COMPLETE_CORE_TEXT"], diagnostics);
  const supported = candidates.filter((c) => c.supports.length === 1);
  if (!supported.length)
    return abstain(
      candidates.length
        ? [...new Set(candidates.flatMap((c) => c.reasons))].sort()
        : ["NO_SAFE_WHOLE_CUE_DONOR"],
      diagnostics,
    );
  // Only equivalent text can reach this deterministic provenance selection.
  supported.sort(
    (a, b) =>
      a.donorRequestId.localeCompare(b.donorRequestId) ||
      a.donorRecordIds.join("|").localeCompare(b.donorRecordIds.join("|")),
  );
  const chosen = supported[0];
  return {
    ...base,
    status: "PROPOSED",
    reasons: [
      "WHOLE_CORE_DONOR_WITH_UNIQUE_SAME_MODEL_TEXT_SUPPORT",
      "REVIEW_ONLY_NOT_ACOUSTICALLY_VERIFIED",
    ],
    proposal: {
      sourceRecordIds: [...targetRecordIds],
      text: chosen.text,
      sourceStart: start,
      sourceEnd: end,
      donorRequestId: chosen.donorRequestId,
      donorRecordIds: chosen.donorRecordIds,
      donorEnvelope: chosen.donorEnvelope,
      edgeDeltas: chosen.edgeDeltas,
      supports: chosen.supports,
      anchors: chosen.anchors,
      timingPolicy: coreSplicePolicy.timingPolicy,
      resegmentation: {
        oldCueCount: 2,
        newCueCount: 1,
        outerBoundaryChanges: 0,
        removedInternalBoundaryCount: 2,
      },
      timingRealigned: false,
      acousticTimingVerified: false,
    },
    ...diagnostics,
  };
}
