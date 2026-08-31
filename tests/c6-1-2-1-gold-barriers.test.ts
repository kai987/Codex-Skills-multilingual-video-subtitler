import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { c6121Fixture } from "./helpers/c6121-fixture.js";
import { c6121FileFixture } from "./helpers/c6121-file-fixture.js";
import {
  readAssTimingOnly,
  readC6121GoldTiming,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/gold-timing-barrier.js";
import { readC6121GoldText } from "../packages/video-subtitler/src/consensus/evaluation-recovery/gold-text-barrier.js";
import { hash } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
describe("C6.1.2.1 actual timing/text IO barriers", () => {
  it.each(["0:00:01.00,0:00:03.00", "0:00:01,00,0:00:03,00"])(
    "reads only ASCII timing prefix and discards arbitrary dialogue: %s",
    async (times) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "c6121-prefix-"));
      const file = path.join(root, "gold.ass");
      const line = "Dialogue: 0," + times + ",Default,,0,0,0,,";
      await writeFile(file, line + "A,日本語,❄".repeat(10000) + "\n");
      const a = await readAssTimingOnly(file);
      await writeFile(file, line + "totally different dialogue\n");
      const b = await readAssTimingOnly(file);
      expect(a.cues).toEqual([{ id: "gold-0001", start: 1, end: 3 }]);
      expect(b.cues).toEqual(a.cues);
      expect(a.byteHash).not.toBe(b.byteHash);
    },
  );
  it.each([
    "Dialogue: 0,not-a-time,untrusted text",
    "Dialogue: 0,0:00:01.00",
    "Dialogue: 0,0:00:01.00,words",
  ])(
    "fails closed before arbitrary malformed prefix decoding %s",
    async (content) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "c6121-bad-prefix-"));
      const file = path.join(root, "gold.ass");
      await writeFile(file, content);
      await expect(readAssTimingOnly(file)).rejects.toThrow(
        "MALFORMED_GOLD_TIMING_PREFIX",
      );
    },
  );
  it("does not open Gold before a valid machine freeze clock", async () => {
    const f = c6121Fixture();
    f.baseline.machineFrozenAt = "2999-01-01T00:00:00.000Z";
    await expect(
      readC6121GoldTiming(f.baseline, "/missing/gold.ass"),
    ).rejects.toThrow("TIMING_PRECEDES_MACHINE_FREEZE");
  });
  it("requires a persisted supergroup freeze before Gold text", async () => {
    const s = await c6121FileFixture();
    await rm(path.join(s.directory, "c6-1-2-1-supergroup-freeze.json"));
    await expect(
      readC6121GoldText({
        directory: s.directory,
        gold: "/missing/gold.ass",
        baseline: s.baseline,
        map: s.graph.map,
      }),
    ).rejects.toThrow("ENOENT");
  });
  it.each(["machine", "map", "gold"])(
    "rejects %s changes after the freeze",
    async (target) => {
      const s = await c6121FileFixture();
      const file =
        target === "machine"
          ? s.machinePath
          : target === "map"
            ? path.join(s.directory, "c6-1-2-1-evaluator-supergroup-map.json")
            : s.goldPath;
      await writeFile(file, (await readFile(file, "utf8")) + "\n");
      await expect(
        readC6121GoldText({
          directory: s.directory,
          gold: s.goldPath,
          baseline: s.baseline,
          map: s.graph.map,
        }),
      ).rejects.toThrow(
        target === "machine"
          ? "FROZEN_INPUT_CHANGED"
          : target === "map"
            ? "SUPERGROUP_FILE_CHANGED"
            : "GOLD_CHANGED_BETWEEN_STAGES",
      );
    },
  );
  it("enforces both barriers and verifies independent timing/text parser parity", async () => {
    const s = await c6121FileFixture();
    const text = await readC6121GoldText({
      directory: s.directory,
      gold: s.goldPath,
      baseline: s.baseline,
      map: s.graph.map,
    });
    expect(text.gold).toHaveLength(10);
    expect(
      text.barrier.goldTextFirstReadAt >= s.freeze.supergroupFrozenAt,
    ).toBe(true);
    expect(text.barrier.machineRuntimeRawGoldInputCount).toBe(0);
    expect(
      hash(text.gold.map(({ id, start, end }) => ({ id, start, end }))),
    ).toBe(s.graph.map.goldTimingHash);
  });
});
