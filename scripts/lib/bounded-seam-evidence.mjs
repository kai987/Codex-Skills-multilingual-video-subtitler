/** Stored-evidence-only seam diagnostics. No I/O, model, reference or mutation. */
export const seamEvidencePolicy = Object.freeze({
  version: "bounded-seam-evidence-v1",
  normalization:
    "none; exact Unicode token text and token IDs are reported separately",
  minimumSharedCharacters: 2,
  shortTextCodepoints: 8,
  maximumTokensPerRecord: 4096,
  maximumReportedRunsPerPair: 64,
  timebase: "source-global",
  action: "diagnostic-only; no substring deletion or timing repair",
  proofBoundary:
    "overlapping token offsets are not proof of one acoustic occurrence",
});
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const id = (value) => typeof value === "string" && value.length > 0;
const hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const span = (start, end) =>
  finite(start) && finite(end) && start >= 0 && end > start;
const intersection = (a, b) => {
  if (!span(a[0], a[1]) || !span(b[0], b[1])) return null;
  const start = Math.max(a[0], b[0]),
    end = Math.min(a[1], b[1]);
  return end > start ? { start, end, seconds: end - start } : null;
};
const unique = (items) => [...new Set(items)];

function tokenizeEvidence(row, record) {
  const blockers = [];
  if (!row)
    return {
      tokens: [],
      blockers: ["TOKEN_EVIDENCE_MISSING"],
      provenance: null,
    };
  if (!row || typeof row !== "object" || !Array.isArray(row.tokens))
    throw new TypeError("SEAM_INVALID_TOKEN_EVIDENCE");
  if (row.tokens.length > seamEvidencePolicy.maximumTokensPerRecord)
    throw new TypeError("SEAM_TOKEN_LIMIT_EXCEEDED");
  if (row.requestId !== record.requestId || row.text !== record.text)
    blockers.push("TOKEN_RECORD_BINDING_MISMATCH");
  if (!row.tokens.length) blockers.push("LEXICAL_TOKEN_EVIDENCE_EMPTY");
  const p = row.provenance;
  if (
    !p ||
    p.validated !== true ||
    p.timebase !== "source-global" ||
    ![p?.sourceHash, p?.modelHash, p?.runtimeHash, p?.rawResponseHash].every(
      hash,
    )
  )
    blockers.push("TOKEN_PROVENANCE_NOT_VALIDATED");
  if (p?.timingVerified !== true)
    blockers.push("HEURISTIC_TOKEN_TIMING_NOT_ACOUSTICALLY_VERIFIED");
  if (!Array.isArray(row.issues) || row.issues.length)
    blockers.push("UPSTREAM_TOKEN_EVIDENCE_ISSUES");
  const tokens = row.tokens.map((token, index) => {
    if (!token || typeof token !== "object" || typeof token.text !== "string")
      throw new TypeError("SEAM_INVALID_TOKEN");
    const problems = [];
    if (!token.text.length || /^\[_.*\]$/u.test(token.text))
      problems.push("NONLEXICAL_TOKEN");
    if (!Number.isSafeInteger(token.tokenId) || token.tokenId < 0)
      problems.push("TOKEN_ID_MISSING_OR_INVALID");
    if (!span(token.sourceStart, token.sourceEnd))
      problems.push("INVALID_TOKEN_INTERVAL");
    if (
      span(token.sourceStart, token.sourceEnd) &&
      (token.sourceStart < record.sourceStart ||
        token.sourceEnd > record.sourceEnd)
    )
      problems.push("TOKEN_OUTSIDE_RECORD_INTERVAL");
    if (
      index > 0 &&
      finite(token.sourceStart) &&
      finite(row.tokens[index - 1]?.sourceEnd) &&
      token.sourceStart < row.tokens[index - 1].sourceEnd
    )
      problems.push("INTRA_RECORD_TOKEN_OVERLAP_OR_BACKTRACK");
    blockers.push(...problems);
    return {
      index,
      text: token.text,
      tokenId: Number.isSafeInteger(token.tokenId) ? token.tokenId : null,
      sourceStart: finite(token.sourceStart) ? token.sourceStart : null,
      sourceEnd: finite(token.sourceEnd) ? token.sourceEnd : null,
      issues: problems,
    };
  });
  if (tokens.map((token) => token.text).join("") !== record.text)
    blockers.push("LEXICAL_TOKEN_TEXT_NOT_EXACT_RECORD_TEXT");
  return { tokens, blockers: unique(blockers), provenance: p ?? null };
}

function occurrenceCount(tokens, pattern) {
  const prefix = Array(pattern.length).fill(0);
  for (let i = 1, matched = 0; i < pattern.length; i++) {
    while (matched > 0 && pattern[i] !== pattern[matched])
      matched = prefix[matched - 1];
    if (pattern[i] === pattern[matched]) matched++;
    prefix[i] = matched;
  }
  let count = 0,
    matched = 0;
  for (const token of tokens) {
    while (matched > 0 && token.text !== pattern[matched])
      matched = prefix[matched - 1];
    if (token.text === pattern[matched]) matched++;
    if (matched === pattern.length) {
      count++;
      matched = prefix[matched - 1];
    }
  }
  return count;
}

function sharedRuns(left, right, overlap) {
  const runs = [];
  search: for (let i = 0; i < left.length; i++)
    for (let j = 0; j < right.length; j++) {
      if (
        left[i].text !== right[j].text ||
        (i > 0 && j > 0 && left[i - 1].text === right[j - 1].text)
      )
        continue;
      let count = 0;
      while (
        i + count < left.length &&
        j + count < right.length &&
        left[i + count].text === right[j + count].text
      )
        count++;
      const text = left
        .slice(i, i + count)
        .map((token) => token.text)
        .join("");
      if (Array.from(text).length < seamEvidencePolicy.minimumSharedCharacters)
        continue;
      const matches = Array.from({ length: count }, (_, offset) => {
        const a = left[i + offset],
          b = right[j + offset];
        const sourceOverlap = intersection(
          [a.sourceStart, a.sourceEnd],
          [b.sourceStart, b.sourceEnd],
        );
        return {
          leftTokenIndex: a.index,
          rightTokenIndex: b.index,
          text: a.text,
          tokenIdEqual: a.tokenId !== null && a.tokenId === b.tokenId,
          leftInterval: [a.sourceStart, a.sourceEnd],
          rightInterval: [b.sourceStart, b.sourceEnd],
          sourceOverlap,
          sameExactInterval:
            span(a.sourceStart, a.sourceEnd) &&
            a.sourceStart === b.sourceStart &&
            a.sourceEnd === b.sourceEnd,
          insideRequestOverlap:
            !!overlap &&
            a.sourceStart >= overlap.start &&
            a.sourceEnd <= overlap.end &&
            b.sourceStart >= overlap.start &&
            b.sourceEnd <= overlap.end,
        };
      });
      const pattern = left.slice(i, i + count).map((token) => token.text);
      runs.push({
        text,
        characterCount: Array.from(text).length,
        leftTokenRange: [i, i + count],
        rightTokenRange: [j, j + count],
        isSuffixPrefix: i + count === left.length && j === 0,
        leftOccurrences: occurrenceCount(left, pattern),
        rightOccurrences: occurrenceCount(right, pattern),
        allTokenIdsEqual: matches.every((match) => match.tokenIdEqual),
        allTokenIntervalsOverlap: matches.every(
          (match) => match.sourceOverlap !== null,
        ),
        allTokenIntervalsExactlyEqual: matches.every(
          (match) => match.sameExactInterval,
        ),
        allTokensInsideRequestOverlap: matches.every(
          (match) => match.insideRequestOverlap,
        ),
        matches,
      });
      if (runs.length > seamEvidencePolicy.maximumReportedRunsPerPair)
        break search;
    }
  return runs.sort(
    (a, b) =>
      Number(b.isSuffixPrefix) - Number(a.isSuffixPrefix) ||
      b.characterCount - a.characterCount ||
      a.leftTokenRange[0] - b.leftTokenRange[0] ||
      a.rightTokenRange[0] - b.rightTokenRange[0],
  );
}

/**
 * Each evidence row binds a record to exact lexical tokens with source-global
 * intervals and hash provenance. Caller validation is reported, never upgraded
 * to acoustic truth. No Boolean or text match can authorize a repair here.
 */
export function analyzeSeamEvidence({
  records,
  decisions,
  tokenEvidence,
  sourceOffset,
}) {
  if (
    !Array.isArray(records) ||
    !Array.isArray(decisions) ||
    !Array.isArray(tokenEvidence) ||
    !finite(sourceOffset) ||
    sourceOffset < 0
  )
    throw new TypeError("SEAM_INVALID_INPUT");
  const byId = new Map(),
    evidenceById = new Map();
  for (const record of records) {
    if (
      !record ||
      !id(record.recordId) ||
      !id(record.requestId) ||
      !id(record.chunkId) ||
      !Number.isSafeInteger(record.chunkIndex) ||
      record.chunkIndex < 0 ||
      typeof record.text !== "string" ||
      byId.has(record.recordId)
    )
      throw new TypeError("SEAM_INVALID_OR_DUPLICATE_RECORD");
    byId.set(record.recordId, record);
  }
  for (const evidence of tokenEvidence) {
    if (
      !evidence ||
      !id(evidence.recordId) ||
      !byId.has(evidence.recordId) ||
      evidenceById.has(evidence.recordId)
    )
      throw new TypeError("SEAM_INVALID_OR_DUPLICATE_TOKEN_BINDING");
    evidenceById.set(evidence.recordId, evidence);
  }
  const pairDegree = new Map();
  for (const d of decisions) {
    if (
      !d ||
      !byId.has(d.leftId) ||
      !byId.has(d.rightId) ||
      d.leftId === d.rightId ||
      !Array.isArray(d.overlap) ||
      d.overlap.length !== 2 ||
      !span(...d.overlap)
    )
      throw new TypeError("SEAM_INVALID_DECISION");
    for (const recordId of [d.leftId, d.rightId])
      pairDegree.set(recordId, (pairDegree.get(recordId) ?? 0) + 1);
  }
  const pairs = decisions.map((d, decisionIndex) => {
    const left = byId.get(d.leftId),
      right = byId.get(d.rightId),
      a = tokenizeEvidence(evidenceById.get(d.leftId), left),
      b = tokenizeEvidence(evidenceById.get(d.rightId), right);
    const blockers = [...a.blockers, ...b.blockers];
    const requestOverlap = {
      start: sourceOffset + d.overlap[0],
      end: sourceOffset + d.overlap[1],
    };
    if (!span(requestOverlap.start, requestOverlap.end))
      throw new TypeError("SEAM_SOURCE_GLOBAL_OVERLAP_NOT_REPRESENTABLE");
    if (
      !span(left.sourceStart, left.sourceEnd) ||
      !span(right.sourceStart, right.sourceEnd)
    )
      blockers.push("INVALID_RECORD_INTERVAL");
    if (
      left.chunkIndex + 1 !== right.chunkIndex ||
      left.chunkId === right.chunkId ||
      left.requestId === right.requestId
    )
      blockers.push("NONADJACENT_OR_SAME_REQUEST");
    if (
      pairDegree.get(left.recordId) !== 1 ||
      pairDegree.get(right.recordId) !== 1
    )
      blockers.push("NONUNIQUE_SEAM_ASSOCIATION");
    for (const record of [left, right]) {
      if (!Array.isArray(record.issues) || record.issues.length)
        blockers.push("UPSTREAM_RECORD_ISSUES");
      if (
        finite(record.audioGlobalStart) &&
        record.sourceStart !== record.audioGlobalStart + sourceOffset
      )
        blockers.push("SOURCE_GLOBAL_OFFSET_BINDING_MISMATCH");
      if (
        finite(record.audioGlobalEnd) &&
        record.sourceEnd !== record.audioGlobalEnd + sourceOffset
      )
        blockers.push("SOURCE_GLOBAL_OFFSET_BINDING_MISMATCH");
    }
    if (
      a.provenance &&
      b.provenance &&
      ["sourceHash", "modelHash", "runtimeHash"].some(
        (key) => a.provenance[key] !== b.provenance[key],
      )
    )
      blockers.push("SOURCE_OR_TOKEN_NAMESPACE_MISMATCH");
    const recordOverlap = intersection(
      [left.sourceStart, left.sourceEnd],
      [right.sourceStart, right.sourceEnd],
    );
    const effectiveOverlap = recordOverlap
      ? intersection(
          [recordOverlap.start, recordOverlap.end],
          [requestOverlap.start, requestOverlap.end],
        )
      : null;
    if (!effectiveOverlap) blockers.push("NO_SOURCE_GLOBAL_SEAM_OVERLAP");
    const runs = sharedRuns(a.tokens, b.tokens, requestOverlap),
      suffixPrefix = runs.find((run) => run.isSuffixPrefix) ?? null;
    if (!suffixPrefix) blockers.push("NO_EXACT_SUFFIX_PREFIX_TOKEN_MATCH");
    if (!runs.length) blockers.push("NO_SHARED_LEXICAL_TOKEN_RUN");
    if (
      runs.some(
        (run) =>
          run.leftTokenRange[1] === a.tokens.length &&
          run.rightTokenRange[0] > 0,
      )
    )
      blockers.push("RIGHT_PREFIX_OR_SPELLING_CONFLICT");
    if (runs.some((run) => !run.allTokenIntervalsOverlap))
      blockers.push("SHARED_TEXT_HAS_NONOVERLAPPING_TOKEN_OCCURRENCES");
    if (suffixPrefix) {
      if (suffixPrefix.characterCount <= seamEvidencePolicy.shortTextCodepoints)
        blockers.push("SHORT_INTERJECTION_OR_PHRASE_PROTECTED");
      if (
        suffixPrefix.leftOccurrences !== 1 ||
        suffixPrefix.rightOccurrences !== 1
      )
        blockers.push("NONUNIQUE_REPEATED_TEXT_OCCURRENCE");
      if (!suffixPrefix.allTokenIdsEqual)
        blockers.push("MATCHING_TEXT_DIFFERENT_TOKEN_IDS");
      if (!suffixPrefix.allTokenIntervalsOverlap)
        blockers.push("SUFFIX_PREFIX_TOKEN_INTERVALS_DISAGREE");
      if (!suffixPrefix.allTokensInsideRequestOverlap)
        blockers.push("MATCHED_TOKENS_OUTSIDE_REQUEST_OVERLAP");
    }
    // Offsets can be projected/interpolated. Even exact text, IDs and overlapping
    // offsets do not establish one utterance, or exclude simultaneous/repeated speech.
    blockers.push("ACOUSTIC_OCCURRENCE_EQUIVALENCE_UNPROVEN");
    if (runs.length > seamEvidencePolicy.maximumReportedRunsPerPair)
      blockers.push("SHARED_RUN_DIAGNOSTICS_TRUNCATED");
    return {
      decisionIndex,
      leftId: left.recordId,
      rightId: right.recordId,
      originalStatus: d.status ?? null,
      status: "ABSTAIN",
      proposedRepair: null,
      blockers: unique(blockers),
      left: {
        text: left.text,
        requestId: left.requestId,
        interval: [
          finite(left.sourceStart) ? left.sourceStart : null,
          finite(left.sourceEnd) ? left.sourceEnd : null,
        ],
        tokenIssues: a.tokens.filter((token) => token.issues.length),
      },
      right: {
        text: right.text,
        requestId: right.requestId,
        interval: [
          finite(right.sourceStart) ? right.sourceStart : null,
          finite(right.sourceEnd) ? right.sourceEnd : null,
        ],
        tokenIssues: b.tokens.filter((token) => token.issues.length),
      },
      sourceOffset,
      requestOverlap,
      recordOverlap,
      effectiveOverlap,
      exactSuffixPrefixCandidate: suffixPrefix,
      sharedTokenRuns: runs.slice(
        0,
        seamEvidencePolicy.maximumReportedRunsPerPair,
      ),
      totalSharedTokenRuns:
        runs.length <= seamEvidencePolicy.maximumReportedRunsPerPair
          ? runs.length
          : null,
      sharedRunEnumerationComplete:
        runs.length <= seamEvidencePolicy.maximumReportedRunsPerPair,
    };
  });
  return {
    version: "bounded-seam-evidence-v1",
    policy: { ...seamEvidencePolicy },
    status: "needs-review",
    summary: {
      pairCount: pairs.length,
      abstainedCount: pairs.length,
      proposedRepairCount: 0,
      exactSuffixPrefixCandidateCount: pairs.filter(
        (pair) => pair.exactSuffixPrefixCandidate,
      ).length,
    },
    pairs,
  };
}
