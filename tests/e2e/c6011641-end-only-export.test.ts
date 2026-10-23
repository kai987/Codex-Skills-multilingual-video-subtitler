import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { formatAss, formatSrt, formatVtt, parseSrt } from "@mvl/subtitle-core";
import { subtitleCueSchema } from "@mvl/shared";
import { BOUNDARY_POLICY } from "../../packages/video-subtitler/src/machine-quality/boundary-support.js";
import {
  objectHash,
  sha256,
} from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";
it("isolated A/B exports actually change only the supported end and off reproduces U0", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c6011641-e2e-"));
  const cue = subtitleCueSchema.parse({
    id: "synthetic",
    text: "待って。",
    start: 1,
    end: 2,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: null,
  });
  const put = (n: string, v: unknown) => {
    const p = path.join(root, n);
    fs.writeFileSync(p, JSON.stringify(v));
    return p;
  };
  const pkg = put("pkg.json", {
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.mkv",
      container: "matroska",
      durationSeconds: 10,
    },
    identity: { title: null, season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: 1,
    },
    subtitleFiles: {
      ass: "./machine-candidate.ass",
      srt: "./machine-candidate.srt",
      vtt: "./machine-candidate.vtt",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues: [cue],
    warnings: ["SYNTHETIC"],
  });
  const spans = [0, 1, 2].map((i) => ({
    targetIndex: i,
    tokenId: 10 + i,
    startFrame: 50 + 10 * i,
    endFrameExclusive: 60 + 10 * i,
    meanPosterior: 0.8,
    meanLogPosterior: -0.22,
    minLogPosterior: -0.3,
  }));
  const requests = ["W0", "W+2", "W+4"].map((id) => ({
    requestId: id,
    window: { start: 0, end: 5 },
    audioHash: "synthetic-audio",
    targetText: "待って",
  }));
  const plan = put("plan.json", {
    policy: BOUNDARY_POLICY,
    requests,
    targets: [
      {
        cueId: cue.id,
        cueHash: objectHash(cue),
        firstTokenIndex: 0,
        lastTokenIndex: 2,
        oldFirstTokenStart: 1,
        oldTail: spans,
        oldNormalizedPathLogScore: -0.4,
      },
    ],
    baselineHashes: {
      ass: sha256(formatAss([cue])),
      srt: sha256(formatSrt([cue])),
      vtt: sha256(formatVtt([cue])),
    },
  });
  const evidence = requests.map((r) =>
    put(r.requestId + ".json", {
      requestId: r.requestId,
      status: "SUCCESS",
      targetText: r.targetText,
      pieces: ["待", "っ", "て"],
      frameEvidence: { audioHash: r.audioHash, frameCellSeconds: 0.02 },
      partialAlignment: {
        status: "CONDITIONAL_PATH_AVAILABLE",
        tokenSpans: spans,
        unassignedSuffixFrames: [80, 250],
      },
      acousticTransitions: [
        { cueId: cue.id, result: { selected: { seconds: 1.9 } } },
      ],
    }),
  );
  const inputs = [pkg, plan, ...evidence];
  for (const run of ["a", "b"]) {
    const dest = path.join(root, run);
    const args = [
      "--permission",
      "--allow-fs-read=" + process.cwd(),
      ...inputs.map((p) => "--allow-fs-read=" + p),
      "--allow-fs-read=" + dest,
      "--allow-fs-read=" + dest + "/*",
      "--allow-fs-write=" + dest,
      "--allow-fs-write=" + dest + "/*",
      "scripts/generate-c6011641.mjs",
      ...inputs,
      dest,
    ];
    execFileSync(process.execPath, args, { cwd: process.cwd() });
  }
  for (const ext of ["srt", "ass", "vtt"]) {
    const get = (r: string, v: string) =>
      fs.readFileSync(
        path.join(root, r, v, "machine-candidate." + ext),
        "utf8",
      );
    expect(get("a", "U2-extended-window-boundary")).toBe(
      get("b", "U2-extended-window-boundary"),
    );
    expect(get("a", "U2-application-disabled")).toBe(
      get("a", "U0-previous-T2"),
    );
    expect(get("a", "U2-extended-window-boundary")).not.toBe(
      get("a", "U0-previous-T2"),
    );
  }
  const cs = parseSrt(
    fs.readFileSync(
      path.join(root, "a/U2-extended-window-boundary/machine-candidate.srt"),
      "utf8",
    ),
  );
  expect(cs[0]?.end).toBe(1.9);
  expect(cs[0]?.start).toBe(1);
  expect(cs[0]?.text).toBe(cue.text);
});
