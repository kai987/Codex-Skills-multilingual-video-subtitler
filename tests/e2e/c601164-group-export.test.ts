import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GROUP_POLICY } from "../../packages/video-subtitler/src/machine-quality/source-bound-group.js";
import {
  objectHash,
  sha256,
} from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";
import { ACOUSTIC_POLICY } from "../../packages/video-subtitler/src/machine-quality/bounded-acoustic.js";
import { STORED_TOKEN_POLICY } from "../../packages/video-subtitler/src/machine-quality/stored-token-span.js";
import { groupFixture } from "../helpers/c601164-group-fixture.js";
import { buildGroupPatch } from "../../packages/video-subtitler/src/machine-quality/source-bound-group.js";
import { replayPrimaryAssembly } from "../../packages/video-subtitler/src/machine-quality/matched-replay.js";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";
it("actual pre-intra-cue group hook reaches ASS/SRT/VTT and disabled equals baseline", () => {
  const x = groupFixture(),
    p = buildGroupPatch(x.group, x.observation, "aligned", x.alignment);
  const baseline = replayPrimaryAssembly(x.primary, true),
    disabled = replayPrimaryAssembly(
      x.primary,
      true,
      {},
      undefined,
      undefined,
      { mode: "observe", patches: [p] },
    ),
    applied = replayPrimaryAssembly(x.primary, true, {}, undefined, undefined, {
      mode: "apply",
      patches: [p],
    });
  expect(disabled.cues).toEqual(baseline.cues);
  expect(applied.cues).toHaveLength(2);
  for (const [format, parse] of [
    [formatAss, parseAss],
    [formatSrt, parseSrt],
    [formatVtt, parseVtt],
  ] as const) {
    expect(format(disabled.cues)).toBe(format(baseline.cues));
    const cs = parse(format(applied.cues));
    expect(cs.map((c) => c.text.replaceAll("\n", "")).join("")).toBe(
      "そこで待って。明日話そう。",
    );
    expect(cs.map((c) => [c.start, c.end])).not.toEqual(
      parse(format(baseline.cues)).map((c) => [c.start, c.end]),
    );
  }
  const stages = applied.trace.map((t) => t.stageName);
  expect(stages.indexOf("REPLACE_SOURCE_BOUND_UTTERANCE_GROUP")).toBeLessThan(
    stages.indexOf("repairIntraCueHypothesisRepetition"),
  );
  expect(applied.cues.map((c) => [c.start, c.end])).toEqual(
    p.newCues.map((c) => [c.start, c.end]),
  );
});
it("runs two independent permission-isolated four-control generators with shape-faithful positive evidence", () => {
  const x = groupFixture(),
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "c601164-isolated-"));
  try {
    const put = (name: string, v: unknown) => {
      const p = path.join(temp, name);
      fs.writeFileSync(p, JSON.stringify(v));
      return p;
    };
    const primary = put("primary.json", x.primary);
    const old = put("old.json", {
      version: "c601162-evidence-v1",
      primaryHash: sha256(fs.readFileSync(primary)),
      planHash: "a".repeat(64),
      policyHash: objectHash(ACOUSTIC_POLICY),
      cases: [x.c],
      observations: [],
      frozenAt: "2026-01-01T00:00:00Z",
    });
    const stored = put("stored.json", {
      version: "c601163-token-span-evidence-v1",
      strategy: STORED_TOKEN_POLICY.version,
      primaryHash: sha256(fs.readFileSync(primary)),
      oldEvidenceHash: sha256(fs.readFileSync(old)),
      policyHash: objectHash(STORED_TOKEN_POLICY),
      cases: [x.c],
      observations: [x.observation],
    });
    const groups = put("groups.json", [x.group]),
      aligned = put("alignments.json", [x.alignment]),
      plan = put("plan.json", {
        primaryHash: sha256(fs.readFileSync(primary)),
        groupsHash: sha256(fs.readFileSync(groups)),
        policy: GROUP_POLICY,
        codeHashes: {},
      });
    const inputs = [primary, old, stored, groups, aligned, plan];
    for (const run of ["a", "b"]) {
      const out = path.join(temp, run);
      const args = [
        "--permission",
        "--allow-fs-read=" + process.cwd(),
        ...inputs.map((p) => "--allow-fs-read=" + p),
        "--allow-fs-read=" + out,
        "--allow-fs-read=" + out + "/*",
        "--allow-fs-write=" + out,
        "--allow-fs-write=" + out + "/*",
        "scripts/generate-c601164.mjs",
        ...inputs,
        out,
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
        { cwd: process.cwd() },
      );
    }
    const a = JSON.parse(
      fs.readFileSync(path.join(temp, "a/experiment-manifest.json"), "utf8"),
    ) as { files: unknown[]; newInference: number };
    const b = JSON.parse(
      fs.readFileSync(path.join(temp, "b/experiment-manifest.json"), "utf8"),
    ) as { files: unknown[] };
    expect(a.files).toEqual(b.files);
    expect(a.newInference).toBe(0);
    expect(
      parseAss(
        fs.readFileSync(
          path.join(temp, "a/T2-aligned-group/machine-candidate.ass"),
          "utf8",
        ),
      ),
    ).toHaveLength(2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
