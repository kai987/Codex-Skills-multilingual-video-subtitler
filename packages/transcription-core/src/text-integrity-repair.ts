import { createHash } from "node:crypto";

import {
  textIntegrityRepairArtifactSchema,
  type AtomicHypothesisClustersArtifact,
  type CueSegmentationPlanArtifact,
  type FinalTextIntegrityArtifact,
  type SubtitleCue,
  type TextIntegrityRepairArtifact,
  type TopScoreResolutionArtifact,
  type WinnerDeduplicationArtifact,
} from "@mvl/shared";
import {
  analyzeJapaneseBoundary,
  analyzeJapaneseText,
} from "@mvl/subtitle-core";

import { analyzeFinalTextIntegrity } from "./text-integrity.js";
import { isHighContainmentRepetition } from "./repetition.js";

const REPAIRABLE_CODES = new Set([
  "FINAL_SINGLE_CHARACTER_FRAGMENT",
  "FINAL_EXTREME_SHORT_DURATION",
  "FINAL_INCOMPLETE_MORPHEME",
  "FINAL_INCOMPLETE_CLAUSE",
  "FINAL_TEXT_BOUNDARY_BREAK",
  "SEGMENTATION_UNRESOLVED",
]);

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[♪\s、。，．,.!?！？…]/gu, "");
}

function complete(text: string): boolean {
  const analysis = analyzeJapaneseText(text);
  return (
    !analysis.singleCharacter &&
    !analysis.startsMidWord &&
    !analysis.endsMidWord &&
    !analysis.likelyIncompleteClause
  );
}

function knownNonSpeechBoilerplate(text: string): boolean {
  return /(?:ご視聴ありがとうございました|チャンネル登録|字幕をご覧|この動画)/u.test(
    text,
  );
}

function mergeRepairAllowed(cue: SubtitleCue): boolean {
  return (
    cue.style !== "music" &&
    cue.provenance?.sourceLayer !== "reference-original-language"
  );
}

function compatible(left: SubtitleCue, right: SubtitleCue): boolean {
  const leftAnchors = new Set(left.provenance?.referenceAnchorIds ?? []);
  const rightAnchors = right.provenance?.referenceAnchorIds ?? [];
  const sharedAnchor = rightAnchors.some((id) => leftAnchors.has(id));
  const leftUnits = new Set(left.provenance?.referenceUnitIds ?? []);
  const sharedUnit = (right.provenance?.referenceUnitIds ?? []).some((id) =>
    leftUnits.has(id),
  );
  return (
    left.style === right.style &&
    (sharedAnchor || sharedUnit || right.start - left.end <= 0.45)
  );
}

export type JapaneseCueMergeRelationship =
  | "complementary-fragments"
  | "duplicate-hypotheses"
  | "different-complete-utterances"
  | "insufficient-timing-evidence";

function evidenceBoundary(
  cue: SubtitleCue,
  side: "start" | "end",
): number | null {
  const token =
    side === "start"
      ? cue.timingEvidence?.tokens[0]?.start
      : cue.timingEvidence?.tokens.at(-1)?.end;
  if (token !== undefined) return token;
  const speech =
    side === "start"
      ? cue.timingEvidence?.speechStart
      : cue.timingEvidence?.speechEnd;
  if (speech !== null && speech !== undefined) return speech;
  const intervals = cue.timingEvidence?.speechIntervals ?? [];
  return side === "start"
    ? (intervals[0]?.start ?? null)
    : (intervals.at(-1)?.end ?? null);
}

export function classifyJapaneseCueMerge(
  left: SubtitleCue,
  right: SubtitleCue,
): { relationship: JapaneseCueMergeRelationship; evidence: string[] } {
  if (
    normalized(left.text) === normalized(right.text) ||
    isHighContainmentRepetition(left.text, right.text, 6, 0.72)
  ) {
    return {
      relationship: "duplicate-hypotheses",
      evidence: ["high-containment-or-normalized-duplicate"],
    };
  }
  const leftAnalysis = analyzeJapaneseText(left.text);
  const rightAnalysis = analyzeJapaneseText(right.text);
  const boundary = analyzeJapaneseBoundary(left.text, right.text);
  const leftBoundaryFragment =
    leftAnalysis.endsMidWord ||
    (boundary.boundarySplitsWord &&
      boundary.evidence.includes("hiragana-auxiliary-continuation") &&
      !/[.!?。．！？…」』）】]$/u.test(left.text.trim()));
  const rightBoundaryFragment =
    rightAnalysis.startsMidWord ||
    (boundary.boundarySplitsWord &&
      boundary.confidence >= 0.8 &&
      boundary.evidence.some((entry) =>
        entry.startsWith("intl-token-crosses-boundary:"),
      ));
  const sharedAnchor = (left.provenance?.referenceAnchorIds ?? []).some((id) =>
    (right.provenance?.referenceAnchorIds ?? []).includes(id),
  );
  const crossesDistinctAnchors =
    (left.provenance?.referenceAnchorIds.length ?? 0) > 0 &&
    (right.provenance?.referenceAnchorIds.length ?? 0) > 0 &&
    !sharedAnchor;
  if (crossesDistinctAnchors) {
    return {
      relationship: "different-complete-utterances",
      evidence: ["distinct-reference-anchors"],
    };
  }
  if (
    !leftBoundaryFragment ||
    !rightBoundaryFragment ||
    !boundary.boundarySplitsWord ||
    boundary.confidence < 0.8
  ) {
    return {
      relationship: "different-complete-utterances",
      evidence: [
        ...boundary.evidence,
        `left-ends-mid-word:${String(leftBoundaryFragment)}`,
        `right-starts-mid-word:${String(rightBoundaryFragment)}`,
      ],
    };
  }
  const leftEnd = evidenceBoundary(left, "end");
  const rightStart = evidenceBoundary(right, "start");
  const timingContinuous =
    leftEnd !== null &&
    rightStart !== null &&
    rightStart >= leftEnd - 0.15 &&
    rightStart - leftEnd <= 0.6;
  if (!timingContinuous) {
    return {
      relationship: "insufficient-timing-evidence",
      evidence: [
        ...boundary.evidence,
        "missing-continuous-token-or-speech-boundary",
      ],
    };
  }
  return {
    relationship: "complementary-fragments",
    evidence: [
      ...boundary.evidence,
      ...(leftAnalysis.endsMidWord
        ? []
        : ["left-fragment-inferred-from-hiragana-auxiliary-boundary"]),
      ...(rightAnalysis.startsMidWord
        ? []
        : ["right-fragment-inferred-from-intl-word-boundary"]),
      `supported-boundary:${leftEnd.toFixed(3)}-${rightStart.toFixed(3)}`,
    ],
  };
}

export function mergeJapaneseCueTexts(
  cues: readonly SubtitleCue[],
): { text: string; evidence: string[] } | null {
  if (cues.length < 2) return null;
  const evidence: string[] = [];
  for (let index = 0; index < cues.length - 1; index += 1) {
    const left = cues[index];
    const right = cues[index + 1];
    if (left === undefined || right === undefined) return null;
    const relation = classifyJapaneseCueMerge(left, right);
    evidence.push(...relation.evidence);
    if (relation.relationship !== "complementary-fragments") return null;
  }
  const text = cues.map((cue) => cue.text.trim()).join("");
  if (
    cues.some((cue, index) =>
      cues
        .slice(index + 1)
        .some((other) =>
          isHighContainmentRepetition(cue.text, other.text, 6, 0.72),
        ),
    )
  ) {
    return null;
  }
  const analysis = analyzeJapaneseText(text);
  if (analysis.startsMidWord || analysis.endsMidWord) return null;
  return { text, evidence };
}

function combineCues(
  cues: readonly SubtitleCue[],
  suffix: string,
): SubtitleCue {
  const first = cues[0];
  const last = cues.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("Cannot combine an empty cue collection");
  }
  const merge = mergeJapaneseCueTexts(cues);
  if (merge === null) {
    throw new Error("Unsafe Japanese cue merge was rejected");
  }
  const text = merge.text;
  const requestIds = [
    ...new Set(cues.flatMap((cue) => cue.provenance?.sourceRequestIds ?? [])),
  ];
  const anchorIds = [
    ...new Set(cues.flatMap((cue) => cue.provenance?.referenceAnchorIds ?? [])),
  ];
  const unitIds = [
    ...new Set(cues.flatMap((cue) => cue.provenance?.referenceUnitIds ?? [])),
  ];
  return {
    ...first,
    id: `${cues.map((cue) => cue.id).join("+")}-${suffix}`,
    start: Math.min(...cues.map((cue) => cue.start)),
    end: Math.max(...cues.map((cue) => cue.end)),
    text,
    confidence: Math.max(...cues.map((cue) => cue.confidence ?? 0)),
    ...(first.provenance === undefined
      ? {}
      : {
          provenance: {
            ...first.provenance,
            sourceRequestIds: requestIds,
            referenceAnchorIds: anchorIds,
            referenceUnitIds: unitIds,
            independentSupportCount: Math.max(
              ...cues.map(
                (cue) => cue.provenance?.independentSupportCount ?? 0,
              ),
            ),
          },
        }),
    textAudit: {
      rawAsrText: cues
        .map((cue) => cue.textAudit?.rawAsrText ?? cue.text)
        .join(""),
      repairedText: text,
      normalizedText: text,
      winnerClusterIds: [
        ...new Set(
          cues.flatMap((cue) => cue.textAudit?.winnerClusterIds ?? []),
        ),
      ],
      sourceWinnerCueIds: cues.flatMap(
        (cue) => cue.textAudit?.sourceWinnerCueIds ?? [cue.id],
      ),
      replacements: cues.flatMap((cue) => cue.textAudit?.replacements ?? []),
      deduplicationActions: cues.flatMap(
        (cue) => cue.textAudit?.deduplicationActions ?? [],
      ),
      repairType: suffix,
      reviewRecommended: cues.some(
        (cue) => cue.textAudit?.reviewRecommended ?? false,
      ),
      reviewReasons: [
        ...new Set(cues.flatMap((cue) => cue.textAudit?.reviewReasons ?? [])),
      ],
    },
    timingEvidence: {
      sourceTrusted: cues.every(
        (cue) => cue.timingEvidence?.sourceTrusted ?? false,
      ),
      speechStart: first.timingEvidence?.speechStart ?? first.start,
      speechEnd: last.timingEvidence?.speechEnd ?? last.end,
      tokenTimestampsAvailable: cues.some(
        (cue) => cue.timingEvidence?.tokenTimestampsAvailable ?? false,
      ),
      tokenTimestampsUsed: cues.some(
        (cue) => cue.timingEvidence?.tokenTimestampsUsed ?? false,
      ),
      tokens: cues.flatMap((cue) => cue.timingEvidence?.tokens ?? []),
      alignmentSource: "semantic",
      presentationTimingMethod: "semantic",
      speechIntervals: cues.flatMap(
        (cue) => cue.timingEvidence?.speechIntervals ?? [],
      ),
    },
  };
}

function replaceCueCollection(
  cues: readonly SubtitleCue[],
  sourceIds: readonly string[],
  replacement: SubtitleCue,
): SubtitleCue[] {
  const removed = new Set(sourceIds);
  return [...cues.filter((cue) => !removed.has(cue.id)), replacement].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function hasHardFindingFor(
  cues: readonly SubtitleCue[],
  cueIds: readonly string[],
): boolean {
  const ids = new Set(cueIds);
  return analyzeFinalTextIntegrity({ cues }).artifact.findings.some(
    (finding) =>
      finding.severity === "hard" &&
      finding.cueIds.some((cueId) => ids.has(cueId)),
  );
}

export function repairTextIntegrityFailures(input: {
  cues: readonly SubtitleCue[];
  preliminary: FinalTextIntegrityArtifact;
  preSegmentationCues?: readonly SubtitleCue[];
  allCandidates?: readonly SubtitleCue[];
  atomicClusters?: AtomicHypothesisClustersArtifact;
  topScoreResolution?: TopScoreResolutionArtifact;
  winnerDeduplication?: WinnerDeduplicationArtifact;
  segmentationPlan?: CueSegmentationPlanArtifact;
  maximumRepairRounds?: number;
}): { cues: SubtitleCue[]; artifact: TextIntegrityRepairArtifact } {
  const maximumRepairRounds = Math.min(2, input.maximumRepairRounds ?? 2);
  const initialHash = hash(input.cues);
  const candidatesById = new Map(
    (input.allCandidates ?? []).map((cue) => [cue.id, cue] as const),
  );
  const preSegmentationById = new Map(
    (input.preSegmentationCues ?? []).map((cue) => [cue.id, cue] as const),
  );
  const resolutionByWinner = new Map(
    (input.topScoreResolution?.resolutions ?? []).flatMap((resolution) =>
      resolution.winnerCueId === null
        ? []
        : [[resolution.winnerCueId, resolution] as const],
    ),
  );
  const dedupDonors = new Map<string, string[]>();
  for (const record of input.winnerDeduplication?.records ?? []) {
    if (
      ![
        "near-duplicate",
        "prefix-duplicate",
        "suffix-duplicate",
        "kana-kanji-equivalent",
      ].includes(record.kind)
    ) {
      continue;
    }
    dedupDonors.set(record.keptCueId, record.removedCueIds);
  }
  let cues = [...input.cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const repairs: TextIntegrityRepairArtifact["repairs"] = [];
  const rounds: TextIntegrityRepairArtifact["rounds"] = [];
  let preliminary = input.preliminary;

  for (let round = 1; round <= maximumRepairRounds; round += 1) {
    const roundInputHash = hash(cues);
    const findings = preliminary.findings.filter((finding) =>
      REPAIRABLE_CODES.has(finding.code),
    );
    let attempts = 0;
    let successes = 0;
    const repairedCueIds = new Set<string>();
    for (const finding of findings) {
      const current = cues.find((cue) => finding.cueIds.includes(cue.id));
      if (current === undefined) continue;
      if (repairedCueIds.has(current.id)) continue;
      const before = { start: current.start, end: current.end };
      const currentIndex = cues.findIndex((cue) => cue.id === current.id);
      const previous = cues[currentIndex - 1];
      const next = cues[currentIndex + 1];
      let replacement: SubtitleCue | null = null;
      let sourceIds = [current.id];
      let strategy:
        | TextIntegrityRepairArtifact["repairs"][number]["repairStrategy"]
        | null = null;
      let donor: SubtitleCue | null = null;
      let evidence: string[] = [];

      const segmentationEntry = input.segmentationPlan?.entries.find(
        (entry) =>
          entry.outputCueIds.includes(current.id) &&
          (entry.decision === "split" || entry.decision === "unresolved"),
      );
      const parent = segmentationEntry?.sourceCueIds
        .map((id) => preSegmentationById.get(id))
        .find(
          (cue) =>
            cue !== undefined &&
            complete(cue.text) &&
            !knownNonSpeechBoilerplate(cue.text),
        );
      attempts += 1;
      if (parent !== undefined) {
        const siblings = segmentationEntry?.outputCueIds.filter((id) =>
          cues.some((cue) => cue.id === id),
        ) ?? [current.id];
        const candidate = {
          ...parent,
          id: `${parent.id}-segmentation-restored`,
        };
        const proposed = replaceCueCollection(cues, siblings, candidate);
        if (!hasHardFindingFor(proposed, [candidate.id])) {
          replacement = candidate;
          sourceIds = siblings;
          strategy = "restore-pre-segmentation";
          donor = parent;
          evidence = [
            `segmentation-parent:${parent.id}`,
            `segmentation-children:${siblings.join(",")}`,
            "complete-pre-segmentation-winner",
          ];
        }
      }

      if (replacement === null) {
        const clusterIds = current.textAudit?.winnerClusterIds ?? [];
        const candidateIds =
          input.atomicClusters?.clusters
            .filter((cluster) => clusterIds.includes(cluster.id))
            .flatMap((cluster) => cluster.candidateCueIds) ?? [];
        const alternatives = candidateIds
          .map((id) => candidatesById.get(id))
          .filter(
            (cue): cue is SubtitleCue =>
              cue !== undefined &&
              cue.id !== current.id &&
              complete(cue.text) &&
              !knownNonSpeechBoilerplate(cue.text) &&
              normalized(cue.text).length >= normalized(current.text).length,
          )
          .toSorted(
            (left, right) =>
              (right.confidence ?? 0) - (left.confidence ?? 0) ||
              right.text.length - left.text.length,
          );
        const alternative = alternatives[0];
        if (alternative !== undefined) {
          const candidate = {
            ...current,
            text: alternative.text,
            textAudit: {
              ...(current.textAudit ?? {
                rawAsrText: current.text,
                repairedText: current.text,
                normalizedText: current.text,
                winnerClusterIds: clusterIds,
                sourceWinnerCueIds: [current.id],
                replacements: [],
                deduplicationActions: [],
                reviewRecommended: false,
                reviewReasons: [],
              }),
              repairedText: alternative.text,
              normalizedText: alternative.text,
              repairType: "runner-up-text-donor",
            },
          };
          const proposed = replaceCueCollection(cues, sourceIds, candidate);
          if (!hasHardFindingFor(proposed, [candidate.id])) {
            replacement = candidate;
            strategy = "runner-up-text-donor";
            donor = alternative;
            evidence = [
              `same-atomic-cluster:${clusterIds.join(",")}`,
              "runner-up-is-morphologically-complete",
            ];
          }
        }
      }

      if (replacement === null) {
        const alternative = (dedupDonors.get(current.id) ?? [])
          .map((id) => candidatesById.get(id))
          .find(
            (cue) =>
              cue !== undefined &&
              complete(cue.text) &&
              !knownNonSpeechBoilerplate(cue.text) &&
              normalized(cue.text).length >= normalized(current.text).length,
          );
        if (alternative !== undefined) {
          const candidate = { ...current, text: alternative.text };
          const proposed = replaceCueCollection(cues, sourceIds, candidate);
          if (!hasHardFindingFor(proposed, [candidate.id])) {
            replacement = candidate;
            strategy = "deduplicated-text-donor";
            donor = alternative;
            evidence = ["superseded-equivalent-retained-as-repair-evidence"];
          }
        }
      }

      if (
        replacement === null &&
        mergeRepairAllowed(current) &&
        previous !== undefined &&
        next !== undefined &&
        compatible(previous, current) &&
        compatible(current, next)
      ) {
        const merge = mergeJapaneseCueTexts([previous, current, next]);
        if (merge !== null) {
          const candidate = combineCues(
            [previous, current, next],
            "text-integrity-three-way",
          );
          const proposed = replaceCueCollection(
            cues,
            [previous.id, current.id, next.id],
            candidate,
          );
          if (!hasHardFindingFor(proposed, [candidate.id])) {
            replacement = candidate;
            sourceIds = [previous.id, current.id, next.id];
            strategy = "merge-three-way";
            evidence = [
              ...merge.evidence,
              "atomic-three-way-repair",
              "pairwise-complementarity-verified",
              "whole-result-repetition-check-passed",
            ];
          }
        }
      }

      if (
        replacement === null &&
        mergeRepairAllowed(current) &&
        previous !== undefined &&
        compatible(previous, current)
      ) {
        const merge = mergeJapaneseCueTexts([previous, current]);
        if (merge !== null) {
          const candidate = combineCues(
            [previous, current],
            "text-integrity-previous",
          );
          const proposed = replaceCueCollection(
            cues,
            [previous.id, current.id],
            candidate,
          );
          if (!hasHardFindingFor(proposed, [candidate.id])) {
            replacement = candidate;
            sourceIds = [previous.id, current.id];
            strategy = "merge-previous";
            evidence = [...merge.evidence, "previous-first-policy"];
          }
        }
      }

      if (
        replacement === null &&
        mergeRepairAllowed(current) &&
        next !== undefined &&
        compatible(current, next)
      ) {
        const merge = mergeJapaneseCueTexts([current, next]);
        if (merge !== null) {
          const candidate = combineCues([current, next], "text-integrity-next");
          const proposed = replaceCueCollection(
            cues,
            [current.id, next.id],
            candidate,
          );
          if (!hasHardFindingFor(proposed, [candidate.id])) {
            replacement = candidate;
            sourceIds = [current.id, next.id];
            strategy = "merge-next";
            evidence = [...merge.evidence, "prefix-continuation"];
          }
        }
      }

      if (
        replacement === null &&
        current.end - current.start < 0.25 &&
        complete(current.text)
      ) {
        const tokenStart = current.timingEvidence?.tokens[0]?.start;
        const tokenEnd = current.timingEvidence?.tokens.at(-1)?.end;
        const speechStart = current.timingEvidence?.speechStart;
        const speechEnd = current.timingEvidence?.speechEnd;
        const start = Math.max(0, tokenStart ?? speechStart ?? current.start);
        const end = tokenEnd ?? speechEnd ?? current.end;
        if (end - start >= 0.25) {
          replacement = { ...current, start, end };
          strategy = "expand-duration";
          donor = current;
          evidence = [
            tokenStart === undefined
              ? "speech-boundary-timing"
              : "token-timing",
            "character-ratio-timing-disabled",
          ];
        }
      }

      if (replacement === null || strategy === null) continue;
      cues = replaceCueCollection(cues, sourceIds, replacement);
      for (const sourceId of sourceIds) repairedCueIds.add(sourceId);
      repairedCueIds.add(replacement.id);
      successes += 1;
      const resolution =
        resolutionByWinner.get(current.id) ??
        [...resolutionByWinner.values()].find((entry) =>
          entry.candidateCueIds.includes(current.id),
        );
      repairs.push({
        id: `text-integrity-repair-${String(repairs.length + 1).padStart(5, "0")}`,
        round,
        sourceFindingCodes: [finding.code],
        sourceCueIds: sourceIds,
        sourceClusterIds: current.textAudit?.winnerClusterIds ?? [],
        repairStrategy: strategy,
        beforeText: sourceIds
          .map((id) => input.cues.find((cue) => cue.id === id)?.text ?? "")
          .join(""),
        afterText: replacement.text,
        beforeInterval: before,
        afterInterval: { start: replacement.start, end: replacement.end },
        textDonorCueId: donor?.id ?? null,
        timingDonorCueId:
          strategy === "expand-duration" ? (donor?.id ?? null) : null,
        originalWinnerCueId: resolution?.winnerCueId ?? current.id,
        winnerScore: resolution?.winnerScore ?? null,
        textDonorScore:
          donor === null
            ? null
            : resolution?.candidateCueIds.includes(donor.id)
              ? resolution.runnerUpCueId === donor.id
                ? resolution.runnerUpScore
                : donor.confidence
              : donor.confidence,
        evidence,
        result: "repaired",
      });
    }
    preliminary = analyzeFinalTextIntegrity({
      cues,
      ...(input.segmentationPlan === undefined
        ? {}
        : { segmentationPlan: input.segmentationPlan }),
    }).artifact;
    rounds.push({
      round,
      inputHash: roundInputHash,
      outputHash: hash(cues),
      candidateFindingCount: findings.length,
      repairAttemptCount: attempts,
      successfulRepairCount: successes,
    });
    if (successes === 0) break;
  }

  const stillHardBlockedCount = preliminary.findings.filter(
    (finding) => finding.severity === "hard",
  ).length;
  const count = (
    strategy: TextIntegrityRepairArtifact["repairs"][number]["repairStrategy"],
  ): number =>
    repairs.filter((repair) => repair.repairStrategy === strategy).length;
  const artifact = textIntegrityRepairArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: initialHash,
    outputHash: hash(cues),
    configuration: {
      maximumRepairRounds,
      characterRatioTimingAllowed: false,
    },
    rounds,
    repairs,
    summary: {
      candidateFindingCount: input.preliminary.findings.filter((finding) =>
        REPAIRABLE_CODES.has(finding.code),
      ).length,
      repairAttemptCount: rounds.reduce(
        (sum, round) => sum + round.repairAttemptCount,
        0,
      ),
      successfulRepairCount: repairs.length,
      failedRepairCount: Math.max(
        0,
        rounds.reduce((sum, round) => sum + round.repairAttemptCount, 0) -
          repairs.length,
      ),
      restoredCueCount: repairs.length,
      replacedByRunnerUpCount: count("runner-up-text-donor"),
      restoredPreSegmentationCueCount: count("restore-pre-segmentation"),
      mergedWithPreviousCount: count("merge-previous"),
      mergedWithNextCount: count("merge-next"),
      threeWayMergeCount: count("merge-three-way"),
      durationExpansionCount: count("expand-duration"),
      stillHardBlockedCount,
    },
    fallback: repairs.length === 0 ? "no-safe-text-integrity-repair" : null,
  });
  return { cues, artifact };
}
