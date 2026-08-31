import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { parseAss } from "@mvl/subtitle-core";
import {
  c61211TimingSchema,
  c61211FreezeSchema,
  c61211TextBarrierSchema,
  type c61211BaselineSchema,
  type C61211Map,
} from "@mvl/shared";
import type { z } from "zod";
import { readAssTimingOnly } from "../evaluation-recovery/gold-timing-barrier.js";
import { normalizeC601GoldAssTimestamps } from "../../blind-acceptance/gold-evaluation.js";
import {
  c61211Artifact,
  C61211_POLICY_HASH,
  hash,
  demand,
} from "./c61211-policy.js";
import {
  readC61211,
  c61211Files,
  snapshotC61211,
  shaBytes,
} from "./artifact-io.js";

export async function timingC61211(
  baseline: z.infer<typeof c61211BaselineSchema>,
  gold: string,
) {
  await snapshotC61211(baseline);
  const goldTimingFirstReadAt = new Date().toISOString();
  demand(
    goldTimingFirstReadAt >= baseline.machineFrozenAt,
    "C61211_TIMING_PRECEDES_MACHINE_FREEZE",
  );
  const result = await readAssTimingOnly(gold);
  return c61211TimingSchema.parse(
    c61211Artifact("c6-1-2-1-1-gold-timing-barrier", {
      machineFrozenAt: baseline.machineFrozenAt,
      goldTimingFirstReadAt,
      baselineFreezeHash: baseline.semanticHash,
      goldTimingHash: hash(result.cues),
      goldByteHash: result.byteHash,
      goldFile: {
        role: "gold-evaluation-only",
        path: path.resolve(gold),
        bytes: result.bytes,
        sha256: result.byteHash,
        semanticHash: null,
        mtimeMs: result.before.mtimeMs,
        inode: result.before.ino,
      },
      rows: result.cues,
      rawGoldTextReadCount: 0,
      parser: "ASS_PREFIX_ONLY_NO_DIALOGUE_TEXT_DECODE",
    }),
  );
}
const nonFrozenClocks = new Set([
  "c6-1-2-1-1-baseline-freeze-verification.json",
  "c6-1-2-1-1-gold-timing-barrier.json",
]);
export const C61211_REQUIRED_FREEZE_FILES = [
  "c6-1-2-1-1-policy-freeze.json",
  "c6-1-2-1-1-oversized-component-inventory.json",
  "c6-1-2-1-1-partition-candidate-blocks.json",
  "c6-1-2-1-1-partitioned-supergroup-map.json",
  "c6-1-2-1-1-cut-edge-ledger.json",
  "c6-1-2-1-1-partition-residuals.json",
  "c6-1-2-1-1-partition-conservation-audit.json",
  "c6-1-2-1-1-reachable-scope.json",
  "c6-1-2-1-1-training-contract-parity.json",
  "pre-text/c6-1-2-1-1-reachable-coverage-audit.json",
  "pre-text/c6-1-2-1-1-coverage-gate-v2.json",
] as const;
export async function freezeC61211(
  directory: string,
  baseline: z.infer<typeof c61211BaselineSchema>,
  timing: z.infer<typeof c61211TimingSchema>,
  map: C61211Map,
) {
  const names = (await c61211Files(directory)).filter(
    (name) => !nonFrozenClocks.has(name),
  );
  for (const required of C61211_REQUIRED_FREEZE_FILES)
    demand(
      names.includes(required),
      "C61211_REQUIRED_PRE_TEXT_FREEZE_FILE_MISSING:" + required,
    );
  const frozenFiles = [];
  for (const relativePath of names) {
    await readC61211(path.join(directory, relativePath));
    frozenFiles.push({
      relativePath,
      sha256: shaBytes(await readFile(path.join(directory, relativePath))),
    });
  }
  demand(
    hash(timing.rows) === timing.goldTimingHash &&
      timing.goldTimingHash === map.goldTimingHash,
    "C61211_TIMING_MAP_BINDING",
  );
  return c61211FreezeSchema.parse(
    c61211Artifact("c6-1-2-1-1-partition-freeze", {
      partitionFrozenAt: new Date().toISOString(),
      baselineFreezeHash: baseline.semanticHash,
      timingBarrierHash: timing.semanticHash,
      partitionMapHash: map.semanticHash,
      frozenFiles,
      policyDefinitionHash: C61211_POLICY_HASH,
      rawGoldTextReadCount: 0,
    }),
  );
}
export async function verifyC61211PartitionFreeze(
  directory: string,
  map: C61211Map,
  baseline: z.infer<typeof c61211BaselineSchema>,
) {
  const freeze = c61211FreezeSchema.parse(
    await readC61211(path.join(directory, "c6-1-2-1-1-partition-freeze.json")),
  );
  const timing = c61211TimingSchema.parse(
    await readC61211(
      path.join(directory, "c6-1-2-1-1-gold-timing-barrier.json"),
    ),
  );
  demand(
    freeze.partitionMapHash === map.semanticHash &&
      freeze.baselineFreezeHash === baseline.semanticHash &&
      freeze.timingBarrierHash === timing.semanticHash &&
      hash(timing.rows) === map.goldTimingHash &&
      timing.goldTimingHash === map.goldTimingHash &&
      freeze.policyDefinitionHash === C61211_POLICY_HASH,
    "C61211_GOLD_BARRIER_BINDING",
  );
  demand(
    C61211_REQUIRED_FREEZE_FILES.every((name) =>
      freeze.frozenFiles.some((f) => f.relativePath === name),
    ) &&
      new Set(freeze.frozenFiles.map((f) => f.relativePath)).size ===
        freeze.frozenFiles.length,
    "C61211_FREEZE_MANIFEST_INVALID",
  );
  for (const f of freeze.frozenFiles) {
    demand(
      !path.isAbsolute(f.relativePath) &&
        !f.relativePath.split(/[\\/]/).includes(".."),
      "C61211_UNSAFE_FREEZE_PATH",
    );
    demand(
      shaBytes(await readFile(path.join(directory, f.relativePath))) ===
        f.sha256,
      "C61211_PARTITION_CHANGED_BEFORE_SCORING:" + f.relativePath,
    );
  }
  demand(
    baseline.machineFrozenAt <= timing.goldTimingFirstReadAt &&
      timing.goldTimingFirstReadAt <= freeze.partitionFrozenAt,
    "C61211_BARRIER_ORDER",
  );
  return { freeze, timing };
}
export async function scoringC61211Gold(input: {
  directory: string;
  gold: string;
  baseline: z.infer<typeof c61211BaselineSchema>;
  map: C61211Map;
}) {
  const { freeze, timing } = await verifyC61211PartitionFreeze(
    input.directory,
    input.map,
    input.baseline,
  );
  await snapshotC61211(input.baseline);
  const goldTextFirstReadAt = new Date().toISOString();
  demand(
    goldTextFirstReadAt >= freeze.partitionFrozenAt,
    "C61211_TEXT_PRECEDES_PARTITION_FREEZE",
  );
  const before = await stat(input.gold),
    bytes = await readFile(input.gold),
    after = await stat(input.gold);
  demand(
    before.size === after.size &&
      before.ino === after.ino &&
      before.mtimeMs === after.mtimeMs &&
      before.size === timing.goldFile.bytes &&
      before.ino === timing.goldFile.inode &&
      before.mtimeMs === timing.goldFile.mtimeMs &&
      shaBytes(bytes) === timing.goldByteHash,
    "C61211_GOLD_CHANGED_BETWEEN_BARRIERS",
  );
  const parsed = parseAss(
    normalizeC601GoldAssTimestamps(bytes.toString("utf8")).content,
  );
  const gold = parsed
    .map((c, i) => ({
      id: "gold-" + String(i + 1).padStart(4, "0"),
      start: c.start,
      end: c.end,
      text: c.text,
    }))
    .sort(
      (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
    );
  demand(
    hash(gold.map(({ id, start, end }) => ({ id, start, end }))) ===
      timing.goldTimingHash,
    "C61211_TEXT_TIMING_PARSER_DISAGREEMENT",
  );
  return {
    gold,
    barrier: c61211TextBarrierSchema.parse(
      c61211Artifact("c6-1-2-1-1-gold-text-scoring-barrier", {
        partitionFrozenAt: freeze.partitionFrozenAt,
        goldTextFirstReadAt,
        partitionFreezeHash: freeze.semanticHash,
        partitionMapHash: input.map.semanticHash,
        goldTimingHash: timing.goldTimingHash,
        goldByteHash: timing.goldByteHash,
        goldTextScoringInputCount: gold.length,
        machineRuntimeRawGoldInputCount: 0,
        partitionBuilderGoldTextInputCount: 0,
        predictionStageRawGoldInputCount: 0,
      }),
    ),
  };
}
