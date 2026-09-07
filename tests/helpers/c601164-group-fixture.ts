import { fixturePrimary, requireValue } from "./c601163-stored-fixture.js";
import { replayPrimaryAssembly } from "../../packages/video-subtitler/src/machine-quality/matched-replay.js";
import { consumeStoredWhisper } from "../../packages/video-subtitler/src/machine-quality/stored-token-span.js";
import {
  alignmentTarget,
  consumeGroupAlignment,
  prepareSourceGroup,
} from "../../packages/video-subtitler/src/machine-quality/source-bound-group.js";
import { objectHash } from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";
export function groupFixture() {
  const { primary, c } = fixturePrimary();
  const stage = requireValue(
    replayPrimaryAssembly(primary, true).trace.find(
      (t) => t.stageName === "deduplicateTopScoreWinners",
    ),
  ).output;
  const start = c.before.start - 2;
  const full = {
    model: { vocab: 51866, multilingual: true },
    transcription: [
      {
        text: "そこで待って。",
        offsets: { from: 1800, to: 4000 },
        tokens: [
          { id: 301, text: "そこで", offsets: { from: 1800, to: 2200 } },
          { id: 302, text: "待って。", offsets: { from: 2300, to: 4000 } },
        ],
      },
      {
        text: "明日話そう。",
        offsets: { from: 4000, to: 6400 },
        tokens: [
          { id: 303, text: "明日", offsets: { from: 4000, to: 4500 } },
          { id: 304, text: "話そう。", offsets: { from: 4600, to: 6400 } },
        ],
      },
    ],
  };
  const input = {
    requestId: "fixture-w2",
    windowId: "w2",
    caseBindingHash: c.bindingHash,
    audioHash: objectHash("physical"),
    window: { start, end: start + 8 },
    rawFileHash: objectHash(full),
    sourceRequestIds: c.sourceRequestIds,
    occurrenceIds: c.occurrenceIds,
  };
  const observation = consumeStoredWhisper(full, input);
  const group = prepareSourceGroup(c, stage, [observation]);
  const target = alignmentTarget(
    full.transcription.map((p) => p.text).join(""),
  );
  // Explicitly SYNTHETIC intervals: provider-shaped positive contract fixture,
  // not real acoustic truth or an interpolation algorithm used by production.
  const raw = {
    requestId: input.requestId,
    status: "SUCCESS",
    targetText: target.targetText,
    pieces: target.characters.map((ch, i) => ({
      text: ch.text,
      tokenId: i + 10,
      start: c.before.start - 0.1 + i * 0.3,
      end: c.before.start + 0.1 + i * 0.3,
      startFrame: i * 15,
      endFrameExclusive: i * 15 + 10,
    })),
    reasons: [],
  };
  const alignment = consumeGroupAlignment(observation, raw);
  return { primary, c, stage, full, input, observation, group, raw, alignment };
}
