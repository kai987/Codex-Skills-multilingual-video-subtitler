import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import {
  replayPrimaryAssembly,
  matchedEvidenceSchema,
} from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import {
  acousticBundleSchema,
  decideAcoustic,
  deriveAcousticCases,
  exportDiff,
} from "../packages/video-subtitler/dist/machine-quality/bounded-acoustic.js";
import {
  storedBundleSchema,
  consumeStoredWhisper,
} from "../packages/video-subtitler/dist/machine-quality/stored-token-span.js";
import {
  GROUP_POLICY,
  prepareSourceGroup,
  buildGroupPatch,
  sourceGroupSchema,
  alignmentSchema,
} from "../packages/video-subtitler/dist/machine-quality/source-bound-group.js";
import {
  read,
  hashFile,
  sha256,
  objectHash,
  variants,
} from "./c601164-common.mjs";
const [
  primaryFile,
  oldFile,
  storedFile,
  groupsFile,
  alignmentsFile,
  planFile,
  output,
] = process.argv.slice(2);
const primary = matchedEvidenceSchema.parse(read(primaryFile)),
  old = acousticBundleSchema.parse(read(oldFile)),
  stored = storedBundleSchema.parse(read(storedFile)),
  plan = read(planFile);
if (
  hashFile(primaryFile) !== plan.primaryHash ||
  hashFile(groupsFile) !== plan.groupsHash ||
  objectHash(plan.policy) !== objectHash(GROUP_POLICY)
)
  throw Error("Frozen plan identity mismatch");
const preserved = replayPrimaryAssembly(primary, true),
  legacy = replayPrimaryAssembly(primary, false);
const cases = deriveAcousticCases(
  legacy.trace,
  preserved.trace,
  primary.source.sourceSampleRate,
);
if (
  objectHash(cases) !== objectHash(stored.cases) ||
  objectHash(cases) !== objectHash(old.cases)
)
  throw Error("Seed lineage mismatch");
for (const o of stored.observations)
  if (objectHash(consumeStoredWhisper(o.rawResponse, o)) !== objectHash(o))
    throw Error("Stored parser mapping changed");
const stage = preserved.trace.find(
  (t) => t.stageName === "deduplicateTopScoreWinners",
).output;
const groups = read(groupsFile).map((g) => sourceGroupSchema.parse(g));
if (
  objectHash(groups) !==
  objectHash(
    cases.map((c) => prepareSourceGroup(c, stage, stored.observations)),
  )
)
  throw Error("Frozen neighbor allowlist mismatch");
const alignments = read(alignmentsFile).map((a) => alignmentSchema.parse(a));
const native = groups.map((g) =>
  buildGroupPatch(
    g,
    stored.observations.find((o) => o.requestId === g.representativeRequestId),
    "native",
    undefined,
    stored.observations.find(
      (o) => o.caseBindingHash === g.caseBindingHash && o.windowId === "w1",
    ),
  ),
);
const aligned = groups.map((g) =>
  buildGroupPatch(
    g,
    stored.observations.find((o) => o.requestId === g.representativeRequestId),
    "aligned",
    alignments.find((a) => a.requestId === g.representativeRequestId),
    stored.observations.find(
      (o) => o.caseBindingHash === g.caseBindingHash && o.windowId === "w1",
    ),
  ),
);
fs.mkdirSync(output);
const files = [],
  summaries = [],
  all = {};
const write = (p, v) => {
  const bytes =
    typeof v === "string"
      ? v
      : JSON.stringify(v, (k, v) => (k === "generatedAt" ? undefined : v), 2);
  fs.mkdirSync(path.dirname(path.join(output, p)), { recursive: true });
  fs.writeFileSync(path.join(output, p), bytes, { flag: "wx" });
  files.push({
    path: p,
    sha256: sha256(bytes),
    size: Buffer.byteLength(bytes),
  });
};
const implementationHashes = Object.fromEntries(
  Object.entries(plan.codeHashes).map(([p, h]) => [p, h]),
);
for (const variant of variants) {
  const patches = variant === "T1-native-group" ? native : aligned;
  const result =
    variant === "T0-baseline"
      ? replayPrimaryAssembly(primary, true, implementationHashes, {
          mode: "apply",
          decisions: cases.map((c) => decideAcoustic(c, old.observations)),
        })
      : replayPrimaryAssembly(
          primary,
          true,
          implementationHashes,
          undefined,
          undefined,
          {
            mode: variant === "T2-application-disabled" ? "observe" : "apply",
            patches,
          },
        );
  const cues = result.cues;
  all[variant] = cues;
  const escaped = cues.map((c) => ({
    ...c,
    text: c.text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
  }));
  const rendered = {
    ass: formatAss(cues),
    srt: formatSrt(escaped),
    vtt: formatVtt(escaped),
  };
  if (variant === "T0-baseline" && plan.baselineExportHashes)
    for (const ext of ["ass", "srt", "vtt"])
      if (sha256(rendered[ext]) !== plan.baselineExportHashes[ext])
        throw Error("T0 does not reproduce the frozen .16.3 baseline");
  for (const [ext, parser] of Object.entries({
    ass: parseAss,
    srt: parseSrt,
    vtt: parseVtt,
  })) {
    write(`${variant}/machine-candidate.${ext}`, rendered[ext]);
    const parsed = parser(
      fs.readFileSync(
        path.join(output, variant, `machine-candidate.${ext}`),
        "utf8",
      ),
    );
    if (
      parsed.length !== cues.length ||
      parsed.some(
        (c, i) =>
          c.text.replaceAll("\n", "") !==
            cues[i].text.replaceAll("\n", "").trim() ||
          Math.abs(c.start - cues[i].start) >
            (ext === "ass" ? 0.011 : 0.0011) ||
          Math.abs(c.end - cues[i].end) > (ext === "ass" ? 0.011 : 0.0011),
      )
    )
      throw Error("Export roundtrip failed");
  }
  const pkg = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: primary.source.fileName,
      container: "matroska",
      durationSeconds: primary.source.durationSeconds,
    },
    identity: { title: null, season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: primary.source.audioStream,
    },
    subtitleFiles: {
      ass: "./machine-candidate.ass",
      srt: "./machine-candidate.srt",
      vtt: "./machine-candidate.vtt",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues,
    warnings: [
      "PRIMARY_ONLY_MATCHED_PROFILE",
      "CONDITIONAL_ALIGNMENT_NOT_LEXICAL_TRUTH",
      "NOT_RELEASE_AUTHORIZED",
    ],
  });
  write(`${variant}/subtitle-package.needs-review.json`, pkg);
  write(`${variant}/stage-trace.json`, result.trace);
  const actual =
    result.trace.find(
      (t) => t.stageName === "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP",
    )?.evidence.applied ?? [];
  write(`${variant}/mutation-journal.json`, {
    proposals: variant === "T0-baseline" ? [] : patches,
    appliedPatchIds: actual,
  });
  const state = {
    variant,
    cueCount: cues.length,
    textHash: objectHash(cues.map((c) => c.text)),
    timingHash: objectHash(cues.map((c) => [c.start, c.end])),
    presentationHash: objectHash(rendered),
    appliedGroups: actual.length,
    status: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    defaultPromotionAuthorized: false,
    machineOnlyReleaseAuthorized: false,
  };
  write(`${variant}/generation-state.json`, state);
  summaries.push(state);
}
if (
  objectHash(all["T0-baseline"]) !== objectHash(all["T2-application-disabled"])
)
  throw Error("Application-disabled differs from T0");
const overlap = (c, w) => c.end > w.start && c.start < w.end;
const outside = (cs) =>
  cs.filter((c) => !groups.some((g) => overlap(c, g.readEnvelope)));
for (const v of variants)
  if (objectHash(outside(all[v])) !== objectHash(outside(all["T0-baseline"])))
    throw Error("Outside envelope exports mutated");
write("patches-native.json", native);
write("patches-aligned.json", aligned);
write(
  "export-diffs.json",
  Object.fromEntries(
    variants.slice(1).map((v) => [v, exportDiff(all["T0-baseline"], all[v])]),
  ),
);
write(
  "side-evidence.json",
  old.observations
    .filter((o) => o.family === "reazon")
    .map((o) => ({
      ...o,
      role: "WINDOW_LEVEL_DIAGNOSTIC",
      independentLexicalVote: false,
      veto: false,
    })),
);
fs.writeFileSync(
  path.join(output, "experiment-manifest.json"),
  JSON.stringify(
    {
      version: "c601164-generation-v1",
      files,
      variants: summaries,
      freezeCompletedAt: new Date().toISOString(),
      newInference: 0,
      modelLoads: 0,
      providerStarts: 0,
      newASRRequests: 0,
      newDecodedAudioSeconds: 0,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  "Generated four source-bound controls",
  summaries.map((s) => ({
    variant: s.variant,
    cues: s.cueCount,
    applied: s.appliedGroups,
  })),
);
