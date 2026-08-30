import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  c61HypothesisInputSchema,
  machineMultiAsrHypothesisUniverseSchema,
  type C61HypothesisInput,
  type C61HypothesisEvent,
} from "@mvl/shared";
import {
  buildC61HypothesisUniverse,
  normalizeC61HypothesisText,
} from "../packages/video-subtitler/src/consensus/hypothesis-universe.js";
import {
  adaptC61MachineArtifacts,
  bindC61AcousticEvidence,
  C61_MACHINE_ARTIFACT_FILES,
} from "../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";

const HASH = "a".repeat(64);
const EVENT: C61HypothesisEvent = {
  eventId: "event-1",
  sourceInterval: { start: 10, end: 14 },
  sourceCandidateIds: ["source-1"],
  finalCueIds: ["cue-1"],
  currentText: "ここへ行く",
  finalSpan: null,
  semanticHash: HASH,
};

function candidate(
  overrides: Partial<C61HypothesisInput> = {},
): C61HypothesisInput {
  return {
    inputRecordId: "artifact#candidate-1",
    sourceCandidateId: "source-1",
    eventId: "event-1",
    providerFamily: "WHISPER",
    modelIdentity: "model-v1",
    requestId: "request-1",
    windowType: "CORE_EXACT",
    sourceInterval: { start: 10, end: 14 },
    displayText: "ここへ行く",
    pronunciationText: null,
    pronunciationEvidenceId: null,
    candidateRole: "WHISPER_CORE_EXACT",
    correlationLineage: ["same-model", "same-event", "no-prompt"],
    provenanceHashes: [HASH],
    lineageVerified: true,
    sourceGlobalVerified: true,
    hardRejectionReasons: [],
    localizationBlockers: [],
    runtimeGoldInputCount: 0,
    humanDerived: false,
    ...overrides,
  };
}

function build(candidates: C61HypothesisInput[]) {
  return buildC61HypothesisUniverse({
    events: [EVENT],
    candidates,
    sourceArtifactHashes: { "machine.json": HASH },
  });
}

describe("C6.1 auditable machine hypothesis universe", () => {
  it("conserves every input including duplicates and hard-rejected candidates", () => {
    const universe = build([
      candidate(),
      candidate({ inputRecordId: "duplicate", sourceCandidateId: "source-2" }),
      candidate({
        inputRecordId: "hard",
        hardRejectionReasons: ["CONFIRMED_HALLUCINATION"],
      }),
      candidate({
        inputRecordId: "disjoint",
        sourceInterval: { start: 90, end: 91 },
      }),
      candidate({ inputRecordId: "missing", modelIdentity: null }),
    ]);
    expect(universe.summary).toMatchObject({
      inputCandidateCount: 5,
      includedCandidateCount: 1,
      normalizedDuplicateCount: 1,
      hardRejectedCount: 1,
      unlocalizableCandidateCount: 1,
      unsupportedProvenanceCount: 1,
      unaccountedCandidateCount: 0,
    });
    expect(
      new Set(universe.candidates.map((item) => item.inputRecordId)).size,
    ).toBe(5);
    expect(
      universe.candidates.find(
        (item) => item.inclusionStatus === "NORMALIZED_DUPLICATE",
      )?.representativeCandidateId,
    ).toBeTruthy();
  });

  it("retains cross-provider agreement while collapsing same-provider copies", () => {
    const universe = build([
      candidate(),
      candidate({
        inputRecordId: "reazon",
        providerFamily: "REAZON",
        modelIdentity: "reazon",
      }),
    ]);
    expect(universe.summary.includedCandidateCount).toBe(2);
    expect(universe.eventScopes[0]?.providerFamilies).toEqual([
      "REAZON",
      "WHISPER",
    ]);
    expect(universe.eventScopes[0]?.normalizedDistinctCount).toBe(1);
    expect(universe.eventScopes[0]?.scope).toBe("SINGLE_HYPOTHESIS_CONTROL");
  });

  it("recognizes multi-provider distinct hypotheses without calling CURRENT a vote", () => {
    const universe = build([
      candidate(),
      candidate({
        inputRecordId: "reazon",
        providerFamily: "REAZON",
        displayText: "そこへ行く",
      }),
      candidate({
        inputRecordId: "current",
        providerFamily: "CURRENT",
        candidateRole: "CURRENT_FINAL",
      }),
    ]);
    expect(universe.eventScopes[0]?.scope).toBe(
      "WHISPER_REAZON_MULTI_PROVIDER",
    );
    expect(
      universe.candidates.find((item) => item.providerFamily === "CURRENT")
        ?.independentVoteEligible,
    ).toBe(false);
    expect(universe.eventScopes[0]?.independentCandidateCount).toBe(2);
  });

  it("keeps homophonic surface variants and never creates a reading", () => {
    const universe = build([
      candidate({
        displayText: "橋",
        pronunciationText: "はし",
        pronunciationEvidenceId: "machine-reading-1",
      }),
      candidate({
        inputRecordId: "alternate",
        displayText: "箸",
        pronunciationText: "はし",
        pronunciationEvidenceId: "machine-reading-2",
      }),
      candidate({
        inputRecordId: "untrusted",
        displayText: "端",
        pronunciationText: "はし",
        pronunciationEvidenceId: null,
      }),
    ]);
    expect(universe.summary.includedCandidateCount).toBe(3);
    expect(
      universe.candidates.find((item) => item.inputRecordId === "untrusted")
        ?.pronunciationText,
    ).toBeNull();
    expect(
      universe.candidates.some((item) =>
        item.inclusionReasons.includes(
          "PRONUNCIATION_EQUIVALENT_SURFACE_RETAINED",
        ),
      ),
    ).toBe(true);
  });

  it("normalizes width and ASS breaks without erasing repetitions or homophones", () => {
    expect(normalizeC61HypothesisText("ﾊｲ\\Nはい  はい")).toBe(
      "ハイ はい はい",
    );
    expect(normalizeC61HypothesisText("橋")).not.toBe(
      normalizeC61HypothesisText("箸"),
    );
  });

  it("is independent of candidate input and provenance-array order", () => {
    const inputs = [
      candidate(),
      candidate({
        inputRecordId: "other",
        displayText: "そこへ行く",
        provenanceHashes: [HASH, "b".repeat(64)],
      }),
    ];
    expect(build(inputs).semanticHash).toBe(
      build(
        inputs.toReversed().map((item) => ({
          ...item,
          provenanceHashes: item.provenanceHashes.toReversed(),
          correlationLineage: item.correlationLineage.toReversed(),
        })),
      ).semanticHash,
    );
  });

  it("rejects duplicate record IDs instead of silently removing them", () => {
    expect(() => build([candidate(), candidate()])).toThrow(
      "C61_DUPLICATE_INPUT_RECORD_ID",
    );
  });

  it("requires explicit lineage even for a plausible matching interval", () => {
    expect(
      build([candidate({ lineageVerified: false })]).candidates[0]
        ?.inclusionStatus,
    ).toBe("UNSUPPORTED_PROVENANCE");
    expect(
      build([
        candidate({ localizationBlockers: ["CROSS_EVENT_CONTAMINATION"] }),
      ]).candidates[0]?.inclusionStatus,
    ).toBe("UNLOCALIZABLE");
    expect(
      build([candidate({ sourceInterval: { start: 0, end: 100 } })])
        .candidates[0]?.inclusionStatus,
    ).toBe("UNLOCALIZABLE");
  });

  it("uses one bounded correlation family for exact and context requests", () => {
    const universe = build([
      candidate(),
      candidate({
        inputRecordId: "context",
        displayText: "別の候補",
        windowType: "CORE_CONTEXT",
        candidateRole: "WHISPER_CORE_CONTEXT",
      }),
    ]);
    expect(
      new Set(universe.candidates.map((item) => item.correlationGroupId)).size,
    ).toBe(1);
  });

  it("rejects Gold, human authority and unknown fields at the normalized input boundary", () => {
    expect(
      c61HypothesisInputSchema.safeParse({
        ...candidate(),
        runtimeGoldInputCount: 1,
      }).success,
    ).toBe(false);
    expect(
      c61HypothesisInputSchema.safeParse({ ...candidate(), humanDerived: true })
        .success,
    ).toBe(false);
    expect(
      c61HypothesisInputSchema.safeParse({ ...candidate(), goldText: "answer" })
        .success,
    ).toBe(false);
    expect(
      machineMultiAsrHypothesisUniverseSchema.safeParse({
        ...build([candidate()]),
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("fails closed when a required machine artifact is unavailable", () => {
    expect(() =>
      adaptC61MachineArtifacts({ artifacts: {}, sourceArtifactHashes: {} }),
    ).toThrow("C61_REQUIRED_ARTIFACT_MISSING");
    expect(
      C61_MACHINE_ARTIFACT_FILES.some((file) =>
        /gold|memory|correction/iu.test(file),
      ),
    ).toBe(false);
  });

  it("binds acoustic scores only to exact original candidate and event identity", () => {
    const universe = build([candidate()]);
    const input = {
      sourceCandidateId: "source-1",
      sourceDisplayTextHash: createHash("sha256")
        .update("ここへ行く")
        .digest("hex"),
      eventId: "event-1",
      modelIdentityHash: HASH,
      audioSha256: HASH,
      expectedAudioSha256: HASH,
      representationHash: HASH,
      expectedRepresentationHash: HASH,
      nllPerTargetToken: 2,
      scorability: "SCORABLE" as const,
      evidenceHash: HASH,
      sourceArtifactHash: HASH,
    };
    const evidence = bindC61AcousticEvidence(universe, [input]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.candidateProvenanceHash).toBe(
      universe.candidates[0]?.provenanceHash,
    );
    expect(evidence[0]?.expectedIdentity).toEqual(evidence[0]?.cachedIdentity);
    expect(
      bindC61AcousticEvidence(universe, [{ ...input, eventId: "event-2" }]),
    ).toEqual([]);
    expect(
      bindC61AcousticEvidence(universe, [
        { ...input, sourceCandidateId: "different" },
      ]),
    ).toEqual([]);
    expect(
      bindC61AcousticEvidence(universe, [
        { ...input, sourceDisplayTextHash: "b".repeat(64) },
      ]),
    ).toEqual([]);
  });
});
