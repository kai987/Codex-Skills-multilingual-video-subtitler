import {
  lexical142Schema,
  missing142Schema,
  type Lexical142,
  type Policy142,
  type Safety142,
  type AsrProbes142,
  type C601141AsrProbes,
  type C601141Lexical,
  type Inventory142,
  type Samples142,
} from "@mvl/shared";
import { header142 } from "./c601142-policy.js";
import { unique142, coverageSamples142 } from "./c601142-selection.js";
import {
  hash141,
  hashed141,
  assertHash141,
  union141,
  seconds141,
  required141,
} from "./c601141-policy.js";
import { normalizeIndependentAsrLexical } from "../machine-quality/cross-model-normalization.js";
export function buildLexical142(input: {
  policy: Policy142;
  safety: Safety142;
  probes: AsrProbes142;
  previousProbes: C601141AsrProbes;
  previousLexical: C601141Lexical;
}): Lexical142 {
  const { policy, safety, probes } = input;
  [safety, probes, input.previousProbes, input.previousLexical].forEach(
    assertHash141,
  );
  const rate = safety.sourceIdentity.sampleRate;
  const targets = safety.targets.map((target) => {
    const current = probes.requests
      .filter((r) => r.clusterTargetId === target.targetId)
      .map((r) => ({ row: r, source: "CURRENT_C601142" as const }));
    const previous = input.previousProbes.requests
      .filter(
        (r) =>
          coverageSamples142(r.nativeInterval, target.targetCoreUnion) ===
          r.nativeInterval.endSample - r.nativeInterval.startSample,
      )
      .map((r) => ({ row: r, source: "PREVIOUS_C601141" as const }));
    const all = [...current, ...previous];
    const candidates: Lexical142["targets"][number]["localizedTextCandidates"] =
      [];
    for (const { row, source } of all) {
      if (
        row.status !== "SUCCESS" ||
        !row.localizedText ||
        row.strongContradiction ||
        row.hallucinationRisk >= 0.6
      )
        continue;
      if (row.localizationStatus === "EXACT_SOURCE_WINDOW")
        candidates.push({
          requestId: row.requestId,
          provider: row.provider,
          nativeInterval: row.nativeInterval,
          sourceInterval: row.targetInterval,
          text: row.localizedText,
          reading: row.readingText,
          readingRuntimeHash: row.readingRuntimeHash,
          source,
          localizationStatus: row.localizationStatus,
          lexicalTruthGuaranteed: false,
        });
      else if (row.localizationStatus === "TRUSTED_TOKEN_PROJECTION") {
        for (const token of row.tokens.filter(
          (t) =>
            t.trusted &&
            t.sourceInterval &&
            t.sourceInterval.start >= row.targetInterval.start &&
            t.sourceInterval.end <= row.targetInterval.end,
        )) {
          const interval = required141(token.sourceInterval);
          const nativeInterval = {
            startSample: Math.round(interval.start * rate),
            endSample: Math.round(interval.end * rate),
          };
          if (nativeInterval.endSample <= nativeInterval.startSample) continue;
          candidates.push({
            requestId: row.requestId,
            provider: row.provider,
            nativeInterval,
            sourceInterval: seconds141(nativeInterval, rate),
            text: token.text,
            reading: null,
            readingRuntimeHash: null,
            source,
            localizationStatus: row.localizationStatus,
            lexicalTruthGuaranteed: false,
          });
        }
      }
    }
    const exact = candidates.filter(
        (c) => c.localizationStatus === "EXACT_SOURCE_WINDOW",
      ),
      agreed: Samples142[] = [],
      readingAgreed: Samples142[] = [];
    let disagreement = false;
    for (const a of exact.filter((c) => c.provider === "whisper-large-v3"))
      for (const b of exact.filter(
        (c) => c.provider === "reazonspeech-k2-v2",
      )) {
        if (hash141(a.nativeInterval) !== hash141(b.nativeInterval)) continue;
        if (
          normalizeIndependentAsrLexical(a.text) ===
          normalizeIndependentAsrLexical(b.text)
        )
          agreed.push(a.nativeInterval);
        else if (
          a.reading &&
          a.reading === b.reading &&
          a.readingRuntimeHash === b.readingRuntimeHash
        )
          readingAgreed.push(a.nativeInterval);
        else disagreement = true;
      }
    const families = unique142(candidates.map((c) => c.provider));
    const empty =
      all.length > 0 && all.every((r) => r.row.status === "EMPTY_OUTPUT");
    const evidenceClass: Lexical142["targets"][number]["evidenceClass"] =
      agreed.length
        ? "CROSS_MODEL_LOCALIZED_AGREEMENT"
        : readingAgreed.length
          ? "PRONUNCIATION_AGREEMENT"
          : disagreement || families.length >= 2
            ? "CROSS_MODEL_DISAGREEMENT"
            : families[0] === "whisper-large-v3"
              ? "WHISPER_ONLY_LOCALIZED"
              : families[0] === "reazonspeech-k2-v2"
                ? "REAZON_ONLY_LOCALIZED"
                : empty
                  ? "BOTH_EMPTY"
                  : all.some(
                        (r) =>
                          r.row.hallucinationRisk >= 0.6 ||
                          r.row.strongContradiction,
                      )
                    ? "HALLUCINATION_RISK"
                    : all.some(
                          (r) =>
                            r.row.localizationStatus ===
                            "CONTEXT_UNPROJECTABLE",
                        )
                      ? "CONTEXT_ONLY_UNPROJECTABLE"
                      : "LOCALIZATION_UNRESOLVED";
    return hashed141({
      targetId: target.targetId,
      targetCoreUnion: target.targetCoreUnion,
      requestIds: unique142(all.map((r) => r.row.requestId)),
      evidenceFamilies: families,
      evidenceClass,
      localizedTextCandidates: candidates,
      reliableLocalizedLexical: target.targetCoreUnion.every(
        (v) =>
          coverageSamples142(v, [...agreed, ...readingAgreed]) /
            (v.endSample - v.startSample) >=
          policy.coverage.full,
      ),
      localizedNativeIntervalUnion: union141(
        candidates.map((c) => c.nativeInterval),
      ),
      canonicalInsertAllowed: false,
    });
  });
  return lexical142Schema.parse(
    hashed141({
      ...header142(policy, safety.sourceIdentity),
      artifactType: "machine-missing-lexical-evidence-v5",
      probesEvidenceHash: probes.evidenceSemanticHash,
      safetyHash: safety.semanticHash,
      previousLexicalHash: input.previousLexical.semanticHash,
      previousLexical: input.previousLexical,
      targets,
      summary: {
        targetCount: targets.length,
        crossModelCount: targets.filter(
          (t) => t.evidenceClass === "CROSS_MODEL_LOCALIZED_AGREEMENT",
        ).length,
        readingAgreementCount: targets.filter(
          (t) => t.evidenceClass === "PRONUNCIATION_AGREEMENT",
        ).length,
        singleModelCount: targets.filter((t) =>
          ["WHISPER_ONLY_LOCALIZED", "REAZON_ONLY_LOCALIZED"].includes(
            t.evidenceClass,
          ),
        ).length,
        emptyCount: targets.filter((t) => t.evidenceClass === "BOTH_EMPTY")
          .length,
        disagreementCount: targets.filter(
          (t) => t.evidenceClass === "CROSS_MODEL_DISAGREEMENT",
        ).length,
        reliableLocalizedCount: targets.filter(
          (t) => t.reliableLocalizedLexical,
        ).length,
        previousLocalizedTargetCount: input.previousLexical.targets.filter(
          (t) => t.localizedTextCandidates.length,
        ).length,
        localizedWhisperCandidateCount: targets
          .flatMap((t) => t.localizedTextCandidates)
          .filter(
            (c) =>
              c.provider === "whisper-large-v3" &&
              c.source === "CURRENT_C601142",
          ).length,
        localizedReazonCandidateCount: targets
          .flatMap((t) => t.localizedTextCandidates)
          .filter(
            (c) =>
              c.provider === "reazonspeech-k2-v2" &&
              c.source === "CURRENT_C601142",
          ).length,
        canonicalInsertCount: 0,
      },
    }),
  );
}
export function buildMissing142(
  inventory: Inventory142,
  safety: {
    sourceIdentity: Safety142["sourceIdentity"];
    semanticHash: string;
    targets: Pick<
      Safety142["targets"][number],
      | "targetId"
      | "targetCoreUnion"
      | "independentFamilyCount"
      | "evidenceIds"
      | "evidenceStrata"
      | "maskedEvidenceIds"
    >[];
  },
  lexical: Lexical142,
  policy: Policy142,
) {
  [inventory, safety, lexical].forEach(assertHash141);
  const targets = safety.targets.map((target) => {
    const row = lexical.targets.find((t) => t.targetId === target.targetId);
    if (!row) throw new Error("C601142_LEXICAL_TARGET_UNBOUND");
    const missingEvidenceClass =
      row.reliableLocalizedLexical && target.independentFamilyCount >= 2
        ? "MISSING_DIALOGUE_STRONG"
        : row.evidenceClass === "CROSS_MODEL_DISAGREEMENT"
          ? "ASR_DISAGREEMENT"
          : row.evidenceClass === "BOTH_EMPTY"
            ? "ASR_EMPTY"
            : "SPEECH_INVENTORY_SAFETY_RESERVE";
    return hashed141({
      targetId: target.targetId,
      targetCoreUnion: target.targetCoreUnion,
      evidenceIds: target.evidenceIds,
      requestIds: row.requestIds,
      evidenceStrata: target.evidenceStrata,
      evidenceFlags: [
        "SPEECH_PRESENCE_NOT_TRANSCRIPT_TRUTH",
        "AUDIO_REQUIRED_HUMAN_REVIEW",
        "EMPTY_ASR_DOES_NOT_DELETE_TARGET",
        ...(target.maskedEvidenceIds.length ? ["MASKED_SPEECH_EVIDENCE"] : []),
      ],
      lexicalEvidenceClass: row.evidenceClass,
      missingEvidenceClass,
      requiredLevel: "RECOMMENDED",
      canonicalInsertAllowed: false,
    });
  });
  return missing142Schema.parse(
    hashed141({
      ...header142(policy, safety.sourceIdentity),
      artifactType: "machine-missing-speech-evidence-v5",
      inventoryHash: inventory.semanticHash,
      safetyHash: safety.semanticHash,
      lexicalHash: lexical.semanticHash,
      targets,
      summary: {
        targetCount: targets.length,
        speechOnlySafetyCount: targets.filter(
          (t) => t.missingEvidenceClass === "SPEECH_INVENTORY_SAFETY_RESERVE",
        ).length,
        localizedAgreementCount: targets.filter(
          (t) => t.missingEvidenceClass === "MISSING_DIALOGUE_STRONG",
        ).length,
        emptyAsrTargetRetainedCount: targets.filter(
          (t) => t.missingEvidenceClass === "ASR_EMPTY",
        ).length,
        nonMandatoryCount: targets.length,
        canonicalInsertCount: 0,
      },
    }),
  );
}
