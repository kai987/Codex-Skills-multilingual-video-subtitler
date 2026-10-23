import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { recoveryFixture, mixed } from "./helpers/subtitle-recovery-fixture.js";
import {
  rawRecords,
  classifyRecords,
  recoverTask,
  validateEdited,
  readRecoverySource,
  recoverySchema,
  recoveryStatus,
} from "../packages/video-subtitler/src/standalone/recovery.js";
import {
  fileHash,
  runTask,
  atomic,
} from "../packages/video-subtitler/src/standalone/tool.js";
import { digest } from "../packages/video-subtitler/src/standalone/assembly.js";
import { parseSrt, parseAss, parseVtt } from "@mvl/subtitle-core";
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, writeFile: vi.fn(original.writeFile) };
});

describe("offline partial recovery", () => {
  it("ASS invalid clock retains body and raw event; orphan event stays unresolved", async () => {
    const { m } = await recoveryFixture();
    const a = classifyRecords(
      rawRecords(
        "[Events]\nFormat: Start, End, Text\nDialogue: -0:00:01.00,0:00:01.00,残る文字\nUnknown: event",
        digest("ass"),
        "ass",
      ),
      m,
    );
    expect(a.records).toHaveLength(2);
    expect(a.records[0]?.text).toBe("残る文字");
    expect(a.records[0]?.issues).toContain("NEGATIVE_TIME");
    expect(a.records[1]?.parseStatus).toBe("UNPARSED");
  });
  it("VTT header is required and metadata blocks cannot hide unknown content", async () => {
    const { task } = await recoveryFixture();
    const edited = path.join(task, "bad.vtt");
    await fs.writeFile(edited, mixed);
    await expect(validateEdited(task, edited)).rejects.toThrow("WEBVTT");
    await fs.writeFile(
      edited,
      "WEBVTT\n\nNOTE uncertain content\nretained\n\n" + mixed,
    );
    const r = await validateEdited(task, edited);
    expect(r.report.formatIntegrity).toBe("failed");
    expect(r.report.issues.some((x) => x.rawBlock.includes("retained"))).toBe(
      true,
    );
  });
  it("cancellation midway through formats leaves no committed subset", async () => {
    const { task } = await recoveryFixture();
    const controller = new AbortController();
    const original = vi.mocked(fs.writeFile).getMockImplementation();
    if (!original) throw Error("Missing mock implementation");
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      await original(...args);
      if (typeof args[0] === "string" && args[0].endsWith(".partial.srt"))
        controller.abort();
    });
    try {
      await expect(
        recoverTask(task, { exportPartial: true, signal: controller.signal }),
      ).rejects.toThrow();
    } finally {
      vi.mocked(fs.writeFile).mockImplementation(original);
    }
    expect(await fs.readdir(path.join(task, "recovery"))).toEqual([]);
  });
  it("rebound summary counts or removed required hashes cannot forge trusted reuse", async () => {
    const { task } = await recoveryFixture();
    const r = await recoverTask(task);
    await fs.writeFile(
      path.join(r.directory, "recovery.json"),
      JSON.stringify({ ...r.recovery, recordCount: 1 }),
    );
    await expect(recoverTask(task)).rejects.toThrow("证据不符");
    await fs.writeFile(
      path.join(r.directory, "recovery.json"),
      JSON.stringify({ ...r.recovery, files: {} }),
    );
    await expect(recoverTask(task)).rejects.toThrow("必需文件");
  });
  it.each([
    ["00:00:01,000", "00:00:01,000", "ZERO_DURATION"],
    ["00:00:02,000", "00:00:01,000", "REVERSED_INTERVAL"],
    ["-00:00:01,000", "00:00:01,000", "NEGATIVE_TIME"],
    ["NaN", "00:00:01,000", "NONFINITE_OR_UNPARSED_TIME"],
    ["00:00:01,000", "Infinity", "NONFINITE_OR_UNPARSED_TIME"],
    ["00:00:01,000", "00:00:09,000", "OUT_OF_SOURCE_RANGE"],
    ["00:00:01,001", "00:00:01,004", "SERIALIZATION_COLLAPSE"],
  ])("classifies %s --> %s without inventing time", async (s, e, issue) => {
    const { m } = await recoveryFixture();
    const a = classifyRecords(
      rawRecords(`1\n${s} --> ${e}\n文字。`, digest("raw")),
      m,
    );
    expect(a.records[0]?.issues).toContain(issue);
    expect(a.eligible).toHaveLength(0);
  });
  it("BOM/CRLF/CR, repeated text/IDs and multiline preserve order and exact body", async () => {
    const { m } = await recoveryFixture();
    for (const sep of ["\n", "\r\n", "\r"]) {
      const a = classifyRecords(
        rawRecords("\uFEFF" + mixed.replaceAll("\n", sep), digest("raw")),
        m,
      );
      expect(a.records.map((r) => r.order)).toEqual([1, 2, 3]);
      expect(new Set(a.records.map((r) => r.recordId)).size).toBe(3);
      expect(a.records.map((r) => r.displayId)).toEqual(["7", "7", "99"]);
      expect(a.records[0]?.text).toBe(a.records[1]?.text);
      expect(a.records[2]?.text).toBe("次の行。\n続き。");
      expect(a.cues.map((c) => [c.start, c.end])).toEqual([
        [2, 3],
        [5, 6],
      ]);
    }
  });
  it("unknown blocks retained, null time never becomes zero", async () => {
    const { task } = await recoveryFixture(
      "unknown block\nnot a timestamp\n\n" + mixed,
    );
    const r = await recoverTask(task, { exportPartial: true });
    expect(r.recovery.recordCount).toBe(4);
    expect(r.recovery.textExtractionComplete).toBe(false);
    expect(r.recovery.unresolvedIds).toHaveLength(2);
    expect(
      await fs.readFile(path.join(r.directory, "unparsed-blocks.json"), "utf8"),
    ).toContain("unknown block");
  });
  it.each([
    "",
    "1\n00:00:01,000 --> 00:00:01,000\n文字\n",
    "1\n00:00:00,000 --> 00:00:01,000\n\n",
  ])("empty/all invalid never emits empty timed files", async (raw) => {
    const { task } = await recoveryFixture(raw);
    const r = await recoverTask(task, { exportPartial: true });
    expect(r.recovery.partialSubtitle).toBe("no-eligible-records");
    await expect(
      fs.access(path.join(r.directory, "subtitles")),
    ).rejects.toThrow();
    expect(r.exitCode).toBe(2);
  });
  it("default is text only, full accounting, explicit three-format export, stable reuse", async () => {
    const { task } = await recoveryFixture();
    const old = await fileHash(path.join(task, "task.json"));
    const first = await recoverTask(task);
    expect(first.recovery.partialSubtitle).toBe("not-requested");
    await expect(
      fs.access(path.join(first.directory, "subtitles")),
    ).rejects.toThrow();
    const exported = await recoverTask(task, { exportPartial: true });
    expect(exported.recovery.eligibleIds).toHaveLength(2);
    expect(exported.recovery.unresolvedIds).toHaveLength(1);
    expect(exported.recovery.originalArtifactIntegrity).toBe("failed");
    const full = await fs.readFile(
      path.join(first.directory, "transcript.full.txt"),
      "utf8",
    );
    expect(full).toBe("同じ言葉。\n\n同じ言葉。\n\n次の行。\n続き。\n");
    for (const [ext, parser] of Object.entries({
      srt: parseSrt,
      ass: parseAss,
      vtt: parseVtt,
    })) {
      const cues = parser(
        await fs.readFile(
          path.join(
            exported.directory,
            `subtitles/primary-minimal.partial.${ext}`,
          ),
          "utf8",
        ),
      );
      expect(cues.map((c) => c.text)).toEqual([
        "同じ言葉。",
        "次の行。\n続き。",
      ]);
      expect(cues.map((c) => [c.start, c.end])).toEqual([
        [2, 3],
        [5, 6],
      ]);
    }
    const again = await recoverTask(task, { exportPartial: true });
    expect(again.reused).toBe(true);
    expect(again.directory).toBe(exported.directory);
    expect(await fileHash(path.join(task, "task.json"))).toBe(old);
    expect((await recoveryStatus(task)).recoveryViews).toHaveLength(2);
  });
  it("all valid still exports only explicit partial without G11 or merging repetitions", async () => {
    const { task } = await recoveryFixture(
      mixed.replace(
        "00:00:01,000 --> 00:00:01,000",
        "00:00:01,000 --> 00:00:02,000",
      ),
    );
    const r = await recoverTask(task, { exportPartial: true });
    expect(r.recovery.eligibleIds).toHaveLength(3);
    expect(r.recovery.profile).toBe("primary-minimal");
    expect(r.recovery.fullTimedExport).toBe("not-produced");
  });
  it("no model/source needed, resume old task gives recovery view, no process calls", async () => {
    const { task } = await recoveryFixture();
    const old = await fileHash(path.join(task, "task.json"));
    const run = vi.fn(() => {
      throw Error("FORBIDDEN_PROVIDER");
    });
    const m = await runTask(task, { runner: { run }, profile: "g11" });
    expect(m.executionStatus).toBe("partial");
    expect(m.phase).toContain("不会产生新时间");
    expect(run).not.toHaveBeenCalled();
    expect(await fileHash(path.join(task, "task.json"))).toBe(old);
  });
  it("missing/corrupted raw, unsuccessful request, changed task config fail closed", async () => {
    const { task, m } = await recoveryFixture();
    await fs.writeFile(path.join(task, "raw-primary.srt"), "tampered");
    await expect(recoverTask(task)).rejects.toThrow("rawHash");
    await fs.unlink(path.join(task, "raw-primary.srt"));
    await expect(recoverTask(task)).rejects.toThrow();
    await fs.writeFile(path.join(task, "raw-primary.srt"), mixed);
    const attempt = m.attempts[0];
    if (!attempt) throw Error("Missing fixture attempt");
    attempt.state = "running";
    await atomic(path.join(task, "task.json"), m);
    await expect(recoverTask(task)).rejects.toThrow("成功请求");
  });
  it("invalid UTF8 is not silently replaced", async () => {
    const { task, m } = await recoveryFixture();
    await fs.writeFile(
      path.join(task, "raw-primary.srt"),
      Buffer.from([255, 254]),
    );
    m.rawHash = await fileHash(path.join(task, "raw-primary.srt"));
    await atomic(path.join(task, "task.json"), m);
    await expect(recoverTask(task)).rejects.toThrow();
  });
  it("read-only archive supports explicit external output-root", async () => {
    const { task } = await recoveryFixture(),
      other = await recoveryFixture("");
    await fs.chmod(task, 0o500);
    try {
      await expect(recoverTask(task)).rejects.toThrow();
      const r = await recoverTask(task, {
        outputRoot: path.join(other.task, "recovered"),
      });
      expect(r.recovery.recordCount).toBe(3);
    } finally {
      await fs.chmod(task, 0o700);
    }
  });
  it("concurrency rejects second writer; cancellation releases owned staging", async () => {
    const { task } = await recoveryFixture();
    const results = await Promise.allSettled([
      recoverTask(task),
      recoverTask(task),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(
      recoverTask(task, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(
      (await fs.readdir(path.join(task, "recovery"))).some((n) =>
        n.endsWith(".lock"),
      ),
    ).toBe(false);
  });
  it("single format I/O failure retains diagnostics but commits no timed set", async () => {
    const { task } = await recoveryFixture();
    const original = vi.mocked(fs.writeFile).getMockImplementation();
    if (!original) throw Error("Missing mock implementation");
    const mock = vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      if (typeof args[0] === "string" && args[0].endsWith(".partial.vtt"))
        throw Error("SIMULATED_DISK_FAILURE");
      return original(...args);
    });
    try {
      const r = await recoverTask(task, { exportPartial: true });
      expect(r.exitCode).toBe(1);
      expect(r.recovery.partialSubtitle).toBe("failed");
      await expect(
        fs.access(path.join(r.directory, "subtitles")),
      ).rejects.toThrow();
      expect(
        await fs.readFile(
          path.join(r.directory, "transcript.full.txt"),
          "utf8",
        ),
      ).toContain("同じ言葉");
    } finally {
      mock.mockImplementation(original);
    }
  });
  it("symbolic links, tampered output and traversal in manifest fail closed", async () => {
    const { task } = await recoveryFixture();
    const r = await recoverTask(task);
    await fs.writeFile(
      path.join(r.directory, "transcript.full.txt"),
      "user edit",
    );
    await expect(recoverTask(task)).rejects.toThrow("修改");
    const other = await recoveryFixture();
    const raw = path.join(other.task, "raw-primary.srt");
    await fs.rename(raw, raw + ".original");
    await fs.symlink(raw + ".original", raw);
    await expect(recoverTask(other.task)).rejects.toThrow("符号链接");
    expect(
      recoverySchema.safeParse({ ...r.recovery, humanValidated: true }).success,
    ).toBe(false);
  });
  it("partial saved as edited is not full recovery; synthetic timing-only edits can pass", async () => {
    const { task } = await recoveryFixture();
    const r = await recoverTask(task, { exportPartial: true });
    const partial = path.join(
      r.directory,
      "subtitles/primary-minimal.partial.srt",
    );
    const before = await fileHash(partial);
    const negative = await validateEdited(task, partial);
    expect(negative.report.formatIntegrity).toBe("passed");
    expect(negative.report.sourceTextAccounting).toBe(
      "SOURCE_COMPLETENESS_UNPROVEN",
    );
    expect(negative.exitCode).toBe(2);
    const edited = path.join(task, "synthetic-edited.srt");
    await fs.writeFile(
      edited,
      mixed.replace(
        "00:00:01,000 --> 00:00:01,000",
        "00:00:01,000 --> 00:00:02,000",
      ),
    );
    const yes = await validateEdited(task, edited, "audio");
    expect(yes.exitCode).toBe(0);
    expect(yes.report.humanValidated).toBe(false);
    expect(await fileHash(partial)).toBe(before);
    const cues = parseSrt(
      await fs.readFile(
        path.join(yes.directory, "subtitles/subtitle.user-edited.srt"),
        "utf8",
      ),
    );
    expect(cues[0]?.start).toBe(2);
    const source = await validateEdited(
      task,
      path.join(yes.directory, "subtitles/subtitle.user-edited.srt"),
      "source",
    );
    expect(source.exitCode).toBe(0);
  });
  it.each(["ass", "vtt"])(
    "%s edited format supported with explicit representation limits",
    async (ext) => {
      const { task } = await recoveryFixture();
      const r = await recoverTask(task, { exportPartial: true });
      const edit = await validateEdited(
        task,
        path.join(r.directory, `subtitles/primary-minimal.partial.${ext}`),
      );
      expect(edit.report.formatIntegrity).toBe("passed");
      expect(edit.exitCode).toBe(2);
    },
  );
  it("wrong audio timebase is applied once, detected when it exceeds source range", async () => {
    const { task } = await recoveryFixture(
      "1\n00:00:07,000 --> 00:00:08,000\n終わり。\n",
    );
    const r = await recoverTask(task, { exportPartial: true });
    const bad = await validateEdited(
      task,
      path.join(r.directory, "subtitles/primary-minimal.partial.srt"),
      "audio",
    );
    expect(bad.report.formatIntegrity).toBe("failed");
  });
  it("literal punctuation/width/content changes and split/merge stay unproven", async () => {
    const { task } = await recoveryFixture(
      "1\n00:00:00,000 --> 00:00:01,000\nＡ、Ｂ。\n",
    );
    const input = path.join(task, "edited.srt");
    await fs.writeFile(input, "1\n00:00:00,000 --> 00:00:01,000\nAB\n");
    expect((await validateEdited(task, input)).report.contentChange).toBe(
      "USER_CONTENT_CHANGED",
    );
    const source = await readRecoverySource(task);
    expect(source.analysis.records).toHaveLength(1);
  });
});
