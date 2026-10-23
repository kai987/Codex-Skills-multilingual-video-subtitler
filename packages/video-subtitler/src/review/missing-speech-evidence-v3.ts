/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Keep explicit evidence guards even for pinned TypeScript literals. */
import {
  c60114MissingSpeechEvidenceV3Schema,
  type C60114LocalizedLexicalEvidence,
  type C60114MissingSpeechEvidenceV3,
  type C60114SourceIdentity,
  type C60114ProbeTarget,
  type C60114SpeechIslands,
  type C60114OrphanSpeechSweep,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { isC60114ObservedOrphan } from "./orphan-speech-sweep.js";

/** Review-only successor. Never calls or changes the V2 parser or Final cues. */
export function buildMissingSpeechEvidenceV3(input: {
  sourceIdentity: C60114SourceIdentity;
  policyHash: string;
  targets: readonly C60114ProbeTarget[];
  lexicalEvidence: C60114LocalizedLexicalEvidence;
  speechIslands: C60114SpeechIslands;
  orphanSweep: C60114OrphanSpeechSweep;
  migratedV2GapIds?: readonly string[];
  deprecatedEnvelopeOnlyEvidenceCount?: number;
}): C60114MissingSpeechEvidenceV3 {
  const sourceIdentityHash = machineQualitySemanticHash(input.sourceIdentity);
  const validSourceIdentity =
    input.lexicalEvidence.sourceIdentityHash === sourceIdentityHash &&
    machineQualitySemanticHash(input.lexicalEvidence.sourceIdentity) ===
      sourceIdentityHash &&
    machineQualitySemanticHash(input.speechIslands.sourceIdentity) ===
      sourceIdentityHash &&
    machineQualitySemanticHash(input.orphanSweep.sourceIdentity) ===
      sourceIdentityHash &&
    input.lexicalEvidence.policyHash === input.policyHash;
  const rows = new Map<
    string,
    C60114MissingSpeechEvidenceV3["targets"][number]
  >();
  for (const island of [
    ...input.speechIslands.islands,
    ...input.speechIslands.globalIslands,
  ]) {
    if (rows.has(island.islandId)) continue;
    // The sweep partitions an island into exact covered/uncovered fragments.
    // Consume those fragments below; never replace them by the parent envelope.
    if (
      input.orphanSweep.entries.some(
        (row) => row.sourceIslandId === island.islandId,
      )
    )
      continue;
    rows.set(island.islandId, {
      targetId: island.islandId,
      sourceInterval: island.sourceInterval,
      classification: island.strongContradiction
        ? "NON_SPEECH_CONTRADICTED"
        : !validSourceIdentity || island.localizationStatus !== "VERIFIED"
          ? "LOCALIZATION_UNRESOLVED"
          : island.reliableLocalizedLexical
            ? "MISSING_DIALOGUE_LEXICAL_POSSIBLE"
            : "SPEECH_ISLAND_OBSERVED",
      validSourceIdentity,
      verifiedUncovered: false,
      cueCoveredRatio: 1,
      crossModelLocalizedAgreement: false,
      singleProviderStable: false,
      evidenceRequestIds: [],
      reasons: [
        ...island.reasons,
        "OBSERVED_SPEECH_RETAINED_WITHOUT_PROBE",
        "PARENT_GAP_SEARCH_ENVELOPE_NOT_SPEECH_EVIDENCE",
      ],
      requiresHumanReview: true,
      canonicalCoverageCredit: false,
      autoCueGenerationAllowed: false,
    });
  }
  for (const orphan of input.orphanSweep.entries) {
    if (
      !isC60114ObservedOrphan(orphan) &&
      orphan.classification !== "NON_SPEECH_CONTRADICTED"
    )
      continue;
    if (rows.has(orphan.orphanId)) continue;
    const verifiedEvidence =
      input.speechIslands.audit?.evidence.filter(
        (e) =>
          orphan.evidenceIds.includes(e.evidenceId) &&
          e.mappingStatus === "VERIFIED" &&
          e.sourceIdentityHash === sourceIdentityHash &&
          e.sourceInterval !== null,
      ) ?? [];
    if (!validSourceIdentity || verifiedEvidence.length === 0) continue;
    rows.set(orphan.orphanId, {
      targetId: orphan.orphanId,
      sourceInterval: orphan.sourceInterval,
      classification: orphan.strongContradiction
        ? "NON_SPEECH_CONTRADICTED"
        : "MACHINE_DETECTION_ORPHAN",
      validSourceIdentity,
      verifiedUncovered: false,
      cueCoveredRatio: orphan.cueCoveredRatio,
      crossModelLocalizedAgreement: false,
      singleProviderStable: false,
      evidenceRequestIds: [],
      reasons: [...orphan.reasons, "ORPHAN_RETAINED_WITHOUT_PROBE"],
      requiresHumanReview: true,
      canonicalCoverageCredit: false,
      autoCueGenerationAllowed: false,
    });
  }
  for (const target of input.targets) {
    const lexical = input.lexicalEvidence.targets.find(
      (row) => row.targetId === target.targetId,
    );
    const duration = target.sourceInterval.end - target.sourceInterval.start;
    const verifiedUncovered =
      validSourceIdentity &&
      target.validTimebase &&
      target.speechPositive &&
      target.cueCoveredRatio <= 0.01 &&
      target.cueCoveredRatio * duration <= 0.05 &&
      !target.strongContradiction;
    let classification: C60114MissingSpeechEvidenceV3["targets"][number]["classification"] =
      "SPEECH_ISLAND_OBSERVED";
    if (!validSourceIdentity || !target.validTimebase)
      classification = "LOCALIZATION_UNRESOLVED";
    else if (target.strongContradiction)
      classification = "NON_SPEECH_CONTRADICTED";
    else if (lexical?.classification === "HALLUCINATION_RISK")
      classification = "LOCALIZATION_UNRESOLVED";
    else if (lexical?.classification === "CROSS_MODEL_LEXICAL_DISAGREEMENT")
      classification = "MISSING_DIALOGUE_ASR_DISAGREEMENT";
    else if (lexical?.classification === "BOTH_EMPTY")
      classification = "MISSING_DIALOGUE_ASR_EMPTY";
    else if (
      lexical?.classification === "CONTEXT_ONLY_UNPROJECTABLE" ||
      lexical?.classification === "LOCALIZATION_UNRESOLVED"
    )
      classification = "LOCALIZATION_UNRESOLVED";
    else if (
      lexical?.classification === "GUARD_CONTACT_CROSS_MODEL_LEXICAL_SUPPORT"
    )
      classification = "MISSING_DIALOGUE_LEXICAL_POSSIBLE";
    else if (verifiedUncovered && lexical?.crossModelLocalizedAgreement)
      classification = "MISSING_DIALOGUE_CROSS_MODEL_STRONG";
    else if (lexical?.singleProviderExactContextStable)
      classification = "MISSING_DIALOGUE_SINGLE_MODEL_STABLE";
    else if (lexical?.evidenceRequestIds.length)
      classification = "MISSING_DIALOGUE_LEXICAL_POSSIBLE";
    rows.set(target.targetId, {
      targetId: target.targetId,
      sourceInterval: target.sourceInterval,
      classification,
      validSourceIdentity,
      verifiedUncovered,
      cueCoveredRatio: target.cueCoveredRatio,
      crossModelLocalizedAgreement:
        lexical?.crossModelLocalizedAgreement ?? false,
      singleProviderStable: lexical?.singleProviderExactContextStable ?? false,
      evidenceRequestIds: lexical?.evidenceRequestIds ?? [],
      reasons: [
        "LOCALIZED_REVIEW_EVIDENCE_ONLY",
        "NO_CANONICAL_MUTATION_OR_AUTOMATIC_CUE",
        ...(verifiedUncovered
          ? ["VERIFIED_ALMOST_ZERO_CUE_COVERAGE"]
          : ["UNCOVERED_IDENTITY_NOT_FULLY_PROVEN"]),
        ...(lexical?.reasons ?? []),
      ],
      requiresHumanReview: true,
      canonicalCoverageCredit: false,
      autoCueGenerationAllowed: false,
    });
  }
  const core = {
    schemaVersion: "1.0.0" as const,
    artifactType: "missing-speech-evidence-v3" as const,
    policyVersion:
      "c6.0.1.14-missing-localization-playback-integrity-v1" as const,
    sourceIdentityHash,
    sourceIdentity: input.sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    runtimeGoldInputCount: 0 as const,
    policyHash: input.policyHash,
    lexicalEvidenceHash: input.lexicalEvidence.semanticHash,
    targets: [...rows.values()].sort(
      (a, b) =>
        a.sourceInterval.start - b.sourceInterval.start ||
        a.targetId.localeCompare(b.targetId),
    ),
    parentGaps: input.speechIslands.parentGaps,
    migratedV2GapIds: [
      ...(input.migratedV2GapIds ??
        input.speechIslands.parentGaps.map((gap) => gap.gapId)),
    ].sort(),
    deprecatedEnvelopeOnlyEvidenceCount:
      input.deprecatedEnvelopeOnlyEvidenceCount ??
      input.speechIslands.parentGaps.length,
    parentGapNotUsedAsSpeechEvidenceCount:
      input.speechIslands.parentGaps.length,
    canonicalMutationCount: 0 as const,
  };
  return c60114MissingSpeechEvidenceV3Schema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
