/** Machine-only diagnostic selector. Probability is not calibrated correctness. */
import assert from "node:assert/strict";
import {
  closeDialogueTarget,
  dialogueText,
} from "./whole-dialogue-recovery.mjs";

export const lexicalRiskPolicy = Object.freeze({
  version: "token-probability-local-comparison-v1",
  lowProbability: 0.6,
  maxTargetsPerSource: 1,
  maxTargets: 3,
  contextSeconds: 1,
  maxWindowSeconds: 15,
  maxRequests: 6,
  maxRequestAudioSeconds: 90,
  retries: 0,
  defaultPromotion: false,
});

export function tokenRisk(tokens) {
  assert(Array.isArray(tokens) && tokens.length, "MISSING_TOKEN_EVIDENCE");
  const lexical = tokens.filter((t) => {
    assert(
      typeof t.text === "string" && Number.isInteger(t.id),
      "INVALID_TOKEN",
    );
    return t.id < 50257 && /[\p{L}\p{N}]/u.test(t.text);
  });
  assert(lexical.length, "MISSING_LEXICAL_TOKENS");
  for (const t of lexical)
    assert(
      Number.isFinite(t.p) && t.p >= 0 && t.p <= 1,
      "INVALID_TOKEN_PROBABILITY",
    );
  return {
    minProbability: Math.min(...lexical.map((t) => t.p)),
    lowTokens: lexical
      .filter((t) => t.p < lexicalRiskPolicy.lowProbability)
      .map(({ text, p }) => ({ text, p })),
    lexicalTokenCount: lexical.length,
  };
}

/** Match by exact request-local segment envelope and text, never by substring. */
export function associateTokenEvidence(row, transcription) {
  assert(Array.isArray(transcription), "MISSING_TRANSCRIPTION");
  const matches = transcription.filter(
    (s) =>
      Number.isFinite(s.offsets?.from) &&
      Number.isFinite(s.offsets?.to) &&
      Math.abs(s.offsets.from / 1000 - row.localStart) < 0.0001 &&
      Math.abs(s.offsets.to / 1000 - row.localEnd) < 0.0001 &&
      typeof s.text === "string" &&
      s.text.trim() === row.text.trim(),
  );
  assert.equal(matches.length, 1, "AMBIGUOUS_OR_MISSING_SEGMENT_BINDING");
  return tokenRisk(matches[0].tokens);
}

export function selectLexicalRisks(records, risks, duration) {
  assert(Number.isFinite(duration) && duration > 0, "INVALID_DURATION");
  assert(
    records.length && records.length === risks.length,
    "EVIDENCE_COUNT_MISMATCH",
  );
  assert(
    new Set(records.map((r) => r.id)).size === records.length,
    "DUPLICATE_RECORD_ID",
  );
  for (const r of records)
    assert(
      typeof r.id === "string" &&
        Number.isFinite(r.start) &&
        Number.isFinite(r.end) &&
        r.start >= 0 &&
        r.end > r.start &&
        r.end <= duration + 0.001 &&
        typeof r.text === "string" &&
        dialogueText(r.text),
      "INVALID_BASELINE",
    );
  const ranked = records
    .map((r, i) => {
      const risk = risks[i];
      assert(
        Number.isFinite(risk.minProbability) &&
          risk.minProbability >= 0 &&
          risk.minProbability <= 1,
        "INVALID_RISK",
      );
      const closed = closeDialogueTarget(records, {
        id: `risk-${r.id}`,
        start: r.start,
        end: r.end,
      });
      const start = Math.max(
        0,
        closed.start - lexicalRiskPolicy.contextSeconds,
      );
      const end = Math.min(
        duration,
        closed.end + lexicalRiskPolicy.contextSeconds,
      );
      return {
        recordId: r.id,
        text: r.text,
        ...risk,
        target: closed,
        window: { start, end },
        status:
          risk.minProbability >= lexicalRiskPolicy.lowProbability
            ? "below-risk-threshold"
            : /[♪♫]/u.test(r.text) || r.style === "music"
              ? "separate-music-route"
              : end - start > lexicalRiskPolicy.maxWindowSeconds
                ? "deferred-window-limit"
                : "eligible",
      };
    })
    .sort(
      (a, b) =>
        a.minProbability - b.minProbability ||
        a.target.start - b.target.start ||
        a.recordId.localeCompare(b.recordId),
    );
  let selected = 0;
  for (const r of ranked)
    if (r.status === "eligible")
      r.status =
        selected++ < lexicalRiskPolicy.maxTargetsPerSource
          ? "selected"
          : "deferred-target-limit";
  return {
    policy: lexicalRiskPolicy,
    ranked,
    selected: ranked.filter((r) => r.status === "selected"),
    referenceUsed: false,
  };
}
