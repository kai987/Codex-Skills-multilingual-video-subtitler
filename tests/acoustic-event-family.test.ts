import { buildAcousticEventFamilies } from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import { baselineCue, noVadCue, vadCue } from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 acoustic event families", () => {
  it("groups correlated windows without treating each window as independent speech", () => {
    const result = buildAcousticEventFamilies({
      cues: [baselineCue, noVadCue, vadCue],
      mode: "enforce",
    });
    expect(result.artifact.summary.familyCount).toBe(1);
    expect(result.artifact.summary.collapsedDuplicateCount).toBe(2);
    expect(
      result.artifact.families[0]?.independentEvidenceGroupIds,
    ).toHaveLength(2);
  });
});
