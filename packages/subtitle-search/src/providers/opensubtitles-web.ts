import { AppError } from "@mvl/shared";

import { fetchBinaryResource, type FetchImplementation } from "../http.js";
import type {
  SubtitleSearchAdapter,
  SubtitleSearchCandidate,
  SubtitleSearchQuery,
} from "../types.js";

const MAX_HTML_BYTES = 2 * 1024 * 1024;

export class OpenSubtitlesWebSearchAdapter implements SubtitleSearchAdapter {
  readonly id = "opensubtitles";
  readonly displayName = "OpenSubtitles public web";
  readonly #fetch: FetchImplementation;
  readonly #userAgent: string;

  constructor(
    options: {
      fetchImpl?: FetchImplementation;
      userAgent?: string;
    } = {},
  ) {
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#userAgent = options.userAgent ?? "MultilingualVideoLearning/0.1.0";
  }

  async search(
    query: SubtitleSearchQuery,
  ): Promise<readonly SubtitleSearchCandidate[]> {
    const title = query.identity.title ?? query.identity.originalTitle;
    if (title === null || title.trim() === "") return [];
    const url = new URL("https://www.opensubtitles.com/en/search");
    url.searchParams.set("q", title);
    const response = await fetchBinaryResource({
      sourceId: this.id,
      url,
      fetchImpl: this.#fetch,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": this.#userAgent,
      },
      allowedHostSuffixes: ["opensubtitles.com"],
      maxBytes: MAX_HTML_BYTES,
      timeoutMs: 15_000,
    });
    const html = new TextDecoder("utf-8").decode(response.bytes);
    if (/challenge-platform|cf-chl-|<title>\s*Just a moment/iu.test(html)) {
      throw new AppError(
        "OpenSubtitles public pages require a browser challenge; the workflow will not bypass it.",
        { code: "EXTERNAL_SERVICE_FAILED" },
      );
    }
    throw new AppError(
      "OpenSubtitles public-page downloads are not automated because its legacy robots rules exclude download paths; configure an API key for this source.",
      { code: "EXTERNAL_SERVICE_FAILED" },
    );
  }
}
