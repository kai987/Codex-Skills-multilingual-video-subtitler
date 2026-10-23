import {
  c60113EvidenceFamilyGraphSchema,
  c60113EvidenceObservationSchema,
  type C60113EvidenceFamily,
  type C60113EvidenceFamilyGraph,
  type C60113EvidenceObservation,
  type C60113ReviewPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60112MachineOnlyInput,
  type C60112ReviewItem,
} from "./c60112-policy.js";
import {
  c60113ArtifactHeader,
  uniqueC60113,
  withC60113SemanticHash,
} from "./c60113-policy.js";

export type C60113ObservationInput = Omit<
  C60113EvidenceObservation,
  "semanticHash"
>;
export interface C60113RawArtifacts {
  speechCoverage?: unknown;
  arbitrationEvidence?: unknown;
  acousticRisk?: unknown;
  overlapClassification?: unknown;
  calibrationCorpus?: unknown;
  vadTimebase?: unknown;
  acousticScenes?: unknown;
  speakerEvidence?: unknown;
}

export function c60113Record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function c60113Records(
  value: unknown,
  field: string,
): Record<string, unknown>[] {
  const candidate = c60113Record(value)[field];
  return Array.isArray(candidate) ? candidate.map(c60113Record) : [];
}
export function c60113Strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : [];
}
export function c60113Observation(
  value: C60113ObservationInput,
): C60113EvidenceObservation {
  const fields = { ...value } as C60113ObservationInput & {
    semanticHash?: string;
  };
  delete fields.semanticHash;
  const core = {
    ...fields,
    rootLineageIds: uniqueC60113(value.rootLineageIds),
    itemIds: uniqueC60113(value.itemIds),
    gapIds: uniqueC60113(value.gapIds),
    strength: value.evidenceAbsence ? 0 : value.strength,
    positiveRisk: value.evidenceAbsence ? false : value.positiveRisk,
  };
  return c60113EvidenceObservationSchema.parse(withC60113SemanticHash(core));
}

/** Same lineage and declared correlation groups are transitive, including
 * cross-model derived evidence. A derivative cannot create an extra vote. */
export function c60113CorrelationGroups(
  evidence: readonly C60113EvidenceObservation[],
): C60113EvidenceFamilyGraph["correlationGroups"] {
  const parent = evidence.map((_, index) => index);
  const find = (index: number): number => {
    const next = parent[index];
    if (next === undefined || next === index) return index;
    parent[index] = find(next);
    return parent[index] ?? index;
  };
  const identities = new Map<string, number>();
  evidence.forEach((entry, index) => {
    for (const identity of [
      `correlation:${entry.correlationGroup}`,
      ...entry.rootLineageIds.map((root) => `root:${root}`),
    ]) {
      const previous = identities.get(identity);
      if (previous === undefined) identities.set(identity, index);
      else parent[find(index)] = find(previous);
    }
  });
  const groups = new Map<number, C60113EvidenceObservation[]>();
  evidence.forEach((entry, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), entry]);
  });
  return [...groups.values()]
    .map((members) => {
      const evidenceIds = uniqueC60113(
        members.map((entry) => entry.evidenceId),
      );
      return {
        groupId: `evidence-group-${machineQualitySemanticHash(evidenceIds).slice(0, 20)}`,
        evidenceIds,
        rootLineageIds: uniqueC60113(
          members.flatMap((entry) => entry.rootLineageIds),
        ),
        families: [...new Set(members.map((entry) => entry.family))].toSorted(),
      };
    })
    .toSorted((a, b) => a.groupId.localeCompare(b.groupId));
}

/** Maximum bipartite matching: each disjoint root group and each family can
 * contribute at most once. Merely renaming one source as VAD/token/segment
 * cannot increase independent breadth. */
export function c60113IndependentEvidenceGroups(
  evidence: readonly C60113EvidenceObservation[],
): C60113EvidenceFamilyGraph["correlationGroups"] {
  const usable = evidence.filter(
    (entry) =>
      !entry.evidenceAbsence && !entry.contradiction && entry.strength > 0,
  );
  // Breadth is not event count. Several diagnostics from one model family
  // remain one independent vote even when separate utterance roots deserve
  // separate risk-coverage keys in the region scheduler.
  const providerCorrelated = usable.map((entry) => ({
    ...entry,
    rootLineageIds: [
      ...entry.rootLineageIds,
      `declared-correlation:${entry.correlationGroup}`,
    ],
    correlationGroup:
      entry.provider === null
        ? entry.correlationGroup
        : `independent-provider-family:${entry.provider}`,
  }));
  return c60113CorrelationGroups(providerCorrelated);
}

export function c60113IndependentFamilies(
  evidence: readonly C60113EvidenceObservation[],
): C60113EvidenceFamily[] {
  const groups = c60113IndependentEvidenceGroups(evidence);
  const matched = new Map<C60113EvidenceFamily, number>();
  const visit = (
    groupIndex: number,
    seen: Set<C60113EvidenceFamily>,
  ): boolean => {
    const group = groups[groupIndex];
    if (group === undefined) return false;
    for (const family of group.families) {
      if (seen.has(family)) continue;
      seen.add(family);
      const previous = matched.get(family);
      if (previous === undefined || visit(previous, seen)) {
        matched.set(family, groupIndex);
        return true;
      }
    }
    return false;
  };
  groups.forEach((_, index) => {
    visit(index, new Set());
  });
  return [...matched.keys()].toSorted();
}

export function buildC60113EvidenceFamilyGraph(input: {
  observations: readonly C60113EvidenceObservation[];
  policy: C60113ReviewPolicy;
}): C60113EvidenceFamilyGraph {
  assertC60112MachineOnlyInput(input.observations);
  const seen = new Map<string, C60113EvidenceObservation>();
  for (const observation of input.observations) {
    const entry = c60113EvidenceObservationSchema.parse(observation);
    const { semanticHash, ...core } = entry;
    if (machineQualitySemanticHash(core) !== semanticHash)
      throw new Error(`C60113_EVIDENCE_HASH_MISMATCH:${entry.evidenceId}`);
    const prior = seen.get(entry.evidenceId);
    if (prior !== undefined && prior.semanticHash !== entry.semanticHash)
      throw new Error(`C60113_CONFLICTING_EVIDENCE_ID:${entry.evidenceId}`);
    seen.set(entry.evidenceId, entry);
  }
  const evidence = [...seen.values()].toSorted((a, b) =>
    a.evidenceId.localeCompare(b.evidenceId),
  );
  const correlationGroups = c60113CorrelationGroups(evidence);
  return c60113EvidenceFamilyGraphSchema.parse(
    withC60113SemanticHash({
      ...c60113ArtifactHeader(input.policy),
      artifactType: "c6-0-1-13-machine-review-evidence-families",
      evidence,
      correlationGroups,
      summary: {
        evidenceCount: evidence.length,
        familyCount: new Set(evidence.map((entry) => entry.family)).size,
        correlationGroupCount: correlationGroups.length,
        correlatedEvidenceDeduplicatedCount:
          evidence.length - correlationGroups.length,
        duplicateEvidenceInputCount:
          input.observations.length - evidence.length,
        evidenceAbsenceCount: evidence.filter((entry) => entry.evidenceAbsence)
          .length,
        evidenceAbsenceRiskBoostCount: 0,
      },
    }),
  );
}

const REASON_MAPPING: Readonly<
  Record<
    string,
    {
      family: C60113EvidenceFamily;
      provider: string;
      strength: number;
      absence?: boolean;
      positive?: boolean;
    }
  >
> = {
  WHISPER_REAZON_LEXICAL_CONFLICT: {
    family: "CROSS_MODEL_CONTENT",
    provider: "cross-model",
    strength: 0.65,
  },
  WHISPER_CORE_UNSTABLE: {
    family: "WHISPER_STABILITY",
    provider: "whisper",
    strength: 0.6,
  },
  REAZON_CORE_UNSTABLE: {
    family: "REAZON_STABILITY",
    provider: "reazon-data-family",
    strength: 0.6,
  },
  WHISPER_HALLUCINATION_SIGNAL: {
    family: "HALLUCINATION",
    provider: "whisper",
    strength: 0.7,
  },
  REAZON_HALLUCINATION_SIGNAL: {
    family: "HALLUCINATION",
    provider: "reazon-data-family",
    strength: 0.7,
  },
  INDEPENDENT_ACOUSTIC_DISAGREEMENT: {
    family: "ACOUSTIC_ALIGNMENT",
    provider: "independent-acoustic",
    strength: 0.65,
  },
  INDEPENDENT_ACOUSTIC_LOW_MARGIN: {
    family: "ACOUSTIC_ALIGNMENT",
    provider: "independent-acoustic",
    strength: 0,
    positive: false,
  },
  DECODER_WEAK: { family: "DECODER", provider: "whisper", strength: 0.4 },
  SPEECH_INCOMPLETE: {
    family: "SPEECH_ACTIVITY",
    provider: "speech-vad",
    strength: 0.3,
    positive: false,
  },
  REQUEST_EDGE_RISK: {
    family: "LOCALIZATION",
    provider: "whisper",
    strength: 0.45,
  },
  TIMING_EVIDENCE_CONFLICT: {
    family: "TIMING_BOUNDARY",
    provider: "timing",
    strength: 0.55,
  },
  OVERLAP_UNRESOLVED: { family: "OVERLAP", provider: "overlap", strength: 0.5 },
  SPEAKER_OVERLAP: {
    family: "SPEAKER_ACTIVITY",
    provider: "speaker",
    strength: 0.6,
  },
  LOCALIZATION_AMBIGUOUS: {
    family: "LOCALIZATION",
    provider: "localization",
    strength: 0.55,
  },
  MISSING_DIALOGUE_SUSPECTED: {
    family: "SPEECH_ACTIVITY",
    provider: "speech-vad",
    strength: 0.2,
    positive: false,
  },
  SPAN_LINEAGE_UNAVAILABLE: {
    family: "STRUCTURAL_INTEGRITY",
    provider: "provenance",
    strength: 0,
    absence: true,
  },
  MACHINE_EVIDENCE_INCOMPLETE: {
    family: "LOCALIZATION",
    provider: "unknown",
    strength: 0,
    absence: true,
  },
};

export function adaptC60113ReviewEvidence(input: {
  items: readonly C60112ReviewItem[];
  rawArtifacts: C60113RawArtifacts;
}): C60113EvidenceObservation[] {
  assertC60112MachineOnlyInput(input.items);
  const output: C60113EvidenceObservation[] = [];
  for (const item of input.items) {
    const arbitration = c60113Records(
      input.rawArtifacts.arbitrationEvidence,
      "events",
    ).filter(
      (entry) =>
        typeof entry.eventId === "string" &&
        item.eventIds.includes(entry.eventId),
    );
    for (const event of arbitration) {
      const eventId = String(event.eventId);
      const emit = (
        suffix: string,
        family: C60113EvidenceFamily,
        provider: string,
        strength: number,
        roots: string[],
        absence = false,
        positive = true,
      ) => {
        output.push(
          c60113Observation({
            evidenceId: `${item.reviewItemId}:${eventId}:${suffix}`,
            rootLineageIds:
              roots.length > 0 ? roots : [`${eventId}:${provider}`],
            family,
            provider,
            correlationGroup: `${eventId}:${provider}`,
            itemIds: [item.reviewItemId],
            gapIds: [],
            sourceInterval: item.coreInterval,
            positiveRisk: positive,
            evidenceAbsence: absence,
            contradiction: false,
            strength,
            validatedSourceGlobal: false,
            detailCode: suffix,
          }),
        );
      };
      for (const [key, family, provider] of [
        ["whisperStability", "WHISPER_STABILITY", "whisper"],
        ["reazonStability", "REAZON_STABILITY", "reazon-data-family"],
      ] as const) {
        const stability = c60113Record(event[key]);
        const negative =
          stability.negativeEvidence === true ||
          stability.hardBlocked === true ||
          String(stability.class).includes("UNSTABLE");
        if (negative)
          emit(
            key,
            family,
            provider,
            stability.strongNegativeEvidence === true ? 0.85 : 0.65,
            c60113Strings(stability.sourceEvidenceIds),
          );
      }
      const relation =
        typeof event.crossModelRelation === "string"
          ? event.crossModelRelation
          : "UNKNOWN";
      if (
        relation === "LEXICAL_DISAGREEMENT" ||
        relation === "PARTIAL_AGREEMENT"
      ) {
        const roots = [
          c60113Record(event.currentWhisperCandidate).semanticHash,
          c60113Record(event.reazonCoreExactCandidate).semanticHash,
        ].filter((entry): entry is string => typeof entry === "string");
        emit(
          "CROSS_MODEL_LEXICAL_CONFLICT",
          "CROSS_MODEL_CONTENT",
          "cross-model",
          relation === "LEXICAL_DISAGREEMENT" ? 0.7 : 0.35,
          roots,
        );
      }
      for (const [key, provider] of [
        ["whisperHallucinationRisk", "whisper"],
        ["reazonHallucinationRisk", "reazon-data-family"],
      ] as const) {
        const risk = event[key];
        if (typeof risk === "number" && risk > 0)
          emit(key, "HALLUCINATION", provider, Math.min(1, risk), [
            typeof event.semanticHash === "string"
              ? event.semanticHash
              : `${eventId}:${provider}`,
          ]);
      }
      for (const [key, family, provider] of [
        ["whisperDecoderEvidence", "DECODER", "whisper"],
        ["whisperTokenEvidence", "TIMING_BOUNDARY", "whisper"],
        ["requestEdgeEvidence", "LOCALIZATION", "whisper"],
        ["speechCompletenessEvidence", "SPEECH_ACTIVITY", "speech-vad"],
      ] as const) {
        const field = c60113Record(event[key]);
        if (Object.keys(field).length === 0) continue;
        const absence =
          field.evidenceMissing === true || field.status === "EVIDENCE_ABSENCE";
        const negative =
          field.status === "NEGATIVE_EVIDENCE" ||
          field.status === "STRONG_NEGATIVE_EVIDENCE";
        if (absence || negative)
          emit(
            key,
            family,
            provider,
            field.strong === true ? 0.85 : 0.4,
            c60113Strings(field.sourceEvidenceIds),
            absence,
            negative,
          );
      }
      if (event.coreLocalizationStatus === "MACHINE_LOCALIZABLE") {
        emit(
          "LOCALIZATION_AVAILABLE",
          "LOCALIZATION",
          "localization",
          0.7,
          [String(event.semanticHash)],
          false,
          false,
        );
      }
    }
    const risks = c60113Records(
      input.rawArtifacts.acousticRisk,
      "events",
    ).filter(
      (entry) =>
        typeof entry.eventId === "string" &&
        item.eventIds.includes(entry.eventId),
    );
    for (const event of risks) {
      for (const fact of c60113Records(event, "facts")) {
        const name = typeof fact.name === "string" ? fact.name : "";
        const mapping: Record<string, [C60113EvidenceFamily, string]> = {
          ctcWeak: ["ACOUSTIC_ALIGNMENT", "reazon-data-family"],
          pronunciationCoverageWeak: [
            "ACOUSTIC_ALIGNMENT",
            "reazon-data-family",
          ],
          ctcUnscorable: ["ACOUSTIC_ALIGNMENT", "reazon-data-family"],
          tokenWeak: ["TIMING_BOUNDARY", "whisper"],
          tokenConflict: ["TIMING_BOUNDARY", "whisper"],
          speechIncomplete: ["SPEECH_ACTIVITY", "speech-vad"],
          decoderWeak: ["DECODER", "whisper"],
          decoderUnknown: ["DECODER", "whisper"],
          requestEdgeRisk: ["LOCALIZATION", "whisper"],
          independentWindowDisagreement: ["WHISPER_STABILITY", "whisper"],
          repetitionRisk: ["HALLUCINATION", "whisper"],
          noSpeechConflict: ["HALLUCINATION", "whisper"],
          durationTextAnomaly: ["TIMING_BOUNDARY", "whisper"],
          associationAmbiguity: ["LOCALIZATION", "localization"],
          overlapRisk: ["OVERLAP", "overlap"],
        };
        const mapped = mapping[name];
        if (mapped === undefined || fact.severity === "NONE") continue;
        const roots = c60113Strings(fact.evidenceIds);
        // No-token and unscorable diagnostics are uncertainty, never error proof.
        const absence =
          name === "ctcUnscorable" ||
          name === "decoderUnknown" ||
          (name === "tokenWeak" && roots.length === 0);
        output.push(
          c60113Observation({
            evidenceId: `${item.reviewItemId}:${String(event.eventId)}:fact:${name}`,
            rootLineageIds:
              roots.length > 0
                ? roots
                : [`${String(event.eventId)}:${mapped[1]}`],
            family: mapped[0],
            provider: mapped[1],
            correlationGroup: `${String(event.eventId)}:${mapped[1]}`,
            itemIds: [item.reviewItemId],
            gapIds: [],
            sourceInterval: item.coreInterval,
            positiveRisk: !absence && name !== "speechIncomplete",
            evidenceAbsence: absence,
            contradiction: false,
            strength: fact.severity === "STRONG" ? 0.85 : 0.4,
            validatedSourceGlobal: false,
            detailCode: name,
          }),
        );
      }
    }
    const familiesPresent = new Set(
      output
        .filter((entry) => entry.itemIds.includes(item.reviewItemId))
        .map((entry) => entry.family),
    );
    for (const reason of item.reviewReasons) {
      const mapping = REASON_MAPPING[reason];
      if (mapping === undefined || familiesPresent.has(mapping.family))
        continue;
      output.push(
        c60113Observation({
          evidenceId: `${item.reviewItemId}:legacy:${reason}`,
          rootLineageIds: [
            `legacy-item:${item.reviewItemId}:${mapping.provider}`,
          ],
          family: mapping.family,
          provider: mapping.provider,
          correlationGroup: `legacy-item:${item.reviewItemId}:${mapping.provider}`,
          itemIds: [item.reviewItemId],
          gapIds: [],
          sourceInterval: item.coreInterval,
          positiveRisk: mapping.positive ?? !mapping.absence,
          evidenceAbsence: mapping.absence ?? false,
          contradiction: false,
          strength: mapping.strength,
          validatedSourceGlobal: false,
          detailCode: `LEGACY_${reason}`,
        }),
      );
    }
  }
  return output;
}
