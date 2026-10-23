import { classifyOverlapEvents } from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import { baselineCue, noVadCue } from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 overlap event classification", () => {
  it("classifies high-IoU identical text as one acoustic event", () => {
    const artifact = classifyOverlapEvents({
      cues: [baselineCue, noVadCue],
      mode: "enforce",
    });
    expect(artifact.pairs[0]?.classification).toBe("DUPLICATE_EVENT_OVERLAP");
    expect(artifact.pairs[0]?.automaticallyResolved).toBe(false);
  });
});
