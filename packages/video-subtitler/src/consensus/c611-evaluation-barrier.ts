import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";
import { normalizeC601GoldAssTimestamps } from "../blind-acceptance/gold-evaluation.js";
import { verifyC611MachineFreeze } from "./c611-artifact-io.js";

/** First Gold path access is after complete A/B file and code verification. */
export async function readC611GoldAfterFreeze(input: {
  a: string;
  b: string;
  repository: string;
  gold: string;
}) {
  const first = await verifyC611MachineFreeze(input.a, input.repository),
    second = await verifyC611MachineFreeze(input.b, input.repository);
  if (first.semanticHash !== second.semanticHash)
    throw new Error("C611_DUAL_FREEZE_MISMATCH");
  const goldFirstReadAt = new Date().toISOString();
  if (goldFirstReadAt < first.frozenAt)
    throw new Error("C611_GOLD_BEFORE_FREEZE");
  const before = await stat(input.gold),
    bytes = await readFile(input.gold),
    after = await stat(input.gold);
  if (
    before.size !== bytes.length ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new Error("C611_GOLD_CHANGED_DURING_READ");
  const text = bytes.toString("utf8"),
    extension = path.extname(input.gold).toLowerCase();
  const normalized = normalizeC601GoldAssTimestamps(text);
  const cues =
    extension === ".ass" || extension === ".ssa"
      ? parseAss(normalized.content)
      : extension === ".srt"
        ? parseSrt(text)
        : extension === ".vtt"
          ? parseVtt(text)
          : null;
  if (!cues?.length) throw new Error("C611_GOLD_INVALID");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    freeze: first,
    goldFirstReadAt,
    fingerprint: { size: before.size, mtimeMs: before.mtimeMs, sha256 },
    goldIdentity: {
      fileName: path.basename(input.gold),
      size: before.size,
      sha256,
      cueCount: cues.length,
      timestampNormalizationCount: normalized.replacementCount,
      firstReadAt: goldFirstReadAt,
      readOnlyVerified: true,
    },
    gold: cues.map((c, i) => ({
      id: `gold-${String(i + 1).padStart(4, "0")}`,
      start: c.start,
      end: c.end,
      text: c.text,
    })),
  };
}
