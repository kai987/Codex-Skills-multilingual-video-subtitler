import { enforceLexicalConservation } from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import { baselineCue, noVadCue } from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 lexical conservation", () => {
  it("permits duplicate collapse but rejects unique lexical loss", () => {
    const collapse = enforceLexicalConservation({
      before: [baselineCue, noVadCue],
      proposed: [noVadCue],
      mode: "enforce",
    });
    expect(collapse.artifact.summary.lexicalLossCount).toBe(0);
    const reject = enforceLexicalConservation({
      before: [baselineCue],
      proposed: [{ ...noVadCue, text: "別の発話" }],
      mode: "enforce",
    });
    expect(reject.cues[0]?.text).toBe(baselineCue.text);
  });
});
