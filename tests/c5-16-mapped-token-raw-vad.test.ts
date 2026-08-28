import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  c516StockPatchedRuntimeAbArtifactSchema,
  mvlRequestStateIsolation,
  mvlWhisperPatchId,
  mvlWhisperServerCapabilitiesSchema,
  mvlWhisperServerResponseSchema,
  whisperUpstreamPatchManifestSchema,
  type OverlapAcousticAttempt,
} from "@mvl/shared";
import {
  auditTimestampEvidenceAttempt,
  buildWorkerBatchKey,
  buildPortableAsrCacheIdentityV2,
  buildPortableAsrCacheKey,
  evaluateMvlCapabilityHandshake,
  evaluateTimestampEvidenceIntegrityGate,
  selectMvlRuntimeResponseFormat,
} from "@mvl/transcription-core";
import { orderOverlapAcousticProfiles } from "@mvl/video-subtitler";

const COMMIT = "371b5a7561823ab2bb32142d2751e35e7534727b";
const PATCH_SHA =
  "bba39640e7005a1fdeb62c549d04ba76b6fc0d8aedae43daf9c9de1ab10a735d";
const PATCH_SERIES_SHA =
  "9ae5969381786395c6219d360344eeff0be0ab6083c8c359e32b29b3a586fc97";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function utf8Hex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function capability() {
  return {
    schema_version: "mvl-whisper-server-capabilities/1.0.0",
    whisper_cpp_version: "1.9.3",
    upstream_commit: COMMIT,
    patch_id: "mvl-mapped-token-raw-vad-json-v1",
    patch_sha256: PATCH_SHA,
    mapped_token_getter_available: true,
    raw_vad_getter_available: true,
    supported_response_formats: [
      "json",
      "text",
      "srt",
      "verbose_json",
      "vtt",
      "mvl_verbose_json_v1",
    ],
    time_units: ["centiseconds", "seconds"],
    coordinate_system_contract: {
      segment: "original-audio-local",
      token_raw_with_vad: "vad-processed-local",
      token_raw_without_vad: "original-audio-local",
      token_mapped: "original-audio-local",
      raw_vad: "original-audio-local",
    },
  } as const;
}

function response(useVad = false) {
  const raw = useVad
    ? {
        startCentiseconds: 2,
        endCentiseconds: 40,
        coordinateSystem: "vad-processed-local",
      }
    : {
        startCentiseconds: 20,
        endCentiseconds: 60,
        coordinateSystem: "original-audio-local",
      };
  return {
    schema_version: "mvl-whisper-server-response/1.0.0",
    runtime: {
      whisper_cpp_version: "1.9.3",
      upstream_commit: COMMIT,
      patch_id: "mvl-mapped-token-raw-vad-json-v1",
      patch_sha256: PATCH_SHA,
      binary_sha256: null,
      response_schema: "mvl-whisper-server-response/1.0.0",
      capabilities: {
        mapped_token_getter_available: true,
        mapped_token_getter_used: true,
        raw_vad_getter_available: true,
        raw_vad_getter_used: useVad,
        raw_and_mapped_token_times_emitted: true,
        raw_vad_segments_emitted: useVad,
        time_unit: "centiseconds",
      },
    },
    request: {
      response_format: "mvl_verbose_json_v1",
      language: "ja",
      translate: false,
      vad: useVad,
      token_timestamps: true,
      suppress_nst: true,
      max_len: 64,
      split_on_word: true,
      prompt_present: false,
    },
    task: "transcribe",
    language: "japanese",
    durationSeconds: 2,
    text: "あ",
    transcription: [
      {
        id: 0,
        text: "あ",
        startCentiseconds: 10,
        endCentiseconds: 100,
        startSeconds: 0.1,
        endSeconds: 1,
        coordinateSystem: "original-audio-local",
        tokens: [
          {
            index: 0,
            id: 100,
            text: "あ",
            textBytesHex: utf8Hex("あ"),
            special: false,
            probability: 0.95,
            raw,
            mapped: {
              startCentiseconds: 20,
              endCentiseconds: 60,
              coordinateSystem: "original-audio-local",
              method: "whisper_full_get_token_t0_t1",
            },
            dtwCentiseconds: null,
          },
          {
            index: 1,
            id: 50_257,
            text: "<|endoftext|>",
            textBytesHex: utf8Hex("<|endoftext|>"),
            special: true,
            probability: 0.8,
            raw: null,
            mapped: null,
            dtwCentiseconds: null,
          },
        ],
        words: [
          {
            word: "あ",
            wordBytesHex: utf8Hex("あ"),
            memberTokenIndices: [0],
            probability: 0.95,
            rawStartCentiseconds: raw.startCentiseconds,
            rawEndCentiseconds: raw.endCentiseconds,
            mappedStartCentiseconds: 20,
            mappedEndCentiseconds: 60,
          },
        ],
        temperature: 0,
        avgLogProbability: -0.1,
        noSpeechProbability: 0.01,
      },
    ],
    vad_segments: useVad
      ? [
          {
            index: 0,
            startCentiseconds: 10,
            endCentiseconds: 110,
            startSeconds: 0.1,
            endSeconds: 1.1,
            coordinateSystem: "original-audio-local",
            source: "whisper-internal-vad",
          },
        ]
      : [],
  };
}

function audit(input: {
  useVad?: boolean;
  tokens?: {
    id: string;
    text: string;
    raw: [number, number];
    mapped?: [number, number];
  }[];
  rawVad?: [number, number][];
}) {
  const useVad = input.useVad ?? true;
  return auditTimestampEvidenceAttempt({
    attemptId: "attempt",
    profile: useVad ? "current-sensitive-vad" : "no-vad",
    useVad,
    extractionInterval: { start: 100, end: 110 },
    segments: [
      {
        segmentId: "segment",
        text: "あいう",
        rawStart: 1,
        rawEnd: 4,
        confidence: 0.9,
        tokens: (
          input.tokens ?? [
            { id: "token", text: "あ", raw: [0.2, 0.6], mapped: [1.2, 1.6] },
          ]
        ).map((token) => ({
          tokenId: token.id,
          text: token.text,
          rawStart: token.raw[0],
          rawEnd: token.raw[1],
          probability: 0.9,
          rawCoordinateSystem: useVad
            ? ("vad-processed-local" as const)
            : ("original-audio-local" as const),
          ...(token.mapped === undefined
            ? {}
            : {
                officialMappedStart: token.mapped[0],
                officialMappedEnd: token.mapped[1],
              }),
        })),
      },
    ],
    rawVadIntervals: (input.rawVad ?? []).map(([start, end], index) => ({
      intervalId: `vad-${String(index)}`,
      start,
      end,
      coordinateSystem: "original-audio-local" as const,
    })),
    tokenTimestampsRequested: true,
    tokenTimestampPolicy: "mapped-only",
    mappedTokenGetterActuallyUsed: true,
  });
}

describe("C5.16 patched response contract", () => {
  it("accepts no-VAD identity raw/mapped token timing and an empty VAD list", () => {
    const parsed = mvlWhisperServerResponseSchema.parse(response(false));
    expect(parsed.transcription[0]?.tokens[0]?.raw).toEqual(
      parsed.transcription[0]?.tokens[0]?.mapped === null
        ? null
        : {
            startCentiseconds: 20,
            endCentiseconds: 60,
            coordinateSystem: "original-audio-local",
          },
    );
    expect(parsed.vad_segments).toEqual([]);
  });

  it("accepts distinct VAD-processed raw and original-audio mapped coordinates", () => {
    const parsed = mvlWhisperServerResponseSchema.parse(response(true));
    expect(parsed.transcription[0]?.tokens[0]).toMatchObject({
      raw: { coordinateSystem: "vad-processed-local", startCentiseconds: 2 },
      mapped: {
        coordinateSystem: "original-audio-local",
        startCentiseconds: 20,
      },
    });
  });

  it("preserves an untimed VAD lexical token without inventing timing bounds", () => {
    const fixture = response(true);
    const segment = fixture.transcription[0];
    if (segment === undefined) throw new Error("Fixture segment is missing.");
    segment.tokens.splice(1, 0, {
      index: 1,
      id: 101,
      text: "い",
      textBytesHex: utf8Hex("い"),
      special: false,
      probability: 0.4,
      raw: null,
      mapped: null,
      dtwCentiseconds: null,
    });
    const special = segment.tokens[2];
    if (special === undefined)
      throw new Error("Fixture special token is missing.");
    special.index = 2;
    segment.words.push({
      word: "い",
      wordBytesHex: utf8Hex("い"),
      memberTokenIndices: [1],
      probability: 0.4,
      rawStartCentiseconds: null,
      rawEndCentiseconds: null,
      mappedStartCentiseconds: null,
      mappedEndCentiseconds: null,
    });
    expect(mvlWhisperServerResponseSchema.safeParse(fixture).success).toBe(
      true,
    );
    segment.words[1] = {
      ...segment.words[1],
      rawStartCentiseconds: 10,
      rawEndCentiseconds: 11,
    };
    expect(mvlWhisperServerResponseSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it("rejects a mapped token with the wrong coordinate system", () => {
    const fixture = response(true);
    const token = fixture.transcription[0]?.tokens[0];
    if (token?.mapped === null || token?.mapped === undefined) {
      throw new Error("Fixture lexical token is missing mapped timing.");
    }
    token.mapped.coordinateSystem = "vad-processed-local";
    expect(mvlWhisperServerResponseSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it("rejects raw VAD intervals outside the original-audio coordinate contract", () => {
    const fixture = response(true);
    const vadSegment = fixture.vad_segments[0];
    if (vadSegment === undefined) {
      throw new Error("Fixture is missing a raw VAD segment.");
    }
    vadSegment.coordinateSystem = "vad-processed-local";
    expect(mvlWhisperServerResponseSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it("rejects a mapped getter declaration without per-response getter use", () => {
    const fixture = response(false);
    fixture.runtime.capabilities.mapped_token_getter_used = false;
    expect(mvlWhisperServerResponseSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it("rejects decoded VAD speech when raw VAD getter output is absent", () => {
    const fixture = response(true);
    fixture.vad_segments = [];
    fixture.runtime.capabilities.raw_vad_segments_emitted = false;
    expect(mvlWhisperServerResponseSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it("rejects invalid grouped-word membership and mapped bounds", () => {
    const duplicate = response(false);
    const duplicateWord = duplicate.transcription[0]?.words[0];
    if (duplicateWord === undefined) {
      throw new Error("Fixture is missing a grouped word.");
    }
    duplicateWord.memberTokenIndices = [0, 0];
    expect(mvlWhisperServerResponseSchema.safeParse(duplicate).success).toBe(
      false,
    );
    const wrongBound = response(false);
    const wrongBoundWord = wrongBound.transcription[0]?.words[0];
    if (wrongBoundWord === undefined) {
      throw new Error("Fixture is missing a grouped word.");
    }
    wrongBoundWord.mappedEndCentiseconds = 61;
    expect(mvlWhisperServerResponseSchema.safeParse(wrongBound).success).toBe(
      false,
    );
    const wrongBytes = response(false);
    const wrongBytesWord = wrongBytes.transcription[0]?.words[0];
    if (wrongBytesWord === undefined) {
      throw new Error("Fixture is missing a grouped word.");
    }
    wrongBytesWord.wordBytesHex = utf8Hex("い");
    expect(mvlWhisperServerResponseSchema.safeParse(wrongBytes).success).toBe(
      false,
    );
  });

  it("accepts a legal grouped word assembled from split UTF-8 token bytes", () => {
    const fixture = response(false);
    const segment = fixture.transcription[0];
    if (segment === undefined) throw new Error("Fixture segment is missing.");
    const original = segment.tokens[0];
    if (original === undefined) throw new Error("Fixture token is missing.");
    segment.tokens = [
      {
        ...original,
        index: 0,
        text: "�",
        textBytesHex: "e381",
        raw: {
          startCentiseconds: 20,
          endCentiseconds: 40,
          coordinateSystem: "original-audio-local",
        },
        mapped: {
          startCentiseconds: 20,
          endCentiseconds: 40,
          coordinateSystem: "original-audio-local",
          method: "whisper_full_get_token_t0_t1",
        },
      },
      {
        ...original,
        index: 1,
        id: 101,
        text: "�",
        textBytesHex: "82",
        raw: {
          startCentiseconds: 40,
          endCentiseconds: 60,
          coordinateSystem: "original-audio-local",
        },
        mapped: {
          startCentiseconds: 40,
          endCentiseconds: 60,
          coordinateSystem: "original-audio-local",
          method: "whisper_full_get_token_t0_t1",
        },
      },
    ];
    segment.words[0] = {
      word: "あ",
      wordBytesHex: "e38182",
      memberTokenIndices: [0, 1],
      probability: 0.95,
      rawStartCentiseconds: 20,
      rawEndCentiseconds: 60,
      mappedStartCentiseconds: 20,
      mappedEndCentiseconds: 60,
    };
    expect(mvlWhisperServerResponseSchema.safeParse(fixture).success).toBe(
      true,
    );
  });

  it("excludes a special token from mapped-token use requirements", () => {
    const parsed = mvlWhisperServerResponseSchema.parse(response(false));
    expect(
      parsed.transcription[0]?.tokens.filter((token) => !token.special),
    ).toHaveLength(1);
  });

  it("rejects unknown schema versions, unknown fields, and path leakage fields", () => {
    const unknownVersion = response(false) as Record<string, unknown>;
    unknownVersion.schema_version = "mvl-whisper-server-response/9.9.9";
    expect(
      mvlWhisperServerResponseSchema.safeParse(unknownVersion).success,
    ).toBe(false);
    const leaked = response(false);
    Object.assign(leaked.runtime, { model_path: "/Users/test/model.bin" });
    expect(mvlWhisperServerResponseSchema.safeParse(leaked).success).toBe(
      false,
    );
  });
});

describe("C5.16 capability handshake", () => {
  const expectedRuntime = {
    upstreamCommit: COMMIT,
    patchId: "mvl-mapped-token-raw-vad-json-v1",
    patchSha256: PATCH_SHA,
    binarySha256: HASH_A,
    buildFlagsHash: HASH_B,
  };

  it("accepts a strict capability plus matching binary identity", () => {
    const evaluation = evaluateMvlCapabilityHandshake({
      rawCapabilities: capability(),
      expectedRuntime,
      actualBinarySha256: HASH_A,
    });
    expect(evaluation).toMatchObject({ verified: true, failures: [] });
    expect(
      mvlWhisperServerCapabilitiesSchema.parse(evaluation.capability),
    ).toStrictEqual(evaluation.capability);
  });

  it("requires explicit fresh request state for the C5.16.1 patch series", () => {
    const expectedIsolatedRuntime = {
      ...expectedRuntime,
      patchId: mvlWhisperPatchId,
      patchSha256: PATCH_SERIES_SHA,
    };
    const unproved = evaluateMvlCapabilityHandshake({
      rawCapabilities: {
        ...capability(),
        patch_id: mvlWhisperPatchId,
        patch_sha256: PATCH_SERIES_SHA,
      },
      expectedRuntime: expectedIsolatedRuntime,
      actualBinarySha256: HASH_A,
    });
    expect(unproved.verified).toBe(false);
    expect(unproved.failures).toContain("REQUEST_STATE_ISOLATION_UNVERIFIED");

    const proved = evaluateMvlCapabilityHandshake({
      rawCapabilities: {
        ...capability(),
        patch_id: mvlWhisperPatchId,
        patch_sha256: PATCH_SERIES_SHA,
        request_state_isolation: mvlRequestStateIsolation,
      },
      expectedRuntime: expectedIsolatedRuntime,
      actualBinarySha256: HASH_A,
    });
    expect(proved).toMatchObject({ verified: true, failures: [] });
  });

  it.each([
    [
      "missing endpoint",
      null,
      expectedRuntime,
      HASH_A,
      "CAPABILITY_ENDPOINT_SCHEMA_INVALID",
    ],
    [
      "patch mismatch",
      { ...capability(), patch_sha256: HASH_B },
      expectedRuntime,
      HASH_A,
      "PATCH_SHA256_MISMATCH",
    ],
    [
      "binary mismatch",
      capability(),
      expectedRuntime,
      HASH_B,
      "BINARY_SHA256_MISMATCH",
    ],
    [
      "upstream mismatch",
      { ...capability(), upstream_commit: "c".repeat(40) },
      expectedRuntime,
      HASH_A,
      "UPSTREAM_COMMIT_MISMATCH",
    ],
  ])(
    "fails closed for %s",
    (_name, rawCapabilities, expected, binary, reason) => {
      const evaluation = evaluateMvlCapabilityHandshake({
        rawCapabilities,
        expectedRuntime: expected,
        actualBinarySha256: binary,
      });
      expect(evaluation.verified).toBe(false);
      expect(evaluation.failures).toContain(reason);
    },
  );

  it("rejects an unsupported response schema", () => {
    const evaluation = evaluateMvlCapabilityHandshake({
      rawCapabilities: capability(),
      expectedRuntime,
      actualBinarySha256: HASH_A,
      expectedResponseSchema: "mvl-whisper-server-response/2.0.0",
    });
    expect(evaluation.failures).toContain("MVL_RESPONSE_SCHEMA_UNSUPPORTED");
  });

  it("makes require-mapped fail closed while auto falls back safely", () => {
    const evaluation = evaluateMvlCapabilityHandshake({
      rawCapabilities: null,
      expectedRuntime,
      actualBinarySha256: HASH_A,
    });
    expect(() =>
      selectMvlRuntimeResponseFormat({
        timestampRuntimePolicy: "require-mapped",
        rawVadPolicy: "auto",
        evaluation,
      }),
    ).toThrow(/failed its capability handshake/u);
    expect(
      selectMvlRuntimeResponseFormat({
        timestampRuntimePolicy: "auto",
        rawVadPolicy: "auto",
        evaluation,
      }),
    ).toMatchObject({
      responseFormat: "verbose_json",
      capability: null,
    });
  });

  it("keeps legacy-safe on stock JSON and rejects required raw VAD", () => {
    const evaluation = evaluateMvlCapabilityHandshake({
      rawCapabilities: capability(),
      expectedRuntime,
      actualBinarySha256: HASH_A,
    });
    expect(
      selectMvlRuntimeResponseFormat({
        timestampRuntimePolicy: "legacy-safe",
        rawVadPolicy: "off",
        evaluation,
      }),
    ).toMatchObject({
      responseFormat: "verbose_json",
      fallbackReason: "LEGACY_SAFE_POLICY",
    });
    expect(() =>
      selectMvlRuntimeResponseFormat({
        timestampRuntimePolicy: "legacy-safe",
        rawVadPolicy: "required",
        evaluation,
      }),
    ).toThrow(/incompatible/u);
  });

  it("schedules all no-VAD work first while retaining one persistent batch", () => {
    const base = {
      executablePath: "/runtime/whisper-cli",
      modelPath: "/models/large-v3.bin",
      modelHash: HASH_A,
      coreML: false,
      whisperCppVersion: "1.9.3",
      language: "ja" as const,
      threads: 8,
      vadModelPath: "/models/silero.bin",
      vadProfile: "current-sensitive-vad" as const,
      tokenTimestamps: true,
      promptConstraint: "none",
      timestampRuntimePolicy: "require-mapped" as const,
      rawVadPolicy: "required" as const,
      mvlResponseSchemaVersion: "mvl-whisper-server-response/1.0.0",
      expectedMvlRuntime: expectedRuntime,
    };
    expect(buildWorkerBatchKey({ ...base, useVad: true })).toBe(
      buildWorkerBatchKey({
        ...base,
        useVad: false,
        vadProfile: "no-vad",
      }),
    );
    expect(
      orderOverlapAcousticProfiles([
        {
          profiles: ["current-sensitive-vad", "no-vad", "extra-sensitive-vad"],
        },
      ]),
    ).toEqual(["no-vad", "current-sensitive-vad", "extra-sensitive-vad"]);
  });
});

describe("C5.16 mapped token and raw VAD health", () => {
  it("admits a healthy official mapped token on original-media-global", () => {
    const result = audit({});
    expect(result.tokens[0]).toMatchObject({
      timingUsable: true,
      mappedStart: 101.2,
      mappedEnd: 101.6,
      mappedCoordinateSystem: "original-media-global",
      mappingMethod: "official-mapped-token-getter",
    });
  });

  it("preserves but quarantines an official mapped token outside its parent", () => {
    const result = audit({
      tokens: [
        { id: "outside", text: "外", raw: [0.2, 0.6], mapped: [5, 5.4] },
      ],
    });
    expect(result.tokens[0]).toMatchObject({
      timingUsable: false,
      mappedStart: 105,
      mappedEnd: 105.4,
      mappingMethod: "official-mapped-token-getter",
    });
    expect(result.tokens[0]?.quarantineReasons).toContain(
      "TOKEN_OUTSIDE_PARENT_SEGMENT",
    );
  });

  it("quarantines a non-monotonic mapped sequence", () => {
    const result = audit({
      tokens: [
        { id: "later", text: "あ", raw: [0.1, 0.4], mapped: [2, 2.4] },
        { id: "earlier", text: "い", raw: [0.5, 0.8], mapped: [1.4, 1.8] },
      ],
    });
    expect(result.tokens.every((token) => !token.timingUsable)).toBe(true);
    expect(result.integrity.segmentHealth[0]?.tokenMonotonicityPassed).toBe(
      false,
    );
  });

  it("quarantines zero-duration raw token evidence", () => {
    const result = audit({
      tokens: [{ id: "zero", text: "零", raw: [0.2, 0.2], mapped: [1.2, 1.3] }],
    });
    expect(result.tokens[0]?.timingUsable).toBe(false);
    expect(result.tokens[0]?.quarantineReasons).toContain(
      "ZERO_DURATION_TOKEN",
    );
  });

  it("quarantines mapped evidence outside the extraction interval", () => {
    const result = audit({
      tokens: [
        { id: "extract", text: "外", raw: [0.2, 0.6], mapped: [10.1, 10.5] },
      ],
    });
    expect(result.tokens[0]?.timingUsable).toBe(false);
  });

  it("maps one and multiple raw VAD islands without inferring speakers", () => {
    const result = audit({
      rawVad: [
        [0.5, 1],
        [1.5, 2.2],
      ],
    });
    expect(result.rawVadIntervals).toMatchObject([
      {
        start: 100.5,
        end: 101,
        source: "raw-vad",
        mappingMethod: "verified-original-audio-local-offset",
      },
      { start: 101.5, end: 102.2, source: "raw-vad" },
    ]);
    expect(
      result.rawVadIntervals.every((interval) => !("speaker" in interval)),
    ).toBe(true);
  });

  it("labels padding overlap as usable and rejects reverse/out-of-range VAD", () => {
    const padding = audit({
      rawVad: [
        [0.5, 1.5],
        [1.4, 2.2],
      ],
    });
    expect(padding.rawVadIntervals[1]?.rawVadIntervalHealthStatus).toBe(
      "overlapping-with-padding",
    );
    const invalid = audit({
      rawVad: [
        [2, 1],
        [0.5, 10.5],
      ],
    });
    expect(invalid.rawVadIntervals).toEqual([]);
    expect(invalid.integrity.attemptMetrics.rawVadInvalidIntervalCount).toBe(2);
  });

  it("never accepts a decoded segment identifier as raw VAD evidence", () => {
    const attempt = {
      attemptId: "attempt",
      segments: [{ segmentId: "segment", tokenIds: [] }],
      tokens: [],
      rawVadIntervals: [],
    } as unknown as OverlapAcousticAttempt;
    const failures = evaluateTimestampEvidenceIntegrityGate({
      attempts: [attempt],
      alignments: [
        {
          matchedIntervals: [
            {
              attemptId: "attempt",
              source: "raw-vad",
              start: 1,
              end: 2,
              evidenceId: "segment",
              timingUsable: true,
            },
          ],
        } as never,
      ],
    });
    expect(failures).toContain("DECODED_SEGMENT_MISLABELED_AS_RAW_VAD");
  });
});

describe("C5.16 patch, cache, and A/B artifact identity", () => {
  it("strictly verifies the committed ordered patch series and file hashes", async () => {
    const manifestPath = path.resolve(
      "patches/whisper.cpp/v1.9.3/upstream-manifest.json",
    );
    const manifest = whisperUpstreamPatchManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
    );
    const patches = await Promise.all(
      manifest.patchFiles.map(async ({ path: patchName, sha256 }) => {
        const patch = await readFile(
          path.resolve("patches/whisper.cpp/v1.9.3", patchName),
        );
        expect(createHash("sha256").update(patch).digest("hex")).toBe(sha256);
        return patch;
      }),
    );
    expect(manifest.patchFiles.map(({ path: patchName }) => patchName)).toEqual(
      [
        "0001-mvl-mapped-token-raw-vad-json.patch",
        "0002-mvl-request-state-reset.patch",
        "0003-mvl-untimed-token-evidence-guard.patch",
      ],
    );
    expect(
      createHash("sha256").update(Buffer.concat(patches)).digest("hex"),
    ).toBe(manifest.patchSha256);
    expect(manifest.expectedFiles).toEqual([
      "examples/server/server.cpp",
      "include/whisper.h",
      "src/whisper.cpp",
    ]);
  });

  it("isolates stock, patched binaries, patch revisions, schemas, and capabilities", () => {
    const base = {
      audioContentSha256: HASH_A,
      interval: { start: 1, end: 2 },
      sampleRate: 16_000,
      channels: 1,
      codec: "pcm_s16le",
      adapterId: "whisper-cpp",
      model: "ggml-large-v3.bin",
      vadMode: "sensitive-v2",
      timestampStrategy: "segment+token",
      tokenTimestamps: true,
      runtimeType: "mvl-patched",
      runtimeBinarySha256: HASH_A,
      runtimeSourceCommit: COMMIT,
      runtimePatchSha256: PATCH_SHA,
      runtimeResponseSchemaVersion: "mvl-whisper-server-response/1.0.0",
      runtimeTimestampCapabilityHash: HASH_A,
      timestampMappingVersion: "c5.16-official-mapped-getter-v1",
      tokenHealthPolicyVersion: "c5.16-token-health-v1",
      rawVadPolicyVersion: "c5.16-whisper-internal-vad-getter-v1",
    };
    const identities = [
      base,
      { ...base, runtimeType: "stock" },
      { ...base, runtimeBinarySha256: HASH_B },
      { ...base, runtimePatchSha256: HASH_B },
      { ...base, runtimeResponseSchemaVersion: "other-schema" },
      { ...base, runtimeTimestampCapabilityHash: HASH_B },
    ].map((value) =>
      buildPortableAsrCacheKey(buildPortableAsrCacheIdentityV2(value)),
    );
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("strictly parses the versioned A/B artifact and rejects inference drift", () => {
    const pair = {
      componentId: "component-1",
      profile: "current-sensitive-vad",
      audioSha256: HASH_A,
      requestConfigHash: HASH_A,
      stockTextHash: HASH_A,
      patchedTextHash: HASH_A,
      textEqual: true,
      stockSegmentHash: HASH_A,
      patchedSegmentHash: HASH_A,
      segmentsEqual: true,
      stockRawTokenHash: HASH_A,
      patchedRawTokenHash: HASH_A,
      rawTokensComparable: true,
      patchedMappedTokenCount: 1,
      patchedRawVadIntervalCount: 1,
      languageEqual: true,
      requestConfigurationEqual: true,
      promptEqual: true,
      stockResponseBytes: 10,
      patchedResponseBytes: 20,
      stockDurationSeconds: 1,
      patchedDurationSeconds: 1,
      failures: [],
    } as const;
    const artifact = {
      schemaVersion: "1.0.0",
      artifactType: "c5-16-stock-patched-runtime-ab",
      generatedAt: "2026-08-25T00:00:00.000Z",
      upstream: {
        repository: "ggml-org/whisper.cpp",
        tag: "v1.9.3",
        commit: COMMIT,
        sourceTree: "d".repeat(40),
      },
      build: {
        buildIdentityHash: HASH_A,
        buildFlagsHash: HASH_A,
        stockBinarySha256: HASH_A,
        patchedBinarySha256: HASH_B,
        patchSha256: PATCH_SHA,
        sameSource: true,
        sameBuildConfiguration: true,
      },
      modelSha256: HASH_A,
      vadModelSha256: HASH_B,
      requestPairs: [pair],
      perProfile: [
        {
          profile: "current-sensitive-vad",
          pairCount: 1,
          textParityCount: 1,
          segmentParityCount: 1,
          rawTokenParityCount: 1,
          languageParityCount: 1,
          patchedMappedTokenCount: 1,
          patchedRawVadIntervalCount: 1,
        },
      ],
      summary: {
        pairCount: 1,
        freshRequestCount: 2,
        textParityPassed: true,
        segmentParityPassed: true,
        rawTokenParityPassed: true,
        languageParityPassed: true,
        requestConfigurationParityPassed: true,
        promptParityPassed: true,
        stockMappedTokenCount: 0,
        patchedMappedTokenCount: 1,
        stockRawVadIntervalCount: 0,
        patchedRawVadIntervalCount: 1,
        stockWallClockSeconds: 1,
        patchedWallClockSeconds: 1,
        stockWorkerStartCount: 1,
        patchedWorkerStartCount: 1,
        stockModelLoadCount: 1,
        patchedModelLoadCount: 1,
        stockPeakResidentBytes: null,
        patchedPeakResidentBytes: null,
        stockResponseBytes: 10,
        patchedResponseBytes: 20,
        accepted: true,
        failures: [],
      },
    } as const;
    expect(
      c516StockPatchedRuntimeAbArtifactSchema.parse(artifact).summary.accepted,
    ).toBe(true);
    expect(
      c516StockPatchedRuntimeAbArtifactSchema.safeParse({
        ...artifact,
        requestPairs: [{ ...pair, textEqual: false }],
      }).success,
    ).toBe(false);
  });
});
