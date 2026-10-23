import {
  c60114RouteDecisionSchema,
  type C60114RouteDecision,
  type C60114PlaybackCoverageInput,
  type C60114BudgetCoverage,
} from "@mvl/shared";

type Diagnosis = C60114RouteDecision["perComponentDiagnoses"][number];
const unique = (values: string[]): string[] => [...new Set(values)].sort();
const intersects = (
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean => Math.min(a.end, b.end) > Math.max(a.start, b.start);

/** Ordered first-broken-link diagnosis. Quarantined hints are diagnostic only, never coverage. */
export function buildC60114RouteDecision(input: {
  coverageInput: C60114PlaybackCoverageInput;
  fullQueue: C60114BudgetCoverage | undefined;
  integrityFailures: string[];
  engineeringPassed: boolean;
  requiredTargetAudioGatePassed: boolean;
}): C60114RouteDecision {
  const rows =
    input.fullQueue?.componentCoverage.filter(
      (row) =>
        row.labels.includes("MISSING_DIALOGUE") ||
        row.labels.includes("HALLUCINATION"),
    ) ?? [];
  const perComponentDiagnoses: Diagnosis[] = rows.map((row) => {
    const missing = row.labels.includes("MISSING_DIALOGUE");
    const speechPresent =
      row.layers.machineSpeech.any ||
      row.layers.orphan.any ||
      row.layers.localizedLexical.any;
    const targetPresent =
      row.layers.targetInterval.any || row.layers.regionContext.any;
    const audible = row.layers.audibleReviewCoverage.audible;
    const hints = (input.coverageInput.lineageEvidence ?? []).filter(
      (evidence) => {
        const claimedInterval = evidence.claimedInterval;
        return (
          !evidence.status.startsWith("VERIFIED_") &&
          evidence.speechPositive &&
          claimedInterval !== null &&
          row.errorIntervals.some((interval) =>
            intersects(interval, claimedInterval),
          )
        );
      },
    );
    const diagnoses: Diagnosis["diagnoses"] = [];
    const reasons: string[] = [];
    if (input.integrityFailures.length)
      diagnoses.push("EVALUATION_INTEGRITY_FAILURE");
    // A quarantined alternative is not a required dependency if independently verified
    // speech already directly localizes this component. It remains visible in diagnostics.
    if (missing && !speechPresent && hints.length) {
      diagnoses.push("SOURCE_GLOBAL_LINEAGE_UNVERIFIED");
      reasons.push(
        "RELATED_POSITIVE_HINT_HAS_NO_VERIFIED_SOURCE_GLOBAL_ALTERNATIVE",
      );
    } else if (missing && !speechPresent) {
      diagnoses.push("MACHINE_SPEECH_DETECTION_MISS");
      reasons.push(
        "NO_DIRECT_VERIFIED_SPEECH_OR_ORPHAN_OR_LOCALIZED_EVIDENCE_OVERLAP",
      );
    }
    if (!targetPresent && (!missing || speechPresent))
      diagnoses.push("MACHINE_REVIEW_LOCALIZATION_MISS");
    if (targetPresent && !audible)
      diagnoses.push("MACHINE_REVIEW_AUDIO_OMISSION");
    if (
      missing &&
      audible &&
      (!row.layers.localizedLexical.audible ||
        row.independentLocalizedLexicalSourceCount < 1)
    ) {
      diagnoses.push("LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE");
      reasons.push(
        "AUDIO_ACTIONABLE_FOR_HUMAN_CUE_INSERTION_LEXICAL_EVIDENCE_IS_ADVISORY",
      );
    }
    if (audible) diagnoses.push("FULLY_PLAYBACK_COVERED");
    if (!diagnoses.length) diagnoses.push("MACHINE_REVIEW_AUDIO_OMISSION");
    return {
      errorComponentId: row.errorComponentId,
      primaryDiagnosis: diagnoses[0] ?? "MACHINE_REVIEW_AUDIO_OMISSION",
      diagnoses,
      unverifiedLineageEvidenceIds: unique(
        hints.map((evidence) => evidence.evidenceId),
      ),
      reasons,
    };
  });
  const blockers: C60114RouteDecision["blockers"] = [];
  const advisories: C60114RouteDecision["advisories"] = [];
  const hierarchy = [
    ["EVALUATION_INTEGRITY_FAILURE", "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR"],
    [
      "SOURCE_GLOBAL_LINEAGE_UNVERIFIED",
      "HOLD_FOR_SOURCE_GLOBAL_LINEAGE_REPAIR",
    ],
    [
      "MACHINE_SPEECH_DETECTION_MISS",
      "HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR",
    ],
    ["MACHINE_REVIEW_LOCALIZATION_MISS", "HOLD_FOR_REVIEW_LOCALIZATION_REPAIR"],
    ["MACHINE_REVIEW_AUDIO_OMISSION", "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR"],
  ] as const;
  for (const [diagnosis] of hierarchy) {
    const affected = perComponentDiagnoses.filter((row) =>
      row.diagnoses.includes(diagnosis),
    );
    if (
      affected.length ||
      (diagnosis === "EVALUATION_INTEGRITY_FAILURE" &&
        input.integrityFailures.length)
    )
      blockers.push({
        diagnosis,
        errorComponentIds: unique(affected.map((row) => row.errorComponentId)),
        reasons:
          diagnosis === "EVALUATION_INTEGRITY_FAILURE"
            ? unique(input.integrityFailures)
            : unique(affected.flatMap((row) => row.reasons)),
      });
  }
  const incomplete = perComponentDiagnoses.filter((row) =>
    row.diagnoses.includes("LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE"),
  );
  if (incomplete.length)
    advisories.push({
      diagnosis: "LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE",
      errorComponentIds: incomplete.map((row) => row.errorComponentId),
      reasons: [
        "FULL_QUEUE_AUDIO_IS_ACTIONABLE_WITHOUT_AUTOMATIC_TEXT_RECOVERY",
      ],
    });
  const fullQueueGatePassed = Boolean(
    input.fullQueue &&
    input.fullQueue.officialMissingRecall.total > 0 &&
    input.fullQueue.officialHallucinationRecall.total > 0 &&
    input.fullQueue.officialMissingRecall.recall === 1 &&
    input.fullQueue.officialHallucinationRecall.recall === 1,
  );
  if (!fullQueueGatePassed)
    blockers.push({
      diagnosis: "FULL_QUEUE_PLAYBACK_GATE_FAILED",
      errorComponentIds: rows
        .filter((row) => !row.layers.audibleReviewCoverage.audible)
        .map((row) => row.errorComponentId),
      reasons: [
        "ALL_POST_FREEZE_MISSING_AND_HALLUCINATION_COMPONENTS_REQUIRE_FULL_QUEUE_AUDIBLE_COVERAGE",
      ],
    });
  if (!input.requiredTargetAudioGatePassed)
    blockers.push({
      diagnosis: "REQUIRED_TARGET_AUDIO_GATE_FAILED",
      errorComponentIds: [],
      reasons: [
        "EVERY_AUDIO_REQUIRED_TARGET_NEEDS_BOUND_PHYSICAL_AUDIO_AND_PLAYBACK",
      ],
    });
  if (!input.engineeringPassed)
    blockers.push({
      diagnosis: "ENGINEERING_GATE_FAILED",
      errorComponentIds: [],
      reasons: ["ENGINEERING_PARITY_FREEZE_OR_NON_MUTATION_GATE_FAILED"],
    });
  let primaryDecision: C60114RouteDecision["primaryDecision"] =
    hierarchy.find(([diagnosis]) =>
      blockers.some((row) => row.diagnosis === diagnosis),
    )?.[1] ?? "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION";
  if (
    primaryDecision === "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION" &&
    (!fullQueueGatePassed || !input.requiredTargetAudioGatePassed)
  )
    primaryDecision = "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
  if (!input.engineeringPassed && input.integrityFailures.length === 0)
    primaryDecision = "HOLD_FOR_ENGINEERING_REPAIR";
  return c60114RouteDecisionSchema.parse({
    primaryDecision,
    blockers,
    advisories,
    perComponentDiagnoses,
    fullQueueGatePassed,
    requiredTargetAudioGatePassed: input.requiredTargetAudioGatePassed,
    mandatorySubsetRecallIsBlocking: false,
    lexicalIncompleteWhenAudibleIsBlocking: false,
  });
}
