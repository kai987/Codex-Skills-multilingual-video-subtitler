import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { c60114WorkspaceJavascript } from "../packages/video-subtitler/src/review/c60114-review-workspace-ui.js";

interface PendingPlay {
  resolve: () => void;
  reject: (error: Error) => void;
}
interface PlaybackHarness {
  v14: {
    playing: boolean;
    index: number;
    played: { start: number; end: number }[];
  };
  startV14: (ids: string[]) => void;
  stopV14: () => void;
  advanceV14: () => void;
}
function harness() {
  const pending: PendingPlay[] = [];
  const messages: { message: string; error: boolean }[] = [];
  const audio = {
    currentTime: 0,
    playbackRate: 1,
    paused: true,
    seeking: false,
    dataset: {} as Record<string, string>,
    src: "audio/synthetic.wav",
    onloadedmetadata: null as (() => void) | null,
    getAttribute: () => "audio/synthetic.wav",
    load() {
      this.onloadedmetadata?.();
    },
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      return new Promise<void>((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  };
  const data = {
    audio: {
      audio: [
        {
          audioId: "audio",
          relativePath: audio.src,
          sourceInterval: { start: 10, end: 13 },
          sha256: "a".repeat(64),
        },
      ],
    },
    playback: {
      segments: [0, 1, 2].map((index) => ({
        playbackSegmentId: `segment-${index}`,
        audioId: "audio",
        sourceInterval: { start: 10 + index, end: 11 + index },
        audioLocalInterval: { start: index, end: index + 1 },
      })),
      plans: [{ planId: "FULL_QUEUE", uniqueAudioSeconds: 3 }],
    },
  };
  const runtime = runInNewContext(
    `${c60114WorkspaceJavascript()}\n({v14,startV14,stopV14,advanceV14})`,
    {
      state: { data: { sourceTargetReviewV3: data } },
      byId: (id: string) => (id === "review-audio" ? audio : null),
      refreshFiltered: () => undefined,
      audioView: () => undefined,
      render: () => undefined,
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      showStatus: (message: string, error = false) =>
        messages.push({ message, error }),
    },
  ) as PlaybackHarness;
  const reject = (index: number) => {
    const value = pending[index];
    if (!value) throw new Error("SYNTHETIC_PLAY_REQUEST_MISSING");
    value.reject(new Error("The previous play request was interrupted"));
  };
  return { runtime, audio, pending, reject, messages };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("C60114 frozen segment playback cancellation", () => {
  it("does not stop the next segment when an obsolete play promise rejects", async () => {
    const { runtime, audio, reject, messages } = harness();
    runtime.startV14(["segment-0", "segment-1"]);
    audio.currentTime = 1;
    runtime.advanceV14();
    reject(0);
    await flush();
    expect(runtime.v14.index).toBe(1);
    expect(runtime.v14.playing).toBe(true);
    expect(audio.paused).toBe(false);
    expect(messages).toEqual([]);
  });
  it("does not report a user stop as an audio failure", async () => {
    const { runtime, reject, messages } = harness();
    runtime.startV14(["segment-0"]);
    runtime.stopV14();
    reject(0);
    await flush();
    expect(runtime.v14.playing).toBe(false);
    expect(messages).toEqual([]);
  });
  it("still fails closed for a failure in the current play generation", async () => {
    const { runtime, reject, messages } = harness();
    runtime.startV14(["segment-0"]);
    reject(0);
    await flush();
    expect(runtime.v14.playing).toBe(false);
    expect(messages[0]?.error).toBe(true);
  });
  it("records consecutive source segments once and completes without a decision", () => {
    const { runtime, audio, messages } = harness();
    runtime.startV14(["segment-0", "segment-1", "segment-2"]);
    for (const end of [1, 2, 3]) {
      audio.currentTime = end;
      runtime.advanceV14();
    }
    expect(runtime.v14.played).toEqual([{ start: 10, end: 13 }]);
    expect(runtime.v14.playing).toBe(false);
    expect(messages.at(-1)?.message).toContain("No review decision was saved");
  });
});
