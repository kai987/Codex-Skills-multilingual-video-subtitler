import { createHash } from "node:crypto";

import {
  c6013PolicyVersion,
  machineCandidateAssociationLedgerSchema,
  machineCanonicalAssemblySchema,
  machineCanonicalEventsSchema,
  machineCanonicalNonDegradationLedgerSchema,
  machineOverlapRootCauseSchema,
  machineStageQualityTraceSchema,
  machineSupportedTextRetentionSchema,
  machineTimelineTransformChainSchema,
  type AsrRequestTimelineContract,
  type AtomicHypothesisClustersArtifact,
  type CandidateAssociationMode,
  type CanonicalAssemblyMode,
  type CueCandidateEvidenceArtifact,
  type MachineAcousticEventFamilies,
  type MachineCanonicalEvents,
  type MachineGlobalTokenTimeline,
  type SubtitleCue,
  type TimelineTransformChainMode,
  type TopScoreResolutionArtifact,
} from "@mvl/shared";

const INTERVAL_TOLERANCE_SECONDS = 0.05;
const LONG_VARIANT_MINIMUM_ADDED_CHARACTERS = 2;
const LONG_VARIANT_MAXIMUM_SCORE_DEFICIT = 0.01;
const LONG_VARIANT_MAXIMUM_BOUNDARY_DELTA_SECONDS = 0.5;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[♪\s、。，．,.!?！？…]/gu, "")
    .toLocaleLowerCase("ja");
}

function sourceCueId(candidateId: string): string {
  return candidateId.replace(/::atom-\d+$/u, "");
}

function intervalOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function intervalCoverage(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return (
    intervalOverlap(left, right) /
    Math.max(0.001, Math.min(left.end - left.start, right.end - right.start))
  );
}

function unionCoverage(cues: readonly SubtitleCue[]): number {
  const intervals = cues
    .map((cue) => ({ start: cue.start, end: cue.end }))
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const candidate of intervals) {
    if (current === null) {
      current = { ...candidate };
      continue;
    }
    if (candidate.start <= current.end) {
      current.end = Math.max(current.end, candidate.end);
      continue;
    }
    total += current.end - current.start;
    current = { ...candidate };
  }
  return total + (current === null ? 0 : current.end - current.start);
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = new Array<number>(b.length + 1).fill(0);
  for (const character of a) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let index = 1; index <= b.length; index += 1) {
      current[index] =
        character === b[index - 1]
          ? (previous[index - 1] ?? 0) + 1
          : Math.max(previous[index] ?? 0, current[index - 1] ?? 0);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? 0;
}

function speechRegions(cues: readonly SubtitleCue[]) {
  return cues
    .flatMap((cue) => {
      const explicit = cue.timingEvidence?.speechIntervals ?? [];
      if (explicit.length > 0) return explicit;
      const start = cue.timingEvidence?.speechStart;
      const end = cue.timingEvidence?.speechEnd;
      return start !== null &&
        start !== undefined &&
        end !== null &&
        end !== undefined
        ? [{ start, end }]
        : [];
    })
    .filter((entry) => entry.end > entry.start)
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
}

function evidenceStrength(
  candidate: CueCandidateEvidenceArtifact["candidates"][number] | undefined,
): number {
  if (candidate === undefined) return 0;
  return Math.max(
    0,
    Math.min(
      1,
      (candidate.selectionScore ?? candidate.totalScore) * 0.55 +
        candidate.acousticSupport * 0.2 +
        candidate.speechCoverage * 0.15 +
        Math.min(1, (candidate.independentSupportCount ?? 0) / 2) * 0.1,
    ),
  );
}

function strongSupport(
  candidate: CueCandidateEvidenceArtifact["candidates"][number] | undefined,
  hasTrustedToken: boolean,
): boolean {
  return (
    hasTrustedToken ||
    (candidate?.independentSupportCount ?? 0) >= 2 ||
    ((candidate?.acousticSupport ?? 0) >= 0.75 &&
      (candidate?.speechCoverage ?? 0) >= 0.5)
  );
}

function eventId(clusterId: string): string {
  return clusterId.replace("atomic-hypothesis-cluster", "canonical-event");
}

export interface CandidateAssociationAssemblyResult {
  cues: SubtitleCue[];
  candidateAssociationLedger: ReturnType<
    typeof machineCandidateAssociationLedgerSchema.parse
  >;
  canonicalEvents: ReturnType<typeof machineCanonicalEventsSchema.parse>;
  canonicalAssembly: ReturnType<typeof machineCanonicalAssemblySchema.parse>;
  supportedTextRetention: ReturnType<
    typeof machineSupportedTextRetentionSchema.parse
  >;
  timelineTransformChain: ReturnType<
    typeof machineTimelineTransformChainSchema.parse
  >;
  canonicalNonDegradation: ReturnType<
    typeof machineCanonicalNonDegradationLedgerSchema.parse
  >;
  stageQualityTrace: ReturnType<typeof machineStageQualityTraceSchema.parse>;
  overlapRootCause: ReturnType<typeof machineOverlapRootCauseSchema.parse>;
}

export function runCandidateAssociationAssembly(input: {
  atoms: readonly SubtitleCue[];
  atomicClusters: AtomicHypothesisClustersArtifact;
  candidateEvidence: CueCandidateEvidenceArtifact;
  topScoreResolution: TopScoreResolutionArtifact;
  winnerCues: readonly SubtitleCue[];
  acousticEventFamilies: MachineAcousticEventFamilies;
  globalTokenTimeline: MachineGlobalTokenTimeline;
  requestTimelineContract: AsrRequestTimelineContract;
  candidateAssociation: CandidateAssociationMode;
  canonicalAssembly: CanonicalAssemblyMode;
  timelineTransformChain: TimelineTransformChainMode;
  generatedAt?: string;
}): CandidateAssociationAssemblyResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const atomsById = new Map(input.atoms.map((cue) => [cue.id, cue]));
  const evidenceById = new Map(
    input.candidateEvidence.candidates.map((candidate) => [
      candidate.cueId,
      candidate,
    ]),
  );
  const resolutionByCluster = new Map(
    input.topScoreResolution.resolutions.map((resolution) => [
      resolution.clusterId,
      resolution,
    ]),
  );
  const familyIdsByCandidate = new Map<string, Set<string>>();
  for (const family of input.acousticEventFamilies.families) {
    for (const candidateId of family.candidateIds) {
      const ids = familyIdsByCandidate.get(candidateId) ?? new Set<string>();
      ids.add(family.familyId);
      familyIdsByCandidate.set(candidateId, ids);
    }
  }
  const trustedTokenIntervalsByCue = new Map<
    string,
    { start: number; end: number }[]
  >();
  for (const token of input.globalTokenTimeline.tokens) {
    if (!token.trusted || token.globalInterval === null) continue;
    const values = trustedTokenIntervalsByCue.get(token.cueId) ?? [];
    values.push(token.globalInterval);
    trustedTokenIntervalsByCue.set(token.cueId, values);
  }
  const clusterByCandidate = new Map<string, string>();
  for (const cluster of input.atomicClusters.clusters) {
    for (const candidateId of cluster.candidateCueIds) {
      clusterByCandidate.set(candidateId, cluster.id);
    }
  }

  const associationRecords = input.atoms.map((cue) => {
    const clusterId = clusterByCandidate.get(cue.id) ?? null;
    const cluster = input.atomicClusters.clusters.find(
      (candidate) => candidate.id === clusterId,
    );
    const resolution =
      clusterId === null ? undefined : resolutionByCluster.get(clusterId);
    const evidence = evidenceById.get(cue.id);
    const selected = resolution?.winnerCueId === cue.id;
    const winner =
      resolution?.winnerCueId === null || resolution?.winnerCueId === undefined
        ? undefined
        : atomsById.get(resolution.winnerCueId);
    const normalized = normalize(cue.text);
    const winnerNormalized = winner === undefined ? "" : normalize(winner.text);
    const hardReasons = (evidence?.hardBlockReasons ?? []).map((reason) =>
      reason.includes("HALLUCINATION")
        ? ("HALLUCINATION_RISK" as const)
        : ("WEAK_ACOUSTIC_SUPPORT" as const),
    );
    let disposition:
      | "ASSIGNED"
      | "QUARANTINED"
      | "SUPERSEDED"
      | "DUPLICATE"
      | "AMBIGUOUS"
      | "REJECTED";
    let reasons: (
      | "NO_COMPATIBLE_CLUSTER"
      | "PREFIX_SHADOWED"
      | "SUFFIX_SHADOWED"
      | "DUPLICATE_EVENT"
      | "NONCOMPETITIVE_VARIANT"
      | "MULTIPLE_VALID_CLUSTERS"
      | "WEAK_ACOUSTIC_SUPPORT"
      | "HALLUCINATION_RISK"
    )[] = [];
    if (cluster === undefined) {
      disposition = "REJECTED";
      reasons = ["NO_COMPATIBLE_CLUSTER"];
    } else if (selected) {
      disposition = "ASSIGNED";
    } else if (hardReasons.length > 0) {
      disposition = "REJECTED";
      reasons = hardReasons;
    } else if (normalized !== "" && normalized === winnerNormalized) {
      disposition = "DUPLICATE";
      reasons = ["DUPLICATE_EVENT"];
    } else if (
      normalized !== "" &&
      winnerNormalized !== "" &&
      winnerNormalized.startsWith(normalized)
    ) {
      disposition = "SUPERSEDED";
      reasons = ["PREFIX_SHADOWED"];
    } else if (
      normalized !== "" &&
      winnerNormalized !== "" &&
      winnerNormalized.endsWith(normalized)
    ) {
      disposition = "SUPERSEDED";
      reasons = ["SUFFIX_SHADOWED"];
    } else if (resolution?.reviewRecommended === true) {
      disposition = "AMBIGUOUS";
      reasons = ["MULTIPLE_VALID_CLUSTERS"];
    } else {
      disposition = "QUARANTINED";
      reasons = ["NONCOMPETITIVE_VARIANT"];
    }
    const medoid =
      cluster === undefined ? undefined : atomsById.get(cluster.medoidCueId);
    const temporalCompatibility =
      medoid === undefined ? 0 : intervalCoverage(cue, medoid);
    const familyIds = [
      ...(familyIdsByCandidate.get(sourceCueId(cue.id)) ?? []),
      ...(familyIdsByCandidate.get(cue.id) ?? []),
    ].filter((value, index, values) => values.indexOf(value) === index);
    const hasTrustedToken =
      (trustedTokenIntervalsByCue.get(sourceCueId(cue.id))?.length ?? 0) > 0;
    const winnerSpeaker = winner?.speaker;
    return {
      candidateId: cue.id,
      sourceCueId: sourceCueId(cue.id),
      interval: { start: cue.start, end: cue.end },
      normalizedTextHash: hash(normalized),
      familyIds,
      compatibleClusterIds: cluster === undefined ? [] : [cluster.id],
      assignedClusterId: cluster?.id ?? null,
      assignedEventId: cluster === undefined ? null : eventId(cluster.id),
      selectedAsTextVariant: selected,
      disposition,
      primaryReason: reasons[0] ?? null,
      reasons,
      hardIncompatibilities: hardReasons,
      score: {
        temporalCompatibility,
        textCompatibility:
          winner === undefined
            ? 0
            : normalize(winner.text) === normalized
              ? 1
              : 0.5,
        acousticCompatibility: evidence?.acousticSupport ?? 0,
        speakerCompatibility:
          winnerSpeaker === undefined ||
          winnerSpeaker === null ||
          cue.speaker === null
            ? 0.5
            : winnerSpeaker === cue.speaker
              ? 1
              : 0,
        timelineTrust: hasTrustedToken ? 1 : 0,
        evidenceStrength: evidenceStrength(evidence),
        tieBreakScore: evidence?.selectionScore ?? evidence?.totalScore ?? 0,
      },
      competingAssignments:
        cluster === undefined
          ? []
          : [
              {
                clusterId: cluster.id,
                score: Math.max(
                  0,
                  Math.min(
                    1,
                    temporalCompatibility * 0.6 +
                      evidenceStrength(evidence) * 0.4,
                  ),
                ),
                hardCompatible: hardReasons.length === 0,
                reasons: hardReasons,
              },
            ],
      lineageIds: [cue.id, sourceCueId(cue.id)],
    };
  });
  const associationSemanticHash = hash(associationRecords);
  const candidateAssociationLedger =
    machineCandidateAssociationLedgerSchema.parse({
      schemaVersion: "1.0.0",
      policyVersion: c6013PolicyVersion,
      generatedAt,
      artifactType: "machine-candidate-association-ledger",
      mode: input.candidateAssociation,
      sourceCandidateSemanticHash: hash(input.atoms),
      atomicClusterSemanticHash: hash(input.atomicClusters.clusters),
      familySemanticHash: input.acousticEventFamilies.semanticHash,
      records: associationRecords,
      summary: {
        sourceCandidateCount: input.atoms.length,
        atomicClusterCount: input.atomicClusters.clusters.length,
        ledgerRecordCount: associationRecords.length,
        assignedCount: associationRecords.filter(
          (record) => record.disposition === "ASSIGNED",
        ).length,
        quarantinedCount: associationRecords.filter(
          (record) => record.disposition === "QUARANTINED",
        ).length,
        supersededCount: associationRecords.filter(
          (record) => record.disposition === "SUPERSEDED",
        ).length,
        duplicateCount: associationRecords.filter(
          (record) => record.disposition === "DUPLICATE",
        ).length,
        ambiguousCount: associationRecords.filter(
          (record) => record.disposition === "AMBIGUOUS",
        ).length,
        rejectedCount: associationRecords.filter(
          (record) => record.disposition === "REJECTED",
        ).length,
        groupedCandidateCount: Math.max(
          0,
          input.atoms.length - input.atomicClusters.clusters.length,
        ),
        unaccountedCandidateCount: 0,
        unknownReasonCount: 0,
        multiAssignedCandidateCount: 0,
        candidateConservationPassed: true,
      },
      semanticHash: associationSemanticHash,
    });

  const canonicalEventValues = input.atomicClusters.clusters.map((cluster) => {
    const members = cluster.candidateCueIds
      .map((candidateId) => atomsById.get(candidateId))
      .filter((cue): cue is SubtitleCue => cue !== undefined);
    const representative = atomsById.get(cluster.medoidCueId) ?? members[0];
    if (representative === undefined) {
      throw new Error(`Atomic cluster ${cluster.id} has no candidate cue`);
    }
    const families = [
      ...new Set(
        cluster.candidateCueIds.flatMap((candidateId) => [
          ...(familyIdsByCandidate.get(candidateId) ?? []),
          ...(familyIdsByCandidate.get(sourceCueId(candidateId)) ?? []),
        ]),
      ),
    ];
    const speakers = [
      ...new Set(
        members.flatMap((cue) => (cue.speaker === null ? [] : [cue.speaker])),
      ),
    ];
    const regions = speechRegions(members);
    const trustedIntervals = cluster.candidateCueIds.flatMap(
      (candidateId) =>
        trustedTokenIntervalsByCue.get(sourceCueId(candidateId)) ?? [],
    );
    const trustedTokenSpan =
      trustedIntervals.length === 0
        ? null
        : {
            start: Math.min(...trustedIntervals.map((entry) => entry.start)),
            end: Math.max(...trustedIntervals.map((entry) => entry.end)),
          };
    const resolution = resolutionByCluster.get(cluster.id);
    const eventType: MachineCanonicalEvents["events"][number]["eventType"] =
      speakers.length > 1
        ? ("MULTI_SPEAKER_OVERLAP" as const)
        : members.some(
              (cue) =>
                cue.style === "music" ||
                /crowd|chant/iu.test(cue.provenance?.sceneLabel ?? ""),
            )
          ? ("CHANT_OR_CROWD" as const)
          : resolution?.winnerCueId === null
            ? ("AMBIGUOUS_EVENT" as const)
            : ("SINGLE_UTTERANCE" as const);
    const value = {
      eventId: eventId(cluster.id),
      acousticInterval: {
        start: representative.start,
        end: representative.end,
      },
      speechRegions: regions,
      familyIds: families,
      candidateIds: cluster.candidateCueIds,
      speakerHypotheses: speakers,
      trustedTokenSpan,
      segmentSpan: {
        start: Math.min(...members.map((cue) => cue.start)),
        end: Math.max(...members.map((cue) => cue.end)),
      },
      vadSpan:
        regions.length === 0
          ? null
          : {
              start: Math.min(...regions.map((entry) => entry.start)),
              end: Math.max(...regions.map((entry) => entry.end)),
            },
      eventType,
      ambiguity: {
        status:
          resolution?.winnerCueId === null
            ? ("quarantined" as const)
            : resolution?.reviewRecommended === true
              ? ("review" as const)
              : ("resolved" as const),
        reasons:
          resolution?.winnerCueId === null
            ? (["WEAK_ACOUSTIC_SUPPORT"] as const)
            : resolution?.reviewRecommended === true
              ? (["MULTIPLE_VALID_CLUSTERS"] as const)
              : [],
        validCandidateCount: cluster.candidateCueIds.filter(
          (candidateId) =>
            evidenceById.get(candidateId)?.selectionEligible !== false,
        ).length,
      },
      representativeCandidateId: representative.id,
    };
    return { ...value, semanticHash: hash(value) };
  });
  const canonicalEvents = machineCanonicalEventsSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6013PolicyVersion,
    generatedAt,
    artifactType: "machine-canonical-events",
    mode: input.candidateAssociation,
    associationLedgerSemanticHash: candidateAssociationLedger.semanticHash,
    events: canonicalEventValues,
    summary: {
      eventCount: canonicalEventValues.length,
      singleUtteranceCount: canonicalEventValues.filter(
        (event) => event.eventType === "SINGLE_UTTERANCE",
      ).length,
      rapidTurnCount: 0,
      multiSpeakerOverlapCount: canonicalEventValues.filter(
        (event) => event.eventType === "MULTI_SPEAKER_OVERLAP",
      ).length,
      backgroundForegroundCount: 0,
      chantOrCrowdCount: canonicalEventValues.filter(
        (event) => event.eventType === "CHANT_OR_CROWD",
      ).length,
      continuationCandidateCount: 0,
      ambiguousEventCount: canonicalEventValues.filter(
        (event) => event.eventType === "AMBIGUOUS_EVENT",
      ).length,
      eventWithoutCandidateCount: 0,
    },
    semanticHash: hash(canonicalEventValues),
  });

  const winnerById = new Map(input.winnerCues.map((cue) => [cue.id, cue]));
  const assemblyOperations: {
    operationId: string;
    eventId: string;
    inputCandidateIds: string[];
    selectedCandidateId: string | null;
    previousWinnerCandidateId: string | null;
    outputCueId: string | null;
    operation:
      | "PRESERVE_WINNER"
      | "SELECT_LONG_SUPPORTED_VARIANT"
      | "QUARANTINE_EVENT"
      | "REJECT_SYNTHETIC_JOIN";
    textSource: "single-real-candidate" | "none";
    tokenProvenanceComplete: boolean;
    syntheticTextJoin: false;
    beforeInterval: { start: number; end: number } | null;
    afterInterval: { start: number; end: number } | null;
    reasons: string[];
  }[] = [];
  const assembledCues: SubtitleCue[] = [];
  for (const event of canonicalEvents.events) {
    const clusterId = event.eventId.replace(
      "canonical-event",
      "atomic-hypothesis-cluster",
    );
    const resolution = resolutionByCluster.get(clusterId);
    const currentWinner =
      resolution?.winnerCueId === null || resolution?.winnerCueId === undefined
        ? undefined
        : (winnerById.get(resolution.winnerCueId) ??
          atomsById.get(resolution.winnerCueId));
    if (currentWinner === undefined) {
      assemblyOperations.push({
        operationId: `assembly:${event.eventId}`,
        eventId: event.eventId,
        inputCandidateIds: event.candidateIds,
        selectedCandidateId: null,
        previousWinnerCandidateId: null,
        outputCueId: null,
        operation: "QUARANTINE_EVENT",
        textSource: "none",
        tokenProvenanceComplete: false,
        syntheticTextJoin: false,
        beforeInterval: null,
        afterInterval: null,
        reasons: ["no-selection-eligible-real-candidate"],
      });
      continue;
    }
    const winnerEvidence = evidenceById.get(currentWinner.id);
    const winnerText = normalize(currentWinner.text);
    const challengers = event.candidateIds
      .map((candidateId) => atomsById.get(candidateId))
      .filter((cue): cue is SubtitleCue => cue !== undefined)
      .filter((cue) => {
        const candidateText = normalize(cue.text);
        if (
          candidateText.length <
          winnerText.length + LONG_VARIANT_MINIMUM_ADDED_CHARACTERS
        ) {
          return false;
        }
        if (!candidateText.includes(winnerText)) return false;
        const candidateEvidence = evidenceById.get(cue.id);
        if (candidateEvidence?.selectionEligible === false) return false;
        const score =
          candidateEvidence?.selectionScore ??
          candidateEvidence?.totalScore ??
          0;
        const winnerScore =
          winnerEvidence?.selectionScore ?? winnerEvidence?.totalScore ?? 0;
        const trusted =
          (trustedTokenIntervalsByCue.get(sourceCueId(cue.id))?.length ?? 0) >
          0;
        return (
          score + LONG_VARIANT_MAXIMUM_SCORE_DEFICIT >= winnerScore &&
          strongSupport(candidateEvidence, trusted) &&
          Math.abs(cue.start - currentWinner.start) <=
            LONG_VARIANT_MAXIMUM_BOUNDARY_DELTA_SECONDS &&
          Math.abs(cue.end - currentWinner.end) <=
            LONG_VARIANT_MAXIMUM_BOUNDARY_DELTA_SECONDS
        );
      })
      .toSorted((left, right) => {
        const leftText = normalize(left.text);
        const rightText = normalize(right.text);
        const leftEvidence = evidenceById.get(left.id);
        const rightEvidence = evidenceById.get(right.id);
        return (
          rightText.length - leftText.length ||
          evidenceStrength(rightEvidence) - evidenceStrength(leftEvidence) ||
          left.id.localeCompare(right.id)
        );
      });
    const proposed = challengers[0];
    const selected =
      input.canonicalAssembly === "enforce" && proposed !== undefined
        ? proposed
        : currentWinner;
    assembledCues.push(selected);
    assemblyOperations.push({
      operationId: `assembly:${event.eventId}`,
      eventId: event.eventId,
      inputCandidateIds: event.candidateIds,
      selectedCandidateId: selected.id,
      previousWinnerCandidateId: currentWinner.id,
      outputCueId: selected.id,
      operation:
        selected.id === currentWinner.id
          ? "PRESERVE_WINNER"
          : "SELECT_LONG_SUPPORTED_VARIANT",
      textSource: "single-real-candidate",
      tokenProvenanceComplete:
        (trustedTokenIntervalsByCue.get(sourceCueId(selected.id))?.length ??
          0) > 0,
      syntheticTextJoin: false,
      beforeInterval: { start: currentWinner.start, end: currentWinner.end },
      afterInterval: { start: selected.start, end: selected.end },
      reasons:
        selected.id === currentWinner.id
          ? [
              proposed === undefined
                ? "existing-top-score-winner-preserved"
                : "long-supported-variant-observed-without-enforcement",
            ]
          : [
              "single-real-long-variant-selected",
              "winner-text-contained",
              "machine-evidence-not-weaker-than-bounded-deficit",
              "boundary-delta-within-non-degradation-limit",
            ],
    });
  }
  const sortedAssembled = assembledCues.toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
  const canonicalAssembly = machineCanonicalAssemblySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6013PolicyVersion,
    generatedAt,
    artifactType: "machine-canonical-assembly",
    mode: input.canonicalAssembly,
    eventSemanticHash: canonicalEvents.semanticHash,
    operations: assemblyOperations,
    outputCues: assemblyOperations.flatMap((operation) => {
      if (
        operation.outputCueId === null ||
        operation.selectedCandidateId === null
      )
        return [];
      const cue = atomsById.get(operation.selectedCandidateId);
      return cue === undefined
        ? []
        : [
            {
              cueId: operation.outputCueId,
              eventId: operation.eventId,
              sourceCandidateId: operation.selectedCandidateId,
              interval: { start: cue.start, end: cue.end },
              textHash: hash(cue.text),
            },
          ];
    }),
    summary: {
      eventCount: canonicalEvents.events.length,
      outputCueCount: sortedAssembled.length,
      preservedWinnerCount: assemblyOperations.filter(
        (operation) => operation.operation === "PRESERVE_WINNER",
      ).length,
      longVariantSelectionCount: assemblyOperations.filter(
        (operation) => operation.operation === "SELECT_LONG_SUPPORTED_VARIANT",
      ).length,
      quarantinedEventCount: assemblyOperations.filter(
        (operation) => operation.operation === "QUARANTINE_EVENT",
      ).length,
      syntheticJoinCount: 0,
      textMutationCount: assemblyOperations.filter(
        (operation) =>
          operation.selectedCandidateId !== operation.previousWinnerCandidateId,
      ).length,
      timingMutationCount: assemblyOperations.filter(
        (operation) =>
          operation.beforeInterval !== null &&
          operation.afterInterval !== null &&
          (operation.beforeInterval.start !== operation.afterInterval.start ||
            operation.beforeInterval.end !== operation.afterInterval.end),
      ).length,
    },
    inputCueSemanticHash: hash(input.winnerCues),
    outputCueSemanticHash: hash(sortedAssembled),
    semanticHash: hash({
      operations: assemblyOperations,
      cues: sortedAssembled,
    }),
  });

  const retentionRecords = canonicalEvents.events.flatMap((event) => {
    const operation = assemblyOperations.find(
      (candidate) => candidate.eventId === event.eventId,
    );
    if (
      operation?.selectedCandidateId === null ||
      operation?.selectedCandidateId === undefined ||
      operation.previousWinnerCandidateId === null
    ) {
      return [];
    }
    const source = atomsById.get(operation.previousWinnerCandidateId);
    const output = atomsById.get(operation.selectedCandidateId);
    if (source === undefined || output === undefined) return [];
    const sourceText = normalize(source.text);
    const outputText = normalize(output.text);
    const retained = longestCommonSubsequenceLength(sourceText, outputText);
    const candidateEvidence = evidenceById.get(source.id);
    const trusted =
      (trustedTokenIntervalsByCue.get(sourceCueId(source.id))?.length ?? 0) > 0;
    const isStrong = strongSupport(candidateEvidence, trusted);
    const ratio = sourceText.length === 0 ? 1 : retained / sourceText.length;
    return [
      {
        eventId: event.eventId,
        sourceCandidateId: source.id,
        outputCueId: output.id,
        sourceNormalizedLength: Array.from(sourceText).length,
        retainedNormalizedLength: retained,
        retentionRatio: ratio,
        strongSupport: isStrong,
        prefixShadowPrevented:
          outputText.length > sourceText.length &&
          outputText.includes(sourceText),
        unsupportedDeletion: isStrong && ratio < 1,
        reasons: [
          isStrong ? "machine-strong-support" : "ordinary-support",
          ratio === 1
            ? "source-text-fully-retained"
            : "source-text-not-fully-retained",
        ],
      },
    ];
  });
  if (retentionRecords.some((record) => record.unsupportedDeletion)) {
    throw new Error(
      "Canonical assembly attempted an unsupported strong-text deletion",
    );
  }
  const strongRetention = retentionRecords.filter(
    (record) => record.strongSupport,
  );
  const supportedTextRetention = machineSupportedTextRetentionSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6013PolicyVersion,
    generatedAt,
    artifactType: "machine-supported-text-retention",
    mode: input.canonicalAssembly,
    records: retentionRecords,
    summary: {
      evaluatedEventCount: retentionRecords.length,
      strongSupportedCandidateCount: strongRetention.length,
      fullyRetainedCount: retentionRecords.filter(
        (record) => record.retentionRatio === 1,
      ).length,
      prefixShadowPreventedCount: retentionRecords.filter(
        (record) => record.prefixShadowPrevented,
      ).length,
      unsupportedStrongTextDeletionCount: 0,
      minimumStrongTextRetentionRatio:
        strongRetention.length === 0
          ? 1
          : Math.min(...strongRetention.map((record) => record.retentionRatio)),
    },
    semanticHash: hash(retentionRecords),
  });

  const requestAliases = new Map<string, string>();
  for (const request of input.requestTimelineContract.requests) {
    requestAliases.set(request.requestId, request.requestId);
    for (const alias of request.requestAliases)
      requestAliases.set(alias, request.requestId);
  }
  const timelineChains = input.requestTimelineContract.requests.map(
    (request) => {
      const tokens = input.globalTokenTimeline.tokens.filter(
        (token) => requestAliases.get(token.requestId) === request.requestId,
      );
      const verified =
        input.timelineTransformChain !== "off" &&
        request.contractStatus === "verified" &&
        request.offsetVerified &&
        !request.vadEnabled &&
        request.exactGlobalOffset !== null;
      const requestMappedTokenCount = tokens.filter(
        (token) =>
          token.globalInterval !== null ||
          (verified &&
            token.localInterval !== null &&
            token.failureReason === "segment-containment-failure"),
      ).length;
      const chain = {
        requestId: request.requestId,
        parentRequestId: request.parentRequestId,
        requestedInterval: request.requestedInterval,
        extractedInterval: request.extractedInterval,
        vadEnabled: request.vadEnabled,
        transforms: [
          {
            transformId: `transform:${request.requestId}:clip-to-decoder`,
            from: "clip-local" as const,
            to: "decoder-local" as const,
            scale: 1,
            offsetSeconds: 0,
            verified: !request.vadEnabled,
            evidence: request.vadEnabled
              ? ["vad-remapping-not-persisted"]
              : ["decoder-output-origin-zero", "no-vad-coordinate-preserved"],
          },
          {
            transformId: `transform:${request.requestId}:decoder-to-global`,
            from: "decoder-local" as const,
            to: "global-media" as const,
            scale: 1,
            offsetSeconds: request.exactGlobalOffset ?? 0,
            verified,
            evidence: verified
              ? ["request-contract-offset-verified", request.offsetSource]
              : [
                  request.vadEnabled
                    ? "vad-time-base-quarantined"
                    : "request-global-offset-unavailable",
                ],
          },
        ],
        composedScale: 1,
        composedOffsetSeconds: verified ? request.exactGlobalOffset : null,
        status: verified
          ? ("VERIFIED" as const)
          : request.vadEnabled || request.contractStatus === "quarantined"
            ? ("QUARANTINED" as const)
            : ("UNAVAILABLE" as const),
        failureReason: verified
          ? null
          : request.vadEnabled
            ? ("AMBIGUOUS_TIME_BASE" as const)
            : ("MISSING_GLOBAL_TIMELINE" as const),
        tokenCount: tokens.length,
        requestMappedTokenCount,
        associationPendingTokenCount: Math.max(
          0,
          requestMappedTokenCount -
            tokens.filter((token) => token.trusted).length,
        ),
        rejectedTokenCount: tokens.length - requestMappedTokenCount,
      };
      return { ...chain, semanticHash: hash(chain) };
    },
  );
  const timelineTransformChain = machineTimelineTransformChainSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6013PolicyVersion,
    generatedAt,
    artifactType: "machine-timeline-transform-chain",
    mode: input.timelineTransformChain,
    requestContractSemanticHash: input.requestTimelineContract.semanticHash,
    chains: timelineChains,
    summary: {
      requestCount: timelineChains.length,
      verifiedRequestCount: timelineChains.filter(
        (chain) => chain.status === "VERIFIED",
      ).length,
      quarantinedRequestCount: timelineChains.filter(
        (chain) => chain.status === "QUARANTINED",
      ).length,
      unavailableRequestCount: timelineChains.filter(
        (chain) => chain.status === "UNAVAILABLE",
      ).length,
      tokenCount: timelineChains.reduce(
        (sum, chain) => sum + chain.tokenCount,
        0,
      ),
      requestMappedTokenCount: timelineChains.reduce(
        (sum, chain) => sum + chain.requestMappedTokenCount,
        0,
      ),
      associationPendingTokenCount: timelineChains.reduce(
        (sum, chain) => sum + chain.associationPendingTokenCount,
        0,
      ),
      rejectedTokenCount: timelineChains.reduce(
        (sum, chain) => sum + chain.rejectedTokenCount,
        0,
      ),
      unverifiedOffsetAppliedCount: 0,
    },
    semanticHash: hash(timelineChains),
  });

  const nonDegradationRecords = assemblyOperations.map((operation) => {
    const mutation =
      operation.selectedCandidateId !== operation.previousWinnerCandidateId;
    const retention = retentionRecords.find(
      (record) => record.eventId === operation.eventId,
    );
    const before = operation.beforeInterval;
    const after = operation.afterInterval;
    const timeExpansion =
      before !== null &&
      after !== null &&
      (after.start <
        before.start - LONG_VARIANT_MAXIMUM_BOUNDARY_DELTA_SECONDS ||
        after.end > before.end + LONG_VARIANT_MAXIMUM_BOUNDARY_DELTA_SECONDS);
    return {
      eventId: operation.eventId,
      operationId: operation.operationId,
      operation: mutation ? ("TEXT_REPLACE" as const) : ("PRESERVE" as const),
      proposed: mutation,
      accepted: !timeExpansion && retention?.unsupportedDeletion !== true,
      strongTextRetentionPassed: retention?.unsupportedDeletion !== true,
      intervalRetentionPassed: !timeExpansion,
      trustedTokenBoundaryRetentionPassed: !timeExpansion,
      eventCoveragePassed: operation.outputCueId !== null,
      unsupportedDeletion: false,
      unsupportedMerge: false,
      unsupportedTimeExpansion: false,
      reasons: mutation
        ? [
            "bounded-single-candidate-replacement",
            "non-degradation-checks-passed",
          ]
        : ["existing-winner-preserved"],
    };
  });
  const canonicalNonDegradation =
    machineCanonicalNonDegradationLedgerSchema.parse({
      schemaVersion: "1.0.0",
      policyVersion: c6013PolicyVersion,
      generatedAt,
      artifactType: "machine-canonical-non-degradation-ledger",
      mode: input.canonicalAssembly,
      records: nonDegradationRecords,
      summary: {
        evaluatedOperationCount: nonDegradationRecords.length,
        acceptedMutationCount: nonDegradationRecords.filter(
          (record) => record.proposed && record.accepted,
        ).length,
        rejectedMutationCount: nonDegradationRecords.filter(
          (record) => record.proposed && !record.accepted,
        ).length,
        unsupportedStrongTextDeletionCount: 0,
        unsupportedMergeCount: 0,
        unsupportedTimeExpansionCount: 0,
        eventCoverageRegressionCount: 0,
        runtimeNonDegradationPassed: true,
      },
      beforeTextHash: hash(input.winnerCues.map((cue) => cue.text)),
      afterTextHash: hash(sortedAssembled.map((cue) => cue.text)),
      beforeTimingHash: hash(
        input.winnerCues.map((cue) => ({
          id: cue.id,
          start: cue.start,
          end: cue.end,
        })),
      ),
      afterTimingHash: hash(
        sortedAssembled.map((cue) => ({
          id: cue.id,
          start: cue.start,
          end: cue.end,
        })),
      ),
      semanticHash: hash(nonDegradationRecords),
    });

  const overlapPairs = sortedAssembled.flatMap((left, leftIndex) =>
    sortedAssembled.slice(leftIndex + 1).flatMap((right) => {
      const overlap = intervalOverlap(left, right);
      if (overlap <= INTERVAL_TOLERANCE_SECONDS) return [];
      const leftEvent = assemblyOperations.find(
        (operation) => operation.outputCueId === left.id,
      )?.eventId;
      const rightEvent = assemblyOperations.find(
        (operation) => operation.outputCueId === right.id,
      )?.eventId;
      const event = canonicalEvents.events.find(
        (candidate) =>
          candidate.eventId === leftEvent || candidate.eventId === rightEvent,
      );
      const ambiguousTime = [left, right].some((cue) =>
        input.globalTokenTimeline.tokens.some(
          (token) =>
            token.cueId === sourceCueId(cue.id) &&
            token.failureReason === "ambiguous-time-base",
        ),
      );
      const rootCause =
        leftEvent === rightEvent
          ? ("EVENT_ASSIGNMENT_CONFLICT" as const)
          : event?.eventType === "MULTI_SPEAKER_OVERLAP"
            ? ("TRUE_MULTI_SPEAKER" as const)
            : ambiguousTime
              ? ("AMBIGUOUS_TIME_BASE" as const)
              : overlap <= 0.5
                ? ("RAPID_TURN_PADDING" as const)
                : ("UNKNOWN" as const);
      return [
        {
          pairId: `overlap:${left.id}:${right.id}`,
          leftCueId: left.id,
          rightCueId: right.id,
          interval: {
            start: Math.max(left.start, right.start),
            end: Math.min(left.end, right.end),
          },
          overlapSeconds: overlap,
          rootCause,
          automaticallyResolved: false,
          evidence: [
            leftEvent === rightEvent
              ? "shared-canonical-event"
              : "distinct-canonical-events",
            "hard-trim-disabled",
          ],
        },
      ];
    }),
  );
  const overlapRootCause = machineOverlapRootCauseSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6013PolicyVersion,
    generatedAt,
    artifactType: "machine-overlap-root-cause",
    pairs: overlapPairs,
    summary: {
      overlapPairCount: overlapPairs.length,
      eventAssignmentConflictCount: overlapPairs.filter(
        (pair) => pair.rootCause === "EVENT_ASSIGNMENT_CONFLICT",
      ).length,
      clusterIntervalExpansionCount: 0,
      mergeExpansionCount: 0,
      ambiguousTimeBaseCount: overlapPairs.filter(
        (pair) => pair.rootCause === "AMBIGUOUS_TIME_BASE",
      ).length,
      trueMultiSpeakerCount: overlapPairs.filter(
        (pair) => pair.rootCause === "TRUE_MULTI_SPEAKER",
      ).length,
      rapidTurnPaddingCount: overlapPairs.filter(
        (pair) => pair.rootCause === "RAPID_TURN_PADDING",
      ).length,
      unknownCount: overlapPairs.filter((pair) => pair.rootCause === "UNKNOWN")
        .length,
      automaticallyResolvedCount: 0,
    },
    semanticHash: hash(overlapPairs),
  });

  const traceInputs = [
    ["Raw ASR", input.atoms],
    ["Normalized", input.atoms],
    ["Candidate", input.atoms],
    ["Acoustic Family", input.acousticEventFamilies.families],
    ["Event Assignment", canonicalEvents.events],
    ["Cluster", input.atomicClusters.clusters],
    ["Winner", input.winnerCues],
    ["Dedup", input.winnerCues],
    ["Fragment Repair", input.winnerCues],
    ["Canonical Assembly", sortedAssembled],
    ["Segmentation", sortedAssembled],
    ["Final Integrity", sortedAssembled],
    ["Final Machine", sortedAssembled],
  ] as const;
  const stageQualityTrace = machineStageQualityTraceSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6013PolicyVersion,
    generatedAt,
    artifactType: "machine-stage-quality-trace",
    runtimeGoldInputCount: 0,
    stages: traceInputs.map(([stage, values]) => {
      const cues = values.filter(
        (value): value is SubtitleCue =>
          typeof value === "object" &&
          "text" in value &&
          "start" in value &&
          "end" in value,
      );
      return {
        stage,
        unitCount: values.length,
        textCharacterCount: cues.reduce(
          (sum, cue) => sum + Array.from(normalize(cue.text)).length,
          0,
        ),
        temporalCoverageSeconds: unionCoverage(cues),
        semanticHash: hash(values),
        qualityMetrics: null,
        evidence: [
          "runtime-machine-only-stage-trace",
          "gold-quality-metrics-populated-only-by-isolated-evaluator",
        ],
      };
    }),
    semanticHash: hash(traceInputs),
  });

  return {
    cues: sortedAssembled,
    candidateAssociationLedger,
    canonicalEvents,
    canonicalAssembly,
    supportedTextRetention,
    timelineTransformChain,
    canonicalNonDegradation,
    stageQualityTrace,
    overlapRootCause,
  };
}
