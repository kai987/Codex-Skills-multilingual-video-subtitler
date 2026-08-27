import {
  buildCueTimelineEvidence,
  buildGlobalTokenTimeline,
  enforceTimingNonDegradation,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  baselineCue,
  noVadCue,
  requestContract,
} from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 timing non-degradation", () => {
  it("accepts only a trusted, lexically covered boundary that does not add overlap", () => {
    const tokenTimeline = buildGlobalTokenTimeline({
      cues: [noVadCue],
      requestContract,
      mode: "enforce",
    });
    const evidence = buildCueTimelineEvidence({
      cues: [baselineCue],
      tokenTimeline,
      mode: "enforce",
    });
    const result = enforceTimingNonDegradation({
      cues: [baselineCue],
      evidence,
      mode: "enforce",
    });
    expect(result.artifact.summary.timingRegressionCount).toBe(0);
    expect(result.artifact.summary.acceptedMutationCount).toBe(1);
  });
});
