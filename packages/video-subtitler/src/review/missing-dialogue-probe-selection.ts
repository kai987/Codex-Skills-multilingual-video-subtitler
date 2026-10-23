import {
  c60114ProbeSelectionSchema,
  type C60114Interval,
  type C60114OrphanSpeechSweep,
  type C60114Policy,
  type C60114ProbeSelection,
  type C60114ProbeTarget,
  type C60114SourceIdentity,
  type C60114SpeechIslands,
} from "@mvl/shared";
import {
  assertC60114SourceIdentity,
  c60114ArtifactHeader,
  c60114Coverage,
  c60114Id,
  c60114Subtract,
  uniqueC60114,
  withC60114SemanticHash,
} from "./c60114-policy.js";
import { c60114IslandForInterval } from "./source-global-speech-islands.js";

export function selectC60114MissingDialogueProbes(input: {
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  speechIslands: C60114SpeechIslands;
  orphanSweep: C60114OrphanSpeechSweep;
  finalCues: readonly ({ id: string } & C60114Interval)[];
}): C60114ProbeSelection {
  const header = c60114ArtifactHeader(input.policy, input.sourceIdentity);
  assertC60114SourceIdentity(
    input.speechIslands.sourceIdentity,
    input.sourceIdentity,
  );
  assertC60114SourceIdentity(
    input.orphanSweep.sourceIdentity,
    input.sourceIdentity,
  );
  interface Candidate {
    id: string;
    sourceIslandId: string;
    sourceInterval: C60114Interval;
    itemIds: string[];
    priorityClass: C60114ProbeTarget["priorityClass"];
    targetCoveredRatio: number;
  }
  const candidates: Candidate[] = [];
  for (const e of input.orphanSweep.entries.filter((e) =>
    e.classification.startsWith("ORPHAN_"),
  )) {
    candidates.push({
      id: e.orphanId,
      sourceIslandId: e.sourceIslandId,
      sourceInterval: e.sourceInterval,
      itemIds: [`c60114-item-${e.orphanId}`],
      priorityClass:
        e.classification === "ORPHAN_MULTI_SOURCE_CONFIRMED"
          ? "ORPHAN_MULTI_SOURCE"
          : e.classification === "ORPHAN_LEXICAL_POSSIBLE"
            ? "ORPHAN_LEXICAL"
            : "UNCOVERED_VERIFIED_SPEECH",
      targetCoveredRatio: e.targetCoveredRatio,
    });
  }
  for (const island of input.speechIslands.islands) {
    for (const sourceInterval of c60114Subtract(
      island.sourceInterval,
      input.finalCues,
    ))
      candidates.push({
        id: c60114Id("island-probe-candidate", {
          islandId: island.islandId,
          sourceInterval,
        }),
        sourceIslandId: island.islandId,
        sourceInterval,
        itemIds: island.itemIds.length
          ? island.itemIds
          : [`c60114-item-${island.islandId}`],
        priorityClass: "UNCOVERED_VERIFIED_SPEECH",
        targetCoveredRatio: 1,
      });
  }
  const order = {
    ORPHAN_MULTI_SOURCE: 0,
    ORPHAN_LEXICAL: 1,
    UNCOVERED_VERIFIED_SPEECH: 2,
  };
  candidates.sort(
    (a, b) =>
      order[a.priorityClass] - order[b.priorityClass] ||
      a.sourceInterval.start - b.sourceInterval.start ||
      a.sourceInterval.end - b.sourceInterval.end ||
      a.id.localeCompare(b.id),
  );
  const targets: C60114ProbeTarget[] = [];
  const decisions: C60114ProbeSelection["decisions"] = [];
  for (const c of candidates) {
    const local = c60114IslandForInterval({
      sourceInterval: c.sourceInterval,
      evidence: input.speechIslands.audit.evidence,
      sourceIdentity: input.sourceIdentity,
      policy: input.policy,
    });
    const cueCoveredRatio = c60114Coverage(c.sourceInterval, input.finalCues);
    const reasons: string[] = [];
    if (!local.speechPositive) reasons.push("NO_VERIFIED_POSITIVE_SPEECH");
    if (local.durationStatus !== "BOUNDED")
      reasons.push(`ISLAND_${local.durationStatus}`);
    if (
      cueCoveredRatio * (c.sourceInterval.end - c.sourceInterval.start) >
      input.policy.cueCoverageToleranceSeconds
    )
      reasons.push("COVERED_BY_EXISTING_FINAL_CUE");
    if (local.strongContradiction)
      reasons.push("STRONG_ACOUSTIC_CONTRADICTION");
    if (local.reliableLocalizedLexical)
      reasons.push("RELIABLE_LOCALIZED_LEXICAL_EVIDENCE_ALREADY_AVAILABLE");
    if (
      targets.some(
        (t) =>
          c60114Coverage(c.sourceInterval, [t.sourceInterval]) >=
          input.policy.orphanCoverageThreshold,
      )
    )
      reasons.push("DUPLICATE_PROBE_LOCUS");
    if (targets.length >= input.policy.probes.maxTargets)
      reasons.push("CORE_TARGET_BUDGET_EXHAUSTED");
    const selected = reasons.length === 0;
    const targetId = selected
      ? c60114Id("missing-probe", {
          source: input.sourceIdentity,
          sourceInterval: c.sourceInterval,
        })
      : null;
    if (selected && targetId) {
      const previous = input.finalCues
        .filter((q) => q.end <= c.sourceInterval.start)
        .toSorted((a, b) => b.end - a.end)[0];
      const next = input.finalCues
        .filter((q) => q.start >= c.sourceInterval.end)
        .toSorted((a, b) => a.start - b.start)[0];
      targets.push({
        targetId,
        sourceInterval: c.sourceInterval,
        sourceIslandId: c.sourceIslandId,
        itemIds: uniqueC60114(c.itemIds),
        evidenceIds: local.evidenceIds,
        rootLineageIds: local.rootLineageIds,
        correlationGroups: local.correlationGroups,
        priorityClass: c.priorityClass,
        speechPositive: true,
        validTimebase: true,
        cueCoveredRatio,
        targetCoveredRatio: c.targetCoveredRatio,
        strongContradiction: false,
        reliableLocalizedLexical: false,
        neighborCueIntervals: [previous, next]
          .filter((v): v is { id: string } & C60114Interval => v !== undefined)
          .map((q) => ({ start: q.start, end: q.end })),
        reasons: [
          "BOUNDED_UNCOVERED_VERIFIED_SPEECH_WITHOUT_RELIABLE_LOCAL_LEXICAL",
          c.priorityClass,
        ],
      });
    }
    decisions.push({
      candidateId: c.id,
      sourceInterval: c.sourceInterval,
      selected,
      targetId,
      reasons: selected
        ? ["SELECTED_WITHIN_FROZEN_DUAL_PROVIDER_BUDGET"]
        : reasons,
    });
  }
  return c60114ProbeSelectionSchema.parse(
    withC60114SemanticHash({
      ...header,
      artifactType: "missing-dialogue-probe-selection",
      targets,
      decisions,
      budget: {
        maximumTargets: 24,
        maximumLaterContextTargets: 8,
        maximumRequests: 64,
        selectedCoreRequestCount:
          targets.length * input.policy.probes.providerCount,
        reservedContextRequestCount: 16,
      },
    }),
  );
}
