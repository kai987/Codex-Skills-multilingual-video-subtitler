import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { evidence } from "../helpers/c60116-quality-fixture.js";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";
import { machineQualityEvidenceSchema } from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";

describe("C60116 real file and process boundary", () => {
  it("blocks a human answer path outside code/evidence allowlist", () => {
    const root = mkdtempSync(path.join(tmpdir(), "c60116-deny-"));
    const forbidden = path.join(root, "human-answer.txt");
    writeFileSync(forbidden, "synthetic secret answer");
    const result = spawnSync(
      process.execPath,
      [
        "--permission",
        "--allow-fs-read=" + process.cwd(),
        "--input-type=module",
        "-e",
        "import fs from 'node:fs'; fs.readFileSync(process.argv[1]);",
        forbidden,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ERR_ACCESS_DENIED");
  });
  it("rejects a mutated cache descriptor at the strict evidence boundary", () => {
    const e = evidence();
    expect(() =>
      machineQualityEvidenceSchema.parse({
        ...e,
        primaryRequests: e.primaryRequests.map((r) => ({
          ...r,
          cacheKey: "not-a-cache-key",
        })),
      }),
    ).toThrow();
  });
  it("writes real formats, persists journal, and matches two restricted replays", () => {
    const root = mkdtempSync(path.join(tmpdir(), "c60116-flow-")),
      input = path.join(root, "machine-evidence.json"),
      out = path.join(root, "experiment");
    writeFileSync(input, JSON.stringify(evidence()));
    const result = spawnSync(
      process.execPath,
      ["scripts/run-c60116-experiment.mjs", input, out],
      { encoding: "utf8" },
    );
    expect(result.stderr, result.stdout).toBe("");
    expect(result.status).toBe(0);
    for (const [ext, parse] of Object.entries({
      ass: parseAss,
      srt: parseSrt,
      vtt: parseVtt,
    })) {
      const b1 = parse(
        readFileSync(
          path.join(
            out,
            "run-a/baselines/B1-current-stable/machine-candidate." + ext,
          ),
          "utf8",
        ),
      );
      const b2 = parse(
        readFileSync(
          path.join(
            out,
            "run-a/candidate/B2-recovered/machine-candidate." + ext,
          ),
          "utf8",
        ),
      );
      expect(b1).toHaveLength(1);
      expect(b2).toHaveLength(2);
      expect(b2.map((c) => c.start)).toEqual([10, 12]);
      expect(b2.map((c) => c.text)).toEqual(["走れ!走れ!", "走れ!走れ!"]);
    }
    const journal: unknown = JSON.parse(
      readFileSync(
        path.join(out, "run-a/candidate/B2-recovered/mutation-journal.json"),
        "utf8",
      ),
    );
    expect(journal).toMatchObject([
      { applied: true, sourceIds: ["raw-a", "raw-b"] },
    ]);
    expect(
      JSON.parse(
        readFileSync(path.join(out, "replay-validation.json"), "utf8"),
      ) as unknown,
    ).toMatchObject({ passed: true, b2ReplayParity: true });
  }, 15000);
});
