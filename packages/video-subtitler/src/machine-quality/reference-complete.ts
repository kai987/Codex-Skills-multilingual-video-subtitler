/** Evaluation preparation only. Never imported into the frozen generator. */
import { z } from "zod";
import { objectHash } from "./experimental-profile.js";
import { qualityText, type QualityCue } from "./experimental-metrics.js";

export const COMPLETE_POLICY = Object.freeze({
  version: "c601171-reference-complete-v1",
  marginSeconds: 0.1,
  maxSeconds: 30,
  targetPerStratum: 2,
  minimumUnits: 4,
  minimumNormalizedN: 200,
  attempts: 18,
  retries: 2,
  inputSeconds: 600,
  selection:
    "old ranked machine windows; center anchor; nearest component; expand nearest neighbor within seed window while <=30s; stable tie left",
});
export const strata = ["coverage", "machine-risk", "low-risk"] as const;
export type Stratum = (typeof strata)[number];
export interface Component {
  id: string;
  start: number;
  end: number;
  cues: QualityCue[];
}
export interface Seed {
  id: string;
  start: number;
  end: number;
  machineRisk: number;
  stratum?: Stratum;
}
export interface Unit {
  id: string;
  partition: "D1" | "C1";
  stratum: Stratum;
  labels: Stratum[];
  seed: Seed;
  start: number;
  end: number;
  startSample: number;
  endSample: number;
  componentIds: string[];
  reference: QualityCue[];
  normalizedN: number;
  scope: "SCOPE_REBUILT";
  referenceExposure: string;
}
export const overlaps = (
  a: { start: number; end: number },
  b: { start: number; end: number },
) => a.start < b.end && b.start < a.end;
// Only roundoff within 1e-7 native sample is snapped; a true fractional sample
// is enclosed outwards. This is not a millisecond boundary tolerance.
export function sampleEdge(seconds: number, rate: number, end = false) {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    !Number.isInteger(rate) ||
    rate <= 0
  )
    throw Error("Invalid source sample coordinate");
  const n = seconds * rate,
    nearest = Math.round(n);
  return Math.abs(n - nearest) < 1e-7
    ? nearest
    : end
      ? Math.ceil(n)
      : Math.floor(n);
}
export function components(
  reference: readonly QualityCue[],
  rate: number,
  duration: number,
): Component[] {
  const ids = new Set<string>();
  const rows = reference
    .map((c) => {
      if (
        ids.has(c.id) ||
        !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) ||
        c.start < 0 ||
        c.end <= c.start ||
        c.end > duration
      )
        throw Error("INVALID_REFERENCE_INTERVAL");
      ids.add(c.id);
      return {
        ...c,
        start: sampleEdge(c.start, rate) / rate,
        end: sampleEdge(c.end, rate, true) / rate,
      };
    })
    .sort(
      (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
    );
  const out: Component[] = [];
  for (const c of rows) {
    const last = out.at(-1);
    if (
      last &&
      sampleEdge(c.start, rate) - sampleEdge(last.end, rate, true) <=
        Math.ceil(2 * COMPLETE_POLICY.marginSeconds * rate)
    ) {
      last.cues.push(c);
      last.end = Math.max(last.end, c.end);
    } else out.push({ id: "", start: c.start, end: c.end, cues: [c] });
  }
  for (const c of out)
    c.id = "component-" + objectHash(c.cues.map((r) => r.id)).slice(0, 16);
  return out;
}
export function closure(
  clip: { start: number; end: number },
  reference: readonly QualityCue[],
) {
  const included = reference.filter((r) => overlaps(clip, r));
  return {
    included,
    crossing: included.filter((r) => r.start < clip.start || r.end > clip.end),
    complete:
      included.length > 0 &&
      included.every((r) => r.start >= clip.start && r.end <= clip.end),
  };
}
export function prepareUnits(input: {
  reference: QualityCue[];
  rate: number;
  duration: number;
  old: Seed[];
  candidates: Seed[];
  replacementOrder: string[];
  exclusions: { start: number; end: number }[];
}) {
  const { rate, duration } = input;
  const groups = components(input.reference, rate, duration),
    selected: Unit[] = [],
    ledger: Record<string, unknown>[] = [];
  // Shared source-native/16k grid prevents resampling changing the physical scope.
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const grid = rate / gcd(rate, 16000),
    margin = Math.ceil(0.1 * rate);
  const bounds = (a: number, b: number) => ({
    startSample: Math.max(
      0,
      Math.floor((sampleEdge(a, rate) - margin) / grid) * grid,
    ),
    endSample: Math.min(
      Math.floor((duration * rate) / grid) * grid,
      Math.ceil((sampleEdge(b, rate, true) + margin) / grid) * grid,
    ),
  });
  const ranked = input.replacementOrder
    .map((id) => input.candidates.find((c) => c.id === id))
    .filter((x): x is Seed => !!x);
  for (const partition of ["D1", "C1"] as const)
    for (const stratum of strata) {
      const pool =
        partition === "D1"
          ? input.old.filter((s) => s.stratum === stratum)
          : ranked.filter(
              (s) =>
                !input.old.some((o) => overlaps(o, s)) &&
                (stratum === "coverage" ||
                  (stratum === "machine-risk"
                    ? s.machineRisk > 0
                    : s.machineRisk === 0)),
            );
      if (stratum === "machine-risk")
        pool.sort((a, b) => b.machineRisk - a.machineRisk);
      for (const seed of pool) {
        const anchor = (seed.start + seed.end) / 2;
        const center = groups
          .map((g, i) => ({
            i,
            d:
              anchor < g.start
                ? g.start - anchor
                : anchor > g.end
                  ? anchor - g.end
                  : 0,
          }))
          .sort((a, b) => a.d - b.d || a.i - b.i)[0];
        if (!center) continue;
        let left = center.i,
          right = left;
        const group = (i: number) => {
          const value = groups[i];
          if (!value) throw Error("Missing reference component");
          return value;
        };
        const span = () => bounds(group(left).start, group(right).end);
        let bb = span();
        let reason = "";
        if ((bb.endSample - bb.startSample) / rate > 30)
          reason = "OVERSIZE_REFERENCE_COMPONENT";
        if (!reason) {
          for (;;) {
            const options = [left - 1, right + 1]
              .filter(
                (i) => i >= 0 && i < groups.length && overlaps(group(i), seed),
              )
              .sort(
                (a, b) =>
                  Math.abs((group(a).start + group(a).end) / 2 - anchor) -
                    Math.abs((group(b).start + group(b).end) / 2 - anchor) ||
                  a - b,
              );
            const next = options.find((i) => {
              const b = bounds(
                group(Math.min(i, left)).start,
                group(Math.max(i, right)).end,
              );
              return (b.endSample - b.startSample) / rate <= 30;
            });
            if (next === undefined) break;
            left = Math.min(left, next);
            right = Math.max(right, next);
          }
          bb = span();
        }
        const physical = {
          start: bb.startSample / rate,
          end: bb.endSample / rate,
        };
        const closed = closure(physical, input.reference),
          componentIds = groups.slice(left, right + 1).map((g) => g.id);
        if (!reason && !closed.complete) reason = "REFERENCE_CLOSURE_FAILED";
        if (!reason && input.exclusions.some((e) => overlaps(e, physical)))
          reason = "OLD_TAIL_EXCLUSION";
        if (
          !reason &&
          partition === "C1" &&
          input.old.some((o) => overlaps(o, physical))
        )
          reason = "OLD_EVALUATED_AUDIO_EXPOSURE";
        if (
          !reason &&
          selected.some(
            (s) =>
              overlaps(s, physical) ||
              s.componentIds.some((id) => componentIds.includes(id)),
          )
        )
          reason = "DUPLICATE_COMPONENT_OR_AUDIO";
        const normalizedN = Array.from(
          qualityText(closed.included.map((r) => r.text).join("")),
        ).length;
        if (!reason && normalizedN === 0)
          reason = "EMPTY_REFERENCE_NEGATIVE_CONTROL_ONLY";
        const filled =
          selected.filter(
            (s) => s.partition === partition && s.stratum === stratum,
          ).length >= 2;
        ledger.push({
          partition,
          stratum,
          seedId: seed.id,
          machineSeed: anchor,
          oldWindow: { start: seed.start, end: seed.end },
          ...physical,
          componentIds,
          closureComplete: closed.complete,
          normalizedN,
          reason: reason || (filled ? "QUOTA_FILLED" : "SELECTED"),
        });
        if (reason || filled) continue;
        selected.push({
          id:
            "unit-" + objectHash({ physical, source: "source-1" }).slice(0, 12),
          partition,
          stratum,
          labels: [
            "coverage",
            seed.machineRisk > 0 ? "machine-risk" : "low-risk",
          ],
          seed,
          ...physical,
          ...bb,
          componentIds,
          reference: closed.included,
          normalizedN,
          scope: "SCOPE_REBUILT",
          referenceExposure:
            partition === "D1"
              ? "KNOWN_OLD_D_AND_C_REMEASUREMENT"
              : "SAME_EPISODE_FIXED_POLICY_CHECK_FULL_REFERENCE_EXPOSED",
        });
      }
    }
  return { groups, units: selected, ledger };
}
export function dataGate(units: readonly Unit[], audioValid: boolean) {
  const issues: string[] = [];
  const partitions = Object.fromEntries(
    (["D1", "C1"] as const).map((p) => {
      const rows = units.filter((u) => u.partition === p),
        N = rows.reduce((n, u) => n + u.normalizedN, 0),
        counts = Object.fromEntries(
          strata.map((s) => [s, rows.filter((r) => r.stratum === s).length]),
        );
      if (
        rows.length < 4 ||
        rows.length > 6 ||
        N < 200 ||
        strata.some((s) => !counts[s])
      )
        issues.push(p + "_INSUFFICIENT_UNITS_DENOMINATOR_OR_STRATA");
      return [
        p,
        {
          units: rows.length,
          normalizedN: N,
          strata: counts,
          seconds: rows.reduce((n, u) => n + u.end - u.start, 0),
        },
      ];
    }),
  );
  for (const [i, u] of units.entries()) {
    if (
      !closure(u, u.reference).complete ||
      u.end - u.start > 30 ||
      u.end <= u.start
    )
      issues.push("INVALID_UNIT");
    if (
      units
        .slice(i + 1)
        .some(
          (v) =>
            overlaps(u, v) ||
            u.componentIds.some((id) => v.componentIds.includes(id)),
        )
    )
      issues.push("PARTITION_OR_UNIT_LEAKAGE");
  }
  if (!audioValid) issues.push("AUDIO_MAPPING_INVALID");
  if (units.length > 12 || units.length * 30 > 600)
    issues.push("BUDGET_EXCEEDED");
  return {
    status: issues.length
      ? "DATA_PREFLIGHT_FAILED"
      : "DATA_READY_FOR_FROZEN_REPAIR_CHECK",
    issues,
    partitions,
    H1: "HELDOUT_VALIDATION_NOT_RUN",
  };
}
export function reserveCompleteAttempt(
  prior: readonly { inputSeconds: number; retry: boolean }[],
  seconds: number,
  retry = false,
  failed = false,
) {
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 30 ||
    prior.length >= 18 ||
    prior.reduce((n, r) => n + r.inputSeconds, 0) + seconds > 600 ||
    (retry && (!failed || prior.filter((r) => r.retry).length >= 2))
  )
    throw Error("BUDGET_OR_RETRY_POLICY");
  return { inputSeconds: seconds, retry };
}
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const generationManifestSchema = z
  .object({
    version: z.literal("c601171-generation-v1"),
    frozenRepairHash: sha,
    units: z
      .array(
        z
          .object({
            id: z.string().regex(/^unit-[a-f0-9]{12}$/),
            audio: z.string().regex(/^audio\/unit-[a-f0-9]{12}\.wav$/),
            audioHash: sha,
            sampleRate: z.literal(16000),
            sampleCount: z.number().int().positive(),
            seconds: z.number().positive().max(30),
            sourceOffset: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
