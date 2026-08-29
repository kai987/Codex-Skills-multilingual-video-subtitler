import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
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
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";

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
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import type { C60112ReviewPackageFreeze } from "../packages/video-subtitler/src/review/review-package-freeze.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const temporaryDirectories: string[] = [];
const runningServers: { close: () => Promise<void> }[] = [];
const runningChildProcesses: ChildProcess[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
  await Promise.all(
    runningChildProcesses.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          child.kill("SIGTERM");
        }),
    ),
  );
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
      sourceDurationMs: 30_000,
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

function reviewFreeze(
  data: C60112ReviewWorkspaceData,
): C60112ReviewPackageFreeze {
  const componentHash = "f".repeat(64);
  const workspaceDataHash = machineQualitySemanticHash(data);
  const aggregateHash = machineQualitySemanticHash({
    sourceMediaSha256: data.sourceMediaIdentity.sha256,
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
    sourceMediaSha256: data.sourceMediaIdentity.sha256 ?? "",
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
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
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

async function startReviewServerProcess(input: {
  workspaceRoot: string;
  freezePath: string;
}): Promise<{ url: string }> {
  const child = spawn(
    path.join(process.cwd(), "node_modules", ".bin", "tsx"),
    [
      "scripts/c6-0-1-12-review-server.ts",
      "--workspace",
      input.workspaceRoot,
      "--freeze",
      input.freezePath,
      "--port",
      "0",
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  runningChildProcesses.push(child);
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const rejectOnExit = (code: number | null, signal: NodeJS.Signals | null) =>
      reject(
        new Error(
          `Review server exited before readiness (${String(code ?? signal)}): ${stderr}`,
        ),
      );
    child.once("exit", rejectOnExit);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      try {
        const ready = JSON.parse(stdout) as unknown;
        if (
          ready !== null &&
          typeof ready === "object" &&
          "url" in ready &&
          typeof ready.url === "string"
        ) {
          child.off("exit", rejectOnExit);
          resolve({ url: ready.url });
        }
      } catch {
        // The CLI emits one pretty-printed JSON document; keep buffering.
      }
    });
  });
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

  it("executes the generated queue sorter with frozen scores, stable ties, and filters", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-ui-sort-"));
    temporaryDirectories.push(root);
    const data = reviewData();
    const output = await writeC60112ReviewWorkspace({
      workspaceDirectory: root,
      reviewData: data,
    });
    const javascript = await readFile(output.javascriptPath, "utf8");
    const sorter = javascript
      .split("\n")
      .find((line) => line.startsWith("function refreshFiltered()"));
    expect(sorter).toBeDefined();
    const base = data.items[0];
    if (!base) throw new Error("Expected a synthetic review item");
    const earlierLower = {
      ...base,
      reviewItemId: "earlier-lower",
      priorityScore: 71,
      sourceInterval: { start: 1, end: 2 },
    };
    const items = [
      { ...base, reviewItemId: "later-higher", priorityScore: 89 },
      earlierLower,
      { ...base, reviewItemId: "tie-b", priorityScore: 89 },
      { ...base, reviewItemId: "tie-a", priorityScore: 89 },
      { ...base, reviewItemId: "low", priorityScore: 20, priorityTier: "LOW" },
    ];
    const state = { data: { items }, filtered: [earlierLower], index: 0 };
    const priorityFilter = { value: "ALL" };
    const filters: Record<string, { value: string }> = {
      "priority-filter": priorityFilter,
      "type-filter": { value: "ALL" },
    };
    let renderCount = 0;
    const context = {
      state,
      byId: (id: string) => filters[id],
      typeMatches: () => true,
      render: () => {
        renderCount += 1;
      },
    };
    runInNewContext(`${sorter}\nrefreshFiltered();`, context);
    expect(state.filtered.map((item) => item.reviewItemId)).toEqual([
      "later-higher",
      "tie-a",
      "tie-b",
      "earlier-lower",
      "low",
    ]);
    expect(state.index).toBe(3);
    priorityFilter.value = "LOW";
    runInNewContext(`${sorter}\nrefreshFiltered();`, context);
    expect(state.filtered.map((item) => item.reviewItemId)).toEqual(["low"]);
    expect(state.index).toBe(0);
    expect(renderCount).toBe(2);
    const initialize = javascript
      .split("\n")
      .find((line) => line.startsWith("Promise.all([fetch("));
    expect(initialize).toBeDefined();
    state.filtered = [];
    priorityFilter.value = "ALL";
    await runInNewContext(`${sorter}\n${initialize}`, {
      ...context,
      byId: (id: string) =>
        id === "identity" ? { textContent: "" } : filters[id],
      fetch: (url: string) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              url === "/api/session" ? { session: null } : { ...data, items },
            ),
        }),
      showStatus: () => undefined,
    });
    expect(state.index).toBe(0);
    expect(state.filtered[0]?.reviewItemId).toBe("later-higher");
    expect(renderCount).toBe(3);
  });

  it("captures reviewer notes from the generated UI for ordinary edits and explicit overrides", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-ui-notes-"));
    temporaryDirectories.push(root);
    const data = reviewData();
    const output = await writeC60112ReviewWorkspace({
      workspaceDirectory: root,
      reviewData: data,
    });
    const javascript = await readFile(output.javascriptPath, "utf8");
    const payloadFunction = javascript
      .split("\n")
      .find((line) => line.startsWith("function currentDecisionPayload("));
    expect(payloadFunction).toBeDefined();
    const input = { value: "synthetic local reviewer note" };
    const context = {
      state: { data },
      item: data.items[0],
      byId: () => input,
      operationId: () => "synthetic-note-decision",
    };
    expect(
      runInNewContext(
        `${payloadFunction}\ncurrentDecisionPayload(item, 'MANUAL_EDIT', { afterText: '合成編集' });`,
        context,
      ),
    ).toMatchObject({ reviewerNote: input.value });
    expect(
      runInNewContext(
        `${payloadFunction}\ncurrentDecisionPayload(item, 'WAIVE_REVIEW', { reviewerNote: 'explicit reason' });`,
        context,
      ),
    ).toMatchObject({ reviewerNote: "explicit reason" });
    input.value = "";
    expect(
      runInNewContext(
        `${payloadFunction}\ncurrentDecisionPayload(item, 'KEEP_CURRENT');`,
        context,
      ),
    ).toMatchObject({ reviewerNote: null });
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
      undoId: "undo-edit",
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

  it("recovers correction/audit/session crash windows and makes a decision retry idempotent", async () => {
    const { root, running } = await workspace();
    const request = decision({
      decisionId: "decision-crash-retry",
      decisionType: "MANUAL_EDIT",
      afterText: "中断後も一度だけ反映",
    });
    expect((await post(running.url, "/api/decision", request)).status).toBe(
      200,
    );

    const sessionPath = path.join(root, "session", "review-session.json");
    const auditPath = path.join(root, "session", "review-audit.jsonl");
    const correctionPath = path.join(
      root,
      "session",
      "human-correction-log.jsonl",
    );

    // Simulate a process crash after the durable correction but before audit/session.
    await Promise.all([rm(sessionPath), rm(auditPath)]);
    const orphanSession: unknown = await fetch(
      new URL("/api/session", running.url),
    ).then((response) => response.json());
    expect(orphanSession).toEqual({ status: "not-started", session: null });
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const unrelatedRequest = await post(
      running.url,
      "/api/decision",
      decision({ decisionId: "different-decision-during-recovery" }),
    );
    expect(unrelatedRequest.status).toBe(409);
    await expect(unrelatedRequest.json()).resolves.toMatchObject({
      code: "PENDING_DECISION_RECOVERY_REQUIRED",
    });
    const correctionOnlyRetry = await post(
      running.url,
      "/api/decision",
      request,
    );
    expect(correctionOnlyRetry.status).toBe(200);
    await expect(correctionOnlyRetry.json()).resolves.toMatchObject({
      session: {
        itemStates: {
          "review-item-a": {
            decisionType: "MANUAL_EDIT",
            afterText: "中断後も一度だけ反映",
          },
        },
      },
    });

    // Simulate the later crash window: audit is durable but session rename did not land.
    await rm(sessionPath);
    const auditOnlyRetry = await post(running.url, "/api/decision", request);
    expect(auditOnlyRetry.status).toBe(200);
    const [corrections, audits] = await Promise.all([
      readFile(correctionPath, "utf8"),
      readFile(auditPath, "utf8"),
    ]);
    expect(corrections.trim().split("\n")).toHaveLength(1);
    expect(audits.trim().split("\n")).toHaveLength(1);
    await expect(
      readFile(
        path.join(root, "session", "pending-workspace-transaction.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const mismatchedRetry = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: request.decisionId,
        decisionType: "MANUAL_EDIT",
        afterText: "同じIDの別内容",
      }),
    );
    expect(mismatchedRetry.status).toBe(409);
    await expect(mismatchedRetry.json()).resolves.toMatchObject({
      code: "DECISION_ID_REUSE_MISMATCH",
    });
  });

  it("finishes a durable pending transaction after interruption before any log commit", async () => {
    const { root, running } = await workspace();
    const request = decision({ decisionId: "decision-pending-journal" });
    expect((await post(running.url, "/api/decision", request)).status).toBe(
      200,
    );
    const sessionDirectory = path.join(root, "session");
    const sessionPath = path.join(sessionDirectory, "review-session.json");
    const correctionPath = path.join(
      sessionDirectory,
      "human-correction-log.jsonl",
    );
    const auditPath = path.join(sessionDirectory, "review-audit.jsonl");
    const correction = humanCorrectionRecordSchema.parse(
      JSON.parse((await readFile(correctionPath, "utf8")).trim()) as unknown,
    );
    const audit = reviewAuditRecordSchema.parse(
      JSON.parse((await readFile(auditPath, "utf8")).trim()) as unknown,
    );
    const session = reviewSessionSchema.parse(
      JSON.parse(await readFile(sessionPath, "utf8")) as unknown,
    );
    await writeFile(
      path.join(sessionDirectory, "pending-workspace-transaction.json"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        transactionId: audit.auditId,
        operation: "DECISION",
        correction,
        audit,
        session,
      })}\n`,
      "utf8",
    );
    await Promise.all([rm(sessionPath), rm(correctionPath), rm(auditPath)]);

    const recovered: unknown = await fetch(
      new URL("/api/session", running.url),
    ).then((response) => response.json());
    expect(recovered).toMatchObject({
      status: "active",
      session: {
        itemStates: {
          "review-item-a": { decisionType: "KEEP_CURRENT" },
        },
      },
    });
    expect(
      (await readFile(correctionPath, "utf8")).trim().split("\n"),
    ).toHaveLength(1);
    expect((await readFile(auditPath, "utf8")).trim().split("\n")).toHaveLength(
      1,
    );
    await expect(
      readFile(
        path.join(sessionDirectory, "pending-workspace-transaction.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers an interrupted undo without undoing the preceding decision twice", async () => {
    const { root, running } = await workspace();
    expect((await post(running.url, "/api/decision", decision())).status).toBe(
      200,
    );
    expect(
      (
        await post(
          running.url,
          "/api/decision",
          decision({
            decisionId: "decision-before-undo-crash",
            decisionType: "MANUAL_EDIT",
            afterText: "取り消す編集",
          }),
        )
      ).status,
    ).toBe(200);
    const undoRequest = {
      undoId: "undo-crash-retry",
      expectedReviewPackageSemanticHash: HASH_B,
      expectedMachineDraftHash: HASH_C,
    };
    expect((await post(running.url, "/api/undo", undoRequest)).status).toBe(
      200,
    );

    await rm(path.join(root, "session", "review-session.json"));
    const retry = await post(running.url, "/api/undo", undoRequest);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      session: {
        itemStates: {
          "review-item-a": { decisionType: "KEEP_CURRENT" },
        },
      },
    });
    const auditLines = (
      await readFile(path.join(root, "session", "review-audit.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    expect(auditLines).toHaveLength(3);
    expect(
      auditLines.filter((line) => line.includes('"operation":"UNDO"')),
    ).toHaveLength(1);
  });

  it("rejects undo while an orphan correction still requires exact decision recovery", async () => {
    const { root, running } = await workspace();
    expect((await post(running.url, "/api/decision", decision())).status).toBe(
      200,
    );
    const sessionDirectory = path.join(root, "session");
    const sessionPath = path.join(sessionDirectory, "review-session.json");
    const auditPath = path.join(sessionDirectory, "review-audit.jsonl");
    const committedSession = await readFile(sessionPath, "utf8");
    const committedAudit = await readFile(auditPath, "utf8");

    expect(
      (
        await post(
          running.url,
          "/api/decision",
          decision({
            decisionId: "decision-orphan-before-undo",
            decisionType: "MANUAL_EDIT",
            afterText: "まだ監査されていない修正",
          }),
        )
      ).status,
    ).toBe(200);

    // Recreate the crash window where the correction is durable but its audit
    // and session snapshot have not landed.
    await Promise.all([
      writeFile(sessionPath, committedSession, "utf8"),
      writeFile(auditPath, committedAudit, "utf8"),
    ]);
    const undo = await post(running.url, "/api/undo", {
      undoId: "undo-must-not-skip-orphan",
      expectedReviewPackageSemanticHash: HASH_B,
      expectedMachineDraftHash: HASH_C,
    });
    expect(undo.status).toBe(409);
    await expect(undo.json()).resolves.toMatchObject({
      code: "PENDING_DECISION_RECOVERY_REQUIRED",
    });
    expect(await readFile(auditPath, "utf8")).toBe(committedAudit);
    const session = reviewSessionSchema.parse(
      JSON.parse(await readFile(sessionPath, "utf8")) as unknown,
    );
    expect(session.itemStates["review-item-a"]?.decisionType).toBe(
      "KEEP_CURRENT",
    );
  });

  it("revalidates sourceDurationMs before recovering an orphan timing correction", async () => {
    const { root, running } = await workspace();
    const timingRequest = decision({
      decisionId: "decision-orphan-invalid-duration",
      decisionType: "TIMING_EDIT",
      afterStart: 5.2,
      afterEnd: 7.2,
    });
    expect(
      (await post(running.url, "/api/decision", timingRequest)).status,
    ).toBe(200);
    const sessionDirectory = path.join(root, "session");
    const correctionPath = path.join(
      sessionDirectory,
      "human-correction-log.jsonl",
    );
    const correction = humanCorrectionRecordSchema.parse(
      JSON.parse((await readFile(correctionPath, "utf8")).trim()) as unknown,
    );
    const outOfDurationCorrection = {
      ...correction,
      afterStart: 29.5,
      afterEnd: 30.001,
    };
    await Promise.all([
      writeFile(
        correctionPath,
        `${JSON.stringify(outOfDurationCorrection)}\n`,
        "utf8",
      ),
      rm(path.join(sessionDirectory, "review-session.json")),
      rm(path.join(sessionDirectory, "review-audit.jsonl")),
    ]);

    const retry = await post(running.url, "/api/decision", timingRequest);
    expect(retry.status).toBe(500);
    const retryBody = (await retry.json()) as {
      code?: unknown;
      message?: unknown;
    };
    expect(retryBody.code).toBe("AUDIT_CHAIN_BROKEN");
    expect(typeof retryBody.message).toBe("string");
    expect(retryBody.message).toContain("sourceDurationMs");
    await expect(
      readFile(path.join(sessionDirectory, "review-audit.jsonl"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes mutations from two servers sharing one workspace without losing either decision", async () => {
    const { root, running } = await workspace();
    const secondServer = await startC60112ReviewWorkspaceServer({
      workspaceDirectory: root,
      host: "127.0.0.1",
      port: 0,
    });
    runningServers.push(secondServer);

    const [first, second] = await Promise.all([
      post(
        running.url,
        "/api/decision",
        decision({ decisionId: "decision-from-first-server" }),
      ),
      post(
        secondServer.url,
        "/api/decision",
        decision({
          decisionId: "decision-from-second-server",
          reviewItemId: "review-item-missing",
          decisionType: "MARK_FALSE_POSITIVE",
        }),
      ),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);

    const recovered = (await fetch(new URL("/api/session", running.url)).then(
      (response) => response.json(),
    )) as {
      session: {
        sessionId: string;
        itemStates: Record<string, { decisionType: string }>;
      };
    };
    expect(recovered.session.itemStates).toMatchObject({
      "review-item-a": { decisionType: "KEEP_CURRENT" },
      "review-item-missing": { decisionType: "MARK_FALSE_POSITIVE" },
    });
    const [corrections, audits] = await Promise.all([
      readFile(
        path.join(root, "session", "human-correction-log.jsonl"),
        "utf8",
      ),
      readFile(path.join(root, "session", "review-audit.jsonl"), "utf8"),
    ]);
    const correctionRecords = corrections
      .trim()
      .split("\n")
      .map((line) =>
        humanCorrectionRecordSchema.parse(JSON.parse(line) as unknown),
      );
    expect(correctionRecords).toHaveLength(2);
    expect(
      new Set(correctionRecords.map((record) => record.sessionId)),
    ).toEqual(new Set([recovered.session.sessionId]));
    expect(audits.trim().split("\n")).toHaveLength(2);
    const lockProbe = new DatabaseSync(
      path.join(root, "session", "workspace-mutation.sqlite"),
    );
    lockProbe.exec("BEGIN EXCLUSIVE");
    lockProbe.exec("ROLLBACK");
    lockProbe.close();
  });

  it("releases a cross-process mutation lock after its owner is killed", async () => {
    const { root, running } = await workspace();
    const lockPath = path.join(root, "session", "workspace-mutation.sqlite");
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(process.argv[1]); db.exec("BEGIN EXCLUSIVE"); process.stdout.write("LOCKED\\n"); setInterval(() => {}, 1000);',
        lockPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    runningChildProcesses.push(child);
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(
          new Error(`Lock holder exited before readiness: ${String(code)}`),
        ),
      );
      child.stdout.once("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("LOCKED")) resolve();
        else reject(new Error("Lock holder did not acquire its transaction."));
      });
    });
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    child.kill("SIGKILL");
    await exited;

    const saved = await post(
      running.url,
      "/api/decision",
      decision({ decisionId: "decision-after-lock-owner-crash" }),
    );
    expect(saved.status).toBe(200);
    const session = await fetch(new URL("/api/session", running.url));
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({
      session: {
        itemStates: {
          "review-item-a": {
            decisionId: "decision-after-lock-owner-crash",
          },
        },
      },
    });
  }, 15_000);

  it("serializes concurrent writes from two server processes against one workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c60112-processes-"));
    temporaryDirectories.push(root);
    const data = reviewData();
    await writeC60112ReviewWorkspace({
      workspaceDirectory: root,
      reviewData: data,
    });
    await writeFile(
      path.join(root, "audio", "region-a.wav"),
      Buffer.alloc(128, 7),
    );
    const freezePath = path.join(root, "review-package-freeze.json");
    await writeFile(
      freezePath,
      `${JSON.stringify(reviewFreeze(data), null, 2)}\n`,
      "utf8",
    );
    const [firstServer, secondServer] = await Promise.all([
      startReviewServerProcess({ workspaceRoot: root, freezePath }),
      startReviewServerProcess({ workspaceRoot: root, freezePath }),
    ]);

    const [first, second] = await Promise.all([
      post(
        firstServer.url,
        "/api/decision",
        decision({ decisionId: "decision-from-first-process" }),
      ),
      post(
        secondServer.url,
        "/api/decision",
        decision({
          decisionId: "decision-from-second-process",
          reviewItemId: "review-item-missing",
          decisionType: "MARK_FALSE_POSITIVE",
        }),
      ),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);

    const session = reviewSessionSchema.parse(
      JSON.parse(
        await readFile(
          path.join(root, "session", "review-session.json"),
          "utf8",
        ),
      ) as unknown,
    );
    expect(session.itemStates).toMatchObject({
      "review-item-a": { decisionType: "KEEP_CURRENT" },
      "review-item-missing": { decisionType: "MARK_FALSE_POSITIVE" },
    });
    const [corrections, audits] = await Promise.all([
      readFile(
        path.join(root, "session", "human-correction-log.jsonl"),
        "utf8",
      ),
      readFile(path.join(root, "session", "review-audit.jsonl"), "utf8"),
    ]);
    const correctionRecords = corrections
      .trim()
      .split("\n")
      .map((line) =>
        humanCorrectionRecordSchema.parse(JSON.parse(line) as unknown),
      );
    expect(correctionRecords).toHaveLength(2);
    expect(
      new Set(correctionRecords.map((record) => record.sessionId)),
    ).toEqual(new Set([session.sessionId]));
    expect(audits.trim().split("\n")).toHaveLength(2);
  });

  it("rejects timing and new-cue decisions beyond sourceDurationMs before review can complete", async () => {
    const { running } = await workspace();
    expect(
      (
        await post(
          running.url,
          "/api/decision",
          decision({
            decisionId: "decision-resolve-missing",
            reviewItemId: "review-item-missing",
            decisionType: "MARK_FALSE_POSITIVE",
          }),
        )
      ).status,
    ).toBe(200);
    const invalidTiming = await post(
      running.url,
      "/api/decision",
      decision({
        decisionId: "decision-out-of-bounds-timing",
        decisionType: "TIMING_EDIT",
        afterStart: 29.5,
        afterEnd: 30.001,
      }),
    );
    expect(invalidTiming.status).toBe(400);
    await expect(invalidTiming.json()).resolves.toMatchObject({
      code: "INVALID_TIMING_EDIT",
    });
    const sessionAfterTiming = (await fetch(
      new URL("/api/session", running.url),
    ).then((response) => response.json())) as {
      session: { reviewComplete: boolean; unresolvedRequiredCount: number };
    };
    expect(sessionAfterTiming.session).toMatchObject({
      reviewComplete: false,
      unresolvedRequiredCount: 1,
    });

    const second = await workspace();
    expect(
      (await post(second.running.url, "/api/decision", decision())).status,
    ).toBe(200);
    const invalidNewCue = await post(
      second.running.url,
      "/api/decision",
      decision({
        decisionId: "decision-out-of-bounds-new-cue",
        reviewItemId: "review-item-missing",
        decisionType: "ADD_NEW_CUE",
        afterText: "範囲外の追加字幕",
        afterStart: 29.5,
        afterEnd: 30.001,
      }),
    );
    expect(invalidNewCue.status).toBe(400);
    await expect(invalidNewCue.json()).resolves.toMatchObject({
      code: "INVALID_NEW_CUE",
    });
    const sessionAfterNewCue = (await fetch(
      new URL("/api/session", second.running.url),
    ).then((response) => response.json())) as {
      session: { reviewComplete: boolean; unresolvedRequiredCount: number };
    };
    expect(sessionAfterNewCue.session).toMatchObject({
      reviewComplete: false,
      unresolvedRequiredCount: 1,
    });
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
    const freezePath = path.join(root, "review-package-freeze.json");
    await writeFile(
      freezePath,
      `${JSON.stringify(reviewFreeze(data), null, 2)}\n`,
      "utf8",
    );
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
        "--freeze",
        freezePath,
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
