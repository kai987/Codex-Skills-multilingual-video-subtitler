import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  readWhisperPatchManifest,
  runCommand,
  validatePinnedWhisperSource,
  verifyWhisperPatchFiles,
  whisperPatchPath,
} from "./whisper-runtime-common.js";

const { values } = parseArgs({
  options: {
    "source-dir": { type: "string" },
  },
  strict: true,
});

const manifest = await readWhisperPatchManifest();
await verifyWhisperPatchFiles(manifest);
const sourceDirectory = path.resolve(
  values["source-dir"] ??
    path.join(
      process.env.HOME ?? "",
      ".cache/mvl/whisper-upstream/whisper.cpp-v1.9.3",
    ),
);
await validatePinnedWhisperSource({
  sourceDirectory,
  manifest,
  requireClean: true,
});
await runCommand("git", ["apply", "--check", whisperPatchPath], {
  cwd: sourceDirectory,
});

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "mvl-whisper-patch-verify-"),
);
const worktree = path.join(temporaryRoot, "source");
const wrongCommitWorktree = path.join(temporaryRoot, "wrong-source");
let wrongCommitRejected = false;
try {
  await runCommand(
    "git",
    ["worktree", "add", "--detach", worktree, manifest.commit],
    {
      cwd: sourceDirectory,
    },
  );
  await runCommand("git", ["apply", whisperPatchPath], { cwd: worktree });
  const repeated = await runCommand(
    "git",
    ["apply", "--check", whisperPatchPath],
    {
      cwd: worktree,
      allowNonZero: true,
    },
  );
  if (repeated.exitCode === 0) {
    throw new Error("Repeated patch application was not detected.");
  }
  await runCommand("git", ["apply", "--reverse", "--check", whisperPatchPath], {
    cwd: worktree,
  });
  await runCommand(
    "git",
    ["worktree", "add", "--detach", wrongCommitWorktree, `${manifest.commit}^`],
    { cwd: sourceDirectory },
  );
  try {
    await validatePinnedWhisperSource({
      sourceDirectory: wrongCommitWorktree,
      manifest,
      requireClean: true,
    });
  } catch {
    wrongCommitRejected = true;
  }
  if (!wrongCommitRejected) {
    throw new Error(
      "The pinned-source guard accepted the wrong upstream commit.",
    );
  }
} finally {
  await runCommand("git", ["worktree", "remove", "--force", worktree], {
    cwd: sourceDirectory,
    allowNonZero: true,
  });
  await runCommand(
    "git",
    ["worktree", "remove", "--force", wrongCommitWorktree],
    {
      cwd: sourceDirectory,
      allowNonZero: true,
    },
  );
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      sourceCommit: manifest.commit,
      sourceTree: manifest.sourceTree,
      patchId: manifest.patchId,
      patchSha256: manifest.patchSha256,
      expectedFiles: manifest.expectedFiles,
      correctCommitApplyCheck: "passed",
      wrongCommitPolicy: "actively-rejected-by-pinned-commit-guard",
      repeatedApplication: "already-applied-detected",
      coreInferenceFilesModified: false,
    },
    null,
    2,
  )}\n`,
);
