import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";
import { normalizeC601GoldAssTimestamps } from "../../blind-acceptance/gold-evaluation.js";
import { verifyC612MachineFreeze } from "./c612-machine-stage.js";
import { byteHash } from "./c612-acoustic-io.js";
import { hash } from "./c612-policy.js";
export async function readC612GoldAfterFreeze(input: {
  a: string;
  b: string;
  repository: string;
  gold: string;
}) {
  const a = await verifyC612MachineFreeze(input.a, input.repository),
    b = await verifyC612MachineFreeze(input.b, input.repository);
  const comparable = (files: typeof a.files) =>
    files.filter(
      (f) =>
        f.relativePath !== "machine-c6-1-2-acoustic-completeness-runtime.json",
    );
  if (
    a.codeAggregateHash !== b.codeAggregateHash ||
    hash(comparable(a.files)) !== hash(comparable(b.files))
  )
    throw new Error("C612_MACHINE_A_B_PARITY_FAILED");
  const goldFirstReadAt = new Date().toISOString();
  if (goldFirstReadAt < a.frozenAt || goldFirstReadAt < b.frozenAt)
    throw new Error("C612_GOLD_PRECEDES_FREEZE");
  const before = await stat(input.gold),
    bytes = await readFile(input.gold),
    after = await stat(input.gold);
  if (
    before.size !== bytes.length ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  )
    throw new Error("C612_GOLD_CHANGED_DURING_READ");
  const normalized = normalizeC601GoldAssTimestamps(bytes.toString("utf8")),
    extension = path.extname(input.gold).toLowerCase();
  const parsed =
    extension === ".ass"
      ? parseAss(normalized.content)
      : extension === ".srt"
        ? parseSrt(bytes.toString("utf8"))
        : extension === ".vtt"
          ? parseVtt(bytes.toString("utf8"))
          : null;
  if (!parsed?.length) throw new Error("C612_UNSUPPORTED_OR_EMPTY_GOLD");
  return {
    goldFirstReadAt,
    goldHash: byteHash(bytes),
    gold: parsed.map((c, i) => ({
      id: `gold-${String(i + 1).padStart(4, "0")}`,
      start: c.start,
      end: c.end,
      text: c.text,
    })),
    normalizationCount: normalized.replacementCount,
    before: {
      size: before.size,
      mtimeMs: before.mtimeMs,
      sha256: byteHash(bytes),
    },
    aFreeze: a,
    bFreeze: b,
  };
}
