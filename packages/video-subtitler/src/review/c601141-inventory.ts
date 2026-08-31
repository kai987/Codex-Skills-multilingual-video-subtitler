import {
  c601141InventorySchema,
  c601141UncoveredSchema,
  c601141SafetySchema,
  c601141AsrSelectionSchema,
  type C601141Policy,
  type C60114SourceIdentity,
  type C601141Observation,
  type C601141Island,
  type C601141Inventory,
  type C601141Fingerprint,
  type C601141Sweeps,
  type C601141Uncovered,
  type C601141Safety,
  type C601141SafetyTarget,
  type C60114SpeechIslands,
} from "@mvl/shared";
import {
  hashed141,
  header141,
  id141,
  unique141,
  native141,
  seconds141,
  subtract141,
  duration141,
  assertHash141,
  hash141,
  required141,
} from "./c601141-policy.js";

/** Endpoint partitioning prevents evidence on either side of a silence from
 * becoming an unsupported envelope or two nearby families becoming two votes. */
export function partitionSpeech141(input: {
  observations: C601141Observation[];
  source: C60114SourceIdentity;
  policy: C601141Policy;
  splitPoints?: readonly number[];
}): C601141Island[] {
  const rate = input.source.sampleRate;
  const maximum = Math.round(input.source.durationSeconds * rate);
  const points = new Set([0, maximum, ...(input.splitPoints ?? [])]);
  for (const observation of input.observations) {
    points.add(observation.nativeInterval.startSample);
    points.add(Math.min(maximum, observation.nativeInterval.endSample));
  }
  const sorted = [...points]
    .filter((p) => p >= 0 && p <= maximum)
    .sort((a, b) => a - b);
  const cells: C601141Island[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const startSample = required141(sorted[i]),
      endSample = required141(sorted[i + 1]);
    if (endSample <= startSample) continue;
    const supports = input.observations.filter(
      (o) =>
        o.nativeInterval.startSample <= startSample &&
        o.nativeInterval.endSample >= endSample,
    );
    if (!supports.length) continue;
    const valid = supports.filter(
      (o) => o.verifiedTimebase && o.speechPositive && !o.strongContradiction,
    );
    const detectors = unique141(
      valid
        .filter((o) => o.family === "SILERO" || o.family === "PYANNOTE")
        .map((o) => o.family),
    );
    const families = unique141(valid.map((o) => o.correlationGroup));
    const views = unique141(valid.flatMap((o) => (o.viewId ? [o.viewId] : [])));
    const contradiction = supports.some((o) => o.strongContradiction);
    const verified = valid.length > 0;
    const evidenceClass: C601141Island["evidenceClass"] = contradiction
      ? "STRONG_CONTRADICTION"
      : !verified
        ? "TIMEBASE_UNVERIFIED"
        : detectors.length >= 2 &&
            (endSample - startSample) / rate >=
              input.policy.fusion.minimumIndependentOverlapSeconds
          ? "MULTI_DETECTOR_CONFIRMED"
          : valid.some((o) => o.family === "LEGACY_FINGERPRINT")
            ? "LEGACY_FINGERPRINT_CONFIRMED"
            : valid.some((o) => o.family === "EXISTING_VERIFIED")
              ? "EXISTING_VERIFIED_SPEECH"
              : views.length >= 2
                ? "MULTI_VIEW_SPEECH_POSITIVE"
                : detectors.includes("PYANNOTE")
                  ? "PYANNOTE_ONLY_SPEECH_POSITIVE"
                  : valid.some((o) => o.profileId === "sensitive-v2")
                    ? "SINGLE_DETECTOR_HIGH_RECALL"
                    : "LOW_SUPPORT_VIEW_SPECIFIC";
    const core = {
      nativeInterval: { startSample, endSample },
      sourceInterval: { start: startSample / rate, end: endSample / rate },
      observationIds: unique141(supports.map((o) => o.observationId)),
      evidenceIds: unique141(supports.flatMap((o) => o.evidenceIds)),
      requestIds: unique141(supports.flatMap((o) => o.requestIds)),
      independentFamilies: families,
      independentFamilyCount: families.length,
      distinctPcmViewIds: views,
      evidenceClass,
      verifiedTimebase: verified,
      strongContradiction: contradiction,
      reliableLexical: valid.some((o) => o.reliableLexical),
    };
    cells.push(hashed141({ islandId: id141("speech-cell", core), ...core }));
  }
  const merged: C601141Island[] = [];
  const splitSet = new Set(input.splitPoints ?? []);
  for (const cell of cells) {
    const previous = merged.at(-1);
    const signature = (v: C601141Island) =>
      hash141([
        v.evidenceClass,
        v.independentFamilies,
        v.distinctPcmViewIds,
        v.verifiedTimebase,
        v.strongContradiction,
        v.reliableLexical,
      ]);
    if (
      previous?.nativeInterval.endSample === cell.nativeInterval.startSample &&
      !splitSet.has(cell.nativeInterval.startSample) &&
      signature(previous) === signature(cell) &&
      (cell.nativeInterval.endSample - previous.nativeInterval.startSample) /
        rate <=
        input.policy.maxTargetSeconds
    ) {
      const interval = {
        startSample: previous.nativeInterval.startSample,
        endSample: cell.nativeInterval.endSample,
      };
      const combined = {
        ...previous,
        nativeInterval: interval,
        sourceInterval: seconds141(interval, rate),
        observationIds: unique141([
          ...previous.observationIds,
          ...cell.observationIds,
        ]),
        evidenceIds: unique141([...previous.evidenceIds, ...cell.evidenceIds]),
        requestIds: unique141([...previous.requestIds, ...cell.requestIds]),
      };
      merged[merged.length - 1] = hashed141({
        ...combined,
        islandId: id141("speech-island", combined.nativeInterval),
      });
    } else merged.push(cell);
  }
  return merged.flatMap((island) => {
    const result: C601141Island[] = [];
    const limit = input.policy.maxTargetSeconds * rate;
    for (
      let start = island.nativeInterval.startSample;
      start < island.nativeInterval.endSample;
      start += limit
    ) {
      const interval = {
        startSample: start,
        endSample: Math.min(start + limit, island.nativeInterval.endSample),
      };
      // Keep short atomic pieces in the inventory; selection applies a minimum.
      result.push(
        hashed141({
          ...island,
          islandId: id141("speech-island", [
            interval,
            island.evidenceClass,
            island.observationIds,
          ]),
          nativeInterval: interval,
          sourceInterval: seconds141(interval, rate),
        }),
      );
    }
    return result;
  });
}
export function buildInventory141(input: {
  policy: C601141Policy;
  source: C60114SourceIdentity;
  viewsHash: string;
  fingerprint: C601141Fingerprint;
  sweeps: C601141Sweeps;
  previous: C60114SpeechIslands;
  cueIntervals: readonly { start: number; end: number }[];
  sceneBoundaries?: number[];
}) {
  [input.fingerprint, input.sweeps, input.previous].forEach(assertHash141);
  const rate = input.source.sampleRate;
  const observations: C601141Observation[] = [];
  for (const run of input.sweeps.runs)
    for (const interval of run.nativeIntervals) {
      if (run.status !== "SUCCESS") continue;
      observations.push({
        observationId: id141("detector-observation", [run.runId, interval]),
        nativeInterval: interval,
        family: run.runtime.detectorFamily,
        correlationGroup: run.runtime.detectorFamily,
        viewId: run.viewId,
        profileId: run.profileId,
        evidenceIds: [run.runId],
        requestIds: [run.runId],
        verifiedTimebase: true,
        speechPositive: true,
        strongContradiction: false,
        reliableLexical: false,
      });
    }
  for (const row of input.fingerprint.entries)
    if (row.nativeInterval && row.uniquenessPassed && row.speechPositive) {
      observations.push({
        observationId: id141("fingerprint-observation", row.evidenceId),
        nativeInterval: row.nativeInterval,
        family: "LEGACY_FINGERPRINT",
        correlationGroup: "LEGACY_WHISPER",
        viewId: row.searchViewId,
        profileId: null,
        evidenceIds: [row.evidenceId],
        requestIds: row.requestIds,
        verifiedTimebase: true,
        speechPositive: true,
        strongContradiction: false,
        reliableLexical: row.lexicalEvidenceEligible,
      });
    }
  for (const row of input.previous.globalIslands)
    if (row.localizationStatus === "VERIFIED" && row.speechPositive) {
      observations.push({
        observationId: id141("prior-observation", row.islandId),
        nativeInterval: native141(row.sourceInterval, rate),
        family: "EXISTING_VERIFIED",
        correlationGroup: "LEGACY_WHISPER",
        viewId: null,
        profileId: null,
        evidenceIds: row.evidenceIds.length ? row.evidenceIds : [row.islandId],
        requestIds: row.rootLineageIds,
        verifiedTimebase: true,
        speechPositive: row.speechPositive,
        strongContradiction: row.strongContradiction,
        reliableLexical: row.reliableLocalizedLexical,
      });
    }
  const splitPoints = [
    ...input.cueIntervals.flatMap((v) => [
      Math.round(v.start * rate),
      Math.round(v.end * rate),
    ]),
    ...(input.sceneBoundaries ?? []).map((v) => Math.round(v * rate)),
  ];
  const islands = partitionSpeech141({
    observations,
    source: input.source,
    policy: input.policy,
    splitPoints,
  });
  return c601141InventorySchema.parse(
    hashed141({
      ...header141(input.policy, input.source),
      artifactType: "machine-source-global-speech-inventory-v4",
      viewsHash: input.viewsHash,
      fingerprintHash: input.fingerprint.semanticHash,
      sweepsEvidenceHash: input.sweeps.evidenceSemanticHash,
      previousIslandsHash: input.previous.semanticHash,
      observations,
      islands,
      summary: {
        observationCount: observations.length,
        islandCount: islands.length,
        multiDetectorCount: islands.filter(
          (v) => v.evidenceClass === "MULTI_DETECTOR_CONFIRMED",
        ).length,
        nativeUnionSeconds: duration141(
          islands.map((v) => v.nativeInterval),
          rate,
        ),
        unresolvedCount: islands.filter((v) => !v.verifiedTimebase).length,
        parentEnvelopeAsSpeechCount: 0,
        correlationInflationCount: 0,
      },
    }),
  );
}
const strength: Record<C601141Island["evidenceClass"], number> = {
  MULTI_DETECTOR_CONFIRMED: 9,
  LEGACY_FINGERPRINT_CONFIRMED: 8,
  EXISTING_VERIFIED_SPEECH: 7,
  MULTI_VIEW_SPEECH_POSITIVE: 6,
  PYANNOTE_ONLY_SPEECH_POSITIVE: 5,
  SINGLE_DETECTOR_HIGH_RECALL: 3,
  DETECTOR_DISAGREEMENT: 2,
  LOW_SUPPORT_VIEW_SPECIFIC: 1,
  STRONG_CONTRADICTION: 0,
  TIMEBASE_UNVERIFIED: 0,
};
export function uncoveredSpeech141(input: {
  inventory: C601141Inventory;
  policy: C601141Policy;
  cues: readonly { start: number; end: number }[];
  previousTargets: readonly {
    sourceInterval: { start: number; end: number };
  }[];
  finalCueHash: string;
  previousTargetsHash: string;
}) {
  assertHash141(input.inventory);
  const source = input.inventory.sourceIdentity,
    rate = source.sampleRate;
  const cueMask = input.cues.map((v) => native141(v, rate));
  const targetMask = input.previousTargets.map((v) =>
    native141(v.sourceInterval, rate),
  );
  const candidates = input.inventory.islands.flatMap((island) => {
    const cueRemainder = subtract141(island.nativeInterval, cueMask);
    const targetRemainder = cueRemainder.flatMap((v) =>
      subtract141(v, targetMask),
    );
    return targetRemainder.map((interval) => {
      const core = {
        ...island,
        candidateId: id141("uncovered", [island.islandId, interval]),
        parentIslandId: island.islandId,
        nativeInterval: interval,
        sourceInterval: seconds141(interval, rate),
        uncoveredRatio:
          (interval.endSample - interval.startSample) /
          (island.nativeInterval.endSample - island.nativeInterval.startSample),
        partialCueOverlap:
          duration141(cueRemainder, rate) <
          (island.nativeInterval.endSample -
            island.nativeInterval.startSample) /
            rate,
        partialExistingTargetOverlap:
          duration141(targetRemainder, rate) < duration141(cueRemainder, rate),
        priority:
          strength[island.evidenceClass] * 100 +
          (island.reliableLexical ? 0 : 20) +
          Math.min(12, (interval.endSample - interval.startSample) / rate),
        diversityBin: Math.floor(
          interval.startSample /
            rate /
            input.policy.fusion.timeDiversityBinSeconds,
        ),
      };
      return hashed141(core);
    });
  });
  return c601141UncoveredSchema.parse(
    hashed141({
      ...header141(input.policy, source),
      artifactType: "machine-uncovered-speech-candidates-v1",
      inventoryHash: input.inventory.semanticHash,
      finalCueHash: input.finalCueHash,
      previousTargetsHash: input.previousTargetsHash,
      candidates,
      summary: {
        candidateCount: candidates.length,
        uncoveredSeconds: duration141(
          candidates.map((v) => v.nativeInterval),
          rate,
        ),
      },
    }),
  );
}
export function selectSafety141(
  uncovered: C601141Uncovered,
  policy: C601141Policy,
): C601141Safety {
  assertHash141(uncovered);
  const rate = uncovered.sourceIdentity.sampleRate;
  const candidates = [...uncovered.candidates].sort(
    (a, b) =>
      b.priority - a.priority ||
      a.nativeInterval.startSample - b.nativeInterval.startSample ||
      a.candidateId.localeCompare(b.candidateId),
  );
  const strong = new Set([
    "MULTI_DETECTOR_CONFIRMED",
    "LEGACY_FINGERPRINT_CONFIRMED",
    "EXISTING_VERIFIED_SPEECH",
  ]);
  const possible = new Set([
    "MULTI_VIEW_SPEECH_POSITIVE",
    "PYANNOTE_ONLY_SPEECH_POSITIVE",
  ]);
  const eligible = candidates.filter(
    (v) =>
      v.verifiedTimebase &&
      !v.strongContradiction &&
      (strong.has(v.evidenceClass) || possible.has(v.evidenceClass)) &&
      (v.nativeInterval.endSample - v.nativeInterval.startSample) / rate >=
        policy.fusion.minimumIslandSeconds,
  );
  // A deterministic first pass gives each fixed time bin an opportunity;
  // remaining capacity follows strength. No evaluation positions enter here.
  const bins = new Set<number>();
  const diverse = eligible.filter((v) => {
    if (bins.has(v.diversityBin)) return false;
    bins.add(v.diversityBin);
    return true;
  });
  const ordered = [...diverse, ...eligible.filter((v) => !diverse.includes(v))];
  const targets: C601141SafetyTarget[] = [];
  for (const candidate of ordered) {
    if (
      targets.length >= policy.maxSafetyTargets ||
      duration141(
        [...targets.map((v) => v.nativeInterval), candidate.nativeInterval],
        rate,
      ) > policy.maxSafetyUnionSeconds
    )
      continue;
    targets.push(
      hashed141({
        ...candidate,
        targetId: id141("safety-target", candidate.candidateId),
        targetType: strong.has(candidate.evidenceClass)
          ? "SPEECH_INVENTORY_STRONG_UNCOVERED"
          : "SPEECH_INVENTORY_POSSIBLE_UNCOVERED",
        requiredLevel: "RECOMMENDED",
        canonicalInsertAllowed: false,
      }),
    );
  }
  const selected = new Set(targets.map((v) => v.candidateId)),
    valid = new Set(eligible.map((v) => v.candidateId));
  const audit = candidates.map((v) => ({
    candidateId: v.candidateId,
    status: selected.has(v.candidateId)
      ? ("SELECTED" as const)
      : valid.has(v.candidateId)
        ? ("BUDGET_OVERFLOW" as const)
        : ("LOW_SUPPORT_AUDIT_ONLY" as const),
    reason: selected.has(v.candidateId)
      ? "MACHINE_ONLY_STRENGTH_AND_TIME_DIVERSITY"
      : valid.has(v.candidateId)
        ? "FROZEN_COUNT_OR_UNIQUE_SECONDS_BUDGET"
        : "NO_INDEPENDENT_OR_MULTI_VIEW_SPEECH_SUPPORT",
  }));
  return c601141SafetySchema.parse(
    hashed141({
      ...header141(policy, uncovered.sourceIdentity),
      artifactType: "machine-missing-safety-reserve-targets-v1",
      uncoveredHash: uncovered.semanticHash,
      targets,
      audit,
      summary: {
        targetCount: targets.length,
        strongCount: targets.filter(
          (v) => v.targetType === "SPEECH_INVENTORY_STRONG_UNCOVERED",
        ).length,
        possibleCount: targets.filter(
          (v) => v.targetType === "SPEECH_INVENTORY_POSSIBLE_UNCOVERED",
        ).length,
        targetUnionSeconds: duration141(
          targets.map((v) => v.nativeInterval),
          rate,
        ),
        overflowCount: audit.filter((v) => v.status === "BUDGET_OVERFLOW")
          .length,
        auditOnlyCount: audit.filter(
          (v) => v.status === "LOW_SUPPORT_AUDIT_ONLY",
        ).length,
        catchAllTargetCount: 0,
        requiredLevelPromotionCount: 0,
      },
    }),
  );
}
export function selectAsr141(
  safety: C601141Safety,
  policy: C601141Policy,
  frozenAt: string,
) {
  assertHash141(safety);
  const targets = safety.targets.slice(0, policy.maxAsrTargets);
  const contextEligibleTargetIds = targets
    .slice(0, policy.maxContextTargets)
    .map((v) => v.targetId);
  return c601141AsrSelectionSchema.parse(
    hashed141({
      ...header141(policy, safety.sourceIdentity),
      artifactType: "machine-c6-0-1-14-1-asr-probe-selection",
      safetyHash: safety.semanticHash,
      targets,
      contextEligibleTargetIds,
      maximumAuthorizedRequests:
        2 * (targets.length + contextEligibleTargetIds.length),
      selectionFrozenAt: frozenAt,
      targetBackfillAllowed: false,
      goldBlind: true,
    }),
  );
}
