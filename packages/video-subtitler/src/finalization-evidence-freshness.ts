import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  c519MemoryReplaySummarySchema,
  memoryAssistedCtcTargetAuditSchema,
  subtitleFinalizationEvidenceFreshnessSchema,
  subtitleLocalCtcBoundaryEvidenceSchema,
  type C519MemoryReplaySummary,
  type MemoryAssistedCtcTargetAudit,
  type SubtitleLocalCtcBoundaryEvidence,
  type SubtitleFinalizationEvidenceFreshness,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import { sha256LocalFile } from "./finalization-support.js";
import {
  C60_EVIDENCE_FRESHNESS_VERSION,
  c60SemanticHash,
} from "./finalization-risk-policy.js";

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export interface EvaluateEvidenceFreshnessInput {
  generatedAt: string;
  taskRoot: string;
  subtitleDirectory: string;
  policyHash: string;
  baseCueHash: string;
  baseTimingHash: string;
  reviewPackage: SubtitleReviewPackage;
}

export type C60FreshnessStatus =
  SubtitleFinalizationEvidenceFreshness["entries"][number]["freshnessStatus"];

export interface C60FreshnessDecisionInput {
  laterEvidencePresent: boolean;
  targetRecovered: boolean;
  cueIdentityMatched: boolean;
  canonicalHashMatched: boolean;
  timingHashMatched: boolean;
  semanticSubjectMatched: boolean;
  lineageCompatible: boolean;
  canonicalTextChanged: boolean;
  canonicalTimingChanged: boolean;
}

export function determineC60FreshnessStatus(
  input: C60FreshnessDecisionInput,
): C60FreshnessStatus {
  if (
    input.laterEvidencePresent &&
    input.targetRecovered &&
    input.cueIdentityMatched &&
    input.canonicalHashMatched &&
    input.timingHashMatched &&
    input.semanticSubjectMatched &&
    input.lineageCompatible &&
    !input.canonicalTextChanged &&
    !input.canonicalTimingChanged
  ) {
    return "superseded";
  }
  if (!input.laterEvidencePresent) return "missing-later-evidence";
  if (!input.cueIdentityMatched) return "cue-mismatch";
  if (!input.canonicalHashMatched) return "hash-mismatch";
  if (!input.timingHashMatched) return "timing-changed";
  if (!input.semanticSubjectMatched) return "subject-mismatch";
  if (input.canonicalTextChanged) return "canonical-changed";
  if (input.canonicalTimingChanged) return "timing-changed";
  if (!input.lineageCompatible) return "lineage-mismatch";
  return "current";
}

export async function evaluateFinalizationEvidenceFreshness(
  input: EvaluateEvidenceFreshnessInput,
): Promise<SubtitleFinalizationEvidenceFreshness> {
  const originalPath = path.join(
    input.subtitleDirectory,
    "subtitle-local-ctc-boundary-evidence.json",
  );
  const laterPath = path.join(
    input.subtitleDirectory,
    "memory-assisted-ctc-target-audit.json",
  );
  const replaySummaryPath = path.join(
    input.taskRoot,
    "c5-19-memory-replay-summary.json",
  );
  let originalHash = "0".repeat(64);
  let laterHash: string | null = null;
  let original: SubtitleLocalCtcBoundaryEvidence | null = null;
  let later: MemoryAssistedCtcTargetAudit | null = null;
  let replay: C519MemoryReplaySummary | null = null;
  const globalFailures: string[] = [];

  try {
    original = subtitleLocalCtcBoundaryEvidenceSchema.parse(
      await readJson(originalPath),
    );
    originalHash = await sha256LocalFile(originalPath);
  } catch {
    globalFailures.push("ORIGINAL_CTC_EVIDENCE_INVALID_OR_MISSING");
  }
  try {
    later = memoryAssistedCtcTargetAuditSchema.parse(await readJson(laterPath));
    laterHash = await sha256LocalFile(laterPath);
  } catch {
    globalFailures.push("LATER_MEMORY_EVIDENCE_INVALID_OR_MISSING");
  }
  try {
    replay = c519MemoryReplaySummarySchema.parse(
      await readJson(replaySummaryPath),
    );
  } catch {
    globalFailures.push("C5_19_REPLAY_PROVENANCE_INVALID_OR_MISSING");
  }

  const replayHashesMatch =
    replay !== null &&
    later !== null &&
    replay.hashes.ctcTargetAuditSemanticHash === later.semanticHash &&
    replay.hashes.canonicalCueHash === input.baseCueHash &&
    replay.hashes.canonicalTimingHash === input.baseTimingHash;
  if (!replayHashesMatch) globalFailures.push("LATER_EVIDENCE_HASH_MISMATCH");
  const originalHashesMatch =
    original !== null &&
    original.baseCueHash === input.baseCueHash &&
    original.baseTimingHash === input.baseTimingHash;
  if (!originalHashesMatch)
    globalFailures.push("ORIGINAL_EVIDENCE_HASH_MISMATCH");

  const reviewByCue = new Map<
    string,
    { componentId: string; blockerPresent: boolean }
  >();
  for (const item of input.reviewPackage.items) {
    for (const cueId of item.targetCueIds) {
      reviewByCue.set(cueId, {
        componentId: item.speakerEvidenceComponentId ?? "unknown-component",
        blockerPresent: item.blockers.includes("CTC_TARGET_UNREPRESENTABLE"),
      });
    }
  }
  const candidates = later?.cues.filter((cue) => !cue.beforeEncodable) ?? [];
  const entries = candidates.map((cue) => {
    const review = reviewByCue.get(cue.cueId);
    const cueIdentityMatched = review?.blockerPresent === true;
    const canonicalHashMatched =
      originalHashesMatch && replayHashesMatch && later !== null;
    const timingHashMatched = canonicalHashMatched;
    const semanticSubjectMatched = cueIdentityMatched;
    const lineageCompatible =
      cue.memoryEntryIds.length > 0 && replayHashesMatch;
    const canonicalTextChanged = false;
    const canonicalTimingChanged = replay === null;
    const targetRecovered =
      cue.afterProjectionEncodable &&
      cue.projectionUsed &&
      cue.beforeUnknownCount > 0 &&
      cue.afterUnknownCount === 0;
    const freshnessStatus = determineC60FreshnessStatus({
      laterEvidencePresent: later !== null,
      targetRecovered,
      cueIdentityMatched,
      canonicalHashMatched,
      timingHashMatched,
      semanticSubjectMatched,
      lineageCompatible,
      canonicalTextChanged,
      canonicalTimingChanged,
    });
    const superseded = freshnessStatus === "superseded";
    const reasonCodes = [
      ...(superseded ? ["LATER_C5_19_TARGET_ENCODABILITY_VERIFIED"] : []),
      ...(!cueIdentityMatched ? ["FRESHNESS_CUE_IDENTITY_MISMATCH"] : []),
      ...(!canonicalHashMatched ? ["FRESHNESS_CANONICAL_HASH_MISMATCH"] : []),
      ...(!timingHashMatched ? ["FRESHNESS_TIMING_HASH_MISMATCH"] : []),
      ...(!lineageCompatible ? ["FRESHNESS_LINEAGE_MISMATCH"] : []),
      ...(canonicalTimingChanged ? ["FRESHNESS_CANONICAL_TIMING_CHANGED"] : []),
      ...globalFailures,
    ].toSorted();
    return {
      freshnessId: `freshness-${cue.cueId}`,
      code: "CTC_TARGET_UNREPRESENTABLE",
      cueId: cue.cueId,
      componentId: review?.componentId ?? null,
      originalEvidenceRef: "subtitle-local-ctc-boundary-evidence.json",
      originalEvidenceHash: originalHash,
      laterEvidenceRef: "memory-assisted-ctc-target-audit.json",
      laterEvidenceHash: laterHash,
      canonicalCueHash: input.baseCueHash,
      canonicalTimingHash: input.baseTimingHash,
      semanticSubject: `cue:${cue.cueId}:ctc-target-encodability`,
      originalMeaning: "CTC target was not representable.",
      laterMeaning: cue.afterProjectionEncodable
        ? "C5.19 pronunciation projection makes the same cue representable."
        : "Later evidence does not establish target encodability.",
      cueIdentityMatched,
      canonicalHashMatched,
      timingHashMatched,
      semanticSubjectMatched,
      lineageCompatible,
      canonicalTextChanged,
      canonicalTimingChanged,
      freshnessStatus,
      supersededByEvidenceIds: cue.memoryEntryIds,
      reasonCodes,
    };
  });
  if (entries.length !== 2) {
    globalFailures.push("EXPECTED_TWO_C5_19_RESCUED_CUES_NOT_FOUND");
  }
  const failedCount =
    entries.filter((entry) => entry.freshnessStatus !== "superseded").length +
    (globalFailures.length > 0 ? 1 : 0);
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-finalization-evidence-freshness" as const,
    freshnessVersion: C60_EVIDENCE_FRESHNESS_VERSION,
    generatedAt: input.generatedAt,
    policyHash: input.policyHash,
    baseCueHash: input.baseCueHash,
    baseTimingHash: input.baseTimingHash,
    entries,
    summary: {
      assessedCount: entries.length,
      currentCount: entries.filter(
        (entry) => entry.freshnessStatus === "current",
      ).length,
      supersededCount: entries.filter(
        (entry) => entry.freshnessStatus === "superseded",
      ).length,
      failedCount,
    },
    integrityPassed: failedCount === 0 && entries.length === 2,
  };
  return subtitleFinalizationEvidenceFreshnessSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}
