function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture value absent");
  return value;
}
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { it, expect } from "vitest";
import { generateMatched } from "../../packages/video-subtitler/src/machine-quality/matched-generate.js";
import { matchedEvidenceSchema } from "../../packages/video-subtitler/src/machine-quality/matched-replay.js";
import { evidence } from "../helpers/c60116-quality-fixture.js";
it("exports actual ASS/SRT/VTT and package with repeatable semantic payload and permission isolation", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "c601161-test-"));
  try {
    const old = evidence(),
      e = matchedEvidenceSchema.parse({
        version: "c601161-primary-evidence-v1",
        partition: old.partition,
        source: old.source,
        primaryRequests: old.primaryRequests,
        promptStatus: "HISTORICAL_TITLE_PROMPTED_EVIDENCE",
      });
    requireValue(e.primaryRequests[0]).segments = [
      { id: "raw", start: 0, end: 4, text: "こちらへ来て!こちらへ来て!" },
    ];
    const input = path.join(temp, "evidence.json");
    fs.writeFileSync(input, JSON.stringify(e));
    generateMatched(input, path.join(temp, "a"));
    generateMatched(input, path.join(temp, "b"));
    const a = JSON.parse(
      fs.readFileSync(path.join(temp, "a/experiment-manifest.json"), "utf8"),
    ) as { files: unknown[] };
    const b = JSON.parse(
      fs.readFileSync(path.join(temp, "b/experiment-manifest.json"), "utf8"),
    ) as { files: unknown[] };
    expect(a.files).toEqual(b.files);
    for (const ext of ["ass", "srt", "vtt"]) {
      expect(
        fs.readFileSync(
          path.join(temp, "a/R1-legacy-replay/machine-candidate." + ext),
        ),
      ).toEqual(
        fs.readFileSync(
          path.join(temp, "a/R2-repair-disabled/machine-candidate." + ext),
        ),
      );
      expect(
        fs.readFileSync(
          path.join(temp, "a/R1-legacy-replay/machine-candidate." + ext),
        ),
      ).not.toEqual(
        fs.readFileSync(
          path.join(temp, "a/R2-source-preserving/machine-candidate." + ext),
        ),
      );
    }
    const sentinel = path.join(temp, "human-reference.txt");
    fs.writeFileSync(sentinel, "reference");
    const forbidden = spawnSync(
      process.execPath,
      [
        "--permission",
        "--allow-fs-read=" + input,
        "-e",
        "require('node:fs').readFileSync(" + JSON.stringify(sentinel) + ")",
      ],
      { encoding: "utf8" },
    );
    expect(forbidden.status).not.toBe(0);
    expect(forbidden.stderr).toContain("ERR_ACCESS_DENIED");
    execFileSync(process.execPath, [
      "--permission",
      "--allow-fs-read=" + input,
      "-e",
      "require('node:fs').readFileSync(" + JSON.stringify(input) + ")",
    ]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
