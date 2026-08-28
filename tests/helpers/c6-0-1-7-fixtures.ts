import {
  mvlWhisperServerResponseSchema,
  type MvlWhisperServerResponse,
} from "@mvl/shared";

function utf8Hex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function freshWhisperResponse(text: string): MvlWhisperServerResponse {
  return mvlWhisperServerResponseSchema.parse({
    schema_version: "mvl-whisper-server-response/1.0.0",
    runtime: {
      whisper_cpp_version: "1.9.3",
      upstream_commit: "371b5a7561823ab2bb32142d2751e35e7534727b",
      patch_id: "mvl-mapped-token-raw-vad-json-v1",
      patch_sha256: "a".repeat(64),
      binary_sha256: null,
      response_schema: "mvl-whisper-server-response/1.0.0",
      capabilities: {
        mapped_token_getter_available: true,
        mapped_token_getter_used: true,
        raw_vad_getter_available: true,
        raw_vad_getter_used: false,
        raw_and_mapped_token_times_emitted: true,
        raw_vad_segments_emitted: false,
        time_unit: "centiseconds",
      },
    },
    request: {
      response_format: "mvl_verbose_json_v1",
      language: "ja",
      translate: false,
      vad: false,
      token_timestamps: true,
      suppress_nst: true,
      max_len: 64,
      split_on_word: true,
      prompt_present: false,
    },
    task: "transcribe",
    language: "japanese",
    durationSeconds: 2,
    text,
    transcription: [
      {
        id: 0,
        text,
        startCentiseconds: 10,
        endCentiseconds: 100,
        startSeconds: 0.1,
        endSeconds: 1,
        coordinateSystem: "original-audio-local",
        tokens: [
          {
            index: 0,
            id: 100,
            text,
            textBytesHex: utf8Hex(text),
            special: false,
            probability: 0.95,
            raw: {
              startCentiseconds: 20,
              endCentiseconds: 80,
              coordinateSystem: "original-audio-local",
            },
            mapped: {
              startCentiseconds: 20,
              endCentiseconds: 80,
              coordinateSystem: "original-audio-local",
              method: "whisper_full_get_token_t0_t1",
            },
            dtwCentiseconds: null,
          },
        ],
        words: [
          {
            word: text,
            wordBytesHex: utf8Hex(text),
            memberTokenIndices: [0],
            probability: 0.95,
            rawStartCentiseconds: 20,
            rawEndCentiseconds: 80,
            mappedStartCentiseconds: 20,
            mappedEndCentiseconds: 80,
          },
        ],
        temperature: 0,
        avgLogProbability: -0.1,
        noSpeechProbability: 0.01,
      },
    ],
    vad_segments: [],
  });
}
