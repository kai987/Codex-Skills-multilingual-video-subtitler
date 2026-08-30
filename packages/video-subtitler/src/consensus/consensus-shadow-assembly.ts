import {
  subtitlePackageSchema,
  type C61HypothesisEvent,
  type C61ShadowManifest,
  type C61TokenLattice,
  type SubtitlePackage,
} from "@mvl/shared";
import {
  formatAss,
  formatSrt,
  formatVtt,
  resolveDisplayLayout,
} from "@mvl/subtitle-core";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  auditC61Consensus,
  resolveC61ProfileLattice,
  type C61ProfilePath,
} from "./consensus-safety-audit.js";
import { c61Require } from "./japanese-text-representation.js";

export interface C61AssembledShadow {
  profileId: string;
  subtitlePackage: SubtitlePackage;
  ass: string;
  srt: string;
  vtt: string;
  changedCueIds: string[];
  decisions: C61ShadowManifest["profiles"][number]["assemblyDecisions"];
}

/** Event-to-final text spans are the only permitted assembly authority.
 * No cue split/merge, timing repair, uncovered-event insertion, or global replace.
 */
export function assembleC61Shadow(input: {
  profileId: string;
  production: SubtitlePackage;
  events: C61HypothesisEvent[];
  paths: C61ProfilePath[];
  lattices: C61TokenLattice[];
}): C61AssembledShadow {
  const decisions: C61AssembledShadow["decisions"] = [];
  const replacements = new Map<
    string,
    {
      eventId: string;
      start: number;
      end: number;
      text: string;
      decisionIndex: number;
    }[]
  >();
  if (
    new Set(input.events.map((event) => event.eventId)).size !==
    input.events.length
  )
    throw new Error("C61_DUPLICATE_SHADOW_EVENT");
  for (const event of input.events.toSorted((a, b) =>
    a.eventId.localeCompare(b.eventId),
  )) {
    const entries = input.paths.filter(
      (p) => p.profileId === input.profileId && p.eventId === event.eventId,
    );
    if (entries.length > 1) throw new Error("C61_DUPLICATE_SHADOW_PATH");
    const path = entries[0]?.path;
    const span = event.finalSpan;
    const decision = {
      eventId: event.eventId,
      cueId: span?.finalCueId ?? null,
      status:
        "KEEP_CURRENT" as C61AssembledShadow["decisions"][number]["status"],
      reason: "No text-only change requested.",
      inputTextHash: machineQualitySemanticHash(event.currentText ?? ""),
      outputTextHash: machineQualitySemanticHash(event.currentText ?? ""),
    };
    const index = decisions.length;
    decisions.push(decision);
    if (
      !path ||
      path.displayText === event.currentText ||
      input.profileId === "P0"
    )
      continue;
    if (!path.pathLegal || !path.provenanceComplete) {
      decision.status = "BLOCKED_UNSAFE";
      decision.reason = "Unproven path is not rendered.";
      continue;
    }
    const entry = entries[0];
    const lattice = entry
      ? resolveC61ProfileLattice(entry, input.lattices, input.paths)
      : null;
    if (
      !lattice ||
      !auditC61Consensus({
        paths: entries,
        lattices: [lattice],
        productionTextMutation: 0,
        productionTimingMutation: 0,
        runtimeGoldInputCount: 0,
      }).safety.engineeringPassed
    ) {
      decision.status = "BLOCKED_UNSAFE";
      decision.reason =
        "Independent path, surface, and provenance verification rejected the proposal.";
      continue;
    }
    const cue = input.production.cues.find((c) => c.id === span?.finalCueId);
    if (
      !span?.modifiable ||
      !cue ||
      !event.finalCueIds.includes(cue.id) ||
      event.currentText !== span.spanText ||
      !Number.isInteger(span.spanStart) ||
      !Number.isInteger(span.spanEnd) ||
      span.spanStart < 0 ||
      span.spanEnd <= span.spanStart ||
      span.spanEnd > Array.from(cue.text).length ||
      Array.from(cue.text).slice(span.spanStart, span.spanEnd).join("") !==
        span.spanText
    ) {
      decision.status = "UNMAPPABLE_LINEAGE";
      decision.reason =
        "No exact, current, modifiable final-cue span; production structure preserved.";
      continue;
    }
    const existing = replacements.get(cue.id) ?? [];
    existing.push({
      eventId: event.eventId,
      start: span.spanStart,
      end: span.spanEnd,
      text: path.displayText,
      decisionIndex: index,
    });
    replacements.set(cue.id, existing);
  }
  // Compute conflicts after collecting all proposals. Every proposal on a cue
  // with overlapping event spans is held, including otherwise disjoint spans;
  // neither output nor per-event decisions depend on event iteration order.
  for (const proposals of replacements.values()) {
    const conflict = proposals.some((proposal, index) =>
      proposals
        .slice(index + 1)
        .some(
          (other) => proposal.start < other.end && proposal.end > other.start,
        ),
    );
    if (!conflict) continue;
    for (const proposal of proposals) {
      const decision = c61Require(decisions[proposal.decisionIndex]);
      decision.status = "CONFLICTING_REPLACEMENT";
      decision.reason =
        "This cue has overlapping event spans; all cue proposals are held.";
    }
  }
  const display = new Map<string, string>();
  const cues = input.production.cues.map((cue) => {
    const proposals = replacements.get(cue.id) ?? [];
    if (
      proposals.length === 0 ||
      proposals.some(
        (p) => decisions[p.decisionIndex]?.status === "CONFLICTING_REPLACEMENT",
      )
    )
      return { ...cue };
    const points = Array.from(cue.text);
    for (const replacement of proposals.toSorted((a, b) => b.start - a.start))
      points.splice(
        replacement.start,
        replacement.end - replacement.start,
        ...Array.from(replacement.text),
      );
    const updated = { ...cue, text: points.join("") };
    const layout =
      updated.text.trim() === "" ? null : resolveDisplayLayout(updated);
    if (!layout?.resolved || layout.blocking) {
      for (const proposal of proposals) {
        c61Require(decisions[proposal.decisionIndex]).status =
          "PRESENTATION_CAPACITY";
        c61Require(decisions[proposal.decisionIndex]).reason =
          "Existing no-split presentation contract cannot render replacement; preserve current.";
      }
      return { ...cue };
    }
    display.set(cue.id, layout.displayText);
    for (const proposal of proposals) {
      c61Require(decisions[proposal.decisionIndex]).status =
        "APPLIED_SHADOW_ONLY";
      c61Require(decisions[proposal.decisionIndex]).reason =
        "Exact event span changed in separate research shadow only.";
      c61Require(decisions[proposal.decisionIndex]).outputTextHash =
        machineQualitySemanticHash(proposal.text);
    }
    return updated;
  });
  const stem = `subtitle.c6-1-${input.profileId.toLowerCase()}-shadow`;
  const subtitlePackage = subtitlePackageSchema.parse({
    ...input.production,
    cues,
    subtitleFiles: {
      ass: `${stem}.ass`,
      srt: `${stem}.srt`,
      vtt: `${stem}.vtt`,
    },
  });
  if (
    cues.some(
      (c, i) =>
        c.id !== input.production.cues[i]?.id ||
        c.start !== input.production.cues[i].start ||
        c.end !== input.production.cues[i].end,
    )
  )
    throw new Error("C61_SHADOW_TIMING_OR_STRUCTURE_MUTATION");
  return {
    profileId: input.profileId,
    subtitlePackage,
    ass: formatAss(cues, { displayTextByCueId: display }),
    srt: formatSrt(cues, { displayTextByCueId: display }),
    vtt: formatVtt(cues, { displayTextByCueId: display }),
    changedCueIds: cues
      .filter((c, i) => c.text !== input.production.cues[i]?.text)
      .map((c) => c.id),
    decisions,
  };
}
