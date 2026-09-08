/** Evaluation-only. Do not import from any production generator. */
import {
  characterAlignment,
  qualityText,
  type QualityCue,
} from "./experimental-metrics.js";
export function referenceClipScope(
  clip: { start: number; end: number },
  reference: readonly QualityCue[],
) {
  const units = reference.filter(
    (r) => r.start < clip.end && r.end > clip.start,
  );
  const crossing = units.filter(
    (r) => r.start < clip.start - 0.011 || r.end > clip.end + 0.011,
  );
  return {
    units,
    boundaryCrossingIds: crossing.map((r) => r.id),
    preciseEligible: units.length > 0 && crossing.length === 0,
    reason:
      units.length === 0
        ? "EMPTY_REFERENCE"
        : crossing.length
          ? "BOUNDARY_CROSSING_COMPLETE_UNITS_RETAINED"
          : "COMPLETE_REFERENCE_UNITS",
    scope:
      "all intersecting complete reference units; no proportional text cropping",
  };
}
export function transcriptMetric(
  hypothesis: string,
  reference: string,
  normalized = true,
) {
  const { path, ...m } = characterAlignment(
    qualityText(reference, normalized),
    qualityText(hypothesis, normalized),
  );
  void path;
  return { ...m, distance: m.S + m.D + m.I };
}
export function aggregateTextMetrics(
  rows: readonly {
    S: number;
    D: number;
    I: number;
    N: number;
    CER: number | null;
  }[],
) {
  const totals = rows.reduce(
    (a, b) => ({ S: a.S + b.S, D: a.D + b.D, I: a.I + b.I, N: a.N + b.N }),
    { S: 0, D: 0, I: 0, N: 0 },
  );
  const c = rows.flatMap((r) => (r.CER === null ? [] : [r.CER]));
  return {
    ...totals,
    distance: totals.S + totals.D + totals.I,
    microCER: totals.N ? (totals.S + totals.D + totals.I) / totals.N : null,
    macroCER: c.length ? c.reduce((a, b) => a + b, 0) / c.length : null,
    clips: rows.length,
  };
}
