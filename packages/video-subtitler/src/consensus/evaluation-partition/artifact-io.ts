import path from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { c61211BaselineSchema, c6121FileSchema } from "@mvl/shared";
import type { z } from "zod";
import { fingerprintC6121 } from "../evaluation-recovery/baseline-freeze-verification.js";
import {
  c61211Artifact,
  demand,
  hash,
  validateC61211Artifact,
} from "./c61211-policy.js";
export const shaBytes = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export async function c61211Files(
  root: string,
  prefix = "",
): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of (
    await readdir(path.join(root, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    demand(
      !entry.isSymbolicLink(),
      "C61211_SYMLINK_NOT_A_FROZEN_FILE:" + relative,
    );
    if (entry.isDirectory()) paths.push(...(await c61211Files(root, relative)));
    else if (entry.isFile()) paths.push(relative);
  }
  return paths;
}
export async function readC61211(file: string) {
  return validateC61211Artifact(
    JSON.parse(await readFile(file, "utf8")) as unknown,
  );
}
export async function writeC61211(directory: string, value: unknown) {
  const parsed = validateC61211Artifact(value);
  await mkdir(directory, { recursive: true });
  const name = String(parsed.artifactType);
  demand(/^[a-z0-9-]+$/.test(name), "C61211_UNSAFE_ARTIFACT_NAME");
  await writeFile(
    path.join(directory, name + ".json"),
    JSON.stringify(parsed, null, 2) + "\n",
    { flag: "wx" },
  );
}
export async function fingerprintsC61211(
  items: readonly { role: string; path: string }[],
) {
  const rows: z.infer<typeof c6121FileSchema>[] = [];
  for (let i = 0; i < items.length; i += 24) {
    rows.push(
      ...(await Promise.all(
        items.slice(i, i + 24).map((f) => fingerprintC6121(f.path, f.role)),
      )),
    );
  }
  return rows.sort((a, b) => a.role.localeCompare(b.role));
}
export async function snapshotC61211(
  baseline: z.infer<typeof c61211BaselineSchema>,
) {
  const after = await fingerprintsC61211(baseline.files);
  demand(
    hash(after) === baseline.inputAggregateHash,
    "C61211_FROZEN_INPUT_MUTATED",
  );
  return hash(after);
}
export function policyPayloadC61211<T extends object>(name: string, body: T) {
  return c61211Artifact(name, body);
}
