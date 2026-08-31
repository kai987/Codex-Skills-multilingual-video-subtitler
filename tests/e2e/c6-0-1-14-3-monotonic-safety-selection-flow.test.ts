import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixture143 } from "../fixtures/c601143-fixture.js";
import { candidateFixture142 as candidate } from "../fixtures/c601142-fixture.js";
import {
  planFinalSafety143,
  materializeSafety143,
} from "../../packages/video-subtitler/src/review/c601143-final-planner.js";
import { buildContinuity143 } from "../../packages/video-subtitler/src/review/c601143-monotonicity.js";
import { buildReviewGraph143 } from "../../packages/video-subtitler/src/review/c601143-review-graph.js";
import { buildC60114ReviewAudio } from "../../packages/video-subtitler/src/review/review-audio-manifest-v3.js";
import { buildC60114PlaybackTimeline } from "../../packages/video-subtitler/src/review/review-playback-timeline-v2.js";
import {
  audioManifest142,
  playback142,
} from "../../packages/video-subtitler/src/review/c601142-review-delivery.js";
import {
  buildReviewDelivery143,
  verifyPhysicalAudio143,
} from "../../packages/video-subtitler/src/review/c601143-review-delivery.js";
import {
  wav141,
  bytesHash141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import { required141 } from "../../packages/video-subtitler/src/review/c601141-policy.js";

let root: string, sourcePath: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "c601143-e2e-"));
  sourcePath = path.join(root, "source.wav");
  const pcm = Buffer.alloc(40 * 48000 * 2);
  await writeFile(sourcePath, wav141(pcm, 48000));
});
afterAll(async () => rm(root, { recursive: true, force: true }));
function flow() {
  const source = {
    sourceMediaSha256: "",
    durationSeconds: 40,
    sampleRate: 48000,
    audioStreamIndex: 0,
    audioTimebase: "1/48000",
    sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
  };
  return {
    source,
    make: (sha: string) =>
      fixture143(
        [
          candidate("a", 20, 21),
          candidate("b", 21.4, 22.4),
          candidate("new", 30, 31),
        ],
        [0, 1],
        {},
        { ...source, sourceMediaSha256: sha },
      ),
  };
}
describe("C6.0.1.14.3 replay-only monotonic delivery flow", () => {
  it("runs obligations through hierarchy, bundle, exact planner and real WAV playback", async () => {
    const bytes = await import("node:fs/promises").then((m) =>
        m.readFile(sourcePath),
      ),
      f = flow().make(bytesHash141(bytes));
    const planned = planFinalSafety143(f),
      continuity = buildContinuity143({ ...f, selected: planned.selected });
    const safety = materializeSafety143({
      ...f,
      certificate: planned.certificate,
      selected: planned.selected,
      continuity: continuity.ledger,
      monotonicity: continuity.monotonicity,
    });
    const graph = buildReviewGraph143({
      policy: f.policy,
      compatibilityPolicy: f.compatibilityPolicy,
      legacyPolicy: f.base.old.compatibilityPolicy,
      inventory: f.inventory,
      safety,
      hierarchy: f.hierarchy,
      obligations: f.obligations,
      planner: planned.certificate,
      continuity: continuity.ledger,
      frozenLexical: f.base.lexical,
      baselineTargets: f.base.old.baselineTargets,
      baselineItems: f.base.old.baselineItems,
      baselineRegions: f.base.old.baselineRegions,
      frozenR3Families: f.base.old.frozenR3Families,
    });
    const directory = path.join(root, "workspace"),
      physical = await buildC60114ReviewAudio({
        sourcePath,
        sourceIdentity: f.inventory.sourceIdentity,
        policy: f.base.old.compatibilityPolicy,
        targets: graph.compatibility.compatibleTargets,
        regions: graph.compatibility.compatibleRegions,
        outputDirectory: directory,
        generatedAt: "2026-01-01T00:00:00.000Z",
      });
    const legacy = buildC60114PlaybackTimeline({
      sourceIdentity: f.inventory.sourceIdentity,
      policy: f.base.old.compatibilityPolicy,
      targets: graph.compatibility.compatibleTargets,
      regions: graph.compatibility.compatibleRegions,
      audio: physical.manifest,
    });
    const audio = audioManifest142(
        physical.manifest,
        graph.compatibility.regions,
        f.compatibilityPolicy,
      ),
      playback = playback142({
        legacy,
        audio,
        regions: graph.compatibility.regions,
        targets: graph.compatibility.targets,
        policy: f.compatibilityPolicy,
      });
    const selectedChildren = f.hierarchy.children.filter((c) =>
      planned.certificate.selectedChildIds.includes(c.childUnitId),
    );
    const delivery = buildReviewDelivery143({
      legacyAudio: audio,
      legacyPlayback: playback,
      targets: graph.targets,
      regions: graph.regions,
      safety,
      selectedChildren,
      policy: f.policy,
      planner: planned.certificate,
    });
    expect(continuity.monotonicity.monotonicityPassed).toBe(true);
    expect(safety.summary.obligationCoverageRatio).toBe(1);
    expect(
      delivery.audio.childCoreCoverage.every((c) => c.coveragePassed),
    ).toBe(true);
    expect(delivery.playback.allBundleCorePlaybackPassed).toBe(true);
    await expect(
      verifyPhysicalAudio143(directory, delivery.audio),
    ).resolves.toMatchObject({ allPassed: true });
  });
  it("fails closed before review delivery when one native obligation sample is dropped", () => {
    const f = flow().make("a".repeat(64)),
      planned = planFinalSafety143(f),
      selected = planned.selected.map((b, i) =>
        i
          ? b
          : {
              ...b,
              nativeIntervalUnion: [
                {
                  ...b.nativeIntervalUnion[0],
                  startSample:
                    required141(b.nativeIntervalUnion[0]).startSample + 1,
                },
              ],
            },
      );
    expect(() =>
      buildContinuity143({
        ...f,
        selected: selected as typeof planned.selected,
      }),
    ).toThrow();
  });
});
