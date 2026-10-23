import {
  c6019PolicyVersion,
  machineSecondAsrStabilitySchema,
  type MachineIndependentAsrCandidates,
  type MachineSecondAsrStability,
} from "@mvl/shared";

import { normalizedEditSimilarity } from "./cross-model-normalization.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildMachineSecondAsrStability(input: {
  generatedAt: string;
  candidates: MachineIndependentAsrCandidates;
}): MachineSecondAsrStability {
  const eventIds = [
    ...new Set(
      input.candidates.candidates.map((candidate) => candidate.eventId),
    ),
  ].toSorted();
  if (eventIds.length !== 24)
    throw new Error(`Expected 24 diagnostic events; got ${eventIds.length}.`);
  const events = eventIds.map((eventId) => {
    const exact = input.candidates.candidates.find(
      (candidate) =>
        candidate.eventId === eventId && candidate.windowType === "CORE_EXACT",
    );
    const context = input.candidates.candidates.find(
      (candidate) =>
        candidate.eventId === eventId &&
        candidate.windowType === "CORE_CONTEXT",
    );
    if (exact === undefined || context === undefined)
      throw new Error(`Missing paired windows for ${eventId}.`);
    const exactSimilarity = normalizedEditSimilarity(
      exact.displayText,
      context.displayText,
    );
    const normalizedSimilarity = normalizedEditSimilarity(
      exact.normalizedDisplayText,
      context.normalizedDisplayText,
    );
    const pronunciationSimilarity = normalizedEditSimilarity(
      exact.pronunciationText,
      context.pronunciationText,
    );
    const contextExtensionObserved =
      exact.normalizedDisplayText !== "" &&
      context.normalizedDisplayText.includes(exact.normalizedDisplayText) &&
      context.normalizedDisplayText !== exact.normalizedDisplayText;
    let stabilityClass: MachineSecondAsrStability["events"][number]["stabilityClass"];
    if (
      exact.evidenceAvailability === "INCOMPLETE" ||
      context.evidenceAvailability === "INCOMPLETE"
    ) {
      stabilityClass = "UNCOMPARABLE";
    } else if (
      exact.normalizedDisplayText === "" ||
      context.normalizedDisplayText === ""
    ) {
      stabilityClass = "REAZON_EMPTY_UNSTABLE";
    } else if (
      exact.diagnostics.repetitionRisk >= 0.6 ||
      context.diagnostics.repetitionRisk >= 0.6
    ) {
      stabilityClass = "REAZON_HALLUCINATION_UNSTABLE";
    } else if (normalizedSimilarity === 1) {
      stabilityClass = "REAZON_CORE_STABLE";
    } else if (contextExtensionObserved || pronunciationSimilarity >= 0.9) {
      stabilityClass = "REAZON_CONTEXT_EXTENSION_ONLY";
    } else stabilityClass = "REAZON_LEXICALLY_UNSTABLE";
    const core = {
      eventId,
      diagnosticRole: exact.diagnosticRole,
      coreExactCandidateId: exact.candidateId,
      coreContextCandidateId: context.candidateId,
      stabilityClass,
      exactSimilarity,
      normalizedSimilarity,
      pronunciationSimilarity,
      contextExtensionObserved,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const count = (
    value: MachineSecondAsrStability["events"][number]["stabilityClass"],
  ) => events.filter((event) => event.stabilityClass === value).length;
  const stableCount =
    count("REAZON_CORE_STABLE") + count("REAZON_CONTEXT_EXTENSION_ONLY");
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-second-asr-stability" as const,
    candidatesSemanticHash: input.candidates.semanticHash,
    events,
    summary: {
      eventCount: 24 as const,
      coreStableCount: count("REAZON_CORE_STABLE"),
      contextExtensionOnlyCount: count("REAZON_CONTEXT_EXTENSION_ONLY"),
      lexicallyUnstableCount: count("REAZON_LEXICALLY_UNSTABLE"),
      hallucinationUnstableCount: count("REAZON_HALLUCINATION_UNSTABLE"),
      emptyUnstableCount: count("REAZON_EMPTY_UNSTABLE"),
      uncomparableCount: count("UNCOMPARABLE"),
      stableRate: stableCount / events.length,
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineSecondAsrStabilitySchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
