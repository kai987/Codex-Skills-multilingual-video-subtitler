import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { subtitleCueSchema } from "@mvl/shared";
import { parseSrt } from "@mvl/subtitle-core";
import { objectHash } from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";

it("actual isolated I0/I1/I2 A/B export applies only a synthetic supported tail", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c6011642-e2e-"));
  const cue = subtitleCueSchema.parse({
    id: "fixture",
    start: 1,
    end: 2,
    text: "例。",
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
    warnings: ["SYNTHETIC_NOT_REAL_MODEL"],
  });
  const plan = put("plan.json", {
    protocol: { version: "c6011642-exact-onset-tail-v1" },
    target: { cueId: cue.id, cueHash: objectHash(cue) },
    requests: [{ windowId: "W+4", window: { start: 0, end: 5 } }],
  });
  const result = put("result.json", {
    version: "c6011642-exact-onset-tail-v1",
    targetCueId: cue.id,
    mathematicalPathExists: true,
    originalSupportEstablished: true,
    occurrenceDistinguished: true,
    tailIdentifiable: true,
    proposedEnd: 2.4,
    configuredStabilityTolerance: 0.12,
    candidateEndRange: [2.4, 2.4],
    reasons: [],
  });
  for (const r of ["a", "b"]) {
    const dest = path.join(root, r),
      inputs = [pkg, plan, result];
    execFileSync(
      process.execPath,
      [
        "--permission",
        "--allow-fs-read=" + process.cwd(),
        ...inputs.map((p) => "--allow-fs-read=" + p),
        "--allow-fs-read=" + dest,
        "--allow-fs-read=" + dest + "/*",
        "--allow-fs-write=" + dest,
        "--allow-fs-write=" + dest + "/*",
        "scripts/generate-c6011642.mjs",
        ...inputs,
        dest,
      ],
      { cwd: process.cwd() },
    );
  }
  for (const ext of ["ass", "srt", "vtt"]) {
    const read = (r: string, v: string) =>
      fs.readFileSync(
        path.join(root, r, v, "machine-candidate." + ext),
        "utf8",
      );
    expect(read("a", "I0-legacy-boundary")).toBe(
      read("a", "I1-identifiability-observe"),
    );
    expect(read("a", "I2-original-tail-candidate")).toBe(
      read("b", "I2-original-tail-candidate"),
    );
    expect(read("a", "I2-original-tail-candidate")).not.toBe(
      read("a", "I0-legacy-boundary"),
    );
  }
  const c = parseSrt(
    fs.readFileSync(
      path.join(root, "a/I2-original-tail-candidate/machine-candidate.srt"),
      "utf8",
    ),
  )[0];
  expect(c?.start).toBe(1);
  expect(c?.end).toBe(2.4);
  expect(c?.text).toBe(cue.text);
});
