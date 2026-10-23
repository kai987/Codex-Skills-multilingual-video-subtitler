import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import {
  reviewTargets142Schema,
  asrSelection142Schema,
  c601141AsrProbesSchema,
} from "@mvl/shared";
import { fixture142 } from "./fixtures/c601142-review-fixture.js";
import { syntheticRuntime141 } from "./fixtures/c601141-fixture.js";
import {
  asrRequest142,
  selectAsr142,
  planAsr142,
  runAsr142,
} from "../packages/video-subtitler/src/review/c601142-asr.js";
import { localizeAsr141 } from "../packages/video-subtitler/src/review/c601141-local-asr.js";
import {
  buildLexical142,
  buildMissing142,
} from "../packages/video-subtitler/src/review/c601142-lexical.js";
import {
  hashed141,
  hash141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  wav141,
  bytesHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import type {
  C60114ProbeRuntimeAdapter,
  C60114ProbeRawResult,
} from "../packages/video-subtitler/src/review/missing-dialogue-local-probe.js";
const raw = (text = "合成の声"): C60114ProbeRawResult => ({
  status: text ? "SUCCESS" : "EMPTY_OUTPUT",
  text,
  rawOutput: { synthetic: text },
  tokens: [],
  decoder: {
    averageLogProbability: null,
    noSpeechProbability: null,
    temperature: null,
  },
  warnings: [],
  wallClockSeconds: 0,
  inferenceExecuted: true,
});
describe("C601142 local ASR budget, lexical localization and safe review", () => {
  it("keeps baseline non-safety targets, items, required order and region bytes", () => {
    const f = fixture142();
    expect(
      f.graph.compatibleTargets.targets.slice(
        0,
        f.old.baselineTargets.targets.length,
      ),
    ).toEqual(f.old.baselineTargets.targets);
    expect(
      f.graph.compatibleItems.items.slice(0, f.old.baselineItems.items.length),
    ).toEqual(f.old.baselineItems.items);
    expect(
      f.graph.compatibleRegions.regions.slice(
        0,
        f.old.baselineRegions.regions.length,
      ),
    ).toEqual(f.old.baselineRegions.regions);
    expect(
      f.graph.items.items
        .slice(f.old.baselineItems.items.length)
        .map((i) => [i.requiredLevel, i.canonicalMutationAllowed]),
    ).toEqual(
      f.graph.items.items
        .slice(f.old.baselineItems.items.length)
        .map(() => ["RECOMMENDED", false]),
    );
    expect(f.graph.targets.envelopeAsSpeechCount).toBe(0);
  });
  it("rejects inventing native coordinates or promoting new safety targets to REQUIRED", () => {
    const f = fixture142(),
      clone = structuredClone(f.graph.targets),
      row = required141(
        clone.targets.find((t) => t.targetSource === "MISSING_SAFETY_RESERVE"),
      );
    row.nativeInterval.startSample++;
    expect(reviewTargets142Schema.safeParse(clone).success).toBe(false);
    row.nativeInterval.startSample--;
    row.mandatoryForAudio = true;
    expect(reviewTargets142Schema.safeParse(clone).success).toBe(false);
  });
  it("uses one exact core, isolated namespace, no prompt, VAD disabled and fixed context", () => {
    const f = fixture142(),
      t = required141(f.selection.targets[0]),
      r = syntheticRuntime141("reazonspeech-k2-v2");
    const exact = asrRequest142(f.selection, f.policy, t, r, "CORE_EXACT"),
      context = asrRequest142(f.selection, f.policy, t, r, "CORE_CONTEXT");
    expect(exact.coreInterval).toEqual(t.sourceInterval);
    expect(exact.prompt).toBe("");
    expect(exact.vadEnabled).toBe(false);
    expect(context.extractionInterval.start).toBe(
      exact.extractionInterval.start - 0.75,
    );
    expect(exact.cacheKey).not.toBe(context.cacheKey);
    expect(localizeAsr141(context, raw()).localizationStatus).toBe(
      "CONTEXT_UNPROJECTABLE",
    );
  });
  it("refuses an unbound context target and an incorrect request budget", () => {
    const f = fixture142();
    expect(
      asrSelection142Schema.safeParse({
        ...f.selection,
        contextEligibleTargetIds: ["unselected"],
      }).success,
    ).toBe(false);
    expect(
      asrSelection142Schema.safeParse({
        ...f.selection,
        maximumAuthorizedRequests: 13,
      }).success,
    ).toBe(false);
  });
  it("retains empty-ASR safety rather than deleting or inserting a cue", () => {
    const f = fixture142();
    expect(f.lexical.targets).toHaveLength(f.safety.targets.length);
    expect(
      f.missing.targets.map((t) => [t.canonicalInsertAllowed, t.requiredLevel]),
    ).toEqual(f.missing.targets.map(() => [false, "RECOMMENDED"]));
    expect(f.missing.summary.canonicalInsertCount).toBe(0);
  });
  it("fresh agreement skips context and cache replay cannot construct a provider", async () => {
    const f = fixture142(),
      directory = await mkdtemp(
        path.join(os.tmpdir(), "mvl-c601142-asr-test-"),
      ),
      fresh = path.join(directory, "fresh");
    await mkdir(fresh);
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
        await writeFile(audioPath, bytes, { flag: "wx" });
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
    const runtimeInput = {
      sourcePath: "synthetic-only",
      sourceIdentity: f.source,
      whisperRuntimeManifestPath: "unused",
      whisperModelPath: "unused",
      reazonPython: "unused",
      reazonWorkerPath: "unused",
      reazonSnapshotPath: "unused",
      outputDirectory: fresh,
    };
    const plan = await planAsr142({
      selection: f.selection,
      policy: f.policy,
      runtimeInput,
      outputDirectory: fresh,
      runtimeFactory: () => Promise.resolve(adapter),
    });
    expect(calls).toBe(0);
    expect(plan.requests.length).toBeLessThanOrEqual(12);
    const common = {
      selection: f.selection,
      policy: f.policy,
      plan,
      runtimeInput,
      cacheDirectory: path.join(directory, "cache"),
      freshDirectory: fresh,
    };
    const result = await runAsr142({
      ...common,
      mode: "FRESH",
      authorized: true,
      outputDirectory: fresh,
      runtimeFactory: () => Promise.resolve(adapter),
    });
    expect(result.requests).toHaveLength(2 * f.selection.targets.length);
    expect(result.contextDecisions.every((t) => !t.executed)).toBe(true);
    const replay = await runAsr142({
      ...common,
      mode: "EXACT_CACHE_ONLY",
      authorized: false,
      outputDirectory: path.join(directory, "replay"),
      runtimeFactory: () =>
        Promise.reject(new Error("PROVIDER_MUST_NOT_BE_CONSTRUCTED")),
    });
    expect(replay.accounting).toMatchObject({
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      cacheMisses: 0,
    });
    expect(replay.evidenceSemanticHash).toBe(result.evidenceSemanticHash);
    const lexical = buildLexical142({
      policy: f.policy,
      safety: f.safety,
      probes: result,
      previousProbes: f.old.probes,
      previousLexical: f.old.lexical,
    });
    expect(lexical.targets.every((t) => t.reliableLocalizedLexical)).toBe(true);
    expect(lexical.targets.map((t) => t.canonicalInsertAllowed)).toEqual(
      lexical.targets.map(() => false),
    );
    expect(
      buildMissing142(f.inventory, f.safety, lexical, f.policy).summary
        .canonicalInsertCount,
    ).toBe(0);
    const { clusterTargetId: _cluster, ...oldRequest } = required141(
      result.requests[0],
    );
    void _cluster;
    const prior = c601141AsrProbesSchema.parse(
      hashed141({
        ...f.old.probes,
        requests: [hashed141(oldRequest)],
        evidenceSemanticHash: hash141(oldRequest),
      }),
    );
    const next = selectAsr142(
      f.safety,
      prior,
      f.policy,
      f.selection.selectionFrozenAt,
    );
    expect(
      next.targets.some(
        (t) => t.clusterTargetId === result.requests[0]?.clusterTargetId,
      ),
    ).toBe(false);
    expect(
      next.rejected.some(
        (r) => r.reason === "ALL_CORES_PREVIOUSLY_PROBED_OR_BELOW_MINIMUM",
      ),
    ).toBe(true);
  });
});
