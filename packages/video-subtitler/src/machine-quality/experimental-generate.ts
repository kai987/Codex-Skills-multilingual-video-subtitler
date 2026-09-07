function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required evidence/index absent");
  return value;
}
import fs from "node:fs";
import path from "node:path";
import { subtitlePackageSchema, type SubtitleCue } from "@mvl/shared";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";
import {
  machineQualityEvidenceSchema,
  objectHash,
  primaryMinimal,
  sha256,
} from "./experimental-profile.js";
import { recoverUnprovenRepetition } from "./experimental-repetition-recovery.js";
const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4)
  throw new Error("Expected only machine evidence and new output directory");
const bytes = fs.readFileSync(input);
const evidence = machineQualityEvidenceSchema.parse(
  JSON.parse(bytes.toString()),
);
fs.mkdirSync(output);
const recovery = recoverUnprovenRepetition(evidence, true),
  disabled = recoverUnprovenRepetition(evidence, false);
const variants = {
  "baselines/B0-primary-minimal": primaryMinimal(evidence),
  "baselines/B1-current-stable": evidence.stableCues,
  "candidate/B2-recovered": recovery.cues,
  "ablation/B2-repair-disabled": disabled.cues,
};
const files: {
  path: string;
  sha256: string;
  size: number;
}[] = [];
const write = (rel: string, value: string) => {
  const p = path.join(output, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, value, { flag: "wx" });
  files.push({
    path: rel,
    sha256: sha256(value),
    size: Buffer.byteLength(value),
  });
};
const summaries = [];
for (const [name, cues] of Object.entries(variants)) {
  const safeHtml = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const htmlCues: SubtitleCue[] = cues.map((c) => ({
    ...c,
    text: safeHtml(c.text),
  }));
  const rendered = {
    ass: formatAss(cues),
    srt: formatSrt(htmlCues),
    vtt: formatVtt(htmlCues),
  };
  const parsed = {
    ass: parseAss(rendered.ass),
    srt: parseSrt(rendered.srt),
    vtt: parseVtt(rendered.vtt),
  };
  for (const ext of ["ass", "srt", "vtt"] as const) {
    if (
      parsed[ext].length !== cues.length ||
      parsed[ext].some(
        (c, i) =>
          c.text.replace(/\r?\n/gu, "") !==
            requireValue(cues[i]).text.replace(/\r?\n/gu, "").trim() ||
          Math.abs(c.start - requireValue(cues[i]).start) >
            (ext === "ass" ? 0.011 : 0.0011) ||
          Math.abs(c.end - requireValue(cues[i]).end) >
            (ext === "ass" ? 0.011 : 0.0011),
      )
    )
      throw new Error("Serialization mismatch: " + name + "/" + ext);
    write(name + "/machine-candidate." + ext, rendered[ext]);
  }
  const pkg = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: evidence.source.fileName,
      container: "matroska",
      durationSeconds: evidence.source.durationSeconds,
    },
    identity: { title: null, season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: evidence.source.audioStream,
    },
    subtitleFiles: {
      srt: "./machine-candidate.srt",
      vtt: "./machine-candidate.vtt",
      ass: "./machine-candidate.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues,
    warnings: ["EXPERIMENTAL_MACHINE_QUALITY_NOT_RELEASE_AUTHORIZED"],
  });
  write(
    name + "/subtitle-package.needs-review.json",
    JSON.stringify(pkg, null, 2),
  );
  const summary = {
    variant: name,
    cueCount: cues.length,
    textHash: objectHash(cues.map((c) => c.text)),
    timingHash: objectHash(cues.map((c) => ({ start: c.start, end: c.end }))),
    sourceHash: evidence.source.sha256,
    status: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    humanValidated: false,
    roundTrip: true,
    presentationOverflowCues: cues.filter(
      (c) =>
        c.text.split("\n").length > 2 ||
        c.text.split("\n").some((l) => Array.from(l).length > 16),
    ).length,
  };
  write(name + "/generation-state.json", JSON.stringify(summary, null, 2));
  summaries.push(summary);
}
write(
  "candidate/B2-recovered/mutation-journal.json",
  JSON.stringify(recovery.journal, null, 2),
);
write(
  "ablation/B2-repair-disabled/mutation-journal.json",
  JSON.stringify(disabled.journal, null, 2),
);
write(
  "stage-trace/availability.json",
  JSON.stringify(
    {
      primary: "baselines/B0-primary-minimal",
      historicalCandidateSelection: "unavailable-as-rendered-snapshot",
      historicalDedup: "verified-operation-records-in-evidence",
      stableTimelineExport: "baselines/B1-current-stable",
      recoveredExport: "candidate/B2-recovered",
      fullStablePipelineReplay: false,
      causalClaim:
        "same-scaffold repair on/off only; historical B1 descriptive",
    },
    null,
    2,
  ),
);
write(
  "OUTPUT_INDEX.md",
  "# C6.0.1.16 experimental machine drafts\n\nOpen candidate/B2-recovered/machine-candidate.ass for the new candidate. It is needs-review, not human-validated and not authorized for automatic release. B0 and B1 are comparisons. Quality must be read from the separate evaluation; existence is not acceptance.\n",
);
const manifest = {
  version: "c60116-experiment-v1",
  profile: "experimental/machine-quality",
  evidenceHash: sha256(bytes),
  configuration: {
    repair: "preserve-unproven-primary-repetition-v1",
    configurationNumber: 1,
    primarySelection:
      "frozen baseline requests only; exact request identity dedup; source-time sort",
    seed: null,
  },
  partition: evidence.partition,
  source: evidence.source,
  provenance: evidence.provenance,
  primaryRequests: evidence.primaryRequests.map(({ segments, ...r }) => {
    void segments;
    return r;
  }),
  allowedGenerationInputs: [
    "machine-evidence.json",
    "repository-code-and-dependencies",
  ],
  humanInputCount: 0,
  newASRRequests: 0,
  newInference: 0,
  modelLoads: 0,
  providerStarts: 0,
  retries: 0,
  cacheReadsInGeneration: 0,
  frozenPrimaryCacheResultsReused: evidence.primaryRequests.length,
  variants: summaries,
  files,
  freezeCompletedAt: new Date().toISOString(),
  status: "needs-review",
  finalizationMethod: "none",
  machineOnlyReleaseAuthorized: false,
  humanValidated: false,
};
fs.writeFileSync(
  path.join(output, "experiment-manifest.json"),
  JSON.stringify(manifest, null, 2),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    variants: summaries,
    applied: recovery.journal.filter((j) => j.applied).length,
  }),
);
