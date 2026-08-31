import {
  subtitlePackageSchema,
  type C61HypothesisInput,
  type C612Identity,
  type C612CtcScore,
  type C612FeatureRow,
  type C612Label,
  C612_FEATURE_NAMES,
} from "@mvl/shared";
import { buildC61HypothesisUniverse } from "../../packages/video-subtitler/src/consensus/hypothesis-universe.js";
import { buildC611MachineProposals } from "../../packages/video-subtitler/src/consensus/existing-candidate-proposal.js";
import type { C61MachineArtifactInput } from "../../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";
import { fullCandidateRankAudit } from "../../packages/video-subtitler/src/consensus/top-k/full-candidate-rank-audit.js";
import { recoverIdentity } from "../../packages/video-subtitler/src/consensus/top-k/correlation-identity.js";
import {
  hash,
  c612Defined,
} from "../../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import {
  artifact,
  C612_POLICY_HASH,
} from "../../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import {
  c612BaselineSchema,
  c612FreezeSchema,
  c612ProfileFreezeSchema,
  c612FullIdentitySchema,
} from "@mvl/shared";
import {
  C612_RERANKERS,
  C612_RERANKER_PROFILE_HASH,
} from "../../packages/video-subtitler/src/consensus/top-k/linear-reranker.js";
import { buildTopK } from "../../packages/video-subtitler/src/consensus/top-k/top-k-candidate-builder.js";
import { reconcileIdentities } from "../../packages/video-subtitler/src/consensus/top-k/correlation-identity.js";
import { buildCompleteness } from "../../packages/video-subtitler/src/consensus/top-k/candidate-acoustic-completeness.js";
import { buildContractionAudit } from "../../packages/video-subtitler/src/consensus/top-k/contraction-audit.js";
import {
  buildFixedMappingV2,
  buildC612Folds,
} from "../../packages/video-subtitler/src/consensus/top-k/fixed-cue-group-mapping-v2.js";
import { buildTopKFeatures } from "../../packages/video-subtitler/src/consensus/top-k/top-k-feature-table.js";
import { createC612CandidateLabels } from "../../packages/video-subtitler/src/consensus/top-k/fixed-group-evaluation.js";
import { c612CtcSchema } from "@mvl/shared";
import type { C612FrozenInputs } from "../../packages/video-subtitler/src/consensus/top-k/c612-frozen-inputs.js";
export const SHA = "a".repeat(64);
export function c612Fixture(count = 10) {
  const production = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.wav",
      container: "wav",
      durationSeconds: count * 10 + 5,
    },
    identity: {
      title: "Synthetic C612",
      season: null,
      episode: null,
      year: null,
    },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: { ass: "test.ass", srt: "test.srt", vtt: "test.vtt" },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    warnings: [],
    cues: Array.from({ length: count }, (_, i) => ({
      id: `cue-${i}`,
      start: i * 10 + 1,
      end: i * 10 + 3,
      text: "明日は曇り",
      language: "ja",
      languages: ["ja"],
      speaker: null,
      confidence: null,
    })),
  });
  const events = production.cues.map((c, i) => {
    const body = {
      eventId: `event-${i}`,
      sourceInterval: { start: c.start, end: c.end },
      sourceCandidateIds: [
        `current-${i}`,
        `a-${i}`,
        `b-${i}`,
        `c-${i}`,
        `d-${i}`,
        `rejected-${i}`,
      ],
      finalCueIds: [c.id],
      currentText: c.text,
      finalSpan: {
        finalCueId: c.id,
        spanStart: 0,
        spanEnd: Array.from(c.text).length,
        spanText: c.text,
        lineageStatus: "EXACT",
        modifiable: true,
        evidenceHash: SHA,
      },
    };
    return { ...body, semanticHash: hash(body) };
  });
  const candidates: C61HypothesisInput[] = events.flatMap((e, i) =>
    [
      ["current", "CURRENT", "明日は曇り"],
      ["a", "WHISPER", "曇り"],
      ["b", "WHISPER", "明日は雨だ"],
      ["c", "WHISPER", "今日は雨だ"],
      ["d", "REAZON", "明日は晴れ"],
      ["rejected", "WHISPER", "はい"],
    ].map(([key, provider, displayText]) => ({
      inputRecordId: `input-${i}-${key}`,
      sourceCandidateId: `${key}-${i}`,
      eventId: e.eventId,
      providerFamily: provider as C61HypothesisInput["providerFamily"],
      modelIdentity: `model-${provider}`,
      requestId: `req-${i}-${key}`,
      windowType: "CORE_EXACT",
      sourceInterval: e.sourceInterval,
      displayText: c612Defined(displayText),
      pronunciationText: null,
      pronunciationEvidenceId: null,
      candidateRole: provider === "CURRENT" ? "CURRENT_FINAL" : "CORE_EXACT",
      correlationLineage: [e.eventId, c612Defined(key)],
      provenanceHashes: [SHA],
      lineageVerified: true,
      sourceGlobalVerified: true,
      hardRejectionReasons:
        key === "rejected" ? ["SYNTHETIC_HARD_REJECTION"] : [],
      localizationBlockers: [],
      runtimeGoldInputCount: 0,
      humanDerived: false,
    })),
  );
  const machine: C61MachineArtifactInput = {
    subtitlePackage: production,
    taskDirectory: "synthetic",
    events,
    candidates,
    sourceArtifactHashes: { "synthetic.json": SHA },
    acousticScores: [],
    baselineInventory: {
      canonicalCueCount: count,
      canonicalEventCount: count,
      historicalRawCandidateCount: candidates.length,
      historicalDispositionCounts: {},
      inputRowsByArtifact: {},
      sourceMediaSha256: SHA,
      sourceDurationSeconds: count * 10 + 5,
      newAsrInferenceCount: 0,
      networkUsed: false,
      runtimeGoldInputCount: 0,
    },
  };
  const universe = buildC61HypothesisUniverse({
    events,
    candidates,
    sourceArtifactHashes: machine.sourceArtifactHashes,
  });
  const previous = buildC611MachineProposals({
    universe,
    machine,
    productionPackage: production,
    metadataArtifacts: {},
  });
  const ranks = fullCandidateRankAudit(
    universe,
    previous.proposals,
    previous.riskLedger,
  );
  const identities = universe.candidates
    .filter((c) => c.inclusionStatus === "INCLUDED")
    .map((c) =>
      recoverIdentity(
        c,
        SHA,
        previous.correlationGroups.observations.find(
          (o) => o.candidateId === c.candidateId,
        ),
      ),
    );
  return {
    production,
    universe,
    previous,
    ranks,
    identities,
    machine,
    gold: production.cues.map((c) => ({
      id: `gold-${c.id}`,
      start: c.start,
      end: c.end,
      text: "明日は晴れ",
    })),
  };
}
export function acousticIdentity(
  overrides: Partial<C612Identity> = {},
): C612Identity {
  return {
    eventId: "event",
    candidateId: "candidate",
    sourceMediaHash: SHA,
    sourceAudioStreamIdentity: "a:0",
    requestedInterval: { start: 0, end: 4 },
    extractedInterval: { start: 0, end: 4 },
    coreInterval: { start: 1, end: 3 },
    sourceSampleStart: 16000,
    sourceSampleEnd: 48000,
    sampleRate: 16000,
    channelMixPolicy: "mono16k",
    coreAudioHash: SHA,
    providerFamily: "WHISPER",
    modelId: "synthetic",
    modelRevision: "rev",
    decodeConfigHash: SHA,
    promptHash: SHA,
    requestId: "r",
    parentRequestId: null,
    windowLineage: [],
    cacheIdentity: SHA,
    identityStatus: "VERIFIED_CORE_PCM_IDENTITY",
    observationIdentity: SHA,
    coreIdentity: SHA,
    evidenceHashes: [SHA],
    missing: [],
    ...overrides,
  };
}
export function acousticScore(
  overrides: Partial<C612CtcScore> = {},
): C612CtcScore {
  return {
    candidateId: "candidate",
    eventId: "event",
    audioHash: SHA,
    modelSnapshotHash: SHA,
    runtimeIdentityHash: SHA,
    scoredInterval: { start: 1, end: 3 },
    targetHash: SHA,
    representation: "PRONUNCIATION",
    rawLoss: 1,
    perTokenLoss: 0.5,
    tokenCount: 2,
    vocabularyCoverage: 1,
    unknownTokenCount: 0,
    acousticFrameCount: 100,
    status: "SCORABLE",
    reasons: [],
    supportedTokens: [
      { index: 0, start: 0.1, end: 1, posterior: 0.99 },
      { index: 1, start: 1, end: 1.9, posterior: 0.99 },
    ],
    cacheIdentity: SHA,
    ...overrides,
  };
}
export function feature(
  candidateId: string,
  eventId: string,
  value: number,
  missing = false,
): C612FeatureRow {
  const values: (number | null)[] = C612_FEATURE_NAMES.map(() => null);
  values[0] = missing ? null : value;
  values[16] = Number(candidateId.endsWith("current"));
  values[35] = 1;
  values[36] = 1;
  return {
    candidateId,
    eventId,
    values,
    missing: values.map((v) => v === null),
    evidenceHashes: [SHA],
  };
}
export function label(
  candidateId: string,
  eventId: string,
  error: number,
  current = false,
): C612Label {
  return {
    candidateId,
    eventId,
    groupId: `group-${eventId}`,
    foldId: "outer-1",
    current,
    eligible: true,
    reasons: [],
    baselineExactError: 3,
    candidateExactError: error,
    baselineNormalizedError: 3,
    candidateNormalizedError: error,
    normalizedGain: 3 - error,
    exactGain: 3 - error,
    materialDelta: 0,
    catastrophicDeletion: false,
    classification:
      error < 3 ? "IMPROVED" : error > 3 ? "REGRESSED" : "NEUTRAL",
    labelClass: error < 3 ? "IMPROVES_CURRENT" : "EQUIVALENT_TO_CURRENT",
    labelRole: "DIAGNOSTIC_LOCAL_COUNTERFACTUAL",
    topKProfiles: ["T3_PROVIDER_DIVERSE_CORRELATION_DEDUP_TOP4"],
    oracleRank: null,
  };
}
/** Synthetic numeric evidence only: never passed off as a real encoder execution. */
export function c612EvidenceFixture(count = 10) {
  const f = c612Fixture(count);
  const ids = f.identities.map((id) => {
    const event = c612Defined(
      f.universe.events.find((e) => e.eventId === id.eventId),
    );
    const interval = event.sourceInterval;
    return acousticIdentity({
      ...id,
      requestedInterval: {
        start: Math.max(0, interval.start - 1),
        end: interval.end + 1,
      },
      extractedInterval: {
        start: Math.max(0, interval.start - 1),
        end: interval.end + 1,
      },
      coreInterval: interval,
      coreAudioHash: hash(interval),
      coreIdentity: hash(["synthetic-core", interval]),
      identityStatus: "VERIFIED_CORE_PCM_IDENTITY",
      observationIdentity:
        id.providerFamily === "CURRENT"
          ? null
          : hash(["synthetic-observation", id.candidateId]),
      evidenceHashes: [SHA],
      missing: [],
    });
  });
  const top = buildTopK(f.ranks, f.universe, ids),
    correlation = reconcileIdentities(ids, top.topK.uniqueCandidateIds);
  const scores = c612CtcSchema.parse(
    artifact("machine-c6-1-2-candidate-ctc-scores", {
      lowerIsBetter: true,
      rows: correlation.identity.rows.map((id) =>
        acousticScore({
          eventId: id.eventId,
          candidateId: id.candidateId,
          audioHash: id.coreAudioHash,
          scoredInterval: id.coreInterval,
          targetHash: hash(
            c612Defined(
              f.universe.candidates.find(
                (c) => c.candidateId === id.candidateId,
              ),
            ).displayText,
          ),
        }),
      ),
      runtimeGoldInputCount: 0,
    }),
  );
  const vad = {
    intervals: f.production.cues.map((c) => ({
      start: c.start + 0.1,
      end: c.end - 0.1,
    })),
    sourceIdentity: SHA,
    verified: true,
    evidenceHash: SHA,
  };
  const complete = buildCompleteness(
    correlation.identity.rows,
    scores.rows,
    vad,
  );
  const contraction = buildContractionAudit(
      f.universe,
      complete.completeness.rows,
      [],
    ),
    mapped = buildFixedMappingV2(f.universe, f.production),
    folds = buildC612Folds(mapped.mapping, ids, f.universe);
  const features = buildTopKFeatures({
    universe: f.universe,
    identities: correlation.identity.rows,
    ranks: f.ranks.rows,
    completeness: complete.completeness.rows,
    groups: mapped.mapping.groups,
    scores: scores.rows,
  });
  const baseline = c612BaselineSchema.parse(
    artifact("c6-1-2-baseline-replay", {
      acceptanceCommit: "synthetic",
      baselineBranch: "synthetic",
      checks: [],
      passed: true,
      policyHash: SHA,
      proposalHash: SHA,
      fixedMappingHash: SHA,
      featureHash: SHA,
      foldHash: SHA,
      oofHash: SHA,
      universeHash: f.universe.semanticHash,
      canonicalTextHash: SHA,
      canonicalTimingHash: SHA,
      productionFiles: [],
      inputFiles: [],
      cueCount: count,
      eventCount: count,
      eligibleEventCount: count,
      inputCandidateCount: f.universe.candidates.length,
      includedAsrCount: count * 4,
      whisperCount: count * 3,
      reazonCount: count,
      strongContractionCount: count,
      runtimeGoldInputCount: 0,
      newAsrInferenceCount: 0,
      networkUsed: false,
    }),
  );
  const freeze = c612FreezeSchema.parse(
    artifact("c6-1-2-machine-freeze-manifest", {
      frozenAt: "2000-01-01T00:00:00.000Z",
      files: [],
      codeFiles: [],
      machineAggregateHash: hash([]),
      codeAggregateHash: hash([]),
      policyHash: C612_POLICY_HASH,
      sourceIdentity: SHA,
      productionTextHash: SHA,
      productionTimingHash: SHA,
      goldRead: false,
      oofShadowsFrozenBeforeGold: false,
      modelProfilesFrozenBeforeGold: true,
      inputOrderParity: true,
    }),
  );
  const profiles = c612ProfileFreezeSchema.parse(
    artifact("c6-1-2-reranker-profile-freeze", {
      profileHash: C612_RERANKER_PROFILE_HASH,
      policyHash: C612_POLICY_HASH,
      profiles: C612_RERANKERS,
      primaryProfile: "L6",
      supervisedModelsFitAfterTrainLabels: true,
    }),
  );
  const frozen: C612FrozenInputs = {
    freeze,
    profiles,
    fullIdentities: c612FullIdentitySchema.parse(
      artifact("machine-c6-1-2-full-correlation-identity", {
        rows: ids,
        universeHash: f.universe.semanticHash,
        runtimeGoldInputCount: 0,
      }),
    ),
    legacyRisks: f.previous.riskLedger,
    legacyProposals: f.previous.proposals,
    universe: f.universe,
    production: f.production,
    ranks: f.ranks,
    topK: top.topK,
    identities: correlation.identity,
    features,
    contraction,
    completeness: complete.completeness,
    folds,
    mapping: mapped.mapping,
    correlation: correlation.audit,
    scores,
    baseline,
  };
  const labels = () =>
    createC612CandidateLabels({
      groups: mapped.mapping.groups,
      production: f.production,
      universe: f.universe,
      ranks: f.ranks.rows,
      sets: top.topK.sets,
      folds,
      gold: f.gold,
      freezeHash: freeze.semanticHash,
      goldHash: SHA,
      goldFirstReadAt: "2000-01-02T00:00:00.000Z",
      mappingHash: mapped.mapping.semanticHash,
    });
  return {
    ...f,
    frozen,
    top,
    correlation,
    complete,
    mapped,
    features,
    folds,
    contraction,
    scores,
    labels,
  };
}
