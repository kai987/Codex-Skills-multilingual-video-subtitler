function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required evidence/index absent");
  return value;
}
import type { SubtitleCue } from "@mvl/shared";
import {
  primaryMinimal,
  type MachineQualityEvidence,
} from "./experimental-profile.js";
/** Opt-in inverse of an evidenced lossy repetition operation, not an ASR selector. */
export function recoverUnprovenRepetition(
  e: MachineQualityEvidence,
  enabled: boolean,
) {
  const primary = primaryMinimal(e),
    rawById = new Map(primary.map((c) => [c.id, c]));
  const journal: {
    operation: string;
    input: SubtitleCue[];
    output: SubtitleCue[];
    sourceIds: string[];
    reason: string;
    applied: boolean;
  }[] = [];
  const claimed = new Set<string>();
  const cues = e.stableCues
    .flatMap((cue) => {
      const records = e.unprovenRepetition.filter((r) =>
        r.outputCueIds.includes(cue.id),
      );
      if (!records.length) return [cue];
      const lineage = (cue.provenance?.sourceRequestIds ?? []).flatMap((id) =>
        e.canonicalLineage.filter((l) => l.id === id),
      );
      const ids = [...new Set(lineage.flatMap((l) => l.rawSegmentIds))];
      const raw = ids
        .flatMap((id) => {
          const r = rawById.get(id);
          return r ? [r] : [];
        })
        .toSorted((a, b) => a.start - b.start);
      let reason = "PRIMARY_OCCURRENCES_PRESERVED_UNPROVEN_REPETITION_DELETION";
      // A deleted text span must be present in exact primary bytes, not a reconstructed answer.
      const supported =
        raw.length > 0 &&
        raw.length === ids.length &&
        records.every((r) =>
          r.removedText.every((t) => raw.some((c) => c.text.includes(t))),
        ) &&
        raw.every((r, i) => i === 0 || r.start >= requireValue(raw[i - 1]).end);
      const foreign = e.stableCues.some(
        (other) =>
          other.id !== cue.id &&
          (other.provenance?.sourceRequestIds ?? []).some((id) =>
            lineage.some((l) => l.id === id),
          ),
      );
      const shared = ids.some((id) => claimed.has(id));
      const bounds =
        raw.length > 0 &&
        requireValue(raw[0]).start <= cue.start + 0.011 &&
        requireValue(raw.at(-1)).end >= cue.end - 0.011;
      const apply = enabled && supported && !foreign && !shared && bounds;
      if (!enabled) reason = "REPAIR_DISABLED_ABLATION";
      else if (!supported || foreign || shared || !bounds)
        reason = "ABSTAIN_INCOMPLETE_OR_AMBIGUOUS_PRIMARY_LINEAGE";
      const result = apply
        ? raw.map((r) => ({ ...r, id: `recovered:${r.id}` }))
        : [cue];
      if (apply) for (const id of ids) claimed.add(id);
      journal.push({
        operation: apply ? "restore-primary-occurrences" : "retain",
        input: [cue],
        output: result,
        sourceIds: ids,
        reason,
        applied: apply,
      });
      return result;
    })
    .toSorted(
      (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
    );
  return { cues, journal };
}
