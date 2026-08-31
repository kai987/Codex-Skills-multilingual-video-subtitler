import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
  lstat,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { c612RerankingFreezeSchema, c612ShadowSchema } from "@mvl/shared";
import { c61Json } from "../c61-artifact-io.js";
import { fileHash } from "./c612-acoustic-io.js";
import { artifact, hash, c612Defined } from "./c612-policy.js";
export function c612Arguments(allowed: string[], required: string[]) {
  if (process.versions.node.split(".")[0] !== "24")
    throw new Error("C612_NODE24_REQUIRED");
  const args = process.argv.slice(2),
    values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = c612Defined(args[i]),
      value = args[i + 1];
    if (
      !allowed.includes(key) ||
      !value ||
      value.startsWith("--") ||
      values.has(key)
    )
      throw new Error(`C612_INVALID_ARGUMENT:${key}`);
    values.set(key, value);
  }
  for (const key of required)
    if (!values.has(key)) throw new Error(`C612_REQUIRED_ARGUMENT:${key}`);
  if (values.get("--network") !== "off")
    throw new Error("C612_NETWORK_MUST_BE_OFF");
  return (name: string) => {
    const value = values.get(name);
    if (!value) throw new Error(`C612_REQUIRED_ARGUMENT:${name}`);
    return value;
  };
}
export async function writeArtifact(
  directory: string,
  value: {
    artifactType: string;
  },
) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, value.artifactType + ".json"),
    JSON.stringify(value, null, 2) + "\n",
    { flag: "wx" },
  );
}
export async function treeFiles(root: string, base = root): Promise<string[]> {
  const names: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, e.name);
    if (e.isSymbolicLink()) throw new Error("C612_ARTIFACT_SYMLINK_FORBIDDEN");
    if (e.isDirectory()) names.push(...(await treeFiles(file, base)));
    else if (e.isFile()) names.push(path.relative(base, file));
  }
  return names.sort();
}
export async function fileManifest(root: string, names: readonly string[]) {
  return Promise.all(
    names.map(async (relativePath) => ({
      relativePath,
      sha256: await fileHash(path.join(root, relativePath)),
      size: (await stat(path.join(root, relativePath))).size,
    })),
  );
}
export async function freezeReranking(
  root: string,
  machineFreezeHash: string,
  modelHash: string,
  rankingHash: string,
  groupDecisionHash: string,
) {
  const names = (await treeFiles(path.join(root, "reranking")))
    .map((n) => path.join("reranking", n))
    .concat(
      (await treeFiles(path.join(root, "research-shadow"))).map((n) =>
        path.join("research-shadow", n),
      ),
    )
    .sort();
  const files = await fileManifest(root, names);
  const freeze = c612RerankingFreezeSchema.parse(
    artifact("c6-1-2-reranking-freeze", {
      frozenAt: new Date().toISOString(),
      machineFreezeHash,
      files,
      fileAggregateHash: hash(files),
      modelHash,
      rankingHash,
      groupDecisionHash,
      rawGoldReadByTrainingProcess: false,
      outerTestLabelsUsedByPrediction: false,
    }),
  );
  await writeArtifact(path.join(root, "reranking"), freeze);
  return freeze;
}
export async function verifyRerankingFreeze(root: string) {
  const freeze = c612RerankingFreezeSchema.parse(
    await c61Json(path.join(root, "reranking/c6-1-2-reranking-freeze.json")),
  );
  const { semanticHash, ...body } = freeze;
  if (
    hash(body) !== semanticHash ||
    hash(freeze.files) !== freeze.fileAggregateHash
  )
    throw new Error("C612_RERANKING_FREEZE_HASH");
  const required = [
    "machine-c6-1-2-reranker-models",
    "machine-c6-1-2-thresholds",
    "c6-1-2-oof-candidate-rankings",
    "machine-c6-1-2-reranker-decisions",
    "machine-c6-1-2-group-shadow-configurations",
    "c6-1-2-oof-group-decisions",
    "machine-c6-1-2-shadow-output",
    "machine-c6-1-2-shadow-application-ledger",
    "machine-c6-1-2-shadow-provenance",
  ].map((n) => `reranking/${n}.json`);
  if (
    required.some((n) => !freeze.files.some((f) => f.relativePath === n)) ||
    new Set(freeze.files.map((f) => f.relativePath)).size !==
      freeze.files.length
  )
    throw new Error("C612_RERANKING_REQUIRED_FILE_SET_MISSING");
  const manifest = c612ShadowSchema.parse(
    await c61Json(
      await safeC612ArtifactPath(
        root,
        "reranking/machine-c6-1-2-shadow-output.json",
      ),
    ),
  );
  if (
    manifest.profiles.length !== 18 ||
    new Set(manifest.profiles.map((p) => p.profileId)).size !== 18 ||
    manifest.profiles.some((p) =>
      [p.subtitlePackagePath, p.assPath, p.srtPath, p.vttPath].some(
        (n) => !freeze.files.some((f) => f.relativePath === n),
      ),
    )
  )
    throw new Error("C612_REQUIRED_SHADOW_PROFILES_MISSING");
  for (const f of freeze.files) {
    const file = await safeC612ArtifactPath(root, f.relativePath);
    if (
      (await stat(file)).size !== f.size ||
      (await fileHash(file)) !== f.sha256
    )
      throw new Error(`C612_SHADOW_CHANGED_AFTER_FREEZE:${f.relativePath}`);
  }
  return freeze;
}
export async function safeC612ArtifactPath(root: string, relative: string) {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/u).some((p) => p === ".." || p === "." || p === "")
  )
    throw new Error("C612_FREEZE_PATH_ESCAPE");
  const target = path.join(root, relative),
    file = await lstat(target),
    actualRoot = await realpath(root),
    actualTarget = await realpath(target),
    rel = path.relative(actualRoot, actualTarget);
  if (
    file.isSymbolicLink() ||
    !file.isFile() ||
    path.isAbsolute(rel) ||
    rel.startsWith(`..${path.sep}`) ||
    rel === ".."
  )
    throw new Error("C612_ARTIFACT_SYMLINK_OR_ESCAPE");
  return target;
}
export async function assertJsonSemanticHash(file: string) {
  const value = JSON.parse(await readFile(file, "utf8")) as Record<
    string,
    unknown
  >;
  const { semanticHash, ...body } = value;
  if (hash(body) !== semanticHash)
    throw new Error("C612_JSON_SEMANTIC_HASH_INVALID");
  return value;
}
