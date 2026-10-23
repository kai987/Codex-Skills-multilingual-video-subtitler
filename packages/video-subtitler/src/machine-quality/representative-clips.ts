import { z } from "zod";
import { objectHash } from "./experimental-profile.js";

export const REPRESENTATIVE_POLICY = {
  version: "c60117-representative-v1",
  seed: "c60117-independent-strata-v1",
  minSeconds: 20,
  maxSeconds: 28,
  gapSeconds: 1,
  countPerStratum: 4,
  attemptsLimit: 36,
  retriesLimit: 4,
  inputSecondsLimit: 1080,
  individualInputLimit: 30,
  ranking: [
    "no new content-loss or low-risk regression",
    "D micro normalized CER",
    "fewest changed operations",
  ],
  maximumRecoveryConfigs: 2,
} as const;
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((v) => v.end > v.start);
export const representativeClipSchema = z
  .object({
    id: z.string().regex(/^clip-[a-f0-9]{12}$/),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    stratum: z.enum(["coverage", "machine-risk", "low-risk"]),
    partition: z.enum(["D", "C"]),
    machineRisk: z.number().nonnegative(),
    riskReasons: z.array(z.string()),
    sourceIds: z.array(z.string()).min(1),
    boundaryMethod: z.enum([
      "raw-segment-gap-midpoints",
      "user-selected-physical-clip",
    ]),
  })
  .strict()
  .refine((v) => v.end - v.start >= 20 && v.end - v.start <= 28.00001);
export type RepresentativeClip = z.infer<typeof representativeClipSchema>;
export function singlePhysicalClip(
  sourceHash: string,
  start: number,
  end: number,
): RepresentativeClip {
  return representativeClipSchema.parse({
    id: "clip-" + objectHash({ sourceHash, start, end }).slice(0, 12),
    start,
    end,
    stratum: "coverage",
    partition: "D",
    machineRisk: 0,
    riskReasons: [],
    sourceIds: ["user-selected-physical-clip"],
    boundaryMethod: "user-selected-physical-clip",
  });
}
export function lexicalRisk(text: string, seconds: number): string[] {
  const t = text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
  return [
    ...(/(.{2,8})\1/u.test(t) ? ["machine-repetition"] : []),
    ...(seconds > 9 || seconds < 0.35 ? ["abnormal-segment-duration"] : []),
    ...(Array.from(t).length / seconds > 14 ? ["high-character-rate"] : []),
  ];
}
export function selectRepresentativeClips(
  segments: readonly { id: string; start: number; end: number; text: string }[],
  duration: number,
  exclusions: readonly { start: number; end: number }[],
) {
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error("Invalid source duration");
  exclusions.forEach((v) => interval.parse(v));
  const ss = [...segments].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
  ss.forEach((s) => {
    interval.parse({ start: s.start, end: s.end });
    if (s.end > duration) throw Error("Segment outside source");
  });
  // Touching raw segment edges are admissible too; these are machine boundaries,
  // not a claim of acoustic silence. Independent reference prep flags truncation.
  const cuts = [
    ...new Set([
      0,
      ...ss.slice(1).flatMap((s, i) => {
        const previous = ss[i];
        return previous && s.start >= previous.end
          ? [(s.start + previous.end) / 2]
          : [];
      }),
      duration,
    ]),
  ];
  const candidates: Omit<RepresentativeClip, "stratum" | "partition">[] = [];
  for (const start of cuts)
    for (const end of cuts) {
      if (
        end - start < 20 ||
        end - start > 28 ||
        exclusions.some((x) => start < x.end && end > x.start)
      )
        continue;
      const included = ss.filter((s) => s.start < end && s.end > start);
      if (!included.length) continue;
      const reasons = included.flatMap((s) =>
        lexicalRisk(s.text, s.end - s.start),
      );
      if (
        included.some((s, i) => {
          const previous = included[i - 1];
          return previous && s.start < previous.end;
        })
      )
        reasons.push("overlapping-primary-segments");
      candidates.push({
        id:
          "clip-" +
          objectHash({ seed: REPRESENTATIVE_POLICY.seed, start, end }).slice(
            0,
            12,
          ),
        start,
        end,
        machineRisk: reasons.length,
        riskReasons: [...new Set(reasons)],
        sourceIds: included.map((s) => s.id),
        boundaryMethod: "raw-segment-gap-midpoints",
      });
    }
  const ranked = [...candidates].sort((a, b) =>
    objectHash({ seed: REPRESENTATIVE_POLICY.seed, id: a.id }).localeCompare(
      objectHash({ seed: REPRESENTATIVE_POLICY.seed, id: b.id }),
    ),
  );
  const selected: RepresentativeClip[] = [];
  const available = (v: (typeof candidates)[number]) =>
    !selected.some((s) => v.start < s.end + 1 && v.end > s.start - 1);
  const add = (
    v: (typeof candidates)[number] | undefined,
    stratum: RepresentativeClip["stratum"],
  ) => {
    if (v) selected.push({ ...v, stratum, partition: "D" });
  };
  for (let q = 0; q < 4; q++)
    add(
      ranked.find(
        (v) =>
          available(v) &&
          (v.start + v.end) / 2 >= (q * duration) / 4 &&
          (v.start + v.end) / 2 < ((q + 1) * duration) / 4,
      ),
      "coverage",
    );
  for (let i = 0; i < 4; i++)
    add(
      [...ranked]
        .filter((v) => v.machineRisk > 0 && available(v))
        .sort((a, b) => b.machineRisk - a.machineRisk)[0],
      "machine-risk",
    );
  for (let i = 0; i < 4; i++)
    add(
      ranked.find((v) => v.machineRisk === 0 && available(v)),
      "low-risk",
    );
  for (const stratum of ["coverage", "machine-risk", "low-risk"] as const) {
    const rows = selected
      .filter((v) => v.stratum === stratum)
      .sort((a, b) => a.id.localeCompare(b.id));
    rows.forEach((v, i) => (v.partition = i % 2 === 0 ? "D" : "C"));
  }
  return {
    clips: selected.map((v) => representativeClipSchema.parse(v)),
    candidates,
    replacementOrder: ranked.map((v) => v.id),
    exclusions,
    policy: REPRESENTATIVE_POLICY,
  };
}
export function reserveAttempt(
  prior: readonly { inputSeconds: number; retry: boolean }[],
  inputSeconds: number,
  retry = false,
) {
  if (
    !Number.isFinite(inputSeconds) ||
    inputSeconds <= 0 ||
    inputSeconds > 30 ||
    prior.length >= 36 ||
    prior.reduce((n, r) => n + r.inputSeconds, 0) + inputSeconds > 1080 ||
    (retry && prior.filter((r) => r.retry).length >= 4)
  )
    throw Error("ASR budget exhausted or invalid request");
  return { inputSeconds, retry };
}
