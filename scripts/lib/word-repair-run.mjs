/** Frozen evidence -> development benchmark -> explicit local review. No model calls. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { seriesLanguageMemorySchema } from "@mvl/shared";
import { hash, identity } from "./content-review-plan.mjs";
import { fileHash, readJson } from "./local-asr-run.mjs";
import { durable, readPcm, slicePcm } from "./bounded-asr-ab.mjs";
import { parseReference } from "./historical-reference-text.mjs";
import {
  formatProjection,
  validateProjection,
} from "./representation-grid.mjs";
import { bindReviewCandidates } from "../../packages/video-subtitler/dist/review-action-validation.js";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import { saveActionSnapshot } from "./review-action-store.mjs";
import {
  completeUnits,
  proposeWords,
  proposePriorWords,
  memoryHints,
  sideEvidence,
  applyActions,
  distance,
  wordPolicy,
  resolutionSchema,
} from "./word-repair.mjs";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const prepareSchema = z
  .object({
    comparison: z.string().min(1),
    comparisonFreezeHash: sha,
    baseline: z.string().min(1),
    baselineHash: sha,
    audio: z.string().min(1),
    audioHash: sha,
    reference: z.string().min(1),
    referenceHash: sha,
    memory: z.string().min(1),
    memoryHash: sha,
    output: z.string().min(1),
    count: z.number().int().min(2).max(30),
    expectedSeriesKey: z.string().min(1),
  })
  .strict();
export const actionFileSchema = z
  .object({
    workspaceHash: sha,
    reviewVersion: z.number().int().positive(),
    actions: z.array(resolutionSchema).max(2000),
  })
  .strict();
async function bound(p, expected) {
  await safePath(p);
  if ((await fs.lstat(p)).isSymbolicLink()) throw Error("SYMLINK_INPUT");
  const b = await fs.readFile(p);
  if (hash(b) !== expected)
    throw Error("INPUT_HASH_MISMATCH: " + path.basename(p));
  return b;
}
const decode = (b) => JSON.parse(b.toString("utf8"));
export async function prepareReview(value) {
  const config = prepareSchema.parse(value);
  const freeze = decode(
    await bound(
      path.join(config.comparison, "result-freeze.json"),
      config.comparisonFreezeHash,
    ),
  );
  const evidenceFiles = [
    "plan.json",
    "results.json",
    "ctc-request-05/raw.json",
    "ctc-request-06/raw.json",
  ];
  const readEvidence = async (rel) => {
    const p = path.join(config.comparison, rel),
      row = freeze.files.find((r) => r.path === p);
    if (!row) throw Error("UNBOUND_EVIDENCE");
    return decode(await bound(p, row.sha256));
  };
  const [plan, results, ctc1, ctc2] = await Promise.all(
    evidenceFiles.map(readEvidence),
  );
  const parentFreeze = decode(
    await bound(plan.parentFreeze.path, plan.parentFreeze.sha256),
  );
  const parentPlanRow = parentFreeze.files.find((f) => f.path === "plan.json");
  if (
    !parentPlanRow ||
    path.resolve(config.baseline) !==
      path.join(plan.parent, "baseline-records.json") ||
    parentFreeze.files.find((f) => f.path === "baseline-records.json")
      ?.sha256 !== config.baselineHash
  )
    throw Error("PARENT_BASELINE_BINDING");
  const parentPlan = decode(
    await bound(path.join(plan.parent, "plan.json"), parentPlanRow.sha256),
  );
  // Every consumed model text is backed by the frozen raw response, not a loose result summary.
  for (const r of results.rows) {
    const row = freeze.files.find(
      (f) => f.path === path.join(config.comparison, r.id, "raw.json"),
    );
    if (!row || row.sha256 !== r.rawHash) throw Error("RAW_BINDING");
    await bound(row.path, row.sha256);
  }
  const baseline = decode(await bound(config.baseline, config.baselineHash));
  const reference = parseReference(
    await bound(config.reference, config.referenceHash),
  );
  if (reference.records.some((r) => r.parseStatus !== "PARSED"))
    throw Error("REFERENCE_PARSE_INCOMPLETE");
  const memory = seriesLanguageMemorySchema.parse(
    decode(await bound(config.memory, config.memoryHash)),
  );
  if (
    memory.seriesIdentity.seriesKey !== config.expectedSeriesKey ||
    memory.seriesIdentity.identityStatus !== "verified"
  )
    throw Error("SERIES_IDENTITY_MISMATCH");
  const pcm = readPcm(await bound(config.audio, config.audioHash));
  const sourceEnd = pcm.frames / pcm.sampleRate;
  const benchmark = completeUnits(
    baseline,
    reference.records,
    config.count,
    plan.requests.map((r) => ({
      start: r.start,
      end: r.start + r.samples / pcm.sampleRate,
    })),
  );
  if (benchmark.units.some((u) => u.end > sourceEnd))
    throw Error("UNIT_OUTSIDE_SOURCE");
  await fs.mkdir(config.output, { recursive: true });
  const root = await fs.mkdtemp(path.join(config.output, "word-repair-"));
  await fs.mkdir(path.join(root, "audio"));
  await durable(path.join(root, "source-bindings.private.json"), config, true);
  // This freeze precedes proposals. It is development/reference-assisted, never blind gold.
  await durable(
    path.join(root, "benchmark.json"),
    {
      ...benchmark,
      createdAt: new Date().toISOString(),
      referenceRole: "historical-human-reviewed-development-reference",
      referenceAcousticallyReverified: false,
    },
    true,
  );
  const benchmarkHash = await fileHash(path.join(root, "benchmark.json"));
  await durable(
    path.join(root, "benchmark-freeze.json"),
    {
      benchmarkHash,
      createdAt: new Date().toISOString(),
      candidateGenerationStarted: false,
    },
    true,
  );
  const alternates = results.rows
    .filter((r) => r.mode !== "ctc")
    .map((r) => {
      const request = plan.requests.find((p) => p.id === r.id);
      if (!request) throw Error("REQUEST_BINDING");
      const target = parentPlan.targets.find((t) => t.id === request.targetId);
      if (!target) throw Error("TARGET_BINDING");
      return {
        id: r.id,
        text: r.text,
        start: r.start,
        end: r.start + request.samples / pcm.sampleRate,
        rawHash: r.rawHash,
        mode: r.mode,
        targetCueIds: target.baselineIds,
      };
    });
  const units = [];
  let items = [];
  for (const u of benchmark.units) {
    const startSample = Math.max(0, Math.floor((u.start - 1) * pcm.sampleRate)),
      endSample = Math.min(pcm.frames, Math.ceil((u.end + 1) * pcm.sampleRate));
    const audio = "audio/" + u.id + ".wav",
      bytes = slicePcm(pcm, startSample, endSample);
    await fs.writeFile(path.join(root, audio), bytes, { flag: "wx" });
    const timing = plan.requests.some(
      (r) =>
        r.mode === "ctc" &&
        r.start < u.end &&
        r.start + r.samples / pcm.sampleRate > u.start,
    )
      ? {
          targetText: ctc1.target.targetText,
          start: sideEvidence([ctc1, ctc2], "start"),
          end: sideEvidence([ctc1, ctc2], "end"),
        }
      : null;
    units.push({
      ...u,
      audio,
      audioHash: hash(bytes),
      audioStart: startSample / pcm.sampleRate,
      audioEnd: endSample / pcm.sampleRate,
      timing,
    });
    for (const recordId of u.baselineIds.length
      ? u.baselineIds
      : ["missing-" + u.id]) {
      const record = baseline.find((r) => r.recordId === recordId);
      items.push({
        reviewId: "review-" + recordId,
        unitId: u.id,
        targetCueIds: [recordId],
        interval: { start: u.start, end: u.end },
        candidateSuggestions: record
          ? [
              ...proposeWords(record, alternates, memory),
              ...proposePriorWords(record, memory),
            ]
          : [],
        hints: record ? memoryHints(record, memory) : [],
        allowedHumanActions: [
          "KEEP",
          "EDIT_TEXT",
          "EDIT_TIMING",
          "MARK_UNRESOLVED",
          ...(record ? ["ACCEPT_SUGGESTION"] : []),
        ],
      });
    }
  }
  items = bindReviewCandidates({
    items,
    inputEvidenceHash: config.comparisonFreezeHash,
    reviewVersion: 1,
  });
  const workspace = {
    schemaVersion: 1,
    reviewVersion: 1,
    createdAt: new Date().toISOString(),
    policy: wordPolicy,
    benchmarkHash,
    baseline,
    units,
    items,
    sourceEnd,
    alternates,
    priorVocabulary: memory.entries
      .filter((e) => e.status === "active")
      .map((e) => ({
        entryId: e.entryId,
        surface: e.canonicalSurface,
        reading: e.readingHiragana,
        trust: e.trustLevel,
        eligibility: e.applicationEligibility,
      })),
    qualityStatus: "needs-review",
    automaticMutations: 0,
    newInferenceCount: 0,
    referenceAssistedDevelopment: true,
    referenceIsValidatedGold: false,
  };
  await durable(path.join(root, "workspace.json"), workspace, true);
  const assets = [
    "workspace.json",
    "benchmark.json",
    "benchmark-freeze.json",
    ...units.map((u) => u.audio),
  ];
  await durable(
    path.join(root, "workspace-freeze.json"),
    {
      createdAt: new Date().toISOString(),
      files: await Promise.all(
        assets.map(async (p) => ({
          path: p,
          sha256: await fileHash(path.join(root, p)),
        })),
      ),
    },
    true,
  );
  await durable(
    path.join(root, "actions.json"),
    { workspaceHash: identity(workspace), reviewVersion: 1, actions: [] },
    true,
  );
  await exportReview(root);
  return {
    root,
    unitCount: units.length,
    itemCount: items.length,
    candidates: items.reduce((n, i) => n + i.candidateSuggestions.length, 0),
    newInferenceCount: 0,
  };
}
export async function loadReview(root) {
  await safePath(root);
  const freeze = await readJson(path.join(root, "workspace-freeze.json"));
  const paths = freeze.files.map((f) => f.path);
  if (
    new Set(paths).size !== paths.length ||
    ["workspace.json", "benchmark.json", "benchmark-freeze.json"].some(
      (p) => !paths.includes(p),
    )
  )
    throw Error("INCOMPLETE_OR_DUPLICATE_FREEZE");
  for (const f of freeze.files) {
    if (
      !/^(workspace\.json|benchmark\.json|benchmark-freeze\.json|audio\/unit-[a-f0-9]+\.wav)$/u.test(
        f.path,
      )
    )
      throw Error("INVALID_ASSET_PATH");
    await bound(path.join(root, f.path), f.sha256);
  }
  const w = await readJson(path.join(root, "workspace.json"));
  if ((await fileHash(path.join(root, "benchmark.json"))) !== w.benchmarkHash)
    throw Error("BENCHMARK_BINDING");
  return w;
}
export function validateActionFile(workspace, value) {
  const a = actionFileSchema.parse(value);
  if (
    a.workspaceHash !== identity(workspace) ||
    a.reviewVersion !== workspace.reviewVersion
  )
    throw Error("STALE_WORKSPACE");
  applyActions(workspace, a.actions);
  return a;
}
export async function saveActions(root, value) {
  const w = await loadReview(root);
  const a = validateActionFile(w, value);
  return saveActionSnapshot(root, a);
}
export function evaluateReview(w, records) {
  const rows = w.units.map((u) => {
    const current = records
      .filter((r) => u.baselineIds.includes(r.recordId) || r.unitId === u.id)
      .sort(
        (a, b) =>
          a.sourceStart - b.sourceStart || a.recordId.localeCompare(b.recordId),
      );
    const text = current.map((r) => r.text).join("");
    const d = distance(u.referenceText, text);
    return {
      unitId: u.id,
      category: u.category,
      beforeDistance: u.referenceDistance,
      afterDistance: d,
      improved: d < u.referenceDistance,
      regressed: d > u.referenceDistance,
      exactTextMatch: d === 0,
    };
  });
  return {
    scope:
      "24-or-configured complete development subtitle groups; whitespace-only text edit distance",
    referenceIsValidatedGold: false,
    timingAcousticallyValidated: false,
    improved: rows.filter((r) => r.improved).length,
    regressed: rows.filter((r) => r.regressed).length,
    unchanged: rows.filter((r) => !r.improved && !r.regressed).length,
    rows,
  };
}
export async function exportReview(root) {
  const w = await loadReview(root),
    a = validateActionFile(w, await readJson(path.join(root, "actions.json"))),
    result = applyActions(w, a.actions);
  if (result.incompleteInsertions.length)
    throw Error("INCOMPLETE_INSERTION_SAVE_TEXT_AND_TIME_FIRST");
  const contents = formatProjection(result.records, "ja");
  await fs.mkdir(path.join(root, "exports"), { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, "exports", "candidate-"));
  for (const [format, text] of Object.entries(contents))
    await fs.writeFile(
      path.join(dir, "subtitle.review-candidate." + format),
      text,
      { flag: "wx" },
    );
  const disk = Object.fromEntries(
    await Promise.all(
      Object.keys(contents).map(async (f) => [
        f,
        await fs.readFile(
          path.join(dir, "subtitle.review-candidate." + f),
          "utf8",
        ),
      ]),
    ),
  );
  validateProjection(disk, result.records);
  await durable(
    path.join(dir, "changes.json"),
    {
      ...result,
      actionsHash: identity(a),
      workspaceHash: identity(w),
      reviewCompletionNotCertified: true,
    },
    true,
  );
  await durable(
    path.join(dir, "evaluation.json"),
    evaluateReview(w, result.records),
    true,
  );
  await durable(
    path.join(dir, "export-manifest.json"),
    {
      status: "needs-review",
      finalizationMethod: "none",
      actionsHash: identity(a),
      workspaceHash: identity(w),
      files: await Promise.all(
        [
          "subtitle.review-candidate.ass",
          "subtitle.review-candidate.srt",
          "subtitle.review-candidate.vtt",
          "changes.json",
          "evaluation.json",
        ].map(async (p) => ({
          path: p,
          sha256: await fileHash(path.join(dir, p)),
        })),
      ),
    },
    true,
  );
  return {
    directory: dir,
    changes: result.changes.length,
    evaluation: evaluateReview(w, result.records),
    status: "needs-review",
  };
}
