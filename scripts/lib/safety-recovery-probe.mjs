/** Machine-only risk selection. Probes are evidence, never automatic repairs. */
import { contentSafety } from "./content-safety-gate.mjs";

export const safetyProbePolicy = Object.freeze({
  version: "safety-recovery-probe-v1",
  codes: [
    "EMBEDDED_KANA_DECODER_RUN",
    "OVERLAPPING_TEXT_CONTAINMENT_REQUIRES_AUDIO",
    "SPARSE_LONG_DIALOGUE_REQUIRES_AUDIO",
  ],
  contextSeconds: [2, 5],
  maxTargets: 3,
  maxRequests: 6,
  maxAudioSeconds: 120,
  maxWindowSeconds: 30,
  retries: 0,
  selection:
    "one per risk class; overlapping issues unioned; most lexical characters first; source-time tie-break",
});
export function planSafetyProbes(records, sourceEnd) {
  if (
    !Number.isFinite(sourceEnd) ||
    sourceEnd <= 0 ||
    records.some(
      (r) =>
        !Number.isFinite(r.start) ||
        !Number.isFinite(r.end) ||
        r.start < 0 ||
        r.end <= r.start ||
        r.end > sourceEnd,
    )
  )
    throw Error("INVALID_SOURCE_TIMING");
  const audit = contentSafety(records, { language: "ja" });
  const excluded = new Set(
    audit.issues
      .filter((i) =>
        [
          "TEMPLATE_PHRASE_REQUIRES_AUDIO",
          "SINGLE_CHARACTER_DECODER_LOOP",
          "SHORT_TOKEN_DECODER_LOOP",
          "RECURRING_FOREIGN_SHORT_TOKEN",
        ].includes(i.code),
      )
      .flatMap((i) => i.cueIndexes),
  );
  const targets = [],
    requests = [];
  let seconds = 0;
  for (const code of safetyProbePolicy.codes) {
    const groups = [];
    for (const issue of audit.issues
      .filter((i) => i.code === code)
      .sort((a, b) => a.start - b.start)) {
      const previous = groups.at(-1);
      if (previous && issue.start <= previous.end) {
        previous.end = Math.max(previous.end, issue.end);
        previous.cueIndexes = [
          ...new Set([...previous.cueIndexes, ...issue.cueIndexes]),
        ];
      } else
        groups.push({
          start: issue.start,
          end: issue.end,
          cueIndexes: [...issue.cueIndexes],
        });
    }
    const size = (g) =>
      Math.max(
        ...g.cueIndexes.map(
          (i) => [...records[i].text.replace(/[\s\p{P}\p{S}]/gu, "")].length,
        ),
      );
    groups.sort((a, b) => size(b) - size(a) || a.start - b.start);
    for (const group of groups) {
      if (group.cueIndexes.some((i) => excluded.has(i))) continue;
      if (targets.some((t) => t.start < group.end && t.end > group.start))
        continue;
      const id = `target-${targets.length + 1}`;
      const windows = safetyProbePolicy.contextSeconds.map((context) => ({
        id: `${id}-context-${context}`,
        targetId: id,
        context,
        start: Math.max(0, group.start - context),
        end: Math.min(sourceEnd, group.end + context),
      }));
      const duration = windows.reduce((n, w) => n + w.end - w.start, 0);
      if (
        windows.some(
          (w) => w.end - w.start > safetyProbePolicy.maxWindowSeconds,
        ) ||
        seconds + duration > safetyProbePolicy.maxAudioSeconds
      )
        continue;
      targets.push({ id, code, ...group });
      requests.push(...windows);
      seconds += duration;
      break;
    }
  }
  return {
    policy: safetyProbePolicy,
    targets,
    requests,
    reservedAudioSeconds: Math.round(seconds * 1000) / 1000,
    automaticMutations: 0,
    prompt: null,
    referenceInput: null,
    qualityStatus: "needs-review",
  };
}
