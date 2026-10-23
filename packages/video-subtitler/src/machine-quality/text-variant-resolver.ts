import {
  machineTextVariantDecisionSchema,
  type C6014Mode,
  type MachineTextVariantAcousticVerification,
  type MachineTextVariantDecision,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface VariantDecisionInput {
  variantId: string;
  hardRejectReasons: readonly string[];
  independentSupportCount: number;
  trustedTokenSupportCount: number;
  trustedTokenConflict: boolean;
  decoderEvidence: string;
  edgeTruncationRisk: boolean;
  linguisticTieBreakRank: number | null;
  orthographicReadingGroup: string | null;
}

export interface EventVariantDecisionInput {
  eventId: string;
  currentSelectedVariantId: string;
  variants: readonly VariantDecisionInput[];
  multiSpeakerUnresolved?: boolean;
}

function uniqueMaximum(
  variants: readonly VariantDecisionInput[],
  value: (variant: VariantDecisionInput) => number,
): VariantDecisionInput | null {
  if (variants.length === 0) return null;
  const sorted = [...variants].toSorted(
    (left, right) =>
      value(right) - value(left) ||
      left.variantId.localeCompare(right.variantId),
  );
  const first = sorted[0];
  const second = sorted[1];
  if (first === undefined || value(first) <= 0) return null;
  if (second !== undefined && value(second) === value(first)) return null;
  return first;
}

export function resolveTextVariants(input: {
  mode: C6014Mode;
  events: readonly EventVariantDecisionInput[];
  acousticVerification: MachineTextVariantAcousticVerification;
  generatedAt?: string;
}): MachineTextVariantDecision {
  const acousticByEvent = new Map(
    input.acousticVerification.events.map((event) => [event.eventId, event]),
  );
  const decisions = [...input.events]
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId))
    .map((event) => {
      const variants = [...event.variants].toSorted((left, right) =>
        left.variantId.localeCompare(right.variantId),
      );
      const hardRejected = variants
        .filter((variant) => variant.hardRejectReasons.length > 0)
        .map((variant) => variant.variantId);
      const eligible = variants.filter(
        (variant) => variant.hardRejectReasons.length === 0,
      );
      const acoustic = acousticByEvent.get(event.eventId);
      let selectedVariant: string | null = null;
      let runnerUp: string | null = null;
      let decisionStatus:
        | "SELECT_EXISTING_VARIANT"
        | "AMBIGUOUS_VARIANT"
        | "NO_ACOUSTICALLY_SUPPORTED_VARIANT"
        | "INSUFFICIENT_EVIDENCE"
        | "MULTI_SPEAKER_UNRESOLVED"
        | "REJECT_EVENT";
      let confidenceClass: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
      const reasons: string[] = [];
      let linguisticTieBreakUsed = false;
      let linguisticTieBreakSelection: string | null = null;
      if (event.multiSpeakerUnresolved === true) {
        decisionStatus = "MULTI_SPEAKER_UNRESOLVED";
        confidenceClass = "UNKNOWN";
        reasons.push("multi-speaker-event-requires-targeted-speaker-evidence");
      } else if (eligible.length === 0) {
        decisionStatus = "REJECT_EVENT";
        confidenceClass = "UNKNOWN";
        reasons.push("all-machine-variants-hard-rejected");
      } else if (eligible.length === 1) {
        selectedVariant = eligible[0]?.variantId ?? null;
        decisionStatus = "SELECT_EXISTING_VARIANT";
        confidenceClass = variants.length === 1 ? "MEDIUM" : "LOW";
        reasons.push(
          variants.length === 1
            ? "single-real-machine-variant-preserved"
            : "only-one-variant-remains-after-hard-validity-gate",
        );
      } else {
        const acousticWinner = eligible.find(
          (variant) =>
            variant.variantId === acoustic?.selectedByAcousticEvidence &&
            !variant.trustedTokenConflict,
        );
        if (acousticWinner !== undefined) {
          selectedVariant = acousticWinner.variantId;
          runnerUp =
            eligible.find((variant) => variant.variantId !== selectedVariant)
              ?.variantId ?? null;
          decisionStatus = "SELECT_EXISTING_VARIANT";
          confidenceClass = "HIGH";
          reasons.push(
            "pairwise-ctc-acoustic-dominance",
            "trusted-token-conflict-absent",
            "length-and-prefix-bias-guards-passed",
          );
        } else {
          const independentWinner = uniqueMaximum(
            eligible,
            (variant) => variant.independentSupportCount,
          );
          const independentRunnerSupport = Math.max(
            0,
            ...eligible
              .filter(
                (variant) => variant.variantId !== independentWinner?.variantId,
              )
              .map((variant) => variant.independentSupportCount),
          );
          if (
            independentWinner !== null &&
            independentWinner.independentSupportCount >= 2 &&
            independentWinner.independentSupportCount -
              independentRunnerSupport >=
              1 &&
            !independentWinner.trustedTokenConflict &&
            !independentWinner.edgeTruncationRisk
          ) {
            selectedVariant = independentWinner.variantId;
            runnerUp =
              eligible.find((variant) => variant.variantId !== selectedVariant)
                ?.variantId ?? null;
            decisionStatus = "SELECT_EXISTING_VARIANT";
            confidenceClass = "MEDIUM";
            reasons.push(
              "independent-window-support-dominates-after-correlation-collapse",
              "acoustic-evidence-does-not-contradict-selection",
            );
          } else {
            const tokenWinner = uniqueMaximum(
              eligible.filter((variant) => !variant.trustedTokenConflict),
              (variant) => variant.trustedTokenSupportCount,
            );
            const tokenRunnerSupport = Math.max(
              0,
              ...eligible
                .filter(
                  (variant) => variant.variantId !== tokenWinner?.variantId,
                )
                .map((variant) => variant.trustedTokenSupportCount),
            );
            if (
              tokenWinner !== null &&
              tokenWinner.trustedTokenSupportCount >= 2 &&
              tokenWinner.trustedTokenSupportCount - tokenRunnerSupport >= 2 &&
              !tokenWinner.edgeTruncationRisk
            ) {
              selectedVariant = tokenWinner.variantId;
              runnerUp =
                eligible.find(
                  (variant) => variant.variantId !== selectedVariant,
                )?.variantId ?? null;
              decisionStatus = "SELECT_EXISTING_VARIANT";
              confidenceClass = "MEDIUM";
              reasons.push(
                "trusted-source-global-token-span-dominates",
                "acoustic-evidence-does-not-contradict-selection",
              );
            } else {
              const readingGroups = new Set(
                eligible.map((variant) => variant.orthographicReadingGroup),
              );
              const linguisticWinner = uniqueMaximum(
                eligible.filter(
                  (variant) => variant.linguisticTieBreakRank !== null,
                ),
                (variant) => variant.linguisticTieBreakRank ?? 0,
              );
              if (
                readingGroups.size === 1 &&
                !readingGroups.has(null) &&
                linguisticWinner !== null &&
                !linguisticWinner.trustedTokenConflict
              ) {
                selectedVariant = linguisticWinner.variantId;
                runnerUp =
                  eligible.find(
                    (variant) => variant.variantId !== selectedVariant,
                  )?.variantId ?? null;
                decisionStatus = "SELECT_EXISTING_VARIANT";
                confidenceClass = "LOW";
                linguisticTieBreakUsed = true;
                linguisticTieBreakSelection = selectedVariant;
                reasons.push(
                  "orthographic-only-same-reading-ambiguity",
                  "generic-linguistic-tie-break-used-after-acoustic-tie",
                );
              } else {
                const scorable = acoustic?.ctcEvidence.filter(
                  (evidence) => evidence.evidenceStatus === "CTC_SCORABLE",
                );
                decisionStatus =
                  scorable === undefined || scorable.length === 0
                    ? "NO_ACOUSTICALLY_SUPPORTED_VARIANT"
                    : "AMBIGUOUS_VARIANT";
                confidenceClass = "UNKNOWN";
                reasons.push(
                  scorable === undefined || scorable.length === 0
                    ? "no-existing-variant-has-reliable-acoustic-support"
                    : "top-variant-evidence-margin-is-not-decisive",
                  "forced-ambiguous-winner-forbidden",
                );
              }
            }
          }
        }
      }
      const independentSupport = Object.fromEntries(
        variants.map((variant) => [
          variant.variantId,
          variant.independentSupportCount,
        ]),
      );
      const tokenSupport = Object.fromEntries(
        variants.map((variant) => [
          variant.variantId,
          variant.trustedTokenSupportCount,
        ]),
      );
      const decoderEvidence = Object.fromEntries(
        variants.map((variant) => [variant.variantId, variant.decoderEvidence]),
      );
      const core = {
        eventId: event.eventId,
        inputVariants: variants.map((variant) => variant.variantId),
        hardRejected,
        ctcEvidenceIds:
          acoustic?.ctcEvidence.map((evidence) => evidence.semanticHash) ?? [],
        independentSupport,
        tokenSupport,
        decoderEvidence,
        linguisticTieBreak: {
          used: linguisticTieBreakUsed,
          selectedVariantId: linguisticTieBreakSelection,
          reasons: linguisticTieBreakUsed
            ? ["generic-context-only-after-acoustic-equivalence"]
            : [],
        },
        selectedVariant,
        runnerUp,
        decisionStatus,
        decisionReasons: reasons,
        confidenceClass,
        magicWeightedScoreUsed: false as const,
        forcedWinner: false as const,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
  const eventById = new Map(
    input.events.map((event) => [event.eventId, event]),
  );
  const core = {
    mode: input.mode,
    decisions,
    summary: {
      eventCount: decisions.length,
      multiVariantEventCount: input.events.filter(
        (event) => event.variants.length > 1,
      ).length,
      singleVariantEventCount: input.events.filter(
        (event) => event.variants.length === 1,
      ).length,
      hardRejectedVariantCount: decisions.reduce(
        (sum, decision) => sum + decision.hardRejected.length,
        0,
      ),
      clearWinnerCount: decisions.filter(
        (decision) => decision.decisionStatus === "SELECT_EXISTING_VARIANT",
      ).length,
      ambiguousVariantCount: decisions.filter((decision) =>
        [
          "AMBIGUOUS_VARIANT",
          "NO_ACOUSTICALLY_SUPPORTED_VARIANT",
          "INSUFFICIENT_EVIDENCE",
          "MULTI_SPEAKER_UNRESOLVED",
        ].includes(decision.decisionStatus),
      ).length,
      replacementCount: decisions.filter((decision) => {
        const prior = eventById.get(decision.eventId)?.currentSelectedVariantId;
        return (
          input.mode === "enforce" &&
          decision.selectedVariant !== null &&
          decision.selectedVariant !== prior
        );
      }).length,
      unchangedCount: decisions.filter((decision) => {
        const prior = eventById.get(decision.eventId)?.currentSelectedVariantId;
        return decision.selectedVariant === prior;
      }).length,
      unresolvedCount: decisions.filter(
        (decision) => decision.selectedVariant === null,
      ).length,
      forcedWinnerCount: 0 as const,
    },
  };
  return machineTextVariantDecisionSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-text-variant-decision",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
