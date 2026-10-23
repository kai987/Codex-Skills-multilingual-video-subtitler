/** Offline same-model crop association. No inference, text rewrite or time repair. */
import assert from "node:assert/strict";
import { localAcousticPolicy } from "./local-acoustic-policy.mjs";
const norm = (text) => text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const overlap = (a, b) => Math.min(a.end, b.end) > Math.max(a.start, b.start);
const valid = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start;
export function reviewCandidateBoundaries(target, views) {
  assert(valid(target), "INVALID_TARGET");
  assert(
    views.length === 2 && new Set(views.map((v) => v.id)).size === 2,
    "TWO_DISTINCT_VIEWS_REQUIRED",
  );
  assert(
    views.some((v) => v.start !== views[0].start || v.end !== views[0].end),
    "DUPLICATE_CROP",
  );
  for (const v of views)
    assert(
      valid(v) &&
        v.targetId === target.id &&
        Array.isArray(v.records) &&
        v.records.every(
          (r) =>
            valid(r) &&
            typeof r.text === "string" &&
            r.start >= v.start - 1e-6 &&
            r.end <= v.end + 1e-6,
        ),
      "INVALID_VIEW_TIMEBASE",
    );
  const rows = views.map((v) =>
    v.records.map((r, i) => ({
      id: `${v.id}/segment-${i + 1}`,
      viewId: v.id,
      index: i,
      ...r,
      normalizedText: norm(r.text),
      targetOverlap: overlap(r, target),
      boundaryFlags: [
        ...(r.start - v.start <= 0.02 + 1e-6
          ? ["START_AT_EXTRACTION_EDGE"]
          : []),
        ...(v.end - r.end <= 0.02 + 1e-6 ? ["END_AT_EXTRACTION_EDGE"] : []),
      ],
      timingAuthority: "UNVERIFIED_ASR_SEGMENT",
      wordTimeEvidenceAvailable: false,
    })),
  );
  const links = [];
  for (const a of rows[0])
    for (const b of rows[1]) {
      if (!overlap(a, b) || (!a.targetOverlap && !b.targetOverlap)) continue;
      const exact =
        a.normalizedText !== "" && a.normalizedText === b.normalizedText;
      const containment =
        !exact &&
        Math.min([...a.normalizedText].length, [...b.normalizedText].length) >=
          4 &&
        (a.normalizedText.includes(b.normalizedText) ||
          b.normalizedText.includes(a.normalizedText));
      if (!exact && !containment) continue;
      const blockers = [
        "SAME_MODEL_CROPS_NOT_INDEPENDENT_SUPPORT",
        "ACOUSTIC_BOUNDARIES_NOT_VERIFIED",
        ...a.boundaryFlags,
        ...b.boundaryFlags,
      ];
      if (containment)
        blockers.push(
          "CONTAINMENT_NOT_WHOLE_UTTERANCE_AGREEMENT",
          "SUBSTRING_HAS_NO_LOCALIZED_WORD_TIMES",
        );
      const startDelta = Math.round(Math.abs(a.start - b.start) * 1000) / 1000,
        endDelta = Math.round(Math.abs(a.end - b.end) * 1000) / 1000;
      if (
        Math.max(startDelta, endDelta) >
        localAcousticPolicy.boundaryToleranceSeconds
      )
        blockers.push("PARENT_BOUNDARIES_DISAGREE");
      links.push({
        left: a.id,
        right: b.id,
        relation: exact ? "whole-text-exact" : "text-containment-only",
        startDelta,
        endDelta,
        boundaryDeltaMeaning: exact
          ? "same-whole-text-segment-estimates"
          : "different-text-parent-spans-not-substring-boundaries",
        blockers: [...new Set(blockers)],
        proposedText: null,
        proposedInterval: null,
        automaticReplacementAllowed: false,
      });
    }
  for (const link of links)
    if (
      links.filter((l) => l.left === link.left || l.right === link.right)
        .length > 1
    )
      link.blockers.push("AMBIGUOUS_OCCURRENCE_ASSOCIATION");
  const linked = new Set(links.flatMap((l) => [l.left, l.right]));
  return {
    target,
    views: rows,
    links,
    unmatchedTargetSegments: rows
      .flat()
      .filter((r) => r.targetOverlap && !linked.has(r.id))
      .map((r) => r.id),
    disposition: links.some((l) => l.relation === "whole-text-exact")
      ? "WHOLE_TEXT_LINK_REQUIRES_ACOUSTIC_BOUNDARIES"
      : links.length
        ? "PARTIAL_TEXT_LINK_REQUIRES_UTTERANCE_ISOLATION"
        : "TEXT_DISAGREEMENT_REQUIRES_NEW_EVIDENCE",
    inferenceRequests: 0,
    proposedRepair: null,
    automaticReplacementAllowed: false,
    qualityStatus: "needs-review",
  };
}
