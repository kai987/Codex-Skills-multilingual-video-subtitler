import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  NodeProcessRunner,
  c60114LocalizedLexicalEvidenceSchema,
  c60114ProbeRelocalizationSchema,
  type C60114LocalizedLexicalEvidence,
  type C60114ProbeExecution,
  type C60114ProbeTarget,
  type C60114ProbeRelocalization,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { c60113HashPayload } from "./c60113-region-features.js";
import {
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
  normalizedEditSimilarity,
} from "../machine-quality/cross-model-normalization.js";
import { loadSudachiRuntimeCapability } from "../sudachi-runtime.js";
import { runSudachiMorphemeAnalysis } from "../sudachi-analysis.js";

export interface C60114VerifiedReadings {
  runtimeIdentityHash: string;
  readings: ReadonlyMap<string, string | null>;
}
export function buildLocalizedMissingLexicalEvidence(input: {
  targets: readonly C60114ProbeTarget[];
  probes: C60114ProbeExecution;
  verifiedReadings?: C60114VerifiedReadings;
  readingUnavailableReason?: string;
  relocalization?: C60114ProbeRelocalization;
}): C60114LocalizedLexicalEvidence {
  if (input.relocalization) {
    c60114ProbeRelocalizationSchema.parse(input.relocalization);
    if (
      input.relocalization.semanticHash !==
      c60113HashPayload(input.relocalization)
    )
      throw new Error("C60114_DERIVED_LOCALIZATION_HASH_MISMATCH");
  }
  if (
    input.relocalization &&
    (input.relocalization.originalProbeSemanticHash !==
      input.probes.semanticHash ||
      input.relocalization.originalSelectionHash !== input.probes.selectionHash)
  )
    throw new Error("C60114_DERIVED_LOCALIZATION_BINDING_MISMATCH");
  const targets = input.targets.map((target) => {
    const requests = input.probes.requests.filter(
      (request) => request.targetId === target.targetId,
    );
    const candidates = requests.map((request) => {
      const derived = input.relocalization?.requests.find(
        (r) => r.requestId === request.requestId,
      );
      if (
        input.relocalization &&
        derived?.originalRequestSemanticHash !== request.semanticHash
      )
        throw new Error("C60114_DERIVED_REQUEST_BINDING_MISMATCH");
      const localized =
        request.status === "SUCCESS" &&
        request.sourceIdentityHash === input.probes.sourceIdentityHash &&
        request.sourceMediaSha256 ===
          input.probes.sourceIdentity.sourceMediaSha256 &&
        request.policyHash === input.probes.policyHash &&
        request.selectionHash === input.probes.selectionHash &&
        request.coreInterval.start === target.sourceInterval.start &&
        request.coreInterval.end === target.sourceInterval.end &&
        (derived
          ? derived.localizationVerified
          : request.localization.localizedText !== null &&
            [
              "CORE_EXACT_ISLAND_LOCALIZED",
              "TRUSTED_GLOBAL_TOKEN_PROJECTION",
            ].includes(request.localization.status));
      const displayText = normalizeIndependentAsrDisplay(
        localized
          ? (derived?.localizedText ?? request.localization.localizedText ?? "")
          : request.rawText,
      );
      const reading =
        input.verifiedReadings?.readings.get(request.requestId) ?? null;
      return {
        requestId: request.requestId,
        provider: request.provider,
        windowType: request.windowType,
        displayText,
        lexicalText: normalizeIndependentAsrLexical(displayText),
        pronunciationText:
          reading === null ? null : normalizeJapanesePronunciation(reading),
        localized,
        hallucinationRisk: request.hallucinationRisk,
        localizationStatus: derived?.status ?? request.localization.status,
        eligibleForCrossModelReconciliation:
          derived?.eligibleForCrossModelReconciliation ?? localized,
        guardContactCaution: derived?.guardContactCaution ?? false,
      };
    });
    // Core exact takes precedence. Context is eligible only after verified token
    // projection; raw strings can never be used merely because they contain the core.
    const select = (provider: "whisper-large-v3" | "reazonspeech-k2-v2") =>
      candidates.find(
        (candidate) =>
          candidate.provider === provider &&
          candidate.windowType === "CORE_EXACT" &&
          candidate.eligibleForCrossModelReconciliation &&
          candidate.lexicalText !== "",
      ) ??
      candidates.find(
        (candidate) =>
          candidate.provider === provider &&
          candidate.eligibleForCrossModelReconciliation &&
          candidate.lexicalText !== "",
      );
    const whisper = select("whisper-large-v3");
    const reazon = select("reazonspeech-k2-v2");
    const comparable = whisper !== undefined && reazon !== undefined;
    const displayAgreement =
      comparable && whisper.displayText === reazon.displayText;
    const lexicalAgreement =
      comparable && whisper.lexicalText === reazon.lexicalText;
    const pronunciationAvailable =
      comparable &&
      whisper.pronunciationText !== null &&
      reazon.pronunciationText !== null;
    const pronunciationAgreement = pronunciationAvailable
      ? whisper.pronunciationText === reazon.pronunciationText
      : null;
    const hallucination = [whisper, reazon].some(
      (candidate) =>
        candidate !== undefined && candidate.hallucinationRisk >= 0.6,
    );
    const crossModelLocalizedAgreement =
      !hallucination &&
      (lexicalAgreement || pronunciationAgreement === true) &&
      ((whisper?.localized === true && reazon?.localized === true) ||
        [whisper, reazon].some(
          (c) => c?.localizationStatus === "TRUSTED_GLOBAL_TOKEN_PROJECTION",
        ));
    const guardContactSupport =
      !hallucination &&
      (lexicalAgreement || pronunciationAgreement === true) &&
      [whisper, reazon].some((c) => c?.guardContactCaution) &&
      !crossModelLocalizedAgreement;
    const singleProviderExactContextStable =
      !comparable &&
      candidates.some(
        (exact) =>
          exact.localized &&
          exact.windowType === "CORE_EXACT" &&
          exact.lexicalText !== "" &&
          exact.hallucinationRisk < 0.6 &&
          candidates.some(
            (context) =>
              context.provider === exact.provider &&
              context.windowType === "CORE_CONTEXT" &&
              context.localized &&
              context.hallucinationRisk < 0.6 &&
              context.lexicalText === exact.lexicalText,
          ),
      );
    const successful = requests.filter(
      (request) =>
        request.status === "SUCCESS" || request.status === "EMPTY_OUTPUT",
    );
    let classification: C60114LocalizedLexicalEvidence["targets"][number]["classification"];
    if (hallucination) classification = "HALLUCINATION_RISK";
    else if (guardContactSupport)
      classification = "GUARD_CONTACT_CROSS_MODEL_LEXICAL_SUPPORT";
    else if (lexicalAgreement) classification = "CROSS_MODEL_LEXICAL_AGREEMENT";
    else if (pronunciationAgreement) classification = "PRONUNCIATION_AGREEMENT";
    else if (comparable) classification = "CROSS_MODEL_LEXICAL_DISAGREEMENT";
    else if (whisper?.localized) classification = "WHISPER_ONLY_LOCALIZED";
    else if (reazon?.localized) classification = "REAZON_ONLY_LOCALIZED";
    else if (
      successful.length >= 2 &&
      requests.every((request) => request.status === "EMPTY_OUTPUT") &&
      new Set(
        requests
          .filter((request) => request.windowType === "CORE_EXACT")
          .map((request) => request.provider),
      ).size === 2
    )
      classification = "BOTH_EMPTY";
    else if (
      requests.some(
        (request) =>
          request.localization.status === "CONTEXT_TEXT_UNPROJECTABLE",
      )
    )
      classification = "CONTEXT_ONLY_UNPROJECTABLE";
    else classification = "LOCALIZATION_UNRESOLVED";
    const row = {
      targetId: target.targetId,
      sourceInterval: target.sourceInterval,
      sourceIslandId: target.sourceIslandId,
      evidenceFamilies: [
        ...new Set(
          candidates
            .filter((c) => c.eligibleForCrossModelReconciliation)
            .map((c) => c.provider),
        ),
      ].sort(),
      candidates,
      classification,
      displayAgreement,
      lexicalAgreement,
      pronunciationAgreement,
      lexicalSimilarity: comparable
        ? normalizedEditSimilarity(whisper.lexicalText, reazon.lexicalText)
        : null,
      pronunciationSimilarity: pronunciationAvailable
        ? normalizedEditSimilarity(
            whisper.pronunciationText ?? "",
            reazon.pronunciationText ?? "",
          )
        : null,
      crossModelLocalizedAgreement,
      singleProviderExactContextStable,
      evidenceRequestIds: [whisper, reazon].flatMap((candidate) =>
        candidate ? [candidate.requestId] : [],
      ),
      reasons: [
        "PROMPT_FREE_ORIGINAL_LANGUAGE_MACHINE_EVIDENCE",
        "DISPLAY_LEXICAL_AND_VERIFIED_PRONUNCIATION_SEPARATE",
        ...(guardContactSupport
          ? ["GUARD_CONTACT_SUPPORT_IS_POSSIBLE_NOT_STRONG_MISSING_EVIDENCE"]
          : []),
        ...(singleProviderExactContextStable
          ? ["SAME_MODEL_EXACT_CONTEXT_NOT_CROSS_MODEL_SUPPORT"]
          : []),
        ...(requests.some(
          (request) =>
            request.status !== "SUCCESS" && request.status !== "EMPTY_OUTPUT",
        )
          ? ["PROBE_FAILURE_RETAINED_NOT_TREATED_AS_EMPTY"]
          : []),
      ],
      requiresHumanReview: true as const,
    };
    return { ...row, semanticHash: machineQualitySemanticHash(row) };
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    artifactType: "localized-missing-lexical-evidence" as const,
    policyVersion:
      "c6.0.1.14-missing-localization-playback-integrity-v1" as const,
    sourceIdentityHash: input.probes.sourceIdentityHash,
    sourceIdentity: input.probes.sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    runtimeGoldInputCount: 0 as const,
    policyHash: input.probes.policyHash,
    probeSemanticHash: input.probes.semanticHash,
    readingMechanism: {
      status: input.verifiedReadings
        ? ("VERIFIED_SUDACHI" as const)
        : ("UNAVAILABLE" as const),
      runtimeIdentityHash: input.verifiedReadings?.runtimeIdentityHash ?? null,
      reason: input.verifiedReadings
        ? null
        : (input.readingUnavailableReason ??
          "VERIFIED_READING_MECHANISM_NOT_CONFIGURED"),
    },
    targets,
  };
  return c60114LocalizedLexicalEvidenceSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

export async function reconcileC60114MissingLexicalEvidence(input: {
  targets: readonly C60114ProbeTarget[];
  probes: C60114ProbeExecution;
  relocalization?: C60114ProbeRelocalization;
  sudachiRuntimeManifestPath?: string;
  sudachiPython?: string;
  sudachiHelperPath?: string;
  sudachiRequirementsPath?: string;
}): Promise<C60114LocalizedLexicalEvidence> {
  if (!input.sudachiRuntimeManifestPath)
    return buildLocalizedMissingLexicalEvidence(input);
  try {
    const pythonExecutable =
      input.sudachiPython ??
      path.join(
        path.dirname(input.sudachiRuntimeManifestPath),
        "venv",
        "bin",
        "python",
      );
    const helperPath =
      input.sudachiHelperPath ??
      fileURLToPath(
        new URL("../../../../scripts/sudachi-readings.py", import.meta.url),
      );
    const requirementsPath =
      input.sudachiRequirementsPath ??
      fileURLToPath(
        new URL(
          "../../../../scripts/requirements-sudachi.txt",
          import.meta.url,
        ),
      );
    const capability = await loadSudachiRuntimeCapability({
      manifestPath: input.sudachiRuntimeManifestPath,
      pythonExecutable,
      helperPath,
      requirementsPath,
      runner: new NodeProcessRunner(),
    });
    const items = input.probes.requests
      .filter(
        (request) =>
          request.status === "SUCCESS" &&
          (request.localization.localizedText ?? request.rawText).trim() !== "",
      )
      .map((request) => ({
        id: request.requestId,
        text:
          input.relocalization?.requests.find(
            (row) => row.requestId === request.requestId,
          )?.localizedText ??
          request.localization.localizedText ??
          request.rawText,
      }));
    const analysis = items.length
      ? await runSudachiMorphemeAnalysis({
          pythonExecutable,
          helperPath,
          items,
        })
      : { readingsById: new Map<string, string | null>() };
    return buildLocalizedMissingLexicalEvidence({
      ...input,
      verifiedReadings: {
        runtimeIdentityHash: capability.runtimeIdentityHash,
        readings: analysis.readingsById,
      },
    });
  } catch {
    return buildLocalizedMissingLexicalEvidence({
      ...input,
      readingUnavailableReason:
        "SUDACHI_RUNTIME_OR_READING_VERIFICATION_FAILED",
    });
  }
}
