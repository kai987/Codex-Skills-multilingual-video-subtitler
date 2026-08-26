import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type ReviewBoundaryEvidence,
  type SpeakerEvidenceCacheIdentity,
  type SubtitleReviewPackage,
} from "@mvl/shared";
import {
  SPEAKER_CUE_ASSIGNMENT_POLICY,
  SPEAKER_NORMALIZATION_POLICY,
  SPEAKER_OVERLAP_POLICY,
  SPEAKER_PROMINENCE_POLICY,
  SPEAKER_RELATIONSHIP_POLICY,
  SPEAKER_WINDOW_MAPPING_POLICY,
  SpeakerEvidenceCache,
  analyzeLocalSpeakerEvidence,
  buildSpeakerEvidenceCacheKey,
  speakerEvidenceSemanticHash,
  speakerModelSnapshotIdentity,
  speakerRuntimeIdentity,
  type RawSpeakerAttemptInput,
  type RawSpeakerInference,
  type SpeakerPcmWindow,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const RUNTIME_HASH = "b".repeat(64);
const MODEL_HASH = "c".repeat(64);
const COMPONENT_ID = "overlap-component-a";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function lexicalEvidence(
  cueId: string,
  side: "start" | "end",
  interval: { start: number; end: number },
  overrides: Partial<ReviewBoundaryEvidence> = {},
): ReviewBoundaryEvidence {
  return {
    evidenceId: `mfa-${cueId}-${side}`,
    evidenceLineageId: `mfa-lineage-${cueId}-${side}`,
    sourceType: "mfa-narrow",
    scope: "cue",
    cueIds: [cueId],
    componentId: COMPONENT_ID,
    interval,
    sideSupport: side,
    timingUsable: true,
    acousticEvidence: true,
    trustScore: 1,
    alignmentScore: 1,
    boundaryConfidence: 1,
    neighborIntrusionRatio: 0,
    profile: null,
    attemptId: `mfa-attempt-${cueId}`,
    parentSegmentId: null,
    selectedBoundarySource: "lexical-word-tier",
    windowType: "narrow",
    wordInterval: interval,
    phoneInterval: interval,
    startPinnedToWindowEdge: false,
    endPinnedToWindowEdge: false,
    wordCoverageRatio: 1,
    phoneCoverageRatio: 1,
    readingCoverageRatio: 1,
    rawInterval: interval,
    normalizedInterval: interval,
    healthStatus: "healthy",
    normalizationApplied: false,
    normalizationDeltaStart: 0,
    normalizationDeltaEnd: 0,
    sourceArtifactType: "subtitle-canonical-forced-alignment",
    sourceArtifactHash: HASH,
    sourceObjectId: `mfa-object-${cueId}`,
    blockers: [],
    notes: [],
    ...overrides,
  };
}

function reviewPackage(
  input: {
    antiForcingBlocked?: boolean;
    evidenceBlocked?: boolean;
    overlappingAssignments?: boolean;
    ambiguousAssignments?: boolean;
    assignmentSource?: "forced" | "evidence-dp" | "source-cue-prior";
  } = {},
): SubtitleReviewPackage {
  const forcedCue = (
    cueId: string,
    originalTiming: { start: number; end: number },
    suggestedTiming: { start: number; end: number },
  ) => ({
    cueId,
    canonicalText: cueId === "cue-a" ? "もしもし" : "はい",
    alignmentText: cueId === "cue-a" ? "もしもし" : "はい",
    normalizedReading: cueId === "cue-a" ? "もしもし" : "はい",
    unresolvedOov: [],
    originalTiming,
    suggestedTiming:
      input.assignmentSource === "forced" ||
      input.assignmentSource === undefined
        ? suggestedTiming
        : null,
    mfaNarrowBoundary:
      input.assignmentSource === "source-cue-prior" ? null : suggestedTiming,
    mfaExpandedBoundary: suggestedTiming,
    evidenceDpBoundary:
      input.assignmentSource === "source-cue-prior" ? null : suggestedTiming,
    mappedTokenBoundary: suggestedTiming,
    rawVadBoundary: suggestedTiming,
    windowStabilityScore: input.antiForcingBlocked ? 0.2 : 1,
    wordCoverageRatio: 1,
    phoneCoverageRatio: 1,
    readingCoverageRatio: 1,
    antiForcingBlockers:
      input.antiForcingBlocked || input.assignmentSource === "evidence-dp"
        ? ["ALIGNMENT_WINDOW_UNSTABLE"]
        : [],
  });
  const left = lexicalEvidence(
    "cue-a",
    "end",
    { start: 10, end: 12.02 },
    input.evidenceBlocked
      ? { blockers: ["NEIGHBOR_INTRUSION"], neighborIntrusionRatio: 0.4 }
      : {},
  );
  const right = lexicalEvidence(
    "cue-b",
    "start",
    { start: 11.98, end: 14 },
    input.evidenceBlocked ? { blockers: ["LOW_ALIGNMENT_CONFIDENCE"] } : {},
  );
  const sourcePrior = (
    cueId: string,
    interval: { start: number; end: number },
  ) =>
    lexicalEvidence(cueId, "end", interval, {
      evidenceId: `source-${cueId}`,
      evidenceLineageId: `source-lineage-${cueId}`,
      sourceType: "source-cue-prior",
      acousticEvidence: false,
      sideSupport: "both",
      attemptId: null,
      sourceArtifactType: "subtitle-package",
      sourceObjectId: cueId,
    });
  const evidenceDp = (
    cueId: string,
    interval: { start: number; end: number },
  ) =>
    lexicalEvidence(cueId, "end", interval, {
      evidenceId: `dp-${cueId}`,
      evidenceLineageId: `dp-lineage-${cueId}`,
      sourceType: "evidence-dp",
      sideSupport: "both",
      attemptId: "evidence-dp-attempt",
    });
  const leftAssignment = input.ambiguousAssignments
    ? { start: 10, end: 14 }
    : input.overlappingAssignments
      ? { start: 10, end: 12.2 }
      : { start: 10, end: 12 };
  const rightAssignment = input.ambiguousAssignments
    ? { start: 10, end: 14 }
    : input.overlappingAssignments
      ? { start: 11.8, end: 14 }
      : { start: 12, end: 14 };
  return {
    sourceFingerprint: {
      fileName: "fixture.mkv",
      size: 123,
      durationSeconds: 30,
      sha256: HASH,
    },
    baseCueHash: HASH,
    items: [
      {
        reviewId: "review-a",
        targetCueIds: ["cue-a", "cue-b"],
        interval: { start: 10, end: 14 },
        componentUnionInterval: { start: 10, end: 14 },
        currentStart: 10,
        currentEnd: 14,
        previousCue: { cueId: "previous", text: "前", start: 8, end: 9.8 },
        nextCue: { cueId: "next", text: "後", start: 14.2, end: 15 },
        audioSourceComponentId: COMPONENT_ID,
        speakerEvidenceComponentId: COMPONENT_ID,
        boundaryEvidence: [
          left,
          right,
          sourcePrior("cue-a", { start: 10, end: 12.2 }),
          sourcePrior("cue-b", { start: 11.8, end: 14 }),
          ...(input.assignmentSource === "evidence-dp"
            ? [
                evidenceDp("cue-a", leftAssignment),
                evidenceDp("cue-b", rightAssignment),
              ]
            : []),
        ],
        forcedAlignmentEvidence: {
          componentId: COMPONENT_ID,
          cues: [
            forcedCue("cue-a", { start: 10, end: 12.2 }, leftAssignment),
            forcedCue("cue-b", { start: 11.8, end: 14 }, rightAssignment),
          ],
        },
      },
    ],
  } as unknown as SubtitleReviewPackage;
}

type TrackKind =
  | "ordered"
  | "single"
  | "overlap"
  | "nested"
  | "three"
  | "change-unstable"
  | "disagreement";

function inference(
  kind: TrackKind,
  windowType: "context" | "union",
  renamed: boolean,
): RawSpeakerInference {
  const context = windowType === "context";
  const first = renamed ? (context ? "Alice" : "person-z") : "raw-a";
  const second = renamed ? (context ? "Bob" : "person-y") : "raw-b";
  const third = renamed ? (context ? "Carol" : "person-x") : "raw-c";
  const shift = context ? 1 : 0;
  const standardTurns =
    kind === "single"
      ? [{ speaker: first, start: shift, end: shift + 4 }]
      : kind === "disagreement" && !context
        ? [{ speaker: first, start: 0, end: 4 }]
        : kind === "overlap"
          ? [
              { speaker: first, start: shift, end: shift + 3 },
              { speaker: second, start: shift + 1, end: shift + 4 },
            ]
          : kind === "nested"
            ? [
                { speaker: first, start: shift, end: shift + 4 },
                { speaker: second, start: shift + 1.5, end: shift + 2.5 },
              ]
            : kind === "three"
              ? [
                  { speaker: first, start: shift, end: shift + 1.3 },
                  { speaker: second, start: shift + 1.3, end: shift + 2.7 },
                  { speaker: third, start: shift + 2.7, end: shift + 4 },
                ]
              : [
                  { speaker: first, start: shift, end: shift + 2 },
                  {
                    speaker: second,
                    start:
                      kind === "change-unstable" && !context
                        ? shift + 2.8
                        : shift + 2,
                    end: shift + 4,
                  },
                ];
  const exclusiveTurns =
    kind === "single" || (kind === "disagreement" && !context)
      ? [{ speaker: first, start: shift, end: shift + 4 }]
      : kind === "three"
        ? [
            { speaker: first, start: shift, end: shift + 1.3 },
            { speaker: second, start: shift + 1.3, end: shift + 2.7 },
            { speaker: third, start: shift + 2.7, end: shift + 4 },
          ]
        : [
            { speaker: first, start: shift, end: shift + 2 },
            {
              speaker: second,
              start:
                kind === "change-unstable" && !context
                  ? shift + 2.8
                  : shift + 2,
              end: shift + 4,
            },
          ];
  return {
    standardTurns,
    exclusiveTurns,
    wallClockSeconds: 3.5,
    confidenceStatus: "unavailable",
    warnings: [],
  };
}

function rawAttempts(
  input: {
    kind?: TrackKind;
    renamed?: boolean;
    cacheHit?: boolean;
  } = {},
): RawSpeakerAttemptInput[] {
  const kind = input.kind ?? "ordered";
  return (["context", "union"] as const).map((windowType) => ({
    componentId: COMPONENT_ID,
    windowType,
    audioPath: `./audio/review/${windowType}.wav`,
    audioSha256: windowType === "context" ? HASH : hash("union-audio"),
    audioLocalInterval:
      windowType === "context" ? { start: 0, end: 6 } : { start: 1, end: 5 },
    mediaGlobalInterval:
      windowType === "context" ? { start: 9, end: 15 } : { start: 10, end: 14 },
    runtimeIdentityHash: RUNTIME_HASH,
    modelSnapshotHash: MODEL_HASH,
    device: "cpu",
    minSpeakers: 1,
    maxSpeakers: 3,
    cacheHit: input.cacheHit ?? false,
    inference: inference(kind, windowType, input.renamed ?? false),
  }));
}

function pcm(loudFirst: boolean): SpeakerPcmWindow {
  const samples = new Int16Array(6 * 16_000);
  for (let index = 0; index < samples.length; index += 1) {
    const second = index / 16_000;
    const firstSpeaker = second >= 1 && second < 3;
    const secondSpeaker = second >= 3 && second < 5;
    if (!firstSpeaker && !secondSpeaker) continue;
    const loud = firstSpeaker === loudFirst;
    samples[index] = loud ? 12_000 : 1_200;
  }
  return { samples, sampleRate: 16_000, mediaStart: 9 };
}

function analyze(
  input: {
    mode?: "observe" | "enforce";
    kind?: TrackKind;
    renamed?: boolean;
    cacheHit?: boolean;
    antiForcingBlocked?: boolean;
    evidenceBlocked?: boolean;
    overlappingAssignments?: boolean;
    ambiguousAssignments?: boolean;
    assignmentSource?: "forced" | "evidence-dp" | "source-cue-prior";
    pcm?: SpeakerPcmWindow;
  } = {},
) {
  return analyzeLocalSpeakerEvidence({
    mode: input.mode ?? "enforce",
    reviewPackage: reviewPackage({
      antiForcingBlocked: input.antiForcingBlocked,
      evidenceBlocked: input.evidenceBlocked,
      overlappingAssignments: input.overlappingAssignments,
      ambiguousAssignments: input.ambiguousAssignments,
      assignmentSource: input.assignmentSource,
    }),
    baseTimingHash: hash("base-timing"),
    runtimeCapabilityRef: { path: "./speaker-capability.json", sha256: HASH },
    reviewPackageRef: { path: "./review-package.json", sha256: HASH },
    forcedAlignmentRef: { path: "./forced.json", sha256: HASH },
    overlapAcousticRef: { path: "./overlap.json", sha256: HASH },
    rawAttempts: rawAttempts(input),
    ...(input.pcm === undefined
      ? {}
      : { pcmByComponent: new Map([[COMPONENT_ID, input.pcm]]) }),
    pipelineInferenceCount: input.cacheHit ? 0 : 2,
    modelLoadCount: input.cacheHit ? 0 : 1,
    deviceRequested: "auto",
    minimumSpeakers: 1,
    maximumSpeakers: 3,
  });
}

function cacheIdentity(index: number): SpeakerEvidenceCacheIdentity {
  return {
    requestType: "local-speaker-evidence",
    audioSha256: hash(`audio-${index}`),
    windowType: index % 2 === 0 ? "context" : "union",
    audioLocalInterval: { start: index / 100, end: 4 + index / 100 },
    mediaGlobalInterval: { start: 10 + index, end: 14 + index },
    runtimeIdentityHash: RUNTIME_HASH,
    pyannoteAudioVersion: "4.0.7",
    torchVersion: "2.11.0",
    torchaudioVersion: "2.11.0",
    modelRepo: "pyannote/speaker-diarization-community-1",
    modelRevision: "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee",
    modelSnapshotHash: MODEL_HASH,
    dependencyModelHashes: [hash("segmentation"), hash("embedding")],
    device: "cpu",
    minSpeakers: 1,
    maxSpeakers: 3,
    speakerNormalizationPolicy: SPEAKER_NORMALIZATION_POLICY,
    windowMappingPolicy: SPEAKER_WINDOW_MAPPING_POLICY,
    overlapPolicy: SPEAKER_OVERLAP_POLICY,
    prominencePolicy: SPEAKER_PROMINENCE_POLICY,
    cueAssignmentPolicy: SPEAKER_CUE_ASSIGNMENT_POLICY,
    relationshipPolicy: SPEAKER_RELATIONSHIP_POLICY,
  };
}

describe("C5.18 local speaker evidence", () => {
  it("normalizes labels anonymously and remains invariant to raw label permutations", () => {
    const ordinary = analyze();
    const renamed = analyze({ renamed: true });
    expect(renamed.componentDecisionHash).toBe(ordinary.componentDecisionHash);
    expect(renamed.semanticHash).toBe(ordinary.semanticHash);
    expect(JSON.stringify(renamed)).not.toMatch(/Alice|Bob|person-[yz]/u);
    expect(
      renamed.attempts.flatMap((attempt) => attempt.speakerLabels),
    ).toEqual(
      expect.arrayContaining([
        `component-${COMPONENT_ID}-speaker-01`,
        `component-${COMPONENT_ID}-speaker-02`,
      ]),
    );
    expect(renamed.summary).toMatchObject({
      crossComponentSpeakerLinkCount: 0,
      realPersonIdentificationCount: 0,
      speakerConfidenceFabricatedCount: 0,
      rawEmbeddingPersistedCount: 0,
    });
  });

  it("classifies stable standard overlap and emits presentation-only proposals", () => {
    const artifact = analyze({ kind: "overlap" });
    const component = artifact.components[0];
    expect(component?.selectedRelationship).toBe(
      "stable-multi-speaker-overlap",
    );
    expect(component?.overlapSpeechIntervals.length).toBeGreaterThan(0);
    expect(component?.resolutionStatus).toBe("presentation-only");
    expect(component?.presentationOverrides).toHaveLength(2);
    expect(component?.timingProposal.applied).toBe(false);
  });

  it("keeps same-speaker repeated activity distinct from overlap evidence", () => {
    const artifact = analyze({ kind: "single" });
    const component = artifact.components[0];
    expect(component?.selectedRelationship).toBe("single-speaker-only");
    expect(component?.overlapSpeechIntervals).toHaveLength(0);
    expect(component?.timingProposal.applied).toBe(false);
  });

  it("classifies a genuine same-speaker boundary overlap separately", () => {
    const artifact = analyze({
      kind: "single",
      overlappingAssignments: true,
    });
    expect(artifact.components[0]?.selectedRelationship).toBe(
      "same-speaker-boundary-overlap",
    );
    expect(artifact.components[0]?.timingProposal.applied).toBe(false);
  });

  it("distinguishes nested activity from co-primary simultaneous activity", () => {
    const artifact = analyze({ kind: "nested" });
    expect(artifact.components[0]?.selectedRelationship).toBe(
      "nested-multi-speaker-activity",
    );
    expect(artifact.components[0]?.resolutionStatus).toBe("presentation-only");
  });

  it("supports the explicit three-speaker ceiling with deterministic mapping", () => {
    const artifact = analyze({ kind: "three", renamed: true });
    expect(artifact.attempts.map((attempt) => attempt.speakerCount)).toEqual([
      3, 3,
    ]);
    expect(artifact.components[0]?.speakerWindowMapping).toHaveLength(3);
    expect(artifact.components[0]?.unmappedSpeakers).toHaveLength(0);
  });

  it("fails closed when context and union windows disagree", () => {
    const artifact = analyze({ kind: "disagreement" });
    const component = artifact.components[0];
    expect(component?.windowStability.stable).toBe(false);
    expect(component?.resolutionStatus).toBe("unresolved");
    expect(component?.blockers).toEqual(
      expect.arrayContaining([
        "SPEAKER_COUNT_UNSTABLE",
        "SPEAKER_MAPPING_UNSTABLE",
      ]),
    );
  });

  it("marks materially displaced dual-window change points unstable", () => {
    const artifact = analyze({ kind: "change-unstable" });
    const component = artifact.components[0];
    expect(component?.windowStability.stable).toBe(false);
    expect(component?.windowStability.blockers).toContain(
      "SPEAKER_CHANGE_POINT_UNSTABLE",
    );
    expect(component?.timingProposal.applied).toBe(false);
  });

  it("keeps ambiguous speaker assignments unresolved", () => {
    const artifact = analyze({ ambiguousAssignments: true });
    expect(
      artifact.components[0]?.cueSpeakerHypotheses.every(
        (assignment) => assignment.assignmentStatus === "ambiguous",
      ),
    ).toBe(true);
    expect(artifact.components[0]?.blockers).toContain(
      "SPEAKER_ASSIGNMENT_MARGIN_INSUFFICIENT",
    );
  });

  it("uses Forced Alignment, Evidence-DP, then source timing as bounded assignment windows", () => {
    expect(
      analyze().components[0]?.cueSpeakerHypotheses.map(
        (assignment) => assignment.assignmentWindowSource,
      ),
    ).toEqual(["forced-alignment-selected", "forced-alignment-selected"]);
    expect(
      analyze({
        assignmentSource: "evidence-dp",
      }).components[0]?.cueSpeakerHypotheses.map(
        (assignment) => assignment.assignmentWindowSource,
      ),
    ).toEqual(["evidence-dp", "evidence-dp"]);
    expect(
      analyze({
        assignmentSource: "source-cue-prior",
      }).components[0]?.cueSpeakerHypotheses.map(
        (assignment) => assignment.assignmentWindowSource,
      ),
    ).toEqual(["source-cue-prior", "source-cue-prior"]);
  });

  it("allows a bounded timing-only boundary only with lexical and speaker support", () => {
    const artifact = analyze();
    const component = artifact.components[0];
    expect(component?.selectedRelationship).toBe(
      "ordered-different-speaker-turns",
    );
    expect(component?.timingProposal).toMatchObject({
      eligible: true,
      applied: true,
      textChanged: false,
      forbiddenHeuristicUseCount: 0,
    });
    expect(component?.timingProposal.mutations).toHaveLength(2);
    expect(component?.timingProposal.mutations[0]?.after.end).toBe(12);
    expect(component?.timingProposal.mutations[1]?.after.start).toBe(12);
    expect(
      component?.timingProposal.mutations.flatMap((mutation) => [
        ...mutation.startEvidenceIds,
        ...mutation.endEvidenceIds,
      ]),
    ).toEqual(expect.arrayContaining(["mfa-lineage-cue-a-end"]));
  });

  it("rejects low-confidence or anti-forcing-incompatible timing support atomically", () => {
    for (const artifact of [
      analyze({ antiForcingBlocked: true }),
      analyze({ evidenceBlocked: true }),
      analyze({ mode: "observe" }),
    ]) {
      const proposal = artifact.components[0]?.timingProposal;
      expect(proposal?.applied).toBe(false);
      expect(proposal?.mutations).toHaveLength(0);
      expect(artifact.summary.forbiddenTimingHeuristicUseCount).toBe(0);
    }
  });

  it("uses exclusive non-overlap energy only for uncalibrated prominence, never identity", () => {
    const loudFirst = analyze({ pcm: pcm(true) });
    const loudSecond = analyze({ pcm: pcm(false) });
    expect(loudFirst.components[0]?.cueSpeakerHypotheses).toEqual(
      loudSecond.components[0]?.cueSpeakerHypotheses,
    );
    expect(loudFirst.components[0]?.selectedRelationship).toBe(
      loudSecond.components[0]?.selectedRelationship,
    );
    expect(
      loudFirst.components[0]?.prominenceEvidence.map((value) => value.status),
    ).not.toEqual(
      loudSecond.components[0]?.prominenceEvidence.map((value) => value.status),
    );
    expect(
      loudFirst.components[0]?.prominenceEvidence.map(
        (value) => value.scoreCalibrationStatus,
      ),
    ).toEqual(["uncalibrated-heuristic", "uncalibrated-heuristic"]);
  });

  it("keeps Fresh, Observe, and Cache evidence semantics stable", () => {
    const fresh = analyze();
    const observe = analyze({ mode: "observe" });
    const cache = analyze({ cacheHit: true });
    expect(speakerEvidenceSemanticHash(fresh)).toBe(fresh.semanticHash);
    expect(observe.semanticHash).toBe(fresh.semanticHash);
    expect(cache.semanticHash).toBe(fresh.semanticHash);
    expect(observe.componentDecisionHash).toBe(fresh.componentDecisionHash);
    expect(cache.componentDecisionHash).toBe(fresh.componentDecisionHash);
    expect(observe.summary.timingMutationCount).toBe(0);
    expect(cache.summary).toMatchObject({
      cacheHitCount: 2,
      pipelineInferenceCount: 0,
      modelLoadCount: 0,
    });
  });

  it("builds order-stable runtime and dependency snapshot identities", () => {
    expect(
      speakerRuntimeIdentity({
        pythonVersion: "3.13.14",
        packages: [
          { name: "torch", version: "2.11.0" },
          { name: "pyannote.audio", version: "4.0.7" },
        ],
        explicitSpecSha256: HASH,
        dependencySpecSha256: MODEL_HASH,
      }),
    ).toBe(
      speakerRuntimeIdentity({
        pythonVersion: "3.13.14",
        packages: [
          { name: "pyannote.audio", version: "4.0.7" },
          { name: "torch", version: "2.11.0" },
        ],
        explicitSpecSha256: HASH,
        dependencySpecSha256: MODEL_HASH,
      }),
    );
    const base = {
      modelRepo: "pyannote/speaker-diarization-community-1",
      modelRevision: "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee",
      modelFiles: [{ relativePath: "config.yaml", size: 1, sha256: HASH }],
    };
    expect(
      speakerModelSnapshotIdentity({
        ...base,
        dependencyModelSnapshots: [{ id: "a" }, { id: "b" }],
      }),
    ).toBe(
      speakerModelSnapshotIdentity({
        ...base,
        dependencyModelSnapshots: [{ id: "b" }, { id: "a" }],
      }),
    );
  });

  it("materializes a portable 14/14 cache replay without model work", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c518-cache-"));
    temporaryDirectories.push(root);
    const fresh = new SpeakerEvidenceCache({ mode: "read-write", root });
    for (let index = 0; index < 14; index += 1) {
      const identity = cacheIdentity(index);
      expect(
        await fresh.get({
          attemptId: `attempt-${index}`,
          audioSha256: identity.audioSha256,
          windowType: identity.windowType,
          identity,
        }),
      ).toBeNull();
      await fresh.put({
        identity,
        inference: inference("ordered", "union", false),
      });
    }
    const replay = new SpeakerEvidenceCache({ mode: "read", root });
    for (let index = 0; index < 14; index += 1) {
      const identity = cacheIdentity(index);
      const result = await replay.get({
        attemptId: `attempt-${index}`,
        audioSha256: identity.audioSha256,
        windowType: identity.windowType,
        identity,
      });
      expect(result?.wallClockSeconds).toBe(0);
    }
    const manifest = replay.manifest({ inferenceCount: 0, modelLoadCount: 0 });
    expect(manifest.summary).toEqual({
      requestCount: 14,
      hitCount: 14,
      missCount: 0,
      writeCount: 0,
      inferenceCount: 0,
      modelLoadCount: 0,
    });
    const serializedIdentity = JSON.stringify(cacheIdentity(0));
    expect(serializedIdentity).not.toMatch(
      /(?:\/Users\/|HF_TOKEN|generatedAt|output\/)/u,
    );
    expect(buildSpeakerEvidenceCacheKey(cacheIdentity(0))).toHaveLength(64);
  });
});
