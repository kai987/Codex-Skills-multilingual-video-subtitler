import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, access, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  configSchema,
  manifestSchema,
  evidenceSchema,
  atomic,
  fileHash,
  runTask,
  readTask,
  verifyIdentity,
  OwnedRunner,
} from "../packages/video-subtitler/src/standalone/tool.js";
import {
  assemble,
  digest,
} from "../packages/video-subtitler/src/standalone/assembly.js";
import type { ProcessRunner } from "@mvl/shared";
import { subtitleCueSchema } from "@mvl/shared";
import { Ajv2020 } from "ajv/dist/2020.js";

async function fixture() {
  const task = await mkdtemp(path.join(os.tmpdir(), "subtitle-v1-test-"));
  for (const name of [
    "input 日本語.mkv",
    "model.bin",
    "runtime",
    "ffmpeg",
    "ffprobe",
  ])
    await writeFile(path.join(task, name), name);
  const config = configSchema.parse({
    model: path.join(task, "model.bin"),
    runtime: path.join(task, "runtime"),
    ffmpeg: path.join(task, "ffmpeg"),
    ffprobe: path.join(task, "ffprobe"),
  });
  const m = manifestSchema.parse({
    version: "subtitle-tool-v1",
    taskId: path.basename(task),
    createdAt: "test",
    updatedAt: "test",
    input: path.join(task, "input 日本語.mkv"),
    inputHash: await fileHash(path.join(task, "input 日本語.mkv")),
    config,
    configHash: digest(config),
    modelHash: await fileHash(config.model),
    runtimeHash: await fileHash(config.runtime),
    ffmpegHash: await fileHash(config.ffmpeg),
    ffprobeHash: await fileHash(config.ffprobe),
    track: 1,
    duration: 10,
    origin: 900,
    audioOffset: 2,
    executionStatus: "queued",
    phase: "ready",
    artifactIntegrity: "pending",
    qualityStatus: "needs-review",
    contentQuality: "NOT_MEASURED",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    audioHash: null,
    evidenceHash: null,
    warnings: [],
    attempts: [],
    budgetSeconds: 20,
    cacheHits: 0,
    modelLoads: 0,
    outputs: {},
    ownedFiles: ["task.json"],
    error: null,
  });
  await atomic(path.join(task, "task.json"), m);
  return { task, m };
}
function stub(
  text = "1\n00:00:00,000 --> 00:00:01,000\nこんにちは。\n\n2\n00:00:07,000 --> 00:00:08,000\n終わりです。\n",
  failures = 0,
) {
  let count = 0;
  const calls: { exe: string; args: readonly string[] }[] = [];
  const runner: ProcessRunner = {
    run: async (exe, args) => {
      calls.push({ exe, args });
      if (exe.endsWith("ffmpeg")) await writeFile(args.at(-1) ?? "", "audio");
      else if (exe.endsWith("ffprobe"))
        return {
          stdout: '{"format":{"duration":"8"}}',
          stderr: "",
          exitCode: 0,
        };
      else {
        count++;
        if (count <= failures) throw Error("simulated execution failure");
        const prefix = args[args.indexOf("--output-file") + 1];
        await writeFile(`${prefix}.srt`, text);
      }
      return {
        stdout: "",
        stderr: "whisper_init_from_file_with_params: loading model",
        exitCode: 0,
      };
    },
  };
  return { runner, calls, count: () => count };
}
describe("standalone machine draft contract", () => {
  it("exported strict task JSON Schema accepts real state and rejects forged authority", async () => {
    const { m } = await fixture();
    const schema: unknown = JSON.parse(
      await readFile(
        path.resolve(
          import.meta.dirname,
          "../schemas/subtitle-tool-v1/task.schema.json",
        ),
        "utf8",
      ),
    );
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema as object);
    expect(validate(m)).toBe(true);
    expect(validate({ ...m, humanValidated: true })).toBe(false);
    expect(validate({ ...m, undeclared: true })).toBe(false);
  });
  it("defaults locally and rejects extra config authority", () => {
    expect(configSchema.parse({ model: "m", runtime: "r" }).profile).toBe(
      "primary-minimal",
    );
    expect(() =>
      configSchema.parse({ model: "m", runtime: "r", provider: "openai" }),
    ).toThrow();
  });
  it("one full source request, offset once, raw retained, shared profiles and idempotent resume", async () => {
    const { task } = await fixture();
    const fake = stub();
    const a = await runTask(task, { runner: fake.runner });
    expect(a.executionStatus).toBe("completed");
    expect(a.qualityStatus).toBe("needs-review");
    expect(a.modelLoads).toBe(1);
    const evidence = evidenceSchema.parse(
      JSON.parse(
        await readFile(path.join(task, "primary-evidence.json"), "utf8"),
      ),
    );
    expect(evidence.cues.map((c) => [c.start, c.end])).toEqual([
      [2, 3],
      [9, 10],
    ]);
    expect(
      fake.calls.find((c) => c.exe.endsWith("runtime"))?.args,
    ).not.toContain("--prompt");
    const before = await fileHash(
      path.join(task, "primary-minimal.machine-draft.srt"),
    );
    const b = await runTask(task, { runner: fake.runner, profile: "g11" });
    await runTask(task, { runner: fake.runner });
    expect(fake.count()).toBe(1);
    expect(b.evidenceHash).toBe(a.evidenceHash);
    expect(b.cacheHits).toBe(1);
    expect(
      await fileHash(path.join(task, "primary-minimal.machine-draft.srt")),
    ).toBe(before);
    expect(b.finalizationMethod).toBe("none");
    expect(b.humanValidated).toBe(false);
    expect(b.machineOnlyReleaseAuthorized).toBe(false);
  });
  it.each(["model.bin", "runtime", "ffmpeg", "ffprobe", "input 日本語.mkv"])(
    "invalidates changed identity %s",
    async (file) => {
      const { task, m } = await fixture();
      await writeFile(path.join(task, file), "changed");
      await expect(verifyIdentity(m)).rejects.toThrow("身份");
    },
  );
  it("rejects changed config and altered evidence/raw cache", async () => {
    const { task, m } = await fixture();
    m.config.threads = 8;
    await expect(verifyIdentity(m)).rejects.toThrow();
    const fake = stub();
    await runTask(task, { runner: fake.runner });
    await chmod(path.join(task, "raw-primary.srt"), 0o644);
    await writeFile(path.join(task, "raw-primary.srt"), "changed");
    await expect(runTask(task, { runner: fake.runner })).rejects.toThrow(
      "身份",
    );
    expect(fake.count()).toBe(1);
  });
  it("retries an execution failure once, never a successful semantic failure", async () => {
    const { task } = await fixture();
    const fake = stub(undefined, 1);
    const m = await runTask(task, { runner: fake.runner });
    expect(fake.count()).toBe(2);
    expect(m.attempts.map((a) => a.state)).toEqual(["failed", "completed"]);
    const other = await fixture();
    const invalid = stub("1\n00:00:00,000 --> 00:00:30,000\n越界。\n");
    await expect(
      runTask(other.task, { runner: invalid.runner }),
    ).rejects.toThrow("越界");
    await expect(
      runTask(other.task, { runner: invalid.runner }),
    ).rejects.toThrow("越界");
    expect(invalid.count()).toBe(1);
  });
  it("two failures exhaust budget across resume", async () => {
    const { task } = await fixture();
    const fake = stub(undefined, 4);
    await expect(runTask(task, { runner: fake.runner })).rejects.toThrow();
    await expect(runTask(task, { runner: fake.runner })).rejects.toThrow();
    expect(fake.count()).toBe(2);
  });
  it("empty transcript is a warning, not process failure or verified silence", async () => {
    const { task } = await fixture();
    const m = await runTask(task, { runner: stub("").runner });
    expect(m.executionStatus).toBe("partial");
    expect(m.artifactIntegrity).toBe("pending");
    expect(Object.keys(m.outputs)).toHaveLength(0);
    expect(m.warnings.join()).toContain("EMPTY_TRANSCRIPT");
  });
  it("partial artifact is never a cache hit", async () => {
    const { task } = await fixture();
    await writeFile(
      path.join(task, "primary-evidence.json.partial-unfinished"),
      "{}",
    );
    const fake = stub();
    const m = await runTask(task, { runner: fake.runner });
    expect(m.cacheHits).toBe(0);
    expect(fake.count()).toBe(1);
  });
  it("preserves external edited copies; refuses overwriting changed machine draft", async () => {
    const { task } = await fixture();
    const fake = stub();
    await runTask(task, { runner: fake.runner });
    await writeFile(path.join(task, "edited.ass"), "human edit");
    await runTask(task, { runner: fake.runner });
    expect(await readFile(path.join(task, "edited.ass"), "utf8")).toBe(
      "human edit",
    );
    await writeFile(
      path.join(task, "primary-minimal.machine-draft.srt"),
      "external change",
    );
    await expect(runTask(task, { runner: fake.runner })).rejects.toThrow(
      "外部修改",
    );
    expect(fake.count()).toBe(1);
  });
  it("cancellation preserves extracted checkpoint and releases owned lock", async () => {
    const { task } = await fixture();
    const controller = new AbortController();
    const fake = stub();
    await expect(
      runTask(task, {
        signal: controller.signal,
        runner: {
          run: async (exe, args, o) => {
            if (exe.endsWith("runtime")) {
              controller.abort();
              throw Error("cancelled");
            }
            return fake.runner.run(exe, args, o);
          },
        },
      }),
    ).rejects.toThrow();
    const cancelled = await readTask(task);
    expect(cancelled.executionStatus).toBe("cancelled");
    expect(cancelled.audioHash).not.toBeNull();
    await expect(access(path.join(task, ".run-lock"))).rejects.toThrow();
    const resumed = await runTask(task, { runner: fake.runner });
    expect(resumed.executionStatus).toBe("completed");
    expect(fake.count()).toBe(1);
  });
  it("concurrent task lock prevents a second runner", async () => {
    const { task } = await fixture();
    await writeFile(path.join(task, ".run-lock"), "{}");
    const fake = stub();
    await expect(runTask(task, { runner: fake.runner })).rejects.toThrow(
      "运行锁",
    );
    expect(fake.count()).toBe(0);
  });
  it("owned runner cancels only its spawned process", async () => {
    const controller = new AbortController();
    const runner = new OwnedRunner(controller.signal);
    const promise = runner.run(process.execPath, [
      "-e",
      "setInterval(()=>{},1000)",
    ]);
    controller.abort();
    await expect(promise).rejects.toThrow("取消");
    expect(process.pid).toBeGreaterThan(0);
  });
  it("keeps true distinct repetitions in both profiles", () => {
    const cues = [0, 3].map((s, i) =>
      subtitleCueSchema.parse({
        id: `r${i}`,
        start: s,
        end: s + 1,
        text: "本当にそうです。",
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: null,
      }),
    );
    expect(assemble(cues, "primary-minimal").cues).toEqual(cues);
    expect(assemble(cues, "g11").normalizedSequencePreserved).toBe(true);
  });
});
