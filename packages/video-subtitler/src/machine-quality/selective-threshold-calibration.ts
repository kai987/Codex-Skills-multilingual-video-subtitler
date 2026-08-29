export interface ThresholdCalibrationRow {
  score: number;
  label: "REAZON_BETTER" | "WHISPER_BETTER" | "EQUIVALENT";
  localGain: number;
}

export function selectSafetyFirstThreshold(
  rows: readonly ThresholdCalibrationRow[],
): number {
  if (rows.length === 0) return 1;
  const candidates = [1, ...new Set(rows.map((row) => row.score)), 0].toSorted(
    (left, right) => right - left,
  );
  const ranked = candidates.map((threshold) => {
    const selected = rows.filter((row) => row.score >= threshold);
    return {
      threshold,
      wrong: selected.filter((row) => row.label === "WHISPER_BETTER").length,
      neutral: selected.filter((row) => row.label === "EQUIVALENT").length,
      gain: selected.reduce((sum, row) => sum + row.localGain, 0),
      selected: selected.length,
    };
  });
  return (
    ranked.toSorted(
      (left, right) =>
        left.wrong - right.wrong ||
        right.gain - left.gain ||
        left.neutral - right.neutral ||
        right.selected - left.selected ||
        right.threshold - left.threshold,
    )[0]?.threshold ?? 1
  );
}
