import {
  c60114OrphanSpeechSweepSchema,
  type C60114Interval,
  type C60114OrphanEntry,
  type C60114OrphanSpeechSweep,
  type C60114Policy,
  type C60114ReviewTargets,
  type C60114SourceIdentity,
  type C60114SpeechIslands,
} from "@mvl/shared";
import {
  assertC60114SourceIdentity,
  c60114ArtifactHeader,
  c60114Coverage,
  c60114Id,
  c60114Intersection,
  uniqueC60114,
  withC60114SemanticHash,
} from "./c60114-policy.js";
import { c60114IslandForInterval } from "./source-global-speech-islands.js";

/** Audit rows are not detected orphans. Keep this gate shared by all consumers. */
export function isC60114ObservedOrphan(entry: C60114OrphanEntry): boolean {
  return (
    [
      "ORPHAN_SPEECH_OBSERVED",
      "ORPHAN_LEXICAL_POSSIBLE",
      "ORPHAN_MULTI_SOURCE_CONFIRMED",
    ].includes(entry.classification) &&
    entry.speechPositive &&
    !entry.strongContradiction &&
    entry.evidenceIds.length > 0
  );
}

/** Split at the exact coverage edges before classifying. A partly covered
 * speech interval never disappears behind a wide parent or neighboring cue. */
export function buildC60114OrphanSpeechSweep(input: {
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  speechIslands: C60114SpeechIslands;
  finalCues: readonly ({ id: string } & C60114Interval)[];
  reviewTargets: C60114ReviewTargets;
}): C60114OrphanSpeechSweep {
  const header = c60114ArtifactHeader(input.policy, input.sourceIdentity);
  assertC60114SourceIdentity(
    input.speechIslands.sourceIdentity,
    input.sourceIdentity,
  );
  assertC60114SourceIdentity(
    input.reviewTargets.sourceIdentity,
    input.sourceIdentity,
  );
  const entries: C60114OrphanEntry[] = [];
  const targets = input.reviewTargets.targets.filter(
    (t) => t.localizationStatus === "VERIFIED",
  );
  const coverage = [
    ...input.finalCues.map((c) => ({ start: c.start, end: c.end })),
    ...targets.map((t) => t.sourceInterval),
  ];
  for (const island of input.speechIslands.globalIslands) {
    const cuts = [
      ...new Set(
        coverage
          .flatMap((c) => [c.start, c.end])
          .filter(
            (t) =>
              t > island.sourceInterval.start && t < island.sourceInterval.end,
          ),
      ),
    ].toSorted((a, b) => a - b);
    const points = [
      island.sourceInterval.start,
      ...cuts,
      island.sourceInterval.end,
    ];
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1],
        end = points[i];
      if (start === undefined || end === undefined) continue;
      const sourceInterval = { start, end };
      const local = c60114IslandForInterval({
        sourceInterval,
        evidence: input.speechIslands.audit.evidence,
        sourceIdentity: input.sourceIdentity,
        policy: input.policy,
        boundaries: input.speechIslands.boundaries,
      });
      const cueCoveredRatio = c60114Coverage(sourceInterval, input.finalCues);
      const targetCoveredRatio = c60114Coverage(
        sourceInterval,
        targets.map((t) => t.sourceInterval),
      );
      const classification: C60114OrphanEntry["classification"] =
        cueCoveredRatio >= input.policy.orphanCoverageThreshold
          ? "COVERED_BY_CUE"
          : targetCoveredRatio >= input.policy.orphanCoverageThreshold
            ? "COVERED_BY_TARGET"
            : local.strongContradiction
              ? "NON_SPEECH_CONTRADICTED"
              : !local.speechPositive
                ? "UNVERIFIED"
                : local.independentSourceCount >= 2 &&
                    local.lexicalEvidenceIds.length > 0
                  ? "ORPHAN_MULTI_SOURCE_CONFIRMED"
                  : local.lexicalEvidenceIds.length > 0
                    ? "ORPHAN_LEXICAL_POSSIBLE"
                    : "ORPHAN_SPEECH_OBSERVED";
      entries.push(
        withC60114SemanticHash({
          orphanId: c60114Id("orphan", {
            source: input.sourceIdentity,
            islandId: island.islandId,
            sourceInterval,
          }),
          sourceIslandId: island.islandId,
          sourceInterval,
          classification,
          evidenceIds: local.evidenceIds,
          rootLineageIds: local.rootLineageIds,
          correlationGroups: local.correlationGroups,
          independentSourceCount: local.independentSourceCount,
          lexicalEvidenceIds: local.lexicalEvidenceIds,
          reliableLocalizedLexical: local.reliableLocalizedLexical,
          speechPositive: local.speechPositive,
          strongContradiction: local.strongContradiction,
          durationStatus: local.durationStatus,
          cueCoveredRatio,
          targetCoveredRatio,
          coveredByCueIds: uniqueC60114(
            input.finalCues
              .filter((c) => c60114Intersection(c, sourceInterval) !== null)
              .map((c) => c.id),
          ),
          coveredByTargetIds: uniqueC60114(
            targets
              .filter(
                (t) =>
                  c60114Intersection(t.sourceInterval, sourceInterval) !== null,
              )
              .map((t) => t.reviewTargetId),
          ),
          reasons: [
            classification,
            "GLOBAL_EVIDENCE_MINUS_EXACT_CUE_AND_TARGET_COVERAGE",
          ],
        }),
      );
    }
  }
  // Retain failed coordinate mappings and isolated non-speech contradictions in
  // the sweep audit, rather than hiding them because they create no island.
  for (const e of input.speechIslands.audit.evidence) {
    if (
      e.sourceInterval === null ||
      e.sourceInterval.end > input.sourceIdentity.durationSeconds
    )
      continue;
    if (
      e.mappingStatus !== "QUARANTINED" &&
      (!e.contradiction ||
        entries.some((x) => x.evidenceIds.includes(e.evidenceId)))
    )
      continue;
    entries.push(
      withC60114SemanticHash({
        orphanId: c60114Id("orphan-audit", {
          source: input.sourceIdentity,
          evidenceId: e.evidenceId,
        }),
        sourceIslandId: c60114Id("unlocalized-evidence", e.evidenceId),
        sourceInterval: e.sourceInterval,
        classification:
          e.mappingStatus === "QUARANTINED"
            ? ("UNVERIFIED" as const)
            : ("NON_SPEECH_CONTRADICTED" as const),
        evidenceIds: [e.evidenceId],
        rootLineageIds: e.rootLineageIds,
        correlationGroups: [e.correlationGroup],
        independentSourceCount: 0,
        lexicalEvidenceIds: [],
        reliableLocalizedLexical: false,
        speechPositive: false,
        strongContradiction: e.contradiction,
        durationStatus:
          e.sourceInterval.end - e.sourceInterval.start >
          input.policy.speech.maxSeconds
            ? ("TOO_LONG" as const)
            : e.sourceInterval.end - e.sourceInterval.start <
                input.policy.speech.minSeconds
              ? ("TOO_SHORT" as const)
              : ("BOUNDED" as const),
        cueCoveredRatio: 0,
        targetCoveredRatio: 0,
        coveredByCueIds: [],
        coveredByTargetIds: [],
        reasons: e.reasons,
      }),
    );
  }
  const sorted = entries.toSorted(
    (a, b) =>
      a.sourceInterval.start - b.sourceInterval.start ||
      a.orphanId.localeCompare(b.orphanId),
  );
  return c60114OrphanSpeechSweepSchema.parse(
    withC60114SemanticHash({
      ...header,
      artifactType: "orphan-speech-sweep",
      entries: sorted,
      summary: {
        entryCount: sorted.length,
        orphanCount: sorted.filter((e) =>
          e.classification.startsWith("ORPHAN_"),
        ).length,
        coveredByCueCount: sorted.filter(
          (e) => e.classification === "COVERED_BY_CUE",
        ).length,
        coveredByTargetCount: sorted.filter(
          (e) => e.classification === "COVERED_BY_TARGET",
        ).length,
        contradictedCount: sorted.filter(
          (e) => e.classification === "NON_SPEECH_CONTRADICTED",
        ).length,
        unverifiedCount: sorted.filter((e) => e.classification === "UNVERIFIED")
          .length,
        fullMediaAsrRequestCount: 0,
      },
    }),
  );
}
