import { proposeSeamTextOnly, seamTextOnlyPolicy } from "./seam-text-only.mjs";
const norm = (s) => s.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const chars = (s) => [...norm(s)];
const overlap = (a, b) =>
  a.sourceStart < b.sourceEnd && b.sourceStart < a.sourceEnd;
export const contextTextPolicy = Object.freeze({
  version: "seam-context-whole-donor-v1",
  timing: "original-outer-envelope-no-acoustic-alignment",
  contextPrefixTextVerified: false,
  automaticFinalization: false,
});

/** One whole cue supplies text; another crop corroborates a unique punctuated suffix.
 * No substring timestamps, fuzzy text correction, or deletion of outside records.
 */
export function proposeContextText(target, baseline, views) {
  const original = proposeSeamTextOnly(target, baseline, views);
  if (original.reason !== "NO_UNIQUE_WHOLE_TEXT_GROUP") return original;
  const reject = (reason) => ({
    targetId: target.id,
    status: "ABSTAIN",
    reason,
    replaceIds: [],
    records: [],
  });
  if (
    views.some(
      (v) =>
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
        ),
    )
  )
    return reject("INVALID_CONTEXT_VIEW");
  const old = target.recordIds.map((id) =>
    baseline.find((r) => r.recordId === id),
  );
  const prefix = chars(old[0].text).slice(0, 4).join(""),
    suffix = chars(old.at(-1).text).slice(-4).join("");
  const coverage = (rows) =>
    rows.reduce(
      (s, r) =>
        s +
        Math.max(
          0,
          Math.min(r.sourceEnd, target.sourceEnd) -
            Math.max(r.sourceStart, target.sourceStart),
        ),
      0,
    ) /
    (target.sourceEnd - target.sourceStart);
  const groups = views.map((v) => {
    const all = [];
    for (let i = 0; i < v.records.length; i++)
      for (let j = i; j < v.records.length; j++) {
        const rows = v.records.slice(i, j + 1),
          text = norm(rows.map((r) => r.text).join(""));
        if (
          text.startsWith(prefix) &&
          text.endsWith(suffix) &&
          [...text].length >= seamTextOnlyPolicy.minimumCharacters &&
          coverage(rows) >= seamTextOnlyPolicy.minimumTargetTimeCoverage
        )
          all.push({ rows, index: i });
      }
    return all;
  });
  const ownerIndex = groups.findIndex(
    (g, i) =>
      g.length === 1 && g[0].rows.length === 1 && groups[1 - i].length === 0,
  );
  if (ownerIndex < 0) return reject("NO_SINGLE_WHOLE_DONOR_FOR_CONTEXT_ROUTE");
  const owner = groups[ownerIndex][0],
    donor = owner.rows[0],
    text = norm(donor.text),
    other = views[1 - ownerIndex];
  const matches = other.records.filter((r) => norm(r.text).includes(text));
  if (matches.length !== 1) return reject("NON_UNIQUE_CONTEXT_OCCURRENCE");
  const containing = matches[0],
    normalized = norm(containing.text),
    at = normalized.indexOf(text);
  if (
    at <= 0 ||
    normalized.indexOf(text, at + 1) >= 0 ||
    !normalized.endsWith(text)
  )
    return reject("NOT_UNIQUE_PREFIX_CONTEXT_SUFFIX");
  // Do not export a substring. Require a visible boundary before the corroborated suffix.
  const cuts = [...containing.text.matchAll(/[、。！？!?]/gu)]
    .map((m) => m.index + m[0].length)
    .filter(
      (i) =>
        norm(containing.text.slice(i)) === text &&
        norm(containing.text.slice(0, i)),
    );
  if (cuts.length !== 1) return reject("NO_UNIQUE_PUNCTUATED_CONTEXT_BOUNDARY");
  if (
    coverage([containing]) < seamTextOnlyPolicy.minimumTargetTimeCoverage ||
    containing.sourceStart >= target.sourceStart
  )
    return reject("CONTEXT_NOT_SOURCE_BOUND");
  const prior = views[ownerIndex].records[owner.index - 1];
  if (!prior || chars(prior.text).length < 4)
    return reject("NO_INDEPENDENT_PRECEDING_CUE");
  const owners = baseline.filter(
    (r) =>
      !target.recordIds.includes(r.recordId) &&
      r.sourceEnd <= target.sourceStart + 1e-7 &&
      r.sourceStart <= containing.sourceStart &&
      r.sourceEnd > containing.sourceStart &&
      overlap(r, prior) &&
      norm(r.text).endsWith(norm(prior.text)),
  );
  if (owners.length !== 1) return reject("PRECEDING_CONTEXT_OWNER_UNRESOLVED");
  if (
    baseline.some(
      (r) => !target.recordIds.includes(r.recordId) && overlap(r, target),
    )
  )
    return reject("TARGET_ENVELOPE_INTERSECTS_PROTECTED_CUE");
  const before = norm(old.map((r) => r.text).join("")),
    shared = norm(target.shared);
  const count = (s) => s.split(shared).length - 1;
  if (
    !shared ||
    count(before) < 2 ||
    count(text) !== 1 ||
    [...text].length >= [...before].length ||
    [...text].length <
      [...before].length * seamTextOnlyPolicy.minimumRetainedRatio
  )
    return reject("NO_BOUNDED_DUPLICATE_REDUCTION");
  return {
    targetId: target.id,
    status: "CANDIDATE",
    reason: "WHOLE_DONOR_WITH_UNIQUE_CONTEXT_SUFFIX_SUPPORT",
    replaceIds: target.recordIds,
    records: [
      {
        recordId: `${target.id}-context-text`,
        order: 1,
        text: donor.text,
        sourceStart: target.sourceStart,
        sourceEnd: target.sourceEnd,
        issues: [],
        requestId: donor.requestId,
        chunkIndex: old[0].chunkIndex,
      },
    ],
    evidence: {
      wholeDonorId: donor.recordId,
      supportingDonorId: containing.recordId,
      precedingViewCueId: prior.recordId,
      preservedNeighborId: owners[0].recordId,
      contextPrefix: containing.text.slice(0, cuts[0]),
      contextPrefixTextVerified: false,
      normalizedSpan: {
        start: at,
        end: at + text.length,
        unit: "normalized-UTF16-not-time",
      },
      substringTimeInferred: false,
    },
    timingPolicy: contextTextPolicy.timing,
    acousticTimingVerified: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
