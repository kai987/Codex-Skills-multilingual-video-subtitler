import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  humanCorrectionRecordSchema,
  humanReviewManifestSchema,
  reviewAuditRecordSchema,
  reviewSessionSchema,
  subtitlePackageSchema,
} from "@mvl/shared";

import {
  C60112_REVIEW_WORKSPACE_VERSION,
  assertC60112SafeRelativePath,
  escapeC60112ReviewHtml,
  startC60112ReviewWorkspaceServer,
  writeC60112ReviewWorkspace,
  type C60112ReviewDecisionRequest,
  type C60112ReviewWorkspaceData,
} from "../packages/video-subtitler/src/review/c60112-review-workspace.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const temporaryDirectories: string[] = [];
const runningServers: { close: () => Promise<void> }[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function reviewData(): C60112ReviewWorkspaceData {
  return {
    schemaVersion: "1.0.0",
    workspaceVersion: C60112_REVIEW_WORKSPACE_VERSION,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2",
    policyHash: HASH_A,
    reviewPackageSemanticHash: HASH_B,
    machineDraftHash: HASH_C,
    sourceMediaIdentity: {
      fileName: "synthetic-review-fixture.mkv",
      sha256: HASH_A,
      durationSeconds: 30,
    },
    machineDraftIdentity: {
      cueHash: HASH_C,
      timingHash: HASH_A,
      cueCount: 2,
    },
    items: [
      {
        reviewItemId: "review-item-a",
        eventIds: ["event-a"],
        finalCueIds: ["cue-a"],
        itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT", "TIMING_BOUNDARY_RISK"],
        sourceInterval: { start: 4, end: 8 },
        coreInterval: { start: 5, end: 7 },
        currentText: "<img src=x onerror=globalThis.__xss=1>テスト",
        currentStart: 5,
        currentEnd: 7,
        candidateIds: [
          "candidate-current",
          "candidate-reazon",
          "candidate-whisper",
        ],
        evidenceIds: ["evidence-a"],
        reviewReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
        priorityTier: "CRITICAL",
        priorityScore: 0.9,
        requiredLevel: "REQUIRED",
        suggestedActions: [
          "KEEP_CURRENT",
          "USE_REAZON",
          "USE_WHISPER_ALTERNATE",
          "MANUAL_EDIT",
          "TIMING_EDIT",
          "UNRESOLVED",
          "WAIVE_REVIEW",
        ],
        regionId: "region-a",
        previousCue: { cueId: "cue-prev", text: "前", start: 3, end: 4 },
        nextCue: { cueId: "cue-next", text: "次", start: 8, end: 9 },
        semanticHash: HASH_A,
      },
      {
        reviewItemId: "review-item-missing",
        eventIds: ["event-missing"],
        finalCueIds: [],
        itemTypes: ["MISSING_SPEECH_RISK"],
        sourceInterval: { start: 10, end: 13 },
        coreInterval: { start: 11, end: 12 },
        currentText: "",
        currentStart: null,
        currentEnd: null,
        candidateIds: ["candidate-missing-reazon"],
        evidenceIds: ["evidence-missing"],
        reviewReasons: ["MISSING_DIALOGUE_SUSPECTED"],
        priorityTier: "HIGH",
        priorityScore: 0.8,
        requiredLevel: "REQUIRED",
        suggestedActions: ["ADD_NEW_CUE", "MARK_FALSE_POSITIVE", "UNRESOLVED"],
        regionId: "region-a",
        previousCue: { cueId: "cue-a", text: "テスト", start: 5, end: 7 },
        nextCue: null,
        semanticHash: HASH_B,
      },
    ],
    regions: [
      {
        regionId: "region-a",
        reviewItemIds: ["review-item-a", "review-item-missing"],
        contextStart: 2,
        contextEnd: 15,
        coreIntervals: [
          { start: 5, end: 7 },
          { start: 11, end: 12 },
        ],
        audioPath: "audio/region-a.wav",
        audioSha256: null,
      },
    ],
    candidateBundles: [
      {
        reviewItemId: "review-item-a",
        candidates: [
          {
            candidateId: "candidate-current",
            labels: ["CURRENT"],
            text: "テスト",
            evidenceBadges: ["STABLE"],
            provenance: ["machine-final"],
          },
          {
            candidateId: "candidate-reazon",
            labels: ["REAZON"],
            text: "レアゾン候補",
            evidenceBadges: ["NEAR_TIE"],
            provenance: ["reazon-core"],
          },
          {
            candidateId: "candidate-whisper",
            labels: ["WHISPER_ALT"],
            text: "ウィスパー候補",
            evidenceBadges: ["ACOUSTIC_FAVORED"],
            provenance: ["whisper-alternate"],
          },
        ],
      },
      {
        reviewItemId: "review-item-missing",
        candidates: [
          {
            candidateId: "candidate-missing-reazon",
            labels: ["REAZON"],
            text: "追加候補",
            evidenceBadges: ["LOW_TOKEN_SUPPORT"],
            provenance: ["reazon-core"],
          },
        ],
      },
    ],
  };
}

async function workspace(): Promise<{
  root: string;
  running: Awaited<ReturnType<typeof startC60112ReviewWorkspaceServer>>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-workspace-"));
  temporaryDirectories.push(root);
  await writeC60112ReviewWorkspace({
    workspaceDirectory: root,
    reviewData: reviewData(),
  });
  await writeFile(
    path.join(root, "audio", "region-a.wav"),
    Buffer.alloc(128, 7),
  );
  const running = await startC60112ReviewWorkspaceServer({
    workspaceDirectory: root,
    host: "127.0.0.1",
    port: 0,
  });
  runningServers.push(running);
  return { root, running };
}

function decision(
  overrides: Partial<C60112ReviewDecisionRequest> = {},
): C60112ReviewDecisionRequest {
  return {
    decisionId: "decision-a",
    reviewItemId: "review-item-a",
    decisionType: "KEEP_CURRENT",
    selectedCandidateId: null,
    afterText: null,
    afterStart: null,
    afterEnd: null,
    reviewerNote: null,
    expectedReviewPackageSemanticHash: HASH_B,
    expectedMachineDraftHash: HASH_C,
    ...overrides,
  };
}

async function post(
  url: string,
  route: string,
  body: unknown,
): Promise<Response> {
  return fetch(new URL(route, url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mvl-review-request": "c6-0-1-12",
    },
    body: JSON.stringify(body),
  });
}

async function rawRequest(input: {
  port: number;
  requestPath: string;
  hostHeader?: string;
  headers?: Record<string, string>;
}): Promise<{
  status: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: input.port,
        path: input.requestPath,
        method: "GET",
        headers: {
          ...(input.hostHeader === undefined ? {} : { host: input.hostHeader }),
          ...input.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
            headers: response.headers,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("C6.0.1.12 offline review workspace", () => {
  it("materializes a fully local CSP workspace and keeps untrusted text out of HTML execution sinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-assets-"));
    temporaryDirectories.push(root);
    const output = await writeC60112ReviewWorkspace({
      workspaceDirectory: root,
      reviewData: reviewData(),
    });
    const [html, css, javascript, data, sessionFiles] = await Promise.all([
      readFile(output.indexPath, "utf8"),
      readFile(output.cssPath, "utf8"),
      readFile(output.javascriptPath, "utf8"),
      readFile(output.dataPath, "utf8"),
      readdir(output.sessionDirectory),
    ]);

    expect(html).toContain("default-src 'self'");
    expect(html).toContain("connect-src 'self'");
    expect(`${html}${css}${javascript}`).not.toMatch(/https?:\/\//iu);
    expect(`${html}${css}${javascript}`).not.toMatch(/\bcdn\b/iu);
    expect(javascript).toContain(".textContent=");
    expect(javascript).toContain("replaceChildren");
    expect(javascript).not.toContain(".innerHTML");
    expect(javascript).not.toContain("insertAdjacentHTML");
    expect(javascript).toContain("event.key.toLowerCase()==='j'");
    expect(javascript).toContain("event.key.toLowerCase()==='k'");
    expect(javascript).toContain("Jump to core");
    expect(javascript).toContain("playbackRate");
    expect(javascript).toContain("ADD_NEW_CUE");
    expect(javascript).toContain("candidate.labels.join(' / ')");
    expect(javascript).toContain("selected?.labels.includes(label)");
    expect(javascript).toContain("state.selectedCandidate.set");
    expect(javascript).toContain("render()" + "}" + ")");
    expect(javascript).toContain("postJson('/api/decision'");
    expect(data).toContain("<img src=x onerror=globalThis.__xss=1>");
    expect(html).not.toContain("onerror=globalThis.__xss");
    expect(sessionFiles).toEqual([]);
    expect(escapeC60112ReviewHtml("<script>'&\"")).toBe(
      "&lt;script&gt;&#39;&amp;&quot;",
    );
  });

  it("rejects unsafe workspace audio paths before writing any asset", async () => {
    expect(() => assertC60112SafeRelativePath("../secret.wav")).toThrow(
      /traverse|safe/iu,
    );
    expect(() => assertC60112SafeRelativePath("%2e%2e/secret.wav")).toThrow(
      /traverse|safe/iu,
    );
    expect(() => assertC60112SafeRelativePath("audio\\secret.wav")).toThrow(
      /safe/iu,
    );
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-invalid-"));
    temporaryDirectories.push(root);
    const invalid = reviewData();
    const firstRegion = invalid.regions[0];
    if (firstRegion === undefined) throw new Error("Test region is missing.");
    firstRegion.audioPath = "../outside.wav";
    await expect(
      writeC60112ReviewWorkspace({
        workspaceDirectory: root,
        reviewData: invalid,
      }),
    ).rejects.toThrow(/audioPath|traverse|safe/iu);
  });

  it("serves only loopback-local files, supports audio ranges, and blocks traversal, private paths, symlinks, and forged hosts", async () => {
    const { root, running } = await workspace();
    await writeFile(
      path.join(root, "gold-reference.ass"),
      "synthetic forbidden reference",
      "utf8",
    );
    const page = await fetch(running.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");

    const range = await rawRequest({
      port: running.port,
      requestPath: "/audio/region-a.wav",
      headers: { range: "bytes=5-14" },
    });
    expect(range.status).toBe(206);
    expect(range.body).toHaveLength(10);
    expect(range.headers["content-range"]).toBe("bytes 5-14/128");

    for (const unsafePath of [
      "/../outside-secret.txt",
      "/%2e%2e/outside-secret.txt",
      "/..%2foutside-secret.txt",
      "/assets/%2e%2e/review-data.json",
      "/session/review-session.json",
      "/SESSION/review-session.json",
      "/gold-reference.ass",
    ]) {
      const response = await rawRequest({
        port: running.port,
        requestPath: unsafePath,
      });
      expect([403, 404]).toContain(response.status);
    }

    const outside = path.join(path.dirname(root), "outside-secret.txt");
    await writeFile(outside, "secret", "utf8");
    await symlink(outside, path.join(root, "audio", "escape.wav"));
    const symlinkResponse = await rawRequest({
      port: running.port,
      requestPath: "/audio/escape.wav",
    });
    expect(symlinkResponse.status).toBe(403);
    await rm(outside, { force: true });

    const forgedHost = await rawRequest({
      port: running.port,
      requestPath: "/",
      hostHeader: `localhost:${String(running.port)}`,
    });
    expect(forgedHost.status).toBe(403);
  });

  it("autosaves and resumes a file-backed session while keeping correction and audit logs append-only", async () => {
    const { root, running } = await workspace();
    const initial = await fetch(new URL("/api/session", running.url)).then(
      (response) =>
        response.json() as Promise<{ status: string; session: unknown }>,
    );
    expect(initial).toEqual({ status: "not-started", session: null });
    await expect(
      readFile(path.join(root, "session", "review-session.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const keepResponse = await post(running.url, "/api/decision", decision());
    expect(keepResponse.status).toBe(200);
    const keep = (await keepResponse.json()) as {
      session: { itemStates: Record<string, { decisionType: string }> };
    };
    expect(keep.session.itemStates["review-item-a"]?.decisionType).toBe(
      "KEEP_CURRENT",
    );

    const editResponse = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: "decision-edit",
        decisionType: "MANUAL_EDIT",
        afterText: "<script>safe as subtitle text</script>",
      }),
    );
    expect(editResponse.status).toBe(200);
    const resumed = await fetch(new URL("/api/session", running.url)).then(
      (response) =>
        response.json() as Promise<{
          status: string;
          session: {
            itemStates: Record<
              string,
              { decisionType: string; afterText: string | null }
            >;
          };
        }>,
    );
    expect(resumed.status).toBe("active");
    expect(resumed.session.itemStates["review-item-a"]).toMatchObject({
      decisionType: "MANUAL_EDIT",
      afterText: "<script>safe as subtitle text</script>",
    });

    const resumedServer = await startC60112ReviewWorkspaceServer({
      workspaceDirectory: root,
      host: "127.0.0.1",
      port: 0,
    });
    runningServers.push(resumedServer);
    const restoredFromDisk = await fetch(
      new URL("/api/session", resumedServer.url),
    ).then(
      (response) =>
        response.json() as Promise<{
          status: string;
          session: {
            itemStates: Record<string, { decisionType: string }>;
          };
        }>,
    );
    expect(restoredFromDisk.status).toBe("active");
    expect(
      restoredFromDisk.session.itemStates["review-item-a"]?.decisionType,
    ).toBe("MANUAL_EDIT");

    const undoResponse = await post(running.url, "/api/undo", {
      expectedReviewPackageSemanticHash: HASH_B,
      expectedMachineDraftHash: HASH_C,
    });
    expect(undoResponse.status).toBe(200);
    const undone = (await undoResponse.json()) as {
      session: { itemStates: Record<string, { decisionType: string }> };
    };
    expect(undone.session.itemStates["review-item-a"]?.decisionType).toBe(
      "KEEP_CURRENT",
    );

    const correctionLines = (
      await readFile(
        path.join(root, "session", "human-correction-log.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n");
    const auditLines = (
      await readFile(path.join(root, "session", "review-audit.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    expect(correctionLines).toHaveLength(2);
    expect(auditLines).toHaveLength(3);
    correctionLines.forEach((line) =>
      humanCorrectionRecordSchema.parse(JSON.parse(line) as unknown),
    );
    auditLines.forEach((line) =>
      reviewAuditRecordSchema.parse(JSON.parse(line) as unknown),
    );
    reviewSessionSchema.parse(
      JSON.parse(
        await readFile(
          path.join(root, "session", "review-session.json"),
          "utf8",
        ),
      ) as unknown,
    );
    expect(correctionLines.join("\n")).toContain("KEEP_CURRENT");
    expect(correctionLines.join("\n")).toContain("MANUAL_EDIT");
    expect(JSON.parse(correctionLines[1] ?? "{}") as unknown).toMatchObject({
      beforeText: "<img src=x onerror=globalThis.__xss=1>テスト",
      afterText: "<script>safe as subtitle text</script>",
    });
    expect(auditLines.at(-1)).toContain('"operation":"UNDO"');
  });

  it("fails closed on stale bases, invalid candidates, missing mutation headers, and malformed new cues", async () => {
    const { running } = await workspace();
    const stale = await post(
      running.url,
      "/api/decision",
      decision({ expectedMachineDraftHash: "stale-machine-draft" }),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "REVIEW_SESSION_BASE_MISMATCH",
    });

    const wrongCandidate = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: "decision-wrong-candidate",
        decisionType: "USE_REAZON",
        selectedCandidateId: "candidate-whisper",
      }),
    );
    expect(wrongCandidate.status).toBe(400);
    await expect(wrongCandidate.json()).resolves.toMatchObject({
      code: "CANDIDATE_SCOPE_MISMATCH",
    });

    const unavailableMissingAction = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: "decision-invalid-missing-action",
        reviewItemId: "review-item-missing",
        decisionType: "USE_REAZON",
        selectedCandidateId: "candidate-missing-reazon",
      }),
    );
    expect(unavailableMissingAction.status).toBe(400);
    await expect(unavailableMissingAction.json()).resolves.toMatchObject({
      code: "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM",
    });

    const noMutationHeader = await fetch(
      new URL("/api/decision", running.url),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(decision()),
      },
    );
    expect(noMutationHeader.status).toBe(403);

    const malformedNewCue = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: "decision-missing-cue",
        reviewItemId: "review-item-missing",
        decisionType: "ADD_NEW_CUE",
        afterText: "追加字幕",
        afterStart: 12,
        afterEnd: 11,
      }),
    );
    expect(malformedNewCue.status).toBe(400);
    await expect(malformedNewCue.json()).resolves.toMatchObject({
      code: "INVALID_NEW_CUE",
    });
  });

  it("rejects a workspace that exposes one text mutation across multiple cues", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-multi-cue-"));
    temporaryDirectories.push(root);
    const invalid = reviewData();
    const item = invalid.items[0];
    if (item === undefined) throw new Error("Test review item is missing.");
    item.finalCueIds = ["cue-a", "cue-b"];
    item.suggestedActions = ["KEEP_CURRENT", "MANUAL_EDIT", "UNRESOLVED"];

    await expect(
      writeC60112ReviewWorkspace({
        workspaceDirectory: root,
        reviewData: invalid,
      }),
    ).rejects.toThrow(/unsafe for its cue count/iu);
  });

  it("captures a complete local session and applies it through the strict CLI manifest path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-cli-"));
    temporaryDirectories.push(root);
    const basePackage = subtitlePackageSchema.parse({
      schemaVersion: "1.0.0",
      packageType: "multilingual-subtitle-package",
      status: "ready",
      sourceLanguage: "ja",
      detectedLanguages: ["ja"],
      source: {
        fileName: "synthetic-review-fixture.mkv",
        container: "mkv",
        durationSeconds: 30,
      },
      identity: {
        title: "Synthetic review fixture",
        season: null,
        episode: null,
        year: 2026,
      },
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
          id: "cue-a",
          text: "テスト",
          start: 5,
          end: 7,
          language: "ja",
          languages: ["ja"],
          speaker: null,
          confidence: 0.8,
        },
      ],
      warnings: [],
    });
    const baseText = `${JSON.stringify(basePackage, null, 2)}\n`;
    const machineDraftHash = createHash("sha256")
      .update(baseText)
      .digest("hex");
    const basePackagePath = path.join(root, "machine-draft.json");
    const workspaceRoot = path.join(root, "workspace");
    const outputRoot = path.join(root, "reviewed");
    await writeFile(basePackagePath, baseText, "utf8");
    const data = reviewData();
    data.machineDraftHash = machineDraftHash;
    data.machineDraftIdentity = {
      ...data.machineDraftIdentity,
      machineDraftHash,
    };
    await writeC60112ReviewWorkspace({
      workspaceDirectory: workspaceRoot,
      reviewData: data,
    });
    await writeFile(
      path.join(workspaceRoot, "audio", "region-a.wav"),
      Buffer.alloc(128, 7),
    );
    const running = await startC60112ReviewWorkspaceServer({
      workspaceDirectory: workspaceRoot,
      host: "127.0.0.1",
      port: 0,
    });
    runningServers.push(running);
    const manual = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: "decision-manual-first",
        decisionType: "MANUAL_EDIT",
        afterText: "手動修正字幕",
        expectedMachineDraftHash: machineDraftHash,
      }),
    );
    expect(manual.status).toBe(200);
    const timing = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: "decision-timing-second",
        decisionType: "TIMING_EDIT",
        afterStart: 5.2,
        afterEnd: 7.2,
        expectedMachineDraftHash: machineDraftHash,
      }),
    );
    expect(timing.status).toBe(200);
    const missing = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: "decision-missing-false-positive",
        reviewItemId: "review-item-missing",
        decisionType: "MARK_FALSE_POSITIVE",
        expectedMachineDraftHash: machineDraftHash,
      }),
    );
    expect(missing.status).toBe(200);

    await execFileAsync(
      path.join(process.cwd(), "node_modules", ".bin", "tsx"),
      [
        "scripts/c6-0-1-12-review-cli.ts",
        "apply",
        "--base-package",
        basePackagePath,
        "--session",
        path.join(workspaceRoot, "session", "review-session.json"),
        "--corrections",
        path.join(workspaceRoot, "session", "human-correction-log.jsonl"),
        "--review-data",
        path.join(workspaceRoot, "review-data.json"),
        "--output",
        outputRoot,
      ],
      { cwd: process.cwd() },
    );
    const manifest = humanReviewManifestSchema.parse(
      JSON.parse(
        await readFile(
          path.join(outputRoot, "human-review-manifest.json"),
          "utf8",
        ),
      ) as unknown,
    );
    expect(manifest).toMatchObject({
      machineDraftHash,
      unresolvedCount: 0,
      textChangedCueCount: 1,
      timingChangedCueCount: 1,
      newCueCount: 0,
      decisionCounts: {
        MANUAL_EDIT: 0,
        TIMING_EDIT: 1,
        MARK_FALSE_POSITIVE: 1,
      },
      strictSubtitlePackageValidated: true,
      machineOnlyReleaseAuthorized: false,
    });
    const reviewedPackage = subtitlePackageSchema.parse(
      JSON.parse(
        await readFile(
          path.join(outputRoot, "human-reviewed-subtitle-package.json"),
          "utf8",
        ),
      ) as unknown,
    );
    expect(reviewedPackage.cues[0]).toMatchObject({
      id: "cue-a",
      text: "手動修正字幕",
      start: 5.2,
      end: 7.2,
    });
  });
});
