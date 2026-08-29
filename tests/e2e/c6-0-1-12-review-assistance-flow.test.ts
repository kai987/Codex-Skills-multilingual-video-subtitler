import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  machineQualitySemanticHash,
  startC60112FrozenReviewWorkspaceServer,
  writeC60112ReviewWorkspace,
  type C60112ReviewPackageFreeze,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function reviewData(): C60112ReviewWorkspaceData {
  return {
    schemaVersion: "1.0.0",
    workspaceVersion: "c6.0.1.12-review-workspace-v1",
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2",
    policyHash: "a".repeat(64),
    reviewPackageSemanticHash: "b".repeat(64),
    machineDraftHash: "c".repeat(64),
    sourceMediaIdentity: {
      sourceMediaSha256: "d".repeat(64),
      durationSeconds: 10,
    },
    machineDraftIdentity: { cueCount: 1 },
    items: [
      {
        reviewItemId: "review-item-1",
        eventIds: ["event-1"],
        finalCueIds: ["cue-1"],
        itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
        sourceInterval: { start: 1, end: 2 },
        coreInterval: { start: 1.1, end: 1.9 },
        currentText: "現在文",
        currentStart: 1,
        currentEnd: 2,
        candidateIds: [],
        evidenceIds: ["evidence-1"],
        reviewReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
        priorityTier: "HIGH",
        priorityScore: 80,
        requiredLevel: "REQUIRED",
        suggestedActions: ["KEEP_CURRENT", "UNRESOLVED"],
        regionId: "region-1",
        previousCue: null,
        nextCue: null,
        semanticHash: "e".repeat(64),
      },
    ],
    regions: [
      {
        regionId: "region-1",
        reviewItemIds: ["review-item-1"],
        contextStart: 0,
        contextEnd: 3,
        coreIntervals: [{ start: 1.1, end: 1.9 }],
        audioPath: "audio/region-1.wav",
        audioSha256: null,
      },
    ],
    candidateBundles: [{ reviewItemId: "review-item-1", candidates: [] }],
  };
}

function reviewFreeze(
  data: C60112ReviewWorkspaceData,
): C60112ReviewPackageFreeze {
  const componentHash = "f".repeat(64);
  const workspaceDataHash = machineQualitySemanticHash(data);
  const aggregateHash = machineQualitySemanticHash({
    sourceMediaSha256: data.sourceMediaIdentity.sourceMediaSha256,
    machineDraftHash: data.machineDraftHash,
    itemHash: componentHash,
    priorityHash: componentHash,
    regionHash: componentHash,
    candidateHash: componentHash,
    audioManifestHash: componentHash,
    workspaceDataHash,
    policyHash: data.policyHash,
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: data.policyVersion,
    artifactType: "c6-0-1-12-review-package-freeze" as const,
    frozenAt: "2026-08-29T00:00:00.000Z",
    sourceMediaSha256: data.sourceMediaIdentity.sourceMediaSha256 ?? "",
    machineDraftHash: data.machineDraftHash,
    itemHash: componentHash,
    priorityHash: componentHash,
    regionHash: componentHash,
    candidateHash: componentHash,
    audioManifestHash: componentHash,
    workspaceDataHash,
    policyHash: data.policyHash,
    aggregateHash,
    runtimeGoldInputCount: 0 as const,
    goldAccessBeforeFreezeCount: 0 as const,
    frozenBeforeGoldEvaluation: true as const,
  };
  return {
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  };
}

describe("C6.0.1.12 offline review assistance flow", () => {
  it("persists an explicit local decision and audit without Gold input", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "mvl-c60112-e2e-"));
    temporaryDirectories.push(workspace);
    const data = reviewData();
    await writeC60112ReviewWorkspace({
      workspaceDirectory: workspace,
      reviewData: data,
    });
    const server = await startC60112FrozenReviewWorkspaceServer({
      workspaceDirectory: workspace,
      freeze: reviewFreeze(data),
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const health = await fetch(`${server.url}api/health`);
      expect(health.status).toBe(200);
      const response = await fetch(`${server.url}api/decision`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mvl-review-request": "c6-0-1-12",
          origin: server.url.slice(0, -1),
        },
        body: JSON.stringify({
          decisionId: "decision-1",
          reviewItemId: "review-item-1",
          decisionType: "KEEP_CURRENT",
          selectedCandidateId: null,
          afterText: null,
          afterStart: null,
          afterEnd: null,
          reviewerNote: null,
          expectedReviewPackageSemanticHash: data.reviewPackageSemanticHash,
          expectedMachineDraftHash: data.machineDraftHash,
        }),
      });
      expect(response.status).toBe(200);
      const session = (await response.json()) as {
        session: { reviewComplete: boolean; completedRequiredCount: number };
      };
      expect(session.session).toMatchObject({
        reviewComplete: true,
        completedRequiredCount: 1,
      });
      const correctionLog = await readFile(
        path.join(workspace, "session", "human-correction-log.jsonl"),
        "utf8",
      );
      const auditLog = await readFile(
        path.join(workspace, "session", "review-audit.jsonl"),
        "utf8",
      );
      expect(correctionLog).toContain('"decisionType":"KEEP_CURRENT"');
      expect(auditLog).toContain('"operation":"DECISION"');
      expect(correctionLog).not.toMatch(/gold/iu);
    } finally {
      await server.close();
    }
  });
});
