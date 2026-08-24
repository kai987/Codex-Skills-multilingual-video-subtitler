import { createHash } from "node:crypto";

import {
  finalSubtitleRepairArtifactSchema,
  type FinalSubtitleIntegrityFinding,
  type FinalSubtitleRepairArtifact,
  type SubtitleCue,
} from "@mvl/shared";
import {
  analyzeJapaneseBoundary,
  analyzeJapaneseText,
} from "@mvl/subtitle-core";

import {
  classifyOverlapRelationship,
  selectTrustedOverlapBoundary,
} from "./overlap-classification.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[♪\s、。，．,.!?！？…]/gu, "");
}

function similarity(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const leftPairs = new Set(
    Array.from({ length: Math.max(0, a.length - 1) }, (_, index) =>
      a.slice(index, index + 2),
    ),
  );
  const rightPairs = new Set(
    Array.from({ length: Math.max(0, b.length - 1) }, (_, index) =>
      b.slice(index, index + 2),
    ),
  );
  const common = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
  return (2 * common) / Math.max(1, leftPairs.size + rightPairs.size);
}

function alternativeQuality(cue: SubtitleCue): number {
  const analysis = analyzeJapaneseText(cue.text);
  const duration = cue.end - cue.start;
  const cps =
    Array.from(normalized(cue.text)).length / Math.max(0.001, duration);
  return (
    (cue.textAudit?.winnerScore ?? cue.confidence ?? 0) * 3 +
    (cue.provenance?.independentSupportCount ?? 0) * 0.2 +
    (cue.timingEvidence?.tokenTimestampsUsed === true ? 0.35 : 0) +
    ((cue.timingEvidence?.speechIntervals?.length ?? 0) > 0 ? 0.15 : 0) +
    Number(!analysis.startsMidWord) * 0.1 +
    Number(!analysis.endsMidWord) * 0.1 +
    Number(!analysis.likelyIncompleteClause) * 0.1 -
    (cps > 20 ? 0.5 : 0)
  );
}

function trimCueToBoundary(
  cue: SubtitleCue,
  boundary: number,
  side: "start" | "end",
): SubtitleCue {
  const start = side === "start" ? boundary : cue.start;
  const end = side === "end" ? boundary : cue.end;
  const timingEvidence = cue.timingEvidence;
  return {
    ...cue,
    start,
    end,
    ...(timingEvidence === undefined
      ? {}
      : {
          timingEvidence: {
            ...timingEvidence,
            speechStart:
              timingEvidence.speechStart === null
                ? start
                : Math.max(start, timingEvidence.speechStart),
            speechEnd:
              timingEvidence.speechEnd === null
                ? end
                : Math.min(end, timingEvidence.speechEnd),
          },
        }),
    ...(cue.textAudit === undefined
      ? {}
      : {
          textAudit: {
            ...cue.textAudit,
            deduplicationActions: [
              ...cue.textAudit.deduplicationActions,
              `subtitle-overlap-boundary-trimmed-${side}`,
            ],
          },
        }),
  };
}

function mergeProvenance(kept: SubtitleCue, removed: SubtitleCue): SubtitleCue {
  if (kept.provenance === undefined) return kept;
  return {
    ...kept,
    provenance: {
      ...kept.provenance,
      sourceRequestIds: [
        ...new Set([
          ...kept.provenance.sourceRequestIds,
          ...(removed.provenance?.sourceRequestIds ?? []),
        ]),
      ],
      sourceProfileIds: [
        ...new Set([
          ...kept.provenance.sourceProfileIds,
          ...(removed.provenance?.sourceProfileIds ?? []),
        ]),
      ],
      referenceAnchorIds: [
        ...new Set([
          ...kept.provenance.referenceAnchorIds,
          ...(removed.provenance?.referenceAnchorIds ?? []),
        ]),
      ],
      referenceUnitIds: [
        ...new Set([
          ...kept.provenance.referenceUnitIds,
          ...(removed.provenance?.referenceUnitIds ?? []),
        ]),
      ],
      independentSupportCount: Math.max(
        kept.provenance.independentSupportCount,
        removed.provenance?.independentSupportCount ?? 0,
      ),
    },
  };
}

function splitLongCue(cue: SubtitleCue): SubtitleCue[] | null {
  const timingEvidence = cue.timingEvidence;
  if (timingEvidence === undefined) return null;
  const tokens = timingEvidence.tokens;
  if (tokens.length < 2) return null;
  const candidates = tokens.slice(0, -1).flatMap((token, index) => {
    const next = tokens[index + 1];
    if (next === undefined) return [];
    const pause = next.start - token.end;
    const balance = Math.abs((index + 1) / tokens.length - 0.5);
    return [{ index, pause, balance }];
  });
  const boundary = candidates.toSorted(
    (left, right) => right.pause - left.pause || left.balance - right.balance,
  )[0];
  if (boundary === undefined || boundary.pause < 0.08) return null;
  const leftTokens = tokens.slice(0, boundary.index + 1);
  const rightTokens = tokens.slice(boundary.index + 1);
  const leftText = leftTokens
    .map((token) => token.text)
    .join("")
    .trim();
  const rightText = rightTokens
    .map((token) => token.text)
    .join("")
    .trim();
  if (leftText === "" || rightText === "") return null;
  const semantic = analyzeJapaneseBoundary(leftText, rightText);
  if (
    semantic.boundarySplitsWord ||
    analyzeJapaneseText(leftText).startsMidWord ||
    analyzeJapaneseText(rightText).endsMidWord
  ) {
    return null;
  }
  const leftLastToken = leftTokens.at(-1);
  const rightFirstToken = rightTokens[0];
  if (leftLastToken === undefined || rightFirstToken === undefined) return null;
  const split = (leftLastToken.end + rightFirstToken.start) / 2;
  if (split - cue.start < 0.25 || cue.end - split < 0.25) return null;
  return [
    {
      ...cue,
      id: `${cue.id}-long-split-01`,
      end: split,
      text: leftText,
      timingEvidence: {
        ...timingEvidence,
        speechEnd: leftLastToken.end,
        tokens: leftTokens,
        alignmentSource: "token",
        presentationTimingMethod: "token",
      },
    },
    {
      ...cue,
      id: `${cue.id}-long-split-02`,
      start: split,
      text: rightText,
      timingEvidence: {
        ...timingEvidence,
        speechStart: rightFirstToken.start,
        tokens: rightTokens,
        alignmentSource: "token",
        presentationTimingMethod: "token",
      },
    },
  ];
}

export function repairFinalSubtitleIntegrity(input: {
  cues: readonly SubtitleCue[];
  findings: readonly FinalSubtitleIntegrityFinding[];
}): {
  cues: SubtitleCue[];
  artifact: FinalSubtitleRepairArtifact;
  supportedLongCueIds: string[];
} {
  const initialHash = hash(input.cues);
  let cues = [...input.cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const repairs: FinalSubtitleRepairArtifact["repairs"] = [];
  const supportedLongCueIds: string[] = [];

  for (const finding of input.findings) {
    if (
      ![
        "CROSS_CUE_EXACT_DUPLICATE",
        "CROSS_CUE_SENTENCE_LOOP",
        "CROSS_CUE_LONG_PHRASE_LOOP",
        "SUBTITLE_OVERLAP",
        "UNSUPPORTED_LONG_CUE",
      ].includes(finding.code)
    ) {
      continue;
    }
    const involved = finding.cueIds
      .map((id) => cues.find((cue) => cue.id === id))
      .filter((cue): cue is SubtitleCue => cue !== undefined)
      .toSorted((left, right) => left.start - right.start);
    if (involved.length === 0) continue;
    const before = {
      start: Math.min(...involved.map((cue) => cue.start)),
      end: Math.max(...involved.map((cue) => cue.end)),
    };
    let strategy: FinalSubtitleRepairArtifact["repairs"][number]["strategy"] =
      "unresolved";
    let result: FinalSubtitleRepairArtifact["repairs"][number]["result"] =
      "unresolved";
    let outputCueIds = involved.map((cue) => cue.id);
    let evidence = [...finding.reasons];

    if (finding.code === "UNSUPPORTED_LONG_CUE") {
      const cue = involved[0];
      if (cue === undefined) continue;
      const split = splitLongCue(cue);
      if (split !== null) {
        cues = [
          ...cues.filter((entry) => entry.id !== cue.id),
          ...split,
        ].toSorted((left, right) => left.start - right.start);
        strategy = "long-cue-split";
        result = "repaired";
        outputCueIds = split.map((entry) => entry.id);
        evidence = ["token-pause-boundary", "japanese-semantic-boundary"];
      } else {
        const analysis = analyzeJapaneseText(cue.text);
        const cps =
          Array.from(normalized(cue.text)).length / (cue.end - cue.start);
        const continuousSpeech =
          (cue.timingEvidence?.tokens.length ?? 0) > 1 ||
          (cue.timingEvidence?.speechIntervals?.length ?? 0) > 0;
        if (
          cue.end - cue.start <= 15 &&
          cps <= 16 &&
          continuousSpeech &&
          !analysis.startsMidWord &&
          !analysis.endsMidWord
        ) {
          supportedLongCueIds.push(cue.id);
          strategy = "supported-long-cue";
          result = "supported";
          evidence = [
            `cps:${cps.toFixed(3)}`,
            "continuous-speech-or-token-evidence",
            "no-safe-semantic-split-point",
          ];
        }
      }
    } else if (involved.length >= 2) {
      const left = involved[0];
      const right = involved[1];
      if (left === undefined || right === undefined) continue;
      const textSimilarity = similarity(left.text, right.text);
      const sameRequest = (left.provenance?.sourceRequestIds ?? []).some((id) =>
        (right.provenance?.sourceRequestIds ?? []).includes(id),
      );
      const sameAnchor = (left.provenance?.referenceAnchorIds ?? []).some(
        (id) => (right.provenance?.referenceAnchorIds ?? []).includes(id),
      );
      const overlapRelationship = classifyOverlapRelationship(left, right);
      if (
        ["exact-duplicate", "near-duplicate"].includes(
          overlapRelationship.relationship,
        )
      ) {
        const kept =
          normalized(right.text).length > normalized(left.text).length
            ? right
            : left;
        const removed = kept.id === left.id ? right : left;
        const merged = mergeProvenance(kept, removed);
        cues = [
          ...cues.filter((cue) => cue.id !== kept.id && cue.id !== removed.id),
          merged,
        ].toSorted((a, b) => a.start - b.start);
        strategy = "overlap-deduplicated";
        result = "repaired";
        outputCueIds = [merged.id];
        evidence = [
          `text-similarity:${textSimilarity.toFixed(3)}`,
          ...(sameRequest ? ["same-source-request"] : []),
          ...(sameAnchor ? ["same-reference-anchor"] : []),
          "provenance-merged",
        ];
      } else if (
        finding.code === "SUBTITLE_OVERLAP" &&
        overlapRelationship.relationship === "same-utterance-alternative"
      ) {
        const kept =
          alternativeQuality(right) > alternativeQuality(left) ? right : left;
        const removed = kept.id === left.id ? right : left;
        const selected = mergeProvenance(kept, removed);
        cues = [
          ...cues.filter((cue) => cue.id !== left.id && cue.id !== right.id),
          selected,
        ].toSorted((a, b) => a.start - b.start);
        strategy = "overlap-alternative-selected";
        result = "repaired";
        outputCueIds = [selected.id];
        evidence = [
          ...overlapRelationship.evidence,
          `selected-quality:${alternativeQuality(kept).toFixed(3)}`,
          `rejected-quality:${alternativeQuality(removed).toFixed(3)}`,
          "alternative-provenance-merged-without-text-concatenation",
        ];
      } else if (finding.code === "SUBTITLE_OVERLAP") {
        if (overlapRelationship.relationship === "complementary-fragments") {
          const combined = `${left.text.trim()}${right.text.trim()}`;
          const merged: SubtitleCue = mergeProvenance(
            {
              ...left,
              id: `${left.id}+${right.id}-subtitle-overlap-merge`,
              start: Math.min(left.start, right.start),
              end: Math.max(left.end, right.end),
              text: combined,
            },
            right,
          );
          cues = [
            ...cues.filter((cue) => cue.id !== left.id && cue.id !== right.id),
            merged,
          ].toSorted((a, b) => a.start - b.start);
          strategy = "overlap-merged";
          result = "repaired";
          outputCueIds = [merged.id];
          evidence = [
            ...overlapRelationship.evidence,
            "strict-complementary-fragments",
          ];
        } else if (
          overlapRelationship.relationship ===
          "different-dialogue-boundary-error"
        ) {
          const trustedBoundary = selectTrustedOverlapBoundary(left, right);
          if (trustedBoundary !== null) {
            const split = trustedBoundary.boundary;
            const repairedLeft = trimCueToBoundary(left, split, "end");
            const repairedRight = trimCueToBoundary(right, split, "start");
            cues = [
              ...cues.filter(
                (cue) => cue.id !== left.id && cue.id !== right.id,
              ),
              repairedLeft,
              repairedRight,
            ].toSorted((a, b) => a.start - b.start);
            strategy = "overlap-trimmed";
            result = "repaired";
            outputCueIds = [repairedLeft.id, repairedRight.id];
            evidence = [
              ...trustedBoundary.evidence,
              `boundary-source:${trustedBoundary.boundarySource}`,
              "both-cues-retained",
              "no-midpoint-fallback",
            ];
          }
        }
      } else if (
        finding.code === "CROSS_CUE_LONG_PHRASE_LOOP" ||
        finding.code === "CROSS_CUE_SENTENCE_LOOP"
      ) {
        const leftCore = normalized(left.text);
        const rightCore = normalized(right.text);
        let shared = "";
        for (
          let length = Math.min(leftCore.length, rightCore.length);
          length >= 4;
          length -= 1
        ) {
          const value = leftCore.slice(-length);
          if (rightCore.startsWith(value)) {
            shared = value;
            break;
          }
        }
        if (shared !== "" && right.text.includes(shared)) {
          const trimmed = right.text
            .slice(right.text.indexOf(shared) + shared.length)
            .trim();
          if (trimmed !== "" && !analyzeJapaneseText(trimmed).endsMidWord) {
            const repairedRight = { ...right, text: trimmed };
            cues = [
              ...cues.filter((cue) => cue.id !== right.id),
              repairedRight,
            ].toSorted((a, b) => a.start - b.start);
            strategy = "loop-boundary-trimmed";
            result = "repaired";
            outputCueIds = [left.id, repairedRight.id];
            evidence = [`shared-boundary-phrase:${shared}`];
          }
        }
      }
    }

    repairs.push({
      id: `final-subtitle-repair-${String(repairs.length + 1).padStart(5, "0")}`,
      findingCode:
        finding.code as FinalSubtitleRepairArtifact["repairs"][number]["findingCode"],
      strategy,
      sourceCueIds: involved.map((cue) => cue.id),
      outputCueIds,
      beforeInterval: before,
      afterIntervals: outputCueIds.flatMap((id) => {
        const cue = cues.find((entry) => entry.id === id);
        return cue === undefined ? [] : [{ start: cue.start, end: cue.end }];
      }),
      evidence,
      result,
    });
  }

  const count = (
    strategy: FinalSubtitleRepairArtifact["repairs"][number]["strategy"],
  ): number => repairs.filter((repair) => repair.strategy === strategy).length;
  const unresolvedOverlapCount = repairs.filter(
    (repair) =>
      repair.findingCode === "SUBTITLE_OVERLAP" &&
      repair.result === "unresolved",
  ).length;
  const artifact = finalSubtitleRepairArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: initialHash,
    outputHash: hash(cues),
    repairs,
    supportedLongCueIds,
    summary: {
      overlapFindingCount: input.findings.filter(
        (finding) => finding.code === "SUBTITLE_OVERLAP",
      ).length,
      overlapDeduplicatedCount: count("overlap-deduplicated"),
      overlapTrimmedCount: count("overlap-trimmed"),
      overlapMergedCount: count("overlap-merged"),
      overlapUnresolvedCount: unresolvedOverlapCount,
      longCueSplitCount: count("long-cue-split"),
      supportedLongCueCount: count("supported-long-cue"),
      loopBoundaryTrimCount: count("loop-boundary-trimmed"),
      loopDuplicateBlockRemovedCount: count("loop-duplicate-block-removed"),
      restoredCueCount: count("long-cue-split") + count("overlap-trimmed"),
      quarantinedAfterRepairCount: repairs.filter(
        (repair) => repair.result === "unresolved",
      ).length,
    },
    fallback:
      repairs.length === 0 ? "no-repairable-final-subtitle-findings" : null,
  });
  return { cues, artifact, supportedLongCueIds };
}
