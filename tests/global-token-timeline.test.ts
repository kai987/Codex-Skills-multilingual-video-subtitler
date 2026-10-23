import { buildGlobalTokenTimeline } from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  noVadCue,
  requestContract,
  vadCue,
} from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 global token timeline", () => {
  it("maps verified no-VAD tokens and never maps unverified VAD tokens", () => {
    const artifact = buildGlobalTokenTimeline({
      cues: [noVadCue, vadCue],
      requestContract,
      mode: "enforce",
    });
    expect(artifact.tokens.filter((token) => token.trusted)).toHaveLength(3);
    expect(
      artifact.tokens.filter(
        (token) => token.mappingMethod === "quarantined-vad-token",
      ),
    ).toHaveLength(3);
  });
});
