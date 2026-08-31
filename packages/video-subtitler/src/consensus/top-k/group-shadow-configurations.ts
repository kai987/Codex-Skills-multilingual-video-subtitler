import {
  c612ConfigurationsSchema,
  c612GroupDecisionsSchema,
  subtitlePackageSchema,
  type C61HypothesisUniverse,
  type SubtitlePackage,
  type C612Group,
  type C612Ranking,
  type C612Configuration,
  type C612GroupDecision,
} from "@mvl/shared";
import {
  resolveDisplayLayout,
  formatAss,
  formatSrt,
  formatVtt,
} from "@mvl/subtitle-core";
import { checkC611SpanApplication } from "../current-preservation.js";
import { artifact, hash, c612Defined } from "./c612-policy.js";
import { C612_RERANKERS } from "./linear-reranker.js";
export interface C612WholeSelection {
  eventId: string;
  candidateId: string;
}
/** Uses the same exact-span/no-split presentation contract without any lattice decoder. */
export function assembleC612WholeCandidates(
  production: SubtitlePackage,
  universe: C61HypothesisUniverse,
  selections: readonly C612WholeSelection[],
) {
  if (new Set(selections.map((s) => s.eventId)).size !== selections.length)
    throw new Error("C612_DUPLICATE_EVENT_SELECTION");
  const reasons: string[] = [],
    replacements: {
      cueId: string;
      start: number;
      end: number;
      text: string;
      eventId: string;
    }[] = [];
  for (const selection of selections) {
    const event = universe.events.find((e) => e.eventId === selection.eventId),
      candidate = universe.candidates.find(
        (c) => c.candidateId === selection.candidateId,
      );
    if (!event || !candidate || candidate.providerFamily === "CURRENT") {
      reasons.push("NOT_EXISTING_ALTERNATIVE");
      continue;
    }
    const checked = checkC611SpanApplication({
      event,
      candidate,
      events: universe.events,
      production,
    });
    if (!checked.proof) {
      reasons.push(...checked.reasons);
      continue;
    }
    replacements.push({
      cueId: checked.proof.finalCueId,
      start: checked.proof.spanStart,
      end: checked.proof.spanEnd,
      text: candidate.displayText,
      eventId: event.eventId,
    });
  }
  const display = new Map<string, string>();
  const cues = production.cues.map((cue) => {
    const list = replacements
      .filter((r) => r.cueId === cue.id)
      .sort((a, b) => b.start - a.start);
    if (!list.length) return cue;
    if (
      list.some((a, i) =>
        list.slice(i + 1).some((b) => a.start < b.end && a.end > b.start),
      )
    ) {
      reasons.push("OVERLAPPING_EVENT_SPANS");
      return cue;
    }
    const points = Array.from(cue.text);
    for (const r of list)
      points.splice(r.start, r.end - r.start, ...Array.from(r.text));
    const updated = { ...cue, text: points.join("") },
      layout = resolveDisplayLayout(updated);
    if (!layout.resolved || layout.blocking) {
      reasons.push("JOINT_PRESENTATION_CAPACITY");
      return cue;
    }
    display.set(cue.id, layout.displayText);
    return updated;
  });
  const finalCues = reasons.length ? production.cues : cues;
  const textHash = hash(finalCues.map((c) => ({ id: c.id, text: c.text }))),
    timingHash = hash(
      finalCues.map((c) => ({ id: c.id, start: c.start, end: c.end })),
    );
  if (
    hash(
      production.cues.map((c) => ({ id: c.id, start: c.start, end: c.end })),
    ) !== timingHash
  )
    throw new Error("C612_TIMING_MUTATION");
  return {
    cues: finalCues,
    textHash,
    timingHash,
    display: reasons.length ? new Map<string, string>() : display,
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
  };
}
export function renderC612Shadow(
  production: SubtitlePackage,
  universe: C61HypothesisUniverse,
  selections: readonly C612WholeSelection[],
  profileId: string,
) {
  const result = assembleC612WholeCandidates(production, universe, selections);
  if (!result.eligible)
    throw new Error(
      `C612_SELECTED_JOINT_CONFIGURATION_INVALID:${result.reasons.join(",")}`,
    );
  if (!profileId) throw new Error("C612_SHADOW_PROFILE_REQUIRED");
  const pkg = subtitlePackageSchema.parse({
    ...production,
    cues: result.cues,
    subtitleFiles: {
      ass: "subtitle.ass",
      srt: "subtitle.srt",
      vtt: "subtitle.vtt",
    },
  });
  return {
    ...result,
    subtitlePackage: pkg,
    ass: formatAss(result.cues, { displayTextByCueId: result.display }),
    srt: formatSrt(result.cues, { displayTextByCueId: result.display }),
    vtt: formatVtt(result.cues, { displayTextByCueId: result.display }),
  };
}
export function buildGroupConfigurations(input: {
  rankings: readonly C612Ranking[];
  rankingHash: string;
  groups: readonly C612Group[];
  mappingHash: string;
  production: SubtitlePackage;
  universe: C61HypothesisUniverse;
}) {
  const rows: C612Configuration[] = [],
    decisions: C612GroupDecision[] = [];
  for (const profileId of [
    ...new Set(input.rankings.map((r) => r.profileId)),
  ].sort())
    for (const group of input.groups.toSorted((a, b) =>
      a.groupId.localeCompare(b.groupId),
    )) {
      const rankings = input.rankings
        .filter(
          (r) =>
            r.profileId === profileId && group.eventIds.includes(r.eventId),
        )
        .sort((a, b) => a.eventId.localeCompare(b.eventId));
      if (!rankings.length) continue;
      const foldId = c612Defined(rankings[0]).foldId;
      if (rankings.some((r) => r.foldId !== foldId))
        throw new Error("C612_CUE_GROUP_CROSS_FOLD");
      const candidates: {
        selections: C612WholeSelection[];
        score: number;
        kind: C612Configuration["kind"];
      }[] = [{ selections: [], score: 0, kind: "CURRENT_ALL" }];
      const options = rankings.flatMap((r) =>
        r.ranked
          .filter((c) => !c.current)
          .map((c) => ({
            eventId: r.eventId,
            candidateId: c.candidateId,
            gain: c.score - c612Defined(r.ranked.find((x) => x.current)).score,
            allowed:
              c.gateEligible &&
              (C612_RERANKERS.find((p) => p.id === profileId)?.abstention
                ? c.candidateId === r.selectedCandidateId
                : true),
          })),
      );
      const singles = options.toSorted(
        (a, b) =>
          b.gain - a.gain ||
          a.eventId.localeCompare(b.eventId) ||
          a.candidateId.localeCompare(b.candidateId),
      );
      for (const o of singles.slice(0, 8))
        candidates.push({
          selections: [{ eventId: o.eventId, candidateId: o.candidateId }],
          score: o.gain,
          kind: "SINGLE_EVENT",
        });
      const top = rankings
        .filter((r) => r.selectedCandidateId !== r.currentCandidateId)
        .sort(
          (a, b) =>
            b.marginOverCurrent - a.marginOverCurrent ||
            a.eventId.localeCompare(b.eventId),
        )
        .slice(0, 2);
      if (top.length)
        candidates.push({
          selections: top.map((r) => ({
            eventId: r.eventId,
            candidateId: r.selectedCandidateId,
          })),
          score: top.reduce((n, r) => n + r.marginOverCurrent, 0),
          kind: "TOP1_COMBINED",
        });
      const pairs = singles
        .flatMap((a, i) =>
          singles
            .slice(i + 1)
            .filter((b) => a.eventId !== b.eventId)
            .map((b) => ({
              selections: [
                { eventId: a.eventId, candidateId: a.candidateId },
                { eventId: b.eventId, candidateId: b.candidateId },
              ].sort((x, y) => x.eventId.localeCompare(y.eventId)),
              score: a.gain + b.gain,
              kind: "BOUNDED_BEAM" as const,
            })),
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            hash(a.selections).localeCompare(hash(b.selections)),
        );
      candidates.push(...pairs.slice(0, 16));
      const unique = new Map<string, (typeof candidates)[number]>();
      for (const c of candidates)
        if (!unique.has(hash(c.selections)) && unique.size < 16)
          unique.set(hash(c.selections), c);
      const configurations = [...unique.values()].map((c) => {
        const assembled = assembleC612WholeCandidates(
          input.production,
          input.universe,
          c.selections,
        );
        const blocked = c.selections.some(
          (s) =>
            !options.find(
              (o) => o.eventId === s.eventId && o.candidateId === s.candidateId,
            )?.allowed,
        );
        return {
          profileId,
          foldId,
          groupId: group.groupId,
          configurationId: `c612-config:${hash([profileId, group.groupId, c.selections]).slice(0, 24)}`,
          kind: c.kind,
          selections: c.selections,
          aggregateScore: c.score,
          baselineScore: 0,
          eligible: assembled.eligible && !blocked,
          reasons: [
            ...assembled.reasons,
            ...(blocked ? ["CANDIDATE_GATE_OR_THRESHOLD_BLOCKED"] : []),
          ],
          outputTextHash: assembled.textHash,
          outputTimingHash: assembled.timingHash,
        };
      });
      rows.push(...configurations);
      const winner = c612Defined(
        configurations
          .filter((c) => c.eligible)
          .sort(
            (a, b) =>
              b.aggregateScore - a.aggregateScore ||
              a.selections.length - b.selections.length ||
              a.configurationId.localeCompare(b.configurationId),
          )[0],
      );
      const changed =
        winner.outputTextHash !==
        hash(input.production.cues.map((c) => ({ id: c.id, text: c.text })));
      decisions.push({
        profileId,
        foldId,
        groupId: group.groupId,
        configurationId: winner.configurationId,
        selections: winner.selections,
        changed,
        reasons: changed ? [] : ["CURRENT_TEXT_RETAINED"],
      });
    }
  const configurations = c612ConfigurationsSchema.parse(
    artifact("machine-c6-1-2-group-shadow-configurations", {
      rankingsHash: input.rankingHash,
      mappingHash: input.mappingHash,
      rows,
      maximumPerGroupProfile: 16,
      maximumChangedEvents: 2,
      goldUsed: false,
    }),
  );
  return {
    configurations,
    groupDecisions: c612GroupDecisionsSchema.parse(
      artifact("c6-1-2-oof-group-decisions", {
        configurationsHash: configurations.semanticHash,
        rows: decisions,
        goldUsed: false,
      }),
    ),
  };
}
