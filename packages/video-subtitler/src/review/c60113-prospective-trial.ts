import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import {
  c60113TrialManifestSchema,
  c60113TrialEventInputSchema,
  c60113TrialEventSchema,
  c60113TrialStateSchema,
  type C60113TrialManifest,
  type C60113TrialEventInput,
  type C60113TrialEvent,
  type C60113TrialState,
} from "@mvl/shared";
import {
  withC60112WorkspaceMutationLock,
  assertC60112ReviewWorkspaceData,
  type C60112ReviewWorkspaceData,
} from "./c60112-review-workspace.js";
import {
  c60113WorkspaceHash,
  c60113IntervalUnion,
  type C60113PlaybackInterval,
} from "./c60113-review-workspace.js";

export async function writeC60113PrivateJson(
  file: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}
const local = (root: string, file: string) => path.join(root, "session", file);
async function optionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export function c60113TrialEligibility(declarations: {
  goldUnavailable: boolean;
  previousHumanSubtitleUnavailable: boolean;
  reviewerPriorExposure: boolean;
}):
  | "ELIGIBLE"
  | "NOT_ELIGIBLE_PRIOR_GOLD_EXPOSURE"
  | "NOT_ELIGIBLE_GOLD_OR_HUMAN_SUBTITLE_AVAILABLE" {
  return declarations.reviewerPriorExposure
    ? "NOT_ELIGIBLE_PRIOR_GOLD_EXPOSURE"
    : !declarations.goldUnavailable ||
        !declarations.previousHumanSubtitleUnavailable
      ? "NOT_ELIGIBLE_GOLD_OR_HUMAN_SUBTITLE_AVAILABLE"
      : "ELIGIBLE";
}

export async function initializeC60113Trial(input: {
  workspaceDirectory: string;
  data: C60112ReviewWorkspaceData;
  rankerHash: string;
  declarations: {
    goldUnavailable: boolean;
    previousHumanSubtitleUnavailable: boolean;
    reviewerPriorExposure: boolean;
  };
  synthetic?: boolean;
  sourceMediaFile?: string;
  now?: string;
}): Promise<C60113TrialManifest> {
  const eligibility = c60113TrialEligibility(input.declarations);
  if (eligibility !== "ELIGIBLE") throw new Error(eligibility);
  assertC60112ReviewWorkspaceData(input.data);
  if (!input.data.regionReviewV2)
    throw new Error("TRIAL_REQUIRES_FROZEN_REGION_WORKSPACE_V2");
  const sourceMediaHash =
    input.data.sourceMediaIdentity.sha256 ??
    input.data.sourceMediaIdentity.sourceMediaSha256;
  const durationMs =
    input.data.sourceMediaIdentity.sourceDurationMs ??
    input.data.sourceMediaIdentity.durationMs;
  const duration =
    typeof durationMs === "number"
      ? durationMs / 1000
      : input.data.sourceMediaIdentity.durationSeconds;
  if (!(input.synthetic ?? false)) {
    const { validateC60113ProspectiveTrialPackage } =
      await import("./c60113-prospective-trial-package.js");
    const verified = await validateC60113ProspectiveTrialPackage(
      path.dirname(path.resolve(input.workspaceDirectory)),
    );
    if (
      verified.workspaceDirectory !== path.resolve(input.workspaceDirectory) ||
      verified.manifest.workspaceDataHash !== c60113WorkspaceHash(input.data) ||
      verified.ranker.semanticHash !== input.rankerHash
    )
      throw new Error("TRIAL_PROSPECTIVE_PACKAGE_BINDING_MISMATCH");
    if (!input.sourceMediaFile) throw new Error("TRIAL_SOURCE_MEDIA_REQUIRED");
    const sourceHash = createHash("sha256");
    for await (const chunk of createReadStream(input.sourceMediaFile)) {
      if (!Buffer.isBuffer(chunk)) throw new Error("TRIAL_SOURCE_READ_FAILED");
      sourceHash.update(chunk);
    }
    if (sourceHash.digest("hex") !== sourceMediaHash)
      throw new Error("TRIAL_SOURCE_MEDIA_HASH_MISMATCH");
  }
  const content = {
    schemaVersion: "1.0.0",
    trialVersion: "c6.0.1.13-prospective-trial-v1",
    trialId: `trial-${randomUUID()}`,
    sourceMediaHash,
    machineDraftHash: input.data.machineDraftHash,
    reviewPackageHash: input.data.reviewPackageSemanticHash,
    workspaceExtensionHash: input.data.regionReviewV2.semanticHash,
    rankerHash: input.rankerHash,
    sourceDurationSeconds: duration,
    requiredItemIds: input.data.items
      .filter((i) => i.requiredLevel === "REQUIRED")
      .map((i) => i.reviewItemId),
    declarations: input.declarations,
    synthetic: input.synthetic ?? false,
    createdAt: input.now ?? new Date().toISOString(),
    activeTimePolicy: {
      version: "visible-focused-interaction-or-playback-v1",
      idleTimeoutSeconds: 60,
      maximumSampleGapSeconds: 5,
    },
  };
  const manifest = c60113TrialManifestSchema.parse({
    ...content,
    semanticHash: c60113WorkspaceHash(content),
  });
  await withC60112WorkspaceMutationLock(input.workspaceDirectory, async () => {
    if (
      await optionalJson(local(input.workspaceDirectory, "trial-manifest.json"))
    )
      throw new Error("TRIAL_ALREADY_INITIALIZED");
    if (
      await optionalJson(local(input.workspaceDirectory, "review-session.json"))
    )
      throw new Error("TRIAL_PRIOR_REVIEW_STATE_PRESENT");
    try {
      if (
        (
          await readFile(
            local(input.workspaceDirectory, "human-correction-log.jsonl"),
            "utf8",
          )
        ).trim()
      )
        throw new Error("TRIAL_PRIOR_REVIEW_STATE_PRESENT");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const log = await open(
      local(input.workspaceDirectory, "review-trial-events.jsonl"),
      "a",
      0o600,
    );
    try {
      if ((await log.stat()).size !== 0)
        throw new Error("TRIAL_EXISTING_EVENT_LOG_NOT_EMPTY");
      await log.sync();
    } finally {
      await log.close();
    }
    await writeC60113PrivateJson(
      local(input.workspaceDirectory, "trial-manifest.json"),
      manifest,
    );
  });
  return manifest;
}

async function readManifest(
  root: string,
  data?: C60112ReviewWorkspaceData,
): Promise<C60113TrialManifest | null> {
  const raw = await optionalJson(local(root, "trial-manifest.json"));
  if (!raw) return null;
  const manifest = c60113TrialManifestSchema.parse(raw);
  const { semanticHash, ...content } = manifest;
  if (semanticHash !== c60113WorkspaceHash(content))
    throw new Error("TRIAL_MANIFEST_HASH_MISMATCH");
  if (
    data &&
    (data.reviewPackageSemanticHash !== manifest.reviewPackageHash ||
      data.machineDraftHash !== manifest.machineDraftHash ||
      data.regionReviewV2?.semanticHash !== manifest.workspaceExtensionHash)
  )
    throw new Error("REVIEW_SESSION_BASE_MISMATCH");
  if (!manifest.synthetic) {
    const { validateC60113ProspectiveTrialPackage } =
      await import("./c60113-prospective-trial-package.js");
    const verified = await validateC60113ProspectiveTrialPackage(
      path.dirname(path.resolve(root)),
    );
    if (
      verified.manifest.deploymentRankerHash !== manifest.rankerHash ||
      verified.manifest.workspaceDataHash !==
        c60113WorkspaceHash(data ?? verified.data)
    )
      throw new Error("TRIAL_PROSPECTIVE_PACKAGE_BINDING_MISMATCH");
  }
  return manifest;
}
async function readEvents(root: string): Promise<C60113TrialEvent[]> {
  let content: string;
  try {
    content = await readFile(local(root, "review-trial-events.jsonl"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  if (content && !content.endsWith("\n"))
    throw new Error("TRIAL_EVENT_LOG_TRUNCATED");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => c60113TrialEventSchema.parse(JSON.parse(line)));
}
async function appendEvent(
  root: string,
  event: C60113TrialEvent,
): Promise<void> {
  const file = await open(local(root, "review-trial-events.jsonl"), "a", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(event)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function recoverEvent(root: string): Promise<void> {
  const pending = await optionalJson(local(root, "pending-trial-event.json"));
  if (!pending) return;
  const event = c60113TrialEventSchema.parse(pending);
  const logPath = local(root, "review-trial-events.jsonl");
  let raw = "";
  try {
    raw = await readFile(logPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (raw && !raw.endsWith("\n")) {
    const lastNewline = raw.lastIndexOf("\n"),
      prefix = raw.slice(0, lastNewline + 1),
      partial = raw.slice(lastNewline + 1);
    const completed = prefix
      .split("\n")
      .filter(Boolean)
      .map((line) => c60113TrialEventSchema.parse(JSON.parse(line)));
    if (
      !`${JSON.stringify(event)}\n`.startsWith(partial) ||
      event.sequence !== completed.length + 1 ||
      event.previousEventHash !== (completed.at(-1)?.semanticHash ?? null)
    )
      throw new Error("TRIAL_PENDING_PARTIAL_APPEND_CONFLICT");
    // Only the provable prefix of this durable pending record may be repaired.
    const file = await open(logPath, "r+");
    try {
      await file.truncate(Buffer.byteLength(prefix));
      await file.sync();
    } finally {
      await file.close();
    }
  }
  const history = await readEvents(root);
  const existing = history.find((e) => e.eventId === event.eventId);
  if (existing && c60113WorkspaceHash(existing) !== c60113WorkspaceHash(event))
    throw new Error("TRIAL_PENDING_EVENT_CONFLICT");
  if (!existing) {
    if (
      event.sequence !== history.length + 1 ||
      event.previousEventHash !== (history.at(-1)?.semanticHash ?? null)
    )
      throw new Error("TRIAL_PENDING_EVENT_CHAIN_MISMATCH");
    await appendEvent(root, event);
  }
  await unlink(local(root, "pending-trial-event.json"));
}

export function calculateC60113TrialState(
  manifest: C60113TrialManifest,
  events: C60113TrialEvent[],
): C60113TrialState {
  let status: C60113TrialState["status"] = "INITIALIZED",
    previous: C60113TrialEvent | undefined,
    lastInteraction = -Infinity,
    started: number | null = null;
  let active = 0,
    audio = 0;
  const played: C60113PlaybackInterval[] = [],
    decisions = new Map<string, C60113TrialEvent[]>(),
    ids = new Set<string>();
  for (const [index, event] of events.entries()) {
    const { semanticHash, ...content } = event;
    if (
      event.trialId !== manifest.trialId ||
      event.sequence !== index + 1 ||
      event.previousEventHash !== (previous?.semanticHash ?? null) ||
      c60113WorkspaceHash(content) !== semanticHash ||
      ids.has(event.eventId)
    )
      throw new Error("TRIAL_EVENT_CHAIN_INVALID");
    if (
      event.expectedRankerHash !== manifest.rankerHash ||
      event.expectedReviewPackageHash !== manifest.reviewPackageHash
    )
      throw new Error("TRIAL_EVENT_FREEZE_MISMATCH");
    ids.add(event.eventId);
    const at = Date.parse(event.timestamp),
      before = previous ? Date.parse(previous.timestamp) : at;
    if (at < before) throw new Error("TRIAL_CLOCK_MOVED_BACKWARD");
    if (
      status === "ACTIVE" &&
      previous &&
      previous.visible &&
      previous.focused &&
      event.visible &&
      event.focused
    ) {
      const gap = (at - before) / 1000;
      // Gaps beyond heartbeat tolerance cannot prove visibility/playback and are idle.
      if (
        gap <= manifest.activeTimePolicy.maximumSampleGapSeconds &&
        (previous.audioPlaying ||
          before - lastInteraction <
            manifest.activeTimePolicy.idleTimeoutSeconds * 1000)
      )
        active += gap;
    }
    if (event.interaction) lastInteraction = at;
    if (event.eventType === "TRIAL_STARTED") {
      if (status !== "INITIALIZED") throw new Error("TRIAL_INVALID_START");
      status = "ACTIVE";
      started = at;
    } else if (event.eventType === "TRIAL_PAUSED") {
      if (status !== "ACTIVE") throw new Error("TRIAL_INVALID_PAUSE");
      status = "PAUSED";
    } else if (event.eventType === "TRIAL_RESUMED") {
      if (status !== "PAUSED") throw new Error("TRIAL_INVALID_RESUME");
      status = "ACTIVE";
    } else if (event.eventType === "TRIAL_COMPLETED") {
      if (status !== "ACTIVE" && status !== "PAUSED")
        throw new Error("TRIAL_INVALID_COMPLETE");
      status = "COMPLETED";
    } else if (status !== "ACTIVE") throw new Error("TRIAL_NOT_ACTIVE");
    if (event.sourceInterval) {
      if (event.sourceInterval.end > manifest.sourceDurationSeconds)
        throw new Error("TRIAL_PLAYBACK_OUTSIDE_SOURCE");
      if (
        event.eventType === "ACTIVITY_SAMPLE" ||
        event.eventType === "AUDIO_PAUSED"
      ) {
        const elapsed = event.sourceInterval.end - event.sourceInterval.start;
        if (elapsed > 10) throw new Error("TRIAL_PLAYBACK_SAMPLE_TOO_LONG");
        played.push(event.sourceInterval);
        audio += elapsed;
      }
    }
    if (event.eventType === "DECISION_COMMITTED" && event.itemId)
      decisions.set(event.itemId, [
        ...(decisions.get(event.itemId) ?? []),
        event,
      ]);
    if (event.eventType === "DECISION_UNDONE" && event.itemId)
      decisions.get(event.itemId)?.pop();
    previous = event;
  }
  const unique = c60113IntervalUnion(played),
    uniqueSeconds = unique.reduce((sum, p) => sum + p.end - p.start, 0);
  const countEvent = (type: C60113TrialEvent["eventType"]) =>
    events.filter((e) => e.eventType === type).length;
  const activeDecisions = [...decisions.values()]
    .map((stack) => stack.at(-1))
    .filter((e): e is C60113TrialEvent => e !== undefined);
  const countDecision = (type: string) =>
    activeDecisions.filter((e) => e.decisionType === type).length;
  const requiredDone = manifest.requiredItemIds.filter((id) => {
    const d = decisions.get(id)?.at(-1);
    return d && d.decisionType !== "UNRESOLVED";
  }).length;
  return c60113TrialStateSchema.parse({
    schemaVersion: "1.0.0",
    trialId: manifest.trialId,
    status,
    eventCount: events.length,
    lastEventHash: events.at(-1)?.semanticHash ?? null,
    metrics: {
      totalElapsedSeconds:
        started === null
          ? 0
          : Math.max(
              0,
              (Date.parse(events.at(-1)?.timestamp ?? manifest.createdAt) -
                started) /
                1000,
            ),
      activeReviewSeconds: active,
      audioPlaybackSeconds: audio,
      uniqueAudioPlayedSeconds: uniqueSeconds,
      repeatedAudioSeconds: Math.max(0, audio - uniqueSeconds),
      regionOpenCount: countEvent("REGION_OPENED"),
      decisionCount: countEvent("DECISION_COMMITTED"),
      candidateClickCount: countEvent("CANDIDATE_CLICKED"),
      candidateBaseEditCount: countEvent("CANDIDATE_USED_AS_BASE"),
      manualEditCount: countDecision("MANUAL_EDIT"),
      manualCharactersEntered: events.reduce(
        (sum, e) => sum + e.manualCharactersEntered,
        0,
      ),
      timingEditCount: countDecision("TIMING_EDIT"),
      newCueCount: countDecision("ADD_NEW_CUE"),
      falsePositiveCount: countDecision("MARK_FALSE_POSITIVE"),
      unresolvedCount: countDecision("UNRESOLVED"),
      requiredCompletionRate: manifest.requiredItemIds.length
        ? requiredDone / manifest.requiredItemIds.length
        : 1,
      playedSourceIntervals: unique,
    },
    realHumanSessionExecuted: !manifest.synthetic && started !== null,
    humanReviewTimeMeasured: !manifest.synthetic && active > 0,
  });
}

export async function readC60113Trial(
  root: string,
  data?: C60112ReviewWorkspaceData,
): Promise<{ manifest: C60113TrialManifest; state: C60113TrialState } | null> {
  return withC60112WorkspaceMutationLock(root, async () => {
    const manifest = await readManifest(root, data);
    if (!manifest) return null;
    await recoverEvent(root);
    return {
      manifest,
      state: calculateC60113TrialState(manifest, await readEvents(root)),
    };
  });
}

export async function recordC60113TrialEvent(input: {
  workspaceDirectory: string;
  event: C60113TrialEventInput;
  data?: C60112ReviewWorkspaceData;
  now?: string;
}): Promise<C60113TrialState> {
  const request = c60113TrialEventInputSchema.parse(input.event);
  return withC60112WorkspaceMutationLock(input.workspaceDirectory, async () => {
    const manifest = await readManifest(input.workspaceDirectory, input.data);
    if (!manifest) throw new Error("TRIAL_NOT_INITIALIZED");
    await recoverEvent(input.workspaceDirectory);
    const history = await readEvents(input.workspaceDirectory),
      existing = history.find((e) => e.eventId === request.eventId);
    if (existing) {
      for (const key of Object.keys(request) as (keyof C60113TrialEventInput)[])
        if (
          c60113WorkspaceHash(existing[key]) !==
          c60113WorkspaceHash(request[key])
        )
          throw new Error("TRIAL_EVENT_RETRY_CONFLICT");
      return calculateC60113TrialState(manifest, history);
    }
    const content = {
      ...request,
      schemaVersion: "1.0.0",
      trialId: manifest.trialId,
      sequence: history.length + 1,
      timestamp: input.now ?? new Date().toISOString(),
      previousEventHash: history.at(-1)?.semanticHash ?? null,
    };
    const event = c60113TrialEventSchema.parse({
      ...content,
      semanticHash: c60113WorkspaceHash(content),
    });
    const state = calculateC60113TrialState(manifest, [...history, event]);
    await writeC60113PrivateJson(
      local(input.workspaceDirectory, "pending-trial-event.json"),
      event,
    );
    await appendEvent(input.workspaceDirectory, event);
    await unlink(local(input.workspaceDirectory, "pending-trial-event.json"));
    return state;
  });
}

export async function exportC60113Trial(
  root: string,
  destination: string,
  data?: C60112ReviewWorkspaceData,
): Promise<C60113TrialState> {
  const trial = await readC60113Trial(root, data);
  if (!trial) throw new Error("TRIAL_NOT_INITIALIZED");
  // Export aggregate metrics only: private event history, notes and dialogue stay local.
  await writeC60113PrivateJson(destination, {
    schemaVersion: "1.0.0",
    trialId: trial.manifest.trialId,
    synthetic: trial.manifest.synthetic,
    status: trial.state.status,
    metrics: trial.state.metrics,
    realHumanSessionExecuted: trial.state.realHumanSessionExecuted,
    humanReviewTimeMeasured: trial.state.humanReviewTimeMeasured,
  });
  return trial.state;
}

export async function c60113PlaybackState(
  root: string,
  data: C60112ReviewWorkspaceData,
  input?: {
    intervals: C60113PlaybackInterval[];
    playbackSeconds: number;
    playbackCount: number;
  },
): Promise<{
  playedSourceIntervals: C60113PlaybackInterval[];
  playbackSeconds: number;
  playbackCount: number;
}> {
  return withC60112WorkspaceMutationLock(root, async () => {
    const raw = (await optionalJson(local(root, "review-playback.json"))) as {
      reviewPackageHash: string;
      playedSourceIntervals: C60113PlaybackInterval[];
      playbackSeconds: number;
      playbackCount: number;
    } | null;
    if (raw && raw.reviewPackageHash !== data.reviewPackageSemanticHash)
      throw new Error("REVIEW_SESSION_BASE_MISMATCH");
    const old = raw ?? {
      reviewPackageHash: data.reviewPackageSemanticHash,
      playedSourceIntervals: [],
      playbackSeconds: 0,
      playbackCount: 0,
    };
    if (!input) return old;
    if (
      !Number.isFinite(input.playbackSeconds) ||
      input.playbackSeconds < 0 ||
      input.playbackSeconds > 10 ||
      !Number.isInteger(input.playbackCount) ||
      input.playbackCount < 0 ||
      input.playbackCount > 1 ||
      input.intervals.length > 2
    )
      throw new Error("INVALID_PLAYBACK_SAMPLE");
    const sourceEnd = Math.max(
      ...data.regions.map((r) => r.audioSourceInterval?.end ?? r.contextEnd),
      0,
    );
    if (input.intervals.some((p) => p.end > sourceEnd || p.end - p.start > 10))
      throw new Error("INVALID_PLAYBACK_SAMPLE");
    const next = {
      reviewPackageHash: data.reviewPackageSemanticHash,
      playedSourceIntervals: c60113IntervalUnion([
        ...old.playedSourceIntervals,
        ...input.intervals,
      ]),
      playbackSeconds: old.playbackSeconds + input.playbackSeconds,
      playbackCount: old.playbackCount + input.playbackCount,
    };
    await writeC60113PrivateJson(local(root, "review-playback.json"), next);
    return next;
  });
}
