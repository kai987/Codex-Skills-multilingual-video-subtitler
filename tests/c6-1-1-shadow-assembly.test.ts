import { describe, expect, it } from "vitest";
import {
  subtitlePackageSchema,
  type C61CandidateText,
  type C61HypothesisInput,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { buildC61HypothesisUniverse } from "../packages/video-subtitler/src/consensus/hypothesis-universe.js";
import {
  buildC61Representations,
  c61Require,
} from "../packages/video-subtitler/src/consensus/japanese-text-representation.js";
import { alignC61Multiple } from "../packages/video-subtitler/src/consensus/multiple-sequence-alignment.js";
import { buildC61TokenLattice } from "../packages/video-subtitler/src/consensus/token-lattice.js";
import { assembleC611ExistingShadow } from "../packages/video-subtitler/src/consensus/selective-mbr-shadow-assembly.js";

function fixture(current = "甲乙", replacement = "甲丙") {
  const eventId = "synthetic-event";
  const production = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.mkv",
      container: "mkv",
      durationSeconds: 10,
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
        text: current,
        start: 1,
        end: 3,
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: null,
      },
    ],
  });
  function raw(
    sourceCandidateId: string,
    displayText: string,
    providerFamily: C61HypothesisInput["providerFamily"],
  ): C61HypothesisInput {
    return {
      inputRecordId: `input-${sourceCandidateId}`,
      sourceCandidateId,
      eventId,
      providerFamily,
      modelIdentity: providerFamily.toLowerCase(),
      requestId: `request-${sourceCandidateId}`,
      windowType: "core",
      sourceInterval: { start: 1, end: 3 },
      displayText,
      pronunciationText: null,
      pronunciationEvidenceId: null,
      candidateRole: "CORE",
      correlationLineage: [sourceCandidateId],
      provenanceHashes: [hash(sourceCandidateId)],
      lineageVerified: true,
      sourceGlobalVerified: true,
      hardRejectionReasons: [],
      localizationBlockers: [],
      runtimeGoldInputCount: 0,
      humanDerived: false,
    };
  }
  const universe = buildC61HypothesisUniverse({
    events: [
      {
        eventId,
        sourceInterval: { start: 1, end: 3 },
        sourceCandidateIds: ["current", "existing"],
        finalCueIds: ["cue-1"],
        currentText: current,
        finalSpan: {
          finalCueId: "cue-1",
          spanStart: 0,
          spanEnd: Array.from(current).length,
          spanText: current,
          lineageStatus: "EXACT",
          modifiable: true,
          evidenceHash: hash("span"),
        },
        semanticHash: hash("event"),
      },
    ],
    candidates: [
      raw("current", current, "CURRENT"),
      raw("existing", replacement, "REAZON"),
    ],
    sourceArtifactHashes: { synthetic: hash("source") },
  });
  const candidates: C61CandidateText[] = universe.candidates.map(
    (candidate) => ({
      candidateId: candidate.candidateId,
      eventId: c61Require(candidate.eventId),
      providerFamily: candidate.providerFamily,
      displayText: candidate.displayText,
      normalizedText: candidate.normalizedText,
      pronunciationText: candidate.pronunciationText,
      correlationGroupId: candidate.correlationGroupId,
      provenanceHash: candidate.provenanceHash,
      sourceInterval: c61Require(candidate.sourceInterval),
    }),
  );
  const representations = buildC61Representations(candidates);
  const lattice = buildC61TokenLattice(
    alignC61Multiple(representations),
    representations,
  );
  const selected = c61Require(
    universe.candidates.find(
      (candidate) => candidate.providerFamily === "REAZON",
    ),
  );
  const control = c61Require(
    universe.candidates.find(
      (candidate) => candidate.providerFamily === "CURRENT",
    ),
  );
  return {
    production,
    universe,
    lattices: [lattice],
    selected,
    control,
    eventId,
  };
}
function run(
  data: ReturnType<typeof fixture>,
  selected = true,
  candidateId = data.selected.candidateId,
) {
  return assembleC611ExistingShadow({
    ...data,
    profileId: "S5",
    selections: [{ eventId: data.eventId, candidateId, selected }],
  });
}
describe("C6.1.1 existing-only shadow assembler", () => {
  it("applies the exact existing candidate only to shadow with ID/order/timing unchanged", () => {
    const data = fixture(),
      before = structuredClone(data.production);
    const result = run(data);
    expect(result.subtitlePackage.cues[0]?.text).toBe(
      data.selected.displayText,
    );
    expect(result).toMatchObject({
      requestedSelectionCount: 1,
      appliedSelectionCount: 1,
      blockedRequestedEventIds: [],
      novelApplicationCount: 0,
      timingMutationCount: 0,
      productionMutationCount: 0,
    });
    expect(result.changedCueIds).toEqual(["cue-1"]);
    expect(
      result.subtitlePackage.cues.map(({ id, start, end }) => ({
        id,
        start,
        end,
      })),
    ).toEqual(before.cues.map(({ id, start, end }) => ({ id, start, end })));
    expect(data.production).toEqual(before);
    expect(result.ass).toContain(data.selected.displayText);
    expect(result.srt).toContain(data.selected.displayText);
    expect(result.vtt).toContain(data.selected.displayText);
  });
  it("keeps P0 text for null/abstained selections without candidate materialization", () => {
    const data = fixture();
    const result = run(data, false, "not-even-an-existing-candidate");
    expect(result.subtitlePackage.cues).toEqual(data.production.cues);
    expect(result.requestedSelectionCount).toBe(0);
    expect(result.appliedSelectionCount).toBe(0);
    expect(result.changedCueIds).toEqual([]);
  });
  it("refuses nonexistent, novel-text and CURRENT candidate IDs as switches", () => {
    const data = fixture();
    for (const candidateId of [
      "novel-combined-candidate",
      "missing",
      data.control.candidateId,
    ]) {
      expect(() => run(data, true, candidateId)).toThrow(
        "C611_SELECTED_NONEXISTING_CANDIDATE",
      );
    }
  });
  it("requires actual existing candidate lattice provenance", () => {
    const data = fixture();
    expect(() => run({ ...data, lattices: [] })).toThrow(
      "C611_EXISTING_CANDIDATE_PROVENANCE_UNAVAILABLE",
    );
    const corrupt = structuredClone(data);
    const path = c61Require(
      corrupt.lattices[0]?.candidatePaths.find(
        (item) => item.candidateId === corrupt.selected.candidateId,
      ),
    );
    path.nodeIds = path.nodeIds.toReversed();
    expect(() => run(corrupt)).toThrow(
      "C611_EXISTING_TEXT_CHANGED_BY_PROVENANCE",
    );
  });
  it("blocks stale span text and reports the still-unapplied selected event", () => {
    const data = fixture();
    const cue = c61Require(data.production.cues[0]);
    cue.text = "別文";
    const before = structuredClone(data.production);
    const result = run(data);
    expect(result.appliedSelectionCount).toBe(0);
    expect(result.blockedRequestedEventIds).toEqual([data.eventId]);
    expect(result.subtitlePackage.cues).toEqual(before.cues);
    expect(data.production).toEqual(before);
  });
  it("rejects duplicate event choices instead of mixing multiple candidates", () => {
    const data = fixture();
    const selection = {
      eventId: data.eventId,
      candidateId: data.selected.candidateId,
      selected: true,
    };
    expect(() =>
      assembleC611ExistingShadow({
        ...data,
        profileId: "S5",
        selections: [selection, selection],
      }),
    ).toThrow("C611_DUPLICATE_SHADOW_SELECTION");
  });
  it("preserves chosen candidate surface when normalization makes distinct forms equivalent", () => {
    const data = fixture("Ａ", "A");
    const result = run(data);
    expect(result.subtitlePackage.cues[0]?.text).toBe("A");
    expect(data.production.cues[0]?.text).toBe("Ａ");
    expect(result.novelApplicationCount).toBe(0);
  });
  it("leaves long unrenderable candidate text blocked without cue split or merge", () => {
    const data = fixture("甲乙", "長".repeat(80));
    const result = run(data);
    expect(result.subtitlePackage.cues).toEqual(data.production.cues);
    expect(result.blockedRequestedEventIds).toEqual([data.eventId]);
    expect(
      result.decisions.some(
        (decision) => decision.status === "PRESENTATION_CAPACITY",
      ),
    ).toBe(true);
    expect(result.timingMutationCount).toBe(0);
  });
});
