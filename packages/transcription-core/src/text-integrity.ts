import { createHash } from "node:crypto";

import {
  type CueCandidateEvidenceArtifact,
  finalTextIntegrityArtifactSchema,
  type CueSegmentationPlanArtifact,
  type FinalTextIntegrityArtifact,
  type FinalTextIntegrityFinding,
  type HypothesisResolutionArtifact,
  type JapaneseTextAnalysisArtifact,
  type LyricsTextValidityArtifact,
  type SubtitleCue,
  type TextIntegrityMode,
} from "@mvl/shared";
import {
  analyzeJapaneseBoundary,
  analyzeJapaneseText,
} from "@mvl/subtitle-core";

export interface FinalTextIntegrityResult {
  cues: SubtitleCue[];
  artifact: FinalTextIntegrityArtifact;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceCueIds(cues: readonly SubtitleCue[]): string[] {
  return [
    ...new Set(
      cues.flatMap((cue) =>
        cue.provenance?.sourceRequestIds.length
          ? cue.provenance.sourceRequestIds
          : [cue.id],
      ),
    ),
  ];
}

function requestIds(cues: readonly SubtitleCue[]): string[] {
  return [
    ...new Set(cues.flatMap((cue) => cue.provenance?.sourceRequestIds ?? [])),
  ];
}

function anchorIds(cues: readonly SubtitleCue[]): string[] {
  return [
    ...new Set(cues.flatMap((cue) => cue.provenance?.referenceAnchorIds ?? [])),
  ];
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[♪\s、。，．,.!?！？…]/gu, "");
}

function similarity(left: string, right: string): number {
  const leftCharacters = new Set(Array.from(normalized(left)));
  const rightCharacters = new Set(Array.from(normalized(right)));
  if (leftCharacters.size === 0 && rightCharacters.size === 0) return 1;
  const common = [...leftCharacters].filter((entry) =>
    rightCharacters.has(entry),
  ).length;
  return (2 * common) / Math.max(1, leftCharacters.size + rightCharacters.size);
}

function makeFinding(input: {
  index: number;
  code: FinalTextIntegrityFinding["code"];
  severity: FinalTextIntegrityFinding["severity"];
  category: FinalTextIntegrityFinding["category"];
  interval: { start: number; end: number };
  cues: readonly SubtitleCue[];
  reasons: string[];
}): FinalTextIntegrityFinding {
  return {
    id: `text-integrity-${String(input.index).padStart(5, "0")}`,
    code: input.code,
    severity: input.severity,
    category: input.category,
    interval: input.interval,
    cueIds: input.cues.map((cue) => cue.id),
    sourceCueIds: sourceCueIds(input.cues),
    sourceRequestIds: requestIds(input.cues),
    referenceAnchorIds: anchorIds(input.cues),
    reasons: input.reasons,
  };
}

export function runFinalTextIntegrityGate(input: {
  cues: readonly SubtitleCue[];
  mode?: TextIntegrityMode;
  japaneseTextAnalysis?: JapaneseTextAnalysisArtifact;
  candidateEvidence?: CueCandidateEvidenceArtifact;
  hypothesisResolution?: HypothesisResolutionArtifact;
  segmentationPlan?: CueSegmentationPlanArtifact;
  lyricsValidity?: LyricsTextValidityArtifact;
  ordinaryHardMinimumDurationSeconds?: number;
  ordinaryWarningMinimumDurationSeconds?: number;
  singleCharacterMinimumDurationSeconds?: number;
}): FinalTextIntegrityResult {
  const mode = input.mode ?? "enforce";
  const hardMinimum = input.ordinaryHardMinimumDurationSeconds ?? 0.25;
  const warningMinimum = input.ordinaryWarningMinimumDurationSeconds ?? 0.5;
  const singleCharacterMinimum =
    input.singleCharacterMinimumDurationSeconds ?? 0.4;
  if (mode === "off") {
    const artifact = finalTextIntegrityArtifactSchema.parse({
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      inputHash: hash(input.cues),
      configuration: {
        mode,
        ordinaryHardMinimumDurationSeconds: hardMinimum,
        ordinaryWarningMinimumDurationSeconds: warningMinimum,
        singleCharacterMinimumDurationSeconds: singleCharacterMinimum,
      },
      validationStatus: "passed",
      candidateCueCount: input.cues.length,
      finalCueCount: input.cues.length,
      quarantinedCueIds: [],
      findings: [],
      metrics: {
        singleCharacterFragmentCount: 0,
        extremeShortDurationCueCount: 0,
        incompleteMorphemeCount: 0,
        incompleteClauseCount: 0,
        boundarySplitCount: 0,
        competingHypothesesFinalCount: 0,
        nearDuplicateSemanticCueCount: 0,
        lyricsHallucinationCount: 0,
        lyricsIncompleteLineCount: 0,
        segmentationUnresolvedCount: 0,
      },
      fallback: "text-integrity-disabled-by-user",
    });
    return { cues: [...input.cues], artifact };
  }

  const analysisByCue = new Map(
    input.japaneseTextAnalysis?.cues.map((entry) => [
      entry.cueId,
      entry.analysis,
    ]) ?? [],
  );
  const supportedSplitByCue = new Map([
    ...(input.segmentationPlan?.entries ?? []).flatMap((entry) =>
      entry.decision === "split" && entry.method !== "character-ratio"
        ? entry.outputCueIds.map((cueId) => [cueId, entry.id] as const)
        : [],
    ),
    ...input.cues.flatMap((cue) => {
      const match = /^(.*)-semantic-(\d{2,})$/u.exec(cue.id);
      const method = cue.timingEvidence?.presentationTimingMethod;
      const parentId = match?.[1];
      return parentId !== undefined && method !== null && method !== undefined
        ? ([[cue.id, `inherited-supported-split:${parentId}`]] as const)
        : [];
    }),
  ]);
  const findings: FinalTextIntegrityFinding[] = [];
  const hardCueIds = new Set<string>();
  const add = (
    finding: Omit<Parameters<typeof makeFinding>[0], "index">,
  ): void => {
    const value = makeFinding({ ...finding, index: findings.length + 1 });
    findings.push(value);
    if (value.severity === "hard") {
      for (const cueId of value.cueIds) hardCueIds.add(cueId);
    }
  };

  for (const cue of input.cues) {
    const duration = cue.end - cue.start;
    const analysis = analysisByCue.get(cue.id) ?? analyzeJapaneseText(cue.text);
    const trustedReferenceOriginal =
      cue.textSource === "reference-original-language" ||
      cue.provenance?.sourceLayer === "reference-original-language";
    const musicCue =
      cue.style === "music" ||
      cue.provenance?.sourceLayer === "lyrics-asr" ||
      trustedReferenceOriginal;
    const supportedPresentationSplit = supportedSplitByCue.has(cue.id);
    const acousticEvidence =
      (cue.confidence ?? 0) >= 0.6 &&
      (cue.transcriptionMetrics?.noSpeechProbability ?? 0) < 0.5;
    if (analysis.singleCharacter) {
      const protectedInterjection =
        trustedReferenceOriginal ||
        (analysis.standaloneInterjectionLikelihood >= 0.75 &&
          acousticEvidence &&
          duration >= singleCharacterMinimum);
      if (!protectedInterjection) {
        add({
          code: "FINAL_SINGLE_CHARACTER_FRAGMENT",
          severity: "hard",
          category: "fragment",
          interval: { start: cue.start, end: cue.end },
          cues: [cue],
          reasons: [
            `duration:${duration.toFixed(3)}`,
            `interjection-likelihood:${analysis.standaloneInterjectionLikelihood.toFixed(3)}`,
            `acoustic-evidence:${String(acousticEvidence)}`,
          ],
        });
      }
    }
    if (duration < hardMinimum && !trustedReferenceOriginal) {
      add({
        code: "FINAL_EXTREME_SHORT_DURATION",
        severity: "hard",
        category: "fragment",
        interval: { start: cue.start, end: cue.end },
        cues: [cue],
        reasons: [
          `duration-below-hard-minimum:${duration.toFixed(3)}<${hardMinimum.toFixed(3)}`,
        ],
      });
    } else if (duration < warningMinimum && !trustedReferenceOriginal) {
      add({
        code: "FINAL_EXTREME_SHORT_DURATION",
        severity: "warning",
        category: "fragment",
        interval: { start: cue.start, end: cue.end },
        cues: [cue],
        reasons: [
          `duration-below-warning-minimum:${duration.toFixed(3)}<${warningMinimum.toFixed(3)}`,
        ],
      });
    }
    if (
      !musicCue &&
      !supportedPresentationSplit &&
      (analysis.startsMidWord || analysis.endsMidWord)
    ) {
      add({
        code: "FINAL_INCOMPLETE_MORPHEME",
        severity: "hard",
        category: "text",
        interval: { start: cue.start, end: cue.end },
        cues: [cue],
        reasons: [
          `starts-mid-word:${String(analysis.startsMidWord)}`,
          `ends-mid-word:${String(analysis.endsMidWord)}`,
        ],
      });
    } else if (!musicCue && analysis.likelyIncompleteClause) {
      add({
        code: "FINAL_INCOMPLETE_CLAUSE",
        severity: "warning",
        category: "text",
        interval: { start: cue.start, end: cue.end },
        cues: [cue],
        reasons: ["japanese-clause-does-not-form-confident-terminal-unit"],
      });
    }
  }

  const candidateById = new Map(
    input.candidateEvidence?.candidates.map((candidate) => [
      candidate.cueId,
      candidate,
    ]) ?? [],
  );
  for (const cue of input.cues) {
    if (cue.style === "music") continue;
    if (supportedSplitByCue.has(cue.id)) continue;
    const cueAnalysis =
      analysisByCue.get(cue.id) ?? analyzeJapaneseText(cue.text);
    const completeSemanticMerge =
      cue.id.endsWith("-semantic-merge") &&
      (cue.provenance?.sourceRequestIds.length ?? 0) >= 2 &&
      !cueAnalysis.startsMidWord &&
      !cueAnalysis.endsMidWord &&
      !cueAnalysis.likelyIncompleteClause;
    if (completeSemanticMerge) continue;
    for (const unresolved of input.hypothesisResolution?.unresolvedIntervals ??
      []) {
      const unresolvedCandidates = unresolved.candidateCueIds
        .map((candidateId) => candidateById.get(candidateId))
        .filter((candidate) => candidate !== undefined);
      const precedingBoundary = unresolvedCandidates.find(
        (candidate) =>
          Math.abs(candidate.interval.end - cue.start) <= 0.45 &&
          analyzeJapaneseBoundary(candidate.text, cue.text).boundarySplitsWord,
      );
      const followingBoundary = unresolvedCandidates.find(
        (candidate) =>
          Math.abs(cue.end - candidate.interval.start) <= 0.45 &&
          analyzeJapaneseBoundary(cue.text, candidate.text).boundarySplitsWord,
      );
      const boundaryCandidate = precedingBoundary ?? followingBoundary;
      if (boundaryCandidate === undefined) continue;
      const boundary =
        precedingBoundary === undefined
          ? analyzeJapaneseBoundary(cue.text, boundaryCandidate.text)
          : analyzeJapaneseBoundary(boundaryCandidate.text, cue.text);
      if (boundary.confidence < 0.8) continue;
      add({
        code: "FINAL_TEXT_BOUNDARY_BREAK",
        severity: "hard",
        category: "text",
        interval: {
          start: Math.min(cue.start, boundaryCandidate.interval.start),
          end: Math.max(cue.end, boundaryCandidate.interval.end),
        },
        cues: [cue],
        reasons: [
          "surviving-cue-is-a-word-fragment-adjacent-to-unresolved-hypothesis",
          `unresolved-cluster:${unresolved.clusterId}`,
          ...boundary.evidence,
        ],
      });
      break;
    }
  }

  const sorted = [...input.cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (left === undefined || right === undefined) continue;
    const boundary = analyzeJapaneseBoundary(left.text, right.text);
    const supportedSiblingBoundary =
      supportedSplitByCue.get(left.id) !== undefined &&
      supportedSplitByCue.get(left.id) === supportedSplitByCue.get(right.id);
    if (
      left.style !== "music" &&
      right.style !== "music" &&
      !supportedSiblingBoundary &&
      right.start - left.end <= 0.45 &&
      boundary.boundarySplitsWord &&
      boundary.confidence >= 0.8
    ) {
      add({
        code: "FINAL_TEXT_BOUNDARY_BREAK",
        severity: "hard",
        category: "text",
        interval: { start: left.start, end: right.end },
        cues: [left, right],
        reasons: boundary.evidence,
      });
    }
    const overlap =
      Math.min(left.end, right.end) - Math.max(left.start, right.start);
    if (
      overlap > 0 &&
      similarity(left.text, right.text) >= 0.85 &&
      left.id !== right.id
    ) {
      add({
        code: "FINAL_NEAR_DUPLICATE_SEMANTIC_CUE",
        severity: "hard",
        category: "hypothesis",
        interval: {
          start: Math.min(left.start, right.start),
          end: Math.max(left.end, right.end),
        },
        cues: [left, right],
        reasons: ["overlapping-final-cues-have-near-duplicate-semantic-text"],
      });
    }
  }

  for (const unresolved of input.hypothesisResolution?.unresolvedIntervals ??
    []) {
    add({
      code: "FINAL_COMPETING_HYPOTHESES",
      severity: "warning",
      category: "hypothesis",
      interval: { start: unresolved.start, end: unresolved.end },
      cues: input.cues.filter((cue) =>
        unresolved.candidateCueIds.includes(cue.id),
      ),
      reasons: unresolved.reasons,
    });
  }
  for (const entry of input.segmentationPlan?.entries ?? []) {
    if (entry.decision !== "unresolved") continue;
    add({
      code: "SEGMENTATION_UNRESOLVED",
      severity: "warning",
      category: "segmentation",
      interval: entry.originalInterval,
      cues: input.cues.filter((cue) => entry.outputCueIds.includes(cue.id)),
      reasons: entry.reasons,
    });
  }
  for (const sequence of input.lyricsValidity?.sequences ?? []) {
    if (sequence.validity === "valid") continue;
    const sequenceCues = input.cues.filter((cue) =>
      sequence.cueIds.includes(cue.id),
    );
    add({
      code:
        sequence.validity === "hallucination"
          ? "FINAL_LYRICS_HALLUCINATION"
          : sequence.validity === "incomplete"
            ? "FINAL_LYRICS_INCOMPLETE_LINE"
            : "FINAL_REFERENCE_SEMANTIC_CONFLICT",
      severity: sequence.validity === "hallucination" ? "hard" : "warning",
      category: sequence.validity === "unresolved" ? "semantic" : "lyrics",
      interval: sequence.interval,
      cues: sequenceCues,
      reasons: sequence.reasons,
    });
  }

  const quarantinedCueIds =
    mode === "enforce" ? [...hardCueIds].toSorted() : [];
  const cues =
    mode === "enforce"
      ? input.cues.filter((cue) => !hardCueIds.has(cue.id))
      : [...input.cues];
  const finalCueIds = new Set(cues.map((cue) => cue.id));
  const competingHypothesesFinalCount = (
    input.hypothesisResolution?.resolutions ?? []
  ).reduce((count, resolution) => {
    const survivingCandidateCount = resolution.candidateCueIds.filter((cueId) =>
      finalCueIds.has(cueId),
    ).length;
    return count + Math.max(0, survivingCandidateCount - 1);
  }, 0);
  const count = (code: FinalTextIntegrityFinding["code"]): number =>
    findings.filter((finding) => finding.code === code).length;
  const artifact = finalTextIntegrityArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash(input.cues),
    configuration: {
      mode,
      ordinaryHardMinimumDurationSeconds: hardMinimum,
      ordinaryWarningMinimumDurationSeconds: warningMinimum,
      singleCharacterMinimumDurationSeconds: singleCharacterMinimum,
    },
    validationStatus: findings.length === 0 ? "passed" : "needs-review",
    candidateCueCount: input.cues.length,
    finalCueCount: cues.length,
    quarantinedCueIds,
    findings,
    metrics: {
      singleCharacterFragmentCount: count("FINAL_SINGLE_CHARACTER_FRAGMENT"),
      extremeShortDurationCueCount: count("FINAL_EXTREME_SHORT_DURATION"),
      incompleteMorphemeCount: count("FINAL_INCOMPLETE_MORPHEME"),
      incompleteClauseCount: count("FINAL_INCOMPLETE_CLAUSE"),
      boundarySplitCount: count("FINAL_TEXT_BOUNDARY_BREAK"),
      competingHypothesesFinalCount,
      nearDuplicateSemanticCueCount: count("FINAL_NEAR_DUPLICATE_SEMANTIC_CUE"),
      lyricsHallucinationCount: count("FINAL_LYRICS_HALLUCINATION"),
      lyricsIncompleteLineCount: count("FINAL_LYRICS_INCOMPLETE_LINE"),
      segmentationUnresolvedCount: count("SEGMENTATION_UNRESOLVED"),
    },
    fallback: null,
  });
  return { cues, artifact };
}

export function analyzeFinalTextIntegrity(
  input: Omit<Parameters<typeof runFinalTextIntegrityGate>[0], "mode">,
): FinalTextIntegrityResult {
  return runFinalTextIntegrityGate({ ...input, mode: "observe" });
}

export function applyFinalTextIntegrityGate(
  input: Parameters<typeof runFinalTextIntegrityGate>[0],
): FinalTextIntegrityResult {
  return runFinalTextIntegrityGate(input);
}
