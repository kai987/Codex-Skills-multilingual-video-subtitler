import { describe, expect, it } from "vitest";
import {
  type C60114SourceIdentity,
  type C60114SourceEvidence,
  type C60114ParentGap,
  c60114SourceIdentitySchema,
  c60114ReviewTargetsSchema,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { buildVadGlobalTimebase } from "../packages/video-subtitler/src/machine-quality/vad-global-timebase.js";
import { createSampleTransform } from "../packages/video-subtitler/src/machine-quality/sample-transform-chain.js";
import {
  buildRequestTimelineV2,
  createRequestTimelineV2Entry,
} from "../packages/video-subtitler/src/machine-quality/request-timeline-v2.js";
import { buildGlobalTokenTimelineV2 } from "../packages/video-subtitler/src/machine-quality/global-token-timeline-v2.js";
import { type C60112ReviewItem } from "../packages/video-subtitler/src/review/c60112-policy.js";
import {
  assertC60114Policy,
  buildC60114Policy,
  c60114Coverage,
  c60114Subtract,
} from "../packages/video-subtitler/src/review/c60114-policy.js";
import {
  adaptC60114MachineEvidence,
  buildC60114SourceGlobalSpeechIslands,
  c60114IndependentGroups,
  createC60114SourceEvidence,
} from "../packages/video-subtitler/src/review/source-global-speech-islands.js";
import { buildC60114ReviewTargetIntervalsV2 } from "../packages/video-subtitler/src/review/review-target-intervals-v2.js";
import { buildC60114OrphanSpeechSweep } from "../packages/video-subtitler/src/review/orphan-speech-sweep.js";
import { selectC60114MissingDialogueProbes } from "../packages/video-subtitler/src/review/missing-dialogue-probe-selection.js";
import { reconcileC60114SourceGlobalLineage } from "../packages/video-subtitler/src/review/c60114-source-lineage-reconciliation.js";
import { buildMissingSpeechEvidenceV3 } from "../packages/video-subtitler/src/review/missing-speech-evidence-v3.js";
import { c60114LocalizedLexicalEvidenceSchema } from "@mvl/shared";

const policy = buildC60114Policy();
const source: C60114SourceIdentity = {
  sourceMediaSha256: "a".repeat(64),
  durationSeconds: 200,
  sampleRate: 48000,
  audioStreamIndex: 1,
  audioTimebase: "1/48000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS",
};
function evidence(
  id: string,
  start: number,
  end: number,
  extra: Partial<Omit<C60114SourceEvidence, "semanticHash">> = {},
) {
  return createC60114SourceEvidence({
    evidenceId: id,
    family: "MAPPED_VAD",
    sourceInterval: { start, end },
    mappingStatus: "VERIFIED",
    speechPositive: true,
    lexicalPositive: false,
    reliableLocalizedLexical: false,
    contradiction: false,
    strength: 0.9,
    rootLineageIds: [`root-${id}`],
    correlationGroup: `correlation-${id}`,
    providerFamily: "vad",
    artifactId: "synthetic-source",
    artifactSemanticHash: "b".repeat(64),
    sourceIdentityHash: machineQualitySemanticHash(source),
    sceneIds: [],
    speakerIds: [],
    reasons: ["SYNTHETIC_VERIFIED_SOURCE_GLOBAL_EVIDENCE"],
    ...extra,
  });
}
function parent(start = 0, end = 40): C60114ParentGap {
  return {
    gapId: "parent-gap",
    sourceInterval: { start, end },
    itemIds: ["missing-item"],
    searchEnvelopeOnly: true,
  };
}
function islands(
  rows: C60114SourceEvidence[],
  gaps: C60114ParentGap[] = [parent()],
) {
  return buildC60114SourceGlobalSpeechIslands({
    sourceIdentity: source,
    policy,
    evidence: rows,
    parentGaps: gaps,
  });
}
function emptyTargets() {
  return buildC60114ReviewTargetIntervalsV2({
    sourceIdentity: source,
    policy,
    items: [],
    finalCues: [],
  });
}
function item(extra: Partial<C60112ReviewItem> = {}): C60112ReviewItem {
  return {
    reviewItemId: "item",
    eventIds: ["event"],
    finalCueIds: ["cue-a", "cue-b"],
    itemTypes: ["TEXT_HALLUCINATION_RISK"],
    sourceInterval: { start: 4, end: 28 },
    coreInterval: { start: 7, end: 8 },
    currentText: "synthetic text",
    candidateIds: [],
    evidenceIds: [],
    reviewReasons: ["WHISPER_HALLUCINATION_SIGNAL"],
    priorityTier: "CRITICAL",
    priorityScore: 90,
    requiredLevel: "REQUIRED",
    suggestedActions: ["UNRESOLVED"],
    sceneIds: [],
    speakerGroupIds: [],
    semanticHash: "f".repeat(64),
    ...extra,
  };
}

describe("C6.0.1.14 frozen policy and exact source identity", () => {
  it("locks generic coverage, duration, probe and audio policies", () => {
    expect(policy.coverageThresholds).toEqual([0.5, 0.8, 0.95]);
    expect(
      policy.probes.maxTargets * 2 + policy.probes.maxContextTargets * 2,
    ).toBe(64);
    expect(() =>
      assertC60114Policy({ ...policy, exactGuardSeconds: 0.1 } as never),
    ).toThrow();
  });
  it("requires the original audio stream and rational timebase", () => {
    expect(
      c60114SourceIdentitySchema.safeParse({
        ...source,
        audioTimebase: "unknown",
      }).success,
    ).toBe(false);
    expect(
      c60114SourceIdentitySchema.safeParse({ ...source, sampleRate: undefined })
        .success,
    ).toBe(false);
  });
  it("computes exact half-open coverage without adding cue-count credit", () => {
    expect(
      c60114Coverage({ start: 0, end: 10 }, [
        { start: 1, end: 4 },
        { start: 2, end: 5 },
      ]),
    ).toBe(0.4);
    expect(
      c60114Subtract({ start: 0, end: 10 }, [
        { start: 2, end: 4 },
        { start: 7, end: 9 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 7 },
      { start: 9, end: 10 },
    ]);
  });
});
describe("C6.0.1.14 source-global evidence and child islands", () => {
  it("does not turn a wide parent envelope into evidence", () => {
    const a = islands([]);
    expect(a.islands).toEqual([]);
    expect(a.summary.unresolvedParentCount).toBe(1);
    expect(a.summary.parentGapSpeechEvidenceCount).toBe(0);
  });
  it("clips children and preserves distinct speech islands", () => {
    const a = islands(
      [evidence("a", 2, 4), evidence("b", 8, 10)],
      [parent(3, 9)],
    );
    expect(a.islands.map((i) => i.sourceInterval)).toEqual([
      { start: 3, end: 4 },
      { start: 8, end: 9 },
    ]);
    expect(a.globalIslands.map((i) => i.sourceInterval)).toEqual([
      { start: 2, end: 4 },
      { start: 8, end: 10 },
    ]);
  });
  it("splits at real silence, cue, scene and speaker boundaries", () => {
    const a = buildC60114SourceGlobalSpeechIslands({
      sourceIdentity: source,
      policy,
      parentGaps: [parent()],
      evidence: [
        evidence("speech", 2, 10),
        evidence("silence", 5, 6, { family: "SILENCE", speechPositive: false }),
      ],
      finalCues: [{ id: "cue", start: 3, end: 4 }],
      boundaries: [
        {
          boundaryId: "scene",
          at: 7,
          kind: "SCENE",
          sourceIdentity: source,
          verified: true,
        },
        {
          boundaryId: "speaker",
          at: 8,
          kind: "SPEAKER",
          sourceIdentity: source,
          verified: true,
        },
      ],
    });
    expect(a.globalIslands.map((i) => i.sourceInterval)).toEqual([
      { start: 2, end: 3 },
      { start: 3, end: 4 },
      { start: 4, end: 5 },
      { start: 6, end: 7 },
      { start: 7, end: 8 },
      { start: 8, end: 10 },
    ]);
  });
  it("preserves too short and too long spans as unresolved without equal-time splits", () => {
    const a = islands([evidence("short", 1, 1.1), evidence("long", 20, 35)]);
    expect(a.islands.map((i) => i.durationStatus)).toEqual([
      "TOO_SHORT",
      "TOO_LONG",
    ]);
    expect(a.islands.every((i) => i.localizationStatus === "UNRESOLVED")).toBe(
      true,
    );
  });
  it("deduplicates correlated VAD/segment/token derivatives transitively", () => {
    const rows = [
      evidence("vad", 2, 4, {
        rootLineageIds: ["request"],
        providerFamily: "vad",
      }),
      evidence("token", 2, 4, {
        rootLineageIds: ["request"],
        providerFamily: "whisper",
        family: "TRUSTED_MAPPED_TOKEN",
        lexicalPositive: true,
      }),
      evidence("segment", 2, 4, {
        rootLineageIds: ["another-request"],
        providerFamily: "whisper",
        family: "DECODED_SEGMENT",
      }),
    ];
    expect(c60114IndependentGroups(rows)).toHaveLength(1);
    expect(islands(rows).islands[0]?.independentSourceCount).toBe(1);
  });
  it("is input-order invariant and rejects conflicting evidence identity", () => {
    const rows = [evidence("a", 1, 2), evidence("b", 4, 5)];
    expect(islands(rows).semanticHash).toBe(
      islands([...rows].reverse()).semanticHash,
    );
    expect(() => islands([evidence("a", 1, 2), evidence("a", 7, 8)])).toThrow(
      "CONFLICTING_EVIDENCE_ID",
    );
  });
  it("quarantines coordinate-only legacy rows even with a source binding", () => {
    const canonicalSegments = {
      rawSegments: [
        { id: "raw", start: 2, end: 4, text: "synthetic raw text" },
      ],
    };
    const adapted = adaptC60114MachineEvidence({
      sourceIdentity: source,
      artifacts: { canonicalSegments },
      bindings: {
        canonicalSegments: {
          sourceIdentity: source,
          artifactSemanticHash: machineQualitySemanticHash(canonicalSegments),
          coordinateSystem: "SOURCE_GLOBAL_SECONDS",
          verified: true,
          verificationEvidenceIds: ["artifact-hash", "source-audio-selection"],
        },
      },
    });
    expect(adapted.evidence).toHaveLength(1);
    expect(adapted.evidence[0]).toMatchObject({
      mappingStatus: "QUARANTINED",
      speechPositive: false,
      lexicalPositive: false,
    });
  });
  it("rejects stale source stream bindings", () => {
    const acousticScenes = { scenes: [] };
    expect(() =>
      adaptC60114MachineEvidence({
        sourceIdentity: source,
        artifacts: { acousticScenes },
        bindings: {
          acousticScenes: {
            sourceIdentity: { ...source, audioStreamIndex: 2 },
            artifactSemanticHash: machineQualitySemanticHash(acousticScenes),
            coordinateSystem: "SOURCE_GLOBAL_SECONDS",
            verified: true,
            verificationEvidenceIds: ["proof"],
          },
        },
      }),
    ).toThrow("SOURCE_IDENTITY_MISMATCH");
  });
  it("maps authenticated 16k sample VAD to source-global seconds for a 48k original", () => {
    const transform = createSampleTransform({
      transformId: "transform",
      parentArtifactId: "source",
      parentArtifactSha256: source.sourceMediaSha256,
      childArtifactId: "clip",
      childArtifactSha256: "c".repeat(64),
      parentSampleRate: 16000,
      childSampleRate: 16000,
      parentTotalSamples: source.durationSeconds * 16000,
      childTotalSamples: 32000,
      childStartSampleInParent: 32000,
      childEndSampleInParent: 64000,
      extractionMethod: "direct-source-ffmpeg-sample-trim",
      ffmpeg: {
        inputSeekPlacement: "none",
        inputSeekSample: 0,
        outputTrimStartSample: 32000,
        outputDurationSamples: 32000,
        atrimUsed: true,
        asetptsReset: true,
        resampleUsed: false,
        paddingSamples: 0,
        commandIdentity: "d".repeat(64),
      },
      resamplingIdentity: "e".repeat(64),
      verificationReasons: ["SYNTHETIC_SAMPLE_TRANSFORM"],
    });
    const vadTimebase = buildVadGlobalTimebase({
      mode: "observe",
      sourceIdentity: {
        sourceMediaSha256: source.sourceMediaSha256,
        sourceSampleRate: 16000,
        sourceTotalSamples: source.durationSeconds * 16000,
        sourceReadOnlyVerified: true,
      },
      vadProviderIdentity: {
        provider: "whisper.cpp-silero-vad",
        whisperVersion: "synthetic",
        whisperBinarySha256: "b".repeat(64),
        vadModelSha256: "d".repeat(64),
        capabilityHash: "e".repeat(64),
        mappedGetterUsed: true,
        rawVadGetterUsed: true,
        requestStateIsolation: "synthetic",
      },
      legacyQuarantinedRequestIds: [],
      requests: [
        {
          requestId: "request",
          extractedAudioId: "clip",
          extractedAudioSha256: "c".repeat(64),
          sourceClipTransform: transform,
          cacheIdentity: "e".repeat(64),
          providerSegments: [
            {
              index: 0,
              startCentiseconds: 25,
              endCentiseconds: 125,
              coordinateSystem: "original-audio-local",
            },
          ],
          mappedGetterUsed: true,
          rawVadGetterUsed: true,
          emptyResponse: false,
          mappingVerified: true,
          failureReasons: [],
        },
      ],
    });
    const binding = {
      sourceIdentity: source,
      artifactSemanticHash: machineQualitySemanticHash(vadTimebase),
      coordinateSystem: "SOURCE_GLOBAL_SECONDS" as const,
      verified: true,
      verificationEvidenceIds: [
        "source-audio-selection",
        "resampled-timeline-proof",
      ],
    };
    const result = adaptC60114MachineEvidence({
      sourceIdentity: source,
      artifacts: { vadTimebase },
      bindings: { vadTimebase: binding },
    });
    expect(result.evidence[0]).toMatchObject({
      mappingStatus: "VERIFIED",
      sourceInterval: { start: 2.25, end: 3.25 },
    });
    const missingBinding = adaptC60114MachineEvidence({
      sourceIdentity: source,
      artifacts: { vadTimebase },
    });
    expect(missingBinding.evidence[0]?.mappingStatus).toBe("QUARANTINED");
    const tampered = structuredClone(vadTimebase);
    const firstSegment = tampered.vadSegments[0];
    if (firstSegment === undefined)
      throw new Error("SYNTHETIC_SEGMENT_REQUIRED");
    firstSegment.sourceGlobalStartSample += 100;
    const tamperResult = adaptC60114MachineEvidence({
      sourceIdentity: source,
      artifacts: { vadTimebase: tampered },
      bindings: {
        vadTimebase: {
          ...binding,
          artifactSemanticHash: machineQualitySemanticHash(tampered),
        },
      },
    });
    expect(tamperResult.evidence[0]?.mappingStatus).toBe("QUARANTINED");
    const requestTimeline = buildRequestTimelineV2({
      sourceMediaSha256: source.sourceMediaSha256,
      vadGlobalTimebaseSemanticHash: vadTimebase.semanticHash,
      requests: [
        createRequestTimelineV2Entry({
          requestId: "request",
          legacyRequestId: null,
          sourceMediaSha256: source.sourceMediaSha256,
          sourceClipTransform: transform,
          parentChain: ["clip", "source"],
          extractedAudioSha256: "c".repeat(64),
          extractedSampleRate: 16000,
          extractedSampleCount: 32000,
          tokenTimeBase: "mapped-original-audio-local",
          mappingStatus: "VERIFIED",
          mappingReason: "SYNTHETIC_MAPPING",
          cacheIdentity: "e".repeat(64),
          cacheEntrySha256: "b".repeat(64),
          modelIdentity: "d".repeat(64),
          vadEnabled: true,
          promptPresent: false,
          freshEvidence: true,
        }),
      ],
    });
    const tokenTimeline = buildGlobalTokenTimelineV2({
      requestTimeline,
      observations: [
        {
          tokenId: "token",
          requestId: "request",
          cueId: "candidate",
          text: "synthetic",
          probability: 0.9,
          localStartCentiseconds: 25,
          localEndCentiseconds: 125,
          coordinateSystem: "mapped-original-audio-local",
          associationStatus: "assigned",
          cacheIdentity: "e".repeat(64),
          freshEvidence: true,
        },
      ],
    });
    const candidateEvidence = {
      candidates: [
        {
          cueId: "candidate",
          interval: { start: 1, end: 19 },
          text: "synthetic candidate phrase",
          sourceRequestIds: ["historical-request"],
          hardBlockReasons: [],
          hallucinationRisk: 0.1,
        },
      ],
    };
    const artifacts = {
      vadTimebase,
      requestTimeline,
      tokenTimeline,
      candidateEvidence,
    };
    const bindings = Object.fromEntries(
      Object.entries(artifacts).map(([key, value]) => [
        key,
        { ...binding, artifactSemanticHash: machineQualitySemanticHash(value) },
      ]),
    );
    const localized = adaptC60114MachineEvidence({
      sourceIdentity: source,
      artifacts,
      bindings,
    });
    expect(localized.candidateLocalizations).toHaveLength(1);
    expect(localized.candidateLocalizations[0]?.sourceInterval).toEqual({
      start: 2.25,
      end: 3.25,
    });
    expect(
      localized.evidence
        .filter((e) => e.family === "CANDIDATE_PROVENANCE")
        .map((e) => e.mappingStatus)
        .toSorted(),
    ).toEqual(["QUARANTINED", "VERIFIED"]);
    expect(c60114IndependentGroups(localized.evidence)).toHaveLength(1);
    const pendingTimeline = buildGlobalTokenTimelineV2({
      requestTimeline,
      observations: [
        {
          tokenId: "pending",
          requestId: "request",
          cueId: null,
          text: "声",
          probability: 0.95,
          localStartCentiseconds: 25,
          localEndCentiseconds: 125,
          coordinateSystem: "mapped-original-audio-local",
          associationStatus: "pending",
          cacheIdentity: "e".repeat(64),
          freshEvidence: true,
        },
      ],
    });
    const pendingArtifacts = { ...artifacts, tokenTimeline: pendingTimeline };
    const pending = adaptC60114MachineEvidence({
      sourceIdentity: source,
      artifacts: pendingArtifacts,
      bindings: {
        ...bindings,
        tokenTimeline: {
          ...binding,
          artifactSemanticHash: machineQualitySemanticHash(pendingTimeline),
        },
      },
    });
    const before = JSON.stringify(pending);
    const reconciled = reconcileC60114SourceGlobalLineage({
      sourceIdentity: source,
      policy,
      evidence: pending.evidence,
      artifacts: pendingArtifacts,
      sourceAudioBindingVerified: true,
    });
    expect(reconciled.artifact.summary.newlyVerifiedCount).toBe(1);
    expect(
      reconciled.artifact.entries.find(
        (row) => row.status === "VERIFIED_FROM_PARENT_SAMPLE_CHAIN",
      ),
    ).toMatchObject({
      recomputedSourceInterval: { start: 2.25, end: 3.25 },
      driftSeconds: 0,
      eligibleForSpeechIsland: true,
      eligibleForLexicalLocalization: false,
    });
    expect(JSON.stringify(pending)).toBe(before);
    const unbound = reconcileC60114SourceGlobalLineage({
      sourceIdentity: source,
      policy,
      evidence: pending.evidence,
      artifacts: pendingArtifacts,
      sourceAudioBindingVerified: false,
    });
    expect(unbound.artifact.summary.newlyVerifiedCount).toBe(0);
    const foreignCandidate = {
      candidates: [
        { ...candidateEvidence.candidates[0], text: "unrelated words" },
      ],
    };
    const unrelated = adaptC60114MachineEvidence({
      sourceIdentity: source,
      artifacts: { ...artifacts, candidateEvidence: foreignCandidate },
      bindings: {
        ...bindings,
        candidateEvidence: {
          ...binding,
          artifactSemanticHash: machineQualitySemanticHash(foreignCandidate),
        },
      },
    });
    expect(unrelated.candidateLocalizations).toHaveLength(0);
  });
});
describe("C6.0.1.14 targets, orphan sweep and probe selection", () => {
  it("uses full disjoint current cue intervals for hallucination targets", () => {
    const current = item();
    const cues = [
      { id: "cue-a", start: 4, end: 11 },
      { id: "cue-b", start: 23, end: 28 },
    ];
    const before = JSON.stringify({ current, cues });
    const a = buildC60114ReviewTargetIntervalsV2({
      sourceIdentity: source,
      policy,
      items: [current],
      finalCues: cues,
    });
    expect(a.targets.map((t) => t.sourceInterval)).toEqual([
      { start: 4, end: 11 },
      { start: 23, end: 28 },
    ]);
    expect(
      a.targets.every(
        (t) =>
          t.targetType === "CURRENT_CUE_HALLUCINATION_TARGET" &&
          t.mandatoryForAudio,
      ),
    ).toBe(true);
    expect(a.summary.disjointItemCount).toBe(1);
    expect(JSON.stringify({ current, cues })).toBe(before);
    expect(c60114ReviewTargetsSchema.safeParse(a).success).toBe(true);
  });
  it("does not fall back to a missing item's core when no actual evidence exists", () => {
    const a = buildC60114ReviewTargetIntervalsV2({
      sourceIdentity: source,
      policy,
      items: [item({ itemTypes: ["MISSING_SPEECH_RISK"], finalCueIds: [] })],
      finalCues: [],
    });
    expect(a.targets).toHaveLength(0);
    expect(a.unresolvedItems).toHaveLength(1);
    expect(a.summary.coreFallbackCount).toBe(0);
  });
  it("finds an orphan outside all parent gaps and subtracts exact coverage", () => {
    const speechIslands = islands([evidence("speech", 50, 58)]);
    const reviewTargets = buildC60114ReviewTargetIntervalsV2({
      sourceIdentity: source,
      policy,
      items: [item({ finalCueIds: ["target"] })],
      finalCues: [{ id: "target", start: 54, end: 56 }],
    });
    const sweep = buildC60114OrphanSpeechSweep({
      sourceIdentity: source,
      policy,
      speechIslands,
      finalCues: [{ id: "final", start: 50, end: 52 }],
      reviewTargets,
    });
    expect(
      sweep.entries.map((e) => [e.sourceInterval, e.classification]),
    ).toEqual([
      [{ start: 50, end: 52 }, "COVERED_BY_CUE"],
      [{ start: 52, end: 54 }, "ORPHAN_SPEECH_OBSERVED"],
      [{ start: 54, end: 56 }, "COVERED_BY_TARGET"],
      [{ start: 56, end: 58 }, "ORPHAN_SPEECH_OBSERVED"],
    ]);
  });
  it("does not turn covered or quarantined sweep audit rows into machine orphan missing assertions", () => {
    const speechIslands = islands(
      [
        evidence("covered", 50, 52),
        evidence("orphan", 60, 62),
        evidence("unverified", 70, 72, {
          mappingStatus: "QUARANTINED",
          sourceIdentityHash: null,
        }),
      ],
      [],
    );
    const sweep = buildC60114OrphanSpeechSweep({
      sourceIdentity: source,
      policy,
      speechIslands,
      finalCues: [{ id: "covered-cue", start: 50, end: 52 }],
      reviewTargets: emptyTargets(),
    });
    const lexical = c60114LocalizedLexicalEvidenceSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "localized-missing-lexical-evidence",
      policyVersion: policy.policyVersion,
      sourceIdentityHash: machineQualitySemanticHash(source),
      sourceIdentity: source,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      policyHash: policy.semanticHash,
      probeSemanticHash: "a".repeat(64),
      readingMechanism: {
        status: "UNAVAILABLE",
        runtimeIdentityHash: null,
        reason: "SYNTHETIC_NO_READING_RUNTIME",
      },
      targets: [],
      semanticHash: "b".repeat(64),
    });
    const missing = buildMissingSpeechEvidenceV3({
      sourceIdentity: source,
      policyHash: policy.semanticHash,
      targets: [],
      lexicalEvidence: lexical,
      speechIslands,
      orphanSweep: sweep,
    });
    expect(
      missing.targets
        .filter((row) => row.classification === "MACHINE_DETECTION_ORPHAN")
        .map((row) => row.sourceInterval),
    ).toEqual([{ start: 60, end: 62 }]);
    expect(
      missing.targets.some(
        (row) =>
          row.sourceInterval.start === 50 || row.sourceInterval.start === 70,
      ),
    ).toBe(false);
    expect(
      sweep.entries.some((row) => row.classification === "UNVERIFIED"),
    ).toBe(true);
  });
  it("retains unverified and contradicted observations but never probes them", () => {
    const speechIslands = islands([
      evidence("speech", 2, 4),
      evidence("non-speech", 2, 4, {
        family: "ACOUSTIC_SCENE",
        speechPositive: false,
        contradiction: true,
        providerFamily: "scene",
      }),
      evidence("unmapped", 10, 12, {
        mappingStatus: "QUARANTINED",
        sourceIdentityHash: null,
      }),
    ]);
    const sweep = buildC60114OrphanSpeechSweep({
      sourceIdentity: source,
      policy,
      speechIslands,
      finalCues: [],
      reviewTargets: emptyTargets(),
    });
    expect(sweep.entries.map((e) => e.classification)).toContain(
      "NON_SPEECH_CONTRADICTED",
    );
    expect(sweep.entries.map((e) => e.classification)).toContain("UNVERIFIED");
    expect(
      selectC60114MissingDialogueProbes({
        sourceIdentity: source,
        policy,
        speechIslands,
        orphanSweep: sweep,
        finalCues: [],
      }).targets,
    ).toHaveLength(0);
  });
  it("prioritizes localized multi-source orphans ahead of activity-only islands", () => {
    const speechIslands = islands([
      evidence("ordinary", 2, 3),
      evidence("lexical", 70, 72, {
        family: "TRUSTED_MAPPED_TOKEN",
        lexicalPositive: true,
        providerFamily: "whisper",
      }),
      evidence("independent", 70, 72, { providerFamily: "independent-vad" }),
    ]);
    const sweep = buildC60114OrphanSpeechSweep({
      sourceIdentity: source,
      policy,
      speechIslands,
      finalCues: [],
      reviewTargets: emptyTargets(),
    });
    const selected = selectC60114MissingDialogueProbes({
      sourceIdentity: source,
      policy,
      speechIslands,
      orphanSweep: sweep,
      finalCues: [],
    });
    expect(selected.targets[0]?.priorityClass).toBe("ORPHAN_MULTI_SOURCE");
    expect(selected.targets[0]?.sourceInterval).toEqual({ start: 70, end: 72 });
    expect(selected.targets).toHaveLength(2);
  });
  it("enforces 24 core targets plus an eight-target context reserve deterministically", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      evidence(`speech-${i}`, i * 4 + 1, i * 4 + 2),
    );
    const speechIslands = islands(rows, []);
    const sweep = buildC60114OrphanSpeechSweep({
      sourceIdentity: source,
      policy,
      speechIslands,
      finalCues: [],
      reviewTargets: emptyTargets(),
    });
    const a = selectC60114MissingDialogueProbes({
      sourceIdentity: source,
      policy,
      speechIslands,
      orphanSweep: sweep,
      finalCues: [],
    });
    const b = selectC60114MissingDialogueProbes({
      sourceIdentity: source,
      policy,
      speechIslands,
      orphanSweep: { ...sweep, entries: [...sweep.entries].reverse() },
      finalCues: [],
    });
    expect(a.semanticHash).toBe(b.semanticHash);
    expect(a.targets).toHaveLength(24);
    expect(
      a.budget.selectedCoreRequestCount + a.budget.reservedContextRequestCount,
    ).toBe(64);
    expect(a.decisions.filter((d) => !d.selected)).toHaveLength(6);
  });
  it("does not probe already reliable localized lexical evidence", () => {
    const speechIslands = islands([
      evidence("trusted", 2, 4, {
        lexicalPositive: true,
        reliableLocalizedLexical: true,
      }),
    ]);
    const sweep = buildC60114OrphanSpeechSweep({
      sourceIdentity: source,
      policy,
      speechIslands,
      finalCues: [],
      reviewTargets: emptyTargets(),
    });
    const a = selectC60114MissingDialogueProbes({
      sourceIdentity: source,
      policy,
      speechIslands,
      orphanSweep: sweep,
      finalCues: [],
    });
    expect(a.targets).toHaveLength(0);
    expect(
      a.decisions.every((d) =>
        d.reasons.includes(
          "RELIABLE_LOCALIZED_LEXICAL_EVIDENCE_ALREADY_AVAILABLE",
        ),
      ),
    ).toBe(true);
  });
});
