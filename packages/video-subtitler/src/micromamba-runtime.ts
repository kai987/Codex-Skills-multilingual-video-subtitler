import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  InputError,
  micromambaInstallationIdentitySchema,
  type MicromambaInstallationIdentity,
} from "@mvl/shared";

export const PINNED_MICROMAMBA_VERSION = "2.8.1-0";
export const PINNED_MICROMAMBA_OSX_ARM64_SHA256 =
  "de71a646b73af92dd663e6ddc78993a6a4d47ea28b5d8908c3cc2b9c3077e528";

const RELEASE_BASE = `https://github.com/mamba-org/micromamba-releases/releases/download/${PINNED_MICROMAMBA_VERSION}`;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function defaultMicromambaRoot(): string {
  return path.join(
    homedir(),
    ".cache",
    "mvl",
    "tools",
    "micromamba",
    PINNED_MICROMAMBA_VERSION,
  );
}

export function pinnedMicromambaRelease(
  input: {
    platform?: NodeJS.Platform;
    architecture?: string;
  } = {},
): {
  asset: "micromamba-osx-arm64";
  expectedSha256: string;
  downloadUrl: string;
  checksumUrl: string;
} {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  if (platform !== "darwin" || architecture !== "arm64") {
    throw new InputError(
      `C5.17.1 has no audited Micromamba asset for ${platform}/${architecture}; fail closed instead of using a floating release.`,
    );
  }
  const asset = "micromamba-osx-arm64" as const;
  return {
    asset,
    expectedSha256: PINNED_MICROMAMBA_OSX_ARM64_SHA256,
    downloadUrl: `${RELEASE_BASE}/${asset}`,
    checksumUrl: `${RELEASE_BASE}/${asset}.sha256`,
  };
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "mvl-c5-17-1-runtime-preparer" },
  });
  if (!response.ok) {
    throw new InputError(
      `Official Micromamba download failed with HTTP ${String(response.status)}.`,
      { url },
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function verifyInstalledBinary(input: {
  executablePath: string;
  expectedSha256: string;
}): Promise<{ size: number; sha256: string } | null> {
  try {
    const info = await stat(input.executablePath);
    if (!info.isFile() || !(await isExecutable(input.executablePath))) {
      return null;
    }
    const digest = sha256(await readFile(input.executablePath));
    return digest === input.expectedSha256
      ? { size: info.size, sha256: digest }
      : null;
  } catch {
    return null;
  }
}

export async function installPinnedMicromamba(input: {
  root?: string;
  allowDownload: boolean;
}): Promise<{
  executablePath: string;
  identity: MicromambaInstallationIdentity;
  downloaded: boolean;
}> {
  const release = pinnedMicromambaRelease();
  const root = path.resolve(input.root ?? defaultMicromambaRoot());
  const executablePath = path.join(root, "micromamba");
  await mkdir(root, { recursive: true });

  let verified = await verifyInstalledBinary({
    executablePath,
    expectedSha256: release.expectedSha256,
  });
  let downloaded = false;
  if (verified === null) {
    if (!input.allowDownload) {
      throw new InputError(
        "Pinned Micromamba is absent or failed checksum verification; rerun with --install-micromamba.",
      );
    }
    const [binary, checksumBytes] = await Promise.all([
      fetchBytes(release.downloadUrl),
      fetchBytes(release.checksumUrl),
    ]);
    const publishedChecksum = new TextDecoder()
      .decode(checksumBytes)
      .trim()
      .split(/\s+/u)[0];
    if (
      publishedChecksum !== release.expectedSha256 ||
      sha256(binary) !== release.expectedSha256
    ) {
      throw new InputError(
        "Pinned Micromamba failed the official and embedded SHA-256 checks.",
        {
          expected: release.expectedSha256,
          published: publishedChecksum,
          actual: sha256(binary),
        },
      );
    }
    const temporaryPath = path.join(
      root,
      `.micromamba-${String(process.pid)}.partial`,
    );
    try {
      await writeFile(temporaryPath, binary, { mode: 0o755, flag: "wx" });
      await chmod(temporaryPath, 0o755);
      await rename(temporaryPath, executablePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    downloaded = true;
    verified = await verifyInstalledBinary({
      executablePath,
      expectedSha256: release.expectedSha256,
    });
  }
  if (verified === null) {
    throw new InputError(
      "Pinned Micromamba installation could not be verified after download.",
    );
  }
  const identity = micromambaInstallationIdentitySchema.parse({
    version: PINNED_MICROMAMBA_VERSION,
    platformAsset: release.asset,
    fileBasename: path.basename(executablePath),
    size: verified.size,
    sha256: verified.sha256,
    expectedSha256: release.expectedSha256,
    downloadUrl: release.downloadUrl,
    checksumUrl: release.checksumUrl,
    officialSource: "mamba-org/micromamba-releases",
    shellProfileModified: false,
    sudoUsed: false,
  });
  return { executablePath, identity, downloaded };
}
