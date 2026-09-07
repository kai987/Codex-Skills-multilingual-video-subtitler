import { evidence } from "./c60116-quality-fixture.js";
export function requireValue<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw Error("Missing fixture member");
  return v;
}
import {
  matchedEvidenceSchema,
  replayPrimaryAssembly,
} from "../../packages/video-subtitler/src/machine-quality/matched-replay.js";
import {
  deriveAcousticCases,
  type AcousticCase,
} from "../../packages/video-subtitler/src/machine-quality/bounded-acoustic.js";
import { consumeStoredWhisper } from "../../packages/video-subtitler/src/machine-quality/stored-token-span.js";
import { objectHash } from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";
export function fixturePrimary() {
  const e = evidence();
  requireValue(e.primaryRequests[0]).segments = [
    {
      id: "neutral-source",
      start: 0,
      end: 4,
      text: "こちらへ来て!こちらへ来て!",
    },
  ];
  const primary = matchedEvidenceSchema.parse({
    version: "c601161-primary-evidence-v1",
    partition: e.partition,
    source: e.source,
    primaryRequests: e.primaryRequests,
    promptStatus: "HISTORICAL_TITLE_PROMPTED_EVIDENCE",
  });
  const cases = deriveAcousticCases(
    replayPrimaryAssembly(primary, false).trace,
    replayPrimaryAssembly(primary, true).trace,
    48000,
  );
  if (cases.length !== 1) throw Error("Neutral case selection failed");
  return { primary, cases, c: requireValue(cases[0]) };
}
export function rawWindow(c: AcousticCase, windowId = "w1") {
  const padding = windowId === "w1" ? 0.5 : 2;
  const start = c.before.start - padding,
    end = c.before.end + padding;
  const base = (padding + 0.2) * 1000;
  const tokens = [
    {
      id: 50365,
      text: "[_BEG_]",
      offsets: { from: 0, to: 0 },
      p: 0.9,
      t_dtw: -1,
    },
    {
      id: 301,
      text: "そこ",
      offsets: { from: base, to: base + 500 },
      p: 0.9,
      t_dtw: -1,
    },
    {
      id: 302,
      text: "で",
      offsets: { from: base + 600, to: base + 600 },
      p: 0.9,
      t_dtw: -1,
    },
    {
      id: 303,
      text: "待って",
      offsets: { from: base + 700, to: base + 1500 },
      p: 0.9,
      t_dtw: -1,
    },
    {
      id: 1543,
      text: "。",
      offsets: { from: base + 1500, to: base + 1600 },
      p: 0.9,
      t_dtw: -1,
    },
  ];
  return {
    full: {
      model: { vocab: 51866, multilingual: true },
      transcription: [
        {
          text: "そこで待って。",
          offsets: { from: 0, to: (end - start) * 1000 },
          tokens,
        },
      ],
    },
    input: {
      requestId: "neutral-" + windowId,
      caseBindingHash: c.bindingHash,
      windowId,
      audioHash: objectHash(windowId),
      window: { start, end },
      rawFileHash: objectHash({ windowId }),
      sourceRequestIds: c.sourceRequestIds,
      occurrenceIds: c.occurrenceIds,
    },
  };
}
export function observation(c: AcousticCase, id = "w1") {
  const r = rawWindow(c, id);
  return consumeStoredWhisper(r.full, r.input);
}
