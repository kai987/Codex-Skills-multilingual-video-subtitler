/** Offline experimental entry. Reads explicitly supplied frozen artifacts only. */
import fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import { z } from "zod";
import { hash, identity, json } from "./content-review-plan.mjs";
import {
  read,
  readJson,
  write,
  separate,
  publish,
  codeIdentity,
} from "./bounded-content-review.mjs";
import {
  checkedPath,
  verifyRevision,
  analyzeGroup,
} from "./bounded-report-revision.mjs";
import { verifyReferenceBundle } from "./historical-reference-review.mjs";
import {
  parseReference,
  fullComparison,
  referenceFlags,
} from "./historical-reference-text.mjs";
import {
  projectionPolicy,
  projectRecord,
  formatProjection,
  validateProjection,
} from "./representation-grid.mjs";
import {
  localizationPolicy,
  localize,
  deliverableComparison,
} from "./missing-dialogue-localization.mjs";
import { csvCell } from "./content-review-input.mjs";

export const recoveryGates = Object.freeze({
  qualityStatus: "needs-review",
  humanValidated: false,
  CER: "NOT_MEASURED",
  referenceIsValidatedGold: false,
  machineOnlyReleaseAuthorized: false,
  productDefaultChanged: false,
  finalizationMethod: "none",
  LOCAL_ASR_EXECUTED: false,
  FULL_TIMED_EXPORT: "blocked",
});
const gateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(recoveryGates).map(([k, v]) => [k, z.literal(v)]),
    ),
  )
  .strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const relative = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !path.isAbsolute(p) &&
      !p.includes("\\") &&
      !p.split("/").some((s) => ["", ".", ".."].includes(s)),
  );
const entry = z.object({ path: relative, sha256: sha }).strict();
const payloadSchema = z
  .object({
    version: z.literal("bounded-representation-recovery-v1"),
    inputs: z.array(entry),
    code: z.array(entry),
    exportRecoveredSubtitles: z.literal(true),
    projection: z.literal(projectionPolicy.version),
    localization: z.literal(localizationPolicy.version),
  })
  .strict();
export const recoveryManifestSchema = z
  .object({
    identity: sha,
    payload: payloadSchema,
    gates: gateSchema,
    statuses: z.tuple([
      z.literal("REPRESENTATION_RECOVERY_READY"),
      z.literal("MISSING_DIALOGUE_LOCALIZATION_READY"),
      z.literal("LOCAL_ASR_PLAN_READY"),
    ]),
    stats: z
      .object({
        rawRecords: z.number().int(),
        strictRetained: z.number().int(),
        serializedOnlyCandidates: z.number().int(),
        recovered: z.number().int(),
        unrecoveredCandidates: z.number().int(),
        retained: z.number().int(),
        aliases: z.number().int(),
        unresolved: z.number().int(),
        rawInvalid: z.number().int(),
        maxEdgeFromMappedSeconds: z.number(),
        maxEdgeFromLegacySeconds: z.number(),
        totalDurationMovementSeconds: z.number(),
        P0: z.number().int(),
        P1: z.number().int(),
        P2: z.number().int(),
        regions: z.number().int(),
        plannedWindows: z.number().int(),
        plannedSeconds: z.number(),
      })
      .strict(),
    operations: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
const freezeSchema = z
  .object({
    version: z.literal("bounded-recovery-freeze-v1"),
    identity: sha,
    files: z.array(entry),
  })
  .strict();
const same = (a, b, label) => {
  if (json(a) !== json(b)) throw Error(label);
};
async function inventory(root, p = "") {
  const rows = [];
  for (const name of (await fs.readdir(path.join(root, p))).sort()) {
    const rel = p ? `${p}/${name}` : name;
    if (rel === "results-freeze.json") continue;
    const file = await checkedPath(path.join(root, rel)),
      st = await fs.lstat(file);
    if (st.isDirectory()) rows.push(...(await inventory(root, rel)));
    else if (st.isFile())
      rows.push({ path: rel, sha256: hash(await read(root, rel)) });
    else throw Error("SPECIAL_FILE");
  }
  return rows;
}
const sourceNames = [
  "scripts/subtitle-tool-bounded-recovery.mjs",
  "scripts/lib/bounded-recovery.mjs",
  "scripts/lib/representation-grid.mjs",
  "scripts/lib/missing-dialogue-localization.mjs",
];
async function code() {
  const root = path.resolve(import.meta.dirname, "../..");
  return [
    ...(await codeIdentity()),
    ...(await Promise.all(
      sourceNames.map(async (p) => ({
        path: p,
        sha256: hash(await read(root, p)),
      })),
    )),
  ];
}
function chunksFromTiming(timing) {
  const map = new Map();
  for (const t of timing) {
    const c = {
      id: t.chunkId,
      inputStart: t.geometry.inputStart,
      inputEnd: t.geometry.inputEnd,
      index: map.size,
    };
    if (map.has(c.id)) {
      const prev = map.get(c.id);
      if (prev.inputStart !== c.inputStart || prev.inputEnd !== c.inputEnd)
        throw Error("CHUNK_GEOMETRY_CONFLICT");
    } else map.set(c.id, c);
  }
  return [...map.values()];
}
const sorted = (rs) =>
  [...rs].sort(
    (a, b) =>
      a.sourceStart - b.sourceStart ||
      a.chunkIndex - b.chunkIndex ||
      a.order - b.order,
  );

export function deriveRecovery(e) {
  const { experiment: m } = e;
  const reference = parseReference(Buffer.from(e.referenceAss, "utf8")).records;
  if (new Set(e.B.records.map((r) => r.recordId)).size !== e.B.records.length)
    throw Error("DUPLICATE_RECORD_ID");
  const legacy = {};
  for (const side of ["A", "B"]) {
    const g = e[side],
      chunks = chunksFromTiming(g.timing);
    legacy[side] = analyzeGroup(
      { records: g.records, chunks, complete: g.map.completeRequests },
      m,
    );
    same(legacy[side].timing, g.timing, "LEGACY_TIMING_RECOMPUTATION_CONFLICT");
    same(
      legacy[side].accounting,
      g.map.accounting,
      "LEGACY_ACCOUNTING_CONFLICT",
    );
  }
  const full = fullComparison(e.A.records, e.B.records, reference);
  same(full.comparison, e.fullComparison, "FULL_RAW_COMPARISON_CHANGED");
  same(
    identity(full.diffs),
    e.fullDiffHash,
    "FULL_RAW_EDIT_PROVENANCE_CHANGED",
  );
  const chunks = chunksFromTiming(e.B.timing),
    all = e.B.records.map((r) =>
      projectRecord(
        r,
        chunks.find((c) => c.id === r.chunkId),
        m,
      ),
    );
  const byId = new Map(all.map((r) => [r.recordId, r])),
    oldMap = new Map(e.B.map.accounting.map((r) => [r.recordId, r]));
  const accounting = e.B.records.map((r) => {
    const p = byId.get(r.recordId),
      old = oldMap.get(r.recordId),
      retained = old.disposition === "retained" || p.status === "RECOVERED";
    return {
      recordId: r.recordId,
      chunkId: r.chunkId,
      disposition: retained ? "retained" : old.disposition,
      aliasOf: old.aliasOf,
      recovered: p.status === "RECOVERED",
      reason: p.reason,
    };
  });
  const retainedIds = new Set(
    accounting
      .filter((r) => r.disposition === "retained")
      .map((r) => r.recordId),
  );
  const retained = sorted(
    e.B.records.filter((r) => retainedIds.has(r.recordId)),
  ).map((r) => {
    const p = byId.get(r.recordId);
    return {
      ...r,
      sourceStart: p.recoveredSerialized.start.seconds,
      sourceEnd: p.recoveredSerialized.end.seconds,
    };
  });
  accounting.forEach((r) => {
    r.outputOrdinal =
      retained.findIndex((x) => x.recordId === r.recordId) + 1 || null;
  });
  const strict = legacy.B.retained.map((r) => ({
    ...r,
    sourceStart: byId.get(r.recordId).legacySerialized.start.seconds,
    sourceEnd: byId.get(r.recordId).legacySerialized.end.seconds,
  }));
  const recovered = all.filter((r) => r.status === "RECOVERED"),
    candidates = all.filter(
      (r) =>
        !r.rawIssues.length &&
        !r.mappedIssues.length &&
        r.serializedIssues.length,
    );
  const bEdit = {
    ...full.comparison.rows.find(
      (r) => r.side === "B" && r.policy === "exact-visible-v1",
    ),
    edits: full.diffs.find(
      (r) => r.side === "B" && r.policy === "exact-visible-v1",
    ).edits,
  };
  const loc = localize(reference, retained, bEdit, {
    start: m.audioOffset,
    end: m.sourceEnd,
  });
  const stats = {
    rawRecords: e.B.records.length,
    strictRetained: strict.length,
    serializedOnlyCandidates: candidates.length,
    recovered: recovered.length,
    unrecoveredCandidates: candidates.length - recovered.length,
    retained: retained.length,
    aliases: accounting.filter((r) => r.disposition === "alias").length,
    unresolved: accounting.filter((r) => r.disposition === "unresolved").length,
    rawInvalid: all.filter((r) => r.rawIssues.length).length,
    maxEdgeFromMappedSeconds: Math.max(
      0,
      ...recovered.flatMap((r) => [
        Math.abs(r.deltas.startFromMapped.seconds),
        Math.abs(r.deltas.endFromMapped.seconds),
      ]),
    ),
    maxEdgeFromLegacySeconds: Math.max(
      0,
      ...recovered.flatMap((r) => [
        Math.abs(r.deltas.startFromLegacy.seconds),
        Math.abs(r.deltas.endFromLegacy.seconds),
      ]),
    ),
    totalDurationMovementSeconds: recovered.reduce(
      (n, r) => n + r.deltas.durationFromLegacy.seconds,
      0,
    ),
    P0: loc.rows.filter((r) => r.priority === "P0").length,
    P1: loc.rows.filter((r) => r.priority === "P1").length,
    P2: loc.rows.filter((r) => r.priority === "P2").length,
    regions: loc.regions.length,
    plannedWindows: loc.plan.plannedWindows,
    plannedSeconds: loc.plan.plannedSeconds,
  };
  if (stats.retained + stats.aliases + stats.unresolved !== stats.rawRecords)
    throw Error("RECOVERY_ACCOUNTING_FAILED");
  const out = {
    "B/raw-records.json": e.B.records,
    "B/transcript.raw.full.txt":
      e.B.records
        .filter((r) => r.text !== null)
        .map((r) => r.text)
        .join("\n\n") + "\n",
    "B/strict/export-map.json": e.B.map,
    "B/representation-recovered/representation-recovery.json": {
      policy: projectionPolicy,
      records: all,
    },
    "B/representation-recovered/representation-recovery-map.json": {
      records: all.map((r) => ({
        recordId: r.recordId,
        status: r.status,
        recoveredSerialized: r.recoveredSerialized,
      })),
    },
    "B/representation-recovered/export-map.json": {
      accounting,
      ...recoveryGates,
    },
    "localization/reference-cue-coverage.json": {
      policy: localizationPolicy,
      ...referenceFlags,
      rows: loc.rows,
    },
    "localization/content-mismatch-diagnostics.json": {
      rows: loc.rows.filter((r) =>
        r.reasonCodes.includes("CONTENT_MISMATCH_HEAVY"),
      ),
      notAutomaticMissingTargets: true,
    },
    "localization/missing-dialogue-candidates.json": {
      candidates: loc.candidates,
      ...referenceFlags,
      postHoc: true,
    },
    "localization/missing-dialogue-regions.json": {
      regions: loc.regions,
      ...referenceFlags,
      postHoc: true,
    },
    "localization/local-asr-plan.json": loc.plan,
    "comparison/strict-vs-recovered.json": {
      ...stats,
      newlyRestoredRecordIds: recovered.map((r) => r.recordId),
      textChangedCount: 0,
      rawTimingChangedCount: 0,
      mappedTimingChangedCount: 0,
      serializedTimingChangedCount: recovered.length,
      threeFormatValidation: "passed",
      A: legacy.A.metrics,
      B: legacy.B.metrics,
    },
    "comparison/deliverable-reference-comparison.json": deliverableComparison(
      strict,
      retained,
      reference,
    ),
    "comparison/full-raw-regression.json": {
      status: "unchanged",
      comparison: e.fullComparison,
      editProvenanceHash: e.fullDiffHash,
    },
  };
  const columns = [
    "windowId",
    "regionId",
    "priority",
    "coreStart",
    "coreEnd",
    "requestStart",
    "requestEnd",
    "seconds",
    "status",
    "reason",
  ];
  out["localization/local-asr-plan.csv"] =
    [
      columns.map(csvCell).join(","),
      ...[...loc.plan.scheduled, ...loc.plan.deferred].map((r) =>
        columns.map((k) => csvCell(r[k] ?? "")).join(","),
      ),
    ].join("\n") + "\n";
  for (const [kind, rs] of [
    ["strict", strict],
    ["representation-recovered", retained],
  ])
    for (const [f, text] of Object.entries(formatProjection(rs, m.language)))
      out[`B/${kind}/primary-minimal.${kind}.partial.${f}`] = text;
  out["OUTPUT_INDEX.md"] =
    "# PRIVATE / NOT FOR PUBLIC DISTRIBUTION\n\n[回復字幕](B/representation-recovered/primary-minimal.representation-recovered.partial.ass) · [計画](localization/local-asr-plan.json) · [ガイド](RECOVERY_GUIDE.md)\n\nMachine candidate only. needs-review; full timed export blocked.\n";
  out["RECOVERY_GUIDE.md"] =
    "# 表示時刻回復・欠落候補診断\n\n原本の raw/mapped 時刻・本文は変更していません。合法な連続時刻だけを共通 0.01 秒グリッドへ投影しました。旧 strict は別保存です。\n\n過去の人手稿は未再検証の参考資料であり Gold ではありません。全文 edit path は時間対応ではなく、反復で対応が曖昧になりえます。距離は CER ではありません。P0/P1 は潜在的欠落、P2 は内容相違の診断であり、発話欠落の確定ではありません。\n\n計画 CSV は機械生成された固定資料で、記入用ではありません。次回の予定は最大 12 window / 180 秒 / 各 30 秒。reference 本文は表示専用で ASR prompt には渡しません。ASR・VAD・モデル・音声生成は未実行です。今回の完了に人手入力は不要です。品質承認・完全字幕・default変更を意味しません。\n";
  return { out, stats, retained, strict, byId };
}

async function readInput(o) {
  const d = await checkedPath(o.diagnostics),
    r = await checkedPath(o.referenceBundle);
  const dm = await readJson(d, "report-manifest.json"),
    rm = await readJson(r, "bundle.json");
  await verifyRevision(d, dm.identity);
  await verifyReferenceBundle(r);
  same(dm.input, rm.payload.input, "INPUT_EXPERIMENT_MISMATCH");
  const e = {
    experiment: await readJson(r, "reference/provenance/experiment.json"),
    referenceAss: (await read(r, "reference/source.ass")).toString("utf8"),
    fullComparison: await readJson(r, "comparison/reference-comparison.json"),
    fullDiffHash: identity(await readJson(r, "comparison/text-diff.json")),
  };
  for (const side of ["A", "B"]) {
    e[side] = {
      records: await readJson(d, `${side}/raw-records.json`),
      timing: await readJson(d, `${side}/timing-diagnostics.json`),
      map: await readJson(d, `${side}/export-map.json`),
    };
    same(
      e[side].records,
      (await readJson(r, `raw/${side}-full-records.json`)).map((record) =>
        Object.fromEntries(
          Object.entries(record).filter(
            ([key]) =>
              ![
                "timestampEvidence",
                "strictRevisionDisposition",
                "originalExportDisposition",
              ].includes(key),
          ),
        ),
      ),
      "RAW_IDENTITY_MISMATCH",
    );
  }
  e.parents = {
    diagnosticsIdentity: dm.identity,
    referenceIdentity: rm.identity,
    referenceSha256: hash(await read(r, "reference/source.ass")),
    diagnosticsManifestSha256: hash(await read(d, "report-manifest.json")),
    referenceManifestSha256: hash(await read(r, "bundle.json")),
  };
  return { e, d, r };
}
export async function buildRecovery(o) {
  if (!o.exportRecoveredSubtitles)
    throw Error("EXPLICIT_RECOVERED_EXPORT_REQUIRED");
  const { e, d, r } = await readInput(o),
    out = await checkedPath(o.outputRoot, true);
  separate(out, [d, r]);
  const derived = deriveRecovery(e);
  for (const f of ["ass", "srt", "vtt"])
    if (
      (await read(d, `B/subtitles/primary-minimal.partial.${f}`)).toString(
        "utf8",
      ) !== derived.out[`B/strict/primary-minimal.strict.partial.${f}`]
    )
      throw Error("STRICT_SUBTITLE_BYTES_CHANGED");
  const payload = {
    version: "bounded-representation-recovery-v1",
    inputs: [{ path: "input-evidence.json", sha256: identity(e) }],
    code: await code(),
    exportRecoveredSubtitles: true,
    projection: projectionPolicy.version,
    localization: localizationPolicy.version,
  };
  const id = identity(payload),
    operations = Object.fromEntries(
      [
        "newASRRequests",
        "newASRInference",
        "newVADDispatches",
        "newVADInference",
        "newModelLoads",
        "newProviderStarts",
        "newSourceMediaExtractions",
        "newASRAudioWindows",
        "newListeningClipGenerations",
        "subtitleTextMutations",
        "rawTimingMutations",
        "mappedTimingMutations",
        "externalReferenceSearches",
      ].map((k) => [k, 0]),
    );
  Object.assign(operations, {
    serializedRepresentationAdjustments: derived.stats.recovered,
    referenceLocalizationReads: 1,
    localizationCandidateCount: derived.stats.P0 + derived.stats.P1,
    plannedFutureAsrWindowCount: derived.stats.plannedWindows,
  });
  const manifest = recoveryManifestSchema.parse({
    identity: id,
    payload,
    gates: recoveryGates,
    statuses: [
      "REPRESENTATION_RECOVERY_READY",
      "MISSING_DIALOGUE_LOCALIZATION_READY",
      "LOCAL_ASR_PLAN_READY",
    ],
    stats: derived.stats,
    operations,
  });
  return publish(
    out,
    `recovery-${id}`,
    async (stage) => {
      const save = async (p, v) => {
        o.signal?.throwIfAborted();
        await (o.write ?? write)(stage, p, v);
      };
      await save("input-evidence.json", e);
      await save("input-identity.json", e.parents);
      for (const [p, v] of Object.entries(derived.out)) await save(p, v);
      await save("recovery-manifest.json", manifest);
      await save("results-freeze.json", {
        version: "bounded-recovery-freeze-v1",
        identity: id,
        files: await inventory(stage),
      });
    },
    verifyRecovery,
    o.signal,
  );
}
export async function verifyRecovery(root) {
  root = await checkedPath(root);
  const m = recoveryManifestSchema.parse(
      await readJson(root, "recovery-manifest.json"),
    ),
    f = freezeSchema.parse(await readJson(root, "results-freeze.json"));
  if (m.identity !== identity(m.payload) || f.identity !== m.identity)
    throw Error("RECOVERY_IDENTITY_CONFLICT");
  same(f.files, await inventory(root), "RECOVERY_FREEZE_CONFLICT");
  same(m.payload.code, await code(), "RECOVERY_CODE_CONTRACT_CONFLICT");
  const e = await readJson(root, "input-evidence.json");
  same(
    m.payload.inputs,
    [{ path: "input-evidence.json", sha256: identity(e) }],
    "RECOVERY_INPUT_CONFLICT",
  );
  same(
    await readJson(root, "input-identity.json"),
    e.parents,
    "RECOVERY_PARENT_CONFLICT",
  );
  const d = deriveRecovery(e);
  same(
    f.files.map((x) => x.path).sort(),
    [
      ...Object.keys(d.out),
      "input-evidence.json",
      "input-identity.json",
      "recovery-manifest.json",
    ].sort(),
    "RECOVERY_FILE_SET_CONFLICT",
  );
  same(m.stats, d.stats, "RECOVERY_STATS_CONFLICT");
  const zero = [
    "newASRRequests",
    "newASRInference",
    "newVADDispatches",
    "newVADInference",
    "newModelLoads",
    "newProviderStarts",
    "newSourceMediaExtractions",
    "newASRAudioWindows",
    "newListeningClipGenerations",
    "subtitleTextMutations",
    "rawTimingMutations",
    "mappedTimingMutations",
    "externalReferenceSearches",
  ];
  const ops = Object.fromEntries(zero.map((k) => [k, 0]));
  Object.assign(ops, {
    serializedRepresentationAdjustments: d.stats.recovered,
    referenceLocalizationReads: 1,
    localizationCandidateCount: d.stats.P0 + d.stats.P1,
    plannedFutureAsrWindowCount: d.stats.plannedWindows,
  });
  same(m.operations, ops, "RECOVERY_OPERATION_CONFLICT");
  for (const [p, v] of Object.entries(d.out))
    if (
      (await read(root, p)).toString("utf8") !==
      (typeof v === "string" ? v : json(v))
    )
      throw Error("RECOVERY_DERIVATION_CONFLICT:" + p);
  for (const [kind, rs] of [
    ["strict", d.strict],
    ["representation-recovered", d.retained],
  ]) {
    const contents = {};
    for (const f of ["ass", "srt", "vtt"])
      contents[f] = (
        await read(root, `B/${kind}/primary-minimal.${kind}.partial.${f}`)
      ).toString("utf8");
    validateProjection(contents, rs, d.byId);
  }
  return {
    identity: m.identity,
    integrity: "passed",
    statuses: m.statuses,
    stats: m.stats,
    operations: m.operations,
    gates: m.gates,
    exitCode: 0,
  };
}
