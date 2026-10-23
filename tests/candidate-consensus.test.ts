import {
  applyCrossWindowConsensus,
  buildAcousticEventFamilies,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import { baselineCue, noVadCue, vadCue } from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 cross-window consensus", () => {
  it("collapses a stable family only in enforce mode", () => {
    const cues = [baselineCue, noVadCue, vadCue];
    const families = buildAcousticEventFamilies({ cues, mode: "enforce" });
    const observe = applyCrossWindowConsensus({
      cues,
      families: families.artifact,
      mode: "observe",
    });
    const enforce = applyCrossWindowConsensus({
      cues,
      families: families.artifact,
      mode: "enforce",
    });
    expect(observe.cues).toHaveLength(3);
    expect(enforce.cues).toHaveLength(1);
  });
});
