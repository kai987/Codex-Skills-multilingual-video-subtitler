import path from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { c61211FileFixture } from "./helpers/c61211-file-fixture.js";
import {
  scoringC61211Gold,
  verifyC61211PartitionFreeze,
  C61211_REQUIRED_FREEZE_FILES,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/gold-barriers.js";
import {
  c61211Artifact,
  c61211Body,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import { snapshotC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/artifact-io.js";
describe("C6.1.2.1.1 four persisted Gold barriers", () => {
  it("reads only timing before a persisted complete partition freeze", async () => {
    const f = await c61211FileFixture();
    expect(f.timing.rawGoldTextReadCount).toBe(0);
    expect(Object.keys(f.timing.rows[0] ?? {}).sort()).toEqual([
      "end",
      "id",
      "start",
    ]);
    const text = await scoringC61211Gold({
      directory: f.directory,
      gold: f.goldPath,
      baseline: f.baseline,
      map: f.p.map,
    });
    expect(text.gold).toHaveLength(10);
    expect(text.barrier.goldTextFirstReadAt >= f.freeze.partitionFrozenAt).toBe(
      true,
    );
    expect(text.barrier.partitionBuilderGoldTextInputCount).toBe(0);
    expect(text.barrier.machineRuntimeRawGoldInputCount).toBe(0);
    expect(await snapshotC61211(f.baseline)).toBe(
      f.baseline.inputAggregateHash,
    );
  });
  it("refuses Gold text if the partition freeze does not exist", async () => {
    const f = await c61211FileFixture();
    await unlink(path.join(f.directory, "c6-1-2-1-1-partition-freeze.json"));
    await expect(
      scoringC61211Gold({
        directory: f.directory,
        gold: f.goldPath,
        baseline: f.baseline,
        map: f.p.map,
      }),
    ).rejects.toThrow();
  });
  it.each(C61211_REQUIRED_FREEZE_FILES)(
    "detects post-freeze mutation of %s",
    async (name) => {
      const f = await c61211FileFixture(),
        target = path.join(f.directory, name);
      await writeFile(target, (await readFile(target, "utf8")) + " ");
      await expect(
        verifyC61211PartitionFreeze(f.directory, f.p.map, f.baseline),
      ).rejects.toThrow("C61211_PARTITION_CHANGED");
    },
  );
  it("refuses a forged manifest that omits the cut ledger", async () => {
    const f = await c61211FileFixture();
    const bad = c61211Artifact("c6-1-2-1-1-partition-freeze", {
      ...c61211Body(f.freeze),
      frozenFiles: f.freeze.frozenFiles.filter(
        (x) => !x.relativePath.endsWith("cut-edge-ledger.json"),
      ),
    });
    await writeFile(
      path.join(f.directory, "c6-1-2-1-1-partition-freeze.json"),
      JSON.stringify(bad),
    );
    await expect(
      verifyC61211PartitionFreeze(f.directory, f.p.map, f.baseline),
    ).rejects.toThrow("C61211_FREEZE_MANIFEST_INVALID");
  });
  it("detects machine input mutation before text scoring", async () => {
    const f = await c61211FileFixture();
    await writeFile(f.machinePath, "{}");
    await expect(
      scoringC61211Gold({
        directory: f.directory,
        gold: f.goldPath,
        baseline: f.baseline,
        map: f.p.map,
      }),
    ).rejects.toThrow("C61211_FROZEN_INPUT_MUTATED");
  });
  it("detects changed Gold bytes, even with identical timing", async () => {
    const f = await c61211FileFixture();
    await writeFile(
      f.goldPath,
      (await readFile(f.goldPath, "utf8")).replaceAll(
        "明日は晴れ",
        "明日は雨だ",
      ),
    );
    await expect(
      scoringC61211Gold({
        directory: f.directory,
        gold: f.goldPath,
        baseline: f.baseline,
        map: f.p.map,
      }),
    ).rejects.toThrow("C61211_GOLD_CHANGED_BETWEEN_BARRIERS");
  });
  it("rejects a policy mismatch before raw Gold decoding", async () => {
    const f = await c61211FileFixture();
    const bad = c61211Artifact("c6-1-2-1-1-partition-freeze", {
      ...c61211Body(f.freeze),
      policyDefinitionHash: "0".repeat(64),
    });
    await writeFile(
      path.join(f.directory, "c6-1-2-1-1-partition-freeze.json"),
      JSON.stringify(bad),
    );
    await expect(
      verifyC61211PartitionFreeze(f.directory, f.p.map, f.baseline),
    ).rejects.toThrow("C61211_GOLD_BARRIER_BINDING");
  });
});
