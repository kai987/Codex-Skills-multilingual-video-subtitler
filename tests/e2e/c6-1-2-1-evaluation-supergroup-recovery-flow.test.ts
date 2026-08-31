import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { c6121FileFixture } from "../helpers/c6121-file-fixture.js";
import { SHA } from "../helpers/c612-fixture.js";
import { readC6121GoldText } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/gold-text-barrier.js";
import {
  rebindC6121CandidateLabels,
  auditC6121LabelStability,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import {
  retrainC6121Oof,
  writeC6121Shadows,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/same-profile-oof-retrainer.js";
import { evaluateC6121Profiles } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-profile-evaluation.js";
import {
  c6121Coverage,
  c6121CoverageRecovery,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/supergroup-coverage.js";
import {
  diagnoseC6121Completeness,
  decideC6121Route,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-route-decision.js";
import {
  fingerprintC6121,
  verifyC6121Snapshot,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";
import {
  hash,
  validateC6121Artifact,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
async function syntheticFlow() {
  const s = await c6121FileFixture(),
    before = hash(s.f.production);
  const goldBefore = await fingerprintC6121(s.goldPath, "synthetic-gold");
  const text = await readC6121GoldText({
    directory: s.directory,
    gold: s.goldPath,
    baseline: s.baseline,
    map: s.graph.map,
  });
  const labels = rebindC6121CandidateLabels(
    s.f.frozen,
    s.graph.map,
    text.gold,
    text.barrier.goldByteHash,
  );
  const stability = auditC6121LabelStability(
    s.f.labels().labels.labels,
    labels,
  );
  const trained = retrainC6121Oof(s.f.frozen, s.graph.map, labels, SHA);
  const metrics = evaluateC6121Profiles({
    frozen: s.f.frozen,
    map: s.graph.map,
    gold: text.gold,
    labels: labels.labels.map((l) => l.label),
    rankings: trained.rankings.rows,
    decisions: trained.decisions.rows,
    track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  });
  const coverage = c6121Coverage(
    s.f.frozen,
    s.graph.map,
    s.timing.timing,
    labels.labels.map((l) => l.label),
  );
  const audit = c6121CoverageRecovery(
    s.f.frozen,
    s.graph.map,
    coverage,
    s.f.labels().groupLabels.rows,
  );
  const diagnosis = diagnoseC6121Completeness(
    s.f.frozen,
    labels,
    trained.rankings.rows,
    metrics,
    false,
  );
  const route = decideC6121Route({
    engineering: true,
    aBParity: true,
    productionMutation: 0,
    coverage,
    integrity: s.graph.integrity,
    frozen: metrics.map((p) => ({
      ...p,
      track: "FROZEN_DECISION_REEVALUATION",
    })),
    retrained: metrics,
    completeness: diagnosis,
  });
  const shadows = await writeC6121Shadows(
    s.directory,
    s.f.frozen,
    s.graph.map,
    trained,
  );
  const bytes = await Promise.all(
    shadows.profiles.flatMap((p) =>
      ["ass", "srt", "vtt"].map(async (ext) =>
        hash(
          (
            await readFile(
              path.join(s.directory, p.relativePath, "subtitle." + ext),
            )
          ).toString("utf8"),
        ),
      ),
    ),
  );
  expect(hash(s.f.production)).toBe(before);
  expect(await fingerprintC6121(s.goldPath, "synthetic-gold")).toEqual(
    goldBefore,
  );
  expect(await verifyC6121Snapshot(s.baseline)).toBe(
    s.baseline.inputAggregateHash,
  );
  for (const artifact of [
    labels,
    stability,
    ...Object.values(trained),
    audit,
    diagnosis,
    route,
    shadows,
    text.barrier,
  ])
    expect(() => validateC6121Artifact(artifact)).not.toThrow();
  return {
    graph: s.graph,
    labels,
    stability,
    trained,
    metrics,
    coverage,
    route,
    shadows,
    bytes,
  };
}
describe("C6.1.2.1 synthetic offline evaluator end-to-end", () => {
  it("runs actual file barriers, graph, labels, unchanged OOF, research shadows and route", async () => {
    const run = await syntheticFlow();
    expect(run.graph.integrity.stableShadowEvaluationCount).toBe(10);
    expect(run.metrics).toHaveLength(9);
    expect(run.trained.models.models).toHaveLength(45);
    expect(run.shadows.profiles).toHaveLength(9);
    expect(run.route.productionStatus).toBe("needs-review");
    expect(run.route.finalizationMethod).toBe("none");
  }, 60000);
  it("replays independent A/B with equal semantic decisions and subtitle bytes", async () => {
    const a = await syntheticFlow(),
      b = await syntheticFlow();
    expect(b).toEqual(a);
  }, 60000);
});
