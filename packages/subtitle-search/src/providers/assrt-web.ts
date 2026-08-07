import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { AppError, detectTextLanguage, type LanguageTag } from "@mvl/shared";
import { parseSubtitle } from "@mvl/subtitle-core";
import { load } from "cheerio";

import { extractSubtitleDownload } from "../archive.js";
import { fetchBinaryResource, type FetchImplementation } from "../http.js";
import type {
  SubtitleKind,
  SubtitleSearchAdapter,
  SubtitleSearchCandidate,
  SubtitleSearchQuery,
} from "../types.js";

const ASSRT_HOST_SUFFIXES = ["assrt.net"] as const;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

interface SearchRow {
  id: string;
  detailUrl: URL;
  title: string;
  release: string | null;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizedTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function matchesExpectedTitle(
  row: SearchRow,
  query: SubtitleSearchQuery,
): boolean {
  const expected = [
    query.identity.title,
    query.identity.originalTitle,
    ...query.identity.alternativeTitles,
  ]
    .filter((value): value is string => value !== null)
    .map(normalizedTitle)
    .filter((value) => value.length >= 3);
  const actual = normalizedTitle(`${row.title} ${row.release ?? ""}`);
  return expected.some(
    (value) => actual.includes(value) || value.includes(actual),
  );
}

function languageFromPage(value: string, content: string): LanguageTag {
  const match = /字幕语种：\s*([^\n]+)/u.exec(value)?.[1] ?? "";
  const markers: { pattern: RegExp; language: LanguageTag }[] = [
    { pattern: /日/u, language: "ja" },
    { pattern: /英/u, language: "en" },
    { pattern: /简|簡/u, language: "zh-Hans" },
    { pattern: /繁/u, language: "zh-Hant" },
  ];
  const matched = markers.filter((item) => item.pattern.test(match));
  const selected = matched[0];
  if (matched.length === 1 && selected !== undefined) return selected.language;
  return detectTextLanguage(content).language;
}

function candidateKind(
  language: LanguageTag,
  query: SubtitleSearchQuery,
): SubtitleKind {
  if (query.primaryLanguages.includes(language)) return "original";
  if (query.referenceLanguages.includes(language)) return "translation";
  return "unknown";
}

function responseFileName(headers: Headers, finalUrl: URL): string {
  const disposition = headers.get("content-disposition") ?? "";
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/iu.exec(disposition)?.[1];
  if (encoded !== undefined) {
    try {
      return decodeURIComponent(encoded.replaceAll('"', "").trim());
    } catch {
      // Fall through to the non-encoded filename/path.
    }
  }
  const plain = /filename\s*=\s*["']?([^;"']+)/iu.exec(disposition)?.[1];
  const fallback = path.basename(finalUrl.pathname) || "subtitle";
  return normalizeSpace(plain ?? fallback);
}

function parseSearchRows(html: string, baseUrl: URL): SearchRow[] {
  const $ = load(html);
  const rows: SearchRow[] = [];
  $(".subitem").each((_, element) => {
    const anchor = $(element).find("a.introtitle[href]").first();
    const href = anchor.attr("href");
    if (href === undefined) return;
    const id = /\/xml\/sub\/\d+\/(\d+)\.xml/iu.exec(href)?.[1];
    if (id === undefined) return;
    const detailUrl = new URL(href, baseUrl);
    if (
      detailUrl.protocol !== "https:" ||
      !(
        detailUrl.hostname === "assrt.net" ||
        detailUrl.hostname.endsWith(".assrt.net")
      )
    ) {
      return;
    }
    rows.push({
      id,
      detailUrl,
      title: normalizeSpace(anchor.text()),
      release:
        normalizeSpace($(element).find("#meta_top b").first().text()) || null,
    });
  });
  return rows;
}

export class AssrtWebSearchAdapter implements SubtitleSearchAdapter {
  readonly id = "assrt";
  readonly displayName = "ASSRT public web";
  readonly #fetch: FetchImplementation;
  readonly #userAgent: string;
  readonly #maxDownloads: number;
  readonly #requestDelayMs: number;
  #lastRequestAt = 0;

  constructor(
    options: {
      fetchImpl?: FetchImplementation;
      userAgent?: string;
      maxDownloads?: number;
      requestDelayMs?: number;
    } = {},
  ) {
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#userAgent = options.userAgent ?? "MultilingualVideoLearning/0.1.0";
    this.#maxDownloads = Math.max(1, options.maxDownloads ?? 2);
    this.#requestDelayMs = Math.max(0, options.requestDelayMs ?? 750);
  }

  async #waitForRateLimit(): Promise<void> {
    const remaining = this.#lastRequestAt + this.#requestDelayMs - Date.now();
    if (remaining > 0) await delay(remaining);
    this.#lastRequestAt = Date.now();
  }

  async #resource(url: URL, maxBytes: number) {
    await this.#waitForRateLimit();
    return fetchBinaryResource({
      sourceId: this.id,
      url,
      fetchImpl: this.#fetch,
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/octet-stream;q=0.9,*/*;q=0.8",
        "User-Agent": this.#userAgent,
      },
      allowedHostSuffixes: ASSRT_HOST_SUFFIXES,
      maxBytes,
    });
  }

  async #html(url: URL): Promise<string> {
    const resource = await this.#resource(url, MAX_HTML_BYTES);
    const contentType = resource.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xml")) {
      throw new AppError("ASSRT public page returned non-HTML content.", {
        code: "EXTERNAL_SERVICE_FAILED",
        details: { contentType },
      });
    }
    return new TextDecoder("utf-8").decode(resource.bytes);
  }

  async search(
    query: SubtitleSearchQuery,
  ): Promise<readonly SubtitleSearchCandidate[]> {
    const title = query.identity.title ?? query.identity.originalTitle;
    if (title === null || title.trim().length < 3) return [];
    const searchUrl = new URL("https://assrt.net/sub/");
    searchUrl.searchParams.set("searchword", title);
    searchUrl.searchParams.set("sort", "relevance");
    const rows = parseSearchRows(await this.#html(searchUrl), searchUrl)
      .filter((row) => matchesExpectedTitle(row, query))
      .slice(0, 6);
    const candidates: SubtitleSearchCandidate[] = [];
    let lastFailure: Error | undefined;
    for (const row of rows) {
      if (candidates.length >= this.#maxDownloads) break;
      try {
        const detailHtml = await this.#html(row.detailUrl);
        const $ = load(detailHtml);
        const downloadHref = $("#btn_download[href]").first().attr("href");
        if (downloadHref === undefined) continue;
        const movieTitle =
          normalizeSpace($("#movietitle1").first().text()) || row.title;
        const detailText = normalizeSpace($(".detailinfo").first().text());
        const releaseMatch =
          /匹配视频：\s*(.+?)(?:贡献者：|备注：|下载字幕|$)/u.exec(
            detailText,
          )?.[1];
        const download = await this.#resource(
          new URL(downloadHref, row.detailUrl),
          MAX_ARCHIVE_BYTES,
        );
        const extracted = await extractSubtitleDownload({
          bytes: download.bytes,
          fileName: responseFileName(download.headers, download.finalUrl),
          identity: query.identity,
          languages: [...query.primaryLanguages, ...query.referenceLanguages],
        });
        if (extracted === null) continue;
        parseSubtitle(extracted.content, extracted.format);
        const language = languageFromPage(detailText, extracted.content);
        candidates.push({
          id: `web-${row.id}`,
          title: movieTitle.normalize("NFKC").includes(title.normalize("NFKC"))
            ? title
            : movieTitle,
          ...(movieTitle === title ? {} : { originalTitle: movieTitle }),
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
          ...(normalizeSpace(releaseMatch ?? row.release ?? "") === ""
            ? {}
            : {
                releaseGroup: normalizeSpace(releaseMatch ?? row.release ?? ""),
              }),
          language,
          kind: candidateKind(language, query),
          format: extracted.format,
          content: extracted.content,
          sourcePage: row.detailUrl.toString(),
          license:
            "ASSRT public-page result; personal/non-commercial use and ASSRT attribution required.",
        });
      } catch (error) {
        lastFailure = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (candidates.length === 0 && lastFailure !== undefined) throw lastFailure;
    return candidates;
  }
}
