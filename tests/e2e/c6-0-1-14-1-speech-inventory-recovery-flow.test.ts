import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { c601141SafetySchema, type C601141AudioViews } from "@mvl/shared";
import { syntheticDelivery141 } from "../fixtures/c601141-delivery-fixture.js";
import { startC60112ReviewWorkspaceServer } from "../../packages/video-subtitler/src/review/c60112-review-workspace.js";
import {
  verifyPhysicalAudio141,
  assertInventoryWorkspace141,
  selectedPlan141,
} from "../../packages/video-subtitler/src/review/c601141-review-delivery.js";
import {
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import {
  identity141,
  reserveDispatch141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import { planSweeps141 } from "../../packages/video-subtitler/src/review/c601141-detectors.js";
import { fingerprintControls141 } from "../fixtures/c601141-fingerprint-controls.js";
import {
  freeze141,
  verifyFreeze141,
} from "../../scripts/lib/c601141-freeze.js";

let root: string,
  fixture: Awaited<ReturnType<typeof syntheticDelivery141>>,
  server: Awaited<ReturnType<typeof startC60112ReviewWorkspaceServer>>;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "c601141-e2e-"));
  fixture = await syntheticDelivery141(root);
  server = await startC60112ReviewWorkspaceServer({
    workspaceDirectory: fixture.directory,
    port: 0,
  });
}, 60000);
afterAll(async () => {
  await server.close();
  if (root) await rm(root, { recursive: true, force: true });
});
describe("C601141 real physical delivery with synthetic evidence and explicit transactions", () => {
  it.each([
    ["SPEECH", 12],
    ["ASR", 32],
  ] as const)(
    "rejects a %s request beyond the durable global ledger cap",
    async (kind, limit) => {
      const cacheDirectory = path.join(root, `bounded-${kind}`);
      for (let i = 0; i < limit; i++)
        await reserveDispatch141({
          cacheDirectory,
          kind,
          requestId: `synthetic-${i}`,
          identity: { synthetic: true },
        });
      await expect(
        reserveDispatch141({
          cacheDirectory,
          kind,
          requestId: "over-cap",
          identity: {},
        }),
      ).rejects.toThrow(`C601141_${kind}_BUDGET_EXCEEDED`);
    },
  );
  it("forbids a hidden retry after a reserved request, even before raw persistence", async () => {
    const request = {
      cacheDirectory: path.join(root, "hidden-retry"),
      kind: "ASR" as const,
      requestId: "consumed-request",
      identity: { synthetic: true },
    };
    await reserveDispatch141(request);
    await expect(reserveDispatch141(request)).rejects.toThrow();
  });
  it("rejects Gold selection fields and a whole-source catch-all interval", () => {
    expect(
      c601141SafetySchema.safeParse({
        ...fixture.safety,
        goldErrorIntervals: [{ start: 1, end: 2 }],
      }).success,
    ).toBe(false);
    const changed = structuredClone(fixture.safety),
      target = required141(changed.targets[0]);
    target.sourceInterval = { start: 0, end: fixture.source.durationSeconds };
    target.nativeInterval = {
      startSample: 0,
      endSample: fixture.source.durationSeconds * fixture.source.sampleRate,
    };
    expect(c601141SafetySchema.safeParse(changed).success).toBe(false);
  });
  it("rejects duplicated eligible PCM before provider planning", () => {
    const views = hashed141({
      views: [0, 1].map((i) => ({
        viewId: `view-${i}`,
        detectorEligible: true,
        duplicateOfViewId: null,
        pcmSha256: "d".repeat(64),
      })),
    }) as C601141AudioViews;
    expect(() => planSweeps141(views, fixture.policy, [])).toThrow(
      "C601141_DUPLICATE_DETECTOR_PCM",
    );
  });
  it("rejects repeated-pattern fingerprint loci in the actual model-free worker", async () => {
    const controls = await fingerprintControls141(
      path.join(root, "fingerprint-control"),
    );
    expect(controls.controls.statuses.duplicate).toBe("FINGERPRINT_AMBIGUOUS");
  }, 30000);
  it("fails physical acceptance if a mapped WAV is absent", async () => {
    const manifest = structuredClone(fixture.audio);
    required141(manifest.audio[0]).relativePath = "audio/does-not-exist.wav";
    await expect(
      verifyPhysicalAudio141(fixture.directory, hashed141(manifest)),
    ).rejects.toThrow();
  });
  it("serves the additive UI, nine plans and all new physical target audio", async () => {
    expect(
      await verifyPhysicalAudio141(fixture.directory, fixture.audio),
    ).toMatchObject({ allPassed: true, actualAudioCount: 3 });
    expect(fixture.playback.plans).toHaveLength(9);
    expect(fixture.playback.officialFullQueuePlan).toBe(
      "FULL_QUEUE_WITH_SAFETY_RESERVE",
    );
    const html = await (
      await fetch(new URL("assets/review.js", server.url))
    ).text();
    expect(html).toContain("Multi-view speech inventory evidence");
    expect(html).toContain("Copy localized candidate to editing base");
    expect(html).toContain("FULL_QUEUE_WITH_SAFETY_RESERVE");
    const response = await fetch(
      new URL(required141(fixture.audio.audio[1]).relativePath, server.url),
      { headers: { range: "bytes=0-63" } },
    );
    expect(response.status).toBe(206);
    expect(
      Buffer.from(await response.arrayBuffer()).toString("ascii", 0, 4),
    ).toBe("RIFF");
    const session = (await (
      await fetch(new URL("api/session", server.url))
    ).json()) as { session: null };
    expect(session.session).toBeNull();
  });
  it("fails closed when a safety-layer plan is relabeled or drops a region", () => {
    const changed = structuredClone(fixture.data),
      ext = required141(changed.speechInventoryReviewV1);
    const plan = required141(
      ext.playback.plans.find(
        (v) => v.planId === "FULL_QUEUE_WITH_SAFETY_RESERVE",
      ),
    );
    Object.assign(
      plan,
      selectedPlan141({
        planId: plan.planId,
        regionIds: plan.regionIds.slice(0, 1),
        segments: ext.playback.segments,
        audio: ext.audio,
      }),
    );
    ext.playback = hashed141(ext.playback);
    changed.speechInventoryReviewV1 = hashed141(ext);
    expect(() => assertInventoryWorkspace141(changed)).toThrow(
      "C601141_PLAN_LAYER_MEMBERSHIP_CHANGED",
    );
  });
  it("requires an explicit human insertion and undo; source and machine data stay read-only", async () => {
    const before = await identity141(fixture.sourcePath),
      item = required141(
        fixture.data.items.find((v) => v.finalCueIds.length === 0),
      );
    const post = (route: string, value: unknown) =>
      fetch(new URL(route, server.url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mvl-review-request": "c6-0-1-12",
          origin: new URL(server.url).origin,
        },
        body: JSON.stringify(value),
      });
    const binding = {
      expectedReviewPackageSemanticHash: fixture.data.reviewPackageSemanticHash,
      expectedMachineDraftHash: fixture.data.machineDraftHash,
    };
    const response = await post("api/decision", {
      ...binding,
      decisionId: "synthetic-explicit-human-action",
      reviewItemId: item.reviewItemId,
      decisionType: "ADD_NEW_CUE",
      selectedCandidateId: null,
      afterText: "人が確認した合成テスト",
      afterStart: item.coreInterval.start,
      afterEnd: item.coreInterval.end,
      reviewerNote: null,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      (
        await post("api/undo", {
          ...binding,
          undoId: "synthetic-explicit-undo",
        })
      ).status,
    ).toBe(200);
    expect(await identity141(fixture.sourcePath)).toEqual(before);
    const persisted = JSON.parse(
      await readFile(path.join(fixture.directory, "review-data.json"), "utf8"),
    ) as { machineDraftHash: string };
    expect(persisted.machineDraftHash).toBe(fixture.data.machineDraftHash);
  });
  it("verifies a complete frozen byte chain and rejects tampering before any Gold callback", async () => {
    const file = path.join(root, "synthetic-machine.json"),
      freezeFile = path.join(root, "synthetic-freeze.json");
    await writeFile(file, '{"machine":true}');
    await freeze141({
      root,
      file: freezeFile,
      policy: fixture.policy,
      source: fixture.source,
      sourcePath: fixture.sourcePath,
      sourceBefore: await identity141(fixture.sourcePath),
      artifactFiles: [file],
      protectedFiles: [file],
      canonicalTextHash: "a".repeat(64),
      canonicalTimingHash: "b".repeat(64),
      presentationHash: "c".repeat(64),
      stage: "FINAL_MACHINE_DELIVERY",
    });
    await verifyFreeze141(root, freezeFile, fixture.sourcePath);
    await writeFile(file, '{"machine":false}');
    let goldReads = 0;
    await expect(
      (async () => {
        await verifyFreeze141(root, freezeFile);
        goldReads++;
      })(),
    ).rejects.toThrow("C601141_FROZEN_ARTIFACT_CHANGED");
    expect(goldReads).toBe(0);
  });
});
