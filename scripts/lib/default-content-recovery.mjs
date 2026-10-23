/** Fresh bounded generation only. Raw checkpoints remain immutable. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  mapRaw,
  serializeRecords,
  formats,
} from "../../packages/video-subtitler/dist/standalone/bounded.js";
import { fileHash } from "../../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import { durable, slicePcm } from "./bounded-asr-ab.mjs";
import { contentSafety } from "./content-safety-gate.mjs";
import {
  pcmEvidence,
  assessReplacement,
  auditAudioSupport,
} from "./recovery-evidence-guard.mjs";

export const CONTENT_RECOVERY_POLICY = Object.freeze({
  version: "default-content-recovery-v2",
  maxTargets: 4,
  maxRequests: 8,
  maxAudioSeconds: 120,
  maxRequestSeconds: 15,
  rounds: 1,
  technicalRetries: 0,
  promotion: "independent-machine-candidate-only-after-recheck",
});
const retryable = new Set([
  "SENTENCE_DECODER_LOOP",
  "REQUEST_SENTENCE_LOW_DIVERSITY",
  "SHORT_TOKEN_DECODER_LOOP",
  "REQUEST_LOW_DIVERSITY",
  "SINGLE_CHARACTER_DECODER_LOOP",
  "EMBEDDED_KANA_DECODER_RUN",
  "TEMPLATE_PHRASE_REQUIRES_AUDIO",
  "REPEATED_LONG_SPAN",
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safetyRows = (records) =>
  records.map((r) => ({
    ...r,
    id: r.recordId,
    start: r.sourceStart ?? NaN,
    end: r.sourceEnd ?? NaN,
    text: r.text ?? r.rawBlock,
  }));

/** Status can inspect evidence without source/model access or restarting a round. */
export async function readContentRecovery(task) {
  const root = path.join(task, "default-content-recovery");
  const manifest = path.join(root, "recovery.json");
  try {
    await fs.access(root);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  await safePath(root);
  await safePath(manifest);
  let freeze;
  try {
    await safePath(path.join(root, "freeze.json"));
    freeze = JSON.parse(
      await fs.readFile(path.join(root, "freeze.json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return {
      status: "unfinished-hold",
      manifest,
      newASRRequests: 0,
      qualityStatus: "needs-review",
      reason: "No frozen recovery result; no automatic retry",
    };
  }
  if (!freeze.files?.["recovery.json"])
    throw Error("CONTENT_RECOVERY_FREEZE_INVALID");
  for (const [name, expected] of Object.entries(freeze.files)) {
    if (name !== path.basename(name))
      throw Error("CONTENT_RECOVERY_UNSAFE_PATH");
    await safePath(path.join(root, name));
    if ((await fileHash(path.join(root, name))) !== expected)
      throw Error("CONTENT_RECOVERY_EVIDENCE_CHANGED");
  }
  const result = JSON.parse(await fs.readFile(manifest, "utf8"));
  if (
    result.planHash !==
      (await fileHash(path.join(task, "bounded-plan.json"))) ||
    result.baselineRecordsHash !==
      (await fileHash(path.join(task, "mapped-records.json")))
  )
    throw Error("CONTENT_RECOVERY_BASELINE_CHANGED");
  for (const file of result.outputs)
    if (path.dirname(file) !== root || !freeze.files[path.basename(file)])
      throw Error("CONTENT_RECOVERY_OUTPUT_UNBOUND");
  return { ...result, root, manifest, newASRRequests: 0 };
}

/** Reserve before dispatch; no resume API exists and each chunk is considered once. */
export async function createContentRecovery(task, plan, pcm, options) {
  const root = path.join(task, "default-content-recovery");
  await fs.mkdir(root); // exclusive: never grant another budget to the same task
  const state = {
    version: CONTENT_RECOVERY_POLICY.version,
    policy: CONTENT_RECOVERY_POLICY,
    planHash: await fileHash(path.join(task, "bounded-plan.json")),
    audioHash: plan.audioHash,
    enabled: options.enabled !== false,
    status: "running",
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    acousticCorrectness: "NOT_VERIFIED",
    machineOnlyReleaseAuthorized: false,
    requests: [],
    targets: [],
    checks: [],
    reservedRequests: 0,
    reservedAudioSeconds: 0,
    outputs: [],
    files: {},
  };
  const persist = () => durable(path.join(root, "recovery.json"), state);
  const put = async (name, value) => {
    const bytes =
      typeof value === "string" || value instanceof Uint8Array
        ? value
        : JSON.stringify(value, null, 2) + "\n";
    await fs.writeFile(path.join(root, name), bytes, { flag: "wx" });
    state.files[name] = hash(bytes);
  };
  const originals = new Map();
  const replacements = new Map();
  const considered = new Set();
  const inspect = (records) =>
    contentSafety(safetyRows(records), { language: plan.config.language });
  await persist();

  async function recover(chunkId, riskCodes) {
    considered.add(chunkId);
    const chunk = plan.chunks.find((c) => c.id === chunkId);
    const seconds = (chunk.inputEnd - chunk.inputStart) / plan.sampleRate;
    const target = {
      chunkId,
      riskCodes,
      status: "pending",
      requests: [],
      replacementRecordIds: [],
    };
    state.targets.push(target);
    if (!state.enabled) {
      target.status = "disabled";
      await persist();
      return;
    }
    if (
      state.reservedRequests + 2 > CONTENT_RECOVERY_POLICY.maxRequests ||
      state.reservedAudioSeconds + seconds >
        CONTENT_RECOVERY_POLICY.maxAudioSeconds ||
      state.targets.filter((t) => t.requests.length).length >=
        CONTENT_RECOVERY_POLICY.maxTargets
    ) {
      target.status = "deferred-budget";
      await persist();
      return;
    }
    // Cover exactly the original request, in two shorter independent requests.
    // No text-derived timing or truncation and no recursive retries of donors.
    const mid = Math.floor((chunk.inputStart + chunk.inputEnd) / 2);
    const windows = [
      [chunk.inputStart, mid],
      [mid, chunk.inputEnd],
    ];
    if (
      windows.some(
        ([s, e]) =>
          e <= s ||
          (e - s) / plan.sampleRate > CONTENT_RECOVERY_POLICY.maxRequestSeconds,
      )
    )
      throw Error("CONTENT_RECOVERY_INVALID_WINDOW");
    const reservation = windows.map(([start, end], index) => ({
      id: `${chunkId}-recovery-${index + 1}`,
      start,
      end,
      seconds: (end - start) / plan.sampleRate,
      state: "reserved",
      sourceStart: plan.effectiveRange.start + start / plan.sampleRate,
      sourceEnd: plan.effectiveRange.start + end / plan.sampleRate,
    }));
    state.requests.push(...reservation);
    target.requests = reservation.map((r) => r.id);
    state.reservedRequests += reservation.length;
    state.reservedAudioSeconds += seconds;
    await persist();
    options.progress?.(
      `${chunkId} 内容异常：一次局部纠错轮次，2 个短请求；原始证据保留。`,
    );
    const candidate = [];
    try {
      for (const request of reservation) {
        options.signal?.throwIfAborted();
        const audio = `${request.id}.wav`;
        await put(
          audio,
          slicePcm(
            pcm,
            plan.firstFrame + request.start,
            plan.firstFrame + request.end,
          ),
        );
        const acoustic = pcmEvidence(
          pcm,
          plan.firstFrame + request.start,
          plan.firstFrame + request.end,
        );
        await put(`${request.id}.audio-evidence.json`, {
          ...acoustic,
          audioHash: state.files[audio],
        });
        if (acoustic.allSamplesExactlyZero) {
          request.state = "skipped-digital-zero";
          await persist();
          continue;
        }
        const prefix = path.join(root, request.id);
        const args = [
          "--model",
          plan.config.model,
          "--file",
          path.join(root, audio),
          "--language",
          plan.config.language,
          "--threads",
          String(plan.config.threads),
          "--output-srt",
          ...(plan.rawJson ? ["--output-json-full"] : []),
          "--output-file",
          prefix,
          "--suppress-nst",
          "--no-prints",
        ];
        await put(`${request.id}.request.json`, {
          ...request,
          inputHash: state.files[audio],
          planHash: state.planHash,
          runtime: plan.identities.runtime,
          model: plan.identities.model,
          executable: plan.config.runtime,
          args,
        });
        request.state = "running";
        await persist();
        const result = await options.runner.run(plan.config.runtime, args, {
          timeoutMs: 300000,
          cwd: root,
        });
        await put(`${request.id}.exit.json`, result);
        if (result.exitCode !== 0 || result.signal)
          throw Error("CONTENT_RECOVERY_PROCESS_FAILED");
        const bytes = await fs.readFile(prefix + ".srt");
        await put(`${request.id}.raw.srt`, bytes);
        if (plan.rawJson) {
          try {
            await put(
              `${request.id}.raw.json`,
              await fs.readFile(prefix + ".json"),
            );
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
        }
        request.state = "completed";
        await persist();
        const rows = mapRaw(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          hash(bytes),
          { ...chunk, inputStart: request.start, inputEnd: request.end },
          plan.sampleRate,
          plan.effectiveRange.start,
          plan.duration,
          request.id,
        );
        await put(`${request.id}.mapped.json`, rows);
        if (!rows.length || rows.some((r) => r.issues.length))
          throw Error("CONTENT_RECOVERY_INVALID_OR_EMPTY_RESPONSE");
        candidate.push(...rows);
      }
      target.recheck = inspect(candidate);
      const original = originals.get(chunkId) ?? [];
      target.regression = assessReplacement(
        original,
        candidate,
        pcm,
        plan,
        inspect(original),
      );
      await put(`${chunkId}.candidate-records.json`, candidate);
      await put(`${chunkId}.regression.json`, target.regression);
      if (candidate.length) serializeRecords(candidate, plan.config.language);
      if (target.recheck.status === "HOLD") target.status = "no-gain-hold";
      else if (target.regression.status === "HOLD")
        target.status = "regression-hold";
      else {
        replacements.set(chunkId, candidate);
        target.replacementRecordIds = candidate.map((r) => r.recordId);
        target.status = "candidate";
      }
    } catch (error) {
      target.status = options.signal?.aborted ? "cancelled" : "failed-hold";
      target.error = String(error);
      for (const r of reservation) {
        if (r.state === "running")
          r.state = options.signal?.aborted ? "cancelled" : "failed";
        else if (r.state === "reserved") r.state = "not-started";
      }
      if (options.signal?.aborted) {
        state.status = "cancelled";
        await persist();
        throw error;
      }
    }
    await persist();
  }

  return {
    async onChunk(records) {
      options.signal?.throwIfAborted();
      const chunkId = records.chunkId;
      originals.set(chunkId, records.rows);
      // Include previous chunks so repetition cannot hide across chunk seams.
      const all = [...originals.values()].flat();
      const check = inspect(all);
      state.checks.push({
        afterChunk: chunkId,
        status: check.status,
        issues: check.issues,
      });
      await persist();
      const ids = new Map();
      for (const issue of check.issues.filter((i) => retryable.has(i.code)))
        for (const index of issue.cueIndexes) {
          const id = all[index].chunkId;
          if (!considered.has(id)) {
            if (!ids.has(id)) ids.set(id, new Set());
            ids.get(id).add(issue.code);
          }
        }
      for (const [id, codes] of ids) await recover(id, [...codes]);
    },
    async finish(base) {
      options.signal?.throwIfAborted();
      // Recheck immutable originals and every recorded retry artifact before assembly.
      for (const [name, expected] of Object.entries(state.files))
        if ((await fileHash(path.join(root, name))) !== expected)
          throw Error("CONTENT_RECOVERY_EVIDENCE_CHANGED");
      const mapped = JSON.parse(
        await fs.readFile(base.recordsPath, "utf8"),
      ).records;
      state.baselineRecordsHash = await fileHash(base.recordsPath);
      const candidate = plan.chunks.flatMap(
        (c) =>
          replacements.get(c.id) ?? mapped.filter((r) => r.chunkId === c.id),
      );
      state.before = inspect(mapped);
      state.after = inspect(candidate);
      state.audioSupport = auditAudioSupport(candidate, pcm, plan);
      state.changedChunks = [...replacements.keys()];
      state.status =
        state.before.status === "HOLD" || state.audioSupport.status === "HOLD"
          ? "needs-review"
          : "no-detected-risk";
      if (replacements.size) {
        try {
          if (candidate.some((r) => r.issues.length) || !candidate.length)
            throw Error("CONTENT_RECOVERY_UNRESOLVED_TIMING");
          const serialized = serializeRecords(candidate, plan.config.language);
          await put("candidate-records.json", candidate);
          for (const [ext, value] of Object.entries(serialized.files)) {
            const name = `content-recovered.needs-review.${ext}`;
            await put(name, value);
            const roundtrip = formats[ext].parse(
              await fs.readFile(path.join(root, name), "utf8"),
            );
            if (
              roundtrip.length !== serialized.cues.length ||
              roundtrip.some(
                (r, i) =>
                  r.text !== serialized.cues[i].text ||
                  r.start !== serialized.cues[i].start ||
                  r.end !== serialized.cues[i].end,
              )
            )
              throw Error("CONTENT_RECOVERY_ROUNDTRIP_FAILED");
            state.outputs.push(path.join(root, name));
          }
          const unresolved = state.targets.some(
            (t) => t.status !== "candidate",
          );
          if (
            !unresolved &&
            state.after.status === "NO_DETECTED_HIGH_RISK" &&
            state.audioSupport.status !== "HOLD" &&
            base.executionStatus === "completed"
          )
            state.status = "recovered-machine-draft";
        } catch (error) {
          state.status = "needs-review";
          state.error = String(error);
          state.outputs = []; // never advertise incomplete/failed serialization
        }
      }
      state.startedRequests = state.requests.filter(
        (r) =>
          !["reserved", "not-started", "skipped-digital-zero"].includes(
            r.state,
          ),
      ).length;
      state.originalEvidenceUnchanged = true;
      await persist();
      await durable(
        path.join(root, "freeze.json"),
        {
          files: {
            ...state.files,
            "recovery.json": await fileHash(path.join(root, "recovery.json")),
          },
        },
        true,
      );
      return { ...state, root, manifest: path.join(root, "recovery.json") };
    },
  };
}
