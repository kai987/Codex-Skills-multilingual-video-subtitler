import { describe, expect, it } from "vitest";
import { c601143WorkspaceJavascript } from "../packages/video-subtitler/src/review/c601143-review-workspace-ui.js";
import { representedPlaybackNativeIntervals143 } from "../packages/video-subtitler/src/review/c601143-review-delivery.js";
describe("C6.0.1.14.3 additive review UI", () => {
  const js = c601143WorkspaceJavascript();
  it("exposes the frozen official plan and separate child/bundle playback", () => {
    expect(js).toContain("C601143_FINAL_REVIEW_DELIVERY");
    expect(js).toContain("Play child core");
    expect(js).toContain("Play bundle review envelope");
  });
  it("shows native cores, internal gaps, evidence strata and frozen lexical provenance", () => {
    for (const token of [
      "internal silence/gaps",
      "evidenceStrata",
      "Phase A obligation preserved",
      "frozen request",
      "No decision saved",
    ])
      expect(js).toContain(token);
  });
  it("does not create a save path, model request or automatic candidate insertion", () => {
    expect(js).not.toMatch(
      /fetch\(|XMLHttpRequest|WebSocket|\.save\(|canonicalInsertAllowed\s*=\s*true/u,
    );
  });
  it("counts frozen sub-sample compatibility segments as zero native audio", () => {
    expect(
      representedPlaybackNativeIntervals143(
        [
          { start: 1, end: 1 + 1 / 192000 },
          { start: 2, end: 2 + 1 / 48000 },
        ],
        48000,
      ),
    ).toEqual([{ startSample: 96000, endSample: 96001 }]);
  });
});
