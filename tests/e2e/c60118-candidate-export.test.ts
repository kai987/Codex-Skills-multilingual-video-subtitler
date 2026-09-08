import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
import { evidence } from "../helpers/c60116-quality-fixture.js";
import { freshMatchedEvidenceSchema } from "../../packages/video-subtitler/src/machine-quality/matched-replay.js";
it("replays lossless R0 and byte-frozen G11, A/B without fabricated R0 cues", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c60118-export-")),
    repo = process.cwd(),
    e = evidence();
  const input = path.join(root, "input.json"),
    response = path.join(root, "response.json");
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
  const raw = {
    status: "SUCCESS_NONEMPTY",
    rawResponseComplete: true,
    result: {
      text: "  中立文字。  ",
      tokens: ["中立", "文字"],
      timestamps: [-0.5],
    },
  };
  fs.writeFileSync(
    response,
    JSON.stringify({
      response: raw,
      responseHash: createHash("sha256")
        .update(JSON.stringify(raw))
        .digest("hex"),
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
          response,
          out,
        ].map((p) => "--allow-fs-read=" + p),
        "--allow-fs-write=" + out,
        path.join(repo, "scripts", script),
        ...args,
      ],
      { env: { PATH: process.env.PATH, TZ: "UTC" } },
    );
  };
  for (const r of ["a", "b"])
    run(
      "generate-c60118.mjs",
      [input, response, path.join(root, r)],
      path.join(root, r),
    );
  run(
    "generate-c601172.mjs",
    [input, path.join(root, "old")],
    path.join(root, "old"),
  );
  execFileSync("diff", ["-qr", path.join(root, "a"), path.join(root, "b")]);
  expect(
    fs.readFileSync(
      path.join(root, "a/R0-second-asr-transcript/transcript.txt"),
      "utf8",
    ),
  ).toBe(raw.result.text);
  expect(
    fs
      .readdirSync(path.join(root, "a/R0-second-asr-transcript"))
      .some((f) => /\.(ass|srt|vtt)$/.test(f)),
  ).toBe(false);
  for (const ext of ["ass", "srt", "vtt"])
    expect(
      fs.readFileSync(
        path.join(root, "a/W1-frozen-G11/machine-candidate." + ext),
        "utf8",
      ),
    ).toBe(
      fs.readFileSync(
        path.join(root, "old/G11-composed/machine-candidate." + ext),
        "utf8",
      ),
    );
});
it("keeps frozen worker default and independent stream setup explicit", () => {
  const old = fs.readFileSync(
      "scripts/runtime/reazonspeech_k2_worker.py",
      "utf8",
    ),
    current = fs.readFileSync(
      "scripts/runtime/c60118_reazon_worker.py",
      "utf8",
    );
  expect(old).toContain('message.get("maximumPaddedSeconds", 30.0)');
  expect(current).toContain("stream = recognizer.create_stream()");
  expect(current).toContain("text = result.text");
  expect(current).toContain("tokens = list(result.tokens)");
  expect(current).toContain("timestamps = list(result.timestamps)");
});
