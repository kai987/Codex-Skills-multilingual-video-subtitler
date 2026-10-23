/** Machine-only planning and whole-cue assembly; no reference or provider I/O. */
export const seamRefinementPolicy = Object.freeze({
  version: "bounded-seam-refinement-v1",
  maxTargets: 4,
  maxRequests: 8,
  maxAudioSeconds: 120,
  maxTargetSeconds: 13,
  minimumSharedCharacters: 4,
  minimumSideCharacters: 8,
  anchorCharacters: 4,
  boundaryAgreementSeconds: 0.35,
  outerEnvelopeToleranceSeconds: 0.5,
  contextSeconds: [1, 2],
  retries: 0,
  qualityStatus: "needs-review",
});
const normalize = (s) => s.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const chars = (s) => Array.from(normalize(s));
const overlaps = (a, b) =>
  a.sourceStart < b.sourceEnd && b.sourceStart < a.sourceEnd;
const valid = (r) =>
  r &&
  typeof r.text === "string" &&
  normalize(r.text).length > 0 &&
  Number.isFinite(r.sourceStart) &&
  Number.isFinite(r.sourceEnd) &&
  r.sourceStart >= 0 &&
  r.sourceEnd > r.sourceStart &&
  Array.isArray(r.issues) &&
  !r.issues.length;
const requireValue = (condition, message) => {
  if (!condition) throw Error(message);
};
function common(a, b) {
  a = chars(a);
  b = chars(b);
  let best = [],
    prev = new Uint32Array(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    const next = new Uint32Array(b.length + 1);
    for (let j = 0; j < b.length; j++)
      if (a[i] === b[j]) {
        next[j + 1] = prev[j] + 1;
        if (next[j + 1] > best.length)
          best = a.slice(i - next[j + 1] + 1, i + 1);
      }
    prev = next;
  }
  return best.join("");
}
export function planSeams(records, decisions, sourceDuration) {
  requireValue(
    Number.isFinite(sourceDuration) && sourceDuration > 0,
    "INVALID_SOURCE_DURATION",
  );
  requireValue(
    Array.isArray(records) &&
      records.every(valid) &&
      new Set(records.map((r) => r.recordId)).size === records.length,
    "COMPLETE_VALID_UNIQUE_BASELINE_REQUIRED",
  );
  requireValue(
    records.every(
      (r) =>
        chars(r.text).length <= 4096 && r.sourceEnd <= sourceDuration + 1e-7,
    ),
    "BASELINE_LIMIT_OR_RANGE",
  );
  const byId = new Map(records.map((r) => [r.recordId, r]));
  const candidates = [],
    excluded = [];
  for (const d of decisions) {
    const left = byId.get(d.leftId),
      right = byId.get(d.rightId);
    requireValue(left && right, "UNBOUND_SEAM_RECORD");
    if (d.status !== "BOUNDARY_AMBIGUITY") continue;
    const shared = common(left.text, right.text);
    const exclude = (reason) =>
      excluded.push({ leftId: d.leftId, rightId: d.rightId, reason });
    if (left.chunkIndex + 1 !== right.chunkIndex || !overlaps(left, right)) {
      exclude("NOT_ADJACENT_OVERLAPPING_REQUESTS");
      continue;
    }
    if (
      [left, right].some(
        (r) =>
          chars(r.text).length < seamRefinementPolicy.minimumSideCharacters,
      ) ||
      chars(shared).length < seamRefinementPolicy.minimumSharedCharacters
    ) {
      exclude("INSUFFICIENT_LONG_SHARED_TEXT_SHORT_RESPONSES_PROTECTED");
      continue;
    }
    let selected = [left, right],
      envelope;
    for (;;) {
      envelope = {
        sourceStart: Math.min(...selected.map((r) => r.sourceStart)),
        sourceEnd: Math.max(...selected.map((r) => r.sourceEnd)),
      };
      const expanded = records.filter((r) => overlaps(r, envelope));
      if (expanded.length === selected.length) break;
      selected = expanded;
    }
    selected = selected.toSorted(
      (a, b) =>
        a.sourceStart - b.sourceStart ||
        a.chunkIndex - b.chunkIndex ||
        a.order - b.order,
    );
    if (
      envelope.sourceEnd - envelope.sourceStart >
      seamRefinementPolicy.maxTargetSeconds
    ) {
      exclude("WHOLE_RECORD_ENVELOPE_TOO_LONG");
      continue;
    }
    const windows = seamRefinementPolicy.contextSeconds.map((pad, i) => ({
      id: `view-${i + 1}`,
      start:
        Math.floor(Math.max(0, envelope.sourceStart - pad) * 16000) / 16000,
      end:
        Math.ceil(Math.min(sourceDuration, envelope.sourceEnd + pad) * 16000) /
        16000,
    }));
    if (
      windows.some(
        (w) => w.start >= envelope.sourceStart || w.end <= envelope.sourceEnd,
      ) ||
      (windows[0].start === windows[1].start &&
        windows[0].end === windows[1].end)
    ) {
      exclude("CONTEXT_CANNOT_SURROUND_TARGET");
      continue;
    }
    candidates.push({
      leftId: left.recordId,
      rightId: right.recordId,
      shared,
      score: chars(shared).length,
      recordIds: selected.map((r) => r.recordId),
      ...envelope,
      windows,
    });
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.sourceStart - b.sourceStart ||
      a.leftId.localeCompare(b.leftId),
  );
  const targets = [];
  let seconds = 0;
  for (const c of candidates) {
    const cost = c.windows.reduce((s, w) => s + w.end - w.start, 0);
    if (
      targets.some((t) => t.recordIds.some((id) => c.recordIds.includes(id))) ||
      targets.length >= seamRefinementPolicy.maxTargets ||
      seconds + cost > seamRefinementPolicy.maxAudioSeconds
    ) {
      excluded.push({ ...c, reason: "OVERLAP_OR_BUDGET" });
      continue;
    }
    targets.push({ ...c, id: `seam-${targets.length + 1}` });
    seconds += cost;
  }
  return {
    policy: seamRefinementPolicy,
    targets,
    excluded,
    requests: targets.length * 2,
    reservedAudioSeconds: seconds,
  };
}
export function decideSeam(target, baseline, views) {
  const abstain = (reason) => ({
    targetId: target.id,
    status: "ABSTAIN",
    reason,
    replaceIds: [],
    records: [],
  });
  if (
    !Array.isArray(views) ||
    views.length !== 2 ||
    views[0].requestId === views[1].requestId ||
    views[0].audioHash === views[1].audioHash
  )
    return abstain("TWO_DISTINCT_AUDIO_VIEWS_REQUIRED");
  const old = target.recordIds.map((id) =>
    baseline.find((r) => r.recordId === id),
  );
  if (!old.every(valid)) return abstain("INVALID_BASELINE_BINDING");
  const selected = [];
  for (const v of views) {
    if (
      !v.records.length ||
      !v.records.every(valid) ||
      v.records.some(
        (r, i) =>
          r.requestId !== v.requestId ||
          r.sourceStart < v.start - 1e-7 ||
          r.sourceEnd > v.end + 1e-7 ||
          (i > 0 && r.sourceStart < v.records[i - 1].sourceEnd - 1e-7),
      )
    )
      return abstain("INVALID_VIEW_TIME_OR_BINDING");
    const rows = v.records.filter((r) => overlaps(r, target));
    if (
      !rows.length ||
      rows[0].sourceStart <= v.start + 0.01 ||
      rows.at(-1).sourceEnd >= v.end - 0.01
    )
      return abstain("DONOR_TOUCHES_REQUEST_EDGE");
    if (
      Math.abs(rows[0].sourceStart - target.sourceStart) >
        seamRefinementPolicy.outerEnvelopeToleranceSeconds ||
      Math.abs(rows.at(-1).sourceEnd - target.sourceEnd) >
        seamRefinementPolicy.outerEnvelopeToleranceSeconds
    )
      return abstain("OUTER_ENVELOPE_DRIFT");
    selected.push(rows);
  }
  const [a, b] = selected,
    text = normalize(a.map((r) => r.text).join("")),
    other = normalize(b.map((r) => r.text).join(""));
  if (text !== other || a.length !== b.length)
    return abstain("TWO_VIEW_TEXT_OR_SEGMENTATION_DISAGREEMENT");
  if (
    a.some(
      (r, i) =>
        Math.abs(r.sourceStart - b[i].sourceStart) >
          seamRefinementPolicy.boundaryAgreementSeconds + 1e-7 ||
        Math.abs(r.sourceEnd - b[i].sourceEnd) >
          seamRefinementPolicy.boundaryAgreementSeconds + 1e-7,
    )
  )
    return abstain("TWO_VIEW_TIMING_DISAGREEMENT");
  const prefix = chars(old[0].text)
      .slice(0, seamRefinementPolicy.anchorCharacters)
      .join(""),
    suffix = chars(old.at(-1).text)
      .slice(-seamRefinementPolicy.anchorCharacters)
      .join("");
  if (!text.startsWith(prefix) || !text.endsWith(suffix))
    return abstain("OUTER_TEXT_ANCHORS_NOT_PRESERVED");
  const count = (s) => s.split(normalize(target.shared)).length - 1;
  const oldText = normalize(old.map((r) => r.text).join(""));
  if (
    count(oldText) < 2 ||
    count(text) !== 1 ||
    text.length < oldText.length * 0.6 ||
    text.length >= oldText.length
  )
    return abstain("NO_BOUNDED_DUPLICATE_REDUCTION");
  const unrelated = baseline.filter(
    (r) => !target.recordIds.includes(r.recordId),
  );
  if (a.some((r) => unrelated.some((x) => overlaps(r, x))))
    return abstain("NEIGHBOR_COLLISION");
  return {
    targetId: target.id,
    status: "CANDIDATE",
    reason: "TWO_VIEW_WHOLE_CUE_AGREEMENT_NOT_ACOUSTIC_TRUTH",
    replaceIds: target.recordIds,
    records: a,
    donorRequest: views[0].requestId,
  };
}
export function assembleSeams(baseline, decisions) {
  const applied = decisions.filter((d) => d.status === "CANDIDATE");
  const ids = applied.flatMap((d) => d.replaceIds);
  requireValue(new Set(ids).size === ids.length, "COMPETING_REPLACEMENTS");
  requireValue(
    ids.every((id) => baseline.some((r) => r.recordId === id)),
    "UNBOUND_REPLACEMENT",
  );
  const donors = applied.flatMap((d) => d.records);
  requireValue(donors.every(valid), "INVALID_DONOR");
  for (let i = 0; i < applied.length; i++)
    for (let j = i + 1; j < applied.length; j++)
      requireValue(
        !applied[i].records.some((a) =>
          applied[j].records.some((b) => overlaps(a, b)),
        ),
        "DONOR_COLLISION",
      );
  return [
    ...baseline.filter((r) => !ids.includes(r.recordId)),
    ...donors,
  ].toSorted((a, b) => a.sourceStart - b.sourceStart || a.order - b.order);
}
