import { createHash } from "node:crypto";
import {
  c60113WorkspaceExtensionSchema,
  type C60113WorkspaceExtension,
} from "@mvl/shared";
import type { C60112ReviewWorkspaceData } from "./c60112-review-workspace.js";

export function c60113WorkspaceHash(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

export function buildC60113WorkspaceExtension(
  input: Omit<
    C60113WorkspaceExtension,
    "schemaVersion" | "workspaceMode" | "semanticHash"
  >,
): C60113WorkspaceExtension {
  const value = {
    schemaVersion: "1.0.0" as const,
    workspaceMode: "REGION_FIRST_V2" as const,
    ...input,
  };
  return c60113WorkspaceExtensionSchema.parse({
    ...value,
    semanticHash: c60113WorkspaceHash(value),
  });
}

export function assertC60113WorkspaceExtension(
  data: C60112ReviewWorkspaceData,
): void {
  if (!data.regionReviewV2) return;
  const extension = c60113WorkspaceExtensionSchema.parse(data.regionReviewV2);
  const { semanticHash, ...content } = extension;
  // The extension owns the C6.0.1.13 policy; inherited top-level identity remains
  // C6.0.1.12 for the compatible transaction subsystem. Both are frozen together.
  if (c60113WorkspaceHash(content) !== semanticHash)
    throw new Error("REVIEW_WORKSPACE_EXTENSION_HASH_MISMATCH");
  const regionIds = new Set(data.regions.map((r) => r.regionId));
  if (
    extension.regions.length !== regionIds.size ||
    new Set(extension.regions.map((r) => r.regionId)).size !== regionIds.size
  )
    throw new Error("REVIEW_REGION_EXTENSION_COVERAGE_MISMATCH");
  for (const region of extension.regions) {
    const base = data.regions.find((r) => r.regionId === region.regionId);
    if (!base) throw new Error("REVIEW_REGION_EXTENSION_IDENTITY_MISMATCH");
    if (
      region.contextInterval.start !== base.contextStart ||
      region.contextInterval.end !== base.contextEnd ||
      [...region.itemIds].sort().join("\n") !==
        [...base.reviewItemIds].sort().join("\n")
    )
      throw new Error("REVIEW_REGION_EXTENSION_IDENTITY_MISMATCH");
  }
  for (const plan of extension.plans)
    if (
      plan.regionIds.some((id) => !regionIds.has(id)) ||
      new Set(plan.regionIds).size !== plan.regionIds.length
    )
      throw new Error("REVIEW_BUDGET_REGION_MISMATCH");
  if (new Set(extension.plans.map((p) => p.planId)).size !== 7)
    throw new Error("REVIEW_BUDGET_PLAN_COVERAGE_MISMATCH");
  const sorted = [...extension.segments].sort(
    (a, b) => a.sourceInterval.start - b.sourceInterval.start,
  );
  for (const [i, segment] of sorted.entries()) {
    const previous = sorted[i - 1];
    if (
      previous &&
      previous.sourceInterval.end > segment.sourceInterval.start + 1e-8
    )
      throw new Error("REVIEW_PLAYBACK_SEGMENT_OVERLAP");
    for (const id of segment.regionIds)
      if (!regionIds.has(id))
        throw new Error("REVIEW_PLAYBACK_REGION_MISMATCH");
  }
}

export interface C60113PlaybackInterval {
  start: number;
  end: number;
}
export function c60113IntervalUnion(
  values: C60113PlaybackInterval[],
): C60113PlaybackInterval[] {
  const result: C60113PlaybackInterval[] = [];
  for (const current of [...values].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (
      !Number.isFinite(current.start) ||
      !Number.isFinite(current.end) ||
      current.start < 0 ||
      current.end <= current.start
    )
      throw new Error("INVALID_PLAYBACK_INTERVAL");
    const previous = result.at(-1);
    if (previous && current.start <= previous.end + 1e-9)
      previous.end = Math.max(previous.end, current.end);
    else result.push({ ...current });
  }
  return result;
}
export function c60113UnplayedIntervals(
  source: C60113PlaybackInterval,
  played: C60113PlaybackInterval[],
): C60113PlaybackInterval[] {
  let cursor = source.start;
  const result: C60113PlaybackInterval[] = [];
  for (const p of c60113IntervalUnion(played)) {
    if (p.end <= cursor || p.start >= source.end) continue;
    if (p.start > cursor)
      result.push({ start: cursor, end: Math.min(p.start, source.end) });
    cursor = Math.max(cursor, p.end);
  }
  if (cursor < source.end) result.push({ start: cursor, end: source.end });
  return result;
}

/** Character-level LCS operations; deliberately never merges candidate text. */
export function c60113TextDiff(
  current: string,
  candidate: string,
): { kind: "same" | "removed" | "added"; text: string }[] {
  const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
  const a = Array.from(segmenter.segment(current), (v) => v.segment),
    b = Array.from(segmenter.segment(candidate), (v) => v.segment);
  if (a.length * b.length > 250_000)
    return [
      { kind: "removed", text: current },
      { kind: "added", text: candidate },
    ];
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  const at = (i: number, j: number) => table[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = table[i];
    if (!row) throw new Error("DIFF_TABLE_ROW_MISSING");
    for (let j = b.length - 1; j >= 0; j--)
      row[j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
  }
  const result: { kind: "same" | "removed" | "added"; text: string }[] = [];
  let i = 0,
    j = 0;
  const add = (kind: "same" | "removed" | "added", text: string) => {
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text;
    else result.push({ kind, text });
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      add("same", a[i++] ?? "");
      j++;
    } else if (j < b.length && (i === a.length || at(i, j + 1) > at(i + 1, j)))
      add("added", b[j++] ?? "");
    else add("removed", a[i++] ?? "");
  }
  return result;
}
