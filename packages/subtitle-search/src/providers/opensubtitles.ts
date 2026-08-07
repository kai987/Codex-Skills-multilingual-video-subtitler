import { normalizeLanguageTag, type LanguageTag } from "@mvl/shared";
import { z } from "zod";

import {
  fetchJson,
  fetchSubtitleText,
  validateDownloadUrl,
  type FetchImplementation,
} from "../http.js";
import type {
  SubtitleKind,
  SubtitleSearchAdapter,
  SubtitleSearchCandidate,
  SubtitleSearchQuery,
} from "../types.js";

const searchResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.union([z.string(), z.number()]),
          attributes: z
            .object({
              language: z.string().optional(),
              hearing_impaired: z.boolean().optional(),
              machine_translated: z.boolean().optional(),
              release: z.string().optional(),
              url: z.string().optional(),
              feature_details: z
                .object({
                  title: z.string().optional(),
                  movie_name: z.string().optional(),
                  year: z.number().int().optional(),
                  season_number: z.number().int().optional(),
                  episode_number: z.number().int().optional(),
                })
                .loose()
                .optional(),
              files: z.array(
                z
                  .object({
                    file_id: z.number().int(),
                    file_name: z.string().optional(),
                  })
                  .loose(),
              ),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .loose();

const downloadResponseSchema = z
  .object({
    link: z.url(),
    file_name: z.string().optional(),
  })
  .loose();

type SearchItem = z.infer<typeof searchResponseSchema>["data"][number];

function languageParameter(languages: readonly LanguageTag[]): string | null {
  const values = languages.flatMap((language) => {
    switch (language) {
      case "zh":
        return ["zh-cn", "zh-tw"];
      case "zh-Hans":
        return ["zh-cn"];
      case "zh-Hant":
        return ["zh-tw"];
      case "ja":
      case "en":
        return [language];
      default:
        return [];
    }
  });
  const unique = [...new Set(values)];
  return unique.length === 0 ? null : unique.join(",");
}

function candidateKind(
  item: SearchItem,
  query: SubtitleSearchQuery,
  language: LanguageTag,
): SubtitleKind {
  if (item.attributes.machine_translated === true) {
    return "machine-translation";
  }
  if (query.referenceLanguages.includes(language)) return "translation";
  if (item.attributes.hearing_impaired === true) return "hearing-impaired";
  if (query.primaryLanguages.includes(language)) return "original";
  return "unknown";
}

function mediaTitle(query: SubtitleSearchQuery, item: SearchItem): string {
  return (
    item.attributes.feature_details?.title ??
    item.attributes.feature_details?.movie_name ??
    query.identity.title ??
    query.identity.originalTitle ??
    "Untitled media"
  );
}

function legacyEncodings(language: LanguageTag): string[] {
  if (language === "ja") return ["shift_jis"];
  if (language === "zh-Hant") return ["big5"];
  if (language === "zh" || language === "zh-Hans") return ["gb18030"];
  return language === "en" ? ["windows-1252"] : [];
}

export class OpenSubtitlesSearchAdapter implements SubtitleSearchAdapter {
  readonly id = "opensubtitles";
  readonly displayName = "OpenSubtitles.com";
  readonly #apiKey: string;
  readonly #bearerToken: string | undefined;
  readonly #userAgent: string;
  readonly #fetch: FetchImplementation;
  readonly #maxDownloads: number;

  constructor(options: {
    apiKey: string;
    bearerToken?: string;
    userAgent?: string;
    fetchImpl?: FetchImplementation;
    maxDownloads?: number;
  }) {
    this.#apiKey = options.apiKey;
    this.#bearerToken = options.bearerToken;
    this.#userAgent = options.userAgent ?? "MultilingualVideoLearning v0.1.0";
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#maxDownloads = Math.max(1, options.maxDownloads ?? 3);
  }

  #headers(includeJson = false): Record<string, string> {
    return {
      "Api-Key": this.#apiKey,
      "User-Agent": this.#userAgent,
      Accept: "application/json",
      ...(includeJson ? { "Content-Type": "application/json" } : {}),
      ...(this.#bearerToken === undefined
        ? {}
        : { Authorization: `Bearer ${this.#bearerToken}` }),
    };
  }

  async search(
    query: SubtitleSearchQuery,
  ): Promise<readonly SubtitleSearchCandidate[]> {
    const searchUrl = new URL("https://api.opensubtitles.com/api/v1/subtitles");
    const title = query.identity.title ?? query.identity.originalTitle;
    if (title !== null) searchUrl.searchParams.set("query", title);
    const languages = languageParameter([
      ...query.primaryLanguages,
      ...query.referenceLanguages,
    ]);
    if (languages !== null) searchUrl.searchParams.set("languages", languages);
    if (query.identity.year !== null) {
      searchUrl.searchParams.set("year", String(query.identity.year));
    }
    if (query.identity.season !== null) {
      searchUrl.searchParams.set(
        "season_number",
        String(query.identity.season),
      );
    }
    if (query.identity.episode !== null) {
      searchUrl.searchParams.set(
        "episode_number",
        String(query.identity.episode),
      );
    }

    const response = await fetchJson({
      sourceId: this.id,
      url: searchUrl,
      schema: searchResponseSchema,
      fetchImpl: this.#fetch,
      init: { headers: this.#headers() },
    });
    const candidates: SubtitleSearchCandidate[] = [];
    let lastDownloadFailure: Error | undefined;
    for (const item of response.data) {
      if (candidates.length >= this.#maxDownloads) break;
      const file = item.attributes.files[0];
      if (file === undefined) continue;
      try {
        const download = await fetchJson({
          sourceId: this.id,
          url: new URL("https://api.opensubtitles.com/api/v1/download"),
          schema: downloadResponseSchema,
          fetchImpl: this.#fetch,
          init: {
            method: "POST",
            headers: this.#headers(true),
            body: JSON.stringify({ file_id: file.file_id, sub_format: "srt" }),
          },
        });
        const content = await fetchSubtitleText({
          sourceId: this.id,
          url: validateDownloadUrl(download.link, [
            "opensubtitles.com",
            "opensubtitles.org",
          ]),
          fetchImpl: this.#fetch,
          allowedHostSuffixes: ["opensubtitles.com", "opensubtitles.org"],
          fallbackEncodings: legacyEncodings(
            normalizeLanguageTag(item.attributes.language),
          ),
          headers: { "User-Agent": this.#userAgent },
        });
        const feature = item.attributes.feature_details;
        const language = normalizeLanguageTag(item.attributes.language);
        candidates.push({
          id: String(item.id),
          title: mediaTitle(query, item),
          ...(feature?.movie_name === undefined
            ? {}
            : { originalTitle: feature.movie_name }),
          ...(feature?.season_number === undefined
            ? {}
            : { season: feature.season_number }),
          ...(feature?.episode_number === undefined
            ? {}
            : { episode: feature.episode_number }),
          ...(feature?.year === undefined ? {} : { year: feature.year }),
          ...(query.identity.runtimeSeconds === null
            ? {}
            : { runtimeSeconds: query.identity.runtimeSeconds }),
          ...(item.attributes.release === undefined
            ? {}
            : { releaseGroup: item.attributes.release }),
          language,
          kind: candidateKind(item, query, language),
          format: "srt",
          content,
          ...(item.attributes.url === undefined
            ? {}
            : { sourcePage: item.attributes.url }),
          license: "OpenSubtitles API result; retain provider attribution.",
        });
      } catch (error) {
        lastDownloadFailure =
          error instanceof Error ? error : new Error(String(error));
        // One broken/quota-limited file must not discard other search results.
      }
    }
    if (candidates.length === 0 && lastDownloadFailure !== undefined) {
      throw lastDownloadFailure;
    }
    return candidates;
  }
}
