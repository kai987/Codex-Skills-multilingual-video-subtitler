/** Post-freeze evaluation only; never imported by planning or generation. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { auditContent } from "./lib/machine-content-audit.mjs";
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

export function referenceSubset(ass, mode) {
  assert(["dialogue", "song", "combined"].includes(mode));
  let events = false,
    fields = null;
  return ass
    .split(/\r?\n/u)
    .map((line) => {
      if (line.startsWith("[")) {
        events = line.trim() === "[Events]";
        fields = null;
      }
      if (!events) return line;
      if (line.startsWith("Format:"))
        fields = line
          .slice(7)
          .split(",")
          .map((s) => s.trim().toLowerCase());
      if (!line.startsWith("Dialogue:")) return line;
      assert(
        fields && fields.at(-1) === "text" && fields.includes("style"),
        "REFERENCE_FORMAT",
      );
      let rest = line.slice(9).trimStart();
      const values = [];
      for (let i = 0; i < fields.length - 1; i++) {
        const comma = rest.indexOf(",");
        assert(comma >= 0, "REFERENCE_ROW");
        values.push(rest.slice(0, comma));
        rest = rest.slice(comma + 1);
      }
      values.push(rest.replace(/\p{S}/gu, ""));
      const index = fields.indexOf("style"),
        style = values[index].trim();
      const accepted =
        mode === "song"
          ? style === "Song"
          : mode === "dialogue"
            ? ["Dialogue", "DialogueTop"].includes(style)
            : ["Dialogue", "DialogueTop", "Song"].includes(style);
      values[index] = accepted ? "Dialogue" : "Excluded";
      return "Dialogue: " + values.join(",");
    })
    .join("\n");
}
export async function evaluateRecovery(root, reference) {
  const integrity = await verifyRecovery(root);
  const freezeHash = await fileHash(path.join(root, "machine-freeze.json"));
  const p = await read(path.join(root, "plan.json")),
    candidate = await read(path.join(root, "candidate.json")),
    decisions = await read(path.join(root, "decisions.json"));
  // First reference access follows immutable candidate verification.
  const referenceHash = await fileHash(reference),
    ass = await fs.readFile(reference, "utf8");
  const compare = (mode, windows) =>
    compareReference({
      referenceAss: referenceSubset(ass, mode),
      baselineRecords: p.baseline,
      candidateRecords: candidate,
      windows,
    });
  const full = [
    { id: "full", kind: "whole-source", start: 0, end: p.duration },
  ];
  const combined = compare("combined", full);
  const dialogue = compare(
    "dialogue",
    p.probes.map((r) => ({
      id: r.id,
      kind: "machine-selected-local-crop",
      start: r.start,
      end: r.end,
    })),
  );
  const song = compare("song", full);
  const report = {
    referenceHash,
    freezeHash,
    integrity,
    evaluationMode: "post-freeze-known-episode-not-independent-holdout",
    combinedFullEpisode: combined,
    dialogueLocalWindows: dialogue,
    songReferenceInventory: song.perWindow[0].reference,
    songScoreMeaning:
      "Not independently scored: full machine text includes dialogue; combined score includes songs",
    decisions,
    baselineAudit: auditContent(p.baseline, {
      language: "ja",
      sourceEnd: p.duration,
    }),
    candidateAudit: auditContent(candidate, {
      language: "ja",
      sourceEnd: p.duration,
    }),
    oldCuesPreserved: p.baseline.every((b) =>
      candidate.some((c) => JSON.stringify(c) === JSON.stringify(b)),
    ),
    humanListeningPerformedThisRound: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    limitations: [
      "First Japanese reference lines only",
      "Reference absence is not silence",
      "Whole cues crossing local windows can bias edit counts",
      "Two Whisper-family backends are not independent acoustic ground truth",
      "No new unseen clips or cross-episode validation in this run",
    ],
  };
  assert.equal(report.oldCuesPreserved, true, "BASELINE_MUTATED");
  assert.equal(await fileHash(reference), referenceHash, "REFERENCE_CHANGED");
  await verifyRecovery(root);
  const out = await fs.mkdtemp(path.join(root, "evaluation-"));
  await fs.writeFile(
    path.join(out, "reference-evaluation.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  const esc = (s) => String(s).replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
  const lines = [
    "# 局部恢复逐项对照",
    "",
    "候选冻结后才读取人工稿；原字幕全部保留。以下识别结果不是已听审的正确答案。",
    "",
    "| Clip | 目标秒数 | 状态 / 原因 | Whisper / Kotoba 目标候选 |",
    "| --- | --- | --- | --- |",
  ];
  for (const d of decisions) {
    const t = p.probes.find((r) => r.id === d.id);
    lines.push(
      `| ${d.id} | ${t.targetStart.toFixed(2)}–${t.targetEnd.toFixed(2)} | ${d.status}: ${d.reason} | ${esc(JSON.stringify(d.donors))} |`,
    );
  }
  lines.push(
    "",
    "## 局部对白参考比较",
    "",
    "整句跨出窗口会影响局部编辑距离，不能把这些值直接当作新增正确句数。",
    "",
  );
  for (const w of dialogue.perWindow)
    lines.push(
      `- ${w.window.id}: 旧编辑距离 ${w.baseline.edit.distance} → 候选 ${w.candidate.edit.distance}。`,
    );
  const overall = combined.perWindow[0];
  lines.push(
    "",
    `全片 Dialogue/DialogueTop + Song 编辑距离：${overall.baseline.edit.distance} → ${overall.candidate.edit.distance}；参考字符 ${overall.baseline.edit.N}。`,
    "",
    "未开展新的人工听审或未见样本验证。没有本轮歌曲恢复；歌曲不单独用整片机器对白计算 CER。needs-review / finalizationMethod=none。",
    "",
  );
  await fs.writeFile(path.join(out, "CHANGES.md"), lines.join("\n"), {
    flag: "wx",
  });
  return {
    output: out,
    oldCuesPreserved: true,
    inserted: integrity.inserted,
    baseline: overall.baseline.edit,
    candidate: overall.candidate.edit,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [root, reference, ...extra] = process.argv.slice(2);
    assert(root && reference && !extra.length, "Usage: RUN_ROOT REFERENCE_ASS");
    console.log(
      JSON.stringify(await evaluateRecovery(root, reference), null, 2),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
