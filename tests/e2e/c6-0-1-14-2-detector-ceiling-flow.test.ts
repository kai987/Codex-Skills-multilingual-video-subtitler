import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { syntheticDelivery142 } from "../fixtures/c601142-delivery-fixture.js";
import { startC60112ReviewWorkspaceServer } from "../../packages/video-subtitler/src/review/c60112-review-workspace.js";
import {
  assertWorkspace142,
  verifyPhysicalAudio142,
} from "../../packages/video-subtitler/src/review/c601142-review-delivery.js";
import {
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { identity141 } from "../../packages/video-subtitler/src/review/c601141-io.js";
import { reserve142 } from "../../packages/video-subtitler/src/review/c601142-detectors.js";
import { policy142Schema, workspace142Schema } from "@mvl/shared";
let root: string,
  f: Awaited<ReturnType<typeof syntheticDelivery142>>,
  server: Awaited<ReturnType<typeof startC60112ReviewWorkspaceServer>>;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mvl-c601142-e2e-"));
  f = await syntheticDelivery142(root);
  server = await startC60112ReviewWorkspaceServer({
    workspaceDirectory: f.directory,
    port: 0,
  });
}, 60000);
afterAll(async () => {
  await server.close();
  if (root) await rm(root, { recursive: true, force: true });
});
describe("C601142 physical delivery with synthetic evidence; no real models", () => {
  it.each([
    {
      kind: "DETECTOR" as const,
      families: [
        "WEBRTC",
        "WEBRTC",
        "WEBRTC",
        "WEBRTC",
        "SILERO",
        "SILERO",
        "PYANNOTE",
        "PYANNOTE",
      ],
    },
    {
      kind: "ASR" as const,
      families: [
        ...Array<string>(6).fill("whisper-large-v3"),
        ...Array<string>(6).fill("reazonspeech-k2-v2"),
      ],
    },
  ])(
    "rejects an extra $kind dispatch before provider construction",
    async ({ kind, families }) => {
      const directory = path.join(root, `negative-${kind}`);
      for (const [index, family] of families.entries())
        await reserve142({
          directory,
          kind,
          family,
          requestId: `${kind}-${index}`,
          planHash: f.policy.semanticHash,
          identity: { index },
        });
      await expect(
        reserve142({
          directory,
          kind,
          family: required141(families[0]),
          requestId: `${kind}-over-budget`,
          planHash: f.policy.semanticHash,
          identity: "over-budget",
        }),
      ).rejects.toThrow(/BUDGET/u);
    },
  );
  it("rejects Gold injection, hidden retry and automatic canonical mutation in the delivered contract", () => {
    expect(
      policy142Schema.safeParse({
        ...f.policy,
        goldIntervals: [{ start: 1, end: 2 }],
      }).success,
    ).toBe(false);
    const extension = required141(f.data.detectorCeilingReviewV2);
    expect(
      workspace142Schema.safeParse({
        ...extension,
        canonicalMutationAllowed: true,
      }).success,
    ).toBe(false);
    expect(
      workspace142Schema.safeParse({ ...extension, humanTrialStarted: true })
        .success,
    ).toBe(false);
    expect(
      policy142Schema.safeParse({ ...f.policy, hiddenRetryAllowed: true })
        .success,
    ).toBe(false);
  });
  it("serves a real review document, localized graph and eight physical playback plans", async () => {
    const response = await fetch(server.url);
    expect(response.ok).toBe(true);
    expect(await response.text()).toContain("assets/review.js");
    const data = (await (
      await fetch(new URL("review-data.json", server.url))
    ).json()) as typeof f.data;
    expect(data.detectorCeilingReviewV2?.workspaceMode).toBe(
      "DETECTOR_CEILING_SAFETY_REVIEW_V2",
    );
    expect(
      data.detectorCeilingReviewV2?.playback.plans.length,
    ).toBeGreaterThanOrEqual(8);
    expect(data.detectorCeilingReviewV2?.playback.officialFullQueuePlan).toBe(
      "C601142_FINAL_FULL_QUEUE",
    );
    expect(await verifyPhysicalAudio142(f.directory, f.audio)).toMatchObject({
      allPassed: true,
    });
    expect(() => assertWorkspace142(data)).not.toThrow();
  });
  it("streams each physical WAV and preserves the source identity", async () => {
    const before = await identity141(f.sourcePath);
    for (const clip of f.audio.audio) {
      const response = await fetch(new URL(clip.relativePath, server.url));
      expect(response.ok).toBe(true);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        await readFile(path.join(f.directory, clip.relativePath)),
      );
    }
    expect(await identity141(f.sourcePath)).toEqual(before);
  });
  it("fails closed for a missing physical WAV", async () => {
    const manifest = structuredClone(f.audio);
    required141(manifest.audio[0]).relativePath = "audio/nonexistent.wav";
    await expect(
      verifyPhysicalAudio142(f.directory, hashed141(manifest)),
    ).rejects.toThrow();
  });
  it("rejects a rehashed but broken target-to-playback link", () => {
    const data = structuredClone(f.data),
      current = required141(data.detectorCeilingReviewV2);
    current.playback = hashed141({ ...current.playback, segments: [] });
    data.detectorCeilingReviewV2 = hashed141(current);
    expect(() => assertWorkspace142(data)).toThrow(
      /AUDIO_REQUIRED_TARGET_WITHOUT_PLAYBACK/u,
    );
  });
  it("keeps new safety cues human-only and does not save a review session from playback", async () => {
    expect(
      f.graph.items.items
        .filter((i) => i.reviewLayer === "MISSING_SAFETY_RESERVE")
        .map((i) => [i.requiredLevel, i.canonicalMutationAllowed]),
    ).toEqual(
      f.graph.items.items
        .filter((i) => i.reviewLayer === "MISSING_SAFETY_RESERVE")
        .map(() => ["RECOMMENDED", false]),
    );
    const response = await fetch(new URL("api/session", server.url));
    expect(response.ok).toBe(true);
    const session = (await response.json()) as { session: unknown };
    expect(session.session).toBeNull();
  });
});
