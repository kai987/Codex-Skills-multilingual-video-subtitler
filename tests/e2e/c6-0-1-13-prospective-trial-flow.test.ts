import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { humanCorrectionRecordSchema } from "@mvl/shared";
import { startC60112ReviewWorkspaceServer } from "../../packages/video-subtitler/src/review/c60112-review-workspace.js";
import {
  initializeC60113Trial,
  readC60113Trial,
  exportC60113Trial,
} from "../../packages/video-subtitler/src/review/c60113-prospective-trial.js";
import { c60113WorkspaceHash } from "../../packages/video-subtitler/src/review/c60113-review-workspace.js";
import {
  writeC60113SyntheticWorkspace,
  prepareC60113SyntheticTrialPackage,
} from "../fixtures/c60113-workspace-fixture.js";
import {
  buildC60113ProspectiveTrialPackage,
  validateC60113ProspectiveTrialPackage,
} from "../../packages/video-subtitler/src/review/c60113-prospective-trial-package.js";

const roots: string[] = [],
  servers: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("carries immutable machine and compatibility freeze into a portable package usable by the existing review apply command", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "c60113-trial-apply-e2e-"));
  roots.push(root);
  const prepared = await prepareC60113SyntheticTrialPackage(
    path.join(root, "input"),
  );
  const trialRoot = path.join(root, "trial");
  const built = await buildC60113ProspectiveTrialPackage({
    workspaceDirectory: path.join(root, "input"),
    outputDirectory: trialRoot,
    expectedWorkspaceDataHash: c60113WorkspaceHash(prepared.data),
    machinePackageFile: prepared.machinePackageFile,
    reviewPackageFreezeFile: prepared.reviewPackageFreezeFile,
    regionFeatures: prepared.regionFeatures,
    frozenRanker: prepared.frozenRanker,
  });
  await validateC60113ProspectiveTrialPackage(trialRoot);
  const server = await startC60112ReviewWorkspaceServer({
    workspaceDirectory: built.workspaceDirectory,
    expectedWorkspaceDataHash: c60113WorkspaceHash(prepared.data),
  });
  servers.push(server);
  const response = await fetch(new URL("api/decision", server.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mvl-review-request": "c6-0-1-12",
    },
    body: JSON.stringify({
      decisionId: "synthetic-keep",
      reviewItemId: "item-0",
      decisionType: "KEEP_CURRENT",
      selectedCandidateId: null,
      afterText: null,
      afterStart: null,
      afterEnd: null,
      reviewerNote: null,
      expectedReviewPackageSemanticHash:
        prepared.data.reviewPackageSemanticHash,
      expectedMachineDraftHash: prepared.data.machineDraftHash,
    }),
  });
  expect(response.status).toBe(200);
  const session = path.join(built.workspaceDirectory, "session");
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/c6-0-1-12-review-cli.ts",
      "apply",
      "--base-package",
      path.join(trialRoot, "machine-subtitle-package.json"),
      "--freeze",
      path.join(trialRoot, "review-package-freeze.json"),
      "--review-data",
      path.join(built.workspaceDirectory, "review-data.json"),
      "--session",
      path.join(session, "review-session.json"),
      "--corrections",
      path.join(session, "human-correction-log.jsonl"),
      "--audit",
      path.join(session, "review-audit.jsonl"),
      "--output",
      path.join(root, "reviewed"),
    ],
    { cwd: process.cwd(), timeout: 15000 },
  );
  expect((JSON.parse(result.stdout) as { ok: boolean }).ok).toBe(true);
  expect(
    await readFile(path.join(trialRoot, "machine-subtitle-package.json")),
  ).toEqual(await readFile(prepared.machinePackageFile));
}, 20000);

it("runs the unreviewed synthetic region workspace through trial lifecycle, correction, undo and private aggregate export", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "c60113-trial-e2e-"));
  roots.push(root);
  const data = await writeC60113SyntheticWorkspace(root),
    originalHash = c60113WorkspaceHash(data);
  await initializeC60113Trial({
    workspaceDirectory: root,
    data,
    rankerHash: "e".repeat(64),
    synthetic: true,
    declarations: {
      goldUnavailable: true,
      previousHumanSubtitleUnavailable: true,
      reviewerPriorExposure: false,
    },
  });
  const server = await startC60112ReviewWorkspaceServer({
    workspaceDirectory: root,
    expectedWorkspaceDataHash: originalHash,
  });
  servers.push(server);
  const post = (route: string, body: unknown) =>
    fetch(new URL(route, server.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mvl-review-request": "c6-0-1-12",
      },
      body: JSON.stringify(body),
    });
  const lifecycle = async (type: string, id: string) =>
    post("api/trial/event", {
      eventId: id,
      eventType: type,
      expectedReviewPackageHash: data.reviewPackageSemanticHash,
      expectedRankerHash: "e".repeat(64),
      visible: true,
      focused: true,
      interaction: true,
      audioPlaying: false,
      regionId: null,
      itemId: null,
      candidateId: null,
      sourceInterval: null,
      manualCharactersEntered: 0,
      decisionType: null,
    });
  const js = await (
    await fetch(new URL("assets/review.js", server.url))
  ).text();
  expect(() => new Script(js)).not.toThrow();
  for (const control of [
    "REGION_FIRST_V2",
    "UNIQUE_AUDIO_30_PERCENT",
    "USE_AS_EDITING_BASE",
    "Review Timeline Mode",
    "Play new audio only",
    "candidate-diff",
    "reviewInstrumentation",
  ])
    expect(js).toContain(control);
  expect((await lifecycle("TRIAL_STARTED", "start")).status).toBe(200);
  expect(
    (
      await post("api/playback", {
        intervals: [{ start: 4, end: 6 }],
        playbackSeconds: 2,
        playbackCount: 1,
      })
    ).status,
  ).toBe(200);
  const payload = {
    decisionId: "manual-one",
    reviewItemId: "item-0",
    decisionType: "MANUAL_EDIT",
    selectedCandidateId: null,
    afterText: "人が修正した合成文",
    afterStart: null,
    afterEnd: null,
    reviewerNote: null,
    expectedReviewPackageSemanticHash: data.reviewPackageSemanticHash,
    expectedMachineDraftHash: data.machineDraftHash,
    reviewInstrumentation: {
      schemaVersion: "1.0.0",
      regionRank: 1,
      reviewBudget: "UNIQUE_AUDIO_30_PERCENT",
      uniqueAudioSecondsBeforeDecision: 2,
      playedSecondsBeforeDecision: 2,
      candidateUsedAsEditingBase: true,
      initialEditingCandidateId: "candidate-0",
      editDistanceFromCandidate: 7,
      decisionLatencySeconds: 3,
      playbackCount: 1,
    },
  };
  expect((await post("api/decision", payload)).status).toBe(200);
  expect((await readC60113Trial(root, data))?.state.metrics.decisionCount).toBe(
    1,
  );
  expect((await post("api/decision", payload)).status).toBe(200);
  expect((await readC60113Trial(root, data))?.state.metrics.decisionCount).toBe(
    1,
  );
  const correction = humanCorrectionRecordSchema.parse(
    JSON.parse(
      (
        await readFile(
          path.join(root, "session", "human-correction-log.jsonl"),
          "utf8",
        )
      ).trim(),
    ),
  );
  expect(correction.reviewInstrumentation?.initialEditingCandidateId).toBe(
    "candidate-0",
  );
  expect(
    (
      await post("api/undo", {
        undoId: "undo-one",
        expectedReviewPackageSemanticHash: data.reviewPackageSemanticHash,
        expectedMachineDraftHash: data.machineDraftHash,
      })
    ).status,
  ).toBe(200);
  expect(
    (await readC60113Trial(root, data))?.state.metrics.manualEditCount,
  ).toBe(0);
  expect((await lifecycle("DECISION_COMMITTED", "forged")).status).toBe(400);
  expect((await lifecycle("TRIAL_PAUSED", "pause")).status).toBe(200);
  expect((await lifecycle("TRIAL_RESUMED", "resume")).status).toBe(200);
  expect((await lifecycle("TRIAL_COMPLETED", "complete")).status).toBe(200);
  const state = await exportC60113Trial(
    root,
    path.join(root, "trial-metrics-export.json"),
    data,
  );
  expect(state.status).toBe("COMPLETED");
  expect(state.realHumanSessionExecuted).toBe(false);
  expect(state.humanReviewTimeMeasured).toBe(false);
  const exported = await readFile(
    path.join(root, "trial-metrics-export.json"),
    "utf8",
  );
  expect(exported).not.toContain("人が修正");
  expect(
    c60113WorkspaceHash(
      JSON.parse(await readFile(path.join(root, "review-data.json"), "utf8")),
    ),
  ).toBe(originalHash);
  expect(
    (await fetch(new URL("session/review-trial-events.jsonl", server.url)))
      .status,
  ).not.toBe(200);
});
