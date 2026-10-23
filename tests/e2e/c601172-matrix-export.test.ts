import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
import { z } from "zod";
import { evidence } from "../helpers/c60116-quality-fixture.js";
import { freshMatchedEvidenceSchema } from "../../packages/video-subtitler/src/machine-quality/matched-replay.js";
import { subtitlePackageSchema } from "@mvl/shared";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";
it("exports all five neutral views through the isolated entry; old controls and A/B bytes reproduce", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c601172-export-")),
    repo = process.cwd();
  const e = evidence(),
    input = path.join(root, "input.json"),
    cfg = path.join(root, "config.json");
  fs.writeFileSync(
    input,
    JSON.stringify(
      freshMatchedEvidenceSchema.parse({
        version: "c60117-fresh-primary-v1",
        promptStatus: "FRESH_PROMPT_FREE",
        partition: e.partition,
        source: e.source,
        primaryRequests: e.primaryRequests,
      }),
    ),
  );
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      partition: "D",
      runName: "neutral",
      repair: "occurrence-overlap-required",
    }),
  );
  const libs = fs
    .readdirSync(path.join(repo, "packages"))
    .map((p) => path.join(repo, "packages", p, "dist"))
    .filter((p) => fs.existsSync(p));
  const run = (script: string, args: string[], out: string) => {
    fs.mkdirSync(out);
    execFileSync(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        "(version 1)(allow default)(deny network*)",
        process.execPath,
        "--permission",
        ...[
          path.join(repo, "scripts", script),
          path.join(repo, "scripts/c60117-common.mjs"),
          path.join(repo, "node_modules"),
          ...libs,
          input,
          cfg,
          out,
        ].map((p) => "--allow-fs-read=" + p),
        "--allow-fs-write=" + out,
        path.join(repo, "scripts", script),
        ...args,
      ],
      { env: { PATH: process.env.PATH, TZ: "UTC", LANG: "en_US.UTF-8" } },
    );
  };
  for (const name of ["a", "b"])
    run(
      "generate-c601172.mjs",
      [input, path.join(root, name)],
      path.join(root, name),
    );
  run(
    "generate-c60117.mjs",
    [input, cfg, path.join(root, "old")],
    path.join(root, "old"),
  );
  execFileSync("diff", ["-qr", path.join(root, "a"), path.join(root, "b")]);
  const mapping = {
    "P0-primary-minimal": "P0-primary-minimal",
    "G00-legacy": "P1-current-matched",
    "G10-cross-guard": "P2-one-family-recovery",
  };
  for (const v of fs
    .readdirSync(path.join(root, "a"))
    .filter((v) => fs.statSync(path.join(root, "a", v)).isDirectory())) {
    const pkg = subtitlePackageSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(root, "a", v, "subtitle-package.needs-review.json"),
          "utf8",
        ),
      ),
    );
    for (const [ext, parser] of Object.entries({
      ass: parseAss,
      srt: parseSrt,
      vtt: parseVtt,
    })) {
      const bytes = fs.readFileSync(
        path.join(root, "a", v, "machine-candidate." + ext),
        "utf8",
      );
      expect(parser(bytes).map((c) => c.text.replace(/\s/gu, ""))).toEqual(
        pkg.cues.map((c) => c.text.replace(/\s/gu, "")),
      );
      const old = mapping[v as keyof typeof mapping];
      if (old)
        expect(bytes).toBe(
          fs.readFileSync(
            path.join(root, "old", old, "machine-candidate." + ext),
            "utf8",
          ),
        );
    }
    const state = z
      .object({ newModelLoads: z.literal(0), humanValidated: z.literal(false) })
      .parse(
        JSON.parse(
          fs.readFileSync(
            path.join(root, "a", v, "generation-state.json"),
            "utf8",
          ),
        ),
      );
    expect(state.newModelLoads).toBe(0);
    expect(state.humanValidated).toBe(false);
  }
});
