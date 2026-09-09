/** Offline revision writer. Historical absolute paths are metadata, never read authority. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  loadExperiment,
  ledger,
  validateJournal,
  repo,
} from "./bounded-asr-ab.mjs";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import {
  mapRaw,
  boundaryDedup,
  serializeRecords,
  formats,
} from "../../packages/video-subtitler/dist/standalone/bounded.js";
import {
  timingDiagnostics,
  textRisks,
  timingContract,
  riskPolicy,
  serializedCheck,
  diskTimes,
} from "./bounded-diagnostics.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const bytes = (value) => JSON.stringify(value, null, 2) + "\n";
const identityHash = (value) => hash(bytes(value));
const decode = (value) =>
  new TextDecoder("utf-8", { fatal: true }).decode(value);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const relative = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !path.isAbsolute(p) &&
      !p.split(/[\\/]/u).some((x) => ["..", ".", ""].includes(x)) &&
      !p.includes("\\"),
  );
const entrySchema = z.object({ path: relative, sha256: sha }).strict();
const gate = {
  qualityStatus: "needs-review",
  contentQuality: "NOT_MEASURED",
  acousticCorrectness: "NOT_VERIFIED",
  manualReview: "NOT_PERFORMED",
  finalizationMethod: "none",
  humanValidated: false,
  machineOnlyReleaseAuthorized: false,
  productDefaultChanged: false,
};
const gateSchema = Object.fromEntries(
  Object.entries(gate).map(([k, v]) => [k, z.literal(v)]),
);
export const manifestSchema = z
  .object({
    version: z.literal("bounded-report-revision-v1"),
    identity: sha,
    input: z
      .object({
        manifest: sha,
        plan: sha,
        freeze: sha,
        ledger: sha,
        ledgerTail: sha.nullable(),
        rawCollection: sha,
        evidence: z.array(entrySchema),
      })
      .strict(),
    code: z.array(entrySchema),
    validator: z.literal("bounded-offline-v1"),
    timingContract: z
      .object(
        Object.fromEntries(
          Object.entries(timingContract).map(([k, v]) => [k, z.literal(v)]),
        ),
      )
      .strict(),
    riskPolicy: z
      .object(
        Object.fromEntries(
          Object.entries(riskPolicy).map(([k, v]) => [k, z.literal(v)]),
        ),
      )
      .strict(),
    exportPartial: z.boolean(),
    ...gateSchema,
  })
  .strict();
export const freezeSchema = z
  .object({
    version: z.literal("bounded-results-freeze-v2"),
    identity: sha,
    files: z.array(entrySchema),
    excluded: z.tuple([
      z.literal("results-freeze.v2.json"),
      z.literal("review/"),
    ]),
    ...gateSchema,
  })
  .strict();
export const zeroOperations = Object.freeze(
  Object.fromEntries(
    [
      "newASRRequests",
      "newASRInference",
      "newVADDispatches",
      "newVADInference",
      "newModelLoads",
      "newProviderStarts",
      "newAudioExtractions",
      "newAudioWindows",
      "newAudioPlayback",
      "newReferenceReads",
    ].map((k) => [k, 0]),
  ),
);
export async function checkedPath(p, missing = false) {
  if (p.split(/[\\/]/u).includes("..")) throw Error("PATH_TRAVERSAL");
  await safePath(p, missing);
  return path.resolve(p);
}
async function localRead(root, p) {
  relative.parse(p);
  const target = await checkedPath(path.join(root, p));
  if (!(await fs.lstat(target)).isFile())
    throw Error("REGULAR_EVIDENCE_REQUIRED");
  return fs.readFile(target);
}
const oldFreezePaths = [
  "comparison.json",
  "A/raw-records.json",
  "B/raw-records.json",
  "B/mapped-before-dedup.json",
  "B/boundary-decisions.json",
  "B/assembled-records.json",
  "A/export-map.json",
  "B/export-map.json",
];
export async function readEvidence(manifest) {
  manifest = await checkedPath(manifest);
  const root = path.dirname(manifest),
    evidence = new Map();
  const read = async (p) => {
    const b = await localRead(root, p);
    evidence.set(p, hash(b));
    return b;
  };
  const json = async (p) => JSON.parse(decode(await read(p)));
  // Validate every local dependency before calling the legacy read-only validators.
  await read(path.basename(manifest));
  await read("vad.json");
  await read("requests.jsonl");
  const m = await loadExperiment(manifest),
    entries = await ledger(root),
    attempts = validateJournal(m, entries);
  if (m.sourceEnd !== m.audioOffset + m.pcm.frames / m.pcm.sampleRate)
    throw Error("SAVED_SOURCE_AUTHORITY_INCONSISTENT");
  const freeze = z
    .object({
      at: z.string(),
      planHash: sha,
      ledgerTail: sha.nullable(),
      files: z.array(entrySchema),
      referenceRead: z.literal(false),
    })
    .strict()
    .parse(await json("results-freeze.json"));
  if (
    freeze.planHash !== m.planHash ||
    freeze.ledgerTail !== (entries.at(-1)?.hash ?? null)
  )
    throw Error("OLD_FREEZE_BINDING_FAILED");
  if (
    JSON.stringify(freeze.files.map((x) => x.path).sort()) !==
    JSON.stringify([...oldFreezePaths].sort())
  )
    throw Error("OLD_FREEZE_ALLOWLIST_CHANGED");
  for (const f of freeze.files)
    if (hash(await read(f.path)) !== f.sha256)
      throw Error("OLD_FREEZE_FILE_CHANGED:" + f.path);
  const historical = await json("comparison.json"),
    manual = decode(await read("manual-review.csv"));
  const aChunk = {
    id: "chunk-0001",
    index: 0,
    coreStart: 0,
    coreEnd: m.pcm.frames,
    inputStart: 0,
    inputEnd: m.pcm.frames,
    boundary: "tail",
    candidateSamples: [],
  };
  const aRaw = await read("A/raw-primary.srt");
  if (hash(aRaw) !== m.baseline.raw.sha256) throw Error("A_RAW_CHANGED");
  const A = mapRaw(
      decode(aRaw),
      hash(aRaw),
      aChunk,
      m.pcm.sampleRate,
      m.audioOffset,
      m.sourceEnd,
      "A-historical-full",
    ),
    B = [];
  let successful = 0,
    empty = 0;
  for (const c of m.chunks) {
    const a = attempts.find(
      (x) => x.chunkId === c.id && x.state === "completed",
    );
    if (!a) continue;
    const raw = await read(a.rawPath);
    if (hash(raw) !== a.rawHash) throw Error("B_RAW_CHANGED");
    successful++;
    if (!decode(raw).trim()) empty++;
    B.push(
      ...mapRaw(
        decode(raw),
        a.rawHash,
        c,
        m.pcm.sampleRate,
        m.audioOffset,
        m.sourceEnd,
        a.id,
      ),
    );
  }
  const groups = {};
  for (const [name, records, chunks] of [
    ["A", A, [aChunk]],
    ["B", B, m.chunks],
  ]) {
    if (
      JSON.stringify(records) !==
      JSON.stringify(await json(`${name}/raw-records.json`))
    )
      throw Error("RAW_RECONSTRUCTION_CHANGED:" + name);
    const legacy = records.map((r) => ({ ...r, issues: [...r.issues] }));
    for (const r of legacy)
      if (!r.issues.length) {
        try {
          serializeRecords([r], m.language);
        } catch {
          r.issues.push("SERIALIZATION_TEXT_OR_TIMING_LOSS");
        }
      }
    const d = boundaryDedup(legacy, chunks, m.pcm.sampleRate),
      ordered = sortRecords(d.retained),
      violations = [];
    const oldMap = await json(`${name}/export-map.json`);
    if (
      ordered.length &&
      ["partial", "machine-draft"].includes(oldMap.delivery)
    ) {
      const expected = serializeRecords(ordered, m.language);
      for (const format of Object.keys(formats)) {
        const content = decode(
          await read(
            `${name}/subtitles/primary-minimal.${oldMap.delivery}.${format}`,
          ),
        );
        if (content !== expected.files[format])
          throw Error("OLD_SUBTITLE_BYTES_CHANGED:" + name + ":" + format);
        const actual = diskTimes(format, content);
        actual.forEach((cue, i) => {
          const record = ordered[i],
            chunk = chunks.find((c) => c.id === record.chunkId),
            check = serializedCheck(cue, chunk, m);
          if (check.issues.length)
            violations.push({
              format,
              oldOrdinal: i + 1,
              recordId: record.recordId,
              requestId: record.requestId,
              chunkId: record.chunkId,
              rawStart: record.rawStart,
              rawEnd: record.rawEnd,
              localStart: record.localStart,
              localEnd: record.localEnd,
              mappedStart: record.sourceStart,
              mappedEnd: record.sourceEnd,
              check,
            });
        });
      }
    }
    groups[name] = {
      records,
      chunks,
      complete: name === "A" || successful === m.chunks.length,
      old: {
        retained: ordered.length,
        unresolved: d.unresolved.length,
        aliases: Object.keys(d.aliases).length,
        boundaryPairs: d.decisions.length,
        boundaryDecisions: d.decisions,
        violations,
      },
    };
  }
  const fingerprints = [...evidence]
    .map(([path, sha256]) => ({ path, sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    m,
    root,
    groups,
    historical,
    manual,
    successful,
    empty,
    input: {
      manifest: evidence.get(path.basename(manifest)),
      plan: m.planHash,
      freeze: evidence.get("results-freeze.json"),
      ledger: evidence.get("requests.jsonl"),
      ledgerTail: entries.at(-1)?.hash ?? null,
      rawCollection: identityHash(
        fingerprints.filter(
          (x) => x.path.endsWith(".srt") && !x.path.includes("/subtitles/"),
        ),
      ),
      evidence: fingerprints,
    },
  };
}
const sortRecords = (rs) =>
  [...rs].sort(
    (a, b) =>
      a.sourceStart - b.sourceStart ||
      a.chunkIndex - b.chunkIndex ||
      a.order - b.order,
  );
function stageCounts(timing, key) {
  const tags = {};
  for (const t of timing)
    for (const code of t[key]) tags[code] = (tags[code] ?? 0) + 1;
  return {
    tags,
    issueCount: Object.values(tags).reduce((a, b) => a + b, 0),
    recordCount: timing.filter((t) => t[key].length).length,
  };
}
export function analyzeGroup(group, m) {
  const { records, chunks, complete } = group;
  const timing = records.map((r) =>
    timingDiagnostics(
      r,
      chunks.find((c) => c.id === r.chunkId),
      m,
    ),
  );
  const risks = records.map((r, i) => textRisks(r, timing[i]));
  const candidates = records.map((r, i) => ({
    ...r,
    issues: [
      ...timing[i].rawIssues,
      ...timing[i].mappedIssues,
      ...timing[i].serializedIssues,
    ],
  }));
  const d = boundaryDedup(candidates, chunks, m.pcm.sampleRate),
    retained = sortRecords(d.retained);
  const accounting = candidates.map((r, i) => ({
    recordId: r.recordId,
    requestId: r.requestId,
    chunkId: r.chunkId,
    geometry: timing[i].geometry,
    disposition: r.issues.length
      ? "unresolved"
      : d.aliases[r.recordId]
        ? "alias"
        : "retained",
    aliasOf: d.aliases[r.recordId] ?? null,
    issues: r.issues,
    outputOrdinal:
      retained.findIndex((x) => x.recordId === r.recordId) + 1 || null,
  }));
  if (
    new Set(accounting.map((x) => x.recordId)).size !== records.length ||
    retained.length + d.unresolved.length + Object.keys(d.aliases).length !==
      records.length ||
    Object.values(d.aliases).some(
      (id) => !retained.some((r) => r.recordId === id),
    )
  )
    throw Error("ACCOUNTING_FAILED");
  const seen = new Map(),
    duplicates = [];
  records.forEach((r) => {
    if (r.text) {
      if (seen.has(r.text))
        duplicates.push({
          recordId: r.recordId,
          firstRecordId: seen.get(r.text),
        });
      else seen.set(r.text, r.recordId);
    }
  });
  const stages = {
    raw: stageCounts(timing, "rawIssues"),
    mapped: stageCounts(timing, "mappedIssues"),
    serialized: stageCounts(timing, "serializedIssues"),
  };
  const metrics = {
    rawRecords: records.length,
    parseableCodepoints: risks.reduce((n, r) => n + r.codepoints, 0),
    repeatedTextRisk: duplicates.length,
    stages,
    unionInvalidRecords: d.unresolved.length,
    retained: retained.length,
    unresolvedRecords: d.unresolved.length,
    boundaryAliases: Object.keys(d.aliases).length,
    boundaryPairs: d.decisions.length,
    recordAccounting: "passed",
    completeRequests: complete,
    fullTimedExport:
      complete && records.length > 0 && !d.unresolved.length
        ? "available"
        : "blocked",
    subtitleExport: "not-requested",
    partial: "not-requested",
    ...gate,
  };
  return {
    timing,
    risks,
    duplicates,
    retained,
    accounting,
    decisions: d.decisions,
    metrics,
  };
}
async function listMachine(root, prefix = "") {
  const out = [];
  for (const e of await fs.readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (p === "review" || p === "results-freeze.v2.json") continue;
    if (e.isSymbolicLink()) throw Error("REVISION_SYMLINK");
    if (e.isDirectory()) out.push(...(await listMachine(root, p)));
    else if (e.isFile())
      out.push({ path: p, sha256: hash(await localRead(root, p)) });
    else throw Error("REVISION_NONREGULAR");
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
export async function verifyRevision(root, identity) {
  await checkedPath(root);
  const frozen = freezeSchema.parse(
    JSON.parse(decode(await localRead(root, "results-freeze.v2.json"))),
  );
  const m = manifestSchema.parse(
    JSON.parse(decode(await localRead(root, "report-manifest.json"))),
  );
  if (
    frozen.identity !== identity ||
    m.identity !== identity ||
    identityHash({ ...m, identity: undefined }) !== identity
  )
    throw Error("REVISION_IDENTITY_CONFLICT");
  if (JSON.stringify(await listMachine(root)) !== JSON.stringify(frozen.files))
    throw Error("REVISION_CONTENT_CONFLICT");
  return JSON.parse(decode(await localRead(root, "comparison.json")));
}
async function reviewState(root) {
  try {
    const raw = decode(await localRead(root, "review/review-results.csv"));
    const rows = raw.trimEnd().split("\n");
    const plan = JSON.parse(decode(await localRead(root, "review-plan.json")));
    const initial =
      rows[0] === "reviewId,kind,start,end,status,notes" &&
      rows.length === plan.items.length + 1 &&
      rows
        .slice(1)
        .every(
          (s, i) =>
            s ===
            `${plan.items[i].reviewId},${plan.items[i].kind},${plan.items[i].start},${plan.items[i].end},NOT_PERFORMED,`,
        );
    return {
      bytesPreserved: true,
      status: initial
        ? "INITIAL_NOT_PERFORMED"
        : "USER_EDITED_OR_INVALID_PRESERVED_NOT_INTERPRETED",
      sha256: hash(raw),
    };
  } catch (e) {
    return {
      bytesPreserved: true,
      status: "UNREADABLE_OR_MISSING_NOT_RECREATED",
      reason: String(e),
    };
  }
}
export async function reportRevision(
  manifest,
  { outputRoot, exportPartial = false, signal, writeFile = fs.writeFile } = {},
) {
  if (!outputRoot)
    throw Error(
      'MIGRATION_REQUIRED: npm run experiment:subtitle-tool:bounded-asr-ab -- report --manifest "<original-run>/experiment.json" --output-root "<new-diagnostics>" [--export-partial]',
    );
  const start = Date.now(),
    inputPath = await checkedPath(manifest),
    inputRoot = path.dirname(inputPath),
    out = await checkedPath(outputRoot, true);
  if (
    out === inputRoot ||
    out.startsWith(inputRoot + path.sep) ||
    inputRoot.startsWith(out + path.sep)
  )
    throw Error("OUTPUT_MUST_BE_DISJOINT_FROM_INPUT");
  const e = await readEvidence(inputPath);
  const sourceFiles = [
    "scripts/lib/bounded-diagnostics.mjs",
    "scripts/lib/bounded-report-revision.mjs",
    "scripts/lib/bounded-asr-ab.mjs",
    "scripts/subtitle-tool-bounded-asr-ab.mjs",
    "packages/video-subtitler/dist/standalone/bounded.js",
    "packages/video-subtitler/dist/standalone/recovery.js",
    "packages/video-subtitler/dist/standalone/assembly.js",
    "packages/subtitle-core/dist/parse.js",
    "packages/subtitle-core/dist/format.js",
    "packages/subtitle-core/dist/time.js",
    "packages/shared/dist/schemas.js",
  ];
  const code = [];
  for (const p of sourceFiles)
    code.push({ path: p, sha256: hash(await localRead(repo, p)) });
  const base = {
    version: "bounded-report-revision-v1",
    input: e.input,
    code,
    validator: "bounded-offline-v1",
    timingContract,
    riskPolicy,
    exportPartial,
    ...gate,
  };
  const id = identityHash(base),
    revision = path.join(out, `report-${id}`),
    m = manifestSchema.parse({ ...base, identity: id });
  await fs.mkdir(out, { recursive: true });
  await checkedPath(out);
  const lockPath = path.join(out, `.lock-${id}`),
    lock = await fs.open(lockPath, "wx");
  let stage;
  try {
    let exists = false;
    try {
      await fs.lstat(revision);
      exists = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (exists) {
      const result = await verifyRevision(revision, id);
      return {
        ...result,
        revision,
        reused: true,
        currentReview: await reviewState(revision),
      };
    }
    stage = await fs.mkdtemp(path.join(out, `.building-${id}-`));
    const write = async (p, value) => {
      signal?.throwIfAborted();
      relative.parse(p);
      const dest = path.join(stage, p);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, typeof value === "string" ? value : bytes(value), {
        flag: "wx",
      });
    };
    await write("report-manifest.json", m);
    const comparison = {
      version: "bounded-offline-comparison-v1",
      historical: e.historical,
      sourceAuthority: {
        pcm: e.m.pcm,
        audioOffset: e.m.audioOffset,
        sourceEnd: e.m.sourceEnd,
        precision:
          "saved manifest JSON; PCM integer frames independently bound by original plan",
        originalEnvironmentRevalidated: false,
        savedEvidenceIntegrity: "passed",
      },
      operations: zeroOperations,
      ...gate,
    };
    for (const name of ["A", "B"]) {
      const g = e.groups[name],
        a = analyzeGroup(g, e.m);
      await write(`${name}/raw-records.json`, g.records);
      await write(
        `${name}/transcript.raw.full.txt`,
        g.records
          .filter((r) => r.text !== null)
          .map((r) => r.text)
          .join("\n\n") + "\n",
      );
      await write(`${name}/timing-diagnostics.json`, a.timing);
      await write(`${name}/text-risk-diagnostics.json`, {
        policy: riskPolicy,
        duplicates: a.duplicates,
        records: a.risks,
      });
      await write(`${name}/legacy-validation.json`, g.old);
      await write(`${name}/boundary-decisions.json`, a.decisions);
      if (exportPartial && a.retained.length) {
        const serialized = serializeRecords(a.retained, e.m.language);
        for (const [format, value] of Object.entries(serialized.files))
          await write(
            `${name}/subtitles/primary-minimal.partial.${format}`,
            value,
          );
        const actual = {};
        for (const format of Object.keys(formats))
          actual[format] = decode(
            await localRead(
              stage,
              `${name}/subtitles/primary-minimal.partial.${format}`,
            ),
          );
        const { validateDiskFormats } =
          await import("./bounded-diagnostics.mjs");
        a.metrics.diskValidation = validateDiskFormats(
          actual,
          a.retained,
          g.chunks,
          e.m,
        );
        a.metrics.subtitleExport = "STRICT_PARTIAL_EXPORT_VALIDATED";
        a.metrics.partial = "generated";
      } else if (exportPartial) {
        a.metrics.subtitleExport = "no-legal-records";
        a.metrics.partial = "not-generated";
      }
      await write(`${name}/export-map.json`, {
        accounting: a.accounting,
        completeRequests: g.complete,
        fullTimedExport: a.metrics.fullTimedExport,
        subtitleExport: a.metrics.subtitleExport,
        ...gate,
      });
      comparison[name] = {
        ...a.metrics,
        oldPopulation: {
          retained: g.old.retained,
          unresolved: g.old.unresolved,
          aliases: g.old.aliases,
          boundaryPairs: g.old.boundaryPairs,
        },
        ...(name === "B"
          ? {
              planned: e.m.chunks.length,
              successfulChunks: e.successful,
              emptySuccessfulChunks: e.empty,
            }
          : {}),
      };
    }
    comparison.offlineElapsedMs = Date.now() - start;
    comparison.exitCode = [comparison.A, comparison.B].some(
      (g) => g.fullTimedExport === "blocked",
    )
      ? 2
      : 0;
    await write("comparison.json", comparison);
    const cohort = identityHash({
      plan: e.input.plan,
      freeze: e.input.freeze,
      raw: e.input.rawCollection,
    });
    const items = e.m.manualReview.map((r, i) => ({
      ...r,
      reviewId: `review-${identityHash({ cohort, index: i, item: r }).slice(0, 24)}`,
    }));
    await write("review-plan.json", {
      version: "original-full-raw-review-plan-v1",
      cohort,
      planHash: e.input.plan,
      resultsFreezeHash: e.input.freeze,
      rawCollectionHash: e.input.rawCollection,
      evaluationTarget:
        "original frozen A/B full raw evidence; new partial is auxiliary only",
      items,
      ...gate,
    });
    const template =
      "reviewId,kind,start,end,status,notes\n" +
      items
        .map(
          (r) => `${r.reviewId},${r.kind},${r.start},${r.end},NOT_PERFORMED,`,
        )
        .join("\n") +
      "\n";
    await write("review-template.csv", template);
    await write("review/review-results.csv", template);
    await write("historical-manual-review.csv", e.manual);
    await write(
      "OUTPUT_INDEX.md",
      "# PRIVATE LOCAL evidence revision\n\n[Comparison](comparison.json) · [Identity](report-manifest.json) · [Original full-raw review plan](review-plan.json) · [Editable results](review/review-results.csv)\n\n[A raw text](A/transcript.raw.full.txt) · [B raw text](B/transcript.raw.full.txt) · [B timing](B/timing-diagnostics.json) · [B risks](B/text-risk-diagnostics.json) · [Old boundary violations](B/legacy-validation.json) · [Accounting](B/export-map.json)\n\nNew subtitles exist only with explicit --export-partial. Strict partial legality is not text recovery or acoustic quality approval. All raw records and text remain. No inference/audio/reference operation. Historical costs are not new operations. The human CSV is mutable and excluded from the one-time machine freeze; it never grants release authority.\n",
    );
    const freeze = freezeSchema.parse({
      version: "bounded-results-freeze-v2",
      identity: id,
      files: await listMachine(stage),
      excluded: ["results-freeze.v2.json", "review/"],
      ...gate,
    });
    await write("results-freeze.v2.json", freeze);
    await verifyRevision(stage, id);
    signal?.throwIfAborted();
    for (const input of e.input.evidence)
      if (hash(await localRead(e.root, input.path)) !== input.sha256)
        throw Error("SOURCE_CHANGED_DURING_REPORT");
    // Files and directories are flushed before publishing the complete triple together.
    for (const file of [
      ...freeze.files,
      { path: "results-freeze.v2.json" },
      { path: "review/review-results.csv" },
    ]) {
      const h = await fs.open(path.join(stage, file.path), "r");
      try {
        await h.sync();
      } finally {
        await h.close();
      }
    }
    await fs.rename(stage, revision);
    const h = await fs.open(out, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
    return {
      ...comparison,
      revision,
      reused: false,
      currentReview: await reviewState(revision),
    };
  } catch (error) {
    if (stage) {
      await fs.writeFile(
        path.join(out, `failure-${id}-${randomUUID()}.json`),
        bytes({
          status: "TECHNICAL_FAILURE_NOT_PUBLISHED",
          error: String(error),
          stagingDirectory: path.basename(stage),
          operations: zeroOperations,
        }),
        { flag: "wx" },
      );
    }
    throw error;
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}
