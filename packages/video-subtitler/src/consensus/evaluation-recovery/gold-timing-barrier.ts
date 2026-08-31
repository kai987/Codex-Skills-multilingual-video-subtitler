import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  c6121GoldTimingCueSchema,
  c6121TimingBarrierSchema,
  type C6121GoldTimingCue,
  type C6121Baseline,
} from "@mvl/shared";
import { verifyC6121Snapshot } from "./baseline-freeze-verification.js";
import { c6121Artifact, demand, hash } from "./c6121-policy.js";
function assTime(value: string) {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{2,3})$/.exec(value.trim());
  demand(match, "C6121_INVALID_ASS_TIME");
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number("0." + String(match[4]))
  );
}
/** Stream only ASS event prefixes through the end timestamp. All subsequent
 * bytes (including ASS metadata fields and dialogue) are discarded until LF.
 * Only ASCII numeric timing syntax is decoded after the literal Dialogue marker. The
 * whole byte stream is hashed, explicitly distinct from decoding Gold text. */
export async function readAssTimingOnly(filename: string) {
  demand(
    path.extname(filename).toLowerCase() === ".ass",
    "C6121_TIMING_READER_REQUIRES_ASS",
  );
  const before = await stat(filename),
    digest = createHash("sha256");
  const cues: C6121GoldTimingCue[] = [];
  let header = "",
    marker = "",
    discard = false,
    bytes = 0,
    event = false,
    completed = false;
  const flush = () => {
    demand(!event || completed, "C6121_MALFORMED_GOLD_TIMING_PREFIX");
    header = "";
    marker = "";
    discard = false;
    event = false;
    completed = false;
  };
  for await (const raw of createReadStream(filename)) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    digest.update(chunk);
    bytes += chunk.length;
    for (const b of chunk) {
      if (b === 10) {
        flush();
        continue;
      }
      if (discard) continue;
      if (!event) {
        // Non-event lines are discarded after at most nine ASCII marker bytes.
        if (b !== "Dialogue:".charCodeAt(marker.length)) {
          discard = true;
          continue;
        }
        marker += String.fromCharCode(b);
        if (marker === "Dialogue:") event = true;
        continue;
      }
      demand(
        header.length < 96 &&
          (b === 32 ||
            b === 9 ||
            b === 44 ||
            b === 46 ||
            b === 58 ||
            (b >= 48 && b <= 57)),
        "C6121_MALFORMED_GOLD_TIMING_PREFIX",
      );
      header += String.fromCharCode(b);
      if (b !== 44) continue;
      const times =
        /^\s*\d+,(\d+:\d{2}:\d{2}[.,]\d{2,3}),(\d+:\d{2}:\d{2}[.,]\d{2,3}),$/.exec(
          header,
        );
      if (!times) continue;
      cues.push(
        c6121GoldTimingCueSchema.parse({
          id: "gold-" + String(cues.length + 1).padStart(4, "0"),
          start: assTime(String(times[1])),
          end: assTime(String(times[2])),
        }),
      );
      completed = true;
      discard = true;
    }
  }
  flush();
  const after = await stat(filename);
  demand(
    before.size === bytes &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      before.ino === after.ino,
    "C6121_GOLD_CHANGED_DURING_TIMING_READ",
  );
  demand(cues.length, "C6121_EMPTY_GOLD_TIMING");
  return {
    cues: cues.sort(
      (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
    ),
    byteHash: digest.digest("hex"),
    bytes,
    before,
  };
}
export async function readC6121GoldTiming(
  baseline: C6121Baseline,
  gold: string,
) {
  await verifyC6121Snapshot(baseline);
  const goldTimingFirstReadAt = new Date().toISOString();
  demand(
    goldTimingFirstReadAt >= baseline.machineFrozenAt,
    "C6121_TIMING_PRECEDES_MACHINE_FREEZE",
  );
  const timing = await readAssTimingOnly(gold);
  return {
    timing: timing.cues,
    barrier: c6121TimingBarrierSchema.parse(
      c6121Artifact("c6-1-2-1-gold-timing-read-barrier", {
        machineFrozenAt: baseline.machineFrozenAt,
        goldTimingFirstReadAt,
        baselineFreezeHash: baseline.semanticHash,
        goldTimingCueCount: timing.cues.length,
        goldTimingHash: hash(timing.cues),
        goldByteHash: timing.byteHash,
        goldBytes: timing.bytes,
        goldMtimeMs: timing.before.mtimeMs,
        goldInode: timing.before.ino,
        parser: "ASS_PREFIX_ONLY_NO_DIALOGUE_TEXT_DECODE",
        rawGoldTextReadCount: 0,
        goldFileBytesScannedForTimingAndHash: true,
        machineArtifactsMutatedAfterTimingRead: false,
      }),
    ),
  };
}
