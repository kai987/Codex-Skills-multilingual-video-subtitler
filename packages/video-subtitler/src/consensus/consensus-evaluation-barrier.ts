import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";
import { normalizeC601GoldAssTimestamps } from "../blind-acceptance/gold-evaluation.js";
import { verifyC61MachineFreeze } from "./c61-artifact-io.js";

/** The first access to the Gold path is strictly after BOTH freeze verifications. */
export async function readC61GoldAfterFreeze(
  a: string,
  b: string,
  goldPath: string,
) {
  const first = await verifyC61MachineFreeze(a);
  const second = await verifyC61MachineFreeze(b);
  if (first.semanticHash !== second.semanticHash)
    throw new Error("C61_DUAL_FREEZE_MISMATCH");
  const goldFirstReadAt = new Date().toISOString();
  if (goldFirstReadAt < first.frozenAt)
    throw new Error("C61_GOLD_BEFORE_MACHINE_FREEZE");
  const before = await stat(goldPath);
  const bytes = await readFile(goldPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const normalized = normalizeC601GoldAssTimestamps(bytes.toString("utf8"));
  const extension = path.extname(goldPath).toLowerCase();
  const parsed =
    extension === ".ass" || extension === ".ssa"
      ? parseAss(normalized.content)
      : extension === ".srt"
        ? parseSrt(bytes.toString("utf8"))
        : extension === ".vtt"
          ? parseVtt(bytes.toString("utf8"))
          : null;
  if (!parsed?.length) throw new Error("C61_INVALID_GOLD_SUBTITLE");
  const after = await stat(goldPath);
  if (
    before.size !== bytes.length ||
    after.size !== before.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new Error("C61_GOLD_CHANGED_DURING_READ");
  return {
    freeze: first,
    goldFirstReadAt,
    fingerprint: { size: before.size, mtimeMs: before.mtimeMs, sha256 },
    goldIdentity: {
      fileName: path.basename(goldPath),
      size: before.size,
      sha256,
      cueCount: parsed.length,
      timestampNormalizationCount: normalized.replacementCount,
      firstReadAt: goldFirstReadAt,
      readOnlyVerified: true,
    },
    gold: parsed.map((c, i) => ({
      id: `gold-${String(i + 1).padStart(4, "0")}`,
      start: c.start,
      end: c.end,
      text: c.text,
    })),
  };
}
