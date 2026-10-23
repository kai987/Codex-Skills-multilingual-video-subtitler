/** Read-only VAD evidence triage. Never dispatches inference or writes subtitles. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { verifyListeningVad } from "./subtitle-tool-listening-vad.mjs";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, value) =>
  fs.writeFile(p, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
export const triagePolicy = Object.freeze({
  version: "target-vad-triage-v1",
  supportedThreshold: 0.5,
  scope: "review-order-only",
  unsupportedMeaning: "no-target-overlap-not-confirmed-nonspeech",
  partialMeaning: "positive-overlap-below-threshold-not-rejected",
  automaticFilteringAuthorized: false,
  subtitleMutationAuthorized: false,
  inferenceAuthorized: false,
});
const states = ["supported", "partial", "unsupported"];
const actions = {
  supported: "review-text-and-utterance-role",
  partial: "review-target-boundary-and-context",
  unsupported: "retain-for-lower-priority-listening-not-delete",
};

export function buildVadTriage(run) {
  assert.equal(
    run.policy.targetCoverageThreshold,
    triagePolicy.supportedThreshold,
    "THRESHOLD_CHANGED",
  );
  assert.equal(run.policy.subtitleMutationAuthorized, false, "MUTATION_POLICY");
  const items = run.plan.items;
  assert(Array.isArray(items) && items.length > 0, "EMPTY_PLAN");
  assert.equal(run.observations.length, items.length, "CASE_COUNT");
  const observations = new Map();
  for (const o of run.observations) {
    assert(!observations.has(o.id), "DUPLICATE_OBSERVATION");
    observations.set(o.id, o);
  }
  const ids = new Set();
  const rows = items.map((item, sourceIndex) => {
    assert(/^clip-\d+$/u.test(item.id) && !ids.has(item.id), "INVALID_PLAN_ID");
    ids.add(item.id);
    const o = observations.get(item.id);
    assert(o, "MISSING_OBSERVATION");
    assert.equal(o.cohort, item.cohort, "COHORT_MISMATCH");
    const fraction = o.targetCoverageFraction;
    assert(
      Number.isFinite(fraction) && fraction >= 0 && fraction <= 1,
      "INVALID_COVERAGE",
    );
    assert.equal(o.targetSupported, fraction >= 0.5, "SUPPORT_MISMATCH");
    assert.equal(o.anyTargetOverlap, fraction > 0, "OVERLAP_MISMATCH");
    assert.equal(typeof o.clipHasDetection, "boolean", "MISSING_DETECTION");
    assert(!o.anyTargetOverlap || o.clipHasDetection, "DETECTION_MISMATCH");
    assert.equal(o.subtitleMutationAuthorized, false, "MUTATION_AUTHORIZATION");
    assert(
      [item.start, item.end, item.localTargetStart, item.localTargetEnd].every(
        Number.isFinite,
      ),
      "INVALID_TIME",
    );
    assert(
      item.start >= 0 &&
        item.end > item.start &&
        item.localTargetStart >= 0 &&
        item.localTargetEnd > item.localTargetStart &&
        item.localTargetEnd <= item.end - item.start + 1e-8,
      "INVALID_TARGET",
    );
    const state =
      fraction >= 0.5 ? "supported" : fraction > 0 ? "partial" : "unsupported";
    return {
      id: item.id,
      cohort: item.cohort,
      sourceIndex,
      state,
      reviewPriority: states.indexOf(state),
      suggestedAction: actions[state],
      retained: true,
      targetCoverageFraction: fraction,
      contextOnlyDetection: o.clipHasDetection && !o.anyTargetOverlap,
      targetStart: item.start + item.localTargetStart,
      targetEnd: item.start + item.localTargetEnd,
      playbackStart: item.start,
      playbackEnd: item.end,
      speechTruth: "unknown",
      utteranceRelation: "unknown",
      subtitleInclusion: "undecided",
    };
  });
  return {
    policy: triagePolicy,
    rows,
    counts: Object.fromEntries(
      states.map((s) => [s, rows.filter((r) => r.state === s).length]),
    ),
    reviewOrder: [...rows]
      .sort(
        (a, b) =>
          a.reviewPriority - b.reviewPriority || a.sourceIndex - b.sourceIndex,
      )
      .map((r) => r.id),
    inputCount: items.length,
    retainedCount: rows.length,
    droppedCount: 0,
    labelsRead: false,
    referenceRead: false,
    validationScope: "existing-clips-regression-not-independent-holdout",
    newModelLoads: 0,
    newVadRequests: 0,
    newAsrRequests: 0,
    subtitleMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}

function render(report) {
  const names = {
    supported: "充分支持",
    partial: "部分支持",
    unsupported: "未支持",
  };
  const clock = (s) =>
    `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  return [
    "# VAD 三态复核清单",
    "",
    "仅调整核对顺序，全部候选保留。50% 是覆盖规则，不是语音正确概率。未支持不等于没有语音；部分支持不算原二态规则的阳性。不能据此补字、改时间或判断语气词是否应出字幕。",
    "",
    `充分支持 ${report.counts.supported}；部分支持 ${report.counts.partial}；未支持 ${report.counts.unsupported}；保留 ${report.retainedCount}/${report.inputCount}，删除 0。`,
    "",
    "## 按复核优先级排列（时间为源音频全局时间）",
    "",
    "| Clip | 状态 | 目标时间 | 播放范围 | 目标覆盖 | 仅上下文检出 |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...report.reviewOrder.map((id) => {
      const r = report.rows.find((r) => r.id === id);
      return `| ${id} | ${names[r.state]} | ${clock(r.targetStart)}–${clock(r.targetEnd)} | ${clock(r.playbackStart)}–${clock(r.playbackEnd)} | ${(r.targetCoverageFraction * 100).toFixed(1)}% | ${r.contextOnlyDetection ? "是" : "否"} |`;
    }),
    "",
    "复用已见片段做离线回归，不是新片段验证。此过程不读取标签，但不代表原听审标签是盲标。字幕未变，needs-review / finalizationMethod=none。尚未接入默认生成，不触发任何模型。",
    "",
  ].join("\n");
}

export async function replayVadTriage(sourceRoot, outputParent) {
  sourceRoot = path.resolve(sourceRoot);
  outputParent = path.resolve(outputParent);
  await safePath(outputParent, true);
  const run = await verifyListeningVad(sourceRoot);
  for (const input of [sourceRoot, path.resolve(run.plan.listeningRoot)])
    assert(
      outputParent !== input && !outputParent.startsWith(input + path.sep),
      "OUTPUT_INSIDE_INPUT",
    );
  const report = buildVadTriage(run);
  const sourceFreezeHash = hash(
    await fs.readFile(path.join(sourceRoot, "machine-freeze.json")),
  );
  await fs.mkdir(outputParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputParent, "vad-triage-"));
  await put(path.join(root, "triage.json"), report);
  await fs.writeFile(path.join(root, "TRIAGE.md"), render(report), {
    flag: "wx",
  });
  await put(path.join(root, "triage-freeze.json"), {
    version: "vad-triage-freeze-v1",
    sourceRoot,
    sourceFreezeHash,
    softwareHash: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    files: {
      "triage.json": hash(await fs.readFile(path.join(root, "triage.json"))),
      "TRIAGE.md": hash(await fs.readFile(path.join(root, "TRIAGE.md"))),
    },
  });
  return {
    root,
    counts: report.counts,
    retained: report.retainedCount,
    newInference: 0,
  };
}

export async function verifyVadTriage(root) {
  await safePath(root);
  const f = await read(path.join(root, "triage-freeze.json"));
  assert.equal(f.version, "vad-triage-freeze-v1", "FREEZE_VERSION");
  assert.deepEqual(
    Object.keys(f.files).sort(),
    ["TRIAGE.md", "triage.json"],
    "FILE_INVENTORY",
  );
  assert.equal(
    hash(await fs.readFile(fileURLToPath(import.meta.url))),
    f.softwareHash,
    "SOFTWARE_CHANGED",
  );
  for (const [name, expected] of Object.entries(f.files)) {
    await safePath(path.join(root, name));
    assert.equal(
      hash(await fs.readFile(path.join(root, name))),
      expected,
      "TRIAGE_CHANGED",
    );
  }
  assert.equal(
    hash(await fs.readFile(path.join(f.sourceRoot, "machine-freeze.json"))),
    f.sourceFreezeHash,
    "SOURCE_FREEZE_CHANGED",
  );
  const replay = buildVadTriage(await verifyListeningVad(f.sourceRoot));
  assert.deepEqual(
    await read(path.join(root, "triage.json")),
    replay,
    "TRIAGE_REPLAY_MISMATCH",
  );
  assert.equal(
    await fs.readFile(path.join(root, "TRIAGE.md"), "utf8"),
    render(replay),
    "REPORT_REPLAY_MISMATCH",
  );
  return {
    integrity: "passed",
    counts: replay.counts,
    retained: replay.retainedCount,
    newInference: 0,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "replay" && args.length === 2)
      console.log(JSON.stringify(await replayVadTriage(...args), null, 2));
    else if (mode === "verify" && args.length === 1)
      console.log(JSON.stringify(await verifyVadTriage(args[0]), null, 2));
    else
      throw Error(
        "Usage: replay FROZEN_VAD_ROOT NEW_OUTPUT_PARENT | verify TRIAGE_ROOT",
      );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
