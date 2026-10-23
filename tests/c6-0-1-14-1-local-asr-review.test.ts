import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import {
  c601141AsrProbesSchema,
  c601141ReviewTargetsSchema,
} from "@mvl/shared";
import { fixture141, syntheticRuntime141 } from "./fixtures/c601141-fixture.js";
import {
  asrRequest141,
  localizeAsr141,
  runAsr141,
} from "../packages/video-subtitler/src/review/c601141-local-asr.js";
import {
  wav141,
  bytesHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hashed141,
  hash141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import { speechEnvironment141 } from "../packages/video-subtitler/src/review/c601141-detectors.js";
import type {
  C60114ProbeRuntimeAdapter,
  C60114ProbeRawResult,
} from "../packages/video-subtitler/src/review/missing-dialogue-local-probe.js";

function raw(text = "合成の声"): C60114ProbeRawResult {
  return {
    status: text ? "SUCCESS" : "EMPTY_OUTPUT",
    text,
    rawOutput: { synthetic: true, text },
    tokens: [],
    decoder: {
      averageLogProbability: null,
      noSpeechProbability: null,
      temperature: null,
    },
    warnings: [],
    wallClockSeconds: 0,
    inferenceExecuted: true,
  };
}
describe("C601141 bounded ASR and additive review", () => {
  it("preserves all baseline targets/items/regions and their ordering", () => {
    const f = fixture141();
    expect(f.graph.compatibleTargets.targets.slice(0, 1)).toEqual(
      f.baselineTargets.targets,
    );
    expect(f.graph.compatibleItems.items.slice(0, 1)).toEqual(
      f.baselineItems.items,
    );
    expect(f.graph.compatibleRegions.regions.slice(0, 1)).toEqual(
      f.baselineRegions.regions,
    );
    expect(f.graph.targets.targets).toHaveLength(3);
    expect(
      f.graph.items.items
        .slice(1)
        .every(
          (v) =>
            v.requiredLevel === "RECOMMENDED" && v.finalCueIds.length === 0,
        ),
    ).toBe(true);
    expect(f.graph.items.items[1]?.itemTypes).toContain(
      "MULTI_DETECTOR_UNCOVERED_SPEECH",
    );
  });
  it("rejects new REQUIRED targets and invented native coordinates", () => {
    const f = fixture141(),
      mutated = structuredClone(f.graph.targets);
    required141(mutated.targets[1]).mandatoryForAudio = true;
    expect(() => c601141ReviewTargetsSchema.parse(mutated)).toThrow();
    required141(mutated.targets[1]).mandatoryForAudio = false;
    required141(mutated.targets[1]).nativeInterval.startSample += 48000;
    expect(() => c601141ReviewTargetsSchema.parse(mutated)).toThrow();
  });
  it("uses zero-guard exact and fixed context windows with isolated prompts", () => {
    const f = fixture141(),
      target = required141(f.selection.targets[0]),
      runtime = syntheticRuntime141("whisper-large-v3");
    const exact = asrRequest141({
      selection: f.selection,
      policy: f.policy,
      target,
      runtime,
      windowType: "CORE_EXACT",
    });
    const context = asrRequest141({
      selection: f.selection,
      policy: f.policy,
      target,
      runtime,
      windowType: "CORE_CONTEXT",
    });
    expect(exact.extractionInterval).toEqual(target.sourceInterval);
    expect(context.extractionInterval.start).toBe(
      target.sourceInterval.start - 0.75,
    );
    expect(exact.prompt).toBe("");
    expect(exact.vadEnabled).toBe(false);
    expect(exact.cacheKey).not.toBe(context.cacheKey);
  });
  it("does not project RNNT point timestamps or whole context text into a core", () => {
    const f = fixture141(),
      request = asrRequest141({
        selection: f.selection,
        policy: f.policy,
        target: required141(f.selection.targets[0]),
        runtime: syntheticRuntime141("reazonspeech-k2-v2"),
        windowType: "CORE_CONTEXT",
      });
    expect(localizeAsr141(request, raw()).localizationStatus).toBe(
      "CONTEXT_UNPROJECTABLE",
    );
  });
  it("keeps token/secret environment out of detector children and binds the loader directory", () => {
    const env = speechEnvironment141("/pinned/runtime/libwhisper.dylib");
    expect(env.HF_HUB_OFFLINE).toBe("1");
    expect(
      Object.keys(env).some((key) => /TOKEN|API_KEY|SECRET/iu.test(key)),
    ).toBe(false);
    expect(
      env[
        process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH"
      ],
    ).toBe("/pinned/runtime");
  });
  it("fresh exact agreement skips context and independent replay cannot construct a provider", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "c601141-asr-replay-"),
      ),
      f = fixture141();
    try {
      const fresh = path.join(directory, "fresh"),
        replay = path.join(directory, "replay"),
        cache = path.join(directory, "cache");
      await mkdir(fresh, { recursive: true });
      let calls = 0;
      const adapter: C60114ProbeRuntimeAdapter = {
        identities: [
          syntheticRuntime141("whisper-large-v3"),
          syntheticRuntime141("reazonspeech-k2-v2"),
        ],
        extract: async (request) => {
          const bytes = wav141(
            Buffer.alloc(
              Math.round(
                (request.extractionInterval.end -
                  request.extractionInterval.start) *
                  16000,
              ) * 2,
            ),
          );
          const audioPath = path.join(fresh, `${request.requestId}.wav`);
          await writeFile(audioPath, bytes);
          return {
            audioPath,
            audioSha256: bytesHash141(bytes),
            sampleCount: (bytes.length - 44) / 2,
          };
        },
        transcribe: () => {
          calls++;
          return Promise.resolve(raw());
        },
        counts: () => ({
          modelLoadCount: calls ? 2 : 0,
          processStartCount: calls ? 2 : 0,
        }),
        close: () => Promise.resolve(),
      };
      const input = {
        authorized: true,
        selection: f.selection,
        policy: f.policy,
        runtimeInput: {
          sourcePath: "unused",
          sourceIdentity: f.source,
          whisperRuntimeManifestPath: "unused",
          whisperModelPath: "unused",
          whisperModelSha256: f.source.sourceMediaSha256,
          reazonModelDirectory: "unused",
          reazonPython: "unused",
          outputDirectory: fresh,
        },
        cacheDirectory: cache,
        outputDirectory: fresh,
        freshDirectory: fresh,
        runtimeFactory: () => Promise.resolve(adapter),
      };
      const a = await runAsr141({ ...input, mode: "FRESH" });
      expect(calls).toBe(4);
      expect(a.accounting.contextCount).toBe(0);
      const b = await runAsr141({
        ...input,
        mode: "EXACT_CACHE_ONLY",
        outputDirectory: replay,
        runtimeFactory: () =>
          Promise.reject(new Error("REPLAY_STARTED_PROVIDER")),
      });
      expect(b.accounting.cacheHits).toBe(4);
      expect(b.accounting.inferenceCount).toBe(0);
      expect(b.accounting.modelLoadCount).toBe(0);
      expect(b.accounting.providerProcessStartCount).toBe(0);
      expect(a.evidenceSemanticHash).toBe(b.evidenceSemanticHash);
      expect(b.contextDecisions.every((v) => !v.executed)).toBe(true);
      const before = (await readdir(path.join(cache, "dispatch/asr"))).length;
      await expect(runAsr141({ ...input, mode: "FRESH" })).rejects.toThrow();
      expect(calls).toBe(4);
      expect((await readdir(path.join(cache, "dispatch/asr"))).length).toBe(
        before,
      );
      const row = required141(b.requests[0]),
        file = path.join(cache, "asr", `${row.cacheKey}.json`);
      const changed = JSON.parse(await readFile(file, "utf8")) as Record<
        string,
        unknown
      >;
      changed.displayText = "tampered";
      await writeFile(file, JSON.stringify(changed));
      await expect(
        runAsr141({
          ...input,
          mode: "EXACT_CACHE_ONLY",
          outputDirectory: path.join(directory, "bad"),
        }),
      ).rejects.toThrow();
      expect(calls).toBe(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("strict ASR result arrays reject a 33rd request", () => {
    const f = fixture141();
    expect(() =>
      c601141AsrProbesSchema.parse(
        hashed141({ ...f.probes, requests: Array(33).fill({}) }),
      ),
    ).toThrow();
    expect(hash141(f.graph.targets)).toHaveLength(64);
  });
});
