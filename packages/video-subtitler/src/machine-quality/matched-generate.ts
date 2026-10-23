import fs from "node:fs";
import path from "node:path";
import { subtitlePackageSchema } from "@mvl/shared";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";
import {
  matchedEvidenceSchema,
  replayPrimaryAssembly,
  REPLAY_SCOPE,
  MATCHED_GATE_POLICY,
} from "./matched-replay.js";
import { primaryMinimal, objectHash, sha256 } from "./experimental-profile.js";

export function generateMatched(input: string, output: string) {
  const bytes = fs.readFileSync(input);
  const evidence = matchedEvidenceSchema.parse(JSON.parse(bytes.toString()));
  fs.mkdirSync(output);
  const repo = path.resolve(import.meta.dirname, "../../..");
  const implementations: Record<string, string> = {
    primaryMinimal:
      "video-subtitler/dist/machine-quality/experimental-profile.js",
    deduplicateTopScoreWinners:
      "transcription-core/dist/winner-deduplication.js",
    repairIntraCueHypothesisRepetition:
      "transcription-core/dist/intra-cue-repetition.js",
    buildAcousticSemanticCueSegments: "subtitle-core/dist/segmentation.js",
    layoutSubtitleCuesWithDiagnostics: "subtitle-core/dist/layout.js",
  };
  const implementationHashes = Object.fromEntries(
    Object.entries(implementations).map(([k, p]) => [
      k,
      sha256(fs.readFileSync(path.join(repo, p))),
    ]),
  );
  implementationHashes.buildAcousticSemanticCueSegments = objectHash({
    business: implementationHashes.buildAcousticSemanticCueSegments,
    identityAdapter: sha256(
      fs.readFileSync(
        path.join(
          repo,
          "video-subtitler/dist/machine-quality/matched-replay.js",
        ),
      ),
    ),
  });
  const legacy = replayPrimaryAssembly(evidence, false, implementationHashes);
  const repaired = replayPrimaryAssembly(evidence, true, implementationHashes);
  const disabled = replayPrimaryAssembly(evidence, false, implementationHashes);
  if (objectHash(legacy.cues) !== objectHash(disabled.cues))
    throw new Error("Repair-disabled differs from legacy");
  const variants = [
    {
      name: "R0-primary-minimal",
      cues: primaryMinimal(evidence),
      trace: legacy.trace.slice(0, 1),
    },
    { name: "R1-legacy-replay", ...legacy },
    { name: "R2-source-preserving", ...repaired },
    { name: "R2-repair-disabled", ...disabled },
  ];
  const files: { path: string; sha256: string; size: number }[] = [];
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
  // Wall-clock fields are omitted from deterministic diagnostics, not replaced with invented run times.
  const json = (v: unknown) =>
    JSON.stringify(
      v,
      (key, value: unknown) => (key === "generatedAt" ? undefined : value),
      2,
    );
  const summaries = [];
  for (const v of variants) {
    const cues = v.cues;
    const html = cues.map((c) => ({
      ...c,
      text: c.text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
    }));
    const rendered = {
      ass: formatAss(cues),
      srt: formatSrt(html),
      vtt: formatVtt(html),
    };
    const parsers = { ass: parseAss, srt: parseSrt, vtt: parseVtt };
    for (const ext of ["ass", "srt", "vtt"] as const) {
      write(v.name + "/machine-candidate." + ext, rendered[ext]);
      const parsed = parsers[ext](
        fs.readFileSync(
          path.join(output, v.name, "machine-candidate." + ext),
          "utf8",
        ),
      );
      if (
        parsed.length !== cues.length ||
        parsed.some((c, i) => {
          const original = cues[i];
          if (!original) return true;
          return (
            c.text.replace(/\r?\n/gu, "") !==
              original.text.replace(/\r?\n/gu, "").trim() ||
            Math.abs(c.start - original.start) >
              (ext === "ass" ? 0.011 : 0.0011) ||
            Math.abs(c.end - original.end) > (ext === "ass" ? 0.011 : 0.0011)
          );
        })
      )
        throw new Error("Export roundtrip failed: " + v.name + "/" + ext);
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
        ass: "./machine-candidate.ass",
        srt: "./machine-candidate.srt",
        vtt: "./machine-candidate.vtt",
      },
      referenceSubtitles: [],
      video: { sourcePath: null, subtitledPath: null },
      cues,
      warnings: [
        "PRIMARY_ONLY_MATCHED_PROFILE",
        "UNRESOLVED_SOURCE_REPETITION_NOT_ACOUSTICALLY_CONFIRMED",
        "NOT_RELEASE_AUTHORIZED",
      ],
    });
    write(v.name + "/subtitle-package.needs-review.json", json(pkg));
    write(v.name + "/stage-trace.json", json(v.trace));
    const summary = {
      variant: v.name,
      cueCount: cues.length,
      evidenceHash: sha256(bytes),
      textHash: objectHash(cues.map((c) => c.text)),
      timingHash: objectHash(cues.map((c) => [c.start, c.end])),
      presentationHash: objectHash(rendered),
      status: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      humanValidated: false,
      presentationOverflowCues: cues.filter(
        (c) =>
          c.text.split("\n").length > 2 ||
          c.text.split("\n").some((l) => Array.from(l).length > 16),
      ).length,
    };
    write(v.name + "/generation-state.json", json(summary));
    summaries.push(summary);
  }
  const journal = repaired.trace.flatMap((stage, i) => {
    const old = legacy.trace[i];
    if (!old) throw new Error("Trace stages differ");
    return [
      {
        stageName: stage.stageName,
        applied: old.outputHash !== stage.outputHash,
        input: old.output,
        output: stage.output,
        sourceIds: stage.occurrenceIds,
        reason: "SAME_EVIDENCE_STAGE_REEXECUTION_REPAIR_ON_OFF",
        inputMatched: old.inputHash === stage.inputHash,
        oldEvidence: old.evidence,
        newEvidence: stage.evidence,
      },
    ];
  });
  write("R2-source-preserving/mutation-journal.json", json(journal));
  const changedStage = legacy.trace.find(
    (t) => t.stageName === "repairIntraCueHypothesisRepetition",
  );
  const newStage = repaired.trace.find(
    (t) => t.stageName === "repairIntraCueHypothesisRepetition",
  );
  if (!changedStage || !newStage)
    throw new Error("Missing actual repetition stage");
  const cases = changedStage.operations
    .filter(
      (o) =>
        o.operation === "REPLACE" &&
        (o.reason.startsWith("highest-terminology") ||
          o.reason.startsWith("complete-high-support")),
    )
    .map((o) => ({
      inputHash: objectHash(o.affectedInput),
      sourceOccurrenceIds: o.sourceOccurrenceIds,
      sourceRequestIds: o.sourceRequestIds,
      before: o.affectedInput,
      legacyAfter: o.correspondingOutput,
      repairedAfter:
        newStage.operations.find(
          (n) => n.affectedInput.id === o.affectedInput.id,
        )?.correspondingOutput ?? [],
      acousticClassification: "UNKNOWN",
      sameModelWindowStability: "NOT_ESTABLISHED_SINGLE_PRIMARY_TRACK",
      crossModelAgreement: "UNAVAILABLE_IN_MATCHED_EVIDENCE",
      timingLocalizationSupport:
        "RAW_SEGMENT_BOUNDS_ONLY_NOT_REPEAT_LOCALIZATION",
      evidenceInsufficient: true,
      purpose: "offline diagnosis only; no extra evidence enters generation",
    }));
  write(
    "acoustic-check/existing-evidence.json",
    json({
      selectionRule:
        "all lexical replacements actually proposed by legacy intra-cue stage, before any reference evaluation",
      cases,
      newASRRequests: 0,
      inputAudioSeconds: 0,
      newModelLoads: 0,
      freshAcousticCheck: "NOT_RUN",
      confirmedRealRepeats: 0,
      confirmedHallucinations: 0,
      negativeControl:
        "same request duplicate import tested synthetically, not an acoustic validation",
    }),
  );
  write("replay-scope.json", json(REPLAY_SCOPE));
  write("evaluation-gate-policy.json", json(MATCHED_GATE_POLICY));
  write(
    "OUTPUT_INDEX.md",
    "# C6.0.1.16.1\n\n本轮新机器候选 ASS：R2-source-preserving/machine-candidate.ass。\n\nPrimary-only matched assembly replay, not new media recognition. needs-review; no automatic release. Stage snapshots retain every actual input/output and machine rationale. Diagnostic generatedAt fields are excluded from semantic parity.\n",
  );
  fs.writeFileSync(
    path.join(output, "experiment-manifest.json"),
    json({
      version: "c601161-replay-v1",
      profile: "experimental/primary-matched-assembly",
      evidenceHash: sha256(bytes),
      configurationNumber: 1,
      repair: "source-preserving-intra-cue-v1",
      source: evidence.source,
      partition: evidence.partition,
      promptStatus: evidence.promptStatus,
      replayScope: REPLAY_SCOPE.replayScope,
      matchedEvidenceVerified: true,
      repairDisabledParity: true,
      inputPolicy:
        "code, dependencies, strict primary-only machine evidence; no historical final, Gold, correction or deletion journal",
      primaryRequests: evidence.primaryRequests.map(({ segments, ...r }) => ({
        ...r,
        segmentCount: segments.length,
      })),
      newASRRequests: 0,
      newInference: 0,
      modelLoads: 0,
      providerStarts: 0,
      failures: 0,
      retries: 0,
      cacheReadsInGeneration: 0,
      frozenPrimaryCacheResultsReused: evidence.primaryRequests.length,
      variants: summaries,
      files,
      freezeCompletedAt: new Date().toISOString(),
      defaultPromotionAuthorized: false,
    }),
    { flag: "wx" },
  );
  return summaries;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4)
    throw new Error("Expected only primary evidence and new output directory");
  console.log(JSON.stringify(generateMatched(input, output)));
}
