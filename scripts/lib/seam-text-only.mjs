/** Offline text-only proposal. Keeps the old whole-target time envelope, never claims retiming. */
export const seamTextOnlyPolicy = Object.freeze({
  version: "seam-text-only-two-view-v1",
  minimumCharacters: 16,
  anchorCharacters: 4,
  minimumRetainedRatio: 0.6,
  minimumTargetTimeCoverage: 0.8,
  timing: "original-outer-envelope-no-acoustic-alignment",
  qualityStatus: "needs-review",
});
const norm = (s) => s.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const cp = (s) => Array.from(norm(s));
export function proposeSeamTextOnly(target, baseline, views) {
  const reject = (reason) => ({
    targetId: target.id,
    status: "ABSTAIN",
    reason,
    replaceIds: [],
    records: [],
  });
  if (
    views.length !== 2 ||
    views[0].audioHash === views[1].audioHash ||
    views[0].requestId === views[1].requestId
  )
    return reject("TWO_DISTINCT_VIEWS_REQUIRED");
  const old = target.recordIds.map((id) =>
    baseline.find((r) => r.recordId === id),
  );
  if (old.some((r) => !r || r.issues.length) || old.length < 2)
    return reject("INVALID_WHOLE_BASELINE");
  const prefix = cp(old[0].text).slice(0, 4).join(""),
    suffix = cp(old.at(-1).text).slice(-4).join("");
  const texts = [];
  for (const v of views) {
    if (
      !v.records.length ||
      v.records.some(
        (r, i) =>
          r.issues.length ||
          r.requestId !== v.requestId ||
          !Number.isFinite(r.sourceStart) ||
          !Number.isFinite(r.sourceEnd) ||
          r.sourceEnd <= r.sourceStart ||
          r.sourceStart < v.start - 1e-7 ||
          r.sourceEnd > v.end + 1e-7 ||
          (i > 0 && r.sourceStart < v.records[i - 1].sourceEnd - 1e-7),
      )
    )
      return reject("INVALID_VIEW");
    const candidates = [];
    for (let i = 0; i < v.records.length; i++)
      for (let j = i; j < v.records.length; j++) {
        const rows = v.records.slice(i, j + 1),
          text = rows.map((r) => r.text).join(""),
          n = norm(text);
        if (
          !n.startsWith(prefix) ||
          !n.endsWith(suffix) ||
          cp(text).length < seamTextOnlyPolicy.minimumCharacters
        )
          continue;
        // Whole donor groups only. Do not slice substrings or invent word boundaries.
        let covered = 0,
          previousEnd = target.sourceStart;
        for (const r of rows) {
          const start = Math.max(
              previousEnd,
              target.sourceStart,
              r.sourceStart,
            ),
            end = Math.min(target.sourceEnd, r.sourceEnd);
          covered += Math.max(0, end - start);
          previousEnd = Math.max(previousEnd, end);
        }
        if (
          covered / (target.sourceEnd - target.sourceStart) <
          seamTextOnlyPolicy.minimumTargetTimeCoverage
        )
          continue;
        candidates.push({
          text,
          normalized: n,
          donorIds: rows.map((r) => r.recordId),
          interval: [rows[0].sourceStart, rows.at(-1).sourceEnd],
        });
      }
    if (candidates.length !== 1) return reject("NO_UNIQUE_WHOLE_TEXT_GROUP");
    texts.push(candidates[0]);
  }
  if (texts[0].normalized !== texts[1].normalized)
    return reject("TWO_VIEW_TEXT_CONFLICT");
  const original = norm(old.map((r) => r.text).join("")),
    candidate = texts[0].normalized;
  const shared = norm(target.shared),
    count = (text) => text.split(shared).length - 1;
  if (
    !shared ||
    count(original) < 2 ||
    count(candidate) !== 1 ||
    cp(candidate).length <
      cp(original).length * seamTextOnlyPolicy.minimumRetainedRatio ||
    cp(candidate).length >= cp(original).length
  )
    return reject("NO_BOUNDED_DUPLICATE_REDUCTION");
  return {
    targetId: target.id,
    status: "CANDIDATE",
    reason: "WHOLE_TEXT_AGREES_TIMING_RETAINED_NOT_REALIGNED",
    replaceIds: target.recordIds,
    records: [
      {
        recordId: `${target.id}-text-only`,
        order: 1,
        text: texts[0].text,
        sourceStart: target.sourceStart,
        sourceEnd: target.sourceEnd,
        issues: [],
        requestId: views[0].requestId,
        chunkIndex: old[0].chunkIndex,
      },
    ],
    textEvidence: texts,
    timingPolicy: seamTextOnlyPolicy.timing,
    acousticTimingVerified: false,
  };
}
