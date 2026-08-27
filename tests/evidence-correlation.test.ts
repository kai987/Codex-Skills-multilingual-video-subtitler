import {
  candidateCorrelationGroupIds,
  candidateIndependentEvidenceGroupIds,
  candidateTextSimilarity,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import { noVadCue, vadCue } from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 evidence correlation", () => {
  it("distinguishes correlated profile windows from decoder-family independence", () => {
    expect(candidateTextSimilarity(noVadCue.text, vadCue.text)).toBe(1);
    expect(candidateCorrelationGroupIds(noVadCue)[0]).toContain("no-vad");
    expect(candidateIndependentEvidenceGroupIds(vadCue)).toEqual([
      "decoder-family:vad",
    ]);
  });
});
