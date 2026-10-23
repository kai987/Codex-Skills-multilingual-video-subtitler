import { AppError } from "@mvl/shared";
import type { z } from "zod";

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;

function serviceError(
  sourceId: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  cause?: unknown,
): AppError {
  return new AppError(message, {
    code: "EXTERNAL_SERVICE_FAILED",
    details: { sourceId, ...details },
    ...(cause === undefined ? {} : { cause }),
  });
}

export async function fetchJson<T>(input: {
  sourceId: string;
  url: URL;
  schema: z.ZodType<T>;
  fetchImpl: FetchImplementation;
  init?: RequestInit;
}): Promise<T> {
  let response: Response;
  try {
    response = await input.fetchImpl(input.url, {
      ...input.init,
      signal: input.init?.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw serviceError(
      input.sourceId,
      `${input.sourceId} request failed.`,
      {},
      error,
    );
  }
  if (!response.ok) {
    throw serviceError(input.sourceId, `${input.sourceId} returned an error.`, {
      httpStatus: response.status,
    });
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    throw serviceError(
      input.sourceId,
      `${input.sourceId} returned invalid JSON.`,
      {},
      error,
    );
  }
  const parsed = input.schema.safeParse(value);
  if (!parsed.success) {
    throw serviceError(
      input.sourceId,
      `${input.sourceId} returned an unsupported response shape.`,
      { issues: parsed.error.issues.slice(0, 5) },
    );
  }
  return parsed.data;
}

function isAllowedHost(hostname: string, suffixes: readonly string[]): boolean {
  const normalized = hostname.toLowerCase();
  return suffixes.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

export function validateDownloadUrl(
  value: string,
  allowedHostSuffixes: readonly string[],
): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    if (
      url.protocol === "http:" &&
      isAllowedHost(url.hostname, allowedHostSuffixes)
    ) {
      url.protocol = "https:";
    } else {
      throw new AppError("Subtitle download URL must use HTTPS.", {
        code: "EXTERNAL_SERVICE_FAILED",
      });
    }
  }
  if (!isAllowedHost(url.hostname, allowedHostSuffixes)) {
    throw new AppError(
      "Subtitle provider returned an untrusted download host.",
      {
        code: "EXTERNAL_SERVICE_FAILED",
        details: { hostname: url.hostname },
      },
    );
  }
  url.username = "";
  url.password = "";
  return url;
}

export async function fetchBinaryResource(input: {
  sourceId: string;
  url: URL;
  fetchImpl: FetchImplementation;
  headers?: Readonly<Record<string, string>>;
  allowedHostSuffixes: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<{ bytes: Uint8Array; finalUrl: URL; headers: Headers }> {
  const maxBytes = Math.max(1, input.maxBytes ?? MAX_RESOURCE_BYTES);
  let currentUrl = validateDownloadUrl(
    input.url.toString(),
    input.allowedHostSuffixes,
  );
  let response: Response | undefined;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    try {
      response = await input.fetchImpl(currentUrl, {
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        redirect: "manual",
        signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw serviceError(
        input.sourceId,
        `${input.sourceId} resource request failed.`,
        {},
        error,
      );
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (location === null || redirectCount === 3) {
      throw serviceError(input.sourceId, "Resource redirect failed.");
    }
    currentUrl = validateDownloadUrl(
      new URL(location, currentUrl).toString(),
      input.allowedHostSuffixes,
    );
  }
  if (response === undefined) {
    throw serviceError(input.sourceId, "Resource request did not respond.");
  }
  if (!response.ok) {
    throw serviceError(input.sourceId, `${input.sourceId} returned an error.`, {
      httpStatus: response.status,
    });
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw serviceError(input.sourceId, "Downloaded resource is too large.", {
      maxBytes,
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw serviceError(input.sourceId, "Downloaded resource is too large.", {
      maxBytes,
    });
  }
  return { bytes, finalUrl: currentUrl, headers: response.headers };
}

export async function fetchSubtitleText(input: {
  sourceId: string;
  url: URL;
  fetchImpl: FetchImplementation;
  headers?: Readonly<Record<string, string>>;
  allowedHostSuffixes: readonly string[];
  fallbackEncodings?: readonly string[];
}): Promise<string> {
  const resource = await fetchBinaryResource({
    sourceId: input.sourceId,
    url: input.url,
    fetchImpl: input.fetchImpl,
    ...(input.headers === undefined ? {} : { headers: input.headers }),
    allowedHostSuffixes: input.allowedHostSuffixes,
    maxBytes: MAX_SUBTITLE_BYTES,
  });
  const declaredEncoding = resource.headers
    .get("content-type")
    ?.match(/charset\s*=\s*["']?([^;"'\s]+)/iu)?.[1];
  const encodings = [
    declaredEncoding,
    "utf-8",
    ...(input.fallbackEncodings ?? []),
  ].filter(
    (encoding, index, values): encoding is string =>
      encoding !== undefined && values.indexOf(encoding) === index,
  );
  let text: string | undefined;
  for (const encoding of encodings) {
    try {
      text = new TextDecoder(encoding, { fatal: true }).decode(resource.bytes);
      break;
    } catch {
      // Try the next declared/language-specific legacy encoding.
    }
  }
  text ??= new TextDecoder("utf-8").decode(resource.bytes);
  text = text.replace(/^\uFEFF/u, "");
  if (text.trim() === "") {
    throw serviceError(input.sourceId, "Subtitle download was empty.");
  }
  return text;
}
