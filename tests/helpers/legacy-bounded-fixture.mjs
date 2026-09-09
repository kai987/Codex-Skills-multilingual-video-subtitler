/* global structuredClone */
import fs from "node:fs/promises";
import path from "node:path";
import {
  durable,
  loadExperiment,
  ledger,
  validateJournal,
} from "../../scripts/lib/bounded-asr-ab.mjs";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import { fileHash } from "../../packages/video-subtitler/dist/standalone/tool.js";
import {
  POLICY,
  mapRaw,
  boundaryDedup,
  serializeRecords,
  formats,
} from "../../packages/video-subtitler/dist/standalone/bounded.js";
const now = () => "synthetic";
const text = (b) => b.toString("utf8");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const locked = async (root, fn) => {
  if (!root.includes("bounded-ab-synthetic-")) throw Error("SYNTHETIC_ONLY");
  return fn();
};
async function group(root, name, records, chunks, m, complete, exportPartial) {
  const dir = path.join(root, name);
  await safePath(dir, true);
  await fs.mkdir(dir, { recursive: true });
  const mapped = structuredClone(records);
  // Probe each candidate through the unchanged product serializer before dedup/accounting.
  for (const r of mapped)
    if (!r.issues.length) {
      try {
        serializeRecords([r], m.language);
      } catch {
        r.issues.push("SERIALIZATION_TEXT_OR_TIMING_LOSS");
      }
    }
  const d = boundaryDedup(mapped, chunks, m.pcm.sampleRate);
  const ordered = [...d.retained].sort(
    (a, b) =>
      a.sourceStart - b.sourceStart ||
      a.chunkIndex - b.chunkIndex ||
      a.order - b.order,
  );
  const textOf = (rs) =>
    rs
      .filter((r) => r.text !== null)
      .map((r) => r.text)
      .join("\n\n") + "\n";
  await durable(path.join(dir, "raw-records.json"), records);
  await fs.writeFile(
    path.join(dir, "transcript.raw.full.txt"),
    textOf(records),
  );
  await fs.writeFile(path.join(dir, "transcript.full.txt"), textOf(records));
  await durable(path.join(dir, "mapped-before-dedup.json"), mapped);
  await durable(path.join(dir, "boundary-decisions.json"), d.decisions);
  await durable(path.join(dir, "assembled-records.json"), ordered);
  await fs.writeFile(
    path.join(dir, "transcript.assembled.txt"),
    textOf(ordered),
  );
  await durable(path.join(dir, "timing-issues.json"), d.unresolved);
  const accounting = mapped.map((r) => ({
    recordId: r.recordId,
    requestId: r.requestId,
    chunkId: r.chunkId,
    disposition: r.issues.length
      ? "unresolved"
      : d.aliases[r.recordId]
        ? "alias"
        : "retained",
    aliasOf: d.aliases[r.recordId] ?? null,
    issues: r.issues,
  }));
  if (
    new Set(accounting.map((r) => r.recordId)).size !== records.length ||
    ordered.length + Object.keys(d.aliases).length + d.unresolved.length !==
      records.length
  )
    throw Error("ACCOUNTING_FAILED");
  const partial = !complete || d.unresolved.length > 0;
  let delivery = ordered.length ? "not-requested" : "no-legal-records",
    exportError = null;
  if (ordered.length && (!partial || exportPartial)) {
    const target = path.join(dir, "subtitles"),
      stage = await fs.mkdtemp(path.join(dir, ".export-"));
    await safePath(target, true);
    try {
      const serialized = serializeRecords(ordered, m.language),
        prefix = `primary-minimal.${partial ? "partial" : "machine-draft"}`;
      for (const [f, value] of Object.entries(serialized.files)) {
        const p = path.join(stage, `${prefix}.${f}`);
        await fs.writeFile(p, value);
        const disk = await fs.readFile(p, "utf8");
        if (disk !== value || formats[f].parse(disk).length !== ordered.length)
          throw Error("DISK_ROUNDTRIP_FAILED");
      }
      try {
        await fs.access(target);
        for (const f of Object.keys(formats))
          if (
            (await fileHash(path.join(target, `${prefix}.${f}`))) !==
            (await fileHash(path.join(stage, `${prefix}.${f}`)))
          )
            throw Error("EXISTING_EXPORT_CHANGED");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        await fs.rename(stage, target);
      }
      delivery = partial ? "partial" : "machine-draft";
    } catch (e) {
      exportError = String(e);
      delivery = "failed";
    }
  }
  await durable(path.join(dir, "export-map.json"), {
    accounting,
    completeRequests: complete,
    partial,
    delivery,
    exportError,
    policy:
      "primary-minimal; unchanged shared serializer; centisecond precision",
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
  });
  const count = (code) => mapped.filter((r) => r.issues.includes(code)).length;
  const repeated = records.filter(
    (r, i) => r.text && records.slice(0, i).some((x) => x.text === r.text),
  ).length;
  const metrics = {
    issueCounts: Object.fromEntries(
      [
        "ZERO_DURATION",
        "REVERSED_INTERVAL",
        "NEGATIVE_TIME",
        "NONFINITE_OR_UNPARSED_TIME",
        "OUT_OF_REQUEST_RANGE",
        "OUT_OF_SOURCE_RANGE",
        "EMPTY_OR_UNPARSED_TEXT",
        "SERIALIZATION_COLLAPSE",
        "SERIALIZATION_TEXT_OR_TIMING_LOSS",
      ].map((code) => [code, count(code)]),
    ),
    rawRecords: records.length,
    parseableCodepoints: records.reduce(
      (n, r) => n + Array.from(r.text ?? "").length,
      0,
    ),
    rawInvalidRecords: records.filter((r) =>
      r.issues.some(
        (c) => !c.startsWith("SERIALIZATION") && c !== "OUT_OF_SOURCE_RANGE",
      ),
    ).length,
    mappedInvalidRecords: records.filter((r) => r.issues.length).length,
    finalInvalidRatio: records.length
      ? d.unresolved.length / records.length
      : null,
    chunkEdgeRiskRecords: records.filter((r) => {
      const c = chunks.find((v) => v.id === r.chunkId);
      return (
        c &&
        r.localStart !== null &&
        r.localEnd !== null &&
        (r.localStart < POLICY.contextSeconds ||
          r.localEnd >
            (c.inputEnd - c.inputStart) / m.pcm.sampleRate -
              POLICY.contextSeconds)
      );
    }).length,
    unresolvedRecords: d.unresolved.length,
    zeroDuration: count("ZERO_DURATION"),
    zeroDurationRatio: records.length
      ? count("ZERO_DURATION") / records.length
      : null,
    outOfRequestRange: count("OUT_OF_REQUEST_RANGE"),
    outOfSourceRange: count("OUT_OF_SOURCE_RANGE"),
    serializationCollapse: count("SERIALIZATION_COLLAPSE"),
    repeatedTextRisk: repeated,
    boundaryAliases: Object.keys(d.aliases).length,
    boundaryAmbiguities: d.decisions.filter(
      (x) => x.status === "BOUNDARY_AMBIGUITY",
    ).length,
    retained: ordered.length,
    recordAccounting: "passed",
    completeRequests: complete,
    delivery,
    exportError,
    contentQuality: "NOT_MEASURED",
    CER: "NOT_MEASURED",
    manualReview: "NOT_PERFORMED",
  };
  await durable(path.join(dir, "metrics.json"), metrics);
  return metrics;
}
export async function legacyFixtureReport(
  manifest,
  { exportPartial = false } = {},
) {
  const reportStarted = Date.now();
  const root = path.dirname(manifest);
  return locked(root, async () => {
    const m = await loadExperiment(manifest); // Offline: do not follow historical model/media paths.
    await safePath(path.join(root, "A/raw-primary.srt"));
    const raw = await fs.readFile(path.join(root, "A/raw-primary.srt"));
    if (
      (await fileHash(path.join(root, "A/raw-primary.srt"))) !==
      m.baseline.raw.sha256
    )
      throw Error("A_COPY_CHANGED");
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
    const aRecords = mapRaw(
      text(raw),
      m.baseline.raw.sha256,
      aChunk,
      m.pcm.sampleRate,
      m.audioOffset,
      m.sourceEnd,
      "A-historical-full",
    );
    const entries = await ledger(root),
      attempts = validateJournal(m, entries),
      records = [];
    let success = 0,
      empty = 0;
    for (const c of m.chunks) {
      const a = attempts.find(
        (v) => v.chunkId === c.id && v.state === "completed",
      );
      if (!a) continue;
      const p = path.join(root, a.rawPath);
      await safePath(p);
      if ((await fileHash(p)) !== a.rawHash) throw Error("B_RAW_CHANGED");
      const value = text(await fs.readFile(p));
      if (!value.trim()) empty++;
      success++;
      records.push(
        ...mapRaw(
          value,
          a.rawHash,
          c,
          m.pcm.sampleRate,
          m.audioOffset,
          m.sourceEnd,
          a.id,
        ),
      );
    }
    const a = await group(
        root,
        "A",
        aRecords,
        [aChunk],
        m,
        true,
        exportPartial,
      ),
      b = await group(
        root,
        "B",
        records,
        m.chunks,
        m,
        success === m.chunks.length,
        exportPartial,
      );
    const comparison = {
      experiment: "Standalone Subtitle Tool — Bounded Long-form ASR A/B",
      baseSha: m.baseSha,
      planHash: m.planHash,
      matchedPrimaryIdentities: true,
      confounds: m.decode.confounds,
      A: a,
      B: {
        ...b,
        planned: m.chunks.length,
        successfulChunks: success,
        emptySuccessfulChunks: empty,
      },
      counts: {
        AHistoricalRequests: 1,
        ANewRequests: 0,
        BRequests: attempts.length,
        BRetries:
          attempts.length - new Set(attempts.map((x) => x.chunkId)).size,
        BRequestedSeconds: attempts.reduce((n, x) => n + x.seconds, 0),
        processDispatches: entries.filter((e) => e.kind === "process-dispatch")
          .length,
        modelLoads: attempts.some((x) => x.modelLoads == null)
          ? "UNKNOWN"
          : attempts.reduce((n, x) => n + x.modelLoads, 0),
        checkpointHits: entries
          .filter((e) => e.kind === "run-finished")
          .reduce((n, x) => n + x.checkpointHits, 0),
        realSileroPasses: 1,
        fullAudioExtractions: 0,
      },
      timing: {
        planning: await json(path.join(root, "planning-cost.json")),
        pcmSliceMs: entries
          .filter((e) => e.kind === "run-finished")
          .reduce((n, e) => n + (e.pcmSliceMs ?? 0), 0),
        offlineAssemblyAndReportMs: Date.now() - reportStarted,
        vadMs: (await json(path.join(root, "vad.json"))).wallMs,
        asrMs: attempts.reduce((n, x) => n + (x.durationMs ?? 0), 0),
        runWallMs: entries
          .filter((e) => e.kind === "run-finished")
          .map((e) => e.wallMs),
        historicalAMs:
          "188675 (historical only, not a repeated speed comparison)",
      },
      sourceInputCoverage:
        success === m.chunks.length
          ? "complete-input-not-proof-of-text-coverage"
          : "incomplete",
      referenceEvaluation: "NOT_MEASURED_NO_AUTHORIZED_MATCHED_FULL_REFERENCE",
      manualReview: "NOT_PERFORMED",
      qualityStatus: "needs-review",
      finalizationMethod: "none",
      humanValidated: false,
      machineOnlyReleaseAuthorized: false,
      productDefaultChanged: false,
    };
    await durable(path.join(root, "comparison.json"), comparison);
    await fs.writeFile(
      path.join(root, "manual-review.csv"),
      "kind,start,end,status\n" +
        m.manualReview
          .map((r) => `${r.kind},${r.start},${r.end},${r.status}`)
          .join("\n") +
        "\n",
    );
    await fs.writeFile(
      path.join(root, "OUTPUT_INDEX.md"),
      `# Bounded Long-form ASR A/B\n\nB successful chunks: ${success}/${m.chunks.length}; A raw records: ${a.rawRecords}; B raw records: ${b.rawRecords}.\n\n[Comparison](comparison.json) · [A full raw text](A/transcript.full.txt) · [B full raw text](B/transcript.raw.full.txt) · [A issues](A/timing-issues.json) · [B issues](B/timing-issues.json) · [Review plan](manual-review.csv)\n\nA delivery: ${a.delivery}; B delivery: ${b.delivery}. See each subtitles directory if generated. All records accounted for in export-map.json; aliases remain in raw evidence.\n\nLOCAL PRIVATE DIAGNOSTICS: actual dialogue and absolute runtime paths, not public shareable. Needs-review, no human validation, no release authority. Default product policy unchanged.\n`,
    );
    const freezeFiles = [
      "comparison.json",
      "A/raw-records.json",
      "B/raw-records.json",
      "B/mapped-before-dedup.json",
      "B/boundary-decisions.json",
      "B/assembled-records.json",
      "A/export-map.json",
      "B/export-map.json",
    ];
    await durable(path.join(root, "results-freeze.json"), {
      at: now(),
      planHash: m.planHash,
      ledgerTail: entries.at(-1)?.hash ?? null,
      files: await Promise.all(
        freezeFiles.map(async (p) => ({
          path: p,
          sha256: await fileHash(path.join(root, p)),
        })),
      ),
      referenceRead: false,
    });
    return comparison;
  });
}
