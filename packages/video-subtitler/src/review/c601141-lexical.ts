import {
  c601141LexicalSchema,
  c601141MissingEvidenceSchema,
  machineGlobalTokenTimelineV2Schema,
  type C601141AsrProbes,
  type C601141Safety,
  type C601141Inventory,
  type C601141Lexical,
  type C601141Policy,
  type C601141Fingerprint,
  type C60114LocalizedLexicalEvidence,
} from "@mvl/shared";
import {
  assertHash141,
  hashed141,
  header141,
  unique141,
} from "./c601141-policy.js";
import { c60114Id } from "./c60114-policy.js";
import { normalizeIndependentAsrLexical } from "../machine-quality/cross-model-normalization.js";

export function buildLexical141(
  probes: C601141AsrProbes,
  safety: C601141Safety,
  policy: C601141Policy,
  provenance?: {
    existing: C60114LocalizedLexicalEvidence;
    fingerprint: C601141Fingerprint;
    tokens: unknown;
  },
): C601141Lexical {
  [probes, safety].forEach(assertHash141);
  const targets = safety.targets.map((target) => {
    const rows = probes.requests.filter((v) => v.targetId === target.targetId);
    const candidates = rows.filter(
      (v) =>
        v.status === "SUCCESS" &&
        v.localizedText &&
        !v.strongContradiction &&
        v.hallucinationRisk < 0.6 &&
        ["EXACT_SOURCE_WINDOW", "TRUSTED_TOKEN_PROJECTION"].includes(
          v.localizationStatus,
        ),
    );
    const pick = (provider: string) =>
      candidates.find(
        (v) => v.provider === provider && v.windowType === "CORE_EXACT",
      ) ?? candidates.find((v) => v.provider === provider);
    const whisper = pick("whisper-large-v3"),
      reazon = pick("reazonspeech-k2-v2");
    const agreement =
      whisper &&
      reazon &&
      normalizeIndependentAsrLexical(whisper.localizedText) ===
        normalizeIndependentAsrLexical(reazon.localizedText);
    const readingAgreement =
      whisper &&
      reazon &&
      whisper.readingText !== null &&
      whisper.readingText === reazon.readingText &&
      whisper.readingRuntimeHash === reazon.readingRuntimeHash;
    const evidenceClass: C601141Lexical["targets"][number]["evidenceClass"] =
      agreement
        ? "CROSS_MODEL_LOCALIZED_AGREEMENT"
        : readingAgreement
          ? "PRONUNCIATION_AGREEMENT"
          : whisper && reazon
            ? "CROSS_MODEL_DISAGREEMENT"
            : whisper
              ? "WHISPER_ONLY_LOCALIZED"
              : reazon
                ? "REAZON_ONLY_LOCALIZED"
                : rows.some(
                      (v) =>
                        v.hallucinationRisk >= 0.6 || v.strongContradiction,
                    )
                  ? "HALLUCINATION_RISK"
                  : rows.some(
                        (v) => v.localizationStatus === "CONTEXT_UNPROJECTABLE",
                      )
                    ? "CONTEXT_ONLY_UNPROJECTABLE"
                    : rows.length &&
                        rows.every((v) => v.status === "EMPTY_OUTPUT")
                      ? "BOTH_EMPTY"
                      : "LOCALIZATION_UNRESOLVED";
    return hashed141({
      targetId: target.targetId,
      requestIds: rows.map((v) => v.requestId),
      evidenceFamilies: unique141(candidates.map((v) => v.provider)),
      sourceInterval: target.sourceInterval,
      nativeInterval: target.nativeInterval,
      evidenceClass,
      localizedTextCandidates: candidates.map((v) => ({
        requestId: v.requestId,
        text: v.localizedText,
        reading: v.readingText,
      })),
      reliableLocalizedLexical: Boolean(agreement) || Boolean(readingAgreement),
      canonicalInsertAllowed: false as const,
    });
  });
  const historicalFingerprintCandidates: C601141Lexical["historicalFingerprintCandidates"] =
    [];
  if (provenance) {
    [provenance.existing, provenance.fingerprint].forEach(assertHash141);
    const tokens = machineGlobalTokenTimelineV2Schema.parse(provenance.tokens);
    if (tokens.sourceMediaSha256 !== safety.sourceIdentity.sourceMediaSha256)
      throw new Error("C601141_LEXICAL_SOURCE_MISMATCH");
    const byId = new Map(
      tokens.tokens.map((token) => [
        c60114Id("evidence", {
          key: "tokenTimeline",
          rawId: token.tokenId,
          family: "TRUSTED_MAPPED_TOKEN",
        }),
        token,
      ]),
    );
    for (const entry of provenance.fingerprint.entries) {
      if (
        !entry.lexicalEvidenceEligible ||
        !entry.nativeInterval ||
        !entry.uniquenessPassed
      )
        continue;
      const token = byId.get(entry.evidenceId);
      if (!token?.text.trim()) continue;
      historicalFingerprintCandidates.push(
        hashed141({
          evidenceId: entry.evidenceId,
          requestIds: entry.requestIds,
          nativeInterval: entry.nativeInterval,
          sourceInterval: {
            start:
              entry.nativeInterval.startSample /
              safety.sourceIdentity.sampleRate,
            end:
              entry.nativeInterval.endSample / safety.sourceIdentity.sampleRate,
          },
          displayText: token.text,
          normalizedText: normalizeIndependentAsrLexical(token.text),
          classification: "HISTORICAL_FINGERPRINT_LOCALIZED",
          sourceLocalizationVerified: true,
          lexicalTruthGuaranteed: false,
          canonicalInsertAllowed: false,
        }),
      );
    }
  }
  return c601141LexicalSchema.parse(
    hashed141({
      ...header141(policy, safety.sourceIdentity),
      artifactType: "machine-missing-lexical-evidence-v4",
      probesEvidenceHash: probes.evidenceSemanticHash,
      targets,
      existingProbeEvidence: provenance?.existing ?? null,
      existingProbeEvidenceHash: provenance?.existing.semanticHash ?? null,
      fingerprintEvidenceHash: provenance?.fingerprint.semanticHash ?? null,
      historicalFingerprintCandidates,
      summary: {
        targetCount: targets.length,
        crossModelCount: targets.filter(
          (v) => v.evidenceClass === "CROSS_MODEL_LOCALIZED_AGREEMENT",
        ).length,
        readingAgreementCount: targets.filter(
          (v) => v.evidenceClass === "PRONUNCIATION_AGREEMENT",
        ).length,
        singleModelCount: targets.filter((v) =>
          ["WHISPER_ONLY_LOCALIZED", "REAZON_ONLY_LOCALIZED"].includes(
            v.evidenceClass,
          ),
        ).length,
        emptyCount: targets.filter((v) => v.evidenceClass === "BOTH_EMPTY")
          .length,
        disagreementCount: targets.filter(
          (v) => v.evidenceClass === "CROSS_MODEL_DISAGREEMENT",
        ).length,
        reliableLocalizedCount: targets.filter(
          (v) => v.reliableLocalizedLexical,
        ).length,
        existingProbeTargetCount: provenance?.existing.targets.length ?? 0,
        historicalFingerprintCandidateCount:
          historicalFingerprintCandidates.length,
        canonicalInsertCount: 0,
      },
    }),
  );
}
export function buildMissing141(
  inventory: C601141Inventory,
  safety: C601141Safety,
  lexical: C601141Lexical,
  policy: C601141Policy,
) {
  [inventory, safety, lexical].forEach(assertHash141);
  const targets = safety.targets.map((target) => {
    const row = lexical.targets.find((v) => v.targetId === target.targetId);
    if (!row) throw new Error("C601141_MISSING_LEXICAL_TARGET_BINDING");
    const strong =
      target.targetType === "SPEECH_INVENTORY_STRONG_UNCOVERED" &&
      row.reliableLocalizedLexical &&
      !target.strongContradiction;
    const evidenceFlags = unique141([
      target.targetType === "SPEECH_INVENTORY_STRONG_UNCOVERED"
        ? "SPEECH_INVENTORY_STRONG"
        : "SPEECH_INVENTORY_SAFETY_RESERVE",
      ...(target.evidenceClass === "LEGACY_FINGERPRINT_CONFIRMED"
        ? ["LEGACY_FINGERPRINT_RECOVERED"]
        : []),
      ...(row.reliableLocalizedLexical ? ["LEXICAL_CROSS_MODEL_SUPPORT"] : []),
      ...(["WHISPER_ONLY_LOCALIZED", "REAZON_ONLY_LOCALIZED"].includes(
        row.evidenceClass,
      )
        ? ["LEXICAL_SINGLE_MODEL_SUPPORT"]
        : []),
      ...(row.evidenceClass === "CROSS_MODEL_DISAGREEMENT"
        ? ["ASR_DISAGREEMENT"]
        : []),
      ...(row.evidenceClass === "BOTH_EMPTY" ? ["ASR_EMPTY"] : []),
      ...(target.strongContradiction ? ["NON_SPEECH_CONTRADICTED"] : []),
      ...(target.evidenceClass === "DETECTOR_DISAGREEMENT"
        ? ["DETECTOR_DISAGREEMENT"]
        : []),
    ]);
    return hashed141({
      targetId: target.targetId,
      sourceInterval: target.sourceInterval,
      nativeInterval: target.nativeInterval,
      evidenceIds: target.evidenceIds,
      requestIds: row.requestIds,
      speechEvidenceClass: target.evidenceClass,
      lexicalEvidenceClass: row.evidenceClass,
      evidenceFlags,
      missingEvidenceClass: strong
        ? "MISSING_DIALOGUE_STRONG"
        : target.strongContradiction
          ? "NON_SPEECH_CONTRADICTED"
          : row.evidenceClass === "CROSS_MODEL_DISAGREEMENT"
            ? "ASR_DISAGREEMENT"
            : row.evidenceClass === "BOTH_EMPTY"
              ? "ASR_EMPTY"
              : ["WHISPER_ONLY_LOCALIZED", "REAZON_ONLY_LOCALIZED"].includes(
                    row.evidenceClass,
                  )
                ? "LEXICAL_SINGLE_MODEL_SUPPORT"
                : target.targetType === "SPEECH_INVENTORY_STRONG_UNCOVERED"
                  ? "SPEECH_INVENTORY_STRONG"
                  : "SPEECH_INVENTORY_SAFETY_RESERVE",
      subtitleAction: "HUMAN_REVIEW_ONLY",
    });
  });
  return c601141MissingEvidenceSchema.parse(
    hashed141({
      ...header141(policy, safety.sourceIdentity),
      artifactType: "machine-missing-speech-evidence-v4",
      inventoryHash: inventory.semanticHash,
      safetyHash: safety.semanticHash,
      lexicalHash: lexical.semanticHash,
      targets,
      summary: {
        targetCount: targets.length,
        strongMissingCount: targets.filter(
          (v) => v.missingEvidenceClass === "MISSING_DIALOGUE_STRONG",
        ).length,
        safetyOnlyCount: targets.filter(
          (v) => v.missingEvidenceClass === "SPEECH_INVENTORY_SAFETY_RESERVE",
        ).length,
        canonicalInsertCount: 0,
      },
    }),
  );
}
