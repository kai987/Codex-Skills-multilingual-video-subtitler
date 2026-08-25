import { z } from "zod";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const utf8BytesHexSchema = z.string().regex(/^(?:[a-f0-9]{2})*$/u);
const finiteNumberSchema = z.number();
const nonnegativeFiniteSchema = finiteNumberSchema.nonnegative();
const positiveFiniteSchema = finiteNumberSchema.positive();

function utf8BytesHex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const mvlWhisperResponseSchemaVersion =
  "mvl-whisper-server-response/1.0.0" as const;
export const mvlWhisperCapabilitySchemaVersion =
  "mvl-whisper-server-capabilities/1.0.0" as const;
export const mvlWhisperPatchId = "mvl-mapped-token-raw-vad-json-v1" as const;

export const timestampRuntimePolicySchema = z.enum([
  "auto",
  "require-mapped",
  "legacy-safe",
]);
export const rawVadPolicySchema = z.enum(["auto", "required", "off"]);

const capabilityCoordinateContractSchema = z
  .object({
    segment: z.literal("original-audio-local"),
    token_raw_with_vad: z.literal("vad-processed-local"),
    token_raw_without_vad: z.literal("original-audio-local"),
    token_mapped: z.literal("original-audio-local"),
    raw_vad: z.literal("original-audio-local"),
  })
  .strict();

export const mvlWhisperServerCapabilitiesSchema = z
  .object({
    schema_version: z.literal(mvlWhisperCapabilitySchemaVersion),
    whisper_cpp_version: z.literal("1.9.3"),
    upstream_commit: commitSchema,
    patch_id: z.literal(mvlWhisperPatchId),
    patch_sha256: hashSchema,
    mapped_token_getter_available: z.boolean(),
    raw_vad_getter_available: z.boolean(),
    supported_response_formats: z
      .array(
        z.enum([
          "json",
          "text",
          "srt",
          "verbose_json",
          "vtt",
          "mvl_verbose_json_v1",
        ]),
      )
      .min(1),
    time_units: z.array(z.enum(["centiseconds", "seconds"])).min(1),
    coordinate_system_contract: capabilityCoordinateContractSchema,
  })
  .strict();

const mvlTokenTimeSchema = z
  .object({
    startCentiseconds: z.number().int().nonnegative(),
    endCentiseconds: z.number().int().nonnegative(),
    coordinateSystem: z.enum(["vad-processed-local", "original-audio-local"]),
  })
  .strict()
  .refine((value) => value.endCentiseconds >= value.startCentiseconds, {
    message: "Token time end must be at or after start.",
  });

const mvlMappedTokenTimeSchema = z
  .object({
    startCentiseconds: z.number().int().nonnegative(),
    endCentiseconds: z.number().int().nonnegative(),
    coordinateSystem: z.literal("original-audio-local"),
    method: z.literal("whisper_full_get_token_t0_t1"),
  })
  .strict()
  .refine((value) => value.endCentiseconds >= value.startCentiseconds, {
    message: "Mapped token time end must be at or after start.",
  });

export const mvlWhisperIndividualTokenSchema = z
  .object({
    index: z.number().int().nonnegative(),
    id: z.number().int(),
    text: z.string(),
    textBytesHex: utf8BytesHexSchema,
    special: z.boolean(),
    probability: finiteNumberSchema.min(0).max(1),
    raw: mvlTokenTimeSchema.nullable(),
    mapped: mvlMappedTokenTimeSchema.nullable(),
    dtwCentiseconds: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.special && (value.raw !== null || value.mapped !== null)) {
      context.addIssue({
        code: "custom",
        path: ["special"],
        message: "Special tokens must not carry lexical timing evidence.",
      });
    }
    if ((value.raw === null) !== (value.mapped === null)) {
      context.addIssue({
        code: "custom",
        path: ["mapped"],
        message:
          "Raw and mapped lexical token timing must be emitted together.",
      });
    }
    if (
      !value.text.includes("�") &&
      value.textBytesHex !== utf8BytesHex(value.text)
    ) {
      context.addIssue({
        code: "custom",
        path: ["textBytesHex"],
        message: "Valid token text must agree with its exact UTF-8 bytes.",
      });
    }
  });

export const mvlWhisperGroupedWordSchema = z
  .object({
    word: z.string(),
    wordBytesHex: utf8BytesHexSchema,
    memberTokenIndices: z.array(z.number().int().nonnegative()).min(1),
    probability: finiteNumberSchema.min(0).max(1),
    rawStartCentiseconds: z.number().int().nonnegative().nullable(),
    rawEndCentiseconds: z.number().int().nonnegative().nullable(),
    mappedStartCentiseconds: z.number().int().nonnegative().nullable(),
    mappedEndCentiseconds: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.rawStartCentiseconds === null) !==
        (value.rawEndCentiseconds === null) ||
      (value.mappedStartCentiseconds === null) !==
        (value.mappedEndCentiseconds === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rawStartCentiseconds"],
        message: "Grouped word interval endpoints must be emitted in pairs.",
      });
    }
    if (
      value.rawStartCentiseconds !== null &&
      value.rawEndCentiseconds !== null &&
      value.rawEndCentiseconds < value.rawStartCentiseconds
    ) {
      context.addIssue({
        code: "custom",
        path: ["rawEndCentiseconds"],
        message: "Grouped word raw end must be at or after start.",
      });
    }
    if (
      value.mappedStartCentiseconds !== null &&
      value.mappedEndCentiseconds !== null &&
      value.mappedEndCentiseconds < value.mappedStartCentiseconds
    ) {
      context.addIssue({
        code: "custom",
        path: ["mappedEndCentiseconds"],
        message: "Grouped word mapped end must be at or after start.",
      });
    }
  });

export const mvlWhisperTranscriptionSegmentSchema = z
  .object({
    id: z.number().int().nonnegative(),
    text: z.string(),
    startCentiseconds: z.number().int().nonnegative(),
    endCentiseconds: z.number().int().positive(),
    startSeconds: nonnegativeFiniteSchema,
    endSeconds: positiveFiniteSchema,
    coordinateSystem: z.literal("original-audio-local"),
    tokens: z.array(mvlWhisperIndividualTokenSchema),
    words: z.array(mvlWhisperGroupedWordSchema),
    temperature: finiteNumberSchema,
    avgLogProbability: finiteNumberSchema,
    noSpeechProbability: finiteNumberSchema.min(0).max(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endCentiseconds <= value.startCentiseconds) {
      context.addIssue({
        code: "custom",
        path: ["endCentiseconds"],
        message: "Segment end must be after start.",
      });
    }
    if (
      Math.abs(value.startSeconds - value.startCentiseconds * 0.01) > 1e-6 ||
      Math.abs(value.endSeconds - value.endCentiseconds * 0.01) > 1e-6
    ) {
      context.addIssue({
        code: "custom",
        path: ["startSeconds"],
        message: "Segment seconds and centiseconds must agree.",
      });
    }
    const tokenByIndex = new Map(
      value.tokens.map((token) => [token.index, token]),
    );
    if (tokenByIndex.size !== value.tokens.length) {
      context.addIssue({
        code: "custom",
        path: ["tokens"],
        message: "Token indices must be unique within a segment.",
      });
    }
    for (let wordIndex = 0; wordIndex < value.words.length; wordIndex += 1) {
      const word = value.words[wordIndex];
      if (word === undefined) continue;
      const members = word.memberTokenIndices.map((index) =>
        tokenByIndex.get(index),
      );
      if (
        new Set(word.memberTokenIndices).size !==
          word.memberTokenIndices.length ||
        word.memberTokenIndices.some(
          (memberIndex, index) =>
            index > 0 &&
            memberIndex <= (word.memberTokenIndices[index - 1] ?? -1),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["words", wordIndex, "memberTokenIndices"],
          message:
            "Grouped word member token indices must be unique and ordered.",
        });
      }
      if (members.some((member) => member === undefined || member.special)) {
        context.addIssue({
          code: "custom",
          path: ["words", wordIndex, "memberTokenIndices"],
          message:
            "Grouped word members must reference lexical tokens in the same segment.",
        });
        continue;
      }
      if (
        members.map((member) => member?.textBytesHex ?? "").join("") !==
        word.wordBytesHex
      ) {
        context.addIssue({
          code: "custom",
          path: ["words", wordIndex, "wordBytesHex"],
          message:
            "Grouped word bytes must equal its ordered member token bytes.",
        });
      }
      if (word.wordBytesHex !== utf8BytesHex(word.word)) {
        context.addIssue({
          code: "custom",
          path: ["words", wordIndex, "wordBytesHex"],
          message: "Grouped word text must agree with its UTF-8 bytes.",
        });
      }
      const timed = members.filter(
        (member): member is NonNullable<typeof member> =>
          member?.mapped !== undefined &&
          member.mapped !== null &&
          member.raw !== null,
      );
      if (timed.length === 0) continue;
      const first = timed[0];
      const last = timed.at(-1);
      if (
        first === undefined ||
        last === undefined ||
        word.rawStartCentiseconds !== first.raw?.startCentiseconds ||
        word.rawEndCentiseconds !== last.raw?.endCentiseconds ||
        word.mappedStartCentiseconds !== first.mapped?.startCentiseconds ||
        word.mappedEndCentiseconds !== last.mapped?.endCentiseconds
      ) {
        context.addIssue({
          code: "custom",
          path: ["words", wordIndex],
          message:
            "Grouped word bounds must come from its first and last timed member tokens.",
        });
      }
    }
  });

export const mvlWhisperVadSegmentSchema = z
  .object({
    index: z.number().int().nonnegative(),
    startCentiseconds: z.number().int().nonnegative(),
    endCentiseconds: z.number().int().positive(),
    startSeconds: nonnegativeFiniteSchema,
    endSeconds: positiveFiniteSchema,
    coordinateSystem: z.literal("original-audio-local"),
    source: z.literal("whisper-internal-vad"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endCentiseconds <= value.startCentiseconds) {
      context.addIssue({
        code: "custom",
        path: ["endCentiseconds"],
        message: "Raw VAD interval end must be after start.",
      });
    }
    if (
      Math.abs(value.startSeconds - value.startCentiseconds * 0.01) > 1e-6 ||
      Math.abs(value.endSeconds - value.endCentiseconds * 0.01) > 1e-6
    ) {
      context.addIssue({
        code: "custom",
        path: ["startSeconds"],
        message: "Raw VAD seconds and centiseconds must agree.",
      });
    }
  });

const inferenceCapabilitiesSchema = z
  .object({
    mapped_token_getter_available: z.literal(true),
    mapped_token_getter_used: z.boolean(),
    raw_vad_getter_available: z.literal(true),
    raw_vad_getter_used: z.boolean(),
    raw_and_mapped_token_times_emitted: z.boolean(),
    raw_vad_segments_emitted: z.boolean(),
    time_unit: z.literal("centiseconds"),
  })
  .strict();

export const mvlWhisperServerResponseSchema = z
  .object({
    schema_version: z.literal(mvlWhisperResponseSchemaVersion),
    runtime: z
      .object({
        whisper_cpp_version: z.literal("1.9.3"),
        upstream_commit: commitSchema,
        patch_id: z.literal(mvlWhisperPatchId),
        patch_sha256: hashSchema,
        binary_sha256: z.null(),
        response_schema: z.literal(mvlWhisperResponseSchemaVersion),
        capabilities: inferenceCapabilitiesSchema,
      })
      .strict(),
    request: z
      .object({
        response_format: z.literal("mvl_verbose_json_v1"),
        language: z.string().min(1),
        translate: z.boolean(),
        vad: z.boolean(),
        token_timestamps: z.boolean(),
        suppress_nst: z.boolean(),
        max_len: z.number().int().nonnegative(),
        split_on_word: z.boolean(),
        prompt_present: z.boolean(),
      })
      .strict(),
    task: z.enum(["transcribe", "translate"]),
    language: z.string().min(1),
    durationSeconds: nonnegativeFiniteSchema,
    text: z.string(),
    transcription: z.array(mvlWhisperTranscriptionSegmentSchema),
    vad_segments: z.array(mvlWhisperVadSegmentSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const lexicalTokens = value.transcription.flatMap((segment) =>
      segment.tokens.filter((token) => !token.special),
    );
    const mappedTokens = lexicalTokens.filter((token) => token.mapped !== null);
    const used = value.runtime.capabilities.mapped_token_getter_used;
    if (value.request.token_timestamps && lexicalTokens.length > 0 && !used) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "capabilities", "mapped_token_getter_used"],
        message:
          "Lexical token timing requires proof that the mapped getter was used.",
      });
    }
    if (used !== mappedTokens.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "capabilities", "raw_and_mapped_token_times_emitted"],
        message: "Mapped getter use and mapped token output must agree.",
      });
    }
    if (
      value.runtime.capabilities.raw_and_mapped_token_times_emitted !==
      mappedTokens.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "capabilities", "raw_and_mapped_token_times_emitted"],
        message: "Mapped token emission flag must match response content.",
      });
    }
    if (value.request.vad) {
      if (!value.runtime.capabilities.raw_vad_getter_used) {
        context.addIssue({
          code: "custom",
          path: ["runtime", "capabilities", "raw_vad_getter_used"],
          message: "A VAD request must prove that the raw VAD getter was used.",
        });
      }
      if (value.transcription.length > 0 && value.vad_segments.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["vad_segments"],
          message:
            "A VAD response containing decoded speech must emit raw VAD intervals.",
        });
      }
      for (const [segmentIndex, segment] of value.transcription.entries()) {
        for (const [tokenIndex, token] of segment.tokens.entries()) {
          if (
            value.request.token_timestamps &&
            !token.special &&
            token.raw?.coordinateSystem !== "vad-processed-local"
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "transcription",
                segmentIndex,
                "tokens",
                tokenIndex,
                "raw",
              ],
              message:
                "VAD lexical raw token timing must use the VAD-processed local coordinate system.",
            });
          }
        }
      }
    } else {
      if (
        value.vad_segments.length > 0 ||
        value.runtime.capabilities.raw_vad_getter_used
      ) {
        context.addIssue({
          code: "custom",
          path: ["vad_segments"],
          message:
            "A no-VAD response must have no raw VAD intervals and no getter-use claim.",
        });
      }
      for (const [segmentIndex, segment] of value.transcription.entries()) {
        for (const [tokenIndex, token] of segment.tokens.entries()) {
          if (
            value.request.token_timestamps &&
            !token.special &&
            (token.raw?.coordinateSystem !== "original-audio-local" ||
              token.raw.startCentiseconds !== token.mapped?.startCentiseconds ||
              token.raw.endCentiseconds !== token.mapped.endCentiseconds)
          ) {
            context.addIssue({
              code: "custom",
              path: ["transcription", segmentIndex, "tokens", tokenIndex],
              message:
                "No-VAD lexical token raw and mapped timing must be identical original-audio-local evidence.",
            });
          }
        }
      }
    }
    if (
      value.runtime.capabilities.raw_vad_segments_emitted !==
      value.vad_segments.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "capabilities", "raw_vad_segments_emitted"],
        message: "Raw VAD emission flag must match response content.",
      });
    }
  });

export const whisperRuntimeCapabilityArtifactSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("whisper-runtime-capability"),
    runtimeType: z.enum(["stock", "mvl-patched", "legacy-system"]),
    upstreamRepository: z.literal("ggml-org/whisper.cpp"),
    upstreamTag: z.string().min(1).nullable(),
    upstreamCommit: commitSchema.nullable(),
    patchId: z.literal(mvlWhisperPatchId).nullable(),
    patchSha256: hashSchema.nullable(),
    binaryBasename: z.string().min(1),
    binarySha256: hashSchema,
    buildFlagsHash: hashSchema.nullable(),
    capabilityEndpointResponse: mvlWhisperServerCapabilitiesSchema.nullable(),
    capabilityHash: hashSchema,
    behaviorProbeResults: z
      .object({
        inferenceResponseCount: z.number().int().nonnegative(),
        mappedTokenResponseCount: z.number().int().nonnegative(),
        rawVadResponseCount: z.number().int().nonnegative(),
      })
      .strict(),
    mappedGetterDeclared: z.boolean(),
    mappedGetterActuallyUsed: z.boolean(),
    rawVadGetterDeclared: z.boolean(),
    rawVadGetterActuallyUsed: z.boolean(),
    responseSchema: z.string().min(1),
    verified: z.boolean(),
    failures: z.array(z.string().min(1)),
  })
  .strict();

export const whisperUpstreamPatchManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    repository: z.literal("ggml-org/whisper.cpp"),
    remote: z.literal("https://github.com/ggml-org/whisper.cpp.git"),
    tag: z.literal("v1.9.3"),
    tagObject: commitSchema,
    commit: commitSchema,
    sourceTree: commitSchema,
    patchId: z.literal(mvlWhisperPatchId),
    patchSha256: hashSchema,
    responseSchema: z.literal(mvlWhisperResponseSchemaVersion),
    expectedFiles: z.array(z.literal("examples/server/server.cpp")).length(1),
  })
  .strict();

export const whisperRuntimeBuildManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("whisper-runtime-build-manifest"),
    upstream: whisperUpstreamPatchManifestSchema.pick({
      repository: true,
      remote: true,
      tag: true,
      tagObject: true,
      commit: true,
      sourceTree: true,
    }),
    patch: whisperUpstreamPatchManifestSchema.pick({
      patchId: true,
      patchSha256: true,
      responseSchema: true,
      expectedFiles: true,
    }),
    build: z
      .object({
        buildId: z.string().regex(/^[a-f0-9]{24}$/u),
        compiler: z.string().min(1),
        compilerVersion: z.string().min(1),
        cmakeVersion: z.string().min(1),
        generator: z.string().min(1),
        buildType: z.literal("Release"),
        flags: z.array(z.string().min(1)),
        flagsHash: hashSchema,
        hostArchitecture: z.string().min(1),
        operatingSystem: z.string().min(1),
        deploymentTarget: z.string().min(1).nullable(),
        stockPatchedSameConfiguration: z.literal(true),
        serializerIdentityCompileDefinition: z.string().min(1),
        startedAt: z.iso.datetime(),
        completedAt: z.iso.datetime(),
      })
      .strict(),
    stock: z
      .object({
        runtimeType: z.literal("stock"),
        binaryRelativePath: z.literal("stock/bin/whisper-server"),
        binarySha256: hashSchema,
        linkedLibraries: z.array(z.string().min(1)),
      })
      .strict(),
    patched: z
      .object({
        runtimeType: z.literal("mvl-patched"),
        binaryRelativePath: z.literal("patched/bin/whisper-server-mvl"),
        binarySha256: hashSchema,
        linkedLibraries: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict();

const runtimeAbRequestPairSchema = z
  .object({
    componentId: z.string().min(1),
    profile: z.enum(["current-sensitive-vad", "extra-sensitive-vad", "no-vad"]),
    audioSha256: hashSchema,
    requestConfigHash: hashSchema,
    stockTextHash: hashSchema,
    patchedTextHash: hashSchema,
    textEqual: z.boolean(),
    stockSegmentHash: hashSchema,
    patchedSegmentHash: hashSchema,
    segmentsEqual: z.boolean(),
    stockRawTokenHash: hashSchema,
    patchedRawTokenHash: hashSchema,
    rawTokensComparable: z.boolean(),
    patchedMappedTokenCount: z.number().int().nonnegative(),
    patchedRawVadIntervalCount: z.number().int().nonnegative(),
    languageEqual: z.boolean(),
    requestConfigurationEqual: z.boolean(),
    promptEqual: z.boolean(),
    stockResponseBytes: z.number().int().nonnegative(),
    patchedResponseBytes: z.number().int().nonnegative(),
    stockDurationSeconds: nonnegativeFiniteSchema,
    patchedDurationSeconds: nonnegativeFiniteSchema,
    failures: z.array(z.string().min(1)),
  })
  .strict();

export const c516StockPatchedRuntimeAbArtifactSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c5-16-stock-patched-runtime-ab"),
    generatedAt: z.iso.datetime(),
    upstream: z
      .object({
        repository: z.literal("ggml-org/whisper.cpp"),
        tag: z.literal("v1.9.3"),
        commit: commitSchema,
        sourceTree: commitSchema,
      })
      .strict(),
    build: z
      .object({
        buildIdentityHash: hashSchema,
        buildFlagsHash: hashSchema,
        stockBinarySha256: hashSchema,
        patchedBinarySha256: hashSchema,
        patchSha256: hashSchema,
        sameSource: z.boolean(),
        sameBuildConfiguration: z.boolean(),
      })
      .strict(),
    modelSha256: hashSchema,
    vadModelSha256: hashSchema,
    requestPairs: z.array(runtimeAbRequestPairSchema),
    perProfile: z.array(
      z
        .object({
          profile: z.enum([
            "current-sensitive-vad",
            "extra-sensitive-vad",
            "no-vad",
          ]),
          pairCount: z.number().int().nonnegative(),
          textParityCount: z.number().int().nonnegative(),
          segmentParityCount: z.number().int().nonnegative(),
          rawTokenParityCount: z.number().int().nonnegative(),
          languageParityCount: z.number().int().nonnegative(),
          patchedMappedTokenCount: z.number().int().nonnegative(),
          patchedRawVadIntervalCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    summary: z
      .object({
        pairCount: z.number().int().nonnegative(),
        freshRequestCount: z.number().int().nonnegative(),
        textParityPassed: z.boolean(),
        segmentParityPassed: z.boolean(),
        rawTokenParityPassed: z.boolean(),
        languageParityPassed: z.boolean(),
        requestConfigurationParityPassed: z.boolean(),
        promptParityPassed: z.boolean(),
        stockMappedTokenCount: z.literal(0),
        patchedMappedTokenCount: z.number().int().nonnegative(),
        stockRawVadIntervalCount: z.literal(0),
        patchedRawVadIntervalCount: z.number().int().nonnegative(),
        stockWallClockSeconds: nonnegativeFiniteSchema,
        patchedWallClockSeconds: nonnegativeFiniteSchema,
        stockWorkerStartCount: z.literal(1),
        patchedWorkerStartCount: z.literal(1),
        stockModelLoadCount: z.literal(1),
        patchedModelLoadCount: z.literal(1),
        stockPeakResidentBytes: z.number().int().nonnegative().nullable(),
        patchedPeakResidentBytes: z.number().int().nonnegative().nullable(),
        stockResponseBytes: z.number().int().nonnegative(),
        patchedResponseBytes: z.number().int().nonnegative(),
        accepted: z.boolean(),
        failures: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = {
      pairCount: value.requestPairs.length,
      freshRequestCount: value.requestPairs.length * 2,
      textParityPassed: value.requestPairs.every((pair) => pair.textEqual),
      segmentParityPassed: value.requestPairs.every(
        (pair) => pair.segmentsEqual,
      ),
      rawTokenParityPassed: value.requestPairs.every(
        (pair) => pair.rawTokensComparable,
      ),
      languageParityPassed: value.requestPairs.every(
        (pair) => pair.languageEqual,
      ),
    };
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (value.summary[field as keyof typeof expected] !== expectedValue) {
        context.addIssue({
          code: "custom",
          path: ["summary", field],
          message: `A/B summary ${field} does not match request pairs.`,
        });
      }
    }
    const accepted =
      value.build.sameSource &&
      value.build.sameBuildConfiguration &&
      expected.textParityPassed &&
      expected.segmentParityPassed &&
      expected.rawTokenParityPassed &&
      expected.languageParityPassed &&
      value.summary.requestConfigurationParityPassed &&
      value.summary.promptParityPassed &&
      value.summary.patchedMappedTokenCount > 0 &&
      value.summary.patchedRawVadIntervalCount > 0 &&
      value.requestPairs.every((pair) => pair.failures.length === 0) &&
      value.summary.failures.length === 0;
    if (value.summary.accepted !== accepted) {
      context.addIssue({
        code: "custom",
        path: ["summary", "accepted"],
        message:
          "A/B acceptance must agree with all parity and evidence gates.",
      });
    }
  });

export type TimestampRuntimePolicy = z.infer<
  typeof timestampRuntimePolicySchema
>;
export type RawVadPolicy = z.infer<typeof rawVadPolicySchema>;
export type MvlWhisperServerCapabilities = z.infer<
  typeof mvlWhisperServerCapabilitiesSchema
>;
export type MvlWhisperServerResponse = z.infer<
  typeof mvlWhisperServerResponseSchema
>;
export type WhisperRuntimeCapabilityArtifact = z.infer<
  typeof whisperRuntimeCapabilityArtifactSchema
>;
export type WhisperUpstreamPatchManifest = z.infer<
  typeof whisperUpstreamPatchManifestSchema
>;
export type WhisperRuntimeBuildManifest = z.infer<
  typeof whisperRuntimeBuildManifestSchema
>;
export type C516StockPatchedRuntimeAbArtifact = z.infer<
  typeof c516StockPatchedRuntimeAbArtifactSchema
>;
