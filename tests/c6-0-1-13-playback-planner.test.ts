import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  c60113PlaybackPlannerJavascript,
  planC60113PlayableSegments,
  type C60113PlayableRegion,
} from "../packages/video-subtitler/src/review/c60113-playback-planner.js";
import {
  c60113IntervalUnion,
  c60113UnplayedIntervals,
} from "../packages/video-subtitler/src/review/c60113-review-workspace.js";
import { c60113WorkspaceJavascript } from "../packages/video-subtitler/src/review/c60113-review-workspace-ui.js";

const region = (
  id: string,
  start: number,
  end: number,
  padding = 0.5,
): C60113PlayableRegion => ({
  regionId: id,
  itemIds: [`item-${id}`],
  contextInterval: { start, end },
  audioSourceInterval: {
    start: Math.max(0, start - padding),
    end: end + padding,
  },
});
const cases = [
  {
    name: "a selected subset never inherits the full abstract union component",
    regions: [region("b", 10, 20)],
  },
  {
    name: "overlap chains exceeding every clip retain their complete tail",
    regions: [region("a", 0, 8), region("b", 6, 14), region("c", 12, 21)],
  },
  {
    name: "adjacent clips and disjoint selections are exact",
    regions: [
      region("a", 0, 4, 0),
      region("b", 4, 8, 0),
      region("c", 12, 18, 0),
    ],
  },
  {
    name: "new audio removes played context at start middle and end",
    regions: [region("a", 0, 10), region("b", 8, 20)],
    playedIntervals: [
      { start: 0, end: 2 },
      { start: 6, end: 12 },
      { start: 18, end: 30 },
    ],
  },
  {
    name: "longer actual extraction bounds yield correct half-second seek",
    regions: [region("a", 271.949, 308.719, 0.5)],
  },
  {
    name: "fully played selections produce no replay",
    regions: [region("a", 10, 20)],
    playedIntervals: [{ start: 0, end: 30 }],
  },
];
describe("C6.0.1.13 executable playback compilation", () => {
  it("counts manual replacements and committed IME text once, excluding editing-base copies", () => {
    const javascript = c60113WorkspaceJavascript();
    const functions = [
      "manualInsertedV2",
      "resetV2ManualBase",
      "installV2ManualCapture",
    ]
      .map((name) => {
        const line = javascript
          .split("\n")
          .find((value) => value.startsWith(`function ${name}(`));
        if (!line) throw new Error(`Missing generated function ${name}`);
        return line;
      })
      .join("\n");
    const events: {
      type: string;
      fields: { manualCharactersEntered: number };
    }[] = [];
    const result = runInNewContext(
      `${functions}
      const listeners = new Map();
      const area = { value: '春です', addEventListener: (type, fn) => listeners.set(type, fn) };
      const item = { reviewItemId: 'item', regionId: 'region' };
      installV2ManualCapture(area, item);
      area.value = '夏です';
      listeners.get('input')({ inputType: 'insertReplacementText', data: '夏', isComposing: false });
      resetV2ManualBase(area, '候補を手動編集します');
      area.value += '。';
      listeners.get('input')({ inputType: 'insertText', data: '。', isComposing: false });
      area.value = area.value.replace('候補', '字幕');
      listeners.get('input')({ inputType: 'insertFromPaste', data: null, isComposing: false });
      const beforeComposition = area.value;
      listeners.get('compositionstart')({});
      area.value = beforeComposition + 'に';
      listeners.get('input')({ inputType: 'insertCompositionText', data: 'に', isComposing: true });
      area.value = beforeComposition + '日本';
      listeners.get('input')({ inputType: 'insertCompositionText', data: '日本', isComposing: true });
      listeners.get('compositionend')({ data: '日本' });
      listeners.get('input')({ inputType: 'insertFromComposition', data: '日本', isComposing: false });
      area.value += '語';
      listeners.get('input')({ inputType: 'insertText', data: '語', isComposing: false });
      area.value = area.value.slice(0, -1);
      listeners.get('input')({ inputType: 'deleteContentBackward', data: null, isComposing: false });
      ({ counts: events.map(event => event.fields.manualCharactersEntered), types: events.map(event => event.type), saved: v2.drafts.get('item') });`,
      {
        v2: { manualCapture: new WeakMap(), drafts: new Map() },
        events,
        v2Event(type: string, fields: { manualCharactersEntered: number }) {
          events.push({ type, fields });
        },
      },
    ) as { counts: number[]; types: string[]; saved: string };
    expect(result.counts).toEqual([1, 1, 2, 2, 1, 0]);
    expect(result.types[0]).toBe("MANUAL_EDIT_STARTED");
    expect(result.types.slice(1)).toEqual(Array(5).fill("ACTIVITY_SAMPLE"));
    expect(result.saved).toBe("字幕を手動編集します。日本");
  });
  for (const testCase of cases)
    it(testCase.name, () => {
      const actual = planC60113PlayableSegments(testCase);
      const browser = runInNewContext(
        `${c60113PlaybackPlannerJavascript()} planC60113PlayableSegments(input)`,
        { input: structuredClone(testCase) },
      ) as unknown;
      expect(JSON.parse(JSON.stringify(browser))).toEqual(actual);
      const expected = c60113IntervalUnion(
        testCase.regions.map((r) => r.contextInterval),
      ).flatMap((interval) =>
        c60113UnplayedIntervals(interval, testCase.playedIntervals ?? []),
      );
      expect(
        c60113IntervalUnion(actual.map((step) => step.sourceInterval)),
      ).toEqual(expected);
      actual.forEach((step, index) => {
        const audio = testCase.regions.find(
          (r) => r.regionId === step.playbackRegionId,
        )?.audioSourceInterval;
        if (!audio) throw new Error("A nonselected clip was used");
        expect(step.audioSeekStart).toBeGreaterThanOrEqual(0);
        expect(step.audioSeekEnd).toBeLessThanOrEqual(
          audio.end - audio.start + 1e-8,
        );
        expect(step.audioSeekStart + audio.start).toBeCloseTo(
          step.sourceInterval.start,
          8,
        );
        expect(step.audioSeekEnd + audio.start).toBeCloseTo(
          step.sourceInterval.end,
          8,
        );
        if (index > 0)
          expect(actual[index - 1]?.sourceInterval.end).toBeLessThanOrEqual(
            step.sourceInterval.start,
          );
      });
    });
  it("rejects uncovered clips and duplicate IDs", () => {
    expect(() =>
      planC60113PlayableSegments({
        regions: [
          { ...region("a", 0, 10), audioSourceInterval: { start: 1, end: 9 } },
        ],
      }),
    ).toThrow("DOES_NOT_COVER");
    expect(() =>
      planC60113PlayableSegments({
        regions: [region("a", 0, 10), region("a", 5, 20)],
      }),
    ).toThrow("DUPLICATE");
  });
  it("clamps media timer overshoot and advances once despite duplicate end notifications", () => {
    const javascript = c60113WorkspaceJavascript();
    const functions = ["flushV2Audio", "finishV2Segment"]
      .map((name) =>
        javascript
          .split("\n")
          .find((line) => line.startsWith(`function ${name}(`)),
      )
      .join("\n");
    const audio = {
      currentTime: 15.5,
      seeking: false,
      dataset: { contextStart: "5" },
      pause: () => undefined,
    };
    const v2 = {
      audio,
      lastAudio: 14.8,
      stepToken: "step-1",
      continuous: true,
      segments: [{ sourceInterval: { start: 10, end: 20 } }],
      segmentIndex: 0,
      stopTimer: null,
      played: [],
      playbackSeconds: 0,
      playbackQueue: Promise.resolve(),
    };
    let advanceCount = 0;
    runInNewContext(
      `${functions}\nfinishV2Segment(audio,'step-1');finishV2Segment(audio,'step-1');`,
      {
        audio,
        v2,
        unionIntervals: c60113IntervalUnion,
        renderProgress: () => undefined,
        v2Event: () => undefined,
        postJson: () => Promise.resolve(),
        showStatus: () => undefined,
        clearTimeout: () => undefined,
        playV2Segment: () => {
          advanceCount++;
        },
      },
    );
    expect(v2.played).toEqual([{ start: 19.8, end: 20 }]);
    expect(v2.playbackSeconds).toBeCloseTo(0.2, 8);
    expect(advanceCount).toBe(1);
    expect(v2.segmentIndex).toBe(1);
  });
  it("does not count a seek jump as listened source audio", () => {
    const fn = c60113WorkspaceJavascript()
      .split("\n")
      .find((line) => line.startsWith("function flushV2Audio("));
    if (!fn) throw new Error("Audio accounting function missing");
    const audio = { currentTime: 18, seeking: true },
      v2 = { audio, lastAudio: 1, played: [], playbackSeconds: 0 };
    runInNewContext(`${fn}\nflushV2Audio()`, { v2 });
    expect(v2.lastAudio).toBe(18);
    expect(v2.playbackSeconds).toBe(0);
    expect(v2.played).toEqual([]);
  });
});
