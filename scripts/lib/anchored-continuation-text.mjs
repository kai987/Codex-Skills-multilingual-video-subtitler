/** Explicit offline proposal, not default promotion or acoustic alignment.
 * Caller verifies the frozen source/request bytes before supplying mapped views.
 * Retain the baseline opener; use only complete continuation segments from two views.
 */
export const anchoredContinuationPolicy = Object.freeze({
  version: "frozen-opener-complete-continuation-v1",
  minimumAnchorCharacters: 8,
  minimumCharacters: 16,
  maximumAddedCharacters: 8,
  minimumBodyCoverage: 0.8,
  maximumTargetSeconds: 13,
  maximumWindowSeconds: 15,
  maximumRecordCharacters: 4096,
  maximumViewRecords: 64,
  timing: "original-outer-envelope-no-substring-time",
  automaticPromotionAllowed: false,
  qualityStatus: "needs-review",
});
const norm = (text) => text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const chars = (text) => [...norm(text)];
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const overlaps = (a, b) =>
  a.sourceStart < b.sourceEnd && b.sourceStart < a.sourceEnd;
const valid = (r) =>
  r &&
  typeof r.recordId === "string" &&
  r.recordId &&
  typeof r.text === "string" &&
  norm(r.text).length > 0 &&
  Number.isFinite(r.sourceStart) &&
  Number.isFinite(r.sourceEnd) &&
  r.sourceStart >= 0 &&
  r.sourceEnd > r.sourceStart &&
  Array.isArray(r.issues) &&
  r.issues.length === 0;

export function proposeAnchoredContinuation(
  target,
  baseline,
  views,
  options = {},
) {
  const reject = (reason) => ({
    targetId: target?.id,
    status: "ABSTAIN",
    reason,
    replaceIds: [],
    records: [],
  });
  if (options?.language !== "ja" || !digest(options?.sourceAudioHash))
    return reject("EXPLICIT_SOURCE_AND_LANGUAGE_REQUIRED");
  if (
    !target ||
    !Array.isArray(baseline) ||
    !Array.isArray(views) ||
    typeof target.id !== "string" ||
    !target.id ||
    !Array.isArray(target.recordIds) ||
    target.recordIds.length !== 2 ||
    new Set(target.recordIds).size !== 2 ||
    !Number.isFinite(target.sourceStart) ||
    !Number.isFinite(target.sourceEnd) ||
    target.sourceEnd <= target.sourceStart ||
    target.sourceEnd - target.sourceStart >
      anchoredContinuationPolicy.maximumTargetSeconds
  )
    return reject("INVALID_TARGET");
  if (
    !baseline.every(
      (r) =>
        valid(r) &&
        r.text.length <= anchoredContinuationPolicy.maximumRecordCharacters,
    ) ||
    new Set(baseline.map((r) => r.recordId)).size !== baseline.length
  )
    return reject("INVALID_BASELINE");
  const positions = target.recordIds.map((id) =>
    baseline.findIndex((r) => r.recordId === id),
  );
  if (positions[0] < 0 || positions[1] !== positions[0] + 1)
    return reject("CONTIGUOUS_BASELINE_PAIR_REQUIRED");
  const old = positions.map((i) => baseline[i]);
  if (
    old[0].sourceStart > old[1].sourceStart ||
    !overlaps(old[0], old[1]) ||
    target.sourceStart !== Math.min(...old.map((r) => r.sourceStart)) ||
    target.sourceEnd !== Math.max(...old.map((r) => r.sourceEnd))
  )
    return reject("WHOLE_ORIGINAL_ENVELOPE_REQUIRED");
  if (
    baseline.some(
      (r) => !target.recordIds.includes(r.recordId) && overlaps(r, target),
    )
  )
    return reject("PROTECTED_NEIGHBOR_COLLISION");
  if (
    views.length !== 2 ||
    views[0]?.requestId === views[1]?.requestId ||
    views[0]?.audioHash === views[1]?.audioHash ||
    (views[0]?.start === views[1]?.start && views[0]?.end === views[1]?.end)
  )
    return reject("TWO_DISTINCT_VIEWS_REQUIRED");
  for (const view of views) {
    if (
      !view ||
      view.targetId !== target.id ||
      typeof view.requestId !== "string" ||
      !view.requestId ||
      !digest(view.audioHash) ||
      view.sourceAudioHash !== options.sourceAudioHash ||
      !Number.isFinite(view.start) ||
      !Number.isFinite(view.end) ||
      view.start < 0 ||
      view.start >= target.sourceStart ||
      view.end <= target.sourceEnd ||
      view.end - view.start > anchoredContinuationPolicy.maximumWindowSeconds ||
      !Array.isArray(view.records) ||
      !view.records.length ||
      view.records.length > anchoredContinuationPolicy.maximumViewRecords ||
      !view.records.every(
        (r) =>
          valid(r) &&
          r.text.length <= anchoredContinuationPolicy.maximumRecordCharacters,
      ) ||
      new Set(view.records.map((r) => r.recordId)).size !==
        view.records.length ||
      view.records.some(
        (r, i) =>
          r.requestId !== view.requestId ||
          r.sourceStart < view.start - 1e-7 ||
          r.sourceEnd > view.end + 1e-7 ||
          (i > 0 && r.sourceStart < view.records[i - 1].sourceEnd - 1e-7),
      )
    )
      return reject("INVALID_VIEW_TIME_OR_SOURCE_BINDING");
  }
  if (
    new Set(views.flatMap((v) => v.records.map((r) => r.recordId))).size !==
    views.reduce((n, v) => n + v.records.length, 0)
  )
    return reject("DUPLICATE_DONOR_IDENTITY");
  const original = norm(old.map((r) => r.text).join(""));
  if (chars(original).length < anchoredContinuationPolicy.minimumCharacters)
    return reject("SHORT_TARGET_PROTECTED");
  const seamAt = chars(old[0].text).length;
  const tail = chars(old[1].text)
    .slice(-anchoredContinuationPolicy.minimumAnchorCharacters)
    .join("");
  const found = [];
  // The retained opener is copied from the baseline, never exported from a donor substring.
  const raw = [...old[0].text];
  for (let cut = 1; cut < raw.length; cut++) {
    const prefix = raw.slice(0, cut).join(""),
      normalizedPrefix = norm(prefix);
    if (
      chars(prefix).length < anchoredContinuationPolicy.minimumAnchorCharacters
    )
      continue;
    const remainder = norm(raw.slice(cut).join(""));
    if (
      chars(remainder).length <
      anchoredContinuationPolicy.minimumAnchorCharacters
    )
      continue;
    const bodyAnchor = chars(remainder)
      .slice(0, anchoredContinuationPolicy.minimumAnchorCharacters)
      .join("");
    const matches = views.map((view) => {
      const candidates = [];
      const occurrences = (s, phrase) => s.split(phrase).length - 1;
      const allText = norm(view.records.map((r) => r.text).join(""));
      if (occurrences(allText, normalizedPrefix) !== 1) return candidates;
      for (let i = 1; i < view.records.length; i++) {
        const opener = view.records[i - 1];
        if (
          !norm(opener.text).endsWith(normalizedPrefix) ||
          opener.sourceStart >= target.sourceStart ||
          opener.sourceEnd <= target.sourceStart ||
          opener.sourceEnd >= target.sourceEnd
        )
          continue;
        for (let j = i; j < view.records.length; j++) {
          const rows = view.records.slice(i, j + 1);
          if (
            rows.some(
              (r) =>
                r.sourceStart < target.sourceStart - 1e-7 ||
                r.sourceEnd > target.sourceEnd + 1e-7,
            )
          )
            continue;
          const body = rows.map((r) => r.text).join(""),
            text = norm(body);
          if (
            !text.startsWith(bodyAnchor) ||
            !text.endsWith(tail) ||
            !text.endsWith(norm(old[1].text))
          )
            continue;
          const covered = rows.reduce(
            (n, r) => n + r.sourceEnd - r.sourceStart,
            0,
          );
          if (
            covered / (target.sourceEnd - target.sourceStart) <
            anchoredContinuationPolicy.minimumBodyCoverage
          )
            continue;
          // Fail closed on multiple possible body occurrences or continuation boundaries.
          if (
            occurrences(allText, bodyAnchor) !== 1 ||
            occurrences(allText, norm(old[1].text)) !== 1
          )
            continue;
          candidates.push({
            body,
            normalized: text,
            donorIds: rows.map((r) => r.recordId),
            openerId: opener.recordId,
            originalOpenerRetained: prefix,
            donorInterval: [rows[0].sourceStart, rows.at(-1).sourceEnd],
          });
        }
      }
      return candidates;
    });
    if (
      matches.some((list) => list.length !== 1) ||
      matches[0][0].normalized !== matches[1][0].normalized
    )
      continue;
    const candidate = normalizedPrefix + matches[0][0].normalized;
    const a = [...original],
      b = [...candidate],
      added = b.length - a.length;
    if (
      added <= 0 ||
      added > anchoredContinuationPolicy.maximumAddedCharacters ||
      b.slice(0, seamAt).join("") !== a.slice(0, seamAt).join("") ||
      b.slice(seamAt + added).join("") !== a.slice(seamAt).join("")
    )
      continue;
    const shared = typeof target.shared === "string" ? norm(target.shared) : "";
    if (
      shared &&
      original.split(shared).length !== candidate.split(shared).length
    )
      continue;
    found.push({
      prefix,
      views: matches.map((list) => list[0]),
      addedText: b.slice(seamAt, seamAt + added).join(""),
      at: seamAt,
      text: prefix + matches[0][0].body,
    });
  }
  // Baseline spaces/punctuation can yield several raw cuts with the same semantic
  // prefix and exact donor identities. This is not competing content or evidence.
  const unique = new Map();
  for (const foundItem of found) {
    const key = JSON.stringify([
      norm(foundItem.prefix),
      foundItem.views.map((v) => [v.openerId, v.donorIds]),
      foundItem.at,
      foundItem.addedText,
      norm(foundItem.text),
    ]);
    const prior = unique.get(key);
    if (!prior || foundItem.prefix.length > prior.prefix.length)
      unique.set(key, foundItem);
  }
  if (unique.size !== 1)
    return reject("NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION");
  const chosen = unique.values().next().value;
  return {
    targetId: target.id,
    status: "CANDIDATE",
    reason: "FROZEN_OPENER_AND_COMPLETE_CONTINUATION_AGREE",
    replaceIds: [...target.recordIds],
    records: [
      {
        recordId: `${target.id}-anchored-continuation`,
        order: old[0].order,
        text: chosen.text,
        sourceStart: target.sourceStart,
        sourceEnd: target.sourceEnd,
        issues: [],
        requestId: views[0].requestId,
        ...(old[0].chunkIndex === undefined
          ? {}
          : { chunkIndex: old[0].chunkIndex }),
      },
    ],
    evidence: {
      preservedBaselineOpener: chosen.prefix,
      insertion: {
        text: chosen.addedText,
        at: chosen.at,
        unit: "normalized-codepoint-not-time",
      },
      views: chosen.views,
      originalTextRetainedInOrder: true,
      sharedPhraseCountPreserved: true,
      substringTimeInferred: false,
      sameRelatedModelViewsNotIndependentModels: true,
    },
    policy: anchoredContinuationPolicy,
    newInference: 0,
    referenceUsed: false,
    acousticTimingVerified: false,
    humanValidated: false,
    finalizationMethod: "none",
    qualityStatus: "needs-review",
    automaticPromotionAllowed: false,
  };
}
