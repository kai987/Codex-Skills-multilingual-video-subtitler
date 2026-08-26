import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  buildC60Investigation,
  compareC60InvestigationRuns,
  validateC60InvestigationRun,
  writeC60Investigation,
} from "../../scripts/c6-0-finalization-risk-lib.js";
import { createC60Fixture } from "../helpers/c6-0-fixture.js";

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("C6.0 investigation end-to-end", () => {
  it("writes two mutation-free, shareable-safe, semantically identical runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c6-0-investigation-"));
    roots.push(root);
    const fixture = await createC60Fixture(root);
    const runA = path.join(root, "run-a");
    const runB = path.join(root, "run-b");
    const common = {
      taskRoot: fixture.taskRoot,
      repoRoot: fixture.repoRoot,
      causalTaskRoot: fixture.causalRoot,
      frozenTaskRoot: fixture.frozenRoot,
      generatedAt: "2026-08-27T00:00:00.000Z",
    };
    const artifactsA = await buildC60Investigation({
      ...common,
      outputRoot: runA,
      runLabel: "A",
    });
    const artifactsB = await buildC60Investigation({
      ...common,
      outputRoot: runB,
      runLabel: "B",
    });
    await writeC60Investigation(
      { ...common, outputRoot: runA, runLabel: "A" },
      artifactsA,
    );
    await writeC60Investigation(
      { ...common, outputRoot: runB, runLabel: "B" },
      artifactsB,
    );
    await compareC60InvestigationRuns(runA, runB);
    const validation = await validateC60InvestigationRun(runA);
    expect(validation).toMatchObject({
      artifactCount: 10,
      absolutePathLeakCount: 0,
      secretFindingCount: 0,
      brokenRelativeReferenceCount: 0,
    });
    expect(artifactsA.componentRisk.summary).toMatchObject({
      componentCount: 7,
      speakerRelationshipResolvedComponentCount: 1,
      subtitleOverlapResolvedComponentCount: 0,
      safeRepairMissingComponentCount: 7,
    });
    expect(artifactsA.summary.execution).toEqual({
      modelInferenceCount: 0,
      modelLoadCount: 0,
      networkUsed: false,
      subtitleMutationCount: 0,
      timingMutationCount: 0,
      presentationMutationCount: 0,
    });
    expect(artifactsA.readiness).toMatchObject({
      implementationGo: true,
      defaultReleaseGo: false,
      machineOnlyPathReady: false,
    });
  });
});
