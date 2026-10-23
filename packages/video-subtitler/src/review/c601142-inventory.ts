import path from "node:path";
import { z } from "zod";
import {
  NodeProcessRunner,
  acousticFeatures142Schema,
  masked142Schema,
  inventory142Schema,
  observation142Schema,
  island142Schema,
  candidate142Schema,
  uncovered142Schema,
  type AcousticFeatures142,
  type ScoreTracks142,
  type Sweeps142,
  type Policy142,
  type Samples142,
  type Masked142,
  type Inventory142,
  type C601141Inventory,
  type Observation142,
  type Island142,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { header142 } from "./c601142-policy.js";
import { unique142, stratum142 } from "./c601142-selection.js";
import {
  hashed141,
  hash141,
  assertHash141,
  id141,
  union141,
  duration141,
  subtract141,
  seconds141,
  required141,
} from "./c601141-policy.js";
import { durableJson141 } from "./c601141-io.js";

/** Event sweep: simultaneous end/start events obey half-open sample intervals.
 * No parent envelope or merely nearby observation can contribute a vote. */
export function partition142<T extends { nativeInterval: Samples142 }>(
  rows: T[],
  maximum: number,
  splitPoints: number[] = [],
) {
  const events = new Map<number, { starts: number[]; ends: number[] }>();
  const event = (n: number) => {
    let e = events.get(n);
    if (!e) {
      e = { starts: [], ends: [] };
      events.set(n, e);
    }
    return e;
  };
  event(0);
  event(maximum);
  for (const p of splitPoints) if (p >= 0 && p <= maximum) event(p);
  rows.forEach((row, i) => {
    const v = row.nativeInterval;
    if (
      !Number.isSafeInteger(v.startSample) ||
      !Number.isSafeInteger(v.endSample) ||
      v.startSample < 0 ||
      v.endSample > maximum ||
      v.endSample <= v.startSample
    )
      throw new Error("C601142_NATIVE_INTERVAL_INVALID");
    event(v.startSample).starts.push(i);
    event(v.endSample).ends.push(i);
  });
  const points = [...events.keys()].sort((a, b) => a - b),
    active = new Set<number>();
  const cells: { nativeInterval: Samples142; supports: T[] }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const startSample = required141(points[i]),
      endSample = required141(points[i + 1]),
      e = required141(events.get(startSample));
    for (const index of e.ends) active.delete(index);
    for (const index of e.starts) active.add(index);
    if (endSample > startSample)
      cells.push({
        nativeInterval: { startSample, endSample },
        supports: [...active].map((index) => required141(rows[index])),
      });
  }
  return cells;
}
export interface MaskedProposal142 {
  id: string;
  nativeInterval: Samples142;
  mainRunIds: string[];
  auditRunIds: string[];
}
export function maskedProposals142(
  scores: ScoreTracks142,
  sweeps: Sweeps142,
  policy: Policy142,
): MaskedProposal142[] {
  [scores, sweeps].forEach(assertHash141);
  const rate = scores.sourceIdentity.sampleRate,
    maximum = Math.round(scores.sourceIdentity.durationSeconds * rate);
  const intervals = scores.tracks.flatMap((track) => [
    ...(
      sweeps.runs.find((r) => r.runId === track.runId)?.nativeIntervals ?? []
    ).map((nativeInterval) => ({
      nativeInterval,
      runId: track.runId,
      main: true,
    })),
    ...track.subthresholdPeakNativeIntervals.map((nativeInterval) => ({
      nativeInterval,
      runId: track.runId,
      main: false,
    })),
  ]);
  const cells = partition142(
    intervals,
    maximum,
    Array.from(
      { length: Math.ceil(maximum / (12 * rate)) },
      (_, i) => i * 12 * rate,
    ),
  );
  const proposals: Omit<MaskedProposal142, "id">[] = [];
  for (const cell of cells) {
    const mainRunIds = unique142(
        cell.supports.filter((s) => s.main).map((s) => s.runId),
      ),
      auditRunIds = unique142(
        cell.supports.filter((s) => !s.main).map((s) => s.runId),
      );
    const previous = proposals.at(-1);
    if (
      previous?.nativeInterval.endSample === cell.nativeInterval.startSample &&
      hash141([previous.mainRunIds, previous.auditRunIds]) ===
        hash141([mainRunIds, auditRunIds]) &&
      cell.nativeInterval.endSample - previous.nativeInterval.startSample <=
        12 * rate
    )
      previous.nativeInterval.endSample = cell.nativeInterval.endSample;
    else
      proposals.push({
        nativeInterval: { ...cell.nativeInterval },
        mainRunIds,
        auditRunIds,
      });
  }
  return proposals
    .filter(
      (p) =>
        p.nativeInterval.endSample - p.nativeInterval.startSample >=
        policy.cluster.minimumCoreSeconds * rate,
    )
    .map((p) => ({
      ...p,
      id: id141("masked-proposal", { source: scores.sourceIdentity, ...p }),
    }));
}
export function classifyMasked142(
  proposal: MaskedProposal142,
  features: AcousticFeatures142,
  scores: ScoreTracks142,
  policy: Policy142,
) {
  const main = scores.tracks.filter((t) =>
      proposal.mainRunIds.includes(t.runId),
    ),
    audit = scores.tracks.filter((t) => proposal.auditRunIds.includes(t.runId));
  const tracks = [...main, ...audit],
    families = unique142(tracks.map((t) => t.family)),
    mainFamilies = unique142(main.map((t) => t.family));
  const pcmViews = unique142(tracks.map((t) => t.pcmSha256));
  const acousticSupport =
    features.rms >= policy.masked.minimumRms &&
    features.voiceBandRatio >= policy.masked.minimumVoiceBandRatio &&
    features.modulation2To16HzRatio >= policy.masked.minimumModulationRatio &&
    features.spectralFlatness <= policy.masked.maximumFlatness;
  // All thresholds are functions of the frozen acoustic policy, never Gold.
  // Stable harmonics alone are not speech, and this is only a contradiction
  // proxy when no detector has MAIN-threshold support.
  const acousticContradiction =
    !main.length &&
    features.harmonicityProxy > policy.masked.maximumFlatness &&
    features.pitchContinuityProxy > 1 - policy.masked.minimumModulationRatio &&
    features.modulation2To16HzRatio < policy.masked.minimumModulationRatio;
  let evidenceClass: Masked142["candidates"][number]["evidenceClass"];
  if (mainFamilies.length >= 2)
    evidenceClass = "VERIFIED_INDEPENDENT_DETECTOR_SPEECH";
  else if (acousticContradiction) evidenceClass = "MUSIC_DOMINATED_UNRESOLVED";
  else if (audit.length && families.length >= 2)
    evidenceClass = "CROSS_DETECTOR_SUBTHRESHOLD_CANDIDATE";
  else if (mainFamilies.length === 1 && mainFamilies[0] === "WEBRTC")
    evidenceClass = "WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE";
  else if (
    audit.length >= 2 &&
    unique142(audit.map((t) => t.pcmSha256)).length >= 2
  )
    evidenceClass = "SUBTHRESHOLD_MULTI_VIEW_CANDIDATE";
  else if (main.length || (audit.length && acousticSupport))
    evidenceClass = "MASKED_SPEECH_SAFETY_CANDIDATE";
  else if (features.rms >= policy.masked.minimumRms)
    evidenceClass = "ENERGY_ONLY_UNSUPPORTED";
  else evidenceClass = "NO_SPEECH_SUPPORT";
  const eligibleSafetyCandidate =
    !acousticContradiction &&
    [
      "VERIFIED_INDEPENDENT_DETECTOR_SPEECH",
      "WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE",
      "CROSS_DETECTOR_SUBTHRESHOLD_CANDIDATE",
      "SUBTHRESHOLD_MULTI_VIEW_CANDIDATE",
      "MASKED_SPEECH_SAFETY_CANDIDATE",
    ].includes(evidenceClass);
  return {
    evidenceClass,
    detectorFamilies: families,
    distinctPcmViewIds: pcmViews,
    independentFamilyCount: families.length,
    scoreTrackHashes: unique142(tracks.map((t) => t.semanticHash)),
    acousticSupport,
    acousticContradiction,
    eligibleSafetyCandidate,
    reasons: [
      main.length
        ? "MAIN_DETECTOR_SUPPORT_PRESENT"
        : "NO_MAIN_DETECTOR_SUPPORT",
      audit.length
        ? "SUBTHRESHOLD_SCORE_SUPPORT_PRESENT"
        : "NO_SUBTHRESHOLD_SUPPORT",
      acousticSupport
        ? "SPEECH_MODULATION_PROXY_SUPPORTS"
        : "ACOUSTIC_PROXY_NOT_SUFFICIENT",
      "HEURISTICS_AND_POSTERIORS_ARE_NOT_TRANSCRIPT_TRUTH",
    ],
  };
}
export async function buildMasked142(input: {
  scores: ScoreTracks142;
  sweeps: Sweeps142;
  policy: Policy142;
  python: string;
  worker: string;
  audioPath: string;
  expectedPcmSha256: string;
  outputDirectory: string;
}) {
  const proposals = maskedProposals142(
      input.scores,
      input.sweeps,
      input.policy,
    ),
    rate = input.scores.sourceIdentity.sampleRate;
  const requestPath = path.join(
    input.outputDirectory,
    "acoustic-features-request.local-only.json",
  );
  await durableJson141(requestPath, {
    audioPath: input.audioPath,
    intervals: proposals.map((p) => ({
      id: p.id,
      startSample16k: Math.floor((p.nativeInterval.startSample * 16000) / rate),
      endSample16k: Math.ceil((p.nativeInterval.endSample * 16000) / rate),
    })),
  });
  const process = await new NodeProcessRunner().run(
    input.python,
    [input.worker, "--mode", "features", "--request", requestPath],
    { timeoutMs: 600000 },
  );
  const raw = z
    .object({
      pcmSha256: z.string(),
      rows: z.array(
        z
          .object({ id: z.string(), features: acousticFeatures142Schema })
          .strict(),
      ),
      modelInferenceCount: z.literal(0),
    })
    .strict()
    .parse(JSON.parse(process.stdout));
  if (raw.pcmSha256 !== input.expectedPcmSha256)
    throw new Error("C601142_ACOUSTIC_PCM_IDENTITY_MISMATCH");
  if (
    raw.rows.length !== proposals.length ||
    new Set(raw.rows.map((r) => r.id)).size !== proposals.length
  )
    throw new Error("C601142_ACOUSTIC_FEATURE_ROWS_MISMATCH");
  const candidates = proposals.map((p) => {
    const row = raw.rows.find((r) => r.id === p.id);
    if (!row) throw new Error("C601142_ACOUSTIC_FEATURE_ROW_MISSING");
    return hashed141({
      candidateId: p.id,
      nativeInterval: p.nativeInterval,
      sourceInterval: seconds141(p.nativeInterval, rate),
      mainRunIds: p.mainRunIds,
      auditRunIds: p.auditRunIds,
      acousticFeatures: row.features,
      transcriptTruthVerified: false,
      ...classifyMasked142(p, row.features, input.scores, input.policy),
    });
  });
  const result = masked142Schema.parse(
    hashed141({
      ...header142(input.policy, input.scores.sourceIdentity),
      artifactType: "machine-masked-speech-candidates-v1",
      scoreTracksHash: input.scores.semanticHash,
      candidates,
      featureSourcePcmHash: raw.pcmSha256,
      summary: {
        candidateCount: candidates.length,
        eligibleCount: candidates.filter((c) => c.eligibleSafetyCandidate)
          .length,
        mainSupportedCount: candidates.filter((c) => c.mainRunIds.length)
          .length,
        subthresholdOnlyCount: candidates.filter(
          (c) => c.auditRunIds.length && !c.mainRunIds.length,
        ).length,
        independentCrossDetectorCount: candidates.filter(
          (c) => c.independentFamilyCount >= 2,
        ).length,
        musicUnresolvedCount: candidates.filter(
          (c) => c.evidenceClass === "MUSIC_DOMINATED_UNRESOLVED",
        ).length,
        energyOnlyPromotedCount: 0,
        sameFamilyVoteInflationCount: 0,
      },
    }),
  );
  await durableJson141(
    path.join(
      input.outputDirectory,
      "machine-masked-speech-candidates-v1.json",
    ),
    result,
  );
  return result;
}
export function buildInventory142(input: {
  old: C601141Inventory;
  sweeps: Sweeps142;
  masked: Masked142;
  policy: Policy142;
  splitPoints: number[];
}) {
  [input.old, input.sweeps, input.masked].forEach(assertHash141);
  const { policy } = input,
    source = input.old.sourceIdentity,
    rate = source.sampleRate,
    maximum = Math.round(source.durationSeconds * rate);
  const observations: Observation142[] = input.old.observations.map((o) =>
    observation142Schema.parse({
      ...o,
      scoreLevel: "LEGACY",
      independentSpeechTruth: false,
      scoreTrackHash: null,
    }),
  );
  for (const run of input.sweeps.runs)
    if (run.status === "SUCCESS")
      for (const nativeInterval of run.nativeIntervals)
        observations.push(
          observation142Schema.parse({
            observationId: id141("detector-observation-v5", [
              run.runId,
              nativeInterval,
            ]),
            nativeInterval,
            family: run.family,
            correlationGroup: run.family,
            viewId: run.pcmSha256,
            profileId: run.runId,
            evidenceIds: [run.runId],
            requestIds: [run.runId],
            verifiedTimebase: true,
            speechPositive: true,
            strongContradiction: false,
            reliableLexical: false,
            scoreLevel: "MAIN",
            independentSpeechTruth: false,
            scoreTrackHash: run.scoreTrack?.semanticHash ?? null,
          }),
        );
  for (const candidate of input.masked.candidates.filter(
    (c) => c.eligibleSafetyCandidate && c.auditRunIds.length,
  ))
    for (const runId of candidate.auditRunIds) {
      const run = input.sweeps.runs.find((r) => r.runId === runId);
      if (!run) throw new Error("C601142_MASKED_RUN_UNBOUND");
      observations.push(
        observation142Schema.parse({
          observationId: id141("subthreshold-observation-v5", [
            candidate.candidateId,
            runId,
          ]),
          nativeInterval: candidate.nativeInterval,
          family: run.family,
          correlationGroup: run.family,
          viewId: run.pcmSha256,
          profileId: run.runId,
          evidenceIds: [candidate.candidateId, runId],
          requestIds: [runId],
          verifiedTimebase: true,
          speechPositive: true,
          strongContradiction: false,
          reliableLexical: false,
          scoreLevel: "AUDIT_SUBTHRESHOLD",
          independentSpeechTruth: false,
          scoreTrackHash: run.scoreTrack?.semanticHash ?? null,
        }),
      );
    }
  const grid = Array.from(
    {
      length: Math.ceil(
        maximum / (policy.cluster.maximumEnvelopeSeconds * rate),
      ),
    },
    (_, i) => i * policy.cluster.maximumEnvelopeSeconds * rate,
  );
  const cells = partition142(observations, maximum, [
      ...input.splitPoints,
      ...grid,
    ]),
    islands: Island142[] = [];
  for (const cell of cells) {
    if (!cell.supports.length) continue;
    const valid = cell.supports.filter(
      (o) => o.verifiedTimebase && o.speechPositive && !o.strongContradiction,
    );
    const main = valid.filter((o) => o.scoreLevel !== "AUDIT_SUBTHRESHOLD"),
      audit = valid.filter((o) => o.scoreLevel === "AUDIT_SUBTHRESHOLD");
    const families = unique142(valid.map((o) => o.correlationGroup)),
      detectors = unique142(
        main
          .filter((o) => ["SILERO", "PYANNOTE", "WEBRTC"].includes(o.family))
          .map((o) => o.family),
      );
    const detectorFamilies = unique142(valid.map((o) => o.family)),
      views = unique142(valid.flatMap((o) => (o.viewId ? [o.viewId] : [])));
    const masks = input.masked.candidates.filter(
      (c) =>
        c.eligibleSafetyCandidate &&
        c.nativeInterval.startSample <= cell.nativeInterval.startSample &&
        c.nativeInterval.endSample >= cell.nativeInterval.endSample,
    );
    const crossSub =
      audit.length > 0 &&
      unique142(
        valid
          .filter((o) => ["SILERO", "PYANNOTE", "WEBRTC"].includes(o.family))
          .map((o) => o.family),
      ).length >= 2;
    const contradiction = cell.supports.some((o) => o.strongContradiction);
    const evidenceClass: Island142["evidenceClass"] = contradiction
      ? "STRONG_CONTRADICTION"
      : !valid.length
        ? "TIMEBASE_UNVERIFIED"
        : detectors.length >= 2
          ? "MULTI_DETECTOR_CONFIRMED"
          : main.some((o) => o.family === "LEGACY_FINGERPRINT")
            ? "LEGACY_FINGERPRINT_CONFIRMED"
            : main.some((o) => o.family === "EXISTING_VERIFIED")
              ? "EXISTING_VERIFIED_SPEECH"
              : crossSub
                ? "CROSS_DETECTOR_SUBTHRESHOLD_CANDIDATE"
                : !main.length &&
                    unique142(audit.map((o) => o.viewId ?? "")).length >= 2
                  ? "SUBTHRESHOLD_MULTI_VIEW_CANDIDATE"
                  : !main.length
                    ? "MASKED_SPEECH_SAFETY_CANDIDATE"
                    : detectors.length === 1 && detectors[0] === "WEBRTC"
                      ? "WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE"
                      : unique142(
                            main.flatMap((o) => (o.viewId ? [o.viewId] : [])),
                          ).length >= 2
                        ? "MULTI_VIEW_SPEECH_POSITIVE"
                        : detectors.includes("PYANNOTE")
                          ? "PYANNOTE_ONLY_SPEECH_POSITIVE"
                          : main.some(
                                (o) =>
                                  o.profileId === "sensitive-v2" ||
                                  o.scoreLevel === "MAIN",
                              )
                            ? "SINGLE_DETECTOR_HIGH_RECALL"
                            : "LOW_SUPPORT_VIEW_SPECIFIC";
    const core = {
      nativeInterval: cell.nativeInterval,
      sourceInterval: seconds141(cell.nativeInterval, rate),
      observationIds: unique142(cell.supports.map((o) => o.observationId)),
      evidenceIds: unique142(cell.supports.flatMap((o) => o.evidenceIds)),
      requestIds: unique142(cell.supports.flatMap((o) => o.requestIds)),
      independentFamilies: families,
      independentFamilyCount: families.length,
      distinctPcmViewIds: views,
      evidenceClass,
      verifiedTimebase: valid.length > 0,
      strongContradiction: contradiction,
      reliableLexical: valid.some((o) => o.reliableLexical),
      detectorFamilies,
      evidenceStratum: stratum142(detectorFamilies, views, !main.length),
      maskedEvidenceIds: unique142(masks.map((m) => m.candidateId)),
      speechTruthVerified: false,
    };
    islands.push(
      island142Schema.parse(
        hashed141({ islandId: id141("inventory-v5-cell", core), ...core }),
      ),
    );
  }
  return inventory142Schema.parse(
    hashed141({
      ...header142(policy, source),
      artifactType: "machine-source-global-speech-inventory-v5",
      previousInventoryHash: input.old.semanticHash,
      newDetectorEvidenceHash: input.sweeps.evidenceSemanticHash,
      maskedEvidenceHash: input.masked.semanticHash,
      boundaryHash: hash141(input.splitPoints),
      observations,
      islands,
      summary: {
        observationCount: observations.length,
        islandCount: islands.length,
        multiDetectorCount: islands.filter(
          (i) => i.evidenceClass === "MULTI_DETECTOR_CONFIRMED",
        ).length,
        mainSpeechUnionSeconds: duration141(
          observations
            .filter(
              (o) =>
                o.scoreLevel !== "AUDIT_SUBTHRESHOLD" &&
                o.speechPositive &&
                o.verifiedTimebase,
            )
            .map((o) => o.nativeInterval),
          rate,
        ),
        maskedCandidateUnionSeconds: duration141(
          input.masked.candidates
            .filter((c) => c.eligibleSafetyCandidate && !c.mainRunIds.length)
            .map((c) => c.nativeInterval),
          rate,
        ),
        totalEvidenceUnionSeconds: duration141(
          islands.map((i) => i.nativeInterval),
          rate,
        ),
        newDetectorObservationCount:
          observations.length - input.old.observations.length,
        unresolvedCount: islands.filter((i) => !i.reliableLexical).length,
        parentEnvelopeAsSpeechCount: 0,
        correlationInflationCount: 0,
      },
    }),
  );
}
export function uncoveredSpeech142(input: {
  inventory: Inventory142;
  policy: Policy142;
  cueMasks: Samples142[];
  previousTargetMasks: Samples142[];
  activeSafetyMasks: Samples142[];
  activeSafetyHash: string | null;
  finalCueHash: string;
  previousTargetsHash: string;
  sceneSamples: number[];
}) {
  const { inventory, policy } = input;
  assertHash141(inventory);
  const rate = inventory.sourceIdentity.sampleRate;
  const candidates = inventory.islands.flatMap((island) => {
    const noCue = subtract141(island.nativeInterval, input.cueMasks),
      noPrevious = noCue.flatMap((v) =>
        subtract141(v, input.previousTargetMasks),
      );
    const remainder = noPrevious.flatMap((v) =>
      subtract141(v, input.activeSafetyMasks),
    );
    return remainder.map((nativeInterval) =>
      candidate142Schema.parse(
        hashed141({
          ...island,
          candidateId: id141("uncovered-v5", [island.islandId, nativeInterval]),
          parentIslandId: island.islandId,
          nativeInterval,
          sourceInterval: seconds141(nativeInterval, rate),
          uncoveredRatio:
            (nativeInterval.endSample - nativeInterval.startSample) /
            (island.nativeInterval.endSample -
              island.nativeInterval.startSample),
          partialCueOverlap:
            duration141(noCue, rate) <
            duration141([island.nativeInterval], rate),
          partialExistingTargetOverlap:
            duration141(noPrevious, rate) < duration141(noCue, rate),
          diversityBin: Math.floor(
            nativeInterval.startSample / rate / policy.selection.binSeconds,
          ),
          priority: 0,
          sceneIds: [
            `scene-partition-${input.sceneSamples.filter((n) => n <= nativeInterval.startSample).length}`,
          ],
        }),
      ),
    );
  });
  return uncovered142Schema.parse(
    hashed141({
      ...header142(policy, inventory.sourceIdentity),
      artifactType: "machine-uncovered-speech-candidates-v2",
      inventoryHash: inventory.semanticHash,
      finalCueHash: input.finalCueHash,
      previousTargetsHash: input.previousTargetsHash,
      subtractedActiveSafetyHash: input.activeSafetyHash,
      candidates,
      summary: {
        candidateCount: candidates.length,
        uncoveredSeconds: duration141(
          candidates.map((c) => c.nativeInterval),
          rate,
        ),
      },
    }),
  );
}
export function nativeMasks142(
  source: C60114SourceIdentity,
  values: readonly { start: number; end: number }[],
) {
  return union141(
    values.map((v) => ({
      startSample: Math.round(v.start * source.sampleRate),
      endSample: Math.round(v.end * source.sampleRate),
    })),
  );
}
