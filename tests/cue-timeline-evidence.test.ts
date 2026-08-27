import {
  buildCueTimelineEvidence,
  buildGlobalTokenTimeline,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  baselineCue,
  noVadCue,
  requestContract,
} from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 cue timeline evidence", () => {
  it("requires localized lexical token coverage", () => {
    const tokenTimeline = buildGlobalTokenTimeline({
      cues: [noVadCue],
      requestContract,
      mode: "enforce",
    });
    const artifact = buildCueTimelineEvidence({
      cues: [baselineCue],
      tokenTimeline,
      mode: "enforce",
    });
    expect(artifact.cues[0]?.timingEligible).toBe(true);
  });
});
