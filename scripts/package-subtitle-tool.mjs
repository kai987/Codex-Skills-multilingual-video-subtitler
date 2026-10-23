/** Reproducible source candidate; no media, model, cache, credentials or run output. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "..");
const outputRoot = process.argv[2];
if (!outputRoot)
  throw Error("用法：node scripts/package-subtitle-tool.mjs /path/output-root");
await fs.mkdir(outputRoot, { recursive: true });
const container = await fs.mkdtemp(
  path.join(path.resolve(outputRoot), "subtitle-tool-v1-0-1-candidate-"),
);
const stage = path.join(container, "subtitle-tool-v1");
await fs.mkdir(stage);
const packages = [
  "shared",
  "media-identity",
  "subtitle-core",
  "subtitle-search",
  "transcription-core",
  "video-subtitler",
];
const copy = async (relative) => {
  const dest = path.join(stage, relative);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(path.join(repository, relative), dest, {
    recursive: true,
    filter: (file) =>
      !/(?:^|\/)(?:node_modules|dist|output|__pycache__)(?:\/|$)/u.test(file) &&
      !file.endsWith(".pyc"),
  });
};
for (const pkg of packages)
  for (const name of ["src", "package.json", "tsconfig.json"])
    await copy(`packages/${pkg}/${name}`);
for (const file of [
  "tsconfig.base.json",
  "LICENSE",
  ".nvmrc",
  "package-lock.json",
  "STANDALONE_SUBTITLE_TOOL_V1.md",
  "scripts/subtitle-tool.mjs",
  "scripts/subtitle-tool-content-safety.mjs",
  "scripts/lib/default-seam-delivery.mjs",
  "scripts/lib/default-content-recovery.mjs",
  "scripts/lib/recovery-evidence-guard.mjs",
  "scripts/lib/seam-context-delivery.mjs",
  "scripts/lib/held-seam-recovery.mjs",
  "scripts/recover-held-seams.mjs",
  "scripts/recover-local-occurrences.mjs",
  "scripts/replay-recovery-context.mjs",
  "scripts/subtitle-tool-vad-local-recovery.mjs",
  "scripts/subtitle-tool-vad-triage.mjs",
  "scripts/subtitle-tool-listening-vad.mjs",
  "scripts/lib/audio-coverage-calibration.mjs",
  "scripts/lib/vad-local-recovery.mjs",
  "scripts/lib/speech-support-policy.mjs",
  "scripts/lib/source-occurrence-routing.mjs",
  "scripts/lib/recovery-context-routing.mjs",
  "scripts/evaluate-short-response-fragments.mjs",
  "scripts/evaluate-short-response-readiness.mjs",
  "scripts/lib/short-response-readiness.mjs",
  "scripts/lib/occurrence-recovery-decision.mjs",
  "scripts/lib/seam-context-text.mjs",
  "scripts/lib/short-response-observation.mjs",
  "scripts/lib/audio-coverage-observation.mjs",
  "scripts/lib/audio-coverage-delivery.mjs",
  "scripts/subtitle-tool-refine-seams.mjs",
  "scripts/subtitle-tool-seam-text-only.mjs",
  "scripts/lib/seam-refinement.mjs",
  "scripts/lib/seam-text-only.mjs",
  "SUBTITLE_TOOL_SEAM_REFINEMENT.md",
  ".agents/skills/multilingual-video-subtitler/references/song-lyrics.md",
  "scripts/lib/content-audit-delivery.mjs",
  "scripts/lib/content-safety-gate.mjs",
  "scripts/lib/machine-content-audit.mjs",
  "scripts/lib/machine-risk-recovery-plan.mjs",
  "scripts/lib/bounded-product.mjs",
  "scripts/lib/stored-token-evidence.mjs",
  "scripts/lib/bounded-evidence-audit.mjs",
  "scripts/lib/bounded-seam-evidence.mjs",
  "scripts/lib/bounded-asr-ab.mjs",
  "scripts/lib/bounded-report-revision.mjs",
  "scripts/lib/bounded-diagnostics.mjs",
  "schemas/subtitle-tool-v1",
])
  await copy(file);
const root = JSON.parse(
  await fs.readFile(path.join(repository, "package.json"), "utf8"),
);
const scripts = {
  "subtitle-tool": root.scripts["subtitle-tool"],
  "build:subtitle-tool": root.scripts["build:subtitle-tool"],
};
await fs.writeFile(
  path.join(stage, "package.json"),
  JSON.stringify({ ...root, scripts }, null, 2) + "\n",
);
await fs.writeFile(
  path.join(stage, "README.md"),
  "# 独立字幕工具 v1 候选版\n\n阅读 [安装与使用](STANDALONE_SUBTITLE_TOOL_V1.md)。\n\n```sh\nnpm ci\nnpm run build:subtitle-tool\nnpm run subtitle-tool\n```\n\n仅含新本地机器草稿入口的源码依赖闭包，不含模型、音频、私人运行目录、node_modules 或旧高级 CLI 应用。\n",
);
// Preserve the existing exact versions; prune omitted workspace links in this candidate only.
await exec(
  "npm",
  ["install", "--package-lock-only", "--offline", "--ignore-scripts"],
  { cwd: stage },
);
const entries = [];
async function scan(directory) {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw Error("Unexpected symlink in candidate");
    if (item.isDirectory()) await scan(absolute);
    else {
      const bytes = await fs.readFile(absolute);
      entries.push({
        path: path.relative(stage, absolute),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await scan(stage);
const sourceCommit = (
  await exec("git", ["rev-parse", "HEAD"], { cwd: repository })
).stdout.trim();
await fs.writeFile(
  path.join(stage, "PACKAGE_CONTENTS.json"),
  JSON.stringify(
    {
      version: "subtitle-tool-v1.0.1-candidate",
      sourceCommit,
      sourceStatus: (
        await exec("git", ["status", "--porcelain"], { cwd: repository })
      ).stdout,
      excludes: [
        "model weights",
        "private media/subtitles",
        "all run outputs",
        "node_modules",
        "build outputs",
      ],
      files: entries,
    },
    null,
    2,
  ) + "\n",
);
const zip = container + ".zip";
await exec("zip", ["-q", "-r", zip, "subtitle-tool-v1"], {
  cwd: container,
  maxBuffer: 1024 * 1024,
});
await exec("unzip", ["-tq", zip]);
const bytes = await fs.readFile(zip);
const sha256 = createHash("sha256").update(bytes).digest("hex");
await fs.writeFile(zip + ".sha256", `${sha256}  ${path.basename(zip)}\n`);
console.log(
  JSON.stringify(
    {
      directory: stage,
      zip,
      bytes: bytes.length,
      sha256,
      files: entries.length,
    },
    null,
    2,
  ),
);
