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
export const whisperPatchManifestPath = path.join(
  whisperPatchDirectory,
  "upstream-manifest.json",
);

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
  const patchSha256 = await sha256File(whisperPatchPath);
  if (patchSha256 !== manifest.patchSha256) {
    throw new InputError(
      `Whisper patch SHA-256 mismatch: expected ${manifest.patchSha256}, received ${patchSha256}.`,
    );
  }
  const patch = await readFile(whisperPatchPath, "utf8");
  const paths = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gmu)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
  const uniquePaths = [...new Set(paths)].toSorted();
  if (
    stableJson(uniquePaths) !==
    stableJson([...manifest.expectedFiles].toSorted())
  ) {
    throw new InputError(
      `Whisper patch file list does not match manifest: ${uniquePaths.join(", ")}.`,
    );
  }
  const forbidden = [
    /^src\//u,
    /^include\//u,
    /(?:^|\/)whisper\.cpp$/u,
    /CMakeLists\.txt$/u,
  ];
  if (
    uniquePaths.some((file) => forbidden.some((pattern) => pattern.test(file)))
  ) {
    throw new InputError(
      "Whisper evidence serializer patch must not modify core inference or build files.",
    );
  }
}
