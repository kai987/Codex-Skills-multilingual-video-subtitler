import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { c601141FingerprintEntrySchema } from "@mvl/shared";
import { fingerprintControls141 } from "./fixtures/c601141-fingerprint-controls.js";
import { indexRetainedAudio141 } from "../packages/video-subtitler/src/review/c601141-fingerprint.js";
import {
  wav141,
  bytesHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import { hashed141 } from "../packages/video-subtitler/src/review/c601141-policy.js";

let root: string, controls: Awaited<ReturnType<typeof fingerprintControls141>>;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "c601141-fingerprint-tests-"));
  controls = await fingerprintControls141(root);
}, 30000);
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe("C601141 actual model-free fingerprint implementation", () => {
  it.each([
    ["exact", "LEGACY_EXACT_PCM_RECOVERED"],
    ["duplicate", "FINGERPRINT_AMBIGUOUS"],
    ["gain", "LEGACY_UNIQUE_FINGERPRINT_RECOVERED"],
    ["silent", "SILENT_OR_REPETITIVE_CLIP"],
    ["tone", "SILENT_OR_REPETITIVE_CLIP"],
  ])("checks the actual Python %s control", (key, status) => {
    expect(controls.controls.passed).toBe(true);
    expect(controls.controls.statuses[key]).toBe(status);
  });
  it("searches the whole synthetic source and recovers integer sample offsets without Gold", () => {
    expect(controls.controls.exactOffsetErrorSamples).toBe(0);
    expect(
      Math.abs(controls.controls.gainOffsetErrorSamples),
    ).toBeLessThanOrEqual(1);
    expect(controls.controls.goldInputCount).toBe(0);
    expect(controls.results).toEqual([]);
  });
  it("does not invent bytes for an unavailable hash and rejects truncated retained WAV", async () => {
    const pcm = wav141(Buffer.alloc(16000));
    await writeFile(path.join(root, "retained.wav"), pcm);
    await writeFile(
      path.join(root, "truncated.wav"),
      pcm.subarray(0, pcm.length - 2),
    );
    const index = await indexRetainedAudio141([root]);
    expect(index.has(bytesHash141(pcm))).toBe(true);
    expect(index.has("0".repeat(64))).toBe(false);
    expect(index.size).toBe(1);
  });
  it("rejects a Gold-labeled audio root before listing files", async () => {
    await expect(
      indexRetainedAudio141([path.join(root, "gold-audio")]),
    ).rejects.toThrow("C601141_NON_MACHINE_AUDIO_ROOT_FORBIDDEN");
  });
  it.each([
    "FINGERPRINT_AMBIGUOUS",
    "SOURCE_AUDIO_BYTES_NOT_RETAINED",
    "SILENT_OR_REPETITIVE_CLIP",
  ] as const)(
    "does not promote %s to localized speech even with a fabricated hash",
    (status) => {
      const row = hashed141({
        evidenceId: "synthetic",
        requestIds: [],
        retainedPath: null,
        retainedAudioSha256: null,
        retainedPcmSha256: null,
        clipSeconds: 0,
        searched: false,
        searchScope: "FULL_SOURCE_ONLY",
        searchViewId: null,
        bestOffsetSamples16k: null,
        secondOffsetSamples16k: null,
        bestScore: null,
        secondScore: null,
        scoreMargin: null,
        residual: null,
        uniquenessPassed: false,
        status,
        nativeInterval: null,
        speechPositive: false,
        lexicalEvidenceEligible: false,
        lexicalProvenanceReasons: [],
        reasons: [],
      });
      expect(c601141FingerprintEntrySchema.safeParse(row).success).toBe(true);
      expect(
        c601141FingerprintEntrySchema.safeParse({
          ...row,
          speechPositive: true,
        }).success,
      ).toBe(false);
      expect(
        c601141FingerprintEntrySchema.safeParse({
          ...row,
          nativeInterval: { startSample: 0, endSample: 10 },
        }).success,
      ).toBe(false);
    },
  );
});
