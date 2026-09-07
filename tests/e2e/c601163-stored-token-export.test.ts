import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { it, expect } from "vitest";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";
import {
  fixturePrimary,
  observation,
} from "../helpers/c601163-stored-fixture.js";
import { ACOUSTIC_POLICY } from "../../packages/video-subtitler/src/machine-quality/bounded-acoustic.js";
import {
  STORED_TOKEN_POLICY,
  type StoredDecision,
} from "../../packages/video-subtitler/src/machine-quality/stored-token-span.js";
import {
  objectHash,
  sha256,
} from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";
it("exports a shape-faithful positive token-span decision through actual assembly and isolated A/B generation", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "c601163-export-"));
  try {
    const { primary, cases, c } = fixturePrimary();
    const p = JSON.stringify(primary),
      primaryFile = path.join(temp, "primary.json"),
      oldFile = path.join(temp, "old.json"),
      input = path.join(temp, "tokens.json");
    const old = JSON.stringify({
      version: "c601162-evidence-v1",
      primaryHash: sha256(p),
      planHash: "a".repeat(64),
      policyHash: objectHash(ACOUSTIC_POLICY),
      cases,
      observations: ["w1", "w2"].map((windowId) => ({
        requestId: "reazon-" + windowId,
        caseBindingHash: c.bindingHash,
        family: "reazon",
        windowId,
        audioHash: objectHash(windowId),
        window: { start: c.before.start - 2, end: c.before.end + 2 },
        status: "SUCCESS",
        text: "別の窓全体の診断",
        segments: [],
        points: [{ text: "診断", time: c.before.start }],
        timebase: "source-global-once",
        timingKind: "TOKEN_POINTS",
        resultHash: "b".repeat(64),
      })),
      frozenAt: new Date().toISOString(),
    });
    fs.writeFileSync(primaryFile, p);
    fs.writeFileSync(oldFile, old);
    fs.writeFileSync(
      input,
      JSON.stringify({
        version: "c601163-token-span-evidence-v1",
        strategy: STORED_TOKEN_POLICY.version,
        primaryHash: sha256(p),
        oldEvidenceHash: sha256(old),
        policyHash: objectHash(STORED_TOKEN_POLICY),
        cases,
        observations: [observation(c), observation(c, "w2")],
      }),
    );
    for (const run of ["a", "b"]) {
      const target = path.join(temp, run);
      const args = [
        "--permission",
        "--allow-fs-read=" + process.cwd(),
        "--allow-fs-read=" + primaryFile,
        "--allow-fs-read=" + oldFile,
        "--allow-fs-read=" + input,
        "--allow-fs-read=" + target,
        "--allow-fs-read=" + target + "/*",
        "--allow-fs-write=" + target,
        "--allow-fs-write=" + target + "/*",
        "scripts/generate-c601163.mjs",
        primaryFile,
        oldFile,
        input,
        target,
      ];
      execFileSync(
        process.platform === "darwin"
          ? "/usr/bin/sandbox-exec"
          : process.execPath,
        process.platform === "darwin"
          ? [
              "-p",
              "(version 1)(allow default)(deny network*)",
              process.execPath,
              ...args,
            ]
          : args,
      );
    }
    const read = (p: string) => fs.readFileSync(path.join(temp, p), "utf8");
    const a = JSON.parse(read("a/experiment-manifest.json")) as {
      files: unknown[];
      newInference: number;
    };
    const b = JSON.parse(read("b/experiment-manifest.json")) as {
      files: unknown[];
    };
    expect(a.files).toEqual(b.files);
    expect(a.newInference).toBe(0);
    for (const [ext, parser] of Object.entries({
      ass: parseAss,
      srt: parseSrt,
      vtt: parseVtt,
    })) {
      const s0 = read(`a/S0-legacy-policy/machine-candidate.${ext}`),
        s1 = read(`a/S1-token-observe/machine-candidate.${ext}`),
        s2 = read(`a/S2-token-apply/machine-candidate.${ext}`);
      expect(s0).toBe(s1);
      expect(s2).not.toBe(s1);
      expect(
        parser(s2)
          .map((c) => c.text)
          .join("")
          .replaceAll("\n", ""),
      ).toBe("そこで待って。");
      expect(parser(s2).map((c) => [c.start, c.end])).toEqual(
        parser(s0).map((c) => [c.start, c.end]),
      );
    }
    const d = JSON.parse(read("a/decisions.json")) as StoredDecision[];
    expect(d[0]?.action).toBe("REPLACE_BOUND_SOURCE_TEXT_SPAN");
    expect(
      d[0]?.sideEvidence.every(
        (s) => !s.sideEvidenceVetoed && s.state === "WINDOW_LEVEL_DIAGNOSTIC",
      ),
    ).toBe(true);
    const diff = JSON.parse(read("a/export-diff.json")) as {
      exportChangedGroups: number;
    };
    expect(diff.exportChangedGroups).toBe(1);
    expect(read("a/S2-token-apply/stage-trace.json")).toContain(
      "そこで待って。",
    );
    expect(read("a/S2-token-apply/mutation-journal.json")).toContain(
      '"applied": true',
    );
    const sentinel = path.join(temp, "human-reference.txt");
    fs.writeFileSync(sentinel, "not permitted");
    for (const code of [
      `require("node:fs").readFileSync(${JSON.stringify(sentinel)})`,
      'require("node:child_process").spawnSync("true")',
    ]) {
      const r = spawnSync(
        process.execPath,
        ["--permission", "--allow-fs-read=" + input, "-e", code],
        { encoding: "utf8", timeout: 2000 },
      );
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("ERR_ACCESS_DENIED");
    }
    if (process.platform === "darwin") {
      const r = spawnSync(
        "/usr/bin/sandbox-exec",
        [
          "-p",
          "(version 1)(allow default)(deny network*)",
          process.execPath,
          "-e",
          'const s=require("node:net").connect(9,"127.0.0.1");s.on("error",e=>{console.log(e.code);process.exit(0)});setTimeout(()=>process.exit(2),1000)',
        ],
        { encoding: "utf8", timeout: 2000 },
      );
      expect(r.stdout.trim()).toBe("EPERM");
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
