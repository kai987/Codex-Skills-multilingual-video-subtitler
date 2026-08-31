import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  c612GeneratedSchemas,
  c612LegacyMaterialSchema,
  c612RerankingFreezeSchema,
} from "@mvl/shared";
import { c612EvidenceFixture, SHA } from "../helpers/c612-fixture.js";
import { C612_RERANKERS } from "../../packages/video-subtitler/src/consensus/top-k/linear-reranker.js";
import { runC612Oof } from "../../packages/video-subtitler/src/consensus/top-k/top-k-oof-reranking.js";
import {
  assembleC612WholeCandidates,
  buildGroupConfigurations,
  renderC612Shadow,
} from "../../packages/video-subtitler/src/consensus/top-k/group-shadow-configurations.js";
import { evaluateC612Quality } from "../../packages/video-subtitler/src/consensus/top-k/c612-quality-evaluation.js";
import {
  evaluateRetrieval,
  evaluateGroupText,
} from "../../packages/video-subtitler/src/consensus/top-k/fixed-group-evaluation.js";
import {
  artifact,
  hash,
  c612Defined,
} from "../../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { decideC612Route } from "../../packages/video-subtitler/src/consensus/top-k/c612-route-decision.js";
import { readC612GoldAfterFreeze } from "../../packages/video-subtitler/src/consensus/top-k/c612-evaluation-barrier.js";
import {
  verifyRerankingFreeze,
  safeC612ArtifactPath,
} from "../../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { editDistance } from "../../packages/video-subtitler/src/consensus/top-k/c612-structural.js";
import {
  auditC612ShareableValue,
  verifyC612MetricArithmetic,
  verifyC612OofIsolation,
} from "../../packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.js";
function syntheticFlow(reverse = false) {
  const f = c612EvidenceFixture(10),
    before = hash(f.production),
    labels = f.labels();
  const oof = runC612Oof({
    features: reverse ? [...f.features.rows].reverse() : f.features.rows,
    sets: reverse ? [...f.top.topK.sets].reverse() : f.top.topK.sets,
    completeness: f.complete.completeness.rows,
    contractions: f.contraction.rows,
    labels: reverse
      ? [...labels.labels.labels].reverse()
      : labels.labels.labels,
    folds: f.folds,
    featureHash: f.features.semanticHash,
  });
  const group = buildGroupConfigurations({
    rankings: oof.rankings.rows,
    rankingHash: oof.rankings.semanticHash,
    groups: f.mapped.mapping.groups,
    mappingHash: f.mapped.mapping.semanticHash,
    production: f.production,
    universe: f.universe,
  });
  const shadows = C612_RERANKERS.map((p) =>
    renderC612Shadow(
      f.production,
      f.universe,
      group.groupDecisions.rows
        .filter((d) => d.profileId === p.id)
        .flatMap((d) => d.selections),
      p.id,
    ),
  );
  const quality = evaluateC612Quality({
    frozen: f.frozen,
    gold: f.gold,
    bindings: labels.groupLabels.rows,
    goldBindingHash: labels.groupLabels.goldBindingHash,
    labels: labels.labels.labels,
    rankings: oof.rankings.rows,
    rankingsHash: oof.rankings.semanticHash,
    decisions: group.groupDecisions.rows,
    decisionsHash: group.groupDecisions.semanticHash,
    configurations: group.configurations.rows,
    configurationsHash: group.configurations.semanticHash,
  });
  const retrieval = evaluateRetrieval({
    labels: labels.labels.labels,
    ranks: f.ranks.rows,
    sets: f.top.topK.sets,
    freezeHash: f.frozen.freeze.semanticHash,
  });
  const material = c612LegacyMaterialSchema.parse(
    artifact("c6-1-2-fixed-legacy-material-evaluation", {
      evaluationOnly: true,
      privacy: "LOCAL_ONLY",
      machineFreezeHash: f.frozen.freeze.semanticHash,
      alignmentFrozenOnce: true,
      baselineAlignmentHash: SHA,
      baselineMaterialErrors: 77,
      baselineExpectedParity: true,
      profiles: quality.cv.profiles.map((p) => ({
        profileId: p.profileId,
        materialErrors: 77 + (p.materialDelta ?? 0),
        materialDelta: p.materialDelta ?? 0,
        fixedMatching: true,
      })),
      legacyOnlyNotTrainingLabels: true,
    }),
  );
  const route = decideC612Route({
    frozen: f.frozen,
    cv: quality.cv,
    retrieval,
    material,
    engineeringChecks: [
      {
        name: "SYNTHETIC_ONLY",
        passed: true,
        observed: "synthetic fixture",
        expected: "synthetic fixture",
      },
    ],
  });
  expect(hash(f.production)).toBe(before);
  return { f, labels, oof, group, shadows, quality, retrieval, route };
}
describe("C6.1.2 synthetic offline investigation E2E", () => {
  it(
    "runs all T0-T3 and L0-L8/A0-A8 through fixed-group OOF, bounded shadows and route",
    { timeout: 60_000 },
    () => {
      const s = syntheticFlow();
      expect(s.f.top.conservation.passed).toBe(true);
      expect(s.oof.models.models).toHaveLength(90);
      expect(s.oof.rankings.rows).toHaveLength(180);
      expect(s.quality.cv.profiles).toHaveLength(9);
      expect(s.quality.ablations.profiles).toHaveLength(9);
      expect(s.quality.cv.folds).toHaveLength(90);
      expect(s.shadows).toHaveLength(18);
      expect(
        s.shadows.every((v) => v.cues.length === s.f.production.cues.length),
      ).toBe(true);
      for (const g of s.f.mapped.mapping.groups)
        for (const p of C612_RERANKERS) {
          const configs = s.group.configurations.rows.filter(
            (c) => c.groupId === g.groupId && c.profileId === p.id,
          );
          expect(configs.length).toBeLessThanOrEqual(16);
          expect(
            configs.some((c) => c.kind === "CURRENT_ALL" && c.eligible),
          ).toBe(true);
          expect(configs.every((c) => c.selections.length <= 2)).toBe(true);
        }
      expect(s.route.productionStatus).toBe("needs-review");
      expect(s.route.machineOnlyReleaseAuthorized).toBe(false);
      for (const value of [
        s.f.frozen.freeze,
        s.f.frozen.profiles,
        s.f.frozen.baseline,
        s.f.ranks,
        s.f.top.topK,
        s.f.top.conservation,
        s.f.top.comparison,
        s.f.correlation.identity,
        s.f.correlation.reconciliation,
        s.f.correlation.audit,
        s.f.complete.completeness,
        s.f.complete.edge,
        s.f.scores,
        s.f.contraction,
        s.f.mapped.mapping,
        s.f.mapped.audit,
        s.f.folds,
        s.f.features,
        s.labels.labels,
        s.labels.groupLabels,
        s.oof.models,
        s.oof.thresholds,
        s.oof.rankings,
        s.oof.decisions,
        s.group.configurations,
        s.group.groupDecisions,
        ...Object.values(s.quality),
        s.retrieval,
        s.route,
      ]) {
        const entry = c612GeneratedSchemas.find(
          ([n]) => n === value.artifactType,
        );
        expect(entry, value.artifactType).toBeDefined();
        expect(
          c612Defined(entry)[1].safeParse(value).success,
          value.artifactType,
        ).toBe(true);
        const { semanticHash, ...body } = value;
        expect(semanticHash).toBe(hash(body));
      }
    },
  );
  it(
    "replays models, thresholds, metrics and subtitle bytes independently under reordered input",
    { timeout: 60_000 },
    () => {
      const a = syntheticFlow(),
        b = syntheticFlow(true);
      expect(b.oof).toEqual(a.oof);
      expect(b.group).toEqual(a.group);
      expect(b.quality).toEqual(a.quality);
      expect(b.route).toEqual(a.route);
      expect(b.shadows.map((s) => hash([s.ass, s.srt, s.vtt]))).toEqual(
        a.shadows.map((s) => hash([s.ass, s.srt, s.vtt])),
      );
    },
  );
  it("uses actual joint group text instead of summing local event gains", () => {
    const before = "ab",
      afterA = "ba",
      afterB = "aa",
      afterJoint = "bb",
      gold = "ba";
    const localSum =
        2 * editDistance(before, gold) -
        editDistance(afterA, gold) -
        editDistance(afterB, gold),
      joint = editDistance(before, gold) - editDistance(afterJoint, gold);
    expect(joint).not.toBe(localSum);
    const f = c612EvidenceFixture(1),
      g = c612Defined(f.mapped.mapping.groups[0]),
      id = c612Defined(g.cueIds[0]);
    const binding = {
      ...c612Defined(f.labels().groupLabels.rows[0]),
      goldCueIds: ["g"],
      baselineExactError: editDistance(before, gold),
      baselineNormalizedError: editDistance(before, gold),
      goldCharacterCount: 2,
      baselineMaterial: 0,
    };
    const cue = { id, start: 1, end: 3, text: before },
      result = evaluateGroupText(
        g,
        binding,
        [{ ...cue, text: afterJoint }],
        [cue],
        [{ id: "g", start: 1, end: 3, text: gold }],
      );
    expect(result.normalizedGain).toBe(joint);
  });
  it("jointly assembles two disjoint event spans in one cue before evaluating", () => {
    const f = c612EvidenceFixture(2),
      current = c612Defined(f.production.cues[0]).text,
      production = {
        ...f.production,
        cues: [
          { ...c612Defined(f.production.cues[0]), text: current + current },
        ],
      };
    const universe = {
      ...f.universe,
      events: f.universe.events.map((e, i) => ({
        ...e,
        finalCueIds: [c612Defined(production.cues[0]).id],
        finalSpan: {
          ...c612Defined(e.finalSpan),
          finalCueId: c612Defined(production.cues[0]).id,
          spanStart: i * Array.from(current).length,
          spanEnd: (i + 1) * Array.from(current).length,
          spanText: current,
        },
      })),
    };
    const selections = universe.events.map((e) => ({
      eventId: e.eventId,
      candidateId: c612Defined(
        universe.candidates.find(
          (c) =>
            c.eventId === e.eventId &&
            c.inclusionStatus === "INCLUDED" &&
            c.displayText === "曇り",
        ),
      ).candidateId,
    }));
    const first = assembleC612WholeCandidates(production, universe, [
        c612Defined(selections[0]),
      ]),
      second = assembleC612WholeCandidates(production, universe, [
        c612Defined(selections[1]),
      ]),
      joint = assembleC612WholeCandidates(production, universe, selections);
    expect(first.eligible && second.eligible && joint.eligible).toBe(true);
    expect(joint.cues).toHaveLength(1);
    expect(c612Defined(joint.cues[0]).text).toBe("曇り曇り");
    const gold = c612Defined(f.gold[0]).text,
      before = editDistance(c612Defined(production.cues[0]).text, gold),
      actual = before - editDistance(c612Defined(joint.cues[0]).text, gold),
      sum =
        2 * before -
        editDistance(c612Defined(first.cues[0]).text, gold) -
        editDistance(c612Defined(second.cues[0]).text, gold);
    expect(actual).not.toBe(sum);
  });
  it("rejects novel candidate IDs and cross-event candidates without touching production", () => {
    const f = c612EvidenceFixture(),
      before = hash(f.production);
    const missing = assembleC612WholeCandidates(f.production, f.universe, [
      { eventId: "event-0", candidateId: "invented" },
    ]);
    expect(missing.eligible).toBe(false);
    const other = c612Defined(
      f.universe.candidates.find(
        (c) =>
          c.eventId === "event-1" &&
          c.providerFamily !== "CURRENT" &&
          c.inclusionStatus === "INCLUDED",
      ),
    );
    expect(
      assembleC612WholeCandidates(f.production, f.universe, [
        { eventId: "event-0", candidateId: other.candidateId },
      ]).eligible,
    ).toBe(false);
    expect(hash(f.production)).toBe(before);
  });
  it(
    "reports abstain-all without calling zero selections positive validation",
    { timeout: 60_000 },
    () => {
      const s = syntheticFlow(),
        cv = {
          ...s.quality.cv,
          profiles: s.quality.cv.profiles.map((p) =>
            p.profileId === "L6"
              ? {
                  ...p,
                  selectedGroups: 0,
                  evaluatedChangedGroups: 0,
                  precision: null,
                  harm: null,
                  changedGroupEvaluationCoverage: null,
                  normalizedJointGain: 0,
                  activeFolds: 0,
                }
              : p,
          ),
        };
      const material = c612LegacyMaterialSchema.parse(
        artifact("c6-1-2-fixed-legacy-material-evaluation", {
          evaluationOnly: true,
          privacy: "LOCAL_ONLY",
          machineFreezeHash: SHA,
          alignmentFrozenOnce: true,
          baselineAlignmentHash: SHA,
          baselineMaterialErrors: 77,
          baselineExpectedParity: true,
          profiles: [
            {
              profileId: "L6",
              materialErrors: 77,
              materialDelta: 0,
              fixedMatching: true,
            },
          ],
          legacyOnlyNotTrainingLabels: true,
        }),
      );
      const route = decideC612Route({
        frozen: s.f.frozen,
        cv,
        retrieval: s.retrieval,
        material,
        engineeringChecks: [
          { name: "fixture", passed: true, observed: "ok", expected: "ok" },
        ],
      });
      expect(route.strongSupportPassed).toBe(false);
      expect(route.c613).toBe("HOLD");
      expect(route.reasons).toContain("activeFolds");
    },
  );
  it(
    "independently verifies isolation and arithmetic and rejects tampering",
    { timeout: 60_000 },
    () => {
      const flow = syntheticFlow();
      expect(() =>
        verifyC612OofIsolation(
          flow.f.folds,
          flow.oof.models,
          flow.oof.thresholds,
          flow.oof.rankings,
          flow.f.ranks.eligibleEventIds,
        ),
      ).not.toThrow();
      expect(() => verifyC612MetricArithmetic(flow.quality.cv)).not.toThrow();
      const changed = {
        ...flow.quality.cv,
        profiles: flow.quality.cv.profiles.map((p, i) =>
          i === 0
            ? { ...p, normalizedJointGain: (p.normalizedJointGain ?? 0) + 1 }
            : p,
        ),
      };
      expect(() => verifyC612MetricArithmetic(changed)).toThrow("JOINT_GAIN");
      const missing = {
        ...flow.oof.rankings,
        rows: flow.oof.rankings.rows.slice(1),
      };
      expect(() =>
        verifyC612OofIsolation(
          flow.f.folds,
          flow.oof.models,
          flow.oof.thresholds,
          missing,
          flow.f.ranks.eligibleEventIds,
        ),
      ).toThrow("EVENT_CONSERVATION");
    },
  );
  it("fails shareable audit on raw text, private paths or credentials", () => {
    expect(auditC612ShareableValue({ route: "HOLD", count: 10 }).passed).toBe(
      true,
    );
    expect(
      auditC612ShareableValue({ text: "synthetic-only" }).rawTextFieldCount,
    ).toBe(1);
    expect(
      auditC612ShareableValue({ path: "/Users/example/source.wav" })
        .absolutePathLeakCount,
    ).toBe(1);
    expect(
      auditC612ShareableValue({ token: "hf_" + "x".repeat(30) }).secretCount,
    ).toBe(1);
  });
});
describe("C6.1.2 Gold and artifact barriers E2E", () => {
  it("fails before touching Gold when a self-consistent freeze omits required files", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "c612-gold-barrier-")),
      f = c612EvidenceFixture(1);
    await mkdir(path.join(tmp, "machine"));
    await writeFile(
      path.join(tmp, "machine/c6-1-2-machine-freeze-manifest.json"),
      JSON.stringify(f.frozen.freeze),
    );
    const gold = path.join(tmp, "gold-must-not-be-opened.ass");
    await expect(
      readC612GoldAfterFreeze({
        a: tmp,
        b: tmp,
        repository: path.resolve(import.meta.dirname, "../.."),
        gold,
      }),
    ).rejects.toThrow("REQUIRED_FILE_SET_MISSING");
    await expect(readFile(gold)).rejects.toThrow("ENOENT");
  });
  it("rejects an empty but correctly self-hashed reranking freeze", async () => {
    const tmp = await mkdtemp(
      path.join(os.tmpdir(), "c612-reranking-barrier-"),
    );
    await mkdir(path.join(tmp, "reranking"));
    const freeze = c612RerankingFreezeSchema.parse(
      artifact("c6-1-2-reranking-freeze", {
        frozenAt: "2000-01-01T00:00:00.000Z",
        machineFreezeHash: SHA,
        files: [],
        fileAggregateHash: hash([]),
        modelHash: SHA,
        rankingHash: SHA,
        groupDecisionHash: SHA,
        rawGoldReadByTrainingProcess: false,
        outerTestLabelsUsedByPrediction: false,
      }),
    );
    await writeFile(
      path.join(tmp, "reranking/c6-1-2-reranking-freeze.json"),
      JSON.stringify(freeze),
    );
    await expect(verifyRerankingFreeze(tmp)).rejects.toThrow(
      "REQUIRED_FILE_SET_MISSING",
    );
  });
  it("rejects path traversal and symlink escapes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "c612-reference-")),
      outside = await mkdtemp(path.join(os.tmpdir(), "c612-external-"));
    await writeFile(path.join(outside, "external.json"), "{}");
    await symlink(
      path.join(outside, "external.json"),
      path.join(root, "link.json"),
    );
    await expect(
      safeC612ArtifactPath(root, "../external.json"),
    ).rejects.toThrow("PATH_ESCAPE");
    await expect(safeC612ArtifactPath(root, "link.json")).rejects.toThrow(
      "SYMLINK_OR_ESCAPE",
    );
  });
});
