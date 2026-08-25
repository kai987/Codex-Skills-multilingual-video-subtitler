import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  whisperUpstreamPatchManifestSchema,
  type WhisperUpstreamPatchManifest,
} from "@mvl/shared";

export const whisperPatchDirectory = path.resolve("patches/whisper.cpp/v1.9.3");
export const whisperPatchPath = path.join(
  whisperPatchDirectory,
  "0001-mvl-mapped-token-raw-vad-json.patch",
);
export const whisperRequestStatePatchPath = path.join(
  whisperPatchDirectory,
  "0002-mvl-request-state-reset.patch",
);
export const whisperPatchPaths = [
  whisperPatchPath,
  whisperRequestStatePatchPath,
] as const;
export const whisperPatchManifestPath = path.join(
  whisperPatchDirectory,
  "upstream-manifest.json",
);

export function whisperPatchPathsForManifest(
  manifest: WhisperUpstreamPatchManifest,
): string[] {
  return (
    manifest.patchFiles ?? [
      { path: path.basename(whisperPatchPath), sha256: manifest.patchSha256 },
    ]
  ).map((entry) => path.join(whisperPatchDirectory, entry.path));
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    environment?: NodeJS.ProcessEnv;
    allowNonZero?: boolean;
  } = {},
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.environment ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const exitCode = code ?? (signal === null ? 1 : 128);
      if (exitCode !== 0 && options.allowNonZero !== true) {
        reject(
          new Error(
            `${command} exited with ${String(exitCode)}${signal === null ? "" : ` (${signal})`}: ${stderr.slice(-4000)}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256Bytes(await readFile(filePath));
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function readWhisperPatchManifest(): Promise<WhisperUpstreamPatchManifest> {
  return whisperUpstreamPatchManifestSchema.parse(
    JSON.parse(await readFile(whisperPatchManifestPath, "utf8")) as unknown,
  );
}

function normalizeRemote(value: string): string {
  return value.trim().replace(/\.git$/u, "");
}

export async function validatePinnedWhisperSource(input: {
  sourceDirectory: string;
  manifest: WhisperUpstreamPatchManifest;
  requireClean?: boolean;
}): Promise<void> {
  const sourceDirectory = path.resolve(input.sourceDirectory);
  const [commit, tree, remote, status] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], { cwd: sourceDirectory }),
    runCommand("git", ["rev-parse", "HEAD^{tree}"], { cwd: sourceDirectory }),
    runCommand("git", ["remote", "get-url", "origin"], {
      cwd: sourceDirectory,
    }),
    runCommand("git", ["status", "--porcelain"], { cwd: sourceDirectory }),
  ]);
  if (commit.stdout.trim() !== input.manifest.commit) {
    throw new InputError(
      `Whisper source commit mismatch: expected ${input.manifest.commit}, received ${commit.stdout.trim()}.`,
    );
  }
  if (tree.stdout.trim() !== input.manifest.sourceTree) {
    throw new InputError(
      `Whisper source tree mismatch: expected ${input.manifest.sourceTree}, received ${tree.stdout.trim()}.`,
    );
  }
  if (
    normalizeRemote(remote.stdout) !== normalizeRemote(input.manifest.remote)
  ) {
    throw new InputError(
      `Whisper source remote mismatch: expected ${input.manifest.remote}, received ${remote.stdout.trim()}.`,
    );
  }
  if (input.requireClean !== false && status.stdout.trim() !== "") {
    throw new InputError(
      "Whisper source checkout must be clean before patching.",
    );
  }
}

export async function verifyWhisperPatchFiles(
  manifest: WhisperUpstreamPatchManifest,
): Promise<void> {
  const declared = manifest.patchFiles ?? [
    {
      path: path.basename(whisperPatchPath),
      sha256: manifest.patchSha256,
    },
  ];
  const expectedPatchPaths = whisperPatchPathsForManifest(manifest);
  const patchBuffers = await Promise.all(
    expectedPatchPaths.map(async (patchPath) => await readFile(patchPath)),
  );
  const actualPatchHashes = patchBuffers.map((buffer) => sha256Bytes(buffer));
  for (const [index, entry] of declared.entries()) {
    if (actualPatchHashes[index] !== entry.sha256) {
      throw new InputError(
        `Whisper patch SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, received ${String(actualPatchHashes[index])}.`,
      );
    }
  }
  const seriesSha256 = sha256Bytes(Buffer.concat(patchBuffers));
  if (seriesSha256 !== manifest.patchSha256) {
    throw new InputError(
      `Whisper patch-series SHA-256 mismatch: expected ${manifest.patchSha256}, received ${seriesSha256}.`,
    );
  }
  const patchTexts = patchBuffers.map((buffer) => buffer.toString("utf8"));
  const [serializerPatchText] = patchTexts;
  if (serializerPatchText === undefined) {
    throw new InputError("Whisper patch manifest has no serializer patch.");
  }
  const paths = patchTexts.flatMap((patch) =>
    [...patch.matchAll(/^\+\+\+ b\/(.+)$/gmu)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  );
  const uniquePaths = [...new Set(paths)].toSorted();
  if (
    stableJson(uniquePaths) !==
    stableJson([...manifest.expectedFiles].toSorted())
  ) {
    throw new InputError(
      `Whisper patch file list does not match manifest: ${uniquePaths.join(", ")}.`,
    );
  }
  const serializerPaths = [
    ...serializerPatchText.matchAll(/^\+\+\+ b\/(.+)$/gmu),
  ]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
  if (
    stableJson([...new Set(serializerPaths)].toSorted()) !==
    stableJson(["examples/server/server.cpp"])
  ) {
    throw new InputError(
      "Whisper evidence serializer patch must not modify core inference or build files.",
    );
  }
  if (
    patchTexts.some((patch) =>
      /^\+.*(?:temperature_inc|entropy_thold|logprob_thold|vad_threshold|vad_min_|vad_max_|vad_speech_pad|vad_samples_overlap)\s*=/mu.test(
        patch,
      ),
    )
  ) {
    throw new InputError(
      "Whisper patch series must not modify decoding thresholds or VAD parameters.",
    );
  }
}
