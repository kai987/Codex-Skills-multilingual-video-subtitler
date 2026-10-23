import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  correctionDatasetSummarySchema,
  humanCorrectionRecordSchema,
  reviewAuditRecordSchema,
  reviewSessionSchema,
  subtitlePackageSchema,
  type HumanCorrectionRecord,
} from "@mvl/shared";
import {
  machineQualitySemanticHash,
  startC60112FrozenReviewWorkspaceServer,
  type C60112ReviewPackageFreeze,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const CREATED_AT = "2026-08-29T12:00:00.000Z";
const SOURCE_HASH = "d".repeat(64);
const POLICY_HASH = "a".repeat(64);
const REVIEW_PACKAGE_HASH = "b".repeat(64);
const ITEM_HASH = "e".repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function physicalHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function basePackage() {
  return subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "fixture.wav",
      container: "wav",
      durationSeconds: 20,
    },
    identity: { title: "Fixture", season: null, episode: null, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "./fixture.srt",
      vtt: "./fixture.vtt",
      ass: "./fixture.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues: [
      {
        id: "cue-1",
        text: "現在文",
        start: 1,
        end: 2,
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: 0.5,
      },
    ],
    warnings: [],
  });
}

function workspaceData(machineDraftHash: string): C60112ReviewWorkspaceData {
  return {
    schemaVersion: "1.0.0",
    workspaceVersion: "c6.0.1.12-review-workspace-v1",
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2",
    policyHash: POLICY_HASH,
    reviewPackageSemanticHash: REVIEW_PACKAGE_HASH,
    machineDraftHash,
    sourceMediaIdentity: {
      sourceMediaSha256: SOURCE_HASH,
      sourceDurationMs: 3_000,
    },
    machineDraftIdentity: { machineDraftHash, cueCount: 1 },
    items: [
      {
        reviewItemId: "review-item-1",
        eventIds: ["event-1"],
        finalCueIds: ["cue-1"],
        itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
        sourceInterval: { start: 1, end: 2 },
        coreInterval: { start: 1, end: 2 },
        currentText: "現在文",
        currentStart: 1,
        currentEnd: 2,
        candidateIds: [],
        evidenceIds: ["evidence-1"],
        reviewReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
        priorityTier: "HIGH",
        priorityScore: 80,
        requiredLevel: "REQUIRED",
        suggestedActions: ["KEEP_CURRENT", "MANUAL_EDIT", "UNRESOLVED"],
        regionId: "region-1",
        previousCue: null,
        nextCue: null,
        semanticHash: ITEM_HASH,
      },
    ],
    regions: [
      {
        regionId: "region-1",
        reviewItemIds: ["review-item-1"],
        contextStart: 0,
        contextEnd: 3,
        coreIntervals: [{ start: 1, end: 2 }],
        audioPath: "audio/region-1.wav",
        audioSha256: null,
      },
    ],
    candidateBundles: [{ reviewItemId: "review-item-1", candidates: [] }],
  };
}

function freeze(data: C60112ReviewWorkspaceData): C60112ReviewPackageFreeze {
  const componentHashes = {
    itemHash: "1".repeat(64),
    priorityHash: "2".repeat(64),
    regionHash: "3".repeat(64),
    candidateHash: "4".repeat(64),
    audioManifestHash: "5".repeat(64),
    workspaceDataHash: machineQualitySemanticHash(data),
    policyHash: data.policyHash,
  };
  const aggregateHash = machineQualitySemanticHash({
    sourceMediaSha256: SOURCE_HASH,
    machineDraftHash: data.machineDraftHash,
    ...componentHashes,
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2" as const,
    artifactType: "c6-0-1-12-review-package-freeze" as const,
    frozenAt: CREATED_AT,
    sourceMediaSha256: SOURCE_HASH,
    machineDraftHash: data.machineDraftHash,
    ...componentHashes,
    aggregateHash,
    runtimeGoldInputCount: 0 as const,
    goldAccessBeforeFreezeCount: 0 as const,
    frozenBeforeGoldEvaluation: true as const,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

function correction(input: {
  recordId: string;
  decisionId: string;
  machineDraftHash: string;
  candidateSetHash: string;
  decisionType?: "KEEP_CURRENT" | "MANUAL_EDIT";
  createdAt: string;
}): HumanCorrectionRecord {
  const decisionType = input.decisionType ?? "KEEP_CURRENT";
  return humanCorrectionRecordSchema.parse({
    schemaVersion: "1.0.0",
    recordId: input.recordId,
    decisionId: input.decisionId,
    sessionId: "session-1",
    reviewItemId: "review-item-1",
    regionId: "region-1",
    eventIds: ["event-1"],
    cueIds: ["cue-1"],
    sourceInterval: { start: 1, end: 2 },
    machineDraftHash: input.machineDraftHash,
    evidenceSnapshotHash: ITEM_HASH,
    candidateSetHash: input.candidateSetHash,
    decisionType,
    selectedCandidateId: null,
    beforeText: "現在文",
    afterText: decisionType === "MANUAL_EDIT" ? "手動文" : "現在文",
    beforeStart: 1,
    beforeEnd: 2,
    afterStart: 1,
    afterEnd: 2,
    itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
    priorityAtDecision: {
      tier: "HIGH",
      score: 80,
      requiredLevel: "REQUIRED",
    },
    reviewerNote: null,
    createdAt: input.createdAt,
  });
}

function itemState(record: HumanCorrectionRecord) {
  return {
    recordId: record.recordId,
    decisionId: record.decisionId,
    decisionType: record.decisionType,
    selectedCandidateId: record.selectedCandidateId,
    afterText: record.afterText,
    afterStart: record.afterStart,
    afterEnd: record.afterEnd,
    reviewerNote: record.reviewerNote,
    updatedAt: record.createdAt,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-integrity-"));
  temporaryDirectories.push(root);
  const pkg = basePackage();
  const baseText = `${JSON.stringify(pkg, null, 2)}\n`;
  const machineDraftHash = physicalHash(baseText);
  const data = workspaceData(machineDraftHash);
  const frozen = freeze(data);
  const bundle = data.candidateBundles[0];
  if (bundle === undefined) throw new Error("Fixture bundle is missing.");
  const candidateSetHash = machineQualitySemanticHash(bundle);
  const active = correction({
    recordId: "record-active",
    decisionId: "decision-active",
    machineDraftHash,
    candidateSetHash,
    createdAt: "2026-08-29T12:00:01.000Z",
  });
  const undone = correction({
    recordId: "record-undone",
    decisionId: "decision-undone",
    machineDraftHash,
    candidateSetHash,
    decisionType: "MANUAL_EDIT",
    createdAt: "2026-08-29T12:00:02.000Z",
  });
  const orphan = correction({
    recordId: "record-crash-orphan",
    decisionId: "decision-crash-orphan",
    machineDraftHash,
    candidateSetHash,
    createdAt: "2026-08-29T12:00:03.000Z",
  });
  const activeState = itemState(active);
  const undoneState = itemState(undone);
  const session = reviewSessionSchema.parse({
    schemaVersion: "1.0.0",
    sessionId: "session-1",
    sourceMediaIdentity: data.sourceMediaIdentity,
    machineDraftIdentity: data.machineDraftIdentity,
    machineDraftHash,
    reviewPolicyVersion: data.policyVersion,
    reviewPackageSemanticHash: data.reviewPackageSemanticHash,
    createdAt: CREATED_AT,
    updatedAt: "2026-08-29T12:00:04.000Z",
    itemStates: { "review-item-1": activeState },
    regionStates: {
      "region-1": {
        requiredItemCount: 1,
        completedRequiredCount: 1,
        unresolvedRequiredCount: 0,
        complete: true,
      },
    },
    completedRequiredCount: 1,
    unresolvedRequiredCount: 0,
    reviewComplete: true,
  });
  const audit = [
    reviewAuditRecordSchema.parse({
      schemaVersion: "1.0.0",
      auditId: "audit-active",
      operation: "DECISION",
      timestamp: "2026-08-29T12:00:01.000Z",
      sessionId: "session-1",
      reviewItemId: "review-item-1",
      previousDecision: null,
      newDecision: active.recordId,
      undoneRecordId: null,
      beforeHash: machineQualitySemanticHash(null),
      afterHash: machineQualitySemanticHash(activeState),
    }),
    reviewAuditRecordSchema.parse({
      schemaVersion: "1.0.0",
      auditId: "audit-undone-decision",
      operation: "DECISION",
      timestamp: "2026-08-29T12:00:02.000Z",
      sessionId: "session-1",
      reviewItemId: "review-item-1",
      previousDecision: active.recordId,
      newDecision: undone.recordId,
      undoneRecordId: null,
      beforeHash: machineQualitySemanticHash(activeState),
      afterHash: machineQualitySemanticHash(undoneState),
    }),
    reviewAuditRecordSchema.parse({
      schemaVersion: "1.0.0",
      auditId: "audit-undo",
      operation: "UNDO",
      timestamp: "2026-08-29T12:00:04.000Z",
      sessionId: "session-1",
      reviewItemId: "review-item-1",
      previousDecision: undone.recordId,
      newDecision: active.recordId,
      undoneRecordId: undone.recordId,
      beforeHash: machineQualitySemanticHash(undoneState),
      afterHash: machineQualitySemanticHash(activeState),
    }),
  ];
  const paths = {
    base: path.join(root, "machine-draft.json"),
    reviewData: path.join(root, "review-data.json"),
    freeze: path.join(root, "freeze.json"),
    session: path.join(root, "review-session.json"),
    corrections: path.join(root, "human-correction-log.jsonl"),
    audit: path.join(root, "review-audit.jsonl"),
    dataset: path.join(root, "dataset"),
    reviewed: path.join(root, "reviewed"),
  };
  await Promise.all([
    writeFile(paths.base, baseText, "utf8"),
    writeFile(paths.reviewData, `${JSON.stringify(data, null, 2)}\n`, "utf8"),
    writeFile(paths.freeze, `${JSON.stringify(frozen, null, 2)}\n`, "utf8"),
    writeFile(paths.session, `${JSON.stringify(session, null, 2)}\n`, "utf8"),
    writeFile(
      paths.corrections,
      `${[active, undone, orphan].map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    ),
    writeFile(
      paths.audit,
      `${audit.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    ),
  ]);
  return { root, paths, data, active };
}

function cliArguments(
  command: "apply" | "export-corrections" | "stats",
  paths: Awaited<ReturnType<typeof fixture>>["paths"],
): string[] {
  const common = [
    "scripts/c6-0-1-12-review-cli.ts",
    command,
    "--freeze",
    paths.freeze,
    "--review-data",
    paths.reviewData,
    "--session",
    paths.session,
    "--corrections",
    paths.corrections,
    "--audit",
    paths.audit,
  ];
  if (command === "export-corrections") {
    return [...common, "--output", paths.dataset];
  }
  if (command === "apply") {
    return [
      ...common,
      "--base-package",
      paths.base,
      "--output",
      paths.reviewed,
    ];
  }
  return common;
}

async function runCli(args: readonly string[]) {
  return execFileAsync(
    path.join(process.cwd(), "node_modules", ".bin", "tsx"),
    [...args],
    { cwd: process.cwd() },
  );
}

async function actionFixture(input: {
  action: HumanCorrectionRecord["decisionType"];
  cueIds: string[];
  allowed: boolean;
  note?: string;
}) {
  const value = await fixture();
  const item = value.data.items[0];
  if (item === undefined) throw new Error("Fixture item is missing.");
  item.finalCueIds = input.cueIds;
  item.suggestedActions = input.allowed
    ? [input.action]
    : input.cueIds.length === 0
      ? ["ADD_NEW_CUE"]
      : ["KEEP_CURRENT"];
  const correction = humanCorrectionRecordSchema.parse({
    ...value.active,
    decisionType: input.action,
    cueIds: input.cueIds,
    selectedCandidateId: ["USE_REAZON", "USE_WHISPER_ALTERNATE"].includes(
      input.action,
    )
      ? "candidate-fixture"
      : null,
    reviewerNote: input.note ?? null,
  });
  const state = itemState(correction);
  const session = reviewSessionSchema.parse(
    JSON.parse(await readFile(value.paths.session, "utf8")),
  );
  session.itemStates = { "review-item-1": state };
  if (input.action === "UNRESOLVED") {
    session.completedRequiredCount = 0;
    session.unresolvedRequiredCount = 1;
    session.reviewComplete = false;
    session.regionStates = {
      "region-1": {
        requiredItemCount: 1,
        completedRequiredCount: 0,
        unresolvedRequiredCount: 1,
        complete: false,
      },
    };
  }
  const audit = reviewAuditRecordSchema.parse({
    schemaVersion: "1.0.0",
    auditId: "action-audit",
    operation: "DECISION",
    timestamp: correction.createdAt,
    sessionId: correction.sessionId,
    reviewItemId: correction.reviewItemId,
    previousDecision: null,
    newDecision: correction.recordId,
    undoneRecordId: null,
    beforeHash: machineQualitySemanticHash(null),
    afterHash: machineQualitySemanticHash(state),
  });
  await Promise.all([
    writeFile(value.paths.reviewData, JSON.stringify(value.data), "utf8"),
    writeFile(value.paths.freeze, JSON.stringify(freeze(value.data)), "utf8"),
    writeFile(value.paths.session, JSON.stringify(session), "utf8"),
    writeFile(
      value.paths.corrections,
      `${JSON.stringify(correction)}\n`,
      "utf8",
    ),
    writeFile(value.paths.audit, `${JSON.stringify(audit)}\n`, "utf8"),
  ]);
  return value;
}

describe("C6.0.1.12 freeze-bound correction dataset", () => {
  it("uses the freezer hash ordering for mixed-case nested C60114 metadata and still rejects tampering", async () => {
    const { root, paths, data } = await fixture();
    data.machineDraftIdentity = {
      ...data.machineDraftIdentity,
      rankPosition: 1,
      rankScore: 2,
      rankerStatus: "FROZEN_SYNTHETIC_METADATA",
    };
    const frozen = freeze(data);
    await writeFile(paths.reviewData, JSON.stringify(data), "utf8");
    const server = await startC60112FrozenReviewWorkspaceServer({
      workspaceDirectory: root,
      freeze: frozen,
    });
    try {
      expect(server.workspaceDataHash).toBe(machineQualitySemanticHash(data));
    } finally {
      await server.close();
    }
    data.machineDraftIdentity.rankScore = 3;
    await writeFile(paths.reviewData, JSON.stringify(data), "utf8");
    await expect(
      startC60112FrozenReviewWorkspaceServer({
        workspaceDirectory: root,
        freeze: frozen,
      }),
    ).rejects.toThrow("REVIEW_WORKSPACE_DATA_FREEZE_HASH_MISMATCH");
  });

  it.each(["apply", "export-corrections", "stats"] as const)(
    "rejects a frozen-registry-disallowed action in %s with otherwise valid session and audit",
    async (command) => {
      const { paths } = await actionFixture({
        action: "MANUAL_EDIT",
        cueIds: ["cue-1"],
        allowed: false,
      });
      await expect(runCli(cliArguments(command, paths))).rejects.toThrow(
        /ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM/u,
      );
    },
  );

  it.each([
    ["KEEP_CURRENT", [], "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM"],
    ["MARK_FALSE_POSITIVE", ["cue-1"], "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM"],
    ["ADD_NEW_CUE", ["cue-1"], "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM"],
    ["MANUAL_EDIT", [], "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM"],
    ["MANUAL_EDIT", ["cue-1", "cue-2"], "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM"],
    ["TIMING_EDIT", [], "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM"],
    ["TIMING_EDIT", ["cue-1", "cue-2"], "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM"],
    ["USE_REAZON", [], "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM"],
    [
      "USE_WHISPER_ALTERNATE",
      ["cue-1", "cue-2"],
      "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM",
    ],
  ] as const)(
    "rejects %s on frozen target %j",
    async (action, cueIds, error) => {
      const { paths } = await actionFixture({
        action,
        cueIds: [...cueIds],
        allowed: false,
      });
      await expect(runCli(cliArguments("stats", paths))).rejects.toThrow(error);
    },
  );

  it("rejects whitespace-only waiver notes just like the server", async () => {
    const { paths } = await actionFixture({
      action: "WAIVE_REVIEW",
      cueIds: [],
      allowed: true,
      note: "   ",
    });
    await expect(runCli(cliArguments("stats", paths))).rejects.toThrow(
      /WAIVER_NOTE_REQUIRED/u,
    );
  });

  it("validates the action registry for inactive corrections as well as the active snapshot", async () => {
    const { paths, data } = await fixture();
    const item = data.items[0];
    if (item === undefined) throw new Error("Fixture item is missing.");
    item.suggestedActions = ["KEEP_CURRENT"];
    await Promise.all([
      writeFile(paths.reviewData, JSON.stringify(data), "utf8"),
      writeFile(paths.freeze, JSON.stringify(freeze(data)), "utf8"),
    ]);
    await expect(
      runCli(cliArguments("export-corrections", paths)),
    ).rejects.toThrow(/ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM:record-undone/u);
  });

  it.each([
    ["KEEP_CURRENT", ["cue-1", "cue-2"]],
    ["MARK_FALSE_POSITIVE", []],
    ["ADD_NEW_CUE", []],
    ["UNRESOLVED", []],
    ["WAIVE_REVIEW", []],
  ] as const)(
    "preserves server permission for %s on frozen target %j",
    async (action, cueIds) => {
      const { paths } = await actionFixture({
        action,
        cueIds: [...cueIds],
        allowed: true,
        note: "Explicit review waiver",
      });
      const result = JSON.parse(
        (await runCli(cliArguments("stats", paths))).stdout,
      ) as Record<string, unknown>;
      expect(result.recordCount).toBe(1);
    },
  );

  it.each(["apply", "export-corrections", "stats"] as const)(
    "rejects forged empty completion summaries in %s despite a valid frozen identity and audit terminal state",
    async (command) => {
      const { paths } = await fixture();
      const session = reviewSessionSchema.parse(
        JSON.parse(await readFile(paths.session, "utf8")),
      );
      const forged = reviewSessionSchema.parse({
        ...session,
        itemStates: {},
        regionStates: {},
        completedRequiredCount: 0,
        unresolvedRequiredCount: 0,
        reviewComplete: true,
      });
      await Promise.all([
        writeFile(paths.session, JSON.stringify(forged), "utf8"),
        writeFile(paths.corrections, "", "utf8"),
        writeFile(paths.audit, "", "utf8"),
      ]);
      await expect(runCli(cliArguments(command, paths))).rejects.toThrow(
        /REVIEW_SESSION_COMPLETION_SUMMARY_MISMATCH/u,
      );
    },
  );

  it("rejects missing or foreign region summaries even when global completion counts are valid", async () => {
    const { paths } = await fixture();
    const session = reviewSessionSchema.parse(
      JSON.parse(await readFile(paths.session, "utf8")),
    );
    for (const regionStates of [
      {},
      { "foreign-region": session.regionStates["region-1"] },
    ]) {
      await writeFile(
        paths.session,
        JSON.stringify({ ...session, regionStates }),
        "utf8",
      );
      await expect(runCli(cliArguments("stats", paths))).rejects.toThrow(
        /REVIEW_SESSION_COMPLETION_SUMMARY_MISMATCH/u,
      );
    }
  });

  it("allows honest incomplete stats and export but blocks apply until required review is complete", async () => {
    const { paths } = await fixture();
    const session = reviewSessionSchema.parse(
      JSON.parse(await readFile(paths.session, "utf8")),
    );
    await Promise.all([
      writeFile(
        paths.session,
        JSON.stringify({
          ...session,
          itemStates: {},
          regionStates: {
            "region-1": {
              requiredItemCount: 1,
              completedRequiredCount: 0,
              unresolvedRequiredCount: 1,
              complete: false,
            },
          },
          completedRequiredCount: 0,
          unresolvedRequiredCount: 1,
          reviewComplete: false,
        }),
        "utf8",
      ),
      writeFile(paths.corrections, "", "utf8"),
      writeFile(paths.audit, "", "utf8"),
    ]);
    await expect(runCli(cliArguments("apply", paths))).rejects.toThrow(
      /REVIEW_SESSION_INCOMPLETE/u,
    );
    const stats = JSON.parse(
      (await runCli(cliArguments("stats", paths))).stdout,
    ) as Record<string, unknown>;
    expect(stats.recordCount).toBe(0);
    const exported = JSON.parse(
      (await runCli(cliArguments("export-corrections", paths))).stdout,
    ) as Record<string, unknown>;
    expect(exported.recordCount).toBe(0);
  });

  it("exports active records only and audits undone and crash-orphan records", async () => {
    const { paths, active } = await fixture();
    const result = await runCli(cliArguments("export-corrections", paths));
    const response = JSON.parse(result.stdout) as {
      recordCount: number;
      lifecycleCounts: Record<string, number>;
    };
    expect(response).toMatchObject({
      recordCount: 1,
      lifecycleCounts: { ACTIVE: 1, UNDONE: 1, SUPERSEDED: 0, ORPHAN: 1 },
    });
    const datasetLines = (
      await readFile(
        path.join(paths.dataset, "human-corrections.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => humanCorrectionRecordSchema.parse(JSON.parse(line)));
    expect(datasetLines.map((record) => record.recordId)).toEqual([
      active.recordId,
    ]);
    const lifecycle = JSON.parse(
      await readFile(
        path.join(paths.dataset, "correction-dataset-lifecycle.json"),
        "utf8",
      ),
    ) as {
      records: { recordId: string; status: string }[];
    };
    expect(
      Object.fromEntries(
        lifecycle.records.map((record) => [record.recordId, record.status]),
      ),
    ).toEqual({
      "record-active": "ACTIVE",
      "record-undone": "UNDONE",
      "record-crash-orphan": "ORPHAN",
    });
    const summary = correctionDatasetSummarySchema.parse(
      JSON.parse(
        await readFile(
          path.join(paths.dataset, "correction-dataset-summary.json"),
          "utf8",
        ),
      ),
    );
    expect(summary).toMatchObject({
      sourceRecordCount: 3,
      activeRecordCount: 1,
      undoneRecordCount: 1,
      supersededRecordCount: 0,
      orphanRecordCount: 1,
      recordCount: 1,
      decisionCounts: { KEEP_CURRENT: 1, MANUAL_EDIT: 0 },
    });

    const stats = JSON.parse(
      (await runCli(cliArguments("stats", paths))).stdout,
    ) as Record<string, unknown>;
    expect(stats).toMatchObject({
      sourceRecordCount: 3,
      activeRecordCount: 1,
      undoneRecordCount: 1,
      supersededRecordCount: 0,
      orphanRecordCount: 1,
      recordCount: 1,
    });
  });

  it("rejects tampered review-data before serve and apply despite unchanged embedded hashes", async () => {
    const { paths, data } = await fixture();
    await writeFile(
      paths.reviewData,
      `${JSON.stringify(
        {
          ...data,
          machineDraftIdentity: { ...data.machineDraftIdentity, cueCount: 99 },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(runCli(cliArguments("apply", paths))).rejects.toThrow(
      /REVIEW_WORKSPACE_DATA_FREEZE_HASH_MISMATCH/u,
    );
    await expect(
      runCli([
        "scripts/c6-0-1-12-review-server.ts",
        "--workspace",
        path.dirname(paths.reviewData),
        "--freeze",
        paths.freeze,
        "--port",
        "0",
      ]),
    ).rejects.toThrow(/REVIEW_WORKSPACE_DATA_FREEZE_HASH_MISMATCH/u);
  }, 15_000);

  it("keeps the served review data bound to the frozen startup snapshot", async () => {
    const { paths, data } = await fixture();
    const frozen = freeze(data);
    const running = await startC60112FrozenReviewWorkspaceServer({
      workspaceDirectory: path.dirname(paths.reviewData),
      freeze: frozen,
    });
    try {
      await writeFile(
        paths.reviewData,
        `${JSON.stringify(
          {
            ...data,
            machineDraftIdentity: {
              ...data.machineDraftIdentity,
              cueCount: 99,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const response = await fetch(new URL("review-data.json", running.url));
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as C60112ReviewWorkspaceData)
          .machineDraftIdentity.cueCount,
      ).toBe(1);
    } finally {
      await running.close();
    }
  });

  it("requires freeze/session/audit/review-data inputs for dataset stats", async () => {
    const { paths } = await fixture();
    await expect(
      runCli([
        "scripts/c6-0-1-12-review-cli.ts",
        "stats",
        "--corrections",
        paths.corrections,
      ]),
    ).rejects.toThrow(/Missing --freeze/u);
  });
});
