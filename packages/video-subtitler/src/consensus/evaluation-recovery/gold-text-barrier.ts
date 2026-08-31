import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseAss } from "@mvl/subtitle-core";
import {
  c6121FreezeSchema,
  c6121TimingBarrierSchema,
  c6121TextBarrierSchema,
  type C6121Baseline,
  type C6121Map,
} from "@mvl/shared";
import { normalizeC601GoldAssTimestamps } from "../../blind-acceptance/gold-evaluation.js";
import {
  readC6121Artifact,
  verifyC6121Snapshot,
} from "./baseline-freeze-verification.js";
import {
  demand,
  hash,
  c6121Artifact,
  validateC6121Artifact,
} from "./c6121-policy.js";
import { C6121_FROZEN_EVALUATOR_FILES } from "./supergroup-freeze.js";
export async function readC6121GoldText(input: {
  directory: string;
  gold: string;
  baseline: C6121Baseline;
  map: C6121Map;
}) {
  validateC6121Artifact(input.map);
  validateC6121Artifact(input.baseline);
  const freeze = c6121FreezeSchema.parse(
    await readC6121Artifact(
      path.join(input.directory, "c6-1-2-1-supergroup-freeze.json"),
    ),
  );
  const timing = c6121TimingBarrierSchema.parse(
    await readC6121Artifact(
      path.join(input.directory, "c6-1-2-1-gold-timing-read-barrier.json"),
    ),
  );
  demand(
    C6121_FROZEN_EVALUATOR_FILES.every((name) =>
      freeze.frozenFiles.some((f) => f.relativePath === name),
    ) &&
      new Set(freeze.frozenFiles.map((f) => f.relativePath)).size ===
        freeze.frozenFiles.length,
    "C6121_REQUIRED_EVALUATOR_FREEZE_FILE_MISSING",
  );
  demand(
    freeze.supergroupMapHash === input.map.semanticHash &&
      freeze.baselineFreezeHash === input.baseline.semanticHash &&
      freeze.timingBarrierHash === timing.semanticHash &&
      timing.goldTimingHash === input.map.goldTimingHash,
    "C6121_TEXT_BARRIER_BINDING",
  );
  for (const file of freeze.frozenFiles) {
    demand(
      !path.isAbsolute(file.relativePath) &&
        !file.relativePath.split("/").includes(".."),
      "C6121_UNSAFE_FREEZE_PATH",
    );
    const bytes = await readFile(path.join(input.directory, file.relativePath));
    demand(
      createHash("sha256").update(bytes).digest("hex") === file.sha256,
      "C6121_SUPERGROUP_FILE_CHANGED_BEFORE_TEXT",
    );
  }
  await verifyC6121Snapshot(input.baseline);
  const goldTextFirstReadAt = new Date().toISOString();
  demand(
    goldTextFirstReadAt >= freeze.supergroupFrozenAt,
    "C6121_TEXT_PRECEDES_SUPERGROUP_FREEZE",
  );
  const before = await stat(input.gold),
    bytes = await readFile(input.gold),
    after = await stat(input.gold);
  const goldByteHash = createHash("sha256").update(bytes).digest("hex");
  demand(
    before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      before.ino === after.ino &&
      before.size === timing.goldBytes &&
      before.mtimeMs === timing.goldMtimeMs &&
      before.ino === timing.goldInode &&
      goldByteHash === timing.goldByteHash,
    "C6121_GOLD_CHANGED_BETWEEN_STAGES",
  );
  const normalized = normalizeC601GoldAssTimestamps(bytes.toString("utf8"));
  const gold = parseAss(normalized.content).map((c, i) => ({
    id: "gold-" + String(i + 1).padStart(4, "0"),
    start: c.start,
    end: c.end,
    text: c.text,
  }));
  const goldOrdered = gold.toSorted(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
  demand(
    hash(goldOrdered.map(({ id, start, end }) => ({ id, start, end }))) ===
      timing.goldTimingHash,
    "C6121_GOLD_TIMING_TEXT_PARSER_DISAGREEMENT",
  );
  return {
    gold: goldOrdered,
    legacyGoldOrder: gold,
    barrier: c6121TextBarrierSchema.parse(
      c6121Artifact("c6-1-2-1-gold-text-scoring-barrier", {
        supergroupFrozenAt: freeze.supergroupFrozenAt,
        goldTextFirstReadAt,
        baselineFreezeHash: input.baseline.semanticHash,
        timingBarrierHash: timing.semanticHash,
        supergroupMapHash: input.map.semanticHash,
        goldTimingHash: timing.goldTimingHash,
        goldByteHash,
        goldTextScoringInputCount: gold.length,
        machineRuntimeRawGoldInputCount: 0,
        predictionStageRawGoldInputCount: 0,
      }),
    ),
  };
}
