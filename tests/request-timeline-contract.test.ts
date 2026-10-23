import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  asrCacheManifestArtifactSchema,
  portableAsrCacheEntryV2Schema,
} from "@mvl/shared";
import {
  buildAsrRequestTimelineContract,
  buildCompleteAsrRequestTimelineContract,
  machineQualitySemanticHash,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import { hash } from "./helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 request timeline contract", () => {
  it("verifies no-VAD extraction offsets and quarantines VAD coordinates", () => {
    const artifact = buildAsrRequestTimelineContract({
      sourceMediaSha256: hash("f"),
      recovery: {
        units: [
          {
            interval: { start: 10, end: 20 },
            extractedInterval: { start: 5, end: 25 },
            attempts: [
              {
                asrRequestId: "no-vad",
                vadEnabled: false,
                cacheKey: hash("1"),
              },
              {
                asrRequestId: "vad",
                vadEnabled: true,
                cacheKey: hash("2"),
              },
            ],
          },
        ],
      },
    });
    expect(artifact.requests[0]?.contractStatus).toBe("verified");
    expect(artifact.requests[1]?.contractStatus).toBe("quarantined");
    expect(artifact.requests[0]?.decoderChunkStartSeconds).toBe(0);
    expect(artifact.requests[0]?.ffmpegInputSeekSeconds).toBe(5);
    expect(artifact.requests[0]?.sampleCount).toBe(320000);
    expect(artifact.requests[0]?.exactGlobalOffset).toBe(5);
  });

  it("covers cached requests, binds artifact aliases, and fails closed on stale intervals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c6-0-1-2-cache-"));
    try {
      const currentKey = hash("5");
      const legacyKey = hash("6");
      const result = {
        text: "まだ真っ暗やん。",
        segments: [
          {
            start: 0.2,
            end: 1.5,
            text: "まだ真っ暗やん。",
            speaker: null,
            confidence: 0.9,
            tokens: [{ text: "まだ", start: 0.2, end: 0.7, probability: 0.95 }],
          },
        ],
        raw: { fixture: true },
      };
      const entry = portableAsrCacheEntryV2Schema.parse({
        schemaVersion: "2.0.0",
        createdAt: "2026-08-27T00:00:00.000Z",
        cacheKey: currentKey,
        identity: {
          schemaVersion: "2.0.0",
          audioContentSha256: hash("7"),
          extractedIntervalMilliseconds: { start: 5000, end: 25000 },
          extraction: { sampleRate: 16000, channels: 1, codec: "pcm_s16le" },
          adapterId: "whisper-cpp",
          model: "fixture-no-vad",
          modelHash: hash("8"),
          modelFamily: "large-v3",
          coreML: false,
          whisperCppVersion: "fixture",
          language: "ja",
          vadMode: "no-vad",
          timestampStrategy: "token",
          tokenTimestamps: true,
          promptSha256: hash("9"),
          decodeConfigurationSha256: hash("a"),
        },
        result,
        provenance: {
          requestType: "recovery",
          sourceOutputDirectory: null,
          migratedFromLegacyKey: legacyKey,
          migratedFromPath: null,
        },
        resultSha256: machineQualitySemanticHash(result),
      });
      const target = path.join(root, currentKey.slice(0, 2));
      await mkdir(target, { recursive: true });
      await writeFile(
        path.join(target, `${currentKey}.json`),
        `${JSON.stringify(entry)}\n`,
        "utf8",
      );
      const manifest = asrCacheManifestArtifactSchema.parse({
        schemaVersion: "1.0.0",
        generatedAt: "2026-08-27T00:00:00.000Z",
        portableRoot: root,
        mode: "read-write",
        summary: {
          requestCount: 1,
          portableHitCount: 1,
          taskLocalHitCount: 0,
          legacyHitCount: 0,
          migratedEntryCount: 0,
          missCount: 0,
          rejectedLegacyEntryCount: 0,
          corruptEntryCount: 0,
          writtenEntryCount: 0,
          workerRequestsAvoided: 1,
          workerStartsAvoided: 1,
          modelLoadsAvoided: 1,
        },
        entries: [
          {
            requestId: "recovery-unit-1:no-vad",
            requestType: "recovery",
            currentKey,
            legacyKeysTried: [legacyKey],
            selectedPath: path.join(root, `${legacyKey}.json`),
            hitType: "portable",
            compatibilityChecks: ["identity-exact-match"],
            migrationStatus: "not-needed",
          },
        ],
      });
      const recovery = {
        units: [
          {
            id: "recovery-unit-1",
            interval: { start: 10, end: 20 },
            extractedInterval: { start: 5, end: 25 },
            attempts: [
              {
                asrRequestId: "recovery-unit-1:no-vad:legacy-prefix",
                vadEnabled: false,
                cacheKey: legacyKey,
              },
            ],
          },
        ],
      };
      const artifact = await buildCompleteAsrRequestTimelineContract({
        sourceMediaSha256: hash("f"),
        recovery,
        cacheManifest: manifest,
      });
      expect(artifact.summary).toEqual({
        requestCount: 1,
        verifiedRequestCount: 1,
        quarantinedRequestCount: 0,
        unavailableRequestCount: 0,
      });
      expect(artifact.requests[0]?.requestAliases).toEqual([
        "recovery-unit-1:no-vad",
      ]);
      expect(artifact.requests[0]?.cacheLineage.currentKey).toBe(currentKey);
      expect(artifact.requests[0]?.decoderReportedSegmentStart).toBe(0.2);

      const stale = await buildCompleteAsrRequestTimelineContract({
        sourceMediaSha256: hash("f"),
        recovery: {
          units: [
            {
              ...recovery.units[0],
              extractedInterval: { start: 4, end: 25 },
            },
          ],
        },
        cacheManifest: manifest,
      });
      expect(stale.requests[0]?.contractStatus).toBe("quarantined");
      expect(stale.requests[0]?.offsetVerified).toBe(false);
      expect(stale.requests[0]?.evidence).toContain(
        "artifact-cache-interval-lineage-mismatch",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
