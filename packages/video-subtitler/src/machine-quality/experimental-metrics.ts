function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required evidence/index absent");
  return value;
}
/** C6.0.1.16: evaluation only; never imported by the generation entry point. */
export interface QualityCue {
  id: string;
  text: string;
  start: number;
  end: number;
}
export const QUALITY_EVALUATION_POLICY = Object.freeze({
  version: "c60116-character-alignment-v1",
  primaryMetric: "normalizedCER",
  scope: "all-reference-cues-including-lyrics",
  normalization:
    "NFKC; remove Unicode punctuation/separators/whitespace; lowercase",
  exact: "NFC; remove display line breaks only",
  timingMatching:
    "text-only global character edit path, equal-character cue components",
  minimumEqualCharacterRatioForTiming: 0.5,
  severeBoundarySeconds: 2,
  assToleranceSeconds: 0.011,
});
export function qualityText(text: string, normalize = true): string {
  return normalize
    ? text
        .normalize("NFKC")
        .replace(/[\p{P}\p{Z}\s]/gu, "")
        .toLowerCase()
    : text.normalize("NFC").replace(/\r?\n/gu, "");
}
/** Reference -> hypothesis operations. No time coordinates influence alignment. */
export function characterAlignment(reference: string, hypothesis: string) {
  const r = Array.from(reference),
    h = Array.from(hypothesis);
  const width = h.length + 1;
  if ((r.length + 1) * width > 100000000)
    throw new Error("Evaluation matrix exceeds bounded capacity");
  const back = new Uint8Array((r.length + 1) * width);
  let previous = Uint32Array.from({ length: width }, (_, i) => i);
  for (let j = 1; j < width; j++) back[j] = 3;
  for (let i = 1; i <= r.length; i++) {
    const current = new Uint32Array(width);
    current[0] = i;
    back[i * width] = 2;
    for (let j = 1; j < width; j++) {
      const equal = r[i - 1] === h[j - 1];
      const diagonal = requireValue(previous[j - 1]) + (equal ? 0 : 1);
      const deletion = requireValue(previous[j]) + 1,
        insertion = requireValue(current[j - 1]) + 1;
      const best = Math.min(diagonal, deletion, insertion);
      current[j] = best;
      back[i * width + j] =
        best === diagonal ? (equal ? 0 : 1) : best === deletion ? 2 : 3;
    }
    previous = current;
  }
  const path: {
    op: "equal" | "substitute" | "delete" | "insert";
    r: number | null;
    h: number | null;
  }[] = [];
  let i = r.length,
    j = h.length;
  let S = 0,
    D = 0,
    I = 0;
  while (i || j) {
    const op = back[i * width + j];
    if (op === 0 || op === 1) {
      path.push({ op: op === 0 ? "equal" : "substitute", r: --i, h: --j });
      if (op === 1) S++;
    } else if (op === 2) {
      path.push({ op: "delete", r: --i, h: null });
      D++;
    } else {
      path.push({ op: "insert", r: null, h: --j });
      I++;
    }
  }
  return {
    S,
    D,
    I,
    N: r.length,
    CER: r.length ? (S + D + I) / r.length : null,
    emptyReference: r.length === 0,
    path: path.reverse(),
  };
}
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const p95 = (xs: number[]) =>
  xs.length
    ? requireValue(
        xs.toSorted((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1],
      )
    : null;
const envelope = (cues: QualityCue[]) => ({
  start: Math.min(...cues.map((c) => c.start)),
  end: Math.max(...cues.map((c) => c.end)),
});
export function evaluateQuality(
  hypothesis: QualityCue[],
  reference: QualityCue[],
) {
  const chars = (cs: QualityCue[]) =>
    cs.flatMap((c, index) =>
      Array.from(qualityText(c.text)).map((text) => ({ text, index })),
    );
  const r = chars(reference),
    h = chars(hypothesis);
  const normalized = characterAlignment(
    r.map((c) => c.text).join(""),
    h.map((c) => c.text).join(""),
  );
  const exact = characterAlignment(
    reference.map((c) => qualityText(c.text, false)).join(""),
    hypothesis.map((c) => qualityText(c.text, false)).join(""),
  );
  const links = new Map<
    string,
    {
      r: number;
      h: number;
      equal: number;
    }
  >();
  for (const step of normalized.path)
    if (step.op === "equal" && step.r !== null && step.h !== null) {
      const ri = requireValue(r[step.r]).index,
        hi = requireValue(h[step.h]).index,
        key = `${ri}:${hi}`;
      const prior = links.get(key);
      links.set(key, { r: ri, h: hi, equal: (prior?.equal ?? 0) + 1 });
    }
  const parent = Array.from(
    { length: reference.length + hypothesis.length },
    (_, i) => i,
  );
  const root = (n: number): number =>
    parent[n] === n ? n : (parent[n] = root(requireValue(parent[n])));
  for (const link of links.values())
    parent[root(link.r)] = root(reference.length + link.h);
  const groups = new Map<
    number,
    {
      referenceIndexes: number[];
      hypothesisIndexes: number[];
    }
  >();
  for (let n = 0; n < parent.length; n++) {
    const key = root(n);
    const g = groups.get(key) ?? {
      referenceIndexes: [],
      hypothesisIndexes: [],
    };
    if (n < reference.length) g.referenceIndexes.push(n);
    else g.hypothesisIndexes.push(n - reference.length);
    groups.set(key, g);
  }
  const matches = [...groups.values()].map((g) => {
    const rs = g.referenceIndexes.map((i) => requireValue(reference[i])),
      hs = g.hypothesisIndexes.map((i) => requireValue(hypothesis[i]));
    const equal = [...links.values()]
      .filter(
        (l) =>
          g.referenceIndexes.includes(l.r) && g.hypothesisIndexes.includes(l.h),
      )
      .reduce((n, l) => n + l.equal, 0);
    const rN = rs.reduce(
        (n, c) => n + Array.from(qualityText(c.text)).length,
        0,
      ),
      hN = hs.reduce((n, c) => n + Array.from(qualityText(c.text)).length, 0);
    const eligible =
      rs.length > 0 && hs.length > 0 && equal / Math.max(1, rN, hN) >= 0.5;
    const rb = rs.length ? envelope(rs) : null,
      hb = hs.length ? envelope(hs) : null;
    return {
      ...g,
      referenceIds: rs.map((c) => c.id),
      hypothesisIds: hs.map((c) => c.id),
      equalCharacters: equal,
      timingEligible: eligible,
      startError: eligible
        ? Math.abs(requireValue(hb).start - requireValue(rb).start)
        : null,
      endError: eligible
        ? Math.abs(requireValue(hb).end - requireValue(rb).end)
        : null,
      iou: eligible
        ? Math.max(
            0,
            Math.min(requireValue(hb).end, requireValue(rb).end) -
              Math.max(requireValue(hb).start, requireValue(rb).start),
          ) /
          (Math.max(requireValue(hb).end, requireValue(rb).end) -
            Math.min(requireValue(hb).start, requireValue(rb).start))
        : null,
    };
  });
  const spans = (op: "delete" | "insert") => {
    const result: {
      cueIds: string[];
      text: string;
      characterCount: number;
    }[] = [];
    let active: (typeof result)[number] | null = null;
    for (const step of normalized.path) {
      if (step.op !== op) {
        active = null;
        continue;
      }
      const c =
        op === "delete"
          ? requireValue(r[requireValue(step.r)])
          : requireValue(h[requireValue(step.h)]);
      const id = requireValue(
        (op === "delete" ? reference : hypothesis)[c.index],
      ).id;
      if (active === null) {
        active = { cueIds: [], text: "", characterCount: 0 };
        result.push(active);
      }
      if (!active.cueIds.includes(id)) active.cueIds.push(id);
      active.text += c.text;
      active.characterCount++;
    }
    return result;
  };
  const overlaps: {
    left: string;
    right: string;
    exactText: boolean;
  }[] = [];
  for (let i = 0; i < hypothesis.length; i++)
    for (let j = i + 1; j < hypothesis.length; j++) {
      const a = requireValue(hypothesis[i]),
        b = requireValue(hypothesis[j]);
      if (Math.min(a.end, b.end) > Math.max(a.start, b.start))
        overlaps.push({
          left: a.id,
          right: b.id,
          exactText: qualityText(a.text) === qualityText(b.text),
        });
    }
  const timed = matches.filter((g) => g.timingEligible);
  return {
    policy: QUALITY_EVALUATION_POLICY,
    cueCount: hypothesis.length,
    referenceCueCount: reference.length,
    exact: (({ path: steps, ...x }) => {
      void steps;
      return x;
    })(exact),
    normalized: (({ path: steps, ...x }) => {
      void steps;
      return x;
    })(normalized),
    coverage: {
      referenceCharacterCoverage: normalized.N
        ? (normalized.N - normalized.D) / normalized.N
        : null,
      exactCharacterRecall: normalized.N
        ? (normalized.N - normalized.D - normalized.S) / normalized.N
        : null,
      missingReferenceSpans: spans("delete"),
      referenceUnsupportedInsertions: spans("insert"),
      confirmedHallucination: null,
      semanticVerification: "unverified",
    },
    timing: {
      matchedGroups: timed.length,
      matchedReferenceCues: timed.reduce(
        (n, g) => n + g.referenceIds.length,
        0,
      ),
      totalReferenceCues: reference.length,
      unmatchedReferenceCues:
        reference.length - timed.reduce((n, g) => n + g.referenceIds.length, 0),
      unmatchedHypothesisCues:
        hypothesis.length -
        timed.reduce((n, g) => n + g.hypothesisIds.length, 0),
      startMAE: mean(timed.map((g) => requireValue(g.startError))),
      endMAE: mean(timed.map((g) => requireValue(g.endError))),
      boundaryP95: p95(
        timed.flatMap((g) => [
          requireValue(g.startError),
          requireValue(g.endError),
        ]),
      ),
      meanIoU: mean(timed.map((g) => requireValue(g.iou))),
      severeBoundaryGroups: timed.filter(
        (g) =>
          Math.max(requireValue(g.startError), requireValue(g.endError)) > 2,
      ).length,
    },
    structure: {
      overlaps,
      exactTextOverlapPairs: overlaps.filter((p) => p.exactText).length,
      confirmedErroneousOverlap: null,
      merges: timed.filter(
        (g) => g.referenceIds.length > 1 && g.hypothesisIds.length === 1,
      ).length,
      splits: timed.filter(
        (g) => g.referenceIds.length === 1 && g.hypothesisIds.length > 1,
      ).length,
      chronologicalOrderErrors: hypothesis.filter(
        (c, i) => i > 0 && c.start < requireValue(hypothesis[i - 1]).start,
      ).length,
    },
    matches,
  };
}
