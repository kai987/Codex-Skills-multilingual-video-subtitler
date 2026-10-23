import { describe, it, expect } from "vitest";
import { evidence } from "./helpers/c60116-quality-fixture.js";
import {
  freshMatchedEvidenceSchema,
  replayPrimaryAssembly,
} from "../packages/video-subtitler/src/machine-quality/matched-replay.js";
import {
  COMPOSED_MATRIX,
  COMPOSED_STATE,
  replayComposedAssembly,
  replayComposedMatrix,
} from "../packages/video-subtitler/src/machine-quality/composed-profile.js";
import {
  factorialEffects,
  primarySequenceStatus,
  actualExportDiff,
} from "../packages/video-subtitler/src/machine-quality/composed-evaluation.js";
import { primaryMinimal } from "../packages/video-subtitler/src/machine-quality/experimental-profile.js";
import { deduplicateTopScoreWinners } from "../packages/transcription-core/src/winner-deduplication.js";
import { repairIntraCueHypothesisRepetition } from "../packages/transcription-core/src/intra-cue-repetition.js";
import { evaluateQuality } from "../packages/video-subtitler/src/machine-quality/experimental-metrics.js";
import { aggregateTextMetrics } from "../packages/video-subtitler/src/machine-quality/representative-evaluation.js";
const fixture = () => {
  const e = evidence();
  return freshMatchedEvidenceSchema.parse({
    version: "c60117-fresh-primary-v1",
    promptStatus: "FRESH_PROMPT_FREE",
    partition: e.partition,
    source: e.source,
    primaryRequests: e.primaryRequests,
  });
};
const stable = (v: unknown) =>
  JSON.stringify(v, (k: string, x: unknown) =>
    k === "generatedAt" ? undefined : x,
  );
const cue = (text: string) => ({
  id: "neutral",
  text,
  start: 1,
  end: 5,
  language: "ja" as const,
  languages: ["ja" as const],
  speaker: null,
  confidence: null,
});
describe("fixed composed policies", () => {
  it("maps every cell to the real existing functions with no extra hooks", () => {
    const e = fixture(),
      before = stable(e),
      matrix = replayComposedMatrix(e);
    for (const { policy, result } of matrix) {
      if (policy === null) {
        expect(result.cues).toEqual(primaryMinimal(e));
        continue;
      }
      const direct = replayPrimaryAssembly(
        e,
        policy.intraCuePolicy === "source-preserving",
        {},
        undefined,
        undefined,
        undefined,
        { deduplication: policy.interCuePolicy },
      );
      expect(stable(result)).toBe(stable(direct));
      expect(result.trace.map((t) => t.stageName)).toEqual([
        "primaryMinimal",
        "deduplicateTopScoreWinners",
        "repairIntraCueHypothesisRepetition",
        "buildAcousticSemanticCueSegments",
        "layoutSubtitleCuesWithDiagnostics",
      ]);
    }
    expect(stable(e)).toBe(before);
    expect(COMPOSED_STATE.mainCandidate).toBe("G11-composed");
  });
  it("explicit single and double disable semantics reproduce G10/G01/G00", () => {
    const e = fixture(),
      matrix = replayComposedMatrix(e);
    for (const id of ["G10-cross-guard", "G01-intra-guard", "G00-legacy"]) {
      const target = matrix.find((v) => v.id === id);
      if (!target) throw Error("fixture");
      expect(stable(replayComposedAssembly(e, target.policy))).toBe(
        stable(target.result),
      );
    }
    expect(matrix[1]?.result.cues).toEqual(
      replayPrimaryAssembly(e, false).cues,
    );
    expect(matrix[2]?.result.cues).toEqual(
      replayPrimaryAssembly(e, false, {}, undefined, undefined, undefined, {
        deduplication: "overlap-required",
      }).cues,
    );
  });
  it("does not differ before the intra stage for either matched inter-cue pair", () => {
    const m = replayComposedMatrix(fixture());
    for (const [a, b] of [
      [1, 3],
      [2, 4],
    ]) {
      const x = m[a ?? 0]?.result.trace,
        y = m[b ?? 0]?.result.trace;
      if (!x || !y) throw Error("fixture");
      expect(stable(x.slice(0, 2))).toBe(stable(y.slice(0, 2)));
      expect(x[2]?.inputHash).toBe(y[2]?.inputHash);
    }
  });
  it("both guards preserve nonoverlapping occurrences and lexical repeats without confirmation", () => {
    const r = replayComposedMatrix(fixture())[4]?.result;
    if (!r) throw Error("fixture");
    expect(r.trace[1]?.outputCueCount).toBe(2);
    expect(r.trace[2]?.output.map((c) => c.text)).toEqual([
      "走れ!走れ!",
      "走れ!走れ!",
    ]);
    expect([
      ...new Set(
        r.trace.flatMap((t) => t.operations).map((o) => o.acousticTruth),
      ),
    ]).toEqual(["UNKNOWN"]);
  });
  it("same-source request reimport remains idempotent and conflict fails", () => {
    const e = fixture(),
      r = e.primaryRequests[0];
    if (!r) throw Error("fixture");
    const once = replayComposedMatrix(e);
    e.primaryRequests.push(structuredClone(r));
    expect(replayComposedMatrix(e).map((v) => v.result.cues)).toEqual(
      once.map((v) => v.result.cues),
    );
    const copy = e.primaryRequests[1];
    if (!copy) throw Error("fixture");
    copy.resultHash = "b".repeat(64);
    expect(() => replayComposedMatrix(e)).toThrow();
  });
  it("refuses undeclared hooks and Gold fields", () => {
    const p = COMPOSED_MATRIX[4].policy;
    for (const k of ["acoustic", "stored", "groups", "gold", "reference"])
      expect(() =>
        replayComposedAssembly(fixture(), { ...p, [k]: [] }),
      ).toThrow();
    expect(() =>
      replayComposedMatrix({ ...fixture(), gold: "answer" }),
    ).toThrow();
  });
  it("overlap alone is not a sufficient duplicate predicate", () => {
    const a = cue("明日は晴れるでしょう。"),
      b = { ...cue("コーヒーをお願いします。"), id: "other" };
    expect(
      deduplicateTopScoreWinners([a, b], "pre-normalization", {
        requireTemporalOverlap: true,
      }).cues,
    ).toHaveLength(2);
  });
  it("retains known decoder-loop fixture but does not certify its speech truth; evaluator exposes harm", () => {
    const c = cue("こちらへ来て!こちらへ来て!");
    const r = repairIntraCueHypothesisRepetition({
      cues: [c],
      repetitionPolicy: "source-preserving",
    });
    expect(r.cues[0]?.text).toBe(c.text);
    expect(r.artifact.summary.trueSpokenRepetitionCount).toBe(0);
    expect(r.artifact.records[0]?.audioRepetitionEvidence).toContain(
      "source-preservation-is-not-acoustic-confirmation",
    );
    expect(
      evaluateQuality(r.cues, [cue("こちらへ来て!")]).normalized.I,
    ).toBeGreaterThan(0);
  });
  it("does not restore stale raw wording after an earlier legitimate edit", () => {
    const c = {
      ...cue("こちらへ来て!こちらへ来て!"),
      textAudit: {
        rawAsrText: "old wrong raw",
        repairedText: "",
        normalizedText: "",
        winnerClusterIds: [],
        sourceWinnerCueIds: [],
        replacements: [],
        deduplicationActions: [],
      },
    };
    expect(
      repairIntraCueHypothesisRepetition({
        cues: [c],
        repetitionPolicy: "source-preserving",
      }).cues[0]?.text,
    ).toBe(c.text);
  });
  it.each(["Hello, world!", "你好，世界！", "テスト です。"])(
    "keeps unaffected typography semantics: %s",
    (text) => {
      const c = cue(text);
      const a = repairIntraCueHypothesisRepetition({
        cues: [c],
        repetitionPolicy: "legacy",
      });
      const b = repairIntraCueHypothesisRepetition({
        cues: [c],
        repetitionPolicy: "source-preserving",
      });
      expect(a.cues).toEqual(b.cues);
    },
  );
  it("preserves the trusted-lyrics overlap exception", () => {
    const a = {
      ...cue("歌のことば"),
      style: "music" as const,
      textSource: "reference-original-language" as const,
      timingEvidence: { sourceTrusted: true },
    };
    const b = {
      ...cue("歌のことば"),
      id: "asr",
      style: "music" as const,
      provenance: {
        sourceLayer: "lyrics-asr" as const,
        sourceRequestIds: [],
        sourceProfileIds: [],
        referenceAnchorIds: [],
        referenceUnitIds: [],
        recoveryUnitId: null,
        sceneId: null,
        sceneLabel: null,
        independentSupportCount: 1,
        qualityScore: null,
      },
    };
    expect(
      deduplicateTopScoreWinners([a, b], "pre-normalization", {
        requireTemporalOverlap: true,
      }).artifact.records[0]?.kind,
    ).toBe("trusted-reference-original-lyrics");
  });
  it("distinguishes tied CER from complete sequence parity", () => {
    expect(primarySequenceStatus("abc", "abd", 1, 1)).toBe(
      "SEQUENCE_DIFFERENT_BUT_EDIT_DISTANCE_TIED",
    );
    expect(primarySequenceStatus("A！", "a", 1, 1)).toBe(
      "SEQUENCE_EQUAL_TO_PRIMARY",
    );
  });
  it("factorial differences use identical units and micro denominators", () => {
    expect(
      factorialEffects({ E00: 12, E10: 10, E01: 9, E11: 6, P0: 6 }),
    ).toEqual({
      crossUnderLegacy: -2,
      crossUnderPreserving: -3,
      intraUnderLegacy: -3,
      intraUnderOverlap: -4,
      composedVsLegacy: -6,
      composedVsCurrent: -4,
      composedVsMinimal: 0,
      interaction: -1,
    });
    expect(
      aggregateTextMetrics([
        { S: 1, D: 0, I: 0, N: 2, CER: 0.5 },
        { S: 1, D: 0, I: 0, N: 8, CER: 0.125 },
      ]).microCER,
    ).toBe(0.2);
  });
  it("actual export changes count each changed cue once, not every stage", () => {
    const a = cue("before"),
      b = cue("after");
    const diff = actualExportDiff([a], [b]);
    expect(diff.modified).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
  });
});
