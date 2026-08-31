import { c612Defined } from "./c612-policy.js";
import { c61Graphemes } from "../japanese-text-representation.js";
export const chars = c61Graphemes;
export function textStructure(current: string, candidate: string) {
  const a = chars(current),
    b = chars(candidate);
  const matrix = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      c612Defined(matrix[i])[j] =
        a[i] === b[j]
          ? c612Defined(c612Defined(matrix[i + 1])[j + 1]) + 1
          : Math.max(
              c612Defined(c612Defined(matrix[i + 1])[j]),
              c612Defined(c612Defined(matrix[i])[j + 1]),
            );
  const retained: number[] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      retained.push(i++);
      j++;
    } else if (
      c612Defined(c612Defined(matrix[i + 1])[j]) >=
      c612Defined(c612Defined(matrix[i])[j + 1])
    )
      i++;
    else j++;
  }
  const deleted: {
    start: number;
    end: number;
  }[] = [];
  for (let k = 0; k < a.length; k++)
    if (!retained.includes(k)) {
      if (deleted.at(-1)?.end === k) c612Defined(deleted.at(-1)).end++;
      else deleted.push({ start: k, end: k + 1 });
    }
  let prefix = 0,
    suffix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix])
    prefix++;
  while (
    suffix < Math.min(a.length, b.length) &&
    a[a.length - suffix - 1] === b[b.length - suffix - 1]
  )
    suffix++;
  const length = Math.max(1, a.length),
    lcs = retained.length;
  return {
    lengthRatio: b.length / length,
    lcsRatio: lcs / length,
    prefixRetention: prefix / length,
    suffixRetention: suffix / length,
    insertionRatio: (b.length - lcs) / Math.max(1, b.length),
    deletionRatio: (a.length - lcs) / length,
    leadingDeletionLength: deleted[0]?.start === 0 ? deleted[0].end : 0,
    trailingDeletionLength:
      deleted.at(-1)?.end === a.length
        ? a.length - c612Defined(deleted.at(-1)).start
        : 0,
    internalDeletionSpans: deleted.filter(
      (d) => d.start > 0 && d.end < a.length,
    ),
    deleted,
    retained,
  };
}
export function editDistance(a: string, b: string) {
  const left = chars(a),
    right = chars(b);
  let row = right.map((_, i) => i).concat(right.length);
  for (const c of left) {
    const next = [c612Defined(row[0]) + 1];
    for (let j = 1; j <= right.length; j++)
      next[j] = Math.min(
        c612Defined(row[j]) + 1,
        c612Defined(next[j - 1]) + 1,
        c612Defined(row[j - 1]) + Number(c !== right[j - 1]),
      );
    row = next;
  }
  return c612Defined(row.at(-1));
}
export interface Interval {
  start: number;
  end: number;
}
export const overlap = (a: Interval, b: Interval) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
export function unionIntervals(input: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const x of input
    .filter((x) => x.end > x.start)
    .toSorted((a, b) => a.start - b.start || a.end - b.end)) {
    const last = result.at(-1);
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else result.push({ ...x });
  }
  return result;
}
export const duration = (input: readonly Interval[]) =>
  unionIntervals(input).reduce((n, x) => n + x.end - x.start, 0);
export const intersect = (input: readonly Interval[], bounds: Interval) =>
  unionIntervals(
    input.map((x) => ({
      start: Math.max(x.start, bounds.start),
      end: Math.min(x.end, bounds.end),
    })),
  );
export function connectedComponents<T>(
  items: readonly T[],
  related: (a: T, b: T) => boolean,
): T[][] {
  const parents = items.map((_, i) => i);
  const root = (i: number): number => {
    while (parents[i] !== i) i = c612Defined(parents[i]);
    return i;
  };
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (related(c612Defined(items[i]), c612Defined(items[j])))
        parents[root(j)] = root(i);
  const groups = new Map<number, T[]>();
  items.forEach((x, i) =>
    groups.set(root(i), [...(groups.get(root(i)) ?? []), x]),
  );
  return [...groups.values()];
}
