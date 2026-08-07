import { AssrtSearchAdapter } from "./providers/assrt.js";
import { AssrtWebSearchAdapter } from "./providers/assrt-web.js";
import { OpenSubtitlesSearchAdapter } from "./providers/opensubtitles.js";
import { OpenSubtitlesWebSearchAdapter } from "./providers/opensubtitles-web.js";
import type { FetchImplementation } from "./http.js";
import type { SubtitleSearchAdapter } from "./types.js";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function createConfiguredSubtitleSearchAdapters(
  options: {
    environment?: NodeJS.ProcessEnv;
    fetchImpl?: FetchImplementation;
    allowWebFallback?: boolean;
  } = {},
): SubtitleSearchAdapter[] {
  const environment = options.environment ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const allowWebFallback =
    options.allowWebFallback ?? environment.SUBTITLE_WEB_FALLBACK !== "0";
  const adapters: SubtitleSearchAdapter[] = [];
  const openSubtitlesKey = nonEmpty(environment.OPENSUBTITLES_API_KEY);
  if (openSubtitlesKey !== undefined) {
    const bearerToken = nonEmpty(environment.OPENSUBTITLES_BEARER_TOKEN);
    const userAgent = nonEmpty(environment.OPENSUBTITLES_USER_AGENT);
    adapters.push(
      new OpenSubtitlesSearchAdapter({
        apiKey: openSubtitlesKey,
        fetchImpl,
        ...(bearerToken === undefined ? {} : { bearerToken }),
        ...(userAgent === undefined ? {} : { userAgent }),
      }),
    );
  } else if (allowWebFallback) {
    const userAgent = nonEmpty(environment.OPENSUBTITLES_USER_AGENT);
    adapters.push(
      new OpenSubtitlesWebSearchAdapter({
        fetchImpl,
        ...(userAgent === undefined ? {} : { userAgent }),
      }),
    );
  }
  const assrtToken = nonEmpty(environment.ASSRT_TOKEN);
  if (assrtToken !== undefined) {
    const userAgent = nonEmpty(environment.ASSRT_USER_AGENT);
    adapters.push(
      new AssrtSearchAdapter({
        token: assrtToken,
        fetchImpl,
        ...(userAgent === undefined ? {} : { userAgent }),
      }),
    );
  } else if (allowWebFallback) {
    const userAgent = nonEmpty(environment.ASSRT_USER_AGENT);
    adapters.push(
      new AssrtWebSearchAdapter({
        fetchImpl,
        ...(userAgent === undefined ? {} : { userAgent }),
      }),
    );
  }
  return adapters;
}
