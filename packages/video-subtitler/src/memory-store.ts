import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  seriesLanguageMemorySchema,
  type SeriesLanguageMemory,
} from "@mvl/shared";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function readSeriesLanguageMemory(
  filePath: string,
): Promise<SeriesLanguageMemory> {
  return seriesLanguageMemorySchema.parse(
    JSON.parse(await readFile(path.resolve(filePath), "utf8")) as unknown,
  );
}

export async function withSeriesMemoryLock<T>(input: {
  memoryPath: string;
  timeoutMilliseconds?: number;
  action: () => Promise<T>;
}): Promise<T> {
  const memoryPath = path.resolve(input.memoryPath);
  const lockPath = `${memoryPath}.lock`;
  const deadline = Date.now() + (input.timeoutMilliseconds ?? 5_000);
  await mkdir(path.dirname(memoryPath), { recursive: true });
  let lock: Awaited<ReturnType<typeof open>> | null = null;
  while (lock === null) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      await lock.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new InputError(`Series memory lock timed out: ${lockPath}`);
      }
      await delay(25);
    }
  }
  try {
    return await input.action();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export async function atomicWriteSeriesLanguageMemory(input: {
  filePath: string;
  memory: SeriesLanguageMemory;
  overwrite?: boolean;
}): Promise<void> {
  const filePath = path.resolve(input.filePath);
  const validated = seriesLanguageMemorySchema.parse(input.memory);
  await withSeriesMemoryLock({
    memoryPath: filePath,
    action: async () => {
      if (input.overwrite !== true) {
        try {
          await readFile(filePath);
          throw new InputError(`Series memory already exists: ${filePath}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${randomUUID()}.tmp`,
      );
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify(validated, null, 2)}\n`,
          "utf8",
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, filePath);
      const directory = await open(path.dirname(filePath), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    },
  });
}
