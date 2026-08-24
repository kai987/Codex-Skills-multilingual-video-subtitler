import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadHumanReviewedSubtitle,
  verifyHumanReviewedSubtitleReadOnly,
} from "@mvl/video-subtitler";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

function reviewedAss(): string {
  return `[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02,35,Default,糸子,0,0,0,,人が確認した文
Dialogue: 0,0:00:03.00,0:00:04.00,Music,,0,0,0,,♪ 確認した歌 ♪
`;
}

describe("human-reviewed subtitle baseline import", () => {
  it("imports text, timing, speaker, and style while auditing a decimal comma", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-human-reviewed-"));
    temporaryDirectories.push(root);
    const assPath = path.join(root, "reviewed.ass");
    await writeFile(assPath, reviewedAss());

    const imported = await loadHumanReviewedSubtitle(assPath);

    expect(imported.cues).toHaveLength(2);
    expect(imported.timestampNormalizationCount).toBe(1);
    expect(imported.cues[0]).toMatchObject({
      start: 1,
      end: 2.35,
      text: "人が確認した文",
      speaker: "糸子",
      style: "default",
    });
    expect(imported.cues[1]).toMatchObject({
      text: "♪ 確認した歌 ♪",
      style: "music",
    });
    expect(imported.sourceFileSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(imported.cueHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(await verifyHumanReviewedSubtitleReadOnly(imported)).toBe(true);

    await writeFile(assPath, `${reviewedAss()}\n`);
    expect(await verifyHumanReviewedSubtitleReadOnly(imported)).toBe(false);
  });

  it("rejects a non-ASS human-reviewed baseline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-human-reviewed-"));
    temporaryDirectories.push(root);
    const srtPath = path.join(root, "reviewed.srt");
    await writeFile(srtPath, "1\n00:00:01,000 --> 00:00:02,000\n本文\n");

    await expect(loadHumanReviewedSubtitle(srtPath)).rejects.toThrow(
      /must be an ASS or SSA/u,
    );
  });
});
