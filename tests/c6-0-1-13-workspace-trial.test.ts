import {
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  c60113CorrectionInstrumentationSchema,
  c60113FeatureNames,
  c60113TrialEventSchema,
  type C60113TrialEventInput,
} from "@mvl/shared";
import {
  assertC60113WorkspaceExtension,
  c60113IntervalUnion,
  c60113UnplayedIntervals,
  c60113TextDiff,
  c60113WorkspaceHash,
} from "../packages/video-subtitler/src/review/c60113-review-workspace.js";
import {
  initializeC60113Trial,
  readC60113Trial,
  recordC60113TrialEvent,
  c60113TrialEligibility,
  c60113PlaybackState,
} from "../packages/video-subtitler/src/review/c60113-prospective-trial.js";
import {
  c60113DeploymentRanker,
  buildC60113ProspectiveTrialPackage,
  validateC60113ProspectiveTrialPackage,
} from "../packages/video-subtitler/src/review/c60113-prospective-trial-package.js";
import {
  c60113SyntheticWorkspace,
  writeC60113SyntheticWorkspace,
  c60113SyntheticRankerFreeze,
  prepareC60113SyntheticTrialPackage,
} from "./fixtures/c60113-workspace-fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "c60113-trial-"));
  roots.push(root);
  const data = await writeC60113SyntheticWorkspace(root);
  return { root, data };
}
function event(
  type: C60113TrialEventInput["eventType"],
  id: string,
  extra: Partial<C60113TrialEventInput> = {},
): C60113TrialEventInput {
  return {
    eventId: id,
    eventType: type,
    expectedReviewPackageHash: "b".repeat(64),
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
    ...extra,
  };
}

describe("C6.0.1.13 region workspace and prospective instrumentation", () => {
  it.each(["root", "session", "trial-event-log", "sqlite-mutex"])(
    "rejects substituted %s symbolic links without touching their targets",
    async (target) => {
      const { root, data } = await fixture();
      const outside = await mkdtemp(path.join(tmpdir(), "c60113-outside-"));
      roots.push(outside);
      const sentinel = path.join(outside, "sentinel.txt");
      await writeFile(sentinel, "unchanged private data\n");
      let workspace = root;
      if (target === "root") {
        workspace = path.join(outside, "workspace-alias");
        await symlink(root, workspace, "dir");
      } else if (target === "session") {
        await rename(
          path.join(root, "session"),
          path.join(root, "original-session"),
        );
        await symlink(outside, path.join(root, "session"), "dir");
      } else {
        const filename =
          target === "trial-event-log"
            ? "review-trial-events.jsonl"
            : "workspace-mutation.sqlite";
        await symlink(sentinel, path.join(root, "session", filename));
      }
      await expect(readC60113Trial(workspace, data)).rejects.toThrow(
        /symbolic link|inside the workspace/i,
      );
      expect(await readFile(sentinel, "utf8")).toBe("unchanged private data\n");
    },
  );
  it("deduplicates played global intervals and skips overlapping context", () => {
    expect(
      c60113IntervalUnion([
        { start: 1, end: 5 },
        { start: 4, end: 8 },
      ]),
    ).toEqual([{ start: 1, end: 8 }]);
    expect(
      c60113UnplayedIntervals({ start: 0, end: 10 }, [{ start: 1, end: 8 }]),
    ).toEqual([
      { start: 0, end: 1 },
      { start: 8, end: 10 },
    ]);
  });
  it("retains exact candidate/current strings in character diff without automatic merge", () => {
    const diff = c60113TextDiff("テストです", "テストでした");
    expect(
      diff
        .filter((x) => x.kind !== "added")
        .map((x) => x.text)
        .join(""),
    ).toBe("テストです");
    expect(
      diff
        .filter((x) => x.kind !== "removed")
        .map((x) => x.text)
        .join(""),
    ).toBe("テストでした");
  });
  it("validates a distinct extension policy and rejects stale region binding", () => {
    const data = c60113SyntheticWorkspace();
    expect(() => assertC60113WorkspaceExtension(data)).not.toThrow();
    const region = data.regionReviewV2?.regions[0];
    if (!region) throw new Error("Synthetic region missing");
    region.rankScore++;
    expect(() => assertC60113WorkspaceExtension(data)).toThrow("HASH_MISMATCH");
  });
  it("rejects exposed or Gold-available trials generically", async () => {
    const { root, data } = await fixture();
    expect(
      c60113TrialEligibility({
        goldUnavailable: true,
        previousHumanSubtitleUnavailable: true,
        reviewerPriorExposure: true,
      }),
    ).toBe("NOT_ELIGIBLE_PRIOR_GOLD_EXPOSURE");
    await expect(
      initializeC60113Trial({
        workspaceDirectory: root,
        data,
        rankerHash: "e".repeat(64),
        declarations: {
          goldUnavailable: false,
          previousHumanSubtitleUnavailable: true,
          reviewerPriorExposure: false,
        },
      }),
    ).rejects.toThrow("NOT_ELIGIBLE");
    expect(await readC60113Trial(root, data)).toBeNull();
  });
  it("records focused active time, pauses, unique audio and idempotent events without calling synthetic real human", async () => {
    const { root, data } = await fixture();
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
    const record = (
      type: C60113TrialEventInput["eventType"],
      id: string,
      seconds: number,
      extra: Partial<C60113TrialEventInput> = {},
    ) =>
      recordC60113TrialEvent({
        workspaceDirectory: root,
        data,
        event: event(type, id, extra),
        now: new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString(),
      });
    await record("TRIAL_STARTED", "start", 0);
    await record("AUDIO_PLAYED", "play", 1, { audioPlaying: true });
    await record("ACTIVITY_SAMPLE", "sample1", 3, {
      sourceInterval: { start: 4, end: 6 },
      audioPlaying: true,
    });
    await record("ACTIVITY_SAMPLE", "sample2", 5, {
      sourceInterval: { start: 5, end: 7 },
      audioPlaying: true,
    });
    await record("TRIAL_PAUSED", "pause", 6);
    await record("TRIAL_RESUMED", "resume", 120);
    await record("ACTIVITY_SAMPLE", "background", 121, {
      visible: false,
      focused: false,
      interaction: false,
    });
    const state = await record("TRIAL_COMPLETED", "complete", 122, {
      visible: false,
      focused: false,
    });
    expect(state.metrics.activeReviewSeconds).toBe(6);
    expect(state.metrics.totalElapsedSeconds).toBe(122);
    expect(state.metrics.uniqueAudioPlayedSeconds).toBe(3);
    expect(state.metrics.audioPlaybackSeconds).toBe(4);
    expect(state.metrics.repeatedAudioSeconds).toBe(1);
    expect(state.realHumanSessionExecuted).toBe(false);
    expect(state.humanReviewTimeMeasured).toBe(false);
    expect(
      (
        await record("TRIAL_COMPLETED", "complete", 130, {
          visible: false,
          focused: false,
        })
      ).eventCount,
    ).toBe(state.eventCount);
    await expect(record("TRIAL_STARTED", "bad", 123)).rejects.toThrow(
      "TRIAL_INVALID_START",
    );
    const changed = structuredClone(data);
    changed.reviewPackageSemanticHash = "a".repeat(64);
    await expect(readC60113Trial(root, changed)).rejects.toThrow(
      "REVIEW_SESSION_BASE_MISMATCH",
    );
  });
  it("does not count hidden or unobserved long heartbeat gaps as active", async () => {
    const { root, data } = await fixture();
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
    await recordC60113TrialEvent({
      workspaceDirectory: root,
      event: event("TRIAL_STARTED", "s"),
      now: "2026-01-01T00:00:00.000Z",
    });
    const state = await recordC60113TrialEvent({
      workspaceDirectory: root,
      event: event("ACTIVITY_SAMPLE", "long", { interaction: false }),
      now: "2026-01-01T00:02:00.000Z",
    });
    expect(state.metrics.activeReviewSeconds).toBe(0);
  });
  it("retains durable source-global played ranges across reopening and rejects stale snapshots", async () => {
    const { root, data } = await fixture();
    await c60113PlaybackState(root, data, {
      intervals: [{ start: 4, end: 6 }],
      playbackSeconds: 2,
      playbackCount: 1,
    });
    await c60113PlaybackState(root, data, {
      intervals: [{ start: 5, end: 7 }],
      playbackSeconds: 2,
      playbackCount: 0,
    });
    expect(
      (await c60113PlaybackState(root, data)).playedSourceIntervals,
    ).toEqual([{ start: 4, end: 7 }]);
    const changed = structuredClone(data);
    changed.reviewPackageSemanticHash = "f".repeat(64);
    await expect(c60113PlaybackState(root, changed)).rejects.toThrow(
      "BASE_MISMATCH",
    );
  });
  it("strips calibration hashes and fold identities from deployment ranker", () => {
    const ranker = c60113DeploymentRanker({
      ...c60113SyntheticRankerFreeze(),
      rankerType: "L2_LOGISTIC_REGRESSION",
      trainingDatasetHash: "secret",
      foldsHash: "secret",
      evaluationHash: "secret",
      model: {
        coefficients: Array.from(
          { length: c60113FeatureNames.length * 3 },
          () => 1,
        ),
        intercept: 0,
        preprocessing: {
          means: Array.from({ length: c60113FeatureNames.length * 3 }, () => 0),
          medians: Array.from({ length: c60113FeatureNames.length }, () => 0),
          scales: Array.from(
            { length: c60113FeatureNames.length * 3 },
            () => 1,
          ),
          featureNames: c60113FeatureNames.flatMap((name) => [
            name,
            `${name}__unknown`,
            `${name}__unavailable`,
          ]),
          missingValueEncoding:
            "MEDIAN_PLUS_SEPARATE_UNKNOWN_UNAVAILABLE_INDICATORS",
          fittedRegionIds: ["episode1-region"],
        },
      },
    });
    expect(JSON.stringify(ranker)).not.toMatch(
      /secret|episode1|fittedRegionIds/,
    );
  });
  it("packages only frozen workspace/audio and a blank session, never historical logs", async () => {
    const { root } = await fixture();
    const prepared = await prepareC60113SyntheticTrialPackage(root);
    await writeFile(
      path.join(root, "session", "human-correction-log.jsonl"),
      "private human text",
    );
    const output = path.join(root, "..", `${path.basename(root)}-package`);
    roots.push(output);
    const built = await buildC60113ProspectiveTrialPackage({
      workspaceDirectory: root,
      outputDirectory: output,
      expectedWorkspaceDataHash: c60113WorkspaceHash(prepared.data),
      machinePackageFile: prepared.machinePackageFile,
      reviewPackageFreezeFile: prepared.reviewPackageFreezeFile,
      regionFeatures: prepared.regionFeatures,
      frozenRanker: {
        ...prepared.frozenRanker,
        trainingDatasetHash: "secret-gold-hash",
      },
    });
    expect(built.rankerHash).toHaveLength(64);
    const verified = await validateC60113ProspectiveTrialPackage(output);
    expect(verified.manifest.deploymentSelections).toHaveLength(7);
    expect(verified.data.machineDraftHash).toBe(prepared.data.machineDraftHash);
    await expect(
      readFile(
        path.join(
          built.workspaceDirectory,
          "session",
          "human-correction-log.jsonl",
        ),
      ),
    ).rejects.toThrow();
    expect(
      await readFile(path.join(output, "frozen-region-ranker.json"), "utf8"),
    ).not.toContain("secret-gold-hash");
  });
  it("recovers only a provably interrupted append from the durable pending event", async () => {
    const { root, data } = await fixture();
    const manifest = await initializeC60113Trial({
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
    await recordC60113TrialEvent({
      workspaceDirectory: root,
      data,
      event: event("TRIAL_STARTED", "start"),
      now: "2026-01-01T00:00:00.000Z",
    });
    const history = await readFile(
      path.join(root, "session", "review-trial-events.jsonl"),
      "utf8",
    );
    const start = c60113TrialEventSchema.parse(JSON.parse(history.trim()));
    const content = {
      ...event("ITEM_OPENED", "next", {
        itemId: "item-0",
        regionId: "region-0",
      }),
      schemaVersion: "1.0.0",
      trialId: manifest.trialId,
      sequence: 2,
      timestamp: "2026-01-01T00:00:01.000Z",
      previousEventHash: start.semanticHash,
    };
    const pending = c60113TrialEventSchema.parse({
      ...content,
      semanticHash: c60113WorkspaceHash(content),
    });
    await writeFile(
      path.join(root, "session", "pending-trial-event.json"),
      JSON.stringify(pending),
    );
    await writeFile(
      path.join(root, "session", "review-trial-events.jsonl"),
      history + JSON.stringify(pending).slice(0, 40),
    );
    expect((await readC60113Trial(root, data))?.state.eventCount).toBe(2);
    expect((await readC60113Trial(root, data))?.state.eventCount).toBe(2);
  });
  it("refuses prior human review state instead of silently creating a blind trial", async () => {
    const { root, data } = await fixture();
    await writeFile(
      path.join(root, "session", "human-correction-log.jsonl"),
      "previous-human-session\n",
    );
    await expect(
      initializeC60113Trial({
        workspaceDirectory: root,
        data,
        rankerHash: "e".repeat(64),
        synthetic: true,
        declarations: {
          goldUnavailable: true,
          previousHumanSubtitleUnavailable: true,
          reviewerPriorExposure: false,
        },
      }),
    ).rejects.toThrow("TRIAL_PRIOR_REVIEW_STATE_PRESENT");
    expect(await readC60113Trial(root, data)).toBeNull();
  });
  it("keeps correction metadata optional and requires an editing-base identity", () => {
    expect(
      c60113CorrectionInstrumentationSchema.safeParse({
        schemaVersion: "1.0.0",
        regionRank: 1,
        reviewBudget: "FULL_QUEUE",
        uniqueAudioSecondsBeforeDecision: 1,
        playedSecondsBeforeDecision: 2,
        candidateUsedAsEditingBase: true,
        initialEditingCandidateId: null,
        editDistanceFromCandidate: 0,
        decisionLatencySeconds: 2,
        playbackCount: 1,
      }).success,
    ).toBe(false);
  });
});
