import {
  c6019PolicyVersion,
  goldCrossModelComplementarityEvaluationSchema,
  type GoldCrossModelComplementarityEvaluation,
  type MachineCrossModelComparison,
  type MachineCrossModelCtcArbitration,
} from "@mvl/shared";

import {
  independentAsrLexicalEditDistance,
  normalizeIndependentAsrLexical,
} from "./cross-model-normalization.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";
import type { GoldCrossModelTaxonomy } from "./second-asr-types.js";

export interface LocalCrossModelGoldInput {
  eventId: string;
  diagnosticRole: "TARGET" | "CONTROL";
  evaluationStatus: string;
  goldText: string | null;
  currentWhisperText: string | null;
}

function taxonomy(input: {
  whisperError: number;
  reazonError: number;
  disagreementClass: MachineCrossModelComparison["events"][number]["disagreementClass"];
}): GoldCrossModelTaxonomy {
  if (input.whisperError === 0 && input.reazonError === 0) {
    return "BOTH_CORRECT_OR_EQUIVALENT";
  }
  if (input.reazonError === 0) return "REAZON_ONLY_CORRECT";
  if (input.whisperError === 0) return "WHISPER_ONLY_CORRECT";
  if (input.disagreementClass === "ORTHOGRAPHY_ONLY_DIFFERENCE")
    return "ORTHOGRAPHY_ONLY";
  if (input.disagreementClass === "WHISPER_HALLUCINATION_RISK") {
    return "WHISPER_HALLUCINATION_ONLY";
  }
  if (input.disagreementClass === "REAZON_HALLUCINATION_RISK") {
    return "REAZON_HALLUCINATION_ONLY";
  }
  if (input.disagreementClass === "BOTH_LOW_SUPPORT") return "BOTH_HALLUCINATE";
  if (input.reazonError < input.whisperError) return "BOTH_WRONG_REAZON_BETTER";
  if (input.whisperError < input.reazonError)
    return "BOTH_WRONG_WHISPER_BETTER";
  return input.disagreementClass === "LEXICAL_DISAGREEMENT"
    ? "BOTH_WRONG_DIFFERENT"
    : "BOTH_WRONG_SIMILAR";
}

export function buildGoldCrossModelComplementarityEvaluation(input: {
  generatedAt: string;
  machineFreezeHash: string;
  goldIdentityHash: string;
  comparison: MachineCrossModelComparison;
  ctcArbitration: MachineCrossModelCtcArbitration;
  localGold: readonly LocalCrossModelGoldInput[];
}): GoldCrossModelComplementarityEvaluation {
  const localById = new Map(
    input.localGold.map((event) => [event.eventId, event]),
  );
  const ctcById = new Map(
    input.ctcArbitration.events.map((event) => [event.eventId, event]),
  );
  const events = input.comparison.events.map((comparison) => {
    const local = localById.get(comparison.eventId);
    const ctc = ctcById.get(comparison.eventId);
    if (local === undefined || local.goldText === null) {
      const core = {
        eventId: comparison.eventId,
        diagnosticRole: comparison.diagnosticRole,
        localEvaluationStatus:
          local?.evaluationStatus ?? "UNEVALUABLE_MISSING_MAPPING",
        whisperCoreError: null,
        bestWhisperPoolError: null,
        reazonCoreError: null,
        unionPoolError: null,
        taxonomy: "UNEVALUABLE" as const,
        baselineWrong: null,
        ctcOutcome: ctc?.outcome ?? null,
        ctcPreferenceCorrect: null,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    }
    const gold = normalizeIndependentAsrLexical(local.goldText);
    const error = (value: string) =>
      independentAsrLexicalEditDistance(
        normalizeIndependentAsrLexical(value),
        gold,
      );
    const poolErrors = comparison.whisperCandidates.map((candidate) =>
      error(candidate.displayText),
    );
    const bestWhisperPoolError =
      poolErrors.length === 0 ? null : Math.min(...poolErrors);
    const currentError =
      local.currentWhisperText === null
        ? null
        : error(local.currentWhisperText);
    const whisperCoreError = currentError ?? bestWhisperPoolError;
    const reazonCoreError = error(comparison.reazonCandidate.displayText);
    const unionPoolError = Math.min(
      bestWhisperPoolError ?? Number.MAX_SAFE_INTEGER,
      reazonCoreError,
    );
    if (whisperCoreError === null) {
      const core = {
        eventId: comparison.eventId,
        diagnosticRole: comparison.diagnosticRole,
        localEvaluationStatus: local.evaluationStatus,
        whisperCoreError: null,
        bestWhisperPoolError,
        reazonCoreError,
        unionPoolError,
        taxonomy: "UNEVALUABLE" as const,
        baselineWrong: null,
        ctcOutcome: ctc?.outcome ?? null,
        ctcPreferenceCorrect: null,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    }
    const eventTaxonomy = taxonomy({
      whisperError: bestWhisperPoolError ?? whisperCoreError,
      reazonError: reazonCoreError,
      disagreementClass: comparison.disagreementClass,
    });
    const preferenceCorrect =
      ctc === undefined ||
      ["CTC_AMBIGUOUS", "CTC_UNSCORABLE"].includes(ctc.outcome)
        ? null
        : ctc.outcome === "CTC_FAVORS_REAZON"
          ? reazonCoreError < (bestWhisperPoolError ?? whisperCoreError)
          : (bestWhisperPoolError ?? whisperCoreError) < reazonCoreError;
    const core = {
      eventId: comparison.eventId,
      diagnosticRole: comparison.diagnosticRole,
      localEvaluationStatus: local.evaluationStatus,
      whisperCoreError,
      bestWhisperPoolError,
      reazonCoreError,
      unionPoolError,
      taxonomy: eventTaxonomy,
      baselineWrong: whisperCoreError > 0,
      ctcOutcome: ctc?.outcome ?? null,
      ctcPreferenceCorrect: preferenceCorrect,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const taxonomyValues: GoldCrossModelTaxonomy[] = [
    "BOTH_CORRECT_OR_EQUIVALENT",
    "WHISPER_ONLY_BETTER",
    "REAZON_ONLY_BETTER",
    "WHISPER_ONLY_CORRECT",
    "REAZON_ONLY_CORRECT",
    "BOTH_WRONG_REAZON_BETTER",
    "BOTH_WRONG_WHISPER_BETTER",
    "BOTH_WRONG_SIMILAR",
    "BOTH_WRONG_DIFFERENT",
    "ORTHOGRAPHY_ONLY",
    "WHISPER_HALLUCINATION_ONLY",
    "REAZON_HALLUCINATION_ONLY",
    "BOTH_HALLUCINATE",
    "UNEVALUABLE",
  ];
  const taxonomyCounts = Object.fromEntries(
    taxonomyValues.map((value) => [
      value,
      events.filter((event) => event.taxonomy === value).length,
    ]),
  ) as Record<GoldCrossModelTaxonomy, number>;
  const evaluable = events.filter((event) => event.taxonomy !== "UNEVALUABLE");
  const ctcDecisive = evaluable.filter(
    (event) => event.ctcPreferenceCorrect !== null,
  );
  const ctcCorrect = ctcDecisive.filter(
    (event) => event.ctcPreferenceCorrect,
  ).length;
  const summary = {
    targetEvaluableCount: evaluable.filter(
      (event) => event.diagnosticRole === "TARGET",
    ).length,
    targetBaselineWrongCount: evaluable.filter(
      (event) => event.diagnosticRole === "TARGET" && event.baselineWrong,
    ).length,
    controlEvaluableCount: evaluable.filter(
      (event) => event.diagnosticRole === "CONTROL",
    ).length,
    taxonomyCounts,
    reazonOnlyBetterCount:
      taxonomyCounts.REAZON_ONLY_BETTER +
      taxonomyCounts.BOTH_WRONG_REAZON_BETTER,
    whisperOnlyBetterCount:
      taxonomyCounts.WHISPER_ONLY_BETTER +
      taxonomyCounts.BOTH_WRONG_WHISPER_BETTER,
    bothEquivalentCount: taxonomyCounts.BOTH_CORRECT_OR_EQUIVALENT,
    bothWrongCount: evaluable.filter(
      (event) =>
        event.reazonCoreError !== null &&
        event.reazonCoreError > 0 &&
        event.bestWhisperPoolError !== null &&
        event.bestWhisperPoolError > 0,
    ).length,
    reazonOnlyCorrectCount: taxonomyCounts.REAZON_ONLY_CORRECT,
    whisperOnlyCorrectCount: taxonomyCounts.WHISPER_ONLY_CORRECT,
    disagreementEvaluableCount: evaluable.filter(
      (event) =>
        ![
          "BOTH_CORRECT_OR_EQUIVALENT",
          "ORTHOGRAPHY_ONLY",
          "BOTH_WRONG_SIMILAR",
        ].includes(event.taxonomy),
    ).length,
    ctcCorrectPreferenceCount: ctcCorrect,
    ctcWrongPreferenceCount: ctcDecisive.length - ctcCorrect,
    ctcAmbiguousCount: evaluable.filter(
      (event) => event.ctcOutcome === "CTC_AMBIGUOUS",
    ).length,
    ctcUnscorableCount: evaluable.filter(
      (event) => event.ctcOutcome === "CTC_UNSCORABLE",
    ).length,
    ctcArbitrationAccuracy:
      ctcDecisive.length === 0 ? null : ctcCorrect / ctcDecisive.length,
  };
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "gold-cross-model-complementarity-evaluation" as const,
    evaluationPhase: "post-freeze-gold-isolated" as const,
    machineFreezeHash: input.machineFreezeHash,
    goldIdentityHash: input.goldIdentityHash,
    runtimeGoldInputCount: 0 as const,
    goldTextIncluded: false as const,
    events,
    summary,
  };
  return goldCrossModelComplementarityEvaluationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
