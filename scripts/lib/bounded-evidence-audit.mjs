/** Stored checkpoints (including PCM hashes) only; no providers or external media/model access. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { statusBounded } from "./bounded-product.mjs";
import { mapRaw } from "../../packages/video-subtitler/dist/standalone/bounded.js";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import { digest } from "../../packages/video-subtitler/dist/standalone/assembly.js";
import { analyzeStoredTokens } from "./stored-token-evidence.mjs";
import { analyzeSeamEvidence } from "./bounded-seam-evidence.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sum = (requests, field) =>
  requests.reduce((n, r) => n + (r.summary?.[field] ?? 0), 0);

export async function auditBoundedEvidence(task, { outputRoot }) {
  // Only normalize known macOS system aliases; reject user checkpoint symlinks.
  task = path.resolve(task);
  if (process.platform === "darwin") {
    for (const prefix of ["/var", "/tmp"]) {
      if (task.startsWith(prefix + path.sep))
        task = path.join(await fs.realpath(prefix), task.slice(prefix.length));
    }
  }
  await safePath(task);
  const manifestPath = path.join(task, "bounded-task.json");
  await safePath(manifestPath);
  const manifestHash = hash(await fs.readFile(manifestPath));
  const m = await statusBounded(task),
    p = m.plan;
  if (hash(await fs.readFile(manifestPath)) !== manifestHash)
    throw Error("TASK_CHANGED_DURING_EVIDENCE_AUDIT");
  if (!["completed", "partial"].includes(m.executionStatus))
    throw Error("SETTLED_BOUNDED_TASK_REQUIRED");
  const root = path.resolve(outputRoot);
  const relative = path.relative(task, root);
  if (
    !relative ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw Error("EVIDENCE_AUDIT_REQUIRES_SEPARATE_OUTPUT_ROOT");
  const inputs = {};
  async function read(name, asJson = true) {
    if (
      !m.files[name] ||
      path.isAbsolute(name) ||
      name.split(/[\\/]/u).includes("..")
    )
      throw Error(`UNREGISTERED_EVIDENCE:${name}`);
    const filename = path.join(task, name);
    await safePath(filename);
    const bytes = await fs.readFile(filename);
    if (hash(bytes) !== m.files[name]) throw Error(`EVIDENCE_CHANGED:${name}`);
    inputs[name] = m.files[name];
    return asJson ? JSON.parse(bytes.toString("utf8")) : bytes.toString("utf8");
  }
  const mapped = await read("mapped-records.json");
  const boundary = await read("boundary-decisions.json");
  if (digest(mapped.effectiveRange) !== digest(p.effectiveRange))
    throw Error("EVIDENCE_RANGE_MISMATCH");
  const requests = [];
  const reconstructed = [];
  for (const attempt of m.attempts.filter((a) => a.state === "completed")) {
    const dir = `requests/${attempt.id}`;
    if (attempt.rawPath !== `${dir}/raw-response.srt`)
      throw Error("UNEXPECTED_RAW_RESPONSE_PATH");
    const request = await read(`${dir}/request.json`);
    const chunk = p.chunks.find((c) => c.id === attempt.chunkId);
    const sourceOffset =
      p.effectiveRange.start + chunk.inputStart / p.sampleRate;
    if (
      request.id !== attempt.id ||
      request.planHash !== m.planHash ||
      digest(request.chunk) !== digest(chunk) ||
      Math.abs(request.sourceOffset - sourceOffset) > 1e-6 ||
      !Number.isFinite(request.sourceOffset) ||
      request.inputHash !== m.files[`${dir}/input.wav`] ||
      request.executable !== p.identities.runtime.path ||
      !Array.isArray(request.args)
    )
      throw Error(`REQUEST_BINDING_MISMATCH:${attempt.id}`);
    const argument = (key) => {
      if (request.args.filter((a) => a === key).length !== 1)
        throw Error(`REQUEST_FLAG_BINDING_MISMATCH:${key}`);
      return request.args[request.args.indexOf(key) + 1];
    };
    if (
      !request.args.includes("--model") ||
      argument("--model") !== p.identities.model.path ||
      !request.args.includes("--language") ||
      argument("--language") !== p.config.language
    )
      throw Error(`REQUEST_CONFIG_MISMATCH:${attempt.id}`);
    const input = argument("--file"),
      output = argument("--output-file");
    if (
      typeof input !== "string" ||
      typeof output !== "string" ||
      !path.isAbsolute(input) ||
      !input.endsWith(`/${dir}/input.wav`) ||
      output !== path.join(path.dirname(input), "response")
    )
      throw Error(`REQUEST_IO_BINDING_MISMATCH:${attempt.id}`);
    const records = mapRaw(
      await read(attempt.rawPath, false),
      attempt.rawHash,
      chunk,
      p.sampleRate,
      p.effectiveRange.start,
      p.duration,
      attempt.id,
    );
    reconstructed.push(...records);
    const rawJsonPath = `${dir}/raw-response.json`;
    if (!m.files[rawJsonPath]) {
      const exists = await fs.lstat(path.join(task, rawJsonPath)).then(
        () => true,
        (error) => {
          if (error.code !== "ENOENT") throw error;
          return false;
        },
      );
      if (exists) throw Error(`UNREGISTERED_EVIDENCE:${rawJsonPath}`);
      requests.push({
        requestId: attempt.id,
        requestIssues: ["STORED_JSON_UNAVAILABLE"],
        rows: [],
        canAutoRetime: false,
      });
      continue;
    }
    requests.push(
      analyzeStoredTokens({
        response: await read(rawJsonPath),
        records,
        request: {
          requestId: attempt.id,
          sourceOffset,
          duration: (chunk.inputEnd - chunk.inputStart) / p.sampleRate,
          language: p.config.language,
          args: request.args,
          bindingValidated: true,
          sourceHash: p.identities.input.sha256,
          modelHash: p.identities.model.sha256,
          runtimeHash: p.identities.runtime.sha256,
          rawResponseHash: m.files[rawJsonPath],
        },
      }),
    );
  }
  const mapping = (records) =>
    records.map((r) =>
      Object.fromEntries(
        [
          "recordId",
          "requestId",
          "chunkId",
          "chunkIndex",
          "text",
          "localStart",
          "localEnd",
          "sourceStart",
          "sourceEnd",
        ].map((key) => [key, r[key]]),
      ),
    );
  if (
    !Array.isArray(mapped.records) ||
    digest(mapping(reconstructed)) !== digest(mapping(mapped.records))
  )
    throw Error("RAW_MAPPED_RECORD_BINDING_MISMATCH");
  const seam = analyzeSeamEvidence({
    records: mapped.records,
    decisions: boundary.decisions,
    tokenEvidence: requests.flatMap((r) => r.rows),
    sourceOffset: p.effectiveRange.start,
  });
  const fields = [
    "segments",
    "jsonTokenItems",
    "textTokenItems",
    "controlItems",
    "unknownItems",
    "positiveTextItems",
    "zeroDurationTextItems",
    "reversedTextItems",
    "outOfSegmentTextItems",
    "dtwUnavailableItems",
    "nonpositiveTextSegments",
    "dominantFirstTokenSegments",
  ];
  const artifact = {
    version: "bounded-stored-evidence-audit-v1",
    binding: {
      planHash: m.planHash,
      manifestHash,
      sourceHash: p.identities.input.sha256,
      modelHash: p.identities.model.sha256,
      runtimeHash: p.identities.runtime.sha256,
      effectiveRange: p.effectiveRange,
      inputFiles: inputs,
    },
    requests,
    seam,
    summary: {
      requestCount: requests.length,
      ...Object.fromEntries(fields.map((key) => [key, sum(requests, key)])),
      ...seam.summary,
    },
    legacyDecodeDeclaration: p.decode,
    interpretation:
      "Segment export and runtime token computation are different. JSON token times and probabilities do not establish acoustic correctness.",
    referenceUsed: false,
    newASRRequests: 0,
    modelLoads: 0,
    textMutations: 0,
    timingMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    canAutoRetime: false,
    machineOnlyReleaseAuthorized: false,
  };
  // Detect concurrent checkpoint changes before delivery, not just before reading.
  const after = await statusBounded(task);
  if (
    digest(after.files) !== digest(m.files) ||
    digest(after.attempts) !== digest(m.attempts) ||
    hash(await fs.readFile(manifestPath)) !== manifestHash
  )
    throw Error("TASK_CHANGED_DURING_EVIDENCE_AUDIT");
  const bytes = JSON.stringify(artifact, null, 2) + "\n",
    sha256 = hash(bytes);
  const directory = path.join(root, `stored-evidence-${sha256.slice(0, 20)}`);
  await safePath(directory, true);
  await fs.mkdir(directory, { recursive: true });
  await safePath(directory);
  const report = path.join(directory, "stored-evidence.json");
  const index = path.join(directory, "STORED_EVIDENCE.md");
  const markdown = [
    "# Stored timestamp and seam evidence — diagnostic only",
    "",
    `Requests: ${requests.length}; segments: ${artifact.summary.segments}; JSON token items: ${artifact.summary.jsonTokenItems}.`,
    `Text-token items: ${artifact.summary.textTokenItems}; zero-duration: ${artifact.summary.zeroDurationTextItems}; reversed: ${artifact.summary.reversedTextItems}.`,
    `Seam pairs: ${seam.summary.pairCount}; proposed repairs: ${seam.summary.proposedRepairCount}.`,
    "",
    "No inference, external source-media/model access, reference reading, subtitle mutation, or automatic repair. Stored PCM checkpoint hashes are verified.",
    "Hash/binding validity is not acoustic timing validity. DTW unavailable does not mean ordinary token timestamps were disabled.",
    "The legacy timestamp=segment declaration describes exported cue timing only. Full JSON can include heuristic token timestamps and merged UTF-8 token items.",
    "Long first tokens are review warnings, not permission to move starts. Similar dialogue is not proof of the same speech occurrence.",
    "Status: needs-review; finalizationMethod=none.",
    "",
    "Details: [stored-evidence.json](stored-evidence.json)",
    "",
    `SHA-256: ${sha256}`,
    "",
  ].join("\n");
  for (const [filename, content] of [
    [report, bytes],
    [index, markdown],
  ]) {
    await safePath(filename, true);
    try {
      await fs.writeFile(filename, content, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await safePath(filename);
      if ((await fs.readFile(filename, "utf8")) !== content)
        throw Error("EVIDENCE_AUDIT_ARTIFACT_CHANGED", { cause: error });
    }
  }
  return {
    directory,
    report,
    index,
    sha256,
    summary: artifact.summary,
    newASRRequests: 0,
    qualityStatus: "needs-review",
  };
}
