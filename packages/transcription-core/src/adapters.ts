import { createReadStream } from "node:fs";

import { InputError } from "@mvl/shared";
import OpenAI from "openai";

import type {
  TranscriptionAdapter,
  TranscriptionChunkResult,
  TranscriptionRequest,
} from "./types.js";

export class MockTranscriptionAdapter implements TranscriptionAdapter {
  readonly id = "mock";
  readonly model = "mock-transcription-v1";
  readonly #results: readonly TranscriptionChunkResult[];
  calls = 0;

  constructor(results: readonly TranscriptionChunkResult[]) {
    this.#results = results;
  }

  transcribe(
    _request: TranscriptionRequest,
  ): Promise<TranscriptionChunkResult> {
    const result = this.#results[this.calls] ?? {
      text: "Mock transcription.",
      segments: [
        {
          start: 0,
          end: _request.chunk.duration,
          text: "Mock transcription.",
          speaker: null,
          confidence: 1,
        },
      ],
      raw: { provider: "mock" },
    };
    this.calls += 1;
    return Promise.resolve(result);
  }
}

export class OpenAITranscriptionAdapter implements TranscriptionAdapter {
  readonly id = "openai";
  readonly model: string;
  readonly #client: OpenAI;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new InputError(
        "OPENAI_API_KEY is required when audio transcription is needed.",
        { environmentVariable: "OPENAI_API_KEY" },
      );
    }
    this.model =
      options.model ??
      process.env.OPENAI_TRANSCRIPTION_MODEL ??
      "gpt-4o-transcribe";
    this.#client = new OpenAI({ apiKey });
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionChunkResult> {
    if (request.timestampStrategy === "segment" && this.model !== "whisper-1") {
      throw new InputError(
        "Segment timestamp strategy requires OPENAI_TRANSCRIPTION_MODEL=whisper-1.",
        { model: this.model, timestampStrategy: request.timestampStrategy },
      );
    }
    if (this.model === "whisper-1") {
      const response = await this.#client.audio.transcriptions.create({
        file: createReadStream(request.audioPath),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
        ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
        ...(request.language === undefined ||
        request.language === "mixed" ||
        request.language === "und"
          ? {}
          : {
              language: request.language.startsWith("zh")
                ? "zh"
                : request.language,
            }),
      });
      const segments = (response.segments ?? [])
        .map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
          speaker: null,
          confidence: null,
        }))
        .filter(
          (segment) => segment.text !== "" && segment.end > segment.start,
        );
      return { text: response.text, segments, raw: response };
    }
    const response = await this.#client.audio.transcriptions.create({
      file: createReadStream(request.audioPath),
      model: this.model,
      response_format: "json",
      ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
      ...(request.language === undefined ||
      request.language === "mixed" ||
      request.language === "und"
        ? {}
        : {
            language: request.language.startsWith("zh")
              ? "zh"
              : request.language,
          }),
    });
    const text = response.text.trim();
    return {
      text,
      segments:
        text === ""
          ? []
          : [
              {
                start: 0,
                end: request.chunk.duration,
                text,
                speaker: null,
                confidence: null,
              },
            ],
      raw: response,
    };
  }
}
