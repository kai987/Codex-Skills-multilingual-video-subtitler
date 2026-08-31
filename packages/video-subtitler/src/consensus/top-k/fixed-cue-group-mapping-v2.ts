import {
  c612MappingSchema,
  c612MappingAuditSchema,
  c612FoldsSchema,
  type C61HypothesisUniverse,
  type SubtitlePackage,
  type C612Group,
  type C612Identity,
} from "@mvl/shared";
import { artifact, hash, C612_POLICY } from "./c612-policy.js";
import { connectedComponents, overlap } from "./c612-structural.js";
import { partitionC611Contiguous } from "../selective-mbr-folds.js";

/** Machine topology only. Gold may subsequently bind to these immutable units, never merge them. */
export function buildFixedMappingV2(
  universe: C61HypothesisUniverse,
  production: SubtitlePackage,
) {
  const cues = production.cues;
  const components = connectedComponents(
    cues,
    (a, b) =>
      overlap(a, b) > 0 ||
      universe.events.some(
        (e) => e.finalCueIds.includes(a.id) && e.finalCueIds.includes(b.id),
      ),
  );
  const groups: C612Group[] = components
    .map((list) => {
      const ids = list.map((c) => c.id),
        events = universe.events.filter((e) =>
          e.finalCueIds.some((id) => ids.includes(id)),
        );
      const start = Math.min(...list.map((c) => c.start)),
        end = Math.max(...list.map((c) => c.end));
      const incompatible =
        end - start > C612_POLICY.mapping.maximumGroupSeconds;
      const ambiguous = events.some((e) => {
        const span = e.finalSpan,
          cue = list.find((c) => c.id === span?.finalCueId);
        // Split/merge/normalization lineage is usable when its actual frozen span is exact.
        return (
          e.finalCueIds.some((id) => !ids.includes(id)) ||
          !span?.modifiable ||
          !cue ||
          Array.from(cue.text).slice(span.spanStart, span.spanEnd).join("") !==
            span.spanText ||
          e.currentText !== span.spanText
        );
      });
      const status: C612Group["status"] = incompatible
        ? "STRUCTURE_INCOMPATIBLE"
        : ambiguous
          ? "AMBIGUOUS"
          : events.length === 0
            ? "NO_MAPPING"
            : events.length === 1
              ? list.length === 1
                ? "FIXED_ONE_TO_ONE"
                : "FIXED_ONE_TO_MANY"
              : list.length === 1
                ? "FIXED_MANY_TO_ONE"
                : "FIXED_MANY_TO_MANY";
      return {
        groupId: `c612-group:${hash(ids).slice(0, 24)}`,
        cueIds: ids,
        eventIds: events.map((e) => e.eventId).sort(),
        sourceInterval: { start, end },
        status,
        baselineTextHash: hash(list.map((c) => ({ id: c.id, text: c.text }))),
        baselineTimingHash: hash(
          list.map((c) => ({ id: c.id, start: c.start, end: c.end })),
        ),
        evidenceHashes: [
          ...new Set(
            events.flatMap((e) =>
              e.finalSpan ? [e.finalSpan.evidenceHash] : [],
            ),
          ),
        ].sort(),
        reasons: status.startsWith("FIXED_") ? [] : [status],
      };
    })
    .sort(
      (a, b) =>
        a.sourceInterval.start - b.sourceInterval.start ||
        a.groupId.localeCompare(b.groupId),
    );
  const mapping = c612MappingSchema.parse(
    artifact("c6-1-2-fixed-cue-group-mapping-v2", {
      groups,
      baselineCueOrder: cues.map((c) => c.id),
      universeHash: universe.semanticHash,
      runtimeGoldInputCount: 0,
      goldBinding: "EVALUATOR_ONLY_AFTER_MACHINE_FREEZE",
      profileRematchingAllowed: false,
    }),
  );
  const assigned = new Set(groups.flatMap((g) => g.eventIds));
  const audit = c612MappingAuditSchema.parse(
    artifact("c6-1-2-mapping-recovery-audit", {
      mappingHash: mapping.semanticHash,
      assignedCueCount: cues.length,
      assignedEventCount: assigned.size,
      noMappingEventCount: universe.events.filter(
        (e) => !assigned.has(e.eventId),
      ).length,
      ambiguousEventCount: groups
        .filter((g) => g.status === "AMBIGUOUS")
        .reduce((n, g) => n + g.eventIds.length, 0),
      goldTextUsed: false,
      scope: "MACHINE_EVENT_TO_PRODUCTION_CUE_LINEAGE_ONLY",
    }),
  );
  return { mapping, audit };
}
export function buildC612Folds(
  mapping: ReturnType<typeof buildFixedMappingV2>["mapping"],
  identities: readonly C612Identity[],
  universe: C61HypothesisUniverse,
) {
  const units = mapping.groups
    .filter((g) => g.eventIds.length)
    .map((g) => {
      const rows = identities.filter((r) => g.eventIds.includes(r.eventId));
      const intervals = [
        g.sourceInterval,
        ...universe.events
          .filter((e) => g.eventIds.includes(e.eventId))
          .map((e) => e.sourceInterval),
        ...rows.flatMap((r) =>
          [r.coreInterval, r.requestedInterval, r.extractedInterval].filter(
            (x) => x !== null,
          ),
        ),
      ];
      return { group: g, rows, intervals };
    });
  const related = (a: (typeof units)[number], b: (typeof units)[number]) =>
    a.intervals.some((x) => b.intervals.some((y) => overlap(x, y) > 0)) ||
    a.rows.some((x) =>
      b.rows.some(
        (y) =>
          (!!x.observationIdentity &&
            x.observationIdentity === y.observationIdentity) ||
          (!!x.coreIdentity && x.coreIdentity === y.coreIdentity),
      ),
    );
  const rawBlocks = connectedComponents(units, related).map((list) => ({
    blockId: `c612-block:${hash(list.map((x) => x.group.groupId).sort()).slice(0, 24)}`,
    groupIds: list.map((x) => x.group.groupId).sort(),
    eventIds: [...new Set(list.flatMap((x) => x.group.eventIds))].sort(),
    candidateIds: [
      ...new Set(list.flatMap((x) => x.rows.map((r) => r.candidateId))),
    ].sort(),
    sourceInterval: {
      start: Math.min(...list.flatMap((x) => x.intervals.map((i) => i.start))),
      end: Math.max(...list.flatMap((x) => x.intervals.map((i) => i.end))),
    },
    foldId: "",
  }));
  // Temporal hulls cannot straddle another fold even if the original graph had a gap.
  const blocks = connectedComponents(
    rawBlocks,
    (a, b) => overlap(a.sourceInterval, b.sourceInterval) > 0,
  )
    .map((list) => ({
      blockId: `c612-block:${hash(list.map((x) => x.blockId).sort()).slice(0, 24)}`,
      groupIds: list.flatMap((x) => x.groupIds).sort(),
      eventIds: [...new Set(list.flatMap((x) => x.eventIds))].sort(),
      candidateIds: [...new Set(list.flatMap((x) => x.candidateIds))].sort(),
      sourceInterval: {
        start: Math.min(...list.map((x) => x.sourceInterval.start)),
        end: Math.max(...list.map((x) => x.sourceInterval.end)),
      },
      foldId: "",
    }))
    .sort(
      (a, b) =>
        a.sourceInterval.start - b.sourceInterval.start ||
        a.blockId.localeCompare(b.blockId),
    );
  const folds = partitionC611Contiguous(
    blocks,
    C612_POLICY.folds.count,
    (x) => x.eventIds.length,
  ).map((part, i) => {
    const foldId = `outer-${i + 1}`;
    part.forEach((x) => {
      x.foldId = foldId;
    });
    return {
      foldId,
      blockIds: part.map((x) => x.blockId),
      groupIds: part.flatMap((x) => x.groupIds).sort(),
      eventIds: part.flatMap((x) => x.eventIds).sort(),
      candidateIds: part.flatMap((x) => x.candidateIds).sort(),
    };
  });
  let audioLeakageCount = 0,
    correlationLeakageCount = 0;
  for (const a of units)
    for (const b of units)
      if (
        a.group.groupId < b.group.groupId &&
        folds.find((f) => f.groupIds.includes(a.group.groupId))?.foldId !==
          folds.find((f) => f.groupIds.includes(b.group.groupId))?.foldId
      ) {
        if (a.intervals.some((x) => b.intervals.some((y) => overlap(x, y) > 0)))
          audioLeakageCount++;
        if (
          a.rows.some((x) =>
            b.rows.some(
              (y) =>
                !!x.observationIdentity &&
                x.observationIdentity === y.observationIdentity,
            ),
          )
        )
          correlationLeakageCount++;
      }
  return c612FoldsSchema.parse(
    artifact("c6-1-2-folds", {
      mappingHash: mapping.semanticHash,
      blocks,
      folds,
      audioLeakageCount,
      correlationLeakageCount,
      cueGroupLeakageCount: 0,
      frozenBeforeGold: true,
      reasons:
        folds.length === 5 ? [] : ["INSUFFICIENT_INDEPENDENT_TIME_BLOCKS"],
    }),
  );
}
