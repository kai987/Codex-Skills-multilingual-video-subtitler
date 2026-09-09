import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { recoveryFixture } from "../helpers/subtitle-recovery-fixture.js";
const exec = promisify(execFile);
const result = (s: string) =>
  JSON.parse(s) as {
    directory: string;
    recovery: { partialSubtitle: string };
    report: { humanValidated: boolean };
    executionStatus: string;
  };
async function cli(args: string[]) {
  try {
    const r = await exec(
      process.execPath,
      ["scripts/subtitle-tool.mjs", ...args],
      { cwd: path.resolve(import.meta.dirname, "../..") },
    );
    return { ...r, code: 0 };
  } catch (e) {
    const r = e as { stdout: string; stderr: string; code: number };
    return r;
  }
}
it("built offline CLI recover/default/partial/status/resume/edited and stable exit codes", async () => {
  const { task } = await recoveryFixture();
  expect((await cli(["--help"])).stdout).toContain("validate-edited");
  const text = await cli(["recover", "--task", task]);
  expect(text.code).toBe(2);
  expect(result(text.stdout).recovery.partialSubtitle).toBe("not-requested");
  const partial = await cli(["recover", "--task", task, "--export-partial"]);
  expect(partial.code).toBe(2);
  const p = result(partial.stdout);
  const input = path.join(p.directory, "subtitles/primary-minimal.partial.srt");
  expect(
    (
      await cli([
        "validate-edited",
        "--task",
        task,
        "--input",
        input,
        "--timebase",
        "source",
      ])
    ).code,
  ).toBe(2);
  expect((await cli(["status", "--task", task])).code).toBe(0);
  const resumed = await cli(["resume", "--task", task]);
  expect(resumed.code).toBe(2);
  expect(resumed.stdout).toContain("不会产生新时间");
  expect(
    (await cli(["recover", "--task", task, "--profile", "g11"])).code,
  ).toBe(1);
  expect(
    result(await readFile(path.join(task, "task.json"), "utf8"))
      .executionStatus,
  ).toBe("failed");
  await writeFile(path.join(task, "raw-primary.srt"), "corrupted");
  expect((await cli(["recover", "--task", task])).code).toBe(1);
}, 30000);
it("built CLI synthetic time-only correction returns 0 without authority escalation", async () => {
  const { task } = await recoveryFixture(
    "1\n00:00:01,000 --> 00:00:01,000\n中性测试。\n",
  );
  const input = path.join(task, "synthetic-edited.srt");
  await writeFile(input, "1\n00:00:01,000 --> 00:00:02,000\n中性测试。\n");
  const r = await cli([
    "validate-edited",
    "--task",
    task,
    "--input",
    input,
    "--timebase",
    "audio",
  ]);
  expect(r.code).toBe(0);
  expect(result(r.stdout).report.humanValidated).toBe(false);
});
