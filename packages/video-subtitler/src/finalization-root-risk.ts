import type {
  FinalizationFinding,
  SubtitleFinalizationRiskAssessment,
} from "@mvl/shared";

type SignalAssessment =
  SubtitleFinalizationRiskAssessment["signalAssessments"][number];
type RootRisk = SubtitleFinalizationRiskAssessment["rootRisks"][number];

const dispositionRank = new Map([
  ["FINAL_BLOCKER", 7],
  ["UNKNOWN", 6],
  ["CONTEXT_DEPENDENT", 5],
  ["MUTATION_GUARD", 4],
  ["REVIEW_ADVISORY", 3],
  ["DIAGNOSTIC_ONLY", 2],
  ["SUPERSEDED", 1],
]);

function strongestDisposition(
  signals: readonly SignalAssessment[],
): RootRisk["effectiveDisposition"] {
  return (
    [...signals].toSorted(
      (left, right) =>
        (dispositionRank.get(right.effectiveDisposition) ?? 0) -
          (dispositionRank.get(left.effectiveDisposition) ?? 0) ||
        left.code.localeCompare(right.code),
    )[0]?.effectiveDisposition ?? "DIAGNOSTIC_ONLY"
  );
}

export function buildFinalizationRootRisks(input: {
  signals: readonly SignalAssessment[];
  findings: readonly FinalizationFinding[];
}): RootRisk[] {
  const byFamily = new Map<string, SignalAssessment[]>();
  for (const signal of input.signals) {
    const values = byFamily.get(signal.rootRiskFamily) ?? [];
    values.push(signal);
    byFamily.set(signal.rootRiskFamily, values);
  }
  return [...byFamily.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([family, signals]) => {
      const codes = new Set(signals.map((signal) => signal.code));
      const matching = input.findings.filter((finding) =>
        codes.has(finding.code),
      );
      return {
        rootRiskId: `root-risk:${family}`,
        rootRiskFamily: family,
        memberSignalIds: signals.map((signal) => signal.signalId).toSorted(),
        derivedFindingIds: matching
          .filter(
            (finding) =>
              finding.code === "ILLEGAL_SUBTITLE_OVERLAP" ||
              !finding.code.includes("COMPONENT_UNRESOLVED"),
          )
          .map((finding) => finding.findingId)
          .toSorted(),
        metaFindingIds: matching
          .filter(
            (finding) =>
              finding.code === "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED" ||
              finding.code.includes("REVIEW"),
          )
          .map((finding) => finding.findingId)
          .toSorted(),
        effectiveDisposition: strongestDisposition(signals),
      };
    });
}
