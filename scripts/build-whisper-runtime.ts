import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { InputError, whisperRuntimeBuildManifestSchema } from "@mvl/shared";

import {
  readWhisperPatchManifest,
  runCommand,
  sha256File,
  sha256Bytes,
  stableJson,
  validatePinnedWhisperSource,
  verifyWhisperPatchFiles,
  whisperPatchPath,
} from "./whisper-runtime-common.js";

const { values } = parseArgs({
  options: {
    "source-dir": { type: "string" },
    "fetch-upstream": { type: "boolean", default: false },
    "upstream-tag": { type: "string", default: "v1.9.3" },
    output: { type: "string" },
    jobs: { type: "string" },
  },
  strict: true,
});

if (values["upstream-tag"] !== "v1.9.3") {
  throw new InputError(
    "C5.16 runtime builds are pinned to --upstream-tag v1.9.3.",
  );
}
if (values["source-dir"] !== undefined && values["fetch-upstream"]) {
  throw new InputError(
    "Choose either --source-dir or --fetch-upstream, not both.",
  );
}
if (values["source-dir"] === undefined && !values["fetch-upstream"]) {
  throw new InputError(
    "Provide --source-dir <clean pinned checkout> or explicitly allow --fetch-upstream.",
  );
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

const manifest = await readWhisperPatchManifest();
await verifyWhisperPatchFiles(manifest);

async function resolveSourceDirectory(): Promise<string> {
  if (values["source-dir"] !== undefined) {
    return path.resolve(values["source-dir"]);
  }
  const cacheDirectory = path.join(
    homedir(),
    ".cache/mvl/whisper-upstream/whisper.cpp-v1.9.3",
  );
  if (!(await isDirectory(cacheDirectory))) {
    await mkdir(path.dirname(cacheDirectory), { recursive: true });
    await runCommand("git", [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      manifest.remote,
      cacheDirectory,
    ]);
  }
  const remote = await runCommand("git", ["remote", "get-url", "origin"], {
    cwd: cacheDirectory,
  });
  if (
    remote.stdout.trim().replace(/\.git$/u, "") !==
    manifest.remote.replace(/\.git$/u, "")
  ) {
    throw new InputError(
      "Cached whisper.cpp checkout does not use the official remote.",
    );
  }
  await runCommand(
    "git",
    [
      "fetch",
      "--force",
      "origin",
      `refs/tags/${manifest.tag}:refs/tags/${manifest.tag}`,
    ],
    { cwd: cacheDirectory },
  );
  const fetchedCommit = await runCommand(
    "git",
    ["rev-parse", `${manifest.tag}^{commit}`],
    { cwd: cacheDirectory },
  );
  if (fetchedCommit.stdout.trim() !== manifest.commit) {
    throw new InputError(
      "Fetched upstream tag does not resolve to the pinned commit.",
    );
  }
  await runCommand("git", ["checkout", "--detach", manifest.commit], {
    cwd: cacheDirectory,
  });
  return cacheDirectory;
}

const sourceDirectory = await resolveSourceDirectory();
await validatePinnedWhisperSource({
  sourceDirectory,
  manifest,
  requireClean: true,
});
await runCommand("git", ["apply", "--check", whisperPatchPath], {
  cwd: sourceDirectory,
});

const configuredCompiler = process.env.CXX?.trim();
const compiler =
  configuredCompiler === undefined || configuredCompiler.length === 0
    ? "c++"
    : configuredCompiler;
const [compilerVersionResult, cmakeVersionResult, osVersionResult] =
  await Promise.all([
    runCommand(compiler, ["--version"]),
    runCommand("cmake", ["--version"]),
    runCommand(
      process.platform === "darwin" ? "sw_vers" : "uname",
      process.platform === "darwin" ? ["-productVersion"] : ["-srv"],
    ),
  ]);
const compilerVersion =
  compilerVersionResult.stdout.trim().split(/\r?\n/u)[0] ?? "unknown";
const cmakeVersion =
  cmakeVersionResult.stdout.trim().split(/\r?\n/u)[0] ?? "unknown";
const operatingSystem = `${process.platform} ${osVersionResult.stdout.trim()}`;
const baseFlags = [
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_BUILD_RPATH=@executable_path",
  "-DCMAKE_INSTALL_RPATH=@executable_path",
  "-DWHISPER_BUILD_TESTS=OFF",
  "-DWHISPER_BUILD_EXAMPLES=ON",
  "-DWHISPER_BUILD_SERVER=ON",
  "-DWHISPER_COREML=OFF",
  "-DGGML_METAL=ON",
  "-DGGML_BLAS=ON",
  "-DGGML_OPENMP=ON",
  "-DGGML_CCACHE=OFF",
];
const buildIdentity = {
  upstreamCommit: manifest.commit,
  sourceTree: manifest.sourceTree,
  patchSha256: manifest.patchSha256,
  baseFlags,
  compilerVersion,
  cmakeVersion,
  architecture: process.arch,
  platform: process.platform,
  deploymentTarget: process.env.MACOSX_DEPLOYMENT_TARGET ?? null,
};
const buildId = sha256Bytes(stableJson(buildIdentity)).slice(0, 24);
const outputRoot = path.resolve(
  values.output ?? path.join(homedir(), ".cache/mvl/whisper-runtime"),
);
const commitRoot = path.join(outputRoot, manifest.commit);
const targetRoot = path.join(commitRoot, buildId);
const existingManifestPath = path.join(targetRoot, "build-manifest.json");
try {
  const existing = whisperRuntimeBuildManifestSchema.parse(
    JSON.parse(await readFile(existingManifestPath, "utf8")) as unknown,
  );
  const runtimeFiles = [
    path.join(targetRoot, existing.stock.binaryRelativePath),
    path.join(targetRoot, existing.patched.binaryRelativePath),
    ...[...existing.stock.linkedLibraries, ...existing.patched.linkedLibraries]
      .filter((library) => library.startsWith("@rpath/"))
      .flatMap((library) => [
        path.join(targetRoot, "stock/bin", path.basename(library)),
        path.join(targetRoot, "patched/bin", path.basename(library)),
      ]),
  ];
  await Promise.all(runtimeFiles.map(async (file) => await stat(file)));
  process.stdout.write(
    `${JSON.stringify({ ok: true, reused: true, runtimeRoot: targetRoot, manifest: existing }, null, 2)}\n`,
  );
  process.exit(0);
} catch {
  // A missing, invalid, or non-portable runtime triggers a fresh build. Keep an
  // invalid prior target for inspection instead of destructively overwriting it.
  if (await isDirectory(targetRoot)) {
    await rename(
      targetRoot,
      path.join(commitRoot, `.${buildId}.invalid-${randomUUID()}`),
    );
  }
}

await mkdir(commitRoot, { recursive: true });
const stagingRoot = path.join(
  commitRoot,
  `.${buildId}.building-${randomUUID()}`,
);
await mkdir(stagingRoot, { recursive: false });
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "mvl-whisper-runtime-build-"),
);
const stockSource = path.join(temporaryRoot, "stock-source");
const patchedSource = path.join(temporaryRoot, "patched-source");
const startedAt = new Date().toISOString();

async function copyRuntimeBin(input: {
  buildDirectory: string;
  destination: string;
  patched: boolean;
}): Promise<string> {
  const sourceBin = path.join(input.buildDirectory, "bin");
  await mkdir(input.destination, { recursive: true });
  for (const name of await readdir(sourceBin)) {
    if (
      name !== "whisper-server" &&
      !/^lib.+\.dylib(?:\..*)?$/u.test(name) &&
      !/^lib.+\.so(?:\..*)?$/u.test(name)
    ) {
      continue;
    }
    const destinationName =
      input.patched && name === "whisper-server" ? "whisper-server-mvl" : name;
    await cp(
      path.join(sourceBin, name),
      path.join(input.destination, destinationName),
      {
        recursive: true,
        dereference: true,
        preserveTimestamps: true,
      },
    );
  }
  const binaryPath = path.join(
    input.destination,
    input.patched ? "whisper-server-mvl" : "whisper-server",
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function linkedLibraries(binaryPath: string): Promise<string[]> {
  if (process.platform === "darwin") {
    const result = await runCommand("otool", ["-L", binaryPath]);
    return result.stdout
      .split(/\r?\n/u)
      .slice(1)
      .map((line) => line.trim().split(/\s+/u)[0])
      .filter((value): value is string => value !== undefined && value !== "");
  }
  const result = await runCommand("ldd", [binaryPath]);
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

try {
  await runCommand(
    "git",
    ["worktree", "add", "--detach", stockSource, manifest.commit],
    {
      cwd: sourceDirectory,
    },
  );
  await runCommand(
    "git",
    ["worktree", "add", "--detach", patchedSource, manifest.commit],
    {
      cwd: sourceDirectory,
    },
  );
  await runCommand("git", ["apply", whisperPatchPath], { cwd: patchedSource });

  const jobs =
    values.jobs ??
    String(
      Math.max(1, Math.min(8, Number(process.env.MVL_LOGICAL_CORES ?? 8))),
    );
  const stockBuild = path.join(stagingRoot, "stock-build");
  const patchedBuild = path.join(stagingRoot, "patched-build");
  await runCommand("cmake", [
    "-S",
    stockSource,
    "-B",
    stockBuild,
    ...baseFlags,
  ]);
  await runCommand("cmake", [
    "--build",
    stockBuild,
    "--target",
    "whisper-server",
    "--config",
    "Release",
    "-j",
    jobs,
  ]);
  await runCommand("cmake", [
    "-S",
    patchedSource,
    "-B",
    patchedBuild,
    ...baseFlags,
    `-DCMAKE_CXX_FLAGS=-DMVL_PATCH_SHA256=\\"${manifest.patchSha256}\\"`,
  ]);
  await runCommand("cmake", [
    "--build",
    patchedBuild,
    "--target",
    "whisper-server",
    "--config",
    "Release",
    "-j",
    jobs,
  ]);

  const stockBinary = await copyRuntimeBin({
    buildDirectory: stockBuild,
    destination: path.join(stagingRoot, "stock/bin"),
    patched: false,
  });
  const patchedBinary = await copyRuntimeBin({
    buildDirectory: patchedBuild,
    destination: path.join(stagingRoot, "patched/bin"),
    patched: true,
  });
  const [stockBinarySha256, patchedBinarySha256, stockLinks, patchedLinks] =
    await Promise.all([
      sha256File(stockBinary),
      sha256File(patchedBinary),
      linkedLibraries(stockBinary),
      linkedLibraries(patchedBinary),
    ]);
  const completedAt = new Date().toISOString();
  const buildManifest = whisperRuntimeBuildManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "whisper-runtime-build-manifest",
    upstream: {
      repository: manifest.repository,
      remote: manifest.remote,
      tag: manifest.tag,
      tagObject: manifest.tagObject,
      commit: manifest.commit,
      sourceTree: manifest.sourceTree,
    },
    patch: {
      patchId: manifest.patchId,
      patchSha256: manifest.patchSha256,
      responseSchema: manifest.responseSchema,
      expectedFiles: manifest.expectedFiles,
    },
    build: {
      buildId,
      compiler,
      compilerVersion,
      cmakeVersion,
      generator: "Unix Makefiles",
      buildType: "Release",
      flags: baseFlags,
      flagsHash: sha256Bytes(stableJson(baseFlags)),
      hostArchitecture: process.arch,
      operatingSystem,
      deploymentTarget: process.env.MACOSX_DEPLOYMENT_TARGET ?? null,
      stockPatchedSameConfiguration: true,
      serializerIdentityCompileDefinition: "MVL_PATCH_SHA256",
      startedAt,
      completedAt,
    },
    stock: {
      runtimeType: "stock",
      binaryRelativePath: "stock/bin/whisper-server",
      binarySha256: stockBinarySha256,
      linkedLibraries: stockLinks,
    },
    patched: {
      runtimeType: "mvl-patched",
      binaryRelativePath: "patched/bin/whisper-server-mvl",
      binarySha256: patchedBinarySha256,
      linkedLibraries: patchedLinks,
    },
  });
  await writeFile(
    path.join(stagingRoot, "build-manifest.json"),
    `${JSON.stringify(buildManifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  await rm(path.join(stagingRoot, "stock-build"), {
    recursive: true,
    force: true,
  });
  await rm(path.join(stagingRoot, "patched-build"), {
    recursive: true,
    force: true,
  });
  await rename(stagingRoot, targetRoot);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        reused: false,
        runtimeRoot: targetRoot,
        buildManifestPath: path.join(targetRoot, "build-manifest.json"),
        stockServer: path.join(
          targetRoot,
          buildManifest.stock.binaryRelativePath,
        ),
        patchedServer: path.join(
          targetRoot,
          buildManifest.patched.binaryRelativePath,
        ),
        manifest: buildManifest,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
} finally {
  await runCommand("git", ["worktree", "remove", "--force", stockSource], {
    cwd: sourceDirectory,
    allowNonZero: true,
  });
  await runCommand("git", ["worktree", "remove", "--force", patchedSource], {
    cwd: sourceDirectory,
    allowNonZero: true,
  });
  await rm(temporaryRoot, { recursive: true, force: true });
}
