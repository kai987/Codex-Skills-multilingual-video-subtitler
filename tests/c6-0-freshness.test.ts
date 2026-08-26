import { describe, expect, it } from "vitest";

import { determineC60FreshnessStatus } from "@mvl/video-subtitler";

const valid = {
  laterEvidencePresent: true,
  targetRecovered: true,
  cueIdentityMatched: true,
  canonicalHashMatched: true,
  timingHashMatched: true,
  semanticSubjectMatched: true,
  lineageCompatible: true,
  canonicalTextChanged: false,
  canonicalTimingChanged: false,
};

describe("C6.0 evidence freshness", () => {
  it("supersedes only strict same-cue, same-lineage later evidence", () => {
    expect(determineC60FreshnessStatus(valid)).toBe("superseded");
    expect(
      determineC60FreshnessStatus({ ...valid, targetRecovered: false }),
    ).toBe("current");
  });

  it.each([
    ["missing-later-evidence", { laterEvidencePresent: false }],
    ["cue-mismatch", { cueIdentityMatched: false }],
    ["hash-mismatch", { canonicalHashMatched: false }],
    ["timing-changed", { timingHashMatched: false }],
    ["subject-mismatch", { semanticSubjectMatched: false }],
    ["canonical-changed", { canonicalTextChanged: true }],
    ["timing-changed", { canonicalTimingChanged: true }],
    ["lineage-mismatch", { lineageCompatible: false }],
  ] as const)("returns %s when the evidence contract fails", (expected, patch) => {
    expect(determineC60FreshnessStatus({ ...valid, ...patch })).toBe(expected);
  });
});
