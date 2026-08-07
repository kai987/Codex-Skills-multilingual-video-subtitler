import { constants } from "node:fs";
import {
  access,
  copyFile,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { InputError, OutputExistsError } from "./errors.js";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function assertRegularFile(filePath: string): Promise<void> {
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    throw new InputError(`Input file does not exist: ${filePath}`, {
      path: filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!info.isFile()) {
    throw new InputError(`Input path is not a regular file: ${filePath}`, {
      path: filePath,
    });
  }
}

export async function atomicWriteFile(
  filePath: string,
  content: string | Uint8Array,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, content, { flag: "wx" });
  try {
    if (options.overwrite === true) {
      await rename(temporaryPath, filePath);
      return;
    }
    try {
      await link(temporaryPath, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new OutputExistsError(filePath);
      }
      // Some filesystems do not permit hard links. COPYFILE_EXCL still preserves
      // the no-overwrite guarantee, although the final copy is not atomic there.
      await copyFile(temporaryPath, filePath, constants.COPYFILE_EXCL);
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  await atomicWriteFile(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    options,
  );
}

export async function atomicCopyFile(
  sourcePath: string,
  targetPath: string,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
  );
  await copyFile(sourcePath, temporaryPath, constants.COPYFILE_EXCL);
  try {
    if (options.overwrite === true) {
      await rename(temporaryPath, targetPath);
      return;
    }
    try {
      await link(temporaryPath, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new OutputExistsError(targetPath);
      }
      await copyFile(temporaryPath, targetPath, constants.COPYFILE_EXCL);
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new InputError(`Invalid JSON in ${filePath}`, {
      path: filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function safeStem(filePath: string): string {
  const value = path.basename(filePath, path.extname(filePath));
  const printable = Array.from(value.normalize("NFKC"))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    })
    .join("");
  const safe = printable
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
  return safe || "video";
}

export function defaultTaskDirectory(
  inputPath: string,
  now = new Date(),
): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  return path.resolve(
    "output",
    `${safeStem(inputPath)}-${stamp}-${randomUUID().slice(0, 8)}`,
  );
}
