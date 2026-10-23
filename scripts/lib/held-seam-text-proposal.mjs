/** Explicit inspection only. Never makes an invalid model view pass a timing gate. */
export const heldSeamTextPolicy = Object.freeze({
  version: "held-seam-counter-text-inspection-v1",
  comparisonMapping: "standalone-counter-1つ-to-一つ-only",
  timing: "original-outer-envelope-no-acoustic-alignment",
  maximumDiagnosticOvershoot: 0.1,
  automaticPromotionAllowed: false,
});
const norm = (s) => s.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const project = (s) => norm(s).replace(/(?<![0-9])1つ/gu, "一つ");
const validTime = (r) =>
  Number.isFinite(r.sourceStart) &&
  Number.isFinite(r.sourceEnd) &&
  r.sourceEnd > r.sourceStart;
const clean = (r) =>
  r &&
  typeof r.text === "string" &&
  norm(r.text) &&
  Array.isArray(r.issues) &&
  !r.issues.length &&
  validTime(r);
const overlap = (a, b) =>
  a.sourceStart < b.sourceEnd && b.sourceStart < a.sourceEnd;
const count = (text, shared) => text.split(shared).length - 1;

/** Caller must first verify frozen bytes and exact source-PCM crop binding.
 * Raw records are retained even when a separate baseline-time text copy is possible.
 * This is not a recovery pass, a timing tolerance, or default generation policy.
 */
export function proposeHeldSeamText(target, baseline, views, options = {}) {
  const reject = (reason, timingIssues = []) => ({
    targetId: target?.id,
    status: "ABSTAIN",
    reason,
    replaceIds: [],
    records: [],
    timingIssues,
    automaticPromotionAllowed: false,
  });
  const hash = (s) => typeof s === "string" && /^[a-f0-9]{64}$/u.test(s);
  if (
    options?.language !== "ja" ||
    !hash(options.sourceAudioHash) ||
    !target?.id ||
    target.shared !== "一つ" ||
    !validTime(target) ||
    target.sourceEnd - target.sourceStart > 13 ||
    !Array.isArray(target.recordIds) ||
    target.recordIds.length !== 2 ||
    new Set(target.recordIds).size !== 2 ||
    !Array.isArray(baseline) ||
    baseline.some((r) => !r || typeof r.recordId !== "string") ||
    new Set(baseline.map((r) => r.recordId)).size !== baseline.length
  )
    return reject("INVALID_TARGET_BINDING");
  const at = baseline.findIndex((r) => r.recordId === target.recordIds[0]);
  const old = baseline.slice(at, at + 2);
  const preceding = baseline[at - 1],
    following = baseline[at + 2];
  if (
    at < 1 ||
    old[1]?.recordId !== target.recordIds[1] ||
    ![...old, preceding, following].every(clean) ||
    old[0].sourceStart !== target.sourceStart ||
    old[1].sourceEnd !== target.sourceEnd ||
    old[1].sourceStart >= old[0].sourceEnd ||
    old[1].sourceStart < old[0].sourceStart ||
    old[0].sourceEnd > old[1].sourceEnd ||
    preceding.sourceEnd > target.sourceStart ||
    following.sourceStart < target.sourceEnd ||
    baseline.some(
      (r) => !target.recordIds.includes(r.recordId) && overlap(r, target),
    )
  )
    return reject("INVALID_OR_INTERSECTING_BASELINE");
  const left = old[0].text.trimEnd(),
    right = old[1].text.trimStart(),
    shared = target.shared;
  if (
    left !== old[0].text ||
    right !== old[1].text ||
    !left.endsWith(shared) ||
    !right.startsWith(shared)
  )
    return reject("NO_LITERAL_COUNTER_SEAM");
  const text = left + right.slice(shared.length),
    candidate = norm(text),
    original = norm(old.map((r) => r.text).join(""));
  if (
    count(original, shared) !== 2 ||
    count(candidate, shared) !== 1 ||
    original !== norm(left) + shared + norm(right.slice(shared.length)) ||
    [...candidate].length < 16
  )
    return reject("NOT_EXACT_SINGLE_SEAM_DELETION");
  if (
    !Array.isArray(views) ||
    views.length !== 2 ||
    views.some((v) => !v || typeof v !== "object") ||
    views[0].requestId === views[1].requestId ||
    views[0].audioHash === views[1].audioHash ||
    (views[0].start === views[1].start && views[0].end === views[1].end)
  )
    return reject("TWO_DISTINCT_SOURCE_VIEWS_REQUIRED");
  const timingIssues = [];
  for (const v of views) {
    if (
      v.targetId !== target.id ||
      typeof v.requestId !== "string" ||
      !v.requestId ||
      !hash(v.audioHash) ||
      v.sourceAudioHash !== options.sourceAudioHash ||
      !Number.isFinite(v.start) ||
      !Number.isFinite(v.end) ||
      v.start < 0 ||
      v.end <= v.start ||
      v.end - v.start > 15 ||
      v.start > target.sourceStart ||
      v.end < target.sourceEnd ||
      !Array.isArray(v.records) ||
      !v.records.length ||
      v.records.some((r) => !r || typeof r.recordId !== "string") ||
      new Set(v.records.map((r) => r.recordId)).size !== v.records.length
    )
      return reject("INVALID_VIEW_BINDING");
    for (let i = 0; i < v.records.length; i++) {
      const r = v.records[i];
      if (
        !clean(r) ||
        !r.recordId ||
        r.requestId !== v.requestId ||
        r.sourceStart < v.start ||
        r.sourceStart >= v.end ||
        (i > 0 && r.sourceStart < v.records[i - 1].sourceEnd - 1e-7)
      )
        return reject("INVALID_OR_NONCHRONOLOGICAL_RAW_RECORD", timingIssues);
      if (r.sourceEnd > v.end + 1e-7)
        timingIssues.push({
          code: "END_AFTER_REQUEST_AUDIO",
          requestId: v.requestId,
          recordId: r.recordId,
          rawSourceEnd: r.sourceEnd,
          requestSourceEnd: v.end,
          excessSeconds: r.sourceEnd - v.end,
          rawPreserved: true,
          timestampCorrected: false,
          usedInCandidate: false,
        });
    }
  }
  const rawIds = views.flatMap((v) => v.records.map((r) => r.recordId));
  if (new Set(rawIds).size !== rawIds.length)
    return reject("CROSS_VIEW_RECORD_ID_COLLISION", timingIssues);
  // The 0.1s limit only bounds eligibility to inspect text; it never accepts time.
  if (
    timingIssues.length !== 1 ||
    timingIssues[0].excessSeconds >
      heldSeamTextPolicy.maximumDiagnosticOvershoot + 1e-7
  )
    return reject("NOT_ONE_BOUNDED_FOLLOWING_DIAGNOSTIC", timingIssues);
  const matches = views.flatMap((v, viewIndex) =>
    v.records
      .map((r, index) => ({ r, index, viewIndex }))
      .filter(({ r }) => project(r.text) === candidate),
  );
  if (matches.length !== 1)
    return reject("NO_UNIQUE_WHOLE_TEXT_DONOR", timingIssues);
  const { r: donor, index, viewIndex } = matches[0],
    owner = views[viewIndex],
    other = views[1 - viewIndex],
    prior = owner.records[index - 1];
  if (
    donor.sourceEnd > owner.end ||
    Math.abs(donor.sourceStart - target.sourceStart) > 0.5 ||
    Math.abs(donor.sourceEnd - target.sourceEnd) > 0.5 ||
    !prior ||
    [...norm(prior.text)].length < 4 ||
    !norm(preceding.text).endsWith(norm(prior.text)) ||
    !overlap(prior, preceding)
  )
    return reject("WHOLE_DONOR_NOT_SOURCE_BOUND", timingIssues);
  const supports = other.records.filter((r) =>
    project(r.text).includes(candidate),
  );
  if (supports.length !== 1)
    return reject("CONTEXT_OCCURRENCE_NOT_UNIQUE", timingIssues);
  const support = supports[0],
    normalized = project(support.text),
    offset = normalized.indexOf(candidate),
    prefix = normalized.slice(0, offset);
  if (
    offset < 4 ||
    !normalized.endsWith(candidate) ||
    normalized.indexOf(candidate, offset + 1) >= 0 ||
    !norm(preceding.text).endsWith(prefix) ||
    support.sourceStart < preceding.sourceStart ||
    support.sourceStart >= preceding.sourceEnd ||
    Math.abs(support.sourceEnd - target.sourceEnd) > 0.5 ||
    support.sourceEnd > other.end
  )
    return reject("UNIQUE_PROTECTED_PREFIX_NOT_BOUND", timingIssues);
  const owners = baseline.filter(
    (r) =>
      clean(r) &&
      r.sourceEnd <= target.sourceStart &&
      r.sourceStart <= support.sourceStart &&
      r.sourceEnd > support.sourceStart &&
      overlap(r, prior) &&
      norm(r.text).endsWith(prefix) &&
      norm(r.text).endsWith(norm(prior.text)),
  );
  if (owners.length !== 1 || owners[0].recordId !== preceding.recordId)
    return reject("PROTECTED_CONTEXT_OWNER_NOT_UNIQUE", timingIssues);
  const issue = timingIssues[0],
    invalidView = views.find((v) => v.requestId === issue.requestId),
    invalid = invalidView.records.at(-1);
  if (
    invalid.recordId !== issue.recordId ||
    invalid.sourceStart < target.sourceEnd ||
    !overlap(invalid, following) ||
    norm(invalid.text) !== norm(following.text) ||
    invalid.recordId === donor.recordId ||
    invalid.recordId === support.recordId
  )
    return reject(
      "INVALID_TIME_TOUCHES_TARGET_OR_UNKNOWN_CONTEXT",
      timingIssues,
    );
  const mappings = [donor, support].map((r) => ({
    recordId: r.recordId,
    originalText: r.text,
    projectedText: project(r.text),
    positions: [...norm(r.text).matchAll(/(?<![0-9])1つ/gu)].map((m) => ({
      offset: m.index,
      from: "1つ",
      to: "一つ",
      unit: "normalized-UTF16-not-time",
    })),
  }));
  return {
    targetId: target.id,
    status: "REVIEW_ONLY_TEXT_PROPOSAL",
    reason: "BASELINE_SINGLE_SEAM_DELETION_WITH_HELD_RAW_TIMING",
    replaceIds: [...target.recordIds],
    records: [
      {
        recordId: `${target.id}-held-text-inspection`,
        order: old[0].order,
        text,
        sourceStart: target.sourceStart,
        sourceEnd: target.sourceEnd,
        issues: [],
        requestId: donor.requestId,
        ...(old[0].chunkIndex === undefined
          ? {}
          : { chunkIndex: old[0].chunkIndex }),
      },
    ],
    timingIssues,
    modelTimingIntegrity: {
      status: "HOLD",
      invalidViews: [issue.requestId],
      rawPreserved: true,
      timestampCorrected: false,
    },
    rawViews: views,
    evidence: {
      wholeDonorId: donor.recordId,
      supportingParentId: support.recordId,
      preservedPrecedingId: preceding.recordId,
      preservedFollowingId: following.recordId,
      contextPrefix: prefix,
      mappings,
      sharedCountBefore: 2,
      sharedCountAfter: 1,
      substringTimeInferred: false,
      contextPrefixTextVerified: false,
    },
    inspectableOnly: true,
    newInference: 0,
    automaticPromotionAllowed: false,
    qualityStatus: "needs-review",
    humanValidated: false,
    finalizationMethod: "none",
    acousticTimingVerified: false,
    timingPolicy: heldSeamTextPolicy.timing,
  };
}
