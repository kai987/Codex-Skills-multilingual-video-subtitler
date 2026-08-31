import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { c61211FileFixture } from "../helpers/c61211-file-fixture.js";
import { SHA } from "../helpers/c612-fixture.js";
import { scoringC61211Gold } from "../../packages/video-subtitler/src/consensus/evaluation-partition/gold-barriers.js";
import {
  rebindC61211Labels,
  stabilityC61211,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/partition-label-rebinding.js";
import { rebindC6121CandidateLabels } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import {
  retrainC61211,
  writeC61211Shadows,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/same-feature-oof-retrainer.js";
import {
  evaluateC61211Profiles,
  evidenceC61211Profiles,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/partition-profile-evaluation.js";
import {
  coverageC61211,
  coverageC61211Gate,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/reachable-coverage.js";
import {
  wholeC61211,
  biasC61211,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/whole-component-diagnostic.js";
import {
  completenessC61211,
  decideC61211Route,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/terminal-route.js";
import { hash } from "../../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import {
  writeC61211,
  snapshotC61211,
  shaBytes,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/artifact-io.js";
import {
  validateC61211Tree,
  verifyC61211Metrics,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/artifact-validator.js";
import { fingerprintC6121 } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";

async function flow() {
  const x = await c61211FileFixture(),
    before = hash(x.f.frozen),
    goldBefore = await fingerprintC6121(x.goldPath, "gold");
  const text = await scoringC61211Gold({
    directory: x.directory,
    gold: x.goldPath,
    baseline: x.baseline,
    map: x.p.map,
  });
  const labels = rebindC61211Labels(
    x.f.frozen,
    x.p.map,
    text.gold,
    text.barrier.goldByteHash,
  );
  const stability = stabilityC61211(
    rebindC6121CandidateLabels(
      x.f.frozen,
      x.p.graph.map,
      text.gold,
      text.barrier.goldByteHash,
    ),
    labels,
  );
  const trained = retrainC61211(x.f.frozen, x.p.map, labels, SHA);
  const profiles = evaluateC61211Profiles({
    frozen: x.f.frozen,
    map: x.p.map,
    gold: text.gold,
    labels: labels.labels.map((l) => l.label),
    rankings: trained.rankings.rows,
    decisions: trained.decisions.rows,
    track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  });
  const coverage = coverageC61211(
      x.f.frozen,
      x.p.map,
      x.scope,
      x.timing.rows,
      labels.labels.map((l) => l.label),
    ),
    gate = coverageC61211Gate(coverage, x.integrity);
  const whole = wholeC61211({
    frozen: x.f.frozen,
    graph: x.p.graph,
    map: x.p.map,
    gold: text.gold,
    tracks: [{ profiles, decisions: trained.decisions.rows }],
  });
  const bias = biasC61211(x.p.map, whole, x.integrity, x.cuts, stability);
  const completeness = completenessC61211(
    x.f.frozen,
    labels,
    trained.rankings.rows,
    profiles,
    gate.passed,
  );
  const route = decideC61211Route({
    engineering: true,
    aBParity: true,
    productionMutation: 0,
    conservation: x.integrity,
    coverage: gate,
    bias,
    frozen: [],
    retrained: profiles,
    completeness,
  });
  const shadows = await writeC61211Shadows(x.directory, x.f.frozen, x.p.map, [
    {
      track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
      decisions: trained.decisions.rows,
    },
  ]);
  for (const p of profiles) verifyC61211Metrics(p, x.p.map);
  for (const value of [
    text.barrier,
    labels,
    stability,
    ...Object.values(trained),
    evidenceC61211Profiles(x.p.map, profiles),
    coverage,
    gate,
    whole,
    bias,
    completeness,
    route,
    shadows,
  ])
    await writeC61211(x.directory, value);
  const checked = await validateC61211Tree(x.directory, process.cwd());
  expect(checked).toBeGreaterThan(30);
  const bytes = await Promise.all(
    shadows.rows.flatMap((r) =>
      r.files.map(async (f) =>
        shaBytes(await readFile(path.join(x.directory, f.relativePath))),
      ),
    ),
  );
  expect(hash(x.f.frozen)).toBe(before);
  expect(await fingerprintC6121(x.goldPath, "gold")).toEqual(goldBefore);
  expect(await snapshotC61211(x.baseline)).toBe(x.baseline.inputAggregateHash);
  return {
    map: x.p.map,
    labels,
    stability,
    trained,
    profiles,
    coverage,
    whole,
    bias,
    completeness,
    route,
    shadows,
    bytes,
  };
}
describe("C6.1.2.1.1 actual synthetic file-barrier through terminal-route flow", () => {
  it("executes strict persisted barriers, numeric-only 45-model retrain, joint scoring and offline research shadows", async () => {
    const r = await flow();
    expect(r.trained.models.models).toHaveLength(45);
    expect(r.profiles).toHaveLength(9);
    expect(r.shadows.rows).toHaveLength(9);
    expect(r.route.productionMutation).toBe(0);
    expect(r.route.productionStatus).toBe("needs-review");
    expect(r.route.finalizationMethod).toBe("none");
  }, 60000);
  it("independently replays A/B semantic decisions and all subtitle bytes", async () => {
    const a = await flow(),
      b = await flow();
    expect(b).toEqual(a);
  }, 60000);
});
