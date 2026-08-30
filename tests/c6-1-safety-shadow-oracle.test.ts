import { describe, expect, it } from "vitest";
import {
  subtitlePackageSchema,
  type C61CandidateText,
  type C61HypothesisEvent,
  type C61SelectedPath,
  type C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import {
  buildC61Representations,
  c61Require,
  normalizeC61Japanese,
} from "../packages/video-subtitler/src/consensus/japanese-text-representation.js";
import { alignC61Multiple } from "../packages/video-subtitler/src/consensus/multiple-sequence-alignment.js";
import { buildC61TokenLattice } from "../packages/video-subtitler/src/consensus/token-lattice.js";
import { validateC61Path } from "../packages/video-subtitler/src/consensus/legal-path-validator.js";
import {
  enumerateLegalPaths,
  materializeC61Path,
} from "../packages/video-subtitler/src/consensus/lattice-mbr.js";
import { restoreC61Surface } from "../packages/video-subtitler/src/consensus/surface-restoration.js";
import {
  c61EvaluationEditDistance,
  exactC61LegalPathOracle,
  normalizeC61EvaluationText,
  unrestrictedC61SlotOracle,
} from "../packages/video-subtitler/src/consensus/consensus-oracle-evaluator.js";
import {
  auditC61Consensus,
  type C61ProfilePath,
} from "../packages/video-subtitler/src/consensus/consensus-safety-audit.js";
import { assembleC61Shadow } from "../packages/video-subtitler/src/consensus/consensus-shadow-assembly.js";

function candidate(
  candidateId: string,
  displayText: string,
  providerFamily: C61CandidateText["providerFamily"],
  eventId = "e1",
): C61CandidateText {
  return {
    candidateId,
    eventId,
    displayText,
    normalizedText: normalizeC61Japanese(displayText),
    pronunciationText: null,
    providerFamily,
    correlationGroupId: `${providerFamily}-group`,
    provenanceHash: "a".repeat(64),
    sourceInterval: { start: 1, end: 5 },
  };
}
function makeLattice(candidates: C61CandidateText[]): C61TokenLattice {
  const reps = buildC61Representations(candidates);
  return buildC61TokenLattice(alignC61Multiple(reps), reps);
}
function directPath(
  graph: C61TokenLattice,
  candidates: C61CandidateText[],
  candidateId: string,
  currentCandidateId = candidateId,
): C61SelectedPath {
  return c61Require(
    materializeC61Path(
      graph,
      c61Require(
        graph.candidatePaths.find((path) => path.candidateId === candidateId),
      ).nodeIds,
      candidates,
      currentCandidateId,
      null,
      candidateId,
    ),
  );
}
function profilePath(
  graph: C61TokenLattice,
  path: C61SelectedPath,
): C61ProfilePath {
  return {
    profileId: "P1",
    eventId: graph.eventId,
    path,
    maxProviderSwitches: null,
  };
}
function production(text = "甲乙丙") {
  return subtitlePackageSchema.parse({
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
    identity: { title: "Synthetic", season: null, episode: null, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "production.srt",
      vtt: "production.vtt",
      ass: "production.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues: [
      {
        id: "cue-1",
        text,
        start: 1,
        end: 5,
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: 0.8,
      },
    ],
    warnings: [],
  });
}
function proposal(
  eventId: string,
  start: number,
  before: string,
  after: string,
) {
  const candidates = [
    candidate(`${eventId}-current`, before, "CURRENT", eventId),
    candidate(`${eventId}-r`, after, "REAZON", eventId),
  ];
  const graph = makeLattice(candidates);
  const path = profilePath(
    graph,
    directPath(graph, candidates, `${eventId}-r`, `${eventId}-current`),
  );
  const event: C61HypothesisEvent = {
    eventId,
    sourceInterval: { start: 1, end: 5 },
    sourceCandidateIds: candidates.map((value) => value.candidateId),
    finalCueIds: ["cue-1"],
    currentText: before,
    finalSpan: {
      finalCueId: "cue-1",
      spanStart: start,
      spanEnd: start + Array.from(before).length,
      spanText: before,
      lineageStatus: "EXACT",
      modifiable: true,
      evidenceHash: "b".repeat(64),
    },
    semanticHash: "c".repeat(64),
  };
  return { event, graph, path };
}
function withPathHash(
  path: C61SelectedPath,
  changes: Partial<C61SelectedPath>,
): C61SelectedPath {
  const { semanticHash, ...body } = { ...path, ...changes };
  expect(semanticHash).toHaveLength(64);
  return { ...body, semanticHash: machineQualitySemanticHash(body) };
}

describe("C6.1 exact legal oracle independent checks", () => {
  it.each([
    ["正前共誤後", "誤前共正後", "正前共正後"],
    ["甲乙", "丙丁", "甲丁"],
    ["はいはい", "はい", "はいはい"],
    ["前𠮷共後", "前共か\u3099", "前𠮷共か\u3099"],
    ["", "音", ""],
    ["Ａ共甲", "A共乙", "Ａ共乙"],
  ])(
    "matches exhaustive constrained search for %s / %s",
    (left, right, target) => {
      const candidates = [
        candidate("w", left, "WHISPER"),
        candidate("r", right, "REAZON"),
      ];
      const graph = makeLattice(candidates);
      const enumerated = enumerateLegalPaths(graph, candidates, {
        beamWidth: 10000,
        maxPaths: 10000,
        maxProviderSwitches: null,
      });
      expect(enumerated.search.exhaustiveWithinConstraints).toBe(true);
      const exhaustive = Math.min(
        ...enumerated.paths.map((path) =>
          c61EvaluationEditDistance(
            normalizeC61EvaluationText(
              restoreC61Surface(graph, path).displayText,
            ),
            normalizeC61EvaluationText(target),
          ),
        ),
      );
      const oracle = exactC61LegalPathOracle(graph, target);
      expect(oracle.error).toBe(exhaustive);
      expect(validateC61Path(graph, oracle.nodeIds).valid).toBe(true);
      expect(unrestrictedC61SlotOracle(graph, target)).toBeLessThanOrEqual(
        oracle.error,
      );
    },
  );
  it("distinguishes a legal novel-path gain from the illegal slot upper bound", () => {
    const graph = makeLattice([
      candidate("w", "甲乙", "WHISPER"),
      candidate("r", "丙丁", "REAZON"),
    ]);
    expect(exactC61LegalPathOracle(graph, "甲丁").error).toBe(1);
    expect(unrestrictedC61SlotOracle(graph, "甲丁")).toBe(0);
    const legal = makeLattice([
      candidate("w", "正前共誤後", "WHISPER"),
      candidate("r", "誤前共正後", "REAZON"),
    ]);
    expect(exactC61LegalPathOracle(legal, "正前共正後").error).toBe(0);
  });
  it("ignores an invented edge even when it declares candidate support", () => {
    const graph = makeLattice([
      candidate("w", "甲乙", "WHISPER"),
      candidate("r", "丙丁", "REAZON"),
    ]);
    const left = c61Require(
      graph.candidatePaths.find((path) => path.candidateId === "w"),
    ).nodeIds;
    const right = c61Require(
      graph.candidatePaths.find((path) => path.candidateId === "r"),
    ).nodeIds;
    graph.edges.push({
      edgeId: "fake",
      fromNode: c61Require(left[1]),
      toNode: c61Require(right[2]),
      supportingCandidateIds: ["r"],
      providerFamilies: ["REAZON"],
      correlationGroups: ["REAZON-group"],
      observedAdjacency: true,
      semanticHash: "d".repeat(64),
    });
    expect(exactC61LegalPathOracle(graph, "甲丁").error).toBe(1);
  });
  it("rejects cross-event/cyclic topology instead of applying an unconstrained oracle", () => {
    const graph = makeLattice([candidate("w", "甲乙", "WHISPER")]);
    const first = c61Require(graph.edges[0]);
    graph.edges.push({
      ...first,
      edgeId: "cycle",
      fromNode: first.toNode,
      toNode: first.fromNode,
    });
    expect(() => exactC61LegalPathOracle(graph, "甲乙")).toThrow("INVALID_DAG");
  });
  it("handles empty Gold, rejects null Gold, and never splits combining/astral characters", () => {
    const graph = makeLattice([candidate("w", "𠮷か\u3099", "WHISPER")]);
    expect(exactC61LegalPathOracle(graph, "").error).toBe(2);
    expect(exactC61LegalPathOracle(graph, "𠮷が").error).toBe(0);
    expect(c61EvaluationEditDistance("👩‍🔬", "👨‍🔬")).toBe(1);
    expect(normalizeC61EvaluationText("はい\\Nはい")).toBe("はいはい");
    expect(() =>
      exactC61LegalPathOracle(graph, null as unknown as string),
    ).toThrow("GOLD_TEXT_REQUIRED");
  });
});

describe("C6.1 independently audited surface provenance", () => {
  it("accepts a preferred actual candidate surface on a merged normalized node", () => {
    const candidates = [
      candidate("w", "Ａ", "WHISPER"),
      candidate("r", "A", "REAZON"),
    ];
    const graph = makeLattice(candidates);
    for (const candidateId of ["w", "r"]) {
      const selected = directPath(graph, candidates, candidateId);
      const audit = auditC61Consensus({
        paths: [profilePath(graph, selected)],
        lattices: [graph],
        productionTextMutation: 0,
        productionTimingMutation: 0,
        runtimeGoldInputCount: 0,
      });
      expect(audit.safety.engineeringPassed).toBe(true);
      expect(
        audit.provenance.paths[0]?.tokens
          .map((token) => token.outputSurface)
          .join(""),
      ).toBe(selected.displayText);
    }
  });
  it("rejects forged display text and reports synthetic kanji", () => {
    const candidates = [candidate("w", "はし", "WHISPER")];
    const graph = makeLattice(candidates);
    const forged = withPathHash(directPath(graph, candidates, "w"), {
      displayText: "橋",
      normalizedText: "橋",
    });
    const audit = auditC61Consensus({
      paths: [profilePath(graph, forged)],
      lattices: [graph],
      productionTextMutation: 0,
      productionTimingMutation: 0,
      runtimeGoldInputCount: 0,
    });
    expect(audit.safety.engineeringPassed).toBe(false);
    expect(audit.safety.counts.unprovenSurfaceRestorationCount).toBe(1);
    expect(audit.safety.counts.syntheticKanjiGenerationCount).toBe(1);
  });
  it("does not accept stale path hashes and never hides Gold/timing/production mutation", () => {
    const candidates = [candidate("w", "音", "WHISPER")];
    const graph = makeLattice(candidates);
    const selected = {
      ...directPath(graph, candidates, "w"),
      semanticHash: "f".repeat(64),
    };
    const audit = auditC61Consensus({
      paths: [profilePath(graph, selected)],
      lattices: [graph],
      productionTextMutation: 1,
      productionTimingMutation: 2,
      runtimeGoldInputCount: 1,
    });
    expect(audit.safety.engineeringPassed).toBe(false);
    expect(audit.safety.counts.productionMutationCount).toBe(3);
    expect(audit.safety.counts.GoldRuntimeLeakCount).toBe(1);
    expect(audit.safety.paths[0]?.reasons).toContain(
      "SELECTED_PATH_HASH_MISMATCH",
    );
  });
});

describe("C6.1 shadow assembly boundaries", () => {
  it("changes only an exact event span without touching production text, timing or structure", () => {
    const base = production("甲乙丙");
    const original = structuredClone(base);
    const item = proposal("e1", 1, "乙", "丁");
    const result = assembleC61Shadow({
      profileId: "P1",
      production: base,
      events: [item.event],
      paths: [item.path],
      lattices: [item.graph],
    });
    expect(result.subtitlePackage.cues[0]?.text).toBe("甲丁丙");
    expect(result.changedCueIds).toEqual(["cue-1"]);
    expect(
      result.subtitlePackage.cues.map((cue) => [cue.id, cue.start, cue.end]),
    ).toEqual(original.cues.map((cue) => [cue.id, cue.start, cue.end]));
    expect(base).toEqual(original);
    expect(base.subtitleFiles.srt).toBe("production.srt");
    expect(result.subtitlePackage.primarySubtitle?.validationStatus).toBe(
      "needs-review",
    );
    expect(result.ass).toContain("甲丁丙");
  });
  it("keeps P0 unchanged and uses source codepoints instead of UTF-16 indices", () => {
    const base = production("𠮷甲乙");
    const item = proposal("e1", 1, "甲", "丙");
    const common = {
      production: base,
      events: [item.event],
      paths: [item.path],
      lattices: [item.graph],
    };
    expect(
      assembleC61Shadow({ ...common, profileId: "P1" }).subtitlePackage.cues[0]
        ?.text,
    ).toBe("𠮷丙乙");
    expect(
      assembleC61Shadow({ ...common, profileId: "P0" }).subtitlePackage.cues[0]
        ?.text,
    ).toBe(base.cues[0]?.text);
  });
  it("rejects stale, out-of-bounds, unmodifiable and current-text-mismatched spans", () => {
    for (const changes of [
      { spanText: "旧" },
      { spanEnd: 100 },
      { modifiable: false },
      { spanStart: 1.5 },
    ]) {
      const item = proposal("e1", 1, "乙", "丁");
      item.event.finalSpan = {
        ...c61Require(item.event.finalSpan),
        ...changes,
      };
      const result = assembleC61Shadow({
        profileId: "P1",
        production: production(),
        events: [item.event],
        paths: [item.path],
        lattices: [item.graph],
      });
      expect(result.changedCueIds).toEqual([]);
      expect(result.decisions[0]?.status).toBe("UNMAPPABLE_LINEAGE");
    }
    const item = proposal("e1", 1, "乙", "丁");
    item.event.currentText = "旧";
    expect(
      assembleC61Shadow({
        profileId: "P1",
        production: production(),
        events: [item.event],
        paths: [item.path],
        lattices: [item.graph],
      }).decisions[0]?.status,
    ).toBe("UNMAPPABLE_LINEAGE");
  });
  it("revalidates surface and graph proof even if a forged path claims both safety flags", () => {
    const item = proposal("e1", 1, "乙", "丁");
    item.path.path = withPathHash(c61Require(item.path.path), {
      displayText: "龍",
      normalizedText: "龍",
      pathLegal: true,
      provenanceComplete: true,
    });
    const result = assembleC61Shadow({
      profileId: "P1",
      production: production(),
      events: [item.event],
      paths: [item.path],
      lattices: [item.graph],
    });
    expect(result.decisions[0]?.status).toBe("BLOCKED_UNSAFE");
    expect(result.changedCueIds).toEqual([]);
  });
  it("fails closed without the required matching event lattice", () => {
    const item = proposal("e1", 1, "乙", "丁");
    const result = assembleC61Shadow({
      profileId: "P1",
      production: production(),
      events: [item.event],
      paths: [item.path],
      lattices: [],
    });
    expect(result.decisions[0]?.status).toBe("BLOCKED_UNSAFE");
  });
  it("overlap holds every cue proposal with input-order invariant decisions and rendering", () => {
    const items = [
      proposal("a", 0, "甲乙", "丁丁"),
      proposal("b", 1, "乙丙", "戊戊"),
      proposal("c", 3, "末", "終"),
    ];
    const run = (input: typeof items) =>
      assembleC61Shadow({
        profileId: "P1",
        production: production("甲乙丙末"),
        events: input.map((item) => item.event),
        paths: input.map((item) => item.path),
        lattices: input.map((item) => item.graph),
      });
    const forward = run(items);
    const reverse = run([...items].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.changedCueIds).toEqual([]);
    expect(
      forward.decisions.every(
        (decision) => decision.status === "CONFLICTING_REPLACEMENT",
      ),
    ).toBe(true);
  });
  it("composes disjoint exact spans in reverse source-index order", () => {
    const items = [
      proposal("a", 0, "甲", "丁丁"),
      proposal("b", 2, "丙", "戊"),
    ];
    const result = assembleC61Shadow({
      profileId: "P1",
      production: production(),
      events: items.map((item) => item.event),
      paths: items.map((item) => item.path),
      lattices: items.map((item) => item.graph),
    });
    expect(result.subtitlePackage.cues[0]?.text).toBe("丁丁乙戊");
    expect(result.subtitlePackage.cues).toHaveLength(1);
  });
  it("holds full-cue epsilon deletion instead of emitting an invalid empty cue", () => {
    const item = proposal("e1", 0, "音", "");
    const result = assembleC61Shadow({
      profileId: "P1",
      production: production("音"),
      events: [item.event],
      paths: [item.path],
      lattices: [item.graph],
    });
    expect(result.changedCueIds).toEqual([]);
    expect(result.subtitlePackage.cues[0]?.text).toBe("音");
    expect(result.decisions[0]?.status).toBe("PRESENTATION_CAPACITY");
  });
});
