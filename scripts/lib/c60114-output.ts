import path from "node:path";
import { atomicWriteJson } from "@mvl/shared";
import { createC60113OutputDirectory } from "./c60113-acceptance-io.js";

/** Extend the existing exclusive-mkdir allocator with deterministic collision
 * suffixes. An old acceptance directory is never overwritten or removed. */
export async function allocateC60114Output(
  root: string,
  stem: string,
): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/u.test(stem))
    throw new Error("C60114_UNSAFE_OUTPUT_STEM");
  for (let index = 0; index < 10_000; index++) {
    const directory = path.join(root, `${stem}${index ? `-${index + 1}` : ""}`);
    try {
      await createC60113OutputDirectory(directory);
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("C60114_OUTPUT_COLLISION_LIMIT");
}
export async function writeC60114Artifact(
  directory: string,
  name: string,
  value: unknown,
): Promise<string> {
  if (path.basename(name) !== name || !name.endsWith(".json"))
    throw new Error("C60114_UNSAFE_ARTIFACT_NAME");
  const file = path.join(directory, name);
  await atomicWriteJson(file, value);
  return file;
}
