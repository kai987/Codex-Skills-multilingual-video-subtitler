import { describe, expect, it } from "vitest";
import {
  subtitlePackageSchema,
  type C61HypothesisInput,
  type C61HypothesisEvent,
} from "@mvl/shared";
import {
  C611_FEATURE_NAMES,
  c611FeatureRowSchema,
  machineSelectiveMbrFeaturesSchema,
  machineSelectiveExistingCandidateProposalsSchema,
  type C611CandidateMachineMetadata,
} from "../packages/shared/src/c6-1-1-machine-schemas.js";
import { buildC61HypothesisUniverse } from "../packages/video-subtitler/src/consensus/hypothesis-universe.js";
import { buildC611MachineProposals } from "../packages/video-subtitler/src/consensus/existing-candidate-proposal.js";
import {
  c611CandidateDistance,
  c611CandidateMedoid,
} from "../packages/video-subtitler/src/consensus/hierarchical-candidate-mbr.js";
import {
  extractC611CandidateMetadata,
  c611TextHash,
  c611WithHash,
  metadataForC611Candidate,
} from "../packages/video-subtitler/src/consensus/hierarchical-correlation-groups.js";
import { c611TextCompleteness } from "../packages/video-subtitler/src/consensus/candidate-completeness-risk.js";
import {
  checkC611SpanApplication,
  decideC611CurrentPreservation,
} from "../packages/video-subtitler/src/consensus/current-preservation.js";
import type { C61MachineArtifactInput } from "../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
const SHA = "a".repeat(64);
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Fixture value missing");
  return value;
}
function fixture(): C61MachineArtifactInput {
  const subtitlePackage = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.wav",
      container: "wav",
      durationSeconds: 20,
    },
    identity: { title: "Synthetic", season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      ass: "synthetic.ass",
      srt: "synthetic.srt",
      vtt: "synthetic.vtt",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    warnings: [],
    cues: [
      {
        id: "cue-1",
        start: 2,
        end: 5,
        text: "明日は晴れる",
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: null,
      },
    ],
  });
  const event: C61HypothesisEvent = c611WithHash({
    eventId: "synthetic-event",
    sourceInterval: { start: 2, end: 5 },
    sourceCandidateIds: [
      "source-current",
      "source-w1",
      "source-w2",
      "source-r1",
    ],
    finalCueIds: ["cue-1"],
    currentText: "明日は晴れる",
    finalSpan: {
      finalCueId: "cue-1",
      spanStart: 0,
      spanEnd: 6,
      spanText: "明日は晴れる",
      lineageStatus: "EXACT",
      modifiable: true,
      evidenceHash: SHA,
    },
  });
  const make = (
    suffix: string,
    text: string,
    provider: C61HypothesisInput["providerFamily"],
  ): C61HypothesisInput => ({
    inputRecordId: `synthetic:${suffix}`,
    sourceCandidateId: `source-${suffix}`,
    eventId: event.eventId,
    providerFamily: provider,
    modelIdentity: `model-${provider}`,
    requestId: `request-${suffix}`,
    windowType: "CORE_EXACT",
    sourceInterval: { start: 2, end: 5 },
    displayText: text,
    pronunciationText: null,
    pronunciationEvidenceId: null,
    candidateRole: `${provider}_CORE_EXACT`,
    correlationLineage: [`decode-${suffix}`],
    provenanceHashes: [SHA],
    lineageVerified: true,
    sourceGlobalVerified: true,
    hardRejectionReasons: [],
    localizationBlockers: [],
    runtimeGoldInputCount: 0,
    humanDerived: false,
  });
  return {
    subtitlePackage,
    taskDirectory: "synthetic",
    events: [event],
    candidates: [
      make("current", "明日は晴れる", "CURRENT"),
      make("w1", "明日は晴れる", "WHISPER"),
      make("w2", "明日は曇り", "WHISPER"),
      make("r1", "明日は曇り", "REAZON"),
    ],
    sourceArtifactHashes: { "synthetic.json": SHA },
    acousticScores: [],
    baselineInventory: {
      canonicalCueCount: 1,
      canonicalEventCount: 1,
      historicalRawCandidateCount: 4,
      historicalDispositionCounts: {},
      inputRowsByArtifact: {},
      sourceMediaSha256: SHA,
      sourceDurationSeconds: 20,
      newAsrInferenceCount: 0,
      networkUsed: false,
      runtimeGoldInputCount: 0,
    },
  };
}
function universe(machine: C61MachineArtifactInput) {
  return buildC61HypothesisUniverse({
    events: machine.events,
    candidates: machine.candidates,
    sourceArtifactHashes: machine.sourceArtifactHashes,
  });
}
function run(
  machine = fixture(),
  machineMetadata: C611CandidateMachineMetadata[] = [],
) {
  return buildC611MachineProposals({
    universe: universe(machine),
    machine,
    machineMetadata,
  });
}
function metadata(
  candidate: C61HypothesisInput,
  overrides: Partial<C611CandidateMachineMetadata> = {},
): C611CandidateMachineMetadata {
  return c611WithHash({
    sourceCandidateId: candidate.sourceCandidateId,
    eventId: candidate.eventId,
    sourceArtifactHash: SHA,
    sourceTextHash: c611TextHash(candidate.displayText),
    modelRevisionHash: null,
    coreAudioSha256: SHA,
    coreInterval: { start: 2, end: 5 },
    requestAudioSha256: SHA,
    requestInterval: candidate.sourceInterval,
    decodeConfigurationHash: SHA,
    promptPolicyHash: SHA,
    requestId: candidate.requestId,
    windowType: candidate.windowType,
    speechCompletenessStatus: "UNKNOWN" as const,
    requestEdgeRisk: null,
    leftEdgePinned: null,
    rightEdgePinned: null,
    incompleteSpeech: null,
    decoderTruncationRisk: null,
    tokenSupportCoverage: null,
    hallucinationRisk: null,
    ...overrides,
  });
}
describe("C6.1.1 machine-only existing-candidate proposals", () => {
  it("proposes one full existing non-current candidate and preserves current by default", () => {
    const machine = fixture(),
      baseline = JSON.stringify(machine.subtitlePackage),
      result = run(machine),
      proposal = required(result.proposals.records[0]);
    expect(proposal.eligibilityStatus).toBe("ELIGIBLE");
    const selected = required(
      universe(machine).candidates.find(
        (c) => c.candidateId === proposal.proposedCandidateId,
      ),
    );
    expect(selected.providerFamily).not.toBe("CURRENT");
    expect(
      machine.candidates.some((c) => c.displayText === selected.displayText),
    ).toBe(true);
    expect(proposal.spanApplication?.replacementTextHash).toBe(
      c611TextHash(selected.displayText),
    );
    expect(result.proposals.novelApplicationCount).toBe(0);
    expect(decideC611CurrentPreservation(proposal)).toBe("KEEP_CURRENT");
    expect(
      decideC611CurrentPreservation(proposal, { requestReview: true }),
    ).toBe("ABSTAIN_REVIEW");
    expect(
      decideC611CurrentPreservation(proposal, {
        trainedGateAllowsSwitch: true,
      }),
    ).toBe("SELECT_EXISTING_CANDIDATE");
    expect(JSON.stringify(machine.subtitlePackage)).toBe(baseline);
  });
  it("is deterministic under input and metadata permutation with stable top-K", () => {
    const machine = fixture(),
      a = run(machine),
      permuted = {
        ...machine,
        candidates: machine.candidates.toReversed(),
        events: machine.events.toReversed(),
      },
      b = run(permuted);
    expect(a).toEqual(b);
    expect(
      a.proposals.records[0]?.diagnosticProposals.map((p) => p.variant),
    ).toEqual(["H0", "H1", "H2"]);
    expect(a.proposals.records[0]?.topKCandidateIds.length).toBeLessThanOrEqual(
      5,
    );
  });
  it("rejects runtime Gold counters before proposal construction", () => {
    const machine = fixture();
    expect(() =>
      buildC611MachineProposals({
        universe: universe(machine),
        machine: {
          ...machine,
          baselineInventory: {
            ...machine.baselineInventory,
            runtimeGoldInputCount: 1,
          },
        } as unknown as C61MachineArtifactInput,
      }),
    ).toThrow("MACHINE_ONLY");
  });
  it("replays provenance instead of accepting an altered universe", () => {
    const machine = fixture(),
      original = universe(machine),
      changed = structuredClone(original);
    required(changed.candidates[0]).displayText = "変更";
    expect(() =>
      buildC611MachineProposals({ universe: changed, machine }),
    ).toThrow("REPLAY_MISMATCH");
  });
  it("excludes empty, missing-provenance, hard-rejected and unlocalizable alternatives", () => {
    for (const change of [
      { displayText: "" },
      { modelIdentity: null },
      { hardRejectionReasons: ["CONFIRMED_HALLUCINATION"] },
      { sourceInterval: { start: 12, end: 14 } },
    ]) {
      const machine = fixture();
      machine.candidates = [
        required(machine.candidates[0]),
        { ...required(machine.candidates[2]), ...change },
      ];
      const result = run(machine);
      expect(result.proposals.records[0]?.proposedCandidateId).toBeNull();
      expect(result.proposals.records[0]?.eligibilityStatus).toBe(
        "BLOCKED_STRUCTURAL",
      );
    }
  });
  it("rejects cross-event, invalid Unicode and non-applicable spans", () => {
    const machine = fixture(),
      u = universe(machine),
      candidate = required(
        u.candidates.find((c) => c.providerFamily === "REAZON"),
      );
    const check = (change: Partial<typeof candidate>) =>
      checkC611SpanApplication({
        event: required(machine.events[0]),
        candidate: { ...candidate, ...change },
        events: machine.events,
        production: machine.subtitlePackage,
      });
    expect(check({ eventId: "other" }).reasons).toContain(
      "CROSS_EVENT_CONTAMINATION",
    );
    expect(check({ displayText: "\ud800" }).reasons).toContain(
      "INVALID_ENCODING",
    );
    expect(check({ displayText: "あ".repeat(100) }).proof).toBeNull();
    required(required(machine.events[0]).finalSpan).spanStart = 1;
    expect(run(machine).proposals.records[0]?.eligibilityStatus).toBe(
      "BLOCKED_STRUCTURAL",
    );
  });
  it("blocks overlapping modifiable spans before training or text assembly", () => {
    const machine = fixture();
    machine.events.push({
      ...required(machine.events[0]),
      eventId: "overlapping-other",
    });
    expect(
      run(machine).proposals.records.find(
        (p) => p.eventId === "synthetic-event",
      )?.eligibilityStatus,
    ).toBe("BLOCKED_STRUCTURAL");
  });
  it("CURRENT has no independent vote in all risk variants", () => {
    const result = run();
    expect(
      result.correlationGroups.observations.every(
        (o) => o.providerFamily !== ("CURRENT" as string),
      ),
    ).toBe(true);
    expect(result.riskLedger.currentIndependentVoteCount).toBe(0);
    const current = required(
      result.riskLedger.rows.find((r) => r.role === "CURRENT_NO_SWITCH"),
    );
    expect(current.withinProviderRisk).toBeNull();
    expect(current.withinCorrelationRisk).toBeNull();
    expect(current.providerRisks.map((p) => p.providerFamily).sort()).toEqual([
      "REAZON",
      "WHISPER",
    ]);
  });
  it("groups known same-core exact/context observations hierarchically without losing decode/window identity", () => {
    const machine = fixture();
    required(machine.candidates[2]).windowType = "CORE_CONTEXT";
    const metas = machine.candidates.map((c) =>
      metadata(c, {
        requestInterval:
          c.windowType === "CORE_CONTEXT"
            ? { start: 1, end: 6 }
            : c.sourceInterval,
        decodeConfigurationHash:
          c.windowType === "CORE_CONTEXT" ? "b".repeat(64) : SHA,
      }),
    );
    const result = run(machine, metas),
      whisper = result.correlationGroups.observations.filter(
        (o) => o.providerFamily === "WHISPER",
      );
    expect(new Set(whisper.map((o) => o.coreGroupId)).size).toBe(1);
    expect(new Set(whisper.map((o) => o.observationGroupId)).size).toBe(2);
    expect(new Set(whisper.map((o) => o.decodeConfigurationHash)).size).toBe(2);
    expect(
      result.correlationAudit.reconciledSameCoreSplitGroupCount,
    ).toBeGreaterThan(0);
  });
  it("does not invent a common core from same-event missing metadata", () => {
    const result = run(),
      whisper = result.correlationGroups.observations.filter(
        (o) => o.providerFamily === "WHISPER",
      );
    expect(whisper.every((o) => !o.coreIdentityVerified)).toBe(true);
    expect(new Set(whisper.map((o) => o.coreGroupId)).size).toBe(
      whisper.length,
    );
    expect(result.correlationAudit.unknownDecodeConfigurationCount).toBe(3);
  });
  it("retains different core audio and model revisions rather than merging them", () => {
    const machine = fixture(),
      metas = machine.candidates.map((c, i) =>
        metadata(c, { coreAudioSha256: hash(i), modelRevisionHash: hash(i) }),
      );
    const result = run(machine, metas);
    expect(
      new Set(result.correlationGroups.observations.map((o) => o.coreGroupId))
        .size,
    ).toBe(3);
  });
  it("aggregates equal provider mass and deterministic medoids with lower risk better", () => {
    const machine = fixture(),
      result = run(machine),
      u = universe(machine);
    for (const risk of result.riskLedger.rows) {
      expect(risk.providerBalancedRisk).toBeCloseTo(
        risk.providerRisks.reduce((sum, p) => sum + p.meanRisk, 0) / 2,
      );
      expect(risk.hierarchicalRisk).toBeCloseTo(
        risk.providerRisks.reduce((sum, p) => sum + p.medoidRisk, 0) / 2,
      );
    }
    const peers = u.candidates.filter((c) => c.providerFamily === "WHISPER");
    expect(c611CandidateMedoid(peers)).toEqual(
      c611CandidateMedoid(peers.toReversed()),
    );
    expect(c611CandidateDistance(required(peers[0]), required(peers[0]))).toBe(
      0,
    );
    const p = required(result.proposals.records[0]);
    expect(p.rawMbrMargin).toBeCloseTo(
      required(p.currentMbrRisk) - required(p.proposedMbrRisk),
    );
  });
  it("keeps contraction as soft evidence even with unknown acoustic completeness", () => {
    const machine = fixture();
    machine.candidates = [
      required(machine.candidates[0]),
      { ...required(machine.candidates[2]), displayText: "明日" },
    ];
    const result = run(machine);
    expect(result.proposals.records[0]?.eligibilityStatus).toBe("ELIGIBLE");
    expect(result.completeness.rows[0]?.riskClasses).toEqual([
      "STRONG_CONTRACTION_RISK",
      "UNSUPPORTED_DELETION_RISK",
    ]);
    expect(result.completeness.rows[0]?.softEvidenceOnly).toBe(true);
    expect(result.completeness.rows[0]?.speechCompletenessStatus).toBe(
      "UNKNOWN",
    );
  });
  it("handles no/mild contraction, deleted spans and long insertions without declaring correctness", () => {
    expect(c611TextCompleteness("明日は晴れる", "明日は晴れる")).toMatchObject({
      characterLengthRatio: 1,
      normalizedLcsCoverage: 1,
      deletedCharacterRatio: 0,
      insertedCharacterRatio: 0,
    });
    expect(
      c611TextCompleteness("あいうえお", "あいうえ").characterLengthRatio,
    ).toBe(0.8);
    expect(c611TextCompleteness("あいうえお", "あお").longestDeletedSpan).toBe(
      3,
    );
    expect(c611TextCompleteness("あお", "あいうえお").longestInsertedSpan).toBe(
      3,
    );
    expect(c611TextCompleteness("", "あ").characterLengthRatio).toBeNull();
  });
  it("records explicit edge/incomplete/hallucination evidence without rejecting a shorter proposal", () => {
    const machine = fixture();
    machine.candidates = [
      required(machine.candidates[0]),
      { ...required(machine.candidates[2]), displayText: "明日" },
    ];
    const meta = metadata(required(machine.candidates[1]), {
      requestEdgeRisk: 0.9,
      leftEdgePinned: true,
      incompleteSpeech: true,
      speechCompletenessStatus: "INCOMPLETE",
      hallucinationRisk: 0.8,
    });
    const result = run(machine, [meta]);
    expect(result.completeness.rows[0]?.riskClasses).toContain(
      "EDGE_TRUNCATION_RISK",
    );
    expect(result.completeness.rows[0]?.riskClasses).toContain(
      "INCOMPLETE_SPEECH_RISK",
    );
    expect(result.proposals.records[0]?.eligibilityStatus).toBe("ELIGIBLE");
    expect(result.features.rows[0]?.values.hallucinationRisk).toBe(0.8);
  });
  it("has exactly 30 stable numeric/null features, explicit missingness and no text features", () => {
    const result = run(),
      row = required(result.features.rows[0]);
    expect(result.features.featureNames).toEqual(C611_FEATURE_NAMES);
    expect(C611_FEATURE_NAMES).toHaveLength(30);
    expect(row.values.ctcMargin).toBeNull();
    expect(row.missingFlags.ctcMargin).toBe(true);
    expect(
      Object.values(row.values).every(
        (v) => v === null || typeof v === "number",
      ),
    ).toBe(true);
    expect(
      c611FeatureRowSchema.safeParse({ ...row, rawText: "文字" }).success,
    ).toBe(false);
    expect(
      c611FeatureRowSchema.safeParse({
        ...row,
        values: { ...row.values, goldError: 0 },
      }).success,
    ).toBe(false);
    expect(
      c611FeatureRowSchema.safeParse({
        ...row,
        missingFlags: { ...row.missingFlags, ctcMargin: false },
      }).success,
    ).toBe(false);
    expect(
      machineSelectiveMbrFeaturesSchema.safeParse({
        ...result.features,
        featureNames: [...C611_FEATURE_NAMES].reverse(),
      }).success,
    ).toBe(false);
    expect(
      machineSelectiveExistingCandidateProposalsSchema.safeParse({
        ...result.proposals,
        extra: 1,
      }).success,
    ).toBe(false);
  });
  it("treats CTC as exact same-model/audio supporting direction and rejects mismatch", () => {
    const machine = fixture(),
      p = required(run(machine).proposals.records[0]),
      selected = required(
        universe(machine).candidates.find(
          (c) => c.candidateId === p.proposedCandidateId,
        ),
      );
    machine.acousticScores = [required(machine.candidates[1]), selected].map(
      (c, i) => ({
        sourceCandidateId: c.sourceCandidateId,
        sourceDisplayTextHash: c611TextHash(c.displayText),
        eventId: required(c.eventId),
        modelIdentityHash: SHA,
        audioSha256: SHA,
        expectedAudioSha256: SHA,
        representationHash: hash(c.displayText),
        expectedRepresentationHash: hash(c.displayText),
        nllPerTargetToken: i ? 1 : 3,
        scorability: "SCORABLE" as const,
        evidenceHash: hash(i),
        sourceArtifactHash: SHA,
      }),
    );
    expect(run(machine).features.rows[0]?.values.ctcDirection).toBe(1);
    expect(run(machine).features.rows[0]?.values.ctcMargin).toBe(2);
    required(machine.acousticScores[1]).expectedAudioSha256 = "b".repeat(64);
    expect(run(machine).features.rows[0]?.values.ctcDirection).toBeNull();
  });
  it("extracts exact/context metadata from explicit paired records and never invents decoder scores", () => {
    const artifacts = {
      "machine-paired-whisper-evidence.json": {
        modelIdentity: { revision: "model" },
        promptPolicy: "no-prompt",
        events: [
          {
            eventId: "event",
            exactAudioSha256: SHA,
            whisperCoreExact: {
              candidateId: "exact",
              displayText: "明日",
              sourceInterval: { start: 2, end: 3 },
              audioSha256: SHA,
              windowType: "CORE_EXACT",
              requestId: "r1",
            },
            whisperCoreContext: {
              candidateId: "context",
              displayText: "明日は",
              sourceInterval: { start: 1, end: 4 },
              windowType: "CORE_CONTEXT",
              requestId: "r2",
            },
          },
        ],
      },
    };
    const rows = extractC611CandidateMetadata({
      artifacts,
      sourceArtifactHashes: { "machine-paired-whisper-evidence.json": SHA },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (r) => r.coreAudioSha256 === SHA && r.coreInterval?.start === 2,
      ),
    ).toBe(true);
    expect(rows.every((r) => r.decoderTruncationRisk === null)).toBe(true);
    expect(
      extractC611CandidateMetadata({
        artifacts: { "gold.json": { candidateId: "forbidden" } },
        sourceArtifactHashes: {},
      }),
    ).toEqual([]);
  });
  it("conflicting duplicate metadata is unknown rather than best-score cherry-picking", () => {
    const machine = fixture(),
      source = required(machine.candidates[2]),
      candidate = required(
        universe(machine).candidates.find(
          (c) => c.sourceCandidateId === source.sourceCandidateId,
        ),
      );
    const result = metadataForC611Candidate(candidate, [
      metadata(source, { tokenSupportCoverage: 0.2 }),
      metadata(source, { tokenSupportCoverage: 0.9 }),
    ]);
    expect(result?.tokenSupportCoverage).toBeNull();
  });
  it("deduplicated medoids keep the first provenance-ranked existing candidate", () => {
    const candidate = required(universe(fixture()).candidates[0]);
    const first = {
      ...candidate,
      candidateId: "first",
      provenanceHash: "1".repeat(64),
    };
    const last = {
      ...candidate,
      candidateId: "last",
      provenanceHash: "2".repeat(64),
    };
    expect(c611CandidateMedoid([last, first]).candidateId).toBe("first");
    expect(c611CandidateMedoid([first, last]).candidateId).toBe("first");
  });
  it("does not award a singleton provider an automatic hierarchy advantage over many same-provider hypotheses", () => {
    const machine = fixture();
    const base = required(machine.candidates[2]);
    const extras = ["雨", "雪", "強風", "暑い", "寒い"].map((word, index) => ({
      ...base,
      inputRecordId: `extra-${index}`,
      sourceCandidateId: `extra-source-${index}`,
      requestId: `extra-request-${index}`,
      correlationLineage: [`extra-decode-${index}`],
      displayText: `明日は${word}`,
    }));
    machine.candidates.push(...extras);
    const result = run(machine);
    const representative = result.riskLedger.rows.find(
      (r) => r.role === "CURRENT_NO_SWITCH",
    );
    const wMedoidId = representative?.providerRisks.find(
      (p) => p.providerFamily === "WHISPER",
    )?.medoidCandidateId;
    const rMedoidId = representative?.providerRisks.find(
      (p) => p.providerFamily === "REAZON",
    )?.medoidCandidateId;
    const wRisk = result.riskLedger.rows.find(
      (r) => r.candidateId === wMedoidId,
    )?.hierarchicalRisk;
    const rRisk = result.riskLedger.rows.find(
      (r) => r.candidateId === rMedoidId,
    )?.hierarchicalRisk;
    expect(wRisk).not.toBeNull();
    expect(wRisk).toBeCloseTo(required(rRisk));
    expect(result.proposals.records[0]?.topKCandidateIds).toHaveLength(5);
    expect(
      required(result.proposals.records[0]).eligibleCandidates.length,
    ).toBeGreaterThan(5);
    expect(
      required(result.proposals.records[0]).eligibleCandidates.every(
        (c) => c.spanApplication.replacementTextHash.length === 64,
      ),
    ).toBe(true);
  });
  it("a shorter complete hypothesis remains eligible and is not labelled acoustically unsupported deletion", () => {
    const machine = fixture();
    machine.candidates = [
      required(machine.candidates[0]),
      { ...required(machine.candidates[2]), displayText: "明日" },
    ];
    const result = run(machine, [
      metadata(required(machine.candidates[1]), {
        speechCompletenessStatus: "COMPLETE",
        incompleteSpeech: false,
        tokenSupportCoverage: 1,
      }),
    ]);
    expect(result.proposals.records[0]?.eligibilityStatus).toBe("ELIGIBLE");
    expect(result.completeness.rows[0]?.riskClasses).toEqual([
      "STRONG_CONTRACTION_RISK",
    ]);
    expect(result.features.rows[0]?.values.speechCompleteness).toBe(1);
  });
  it("keeps legacy all-included/current denominator separate from ASR-only correlation audit", () => {
    const machine = fixture(),
      result = run(machine),
      official = universe(machine);
    expect(result.correlationAudit.legacy.totalGroups).toBe(
      official.summary.correlationGroupCount,
    );
    expect(result.correlationAudit.legacyAllIncludedGroupCount).toBe(
      result.correlationAudit.legacy.totalGroups + 1,
    );
  });
});
