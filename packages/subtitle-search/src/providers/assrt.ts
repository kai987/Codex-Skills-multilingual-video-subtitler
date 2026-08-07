import { detectTextLanguage, type LanguageTag } from "@mvl/shared";
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

const searchItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    native_name: z.string().optional(),
    videoname: z.string().optional(),
    subtype: z.string().optional(),
    lang: z.string().optional(),
    langlist: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const searchResponseSchema = z
  .object({
    status: z.number().optional(),
    sub: z
      .object({
        subs: z.array(searchItemSchema).default([]),
      })
      .loose(),
  })
  .loose();

const fileSchema = z
  .object({
    url: z.url(),
    fname: z.string().optional(),
  })
  .loose();

const detailResponseSchema = z
  .object({
    sub: z
      .object({
        subs: z.array(
          z
            .object({
              id: z.union([z.string(), z.number()]).optional(),
              native_name: z.string().optional(),
              videoname: z.string().optional(),
              subtype: z.string().optional(),
              lang: z.string().optional(),
              langlist: z.record(z.string(), z.unknown()).optional(),
              filelist: z.array(fileSchema).default([]),
              producer: z
                .object({ source: z.string().optional() })
                .loose()
                .optional(),
            })
            .loose(),
        ),
      })
      .loose(),
  })
  .loose();

type AssrtItem = z.infer<typeof detailResponseSchema>["sub"]["subs"][number];

function formatFromName(
  fileName: string | undefined,
  subtype: string | undefined,
): "srt" | "vtt" | "ass" | "ssa" | null {
  const extension = fileName?.split(".").at(-1)?.toLowerCase();
  const value = extension ?? subtype?.toLowerCase();
  return value === "srt" ||
    value === "vtt" ||
    value === "ass" ||
    value === "ssa"
    ? value
    : null;
}

function languageFromMetadata(item: AssrtItem, content: string): LanguageTag {
  const keys = Object.keys(item.langlist ?? {}).map((key) => key.toLowerCase());
  const found: LanguageTag[] = [];
  if (keys.some((key) => key.includes("jpn") || key.includes("jap"))) {
    found.push("ja");
  }
  if (keys.some((key) => key.includes("eng"))) found.push("en");
  if (keys.some((key) => key.includes("chs") || key.includes("chi"))) {
    found.push("zh-Hans");
  }
  if (keys.some((key) => key.includes("cht"))) found.push("zh-Hant");
  const unique = [...new Set(found)];
  if (unique.length > 1) return "mixed";
  if (unique[0] !== undefined) return unique[0];
  const declared = (item.lang ?? "").toLowerCase();
  if (/日|jpn|jap/u.test(declared)) return "ja";
  if (/英|eng/u.test(declared)) return "en";
  if (/繁|cht/u.test(declared)) return "zh-Hant";
  if (/简|chs|chi|中/u.test(declared)) return "zh-Hans";
  return detectTextLanguage(content).language;
}

function candidateKind(
  item: AssrtItem,
  query: SubtitleSearchQuery,
  language: LanguageTag,
): SubtitleKind {
  const producer = item.producer?.source ?? "";
  if (/机翻|机器翻译|machine/iu.test(producer)) return "machine-translation";
  if (
    language === "mixed" ||
    query.referenceLanguages.includes(language) ||
    /翻译|字幕组/u.test(producer)
  ) {
    return "translation";
  }
  if (query.primaryLanguages.includes(language)) return "original";
  return "unknown";
}

function legacyEncodings(language: LanguageTag): string[] {
  if (language === "ja") return ["shift_jis"];
  if (language === "zh-Hant") return ["big5"];
  if (language === "zh" || language === "zh-Hans") return ["gb18030"];
  return language === "en" ? ["windows-1252"] : [];
}

export class AssrtSearchAdapter implements SubtitleSearchAdapter {
  readonly id = "assrt";
  readonly displayName = "ASSRT";
  readonly #token: string;
  readonly #userAgent: string;
  readonly #fetch: FetchImplementation;
  readonly #maxDownloads: number;

  constructor(options: {
    token: string;
    userAgent?: string;
    fetchImpl?: FetchImplementation;
    maxDownloads?: number;
  }) {
    this.#token = options.token;
    this.#userAgent = options.userAgent ?? "MultilingualVideoLearning/0.1.0";
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#maxDownloads = Math.max(1, options.maxDownloads ?? 3);
  }

  #headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.#token}`,
      Accept: "application/json",
      "User-Agent": this.#userAgent,
    };
  }

  async search(
    query: SubtitleSearchQuery,
  ): Promise<readonly SubtitleSearchCandidate[]> {
    const title = query.identity.title ?? query.identity.originalTitle;
    if (title === null || title.trim().length < 3) return [];
    const terms = [
      title,
      query.identity.season === null ? null : `S${query.identity.season}`,
      query.identity.episode === null ? null : `E${query.identity.episode}`,
    ].filter((value): value is string => value !== null);
    const searchUrl = new URL("https://api.assrt.net/v1/sub/search");
    searchUrl.searchParams.set("q", terms.join(" ").slice(0, 15));
    searchUrl.searchParams.set("cnt", "10");
    const response = await fetchJson({
      sourceId: this.id,
      url: searchUrl,
      schema: searchResponseSchema,
      fetchImpl: this.#fetch,
      init: { headers: this.#headers() },
    });
    const candidates: SubtitleSearchCandidate[] = [];
    let lastDownloadFailure: Error | undefined;
    for (const summary of response.sub.subs) {
      if (candidates.length >= this.#maxDownloads) break;
      try {
        const detailUrl = new URL("https://api.assrt.net/v1/sub/detail");
        detailUrl.searchParams.set("id", String(summary.id));
        const detail = await fetchJson({
          sourceId: this.id,
          url: detailUrl,
          schema: detailResponseSchema,
          fetchImpl: this.#fetch,
          init: { headers: this.#headers() },
        });
        const item = detail.sub.subs[0];
        if (item === undefined) continue;
        const selected = item.filelist
          .map((file) => ({
            file,
            format: formatFromName(file.fname, item.subtype),
          }))
          .find(
            (
              entry,
            ): entry is {
              file: z.infer<typeof fileSchema>;
              format: "srt" | "vtt" | "ass" | "ssa";
            } => entry.format !== null,
          );
        if (selected === undefined) continue;
        const content = await fetchSubtitleText({
          sourceId: this.id,
          url: validateDownloadUrl(selected.file.url, ["assrt.net"]),
          fetchImpl: this.#fetch,
          allowedHostSuffixes: ["assrt.net"],
          fallbackEncodings: legacyEncodings(languageFromMetadata(item, "")),
          headers: { "User-Agent": this.#userAgent },
        });
        const language = languageFromMetadata(item, content);
        candidates.push({
          id: String(item.id ?? summary.id),
          title:
            item.videoname ??
            item.native_name ??
            summary.videoname ??
            summary.native_name ??
            title,
          ...(query.identity.season === null
            ? {}
            : { season: query.identity.season }),
          ...(query.identity.episode === null
            ? {}
            : { episode: query.identity.episode }),
          ...(query.identity.year === null
            ? {}
            : { year: query.identity.year }),
          ...(query.identity.runtimeSeconds === null
            ? {}
            : { runtimeSeconds: query.identity.runtimeSeconds }),
          language,
          kind: candidateKind(item, query, language),
          format: selected.format,
          content,
          sourcePage: `https://assrt.net/xml/sub/${String(summary.id)}.xml`,
          license: "ASSRT API result; retain ASSRT attribution.",
        });
      } catch (error) {
        lastDownloadFailure =
          error instanceof Error ? error : new Error(String(error));
        // Continue with the next result when one temporary URL/file is invalid.
      }
    }
    if (candidates.length === 0 && lastDownloadFailure !== undefined) {
      throw lastDownloadFailure;
    }
    return candidates;
  }
}
