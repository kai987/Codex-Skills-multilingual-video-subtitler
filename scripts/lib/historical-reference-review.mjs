/** Explicit saved evidence only. No recognition, audio generation, process or network imports. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { cleanSubtitleText } from "../../packages/subtitle-core/dist/clean.js";
import { checkedPath } from "./bounded-report-revision.mjs";
import {
  hash,
  identity,
  json,
  gates,
  counters,
} from "./content-review-plan.mjs";
import { template, referenceSchema } from "./content-review-input.mjs";
import {
  parseReference,
  fullComparison,
  associateReference,
  textRules,
  referenceFlags,
} from "./historical-reference-text.mjs";
import { reviewGuide } from "./historical-reference-guide.mjs";
import {
  read,
  readJson,
  write,
  files,
  codeIdentity,
  separate,
  publish,
  page,
  esc,
  fullRecord,
  bundleSchema,
  bundleFreezeSchema,
  verifyBundle,
  verifyListeningContent,
} from "./bounded-content-review.mjs";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const entry = z
  .object({
    path: z
      .string()
      .min(1)
      .refine(
        (s) =>
          !path.isAbsolute(s) &&
          !s.includes("\\") &&
          !s.split("/").some((p) => ["", ".", ".."].includes(p)),
      ),
    size: z.number().int().nonnegative(),
    sha256: sha,
  })
  .strict();
export const referenceInputsSchema = z
  .object({
    version: z.literal("reference-inputs-v1"),
    inventoryAuthority: z.literal(
      "BYTE_INVENTORY_ONLY_NOT_NEW_HUMAN_CERTIFICATION",
    ),
    files: z
      .object({
        reference: entry,
        humanBaseline: entry,
        finalization: entry,
        reviewPackage: entry,
        experiment: entry,
      })
      .strict(),
  })
  .strict();
export const referenceBundleSchema = bundleSchema
  .extend({
    version: z.literal("historical-reference-review-v2"),
    payload: bundleSchema.shape.payload
      .extend({
        presentation: z.literal("listen-first-reference-assisted-v2"),
        annotationSchema: z.literal(referenceSchema),
        parentBundleIdentity: sha,
        parentManifestHash: sha,
        parentFreezeHash: sha,
        referenceBindingHash: sha,
        inputIndexHash: sha,
        rules: z.unknown(),
      })
      .strict(),
  })
  .strict();
const rolePaths = {
  reference: "reference/source.ass",
  humanBaseline:
    "reference/provenance/subtitle-package.human-reviewed-base.json",
  finalization: "reference/provenance/subtitle-finalization-report.json",
  reviewPackage: "reference/provenance/subtitle-review-package.json",
  experiment: "reference/provenance/experiment.json",
};
const inherited = (p) =>
  [
    "review-plan.json",
    "targeted-plan.json",
    "items.json",
    "audio-map.json",
  ].includes(p) ||
  p.startsWith("raw/") ||
  p.startsWith("audio/");
const same = (a, b, reason) => {
  if (json(a) !== json(b)) throw Error(reason);
};

export function bindReference(indexBytes, blobs, parent) {
  const index = referenceInputsSchema.parse(
    JSON.parse(indexBytes.toString("utf8")),
  );
  for (const [role, info] of Object.entries(index.files)) {
    if (
      !blobs[role] ||
      blobs[role].length !== info.size ||
      hash(blobs[role]) !== info.sha256
    )
      throw Error("REFERENCE_INDEX_BYTES_MISMATCH:" + role);
  }
  const base = JSON.parse(blobs.humanBaseline),
    final = JSON.parse(blobs.finalization),
    review = JSON.parse(blobs.reviewPackage),
    experiment = JSON.parse(blobs.experiment);
  const authority = z
    .object({
      authority: z.literal("user-confirmed-human-review"),
      sourceFileSha256: sha,
      sourceFileSize: z.number().int().positive(),
      cueCount: z.number().int().positive(),
      sourceReadOnlyVerified: z.literal(true),
    })
    .passthrough()
    .parse(final.humanReviewedBaseline);
  if (
    authority.sourceFileSha256 !== hash(blobs.reference) ||
    authority.sourceFileSize !== blobs.reference.length
  )
    throw Error("HISTORICAL_SOURCE_AUTHORITY_MISMATCH");
  if (
    hash(blobs.humanBaseline) !== final.baseSubtitlePackageHash ||
    hash(blobs.humanBaseline) !== review.baseSubtitlePackageHash
  )
    throw Error("HISTORICAL_BASE_BYTES_MISMATCH");
  sha.parse(review.sourceFingerprint?.sha256);
  if (review.sourceFingerprint.sha256 !== experiment.baseline?.source?.sha256)
    throw Error("HISTORICAL_MACHINE_SOURCE_MISMATCH");
  if (
    hash(blobs.experiment) !== parent.payload.input.manifest ||
    experiment.planHash !== parent.payload.input.plan
  )
    throw Error("PARENT_EXPERIMENT_MISMATCH");
  same(experiment.pcm, parent.payload.pcm, "PARENT_PCM_MISMATCH");
  same(
    experiment.audioOffset,
    parent.payload.audioOffset,
    "PARENT_TIMEBASE_MISMATCH",
  );
  const parsed = parseReference(blobs.reference);
  if (
    !Array.isArray(base.cues) ||
    parsed.records.length !== base.cues.length ||
    authority.cueCount !== base.cues.length ||
    !Array.isArray(review.items)
  )
    throw Error("HISTORICAL_RECORD_COUNT_MISMATCH");
  for (const [i, r] of parsed.records.entries()) {
    if (r.parseStatus === "UNPARSEABLE") continue;
    const cue = base.cues[i],
      style = r.style.toLowerCase();
    if (
      cue.start !== r.start ||
      cue.end !== r.end ||
      cue.text !== cleanSubtitleText(r.rawText) ||
      cue.style !== (["music", "thought"].includes(style) ? style : "default")
    )
      throw Error("HISTORICAL_CUE_CORRESPONDENCE_MISMATCH:" + i);
  }
  return {
    parsed,
    binding: {
      ...referenceFlags,
      status: parsed.audit.unparseable.length
        ? "INCOMPLETE_CUE_CORRESPONDENCE"
        : "BOUND_SAVED_EVIDENCE",
      sourceFileSha256: hash(blobs.reference),
      sourceFileSize: blobs.reference.length,
      provenanceHashes: Object.fromEntries(
        Object.entries(blobs).map(([k, b]) => [k, hash(b)]),
      ),
      historicalPackageStatus: z.string().parse(base.status),
      historicalFinalizationStatus: z.string().parse(final.status),
      historicalFinalizationMethod: z.string().parse(final.finalizationMethod),
      historicalAdditionalReviewItems: review.items.length,
      sourceMediaSha256: review.sourceFingerprint.sha256,
      sourcePcmSha256: experiment.pcm.pcmHash,
      planHash: experiment.planHash,
      cueCorrespondence: {
        total: parsed.records.length,
        verified: parsed.records.filter((r) => r.parseStatus !== "UNPARSEABLE")
          .length,
        policy:
          "legacy-import-cleanSubtitleText-for-binding-only; literal-visible-whitespace-for-comparison",
      },
      sourceMediaRead: false,
      sourceAcousticTruthVerified: false,
    },
  };
}

async function derive(parent, indexBytes, blobs, items, A, B) {
  // Frozen arrays are consumed in response/chunk order, never by broken timestamps.
  for (const rows of [A, B])
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i];
      if (
        (a.chunkIndex ?? -1) > (b.chunkIndex ?? -1) ||
        (a.requestId === b.requestId && a.order >= b.order)
      )
        throw Error("RAW_ORIGINAL_ORDER_CONFLICT");
    }
  const { binding, parsed } = bindReference(indexBytes, blobs, parent);
  const comparison = fullComparison(A, B, parsed.records);
  const map = associateReference(items, parsed.records);
  return { binding, parsed, comparison, map };
}

function indexPage(id, items, A, B, result) {
  const { binding, parsed, comparison, map } = result;
  let body = `<p>PRIVATE / NOT FOR PUBLIC DISTRIBUTION · ${esc(id)} · AWAITING_HUMAN_REVIEW</p><p>音声→自分のメモ→A/B→必要ならR。非盲検・参照補助。過去原稿は validated Gold ではなく、今回の53項目は未記入です。</p><p>過去: ${esc(binding.historicalPackageStatus)} / ${esc(binding.historicalFinalizationStatus)} / ${esc(binding.historicalFinalizationMethod)}、追加レビュー${binding.historicalAdditionalReviewItems}件（今回の進捗ではありません）。</p><p><a href="REVIEW_GUIDE.md">日本語記入ガイド</a> · <a href="review/content-review.csv">記入CSV</a> · <a href="reference/source.ass">変更していない参照原本</a> · <a href="comparison/reference-comparison.json">全文比較診断</a> · <a href="reference/parse-audit.json">解析監査</a></p>`;
  body += `<details><summary>全raw / 位置不明 / 過去原稿の全記録</summary>`;
  for (const [side, rows] of [
    ["A", A],
    ["B", B],
  ])
    body +=
      `<h2>${side}: ${rows.length} raw records</h2>` +
      rows.map(fullRecord).join("");
  body +=
    `<h2>R: ${parsed.records.length} historical records（Musicを含む）</h2>` +
    parsed.records
      .map(
        (r) =>
          `<details><summary>${esc(r.refId)} ${esc(r.style)} ${esc(r.parseStatus)}</summary><pre>${esc(r.visibleText ?? r.originalLine)}</pre><pre>${esc(json(r))}</pre></details>`,
      )
      .join("") +
    `</details>`;
  for (const item of items) {
    body += `<article id="${esc(item.reviewId)}"><h2>${esc(item.kind)} ${esc(item.reviewId)}</h2><p>評価 source [${item.start}, ${item.end}) 秒、再生 source [${item.bounds.playbackStart}, ${item.bounds.playbackEnd}) 秒。音声内評価 [${item.bounds.evaluationStartInClipSample / 16000}, ${item.bounds.evaluationEndInClipSample / 16000}) 秒。</p><audio controls preload="none" src="${esc(item.audio.path)}"></audio><a href="${esc(item.audio.path)}">WAV</a><p>まず聴いて、自分のメモを残してください。候補・参照なしは無音を意味しません。</p>`;
    for (const [side, rows] of [
      ["A", A],
      ["B", B],
    ]) {
      body += `<details><summary>${side} 候補・元raw全文（時刻は手がかり）</summary>`;
      for (const c of item.candidates[side])
        body +=
          `<p>${esc(c.label)}</p>` +
          fullRecord(rows.find((r) => r.recordId === c.recordId));
      body +=
        item.requests[side]
          .map(
            (r) =>
              `<p>要求全体・前後文脈 <a href="${esc(r.href)}">${esc(r.requestId)}</a> · <a href="${esc(r.json)}">JSON</a></p>`,
          )
          .join("") + `</details>`;
    }
    body += `<details><summary>R 過去の人手原稿（必要な場合のみ開く）</summary><p>時刻交差による参考関連です。全文が評価区間内にあることや正しさは保証しません。referenceUseへ閲覧を申告してください。</p>`;
    const associations = map.find(
      (m) => m.reviewId === item.reviewId,
    ).references;
    for (const a of associations) {
      const r = parsed.records.find((r) => r.refId === a.refId);
      body += `<section><p>${esc(a.label)} · ${esc(r.refId)} · ${esc(r.style)} · source [${r.start}, ${r.end})</p><pre>${esc(r.visibleText ?? r.originalLine)}</pre><p>${esc(r.parseStatus)} ${esc(r.warnings.join(" / "))}</p></section>`;
    }
    if (!associations.length)
      body += `<p>時刻が関連する参照なし。無音・欠落とは判断しません。</p>`;
    body += `</details></article>`;
  }
  body += `<details><summary>事後的な全raw文字列診断（組立字幕CERではありません）</summary><pre>${esc(json(comparison.comparison))}</pre></details>`;
  return page("過去人手原稿付き・固定 A/B 試聴", body);
}

function outputs(id, items, A, B, result) {
  const { binding, parsed, comparison, map } = result;
  return {
    "reference/reference-binding.json": binding,
    "reference/records.json": parsed.records,
    "reference/transcript.visible.txt": parsed.records
      .map((r) => r.visibleText ?? "")
      .join(""),
    "reference/parse-audit.json": parsed.audit,
    "reference/item-reference-map.json": {
      version: textRules.association,
      items: map,
      unlocated: parsed.records
        .filter((r) => r.start === null || r.end <= r.start)
        .map((r) => r.refId),
    },
    "comparison/reference-comparison.json": comparison.comparison,
    "comparison/text-streams.json": comparison.streams,
    "comparison/text-diff.json": comparison.diffs,
    "listening-index.html": indexPage(id, items, A, B, result),
    "REVIEW_GUIDE.md": reviewGuide(),
    "OUTPUT_INDEX.md":
      "# PRIVATE reference-assisted handoff\n\n[試聴](listening-index.html) · [日本語ガイド](REVIEW_GUIDE.md) · [記入用CSV](review/content-review.csv) · [参照来歴](reference/reference-binding.json) · [全raw比較](comparison/reference-comparison.json)\n\nAWAITING_HUMAN_REVIEW. Not validated Gold. No subtitle mutation or release authority.\n",
    "content-review-template.csv": template(items, id, referenceSchema),
  };
}
const operationCounts = (items, inheritedFiles, result) => ({
  scope:
    "CONSTRUCTION_DERIVATION_ONLY; verifier rereads are returned separately",
  ...counters,
  newListeningClipGenerations: 0,
  historicalReferenceFilesRead: 1,
  historicalProvenanceFilesRead: 3,
  machineExperimentFilesRead: 1,
  inputIndexFilesRead: 1,
  referenceParseEvents: 1,
  fullRawComparisonRuns: result.comparison.comparison.rows.filter(
    (r) => r.status === "COMPUTED",
  ).length,
  copiedListeningFiles: items.length,
  copiedListeningBytes: inheritedFiles
    .filter((f) => f.path.startsWith("audio/"))
    .reduce((n, f) => n + f.size, 0),
  explicitAnnotationFilesRead: 0,
  browserPlaybackSmokeTest: "NOT_PERFORMED_BY_GENERATOR",
});

export async function attachReference(o) {
  const root = await checkedPath(o.bundle),
    reference = await checkedPath(o.reference),
    evidence = await checkedPath(o.referenceEvidence),
    out = await checkedPath(o.outputRoot, true);
  separate(out, [root, path.dirname(reference), path.dirname(evidence)]);
  const verified = await verifyBundle(root);
  if (verified.readiness !== "LISTENING_HANDOFF_READY")
    throw Error("COMPLETE_PARENT_LISTENING_BUNDLE_REQUIRED");
  const parentBytes = await read(root, "bundle.json"),
    freezeBytes = await read(root, "bundle-freeze.json"),
    parent = bundleSchema.parse(JSON.parse(parentBytes)),
    freeze = bundleFreezeSchema.parse(JSON.parse(freezeBytes));
  const indexBytes = await fs.readFile(evidence),
    index = referenceInputsSchema.parse(JSON.parse(indexBytes)),
    blobs = {};
  for (const [role, info] of Object.entries(index.files))
    blobs[role] = await read(path.dirname(evidence), info.path);
  const explicit = await fs.readFile(reference);
  if (!explicit.equals(blobs.reference))
    throw Error("EXPLICIT_REFERENCE_INDEX_MISMATCH");
  const items = await readJson(root, "items.json"),
    A = await readJson(root, "raw/A-full-records.json"),
    B = await readJson(root, "raw/B-full-records.json");
  const result = await derive(parent, indexBytes, blobs, items, A, B);
  const payload = {
    ...parent.payload,
    code: await codeIdentity(),
    presentation: "listen-first-reference-assisted-v2",
    annotationSchema: referenceSchema,
    parentBundleIdentity: parent.identity,
    parentManifestHash: hash(parentBytes),
    parentFreezeHash: hash(freezeBytes),
    referenceBindingHash: identity(result.binding),
    inputIndexHash: hash(indexBytes),
    rules: textRules,
  };
  const id = identity(payload);
  return publish(
    out,
    "bundle-" + id,
    async (stage) => {
      const copied = [];
      for (const f of freeze.files.filter((f) => inherited(f.path))) {
        o.signal?.throwIfAborted();
        const bytes = await read(root, f.path);
        if (hash(bytes) !== f.sha256) throw Error("PARENT_CHANGED_DURING_COPY");
        await write(stage, f.path, bytes);
        copied.push({ ...f, size: bytes.length });
      }
      await write(stage, "parent/bundle.json", parentBytes);
      await write(stage, "parent/bundle-freeze.json", freezeBytes);
      await write(
        stage,
        "reference/provenance/REFERENCE_INPUTS.json",
        indexBytes,
      );
      for (const [role, p] of Object.entries(rolePaths))
        await write(stage, p, blobs[role]);
      for (const [p, v] of Object.entries(outputs(id, items, A, B, result)))
        await write(stage, p, v);
      await write(
        stage,
        "review/content-review.csv",
        template(items, id, referenceSchema),
      );
      await write(
        stage,
        "bundle.json",
        referenceBundleSchema.parse({
          version: "historical-reference-review-v2",
          identity: id,
          payload,
          stats: {
            mainItems: parent.stats.mainItems,
            targetedItems: parent.stats.targetedItems,
            copiedListeningClipFiles: items.length,
            copiedListeningClipSamples:
              parent.stats.derivedListeningClipSamples,
            listeningClipSecondsSum: parent.stats.listeningClipSecondsSum,
            currentReviewedItems: 0,
            referenceDialogueCount: result.parsed.records.length,
          },
          gates,
          operations: operationCounts(items, copied, result),
        }),
      );
      await write(stage, "bundle-freeze.json", {
        version: "content-review-freeze-v1",
        identity: id,
        files: await files(stage),
        excluded: ["bundle-freeze.json", "review/"],
      });
      await verifyBundle(root);
    },
    async (dest) => {
      const v = await verifyReferenceBundle(dest);
      if (v.identity !== id) throw Error("REUSE_IDENTITY_CONFLICT");
      return v;
    },
    o.signal,
  );
}

export async function verifyReferenceBundle(root) {
  root = await checkedPath(root);
  const b = referenceBundleSchema.parse(await readJson(root, "bundle.json")),
    freeze = bundleFreezeSchema.parse(
      await readJson(root, "bundle-freeze.json"),
    );
  if (identity(b.payload) !== b.identity || freeze.identity !== b.identity)
    throw Error("REFERENCE_BUNDLE_IDENTITY_CONFLICT");
  same(await files(root), freeze.files, "REFERENCE_BUNDLE_CONTENT_CONFLICT");
  const parentBytes = await read(root, "parent/bundle.json"),
    parentFreezeBytes = await read(root, "parent/bundle-freeze.json"),
    parent = bundleSchema.parse(JSON.parse(parentBytes)),
    parentFreeze = bundleFreezeSchema.parse(JSON.parse(parentFreezeBytes));
  if (
    identity(parent.payload) !== parent.identity ||
    parentFreeze.identity !== parent.identity ||
    parent.identity !== b.payload.parentBundleIdentity ||
    hash(parentBytes) !== b.payload.parentManifestHash ||
    hash(parentFreezeBytes) !== b.payload.parentFreezeHash
  )
    throw Error("PARENT_IDENTITY_CONFLICT");
  const selected = parentFreeze.files.filter((f) => inherited(f.path)),
    copied = [];
  for (const f of selected) {
    const bytes = await read(root, f.path);
    if (hash(bytes) !== f.sha256) throw Error("PARENT_PROJECTION_CONFLICT");
    copied.push({ ...f, size: bytes.length });
  }
  same(
    freeze.files.filter((f) => inherited(f.path)),
    selected,
    "PARENT_PROJECTION_FILE_SET_CONFLICT",
  );
  const listening = await verifyListeningContent(root, parent, parentFreeze);
  if (listening.readiness !== "LISTENING_HANDOFF_READY")
    throw Error("REFERENCE_AUDIO_NOT_READY");
  const indexBytes = await read(
      root,
      "reference/provenance/REFERENCE_INPUTS.json",
    ),
    blobs = {};
  for (const [role, p] of Object.entries(rolePaths))
    blobs[role] = await read(root, p);
  const items = await readJson(root, "items.json"),
    A = await readJson(root, "raw/A-full-records.json"),
    B = await readJson(root, "raw/B-full-records.json"),
    result = await derive(parent, indexBytes, blobs, items, A, B);
  if (
    hash(indexBytes) !== b.payload.inputIndexHash ||
    identity(result.binding) !== b.payload.referenceBindingHash
  )
    throw Error("REFERENCE_BINDING_CONFLICT");
  same(
    b.payload,
    {
      ...parent.payload,
      code: b.payload.code,
      presentation: "listen-first-reference-assisted-v2",
      annotationSchema: referenceSchema,
      parentBundleIdentity: parent.identity,
      parentManifestHash: hash(parentBytes),
      parentFreezeHash: hash(parentFreezeBytes),
      referenceBindingHash: identity(result.binding),
      inputIndexHash: hash(indexBytes),
      rules: textRules,
    },
    "REFERENCE_PAYLOAD_CONFLICT",
  );
  same(b.gates, gates, "REFERENCE_GATE_CONFLICT");
  same(
    b.operations,
    operationCounts(items, copied, result),
    "REFERENCE_OPERATION_COUNTER_CONFLICT",
  );
  same(
    b.stats,
    {
      mainItems: parent.stats.mainItems,
      targetedItems: parent.stats.targetedItems,
      copiedListeningClipFiles: items.length,
      copiedListeningClipSamples: parent.stats.derivedListeningClipSamples,
      listeningClipSecondsSum: parent.stats.listeningClipSecondsSum,
      currentReviewedItems: 0,
      referenceDialogueCount: result.parsed.records.length,
    },
    "REFERENCE_STATS_CONFLICT",
  );
  for (const [p, v] of Object.entries(
    outputs(b.identity, items, A, B, result),
  )) {
    const expected = typeof v === "string" ? v : json(v);
    if ((await read(root, p)).toString("utf8") !== expected)
      throw Error("REFERENCE_DERIVATION_CONFLICT:" + p);
  }
  const ready =
    result.binding.status === "BOUND_SAVED_EVIDENCE" &&
    result.comparison.comparison.status === "RAW_REFERENCE_COMPARISON_READY";
  return {
    identity: b.identity,
    parentBundleIdentity: parent.identity,
    integrity: "passed",
    readiness: ready
      ? "REFERENCE_ASSISTED_HANDOFF_READY"
      : "REFERENCE_DIAGNOSTICS_INCOMPLETE",
    comparisonStatus: result.comparison.comparison.status,
    reviewState: listening.reviewState,
    stats: b.stats,
    operations: b.operations,
    verificationOperations: {
      historicalReferenceFilesRead: 1,
      historicalProvenanceFilesRead: 3,
      machineExperimentFilesRead: 1,
      inputIndexFilesRead: 1,
      referenceParseEvents: 1,
      fullRawComparisonRuns: result.comparison.comparison.rows.filter(
        (r) => r.status === "COMPUTED",
      ).length,
      listeningWavRereads: items.length,
      newListeningClipGenerations: 0,
    },
    ...gates,
    exitCode: ready ? 0 : 2,
  };
}
