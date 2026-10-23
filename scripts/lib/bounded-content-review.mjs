/** Frozen evidence in, private listening handoff out. No process or network capability. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  readEvidence,
  verifyRevision,
  checkedPath,
} from "./bounded-report-revision.mjs";
import {
  readPcm,
  slicePcm,
  ledger,
  validateJournal,
} from "./bounded-asr-ab.mjs";
import {
  hash,
  json,
  identity,
  policy,
  gates,
  counters,
  bounds,
  planTargets,
  hint,
  unionSamples,
} from "./content-review-plan.mjs";
import {
  template,
  evaluateCsv,
  exitContract,
} from "./content-review-input.mjs";
const utf8 = (b) => new TextDecoder("utf-8", { fatal: true }).decode(b);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const rel = z
  .string()
  .min(1)
  .refine(
    (s) =>
      !path.isAbsolute(s) &&
      !s.includes("\\") &&
      !s.split("/").some((p) => [".", "..", ""].includes(p)),
  );
const fileSchema = z.object({ path: rel, sha256: sha }).strict();
export const bundleSchema = z
  .object({
    version: z.literal("frozen-content-review-v1"),
    identity: sha,
    payload: z
      .object({
        input: z.unknown(),
        diagnosticIdentity: sha,
        mainPlanHash: sha,
        targetedPlanHash: sha,
        policy: z.unknown(),
        pcm: z
          .object({
            sampleRate: z.literal(16000),
            frames: z.number().int().positive(),
            pcmHash: sha,
            blockAlign: z.literal(2),
          })
          .strict(),
        audioOffset: z.number(),
        code: z.array(fileSchema),
        exportListeningAudio: z.boolean(),
        audioAuthentication: z.unknown(),
        presentation: z.literal("native-audio-listen-first-unblinded-v1"),
        annotationSchema: z.literal("paired-human-declaration-v1"),
      })
      .strict(),
    stats: z.unknown(),
    gates: z.unknown(),
    operations: z.unknown(),
  })
  .strict();
export const bundleFreezeSchema = z
  .object({
    version: z.literal("content-review-freeze-v1"),
    identity: sha,
    files: z.array(fileSchema),
    excluded: z.tuple([z.literal("bundle-freeze.json"), z.literal("review/")]),
  })
  .strict();
const esc = (s) =>
  String(s).replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function read(root, p) {
  rel.parse(p);
  const f = await checkedPath(path.join(root, p));
  if (!(await fs.lstat(f)).isFile()) throw Error("REGULAR_FILE_REQUIRED");
  return fs.readFile(f);
}
const readJson = async (root, p) => JSON.parse(utf8(await read(root, p)));
async function exists(p) {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function write(root, p, data) {
  rel.parse(p);
  const f = path.join(root, p);
  await fs.mkdir(path.dirname(f), { recursive: true });
  const h = await fs.open(f, "wx");
  try {
    await h.writeFile(
      typeof data === "string" || Buffer.isBuffer(data) ? data : json(data),
    );
    await h.sync();
  } finally {
    await h.close();
  }
}
async function files(root, p = "") {
  const out = [];
  for (const name of (await fs.readdir(path.join(root, p))).sort()) {
    const r = p ? `${p}/${name}` : name;
    if (r === "bundle-freeze.json" || r === "review") continue;
    const f = await checkedPath(path.join(root, r)),
      s = await fs.lstat(f);
    if (s.isDirectory()) out.push(...(await files(root, r)));
    else if (s.isFile())
      out.push({ path: r, sha256: hash(await fs.readFile(f)) });
    else throw Error("SPECIAL_FILE_DENIED");
  }
  return out;
}
async function codeIdentity() {
  const root = path.resolve(import.meta.dirname, "../..");
  const names = [
    "scripts/subtitle-tool-bounded-content-review.mjs",
    "scripts/lib/bounded-content-review.mjs",
    "scripts/lib/content-review-plan.mjs",
    "scripts/lib/content-review-input.mjs",
    "scripts/lib/historical-reference-text.mjs",
    "scripts/lib/historical-reference-review.mjs",
    "scripts/lib/historical-reference-guide.mjs",
    "scripts/lib/bounded-report-revision.mjs",
    "scripts/lib/bounded-diagnostics.mjs",
    "scripts/lib/bounded-asr-ab.mjs",
    "packages/video-subtitler/dist/standalone/bounded.js",
    "packages/video-subtitler/dist/standalone/recovery.js",
    "packages/video-subtitler/dist/standalone/assembly.js",
    "packages/subtitle-core/dist/parse.js",
    "packages/subtitle-core/dist/clean.js",
    "packages/subtitle-core/dist/format.js",
    "packages/subtitle-core/dist/time.js",
    "packages/shared/dist/schemas.js",
    "package-lock.json",
  ];
  return Promise.all(
    names.map(async (p) => ({ path: p, sha256: hash(await read(root, p)) })),
  );
}
function separate(output, inputs) {
  for (const input of inputs) {
    if (
      output === input ||
      output.startsWith(input + path.sep) ||
      input.startsWith(output + path.sep)
    )
      throw Error("OUTPUT_INPUT_TREE_OVERLAP");
  }
}
export async function authenticateAudio(e, audioRoot) {
  audioRoot = await checkedPath(audioRoot);
  const entries = await ledger(e.root);
  validateJournal(e.m, entries);
  const chunks = [],
    proof = [],
    missing = [];
  let end = 0;
  const stream = createHash("sha256");
  for (const c of e.m.chunks) {
    if (c.coreStart !== end || c.coreEnd <= c.coreStart)
      throw Error("NONCONTIGUOUS_CORE_PARTITION");
    end = c.coreEnd;
    const completed = entries
      .filter(
        (x) => x.kind === "completed" && x.id.startsWith(c.id + "-attempt-"),
      )
      .at(-1);
    if (!completed) throw Error("MISSING_COMPLETED_REQUEST");
    const reserved = entries.find(
      (x) =>
        x.kind === "reserved" && x.id === completed.id && x.chunkId === c.id,
    );
    const relative = `B/chunks/${c.id}/${completed.id}/input.wav`;
    let wav;
    try {
      wav = await read(audioRoot, relative);
    } catch (err) {
      if (err.code === "ENOENT") {
        missing.push({
          chunkId: c.id,
          reason: "MISSING_AUTHORIZED_SAVED_WAV",
          path: relative,
        });
        continue;
      }
      throw err;
    }
    if (!reserved || hash(wav) !== reserved.inputHash)
      throw Error("REQUEST_WAV_HASH_MISMATCH:" + c.id);
    const pcm = readPcm(wav),
      pcmHash = hash(pcm.data);
    if (
      pcm.sampleRate !== 16000 ||
      pcm.sampleRate !== e.m.pcm.sampleRate ||
      pcm.frames !== c.inputEnd - c.inputStart ||
      pcmHash !== e.m.chunkPcmHashes.find((x) => x.id === c.id)?.sha256
    )
      throw Error("CHUNK_PCM_BINDING_MISMATCH:" + c.id);
    const core = pcm.data.subarray(
      (c.coreStart - c.inputStart) * 2,
      (c.coreEnd - c.inputStart) * 2,
    );
    stream.update(core);
    chunks.push({ chunk: c, data: pcm.data });
    proof.push({
      chunkId: c.id,
      requestId: completed.id,
      path: relative,
      wavHash: hash(wav),
      pcmHash,
      frames: pcm.frames,
      sampleRate: pcm.sampleRate,
      channels: 1,
      bitsPerSample: 16,
      coreStart: c.coreStart,
      coreEnd: c.coreEnd,
      coreLocalStart: c.coreStart - c.inputStart,
      coreLocalEnd: c.coreEnd - c.inputStart,
    });
  }
  if (end !== e.m.pcm.frames) throw Error("INCOMPLETE_CORE_PARTITION");
  const reconstructedPcmHash = missing.length ? null : stream.digest("hex");
  if (!missing.length && reconstructedPcmHash !== e.m.pcm.pcmHash)
    throw Error("RECONSTRUCTED_PCM_HASH_MISMATCH");
  return {
    chunks,
    proof: {
      status: missing.length ? "BLOCKED_MISSING_AUDIO" : "AUTHENTICATED",
      missing,
      requests: proof,
      reconstructedPcmHash,
      coreCoverageFrames: missing.length ? null : end,
    },
  };
}
export function coreSlice(chunks, start, end) {
  const pieces = [],
    segments = [];
  let cursor = start;
  for (const { chunk: c, data } of chunks) {
    const a = Math.max(start, c.coreStart),
      b = Math.min(end, c.coreEnd);
    if (b <= a) continue;
    if (a !== cursor) throw Error("CORE_GAP_OR_OVERLAP");
    pieces.push(data.subarray((a - c.inputStart) * 2, (b - c.inputStart) * 2));
    segments.push({
      chunkId: c.id,
      sourceStartSample: a,
      sourceEndSample: b,
      chunkLocalStartSample: a - c.inputStart,
      chunkLocalEndSample: b - c.inputStart,
      clipLocalStartSample: a - start,
      clipLocalEndSample: b - start,
    });
    cursor = b;
  }
  if (cursor !== end) throw Error("CORE_SLICE_INCOMPLETE");
  return { data: Buffer.concat(pieces), segments };
}
function page(title, body) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>body{font:18px system-ui;max-width:1000px;margin:2rem auto;padding:1rem;line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere}article{border-top:1px solid #aaa;padding:1rem 0}audio{width:100%}td,th{padding:.3rem;border:1px solid #aaa}a{overflow-wrap:anywhere}</style><h1>${esc(title)}</h1>${body}</html>`;
}
function fullRecord(r) {
  return `<details><summary>${esc(r.recordId)} — full raw and stage metadata</summary><pre>${esc(json(r))}</pre></details>`;
}
async function publish(root, name, produce, verify, signal) {
  await checkedPath(root, true);
  await fs.mkdir(root, { recursive: true });
  const final = path.join(root, name),
    lock = path.join(root, `.${name}.lock`);
  const h = await fs.open(lock, "wx");
  let stage;
  try {
    if (await exists(final))
      return { root: final, reused: true, ...(await verify(final)) };
    stage = path.join(root, `.stage-${name}-${randomUUID()}`);
    await fs.mkdir(stage);
    signal?.throwIfAborted();
    await produce(stage);
    signal?.throwIfAborted();
    const result = await verify(stage);
    signal?.throwIfAborted();
    await fs.rename(stage, final);
    stage = null;
    return { root: final, reused: false, ...result };
  } finally {
    await h.close();
    await fs.unlink(lock);
    if (stage) await fs.rm(stage, { recursive: true, force: true });
  }
}
export async function verifyBundle(root) {
  root = await checkedPath(root);
  if (
    (await readJson(root, "bundle.json")).version ===
    "historical-reference-review-v2"
  ) {
    const { verifyReferenceBundle } =
      await import("./historical-reference-review.mjs");
    return verifyReferenceBundle(root);
  }
  const b = bundleSchema.parse(await readJson(root, "bundle.json")),
    freeze = bundleFreezeSchema.parse(
      await readJson(root, "bundle-freeze.json"),
    );
  if (identity(b.payload) !== b.identity || freeze.identity !== b.identity)
    throw Error("BUNDLE_IDENTITY_CONFLICT");
  if (json(await files(root)) !== json(freeze.files))
    throw Error("BUNDLE_CONTENT_CONFLICT");
  return verifyListeningContent(root, b, freeze);
}
export async function verifyListeningContent(root, b, freeze) {
  if (
    json(b.gates) !== json(gates) ||
    json(b.operations) !== json(counters) ||
    json(b.payload.policy) !== json(policy)
  )
    throw Error("BUNDLE_GATE_OR_POLICY_CONFLICT");
  const items = await readJson(root, "items.json"),
    main = await readJson(root, "review-plan.json"),
    targeted = await readJson(root, "targeted-plan.json");
  if (
    hash(await read(root, "review-plan.json")) !== b.payload.mainPlanHash ||
    identity(targeted) !== b.payload.targetedPlanHash ||
    items.length !== main.items.length + targeted.items.length
  )
    throw Error("BUNDLE_PLAN_CONFLICT");
  if (new Set(items.map((i) => i.reviewId)).size !== items.length)
    throw Error("DUPLICATE_BUNDLE_REVIEW_ID");
  const expectedAudioMap = items.map((i) => ({
    reviewId: i.reviewId,
    bounds: i.bounds,
    audioStatus: i.audioStatus,
    audio: i.audio,
  }));
  if (json(await readJson(root, "audio-map.json")) !== json(expectedAudioMap))
    throw Error("AUDIO_MAP_CONFLICT");
  let frames = 0,
    audioFiles = 0;
  for (const item of items) {
    const source = [...main.items, ...targeted.items].find(
      (x) => x.reviewId === item.reviewId,
    );
    if (
      !source ||
      source.start !== item.start ||
      source.end !== item.end ||
      source.kind !== item.kind
    )
      throw Error("ITEM_BINDING_CONFLICT");
    if (
      json(
        bounds(item, {
          pcm: b.payload.pcm,
          audioOffset: b.payload.audioOffset,
        }),
      ) !== json(item.bounds)
    )
      throw Error("SAMPLE_BOUNDS_CONFLICT");
    if (item.audioStatus === "READY") {
      const wav = await read(root, item.audio.path),
        p = readPcm(wav);
      if (
        !b.payload.exportListeningAudio ||
        p.sampleRate !== 16000 ||
        p.frames !== item.bounds.frames ||
        hash(wav) !== item.audio.wavHash ||
        hash(p.data) !== item.audio.pcmHash
      )
        throw Error("LISTENING_WAV_CONFLICT");
      let cursor = item.bounds.playbackStartSample;
      for (const s of item.audio.segments) {
        if (
          s.sourceStartSample !== cursor ||
          s.sourceEndSample <= cursor ||
          s.chunkLocalEndSample - s.chunkLocalStartSample !==
            s.sourceEndSample - s.sourceStartSample
        )
          throw Error("SEGMENT_PARTITION_CONFLICT");
        cursor = s.sourceEndSample;
      }
      if (cursor !== item.bounds.playbackEndSample)
        throw Error("SEGMENT_COVERAGE_CONFLICT");
      frames += p.frames;
      audioFiles++;
    } else if (item.audio !== null) throw Error("UNEXPECTED_AUDIO");
    for (const side of ["A", "B"])
      for (const request of item.requests[side]) await read(root, request.href);
  }
  if (
    audioFiles !== b.stats.derivedListeningClipFiles ||
    frames !== b.stats.derivedListeningClipSamples ||
    audioFiles > 56 ||
    frames / 16000 > 600
  )
    throw Error("LISTENING_COUNTER_CONFLICT");
  const audioEntries = freeze.files.filter((f) => f.path.startsWith("audio/"));
  if (audioEntries.length !== audioFiles)
    throw Error("UNDECLARED_LISTENING_AUDIO");
  let reviewState = "MISSING_NOT_RECREATED";
  if (await exists(path.join(root, "review/content-review.csv"))) {
    await read(root, "review/content-review.csv");
    reviewState = "EXISTS_PRESERVED_NOT_INTERPRETED";
  }
  return {
    identity: b.identity,
    integrity: "passed",
    readiness:
      audioFiles === items.length
        ? "LISTENING_HANDOFF_READY"
        : b.payload.exportListeningAudio
          ? "BLOCKED_MISSING_AUDIO"
          : "METADATA_ONLY_NOT_LISTENING_READY",
    reviewState,
    stats: b.stats,
    ...gates,
    exitCode:
      b.payload.exportListeningAudio && audioFiles !== items.length ? 2 : 0,
  };
}
export async function prepareReview(o) {
  const manifest = await checkedPath(o.manifest),
    diagnostics = await checkedPath(o.diagnostics),
    audioRoot = await checkedPath(o.audioRoot),
    out = await checkedPath(o.outputRoot, true);
  separate(out, [path.dirname(manifest), diagnostics, audioRoot]);
  const e = await readEvidence(manifest),
    revision = await readJson(diagnostics, "report-manifest.json");
  await verifyRevision(diagnostics, revision.identity);
  if (json(revision.input) !== json(e.input))
    throw Error("DIAGNOSTIC_EVIDENCE_BINDING_MISMATCH");
  const mainBytes = await read(diagnostics, "review-plan.json"),
    main = JSON.parse(utf8(mainBytes));
  if (
    main.planHash !== e.m.planHash ||
    main.resultsFreezeHash !== e.input.freeze ||
    main.rawCollectionHash !== e.input.rawCollection ||
    json(
      main.items.map((item) =>
        Object.fromEntries(
          Object.entries(item).filter(([key]) => key !== "reviewId"),
        ),
      ),
    ) !== json(e.m.manualReview) ||
    new Set(main.items.map((i) => i.reviewId)).size !== main.items.length
  )
    throw Error("FROZEN_REVIEW_PLAN_BINDING_MISMATCH");
  const records = {},
    timing = {};
  for (const side of ["A", "B"]) {
    records[side] = await readJson(diagnostics, `${side}/raw-records.json`);
    timing[side] = await readJson(
      diagnostics,
      `${side}/timing-diagnostics.json`,
    );
  }
  const targeted = planTargets(main, records, timing, e.m),
    authentication = await authenticateAudio(e, audioRoot);
  const payload = {
    input: e.input,
    diagnosticIdentity: revision.identity,
    mainPlanHash: hash(mainBytes),
    targetedPlanHash: identity(targeted),
    policy,
    pcm: e.m.pcm,
    audioOffset: e.m.audioOffset,
    code: await codeIdentity(),
    exportListeningAudio: Boolean(o.exportListeningAudio),
    audioAuthentication: authentication.proof,
    presentation: "native-audio-listen-first-unblinded-v1",
    annotationSchema: "paired-human-declaration-v1",
  };
  const id = identity(payload),
    bundleName = "bundle-" + id;
  return publish(
    out,
    bundleName,
    async (stage) => {
      // The selected plan is saved before any derivative audio is exported.
      await write(stage, "review-plan.json", mainBytes);
      await write(stage, "targeted-plan.json", targeted);
      const requestFiles = { A: [], B: [] },
        enriched = { A: [], B: [] };
      for (const side of ["A", "B"]) {
        const current = await readJson(diagnostics, `${side}/export-map.json`),
          old = await readJson(e.root, `${side}/export-map.json`);
        for (const name of [
          "timing-diagnostics.json",
          "text-risk-diagnostics.json",
          "export-map.json",
        ])
          await write(
            stage,
            `raw/${side}-${name}`,
            await read(diagnostics, `${side}/${name}`),
          );
        await write(
          stage,
          `raw/${side}-original-export-map.json`,
          await read(e.root, `${side}/export-map.json`),
        );
        for (const r of records[side])
          enriched[side].push({
            ...r,
            timestampEvidence: timing[side].find(
              (d) => d.recordId === r.recordId,
            ),
            strictRevisionDisposition: current.accounting.find(
              (d) => d.recordId === r.recordId,
            ),
            originalExportDisposition: old.accounting.find(
              (d) => d.recordId === r.recordId,
            ),
          });
        await write(stage, `raw/${side}-full-records.json`, enriched[side]);
        for (const requestId of [
          ...new Set(records[side].map((r) => r.requestId)),
        ]) {
          const selected = enriched[side].filter(
              (r) => r.requestId === requestId,
            ),
            stem = `raw/${side}-request-${hash(requestId).slice(0, 24)}`;
          const sourceRaw =
            side === "A"
              ? "A/raw-primary.srt"
              : `B/chunks/${selected[0].chunkId}/${requestId}/raw-response.srt`;
          const rawBytes = await read(e.root, sourceRaw);
          if (
            hash(rawBytes) !==
            e.input.evidence.find((f) => f.path === sourceRaw)?.sha256
          )
            throw Error("RAW_CHANGED_DURING_HANDOFF");
          await write(stage, stem + ".srt", rawBytes);
          await write(stage, stem + ".json", selected);
          await write(
            stage,
            stem + ".html",
            page(
              `${side} ${requestId}`,
              `<p>Full request context, not a claim that all text occurs inside any review interval.</p><a href="../listening-index.html">Index</a> · <a href="${path.basename(stem)}.srt">Original raw SRT (unchanged)</a>${selected.map(fullRecord).join("")}`,
            ),
          );
          requestFiles[side].push({
            requestId,
            href: stem + ".html",
            json: stem + ".json",
          });
        }
      }
      const items = [];
      let frameSum = 0;
      for (const i of [...main.items, ...targeted.items]) {
        o.signal?.throwIfAborted();
        const b = bounds(i, e.m),
          audioReady =
            payload.exportListeningAudio &&
            authentication.proof.status === "AUTHENTICATED";
        let audio = null;
        if (audioReady) {
          const slice = coreSlice(
              authentication.chunks,
              b.playbackStartSample,
              b.playbackEndSample,
            ),
            wav = slicePcm(
              { frames: b.frames, sampleRate: 16000, data: slice.data },
              0,
              b.frames,
            ),
            p = `audio/${i.reviewId}.wav`;
          await write(stage, p, wav);
          const actual = readPcm(await read(stage, p));
          // Independent per-segment oracle reads original chunk bytes, not the clip concatenation.
          for (const s of slice.segments) {
            const original = authentication.chunks.find(
              (c) => c.chunk.id === s.chunkId,
            ).data;
            if (
              !actual.data
                .subarray(s.clipLocalStartSample * 2, s.clipLocalEndSample * 2)
                .equals(
                  original.subarray(
                    s.chunkLocalStartSample * 2,
                    s.chunkLocalEndSample * 2,
                  ),
                )
            )
              throw Error("DERIVED_PCM_ORACLE_MISMATCH");
          }
          audio = {
            path: p,
            wavHash: hash(await read(stage, p)),
            pcmHash: hash(actual.data),
            segments: slice.segments,
            verification:
              "ALL_SAMPLES_REREAD_AND_BYTE_COMPARED_TO_AUTHENTICATED_CORE_PARTITION",
          };
          frameSum += b.frames;
        }
        const candidates = {},
          requests = {};
        for (const side of ["A", "B"]) {
          candidates[side] = enriched[side]
            .map((r) => ({
              recordId: r.recordId,
              label: hint(r, r.timestampEvidence, i),
            }))
            .filter((r) => r.label !== "UNLOCATED");
          const requestIds = new Set(
            enriched[side]
              .filter((r) =>
                candidates[side].some((c) => c.recordId === r.recordId),
              )
              .map((r) => r.requestId),
          );
          const list = requestFiles[side];
          const indexes = list
            .map((r, n) => (requestIds.has(r.requestId) ? n : -1))
            .filter((n) => n >= 0);
          requests[side] = list.filter(
            (r, n) =>
              requestIds.has(r.requestId) ||
              indexes.some((j) => Math.abs(j - n) === 1),
          );
        }
        items.push({
          ...i,
          bounds: b,
          candidates,
          requests,
          audioStatus: audioReady
            ? "READY"
            : payload.exportListeningAudio
              ? "BLOCKED_MISSING_AUDIO"
              : "NOT_EXPORTED",
          audio,
        });
      }
      const clips = items.filter((i) => i.audio),
        stats = {
          mainItems: main.items.length,
          targetedItems: targeted.items.length,
          derivedListeningClipFiles: clips.length,
          derivedListeningClipSamples: frameSum,
          listeningClipSecondsSum: frameSum / 16000,
          uniqueSourceSecondsExported:
            unionSamples(
              clips.map((i) => [
                i.bounds.playbackStartSample,
                i.bounds.playbackEndSample,
              ]),
            ) / 16000,
          humanAnnotationFilesRead: 0,
          humanDeclaredReviewedItems: 0,
          playbackVerificationMethod: clips.length
            ? "PCM_WAV_STRUCTURE_AND_ALL_SAMPLE_BYTE_COMPARISON_NOT_HUMAN_LISTENING"
            : "NO_LISTENING_FILES_EXPORTED",
          playbackVerifiedBy: "software",
        };
      await write(stage, "items.json", items);
      await write(
        stage,
        "audio-map.json",
        items.map((i) => ({
          reviewId: i.reviewId,
          bounds: i.bounds,
          audioStatus: i.audioStatus,
          audio: i.audio,
        })),
      );
      const csv = template(items, id);
      await write(stage, "content-review-template.csv", csv);
      await write(stage, "review/content-review.csv", csv);
      const guide = `# Frozen evidence listening handoff\n\nPrivate local material. Start with listening-index.html. No server or network required.\n\nListen first and make notes before opening A/B. Labels are visible: this is not blind. Judge only the original evaluation interval shown inside the wider playback interval. All raw text, including invalid times and repetitions, remains accessible. TIME_OVERLAP_HINT and POINT_HINT are not acoustic proof. REQUEST_CONTEXT_ONLY and UNLOCATED are not localized speech. Empty candidates are not evidence of no speech or missing dialogue. Old and strict partials are auxiliary, never the evaluation target.\n\nEdit only review/content-review.csv with a text/CSV editor. Required columns and enums are in the template and repository documentation. REVIEWED/UNJUDGEABLE require TRUE actuallyListened, ISO datetime with timezone, listenedStart/end covering the full evaluation interval, paired criteria, overall and notes. Reviewer name is optional. Do not use generated answers as human annotations. Do not enable spreadsheet formulas; raw notes remain inert and unmodified.\n\nSummarize explicitly into a different output tree. The exact annotation bytes are snapshotted. Editing or deleting this CSV never causes prepare/verify to reset it.\n\nReadiness is not content acceptance. Status AWAITING_HUMAN_REVIEW; CER NOT_MEASURED. No finalization or default change is authorized, even after all declared annotations. No audio was played or reviewed by a person by this generator.\n`;
      await write(stage, "REVIEW_GUIDE.md", guide);
      let body = `<p>PRIVATE • ${esc(id)} • AWAITING_HUMAN_REVIEW • Not blind • No quality approval.</p><p>音声を先に聴いてメモを取り、その後 A/B を開いてください。評価区間と前後の再生コンテキストは別です。</p><p><a href="REVIEW_GUIDE.md">Guide</a> · <a href="review/content-review.csv">Editable CSV</a> · <a href="targeted-plan.json">Targeted plan and exclusions</a></p><details><summary>All requests / unlocalized transcript (not interval-local candidates)</summary>`;
      for (const side of ["A", "B"])
        body +=
          `<h2>${side} full raw</h2><p><a href="raw/${side}-text-risk-diagnostics.json">All stored text risk diagnostics</a> · <a href="raw/${side}-timing-diagnostics.json">All stored timing diagnostics</a> · <a href="raw/${side}-export-map.json">Strict partial dispositions</a> · <a href="raw/${side}-original-export-map.json">Original partial dispositions</a></p>` +
          requestFiles[side]
            .map(
              (r) =>
                `<p><a href="${r.href}">${esc(r.requestId)}</a> · <a href="${r.json}">JSON</a></p>`,
            )
            .join("");
      body += "</details>";
      for (const i of items) {
        body += `<article id="${i.reviewId}"><h2>${esc(i.kind)} ${esc(i.reviewId)}</h2><p>Evaluate source [${i.start}, ${i.end}) s. Playback [${i.bounds.playbackStart}, ${i.bounds.playbackEnd}) s. Within clip evaluate [${i.bounds.evaluationStartInClipSample / 16000}, ${i.bounds.evaluationEndInClipSample / 16000}) s.</p>${i.audio ? `<audio controls preload="none" src="${i.audio.path}"></audio><a href="${i.audio.path}">WAV</a>` : `<p>${i.audioStatus}</p>`}<p>Listen first. Write your own notes. No candidate does not mean no speech.</p>`;
        for (const side of ["A", "B"]) {
          body += `<details><summary>${side} candidates (full text; timing hints only)</summary>`;
          for (const c of i.candidates[side]) {
            body +=
              `<p>${c.label}</p>` +
              fullRecord(enriched[side].find((r) => r.recordId === c.recordId));
          }
          body +=
            i.requests[side]
              .map(
                (r) =>
                  `<p>Full request / adjacent context: <a href="${r.href}">${esc(r.requestId)}</a></p>`,
              )
              .join("") + "</details>";
        }
        body += "</article>";
      }
      await write(
        stage,
        "listening-index.html",
        page("Frozen A/B listening handoff", body),
      );
      await write(
        stage,
        "OUTPUT_INDEX.md",
        "# Private handoff\n\n[Listening index](listening-index.html) · [Guide](REVIEW_GUIDE.md) · [Items](items.json) · [Audio map](audio-map.json) · [Original main plan](review-plan.json) · [Targeted plan](targeted-plan.json) · [Editable annotations](review/content-review.csv)\n\nNo human evaluation has been performed by this software.\n",
      );
      await write(
        stage,
        "bundle.json",
        bundleSchema.parse({
          version: "frozen-content-review-v1",
          identity: id,
          payload,
          stats,
          gates,
          operations: counters,
        }),
      );
      await write(stage, "bundle-freeze.json", {
        version: "content-review-freeze-v1",
        identity: id,
        files: await files(stage),
        excluded: ["bundle-freeze.json", "review/"],
      });
    },
    async (root) => {
      const v = await verifyBundle(root);
      if (v.identity !== id) throw Error("REUSE_IDENTITY_CONFLICT");
      return v;
    },
    o.signal,
  );
}
export async function summarizeReview(o) {
  const root = await checkedPath(o.bundle),
    annotations = await checkedPath(o.annotations),
    out = await checkedPath(o.outputRoot, true);
  separate(out, [root, annotations]);
  await verifyBundle(root);
  const b = await readJson(root, "bundle.json"),
    items = await readJson(root, "items.json"),
    snapshot = await fs.readFile(annotations);
  const result = evaluateCsv(
      utf8(snapshot),
      {
        identity: b.identity,
        pcm: b.payload.pcm,
        annotationSchema: b.payload.annotationSchema,
      },
      items,
    ),
    id = identity({
      bundle: b.identity,
      annotations: hash(snapshot),
      schema: b.payload.annotationSchema,
      exitCodeContract: exitContract,
      code: await codeIdentity(),
    });
  return publish(
    out,
    "summary-" + id,
    async (stage) => {
      await write(stage, "annotation-snapshot.csv", snapshot);
      await write(stage, "input-validation.json", result.validation);
      const summary = {
        identity: id,
        bundleIdentity: b.identity,
        annotationSha256: hash(snapshot),
        ...result.summary,
        operations: counters,
        exitCode: result.exitCode,
      };
      await write(stage, "summary.json", summary);
      await write(
        stage,
        "SUMMARY.md",
        `# Human-declared content evaluation\n\nStatus: ${summary.contentEvaluationStatus}\n\nDeclared full interval listening: ${summary.humanDeclaredReviewedItems}/${items.length}. Human-declared only, not verified by software. CER NOT_MEASURED. No automatic winner or release authority.\n\n\`\`\`json\n${json(summary.groups)}\`\`\`\n`,
      );
      await write(stage, "bundle-freeze.json", {
        version: "content-review-freeze-v1",
        identity: id,
        files: await files(stage),
        excluded: ["bundle-freeze.json", "review/"],
      });
    },
    async (s) => {
      const freeze = bundleFreezeSchema.parse(
        await readJson(s, "bundle-freeze.json"),
      );
      if (freeze.identity !== id || json(freeze.files) !== json(await files(s)))
        throw Error("SUMMARY_CONTENT_CONFLICT");
      return { identity: id, ...result };
    },
    o.signal,
  );
}
export {
  read,
  readJson,
  write,
  files,
  exists,
  codeIdentity,
  separate,
  publish,
  page,
  esc,
  fullRecord,
};
