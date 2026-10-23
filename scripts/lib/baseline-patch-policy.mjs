import { createHash } from "node:crypto";
import { auditContent } from "./machine-content-audit.mjs";

/** Pure, reference-free suggestions. Projection creates a copy, never a release. */
export const baselinePatchPolicy = Object.freeze({
  version: "baseline-whole-cue-patch-v1",
  minimumNeighborRepeats: 6,
  minimumNeighborPatternCharacters: 8,
  minimumShortRepeatedCues: 2,
  minimumIntraCueRepeats: 8,
  minimumIntraCueRepeatedCharacters: 64,
  maximumUnflaggedEdgeRecords: 2,
  maximumEnvelopeGapSeconds: 0.3,
  automaticApplication: false,
  acousticTimingVerified: false,
  timingRepairClaimed: false,
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const hashString = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const recordId = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value);
const normalized = (value) =>
  value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const safeText = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  !Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
  });
const recordsOf = (baseline) =>
  Array.isArray(baseline) ? baseline : baseline?.records;
const clone = (value) => globalThis.structuredClone(value);

// Key ordering is irrelevant, but every field is bound. Invalid original times
// (including nonfinite values) must not collide with null or disappear.
function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "number")
    return Object.is(value, -0) ? "-0" : String(value);
  if (["string", "boolean"].includes(typeof value))
    return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("UNHASHABLE_PATCH_VALUE");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

export function baselinePatchHash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function validIdentities(records) {
  return (
    Array.isArray(records) &&
    records.every(
      (record) =>
        record &&
        typeof record === "object" &&
        recordId(record.recordId) &&
        typeof record.text === "string",
    ) &&
    new Set(records.map((record) => record.recordId)).size === records.length
  );
}

function validTimedRecord(record, allowZero = false) {
  return (
    record?.parseStatus === "PARSED" &&
    safeText(record.text) &&
    Array.isArray(record.issues) &&
    record.issues.every((issue) => allowZero && issue === "ZERO_DURATION") &&
    finite(record.sourceStart) &&
    finite(record.sourceEnd) &&
    record.sourceStart >= 0 &&
    (allowZero
      ? record.sourceEnd >= record.sourceStart
      : record.sourceEnd > record.sourceStart)
  );
}

function validWindow(window) {
  return (
    window &&
    finite(window.start) &&
    finite(window.end) &&
    window.start >= 0 &&
    window.end > window.start
  );
}

function overlap(a, b) {
  return (
    finite(a.sourceStart) &&
    finite(a.sourceEnd) &&
    finite(b.sourceStart) &&
    finite(b.sourceEnd) &&
    a.sourceStart < a.sourceEnd &&
    b.sourceStart < b.sourceEnd &&
    a.sourceStart < b.sourceEnd &&
    b.sourceStart < a.sourceEnd
  );
}

function extremeAnomaly(records) {
  const audit = auditContent(
    records.map((record) => ({
      id: record.recordId,
      text: record.text,
      start: record.sourceStart,
      end: record.sourceEnd,
    })),
  );
  const short = new Set(
    audit.issues
      .filter((issue) => issue.code === "SHORT_POSITIVE_DURATION")
      .flatMap((issue) => issue.cueIndexes),
  );
  const extreme = audit.issues.filter((issue) => {
    if (issue.code === "INTRA_CUE_REPETITION")
      return (
        issue.evidence.repeats >= baselinePatchPolicy.minimumIntraCueRepeats &&
        issue.evidence.repeatedCharacters >=
          baselinePatchPolicy.minimumIntraCueRepeatedCharacters
      );
    if (
      ![
        "NEIGHBORING_EXACT_REPETITION",
        "NEIGHBORING_SHARED_SUBSTRING",
      ].includes(issue.code)
    )
      return false;
    const pattern =
      issue.evidence.normalizedText ?? issue.evidence.normalizedPattern;
    return (
      issue.cueIndexes.length >= baselinePatchPolicy.minimumNeighborRepeats &&
      Array.from(pattern).length >=
        baselinePatchPolicy.minimumNeighborPatternCharacters &&
      issue.cueIndexes.filter((index) => short.has(index)).length >=
        baselinePatchPolicy.minimumShortRepeatedCues
    );
  });
  const flagged = new Set(extreme.flatMap((issue) => issue.cueIndexes));
  const patterns = extreme
    .map(
      (issue) =>
        issue.evidence.normalizedText ?? issue.evidence.normalizedPattern,
    )
    .filter(Boolean);
  // Allow a small associated edge (including a zero-duration raw record), not
  // arbitrary normal dialogue bundled into a large user-selected window.
  const first = Math.min(...flagged),
    last = Math.max(...flagged);
  const unrelated = records.flatMap((record, index) => {
    if (flagged.has(index)) return [];
    const associated = patterns.some((pattern) =>
      normalized(record.text).includes(pattern),
    );
    const distance =
      index < first ? first - index : index > last ? index - last : 0;
    return associated &&
      distance <= baselinePatchPolicy.maximumUnflaggedEdgeRecords
      ? []
      : [record.recordId];
  });
  return { extreme, unrelated, auditSummary: audit.summary };
}

const difference = (a, b) => Number((a - b).toFixed(12));
const baseResult = () => ({
  version: baselinePatchPolicy.version,
  qualityStatus: "needs-review",
  finalizationMethod: "none",
  automaticApplication: false,
  acousticTimingVerified: false,
  referenceUsed: false,
});

/** Keeps every donor cue intact; no trimming, interpolation, sorting or inference. */
export function proposeBaselinePatch(input = {}) {
  const {
    donorRecords,
    window,
    sourceHash,
    donorSourceHash,
    donorEvidenceHash,
  } = input;
  const baseline = recordsOf(input.baseline);
  const abstain = (reason, extra = {}) => ({
    ...baseResult(),
    status: "ABSTAIN",
    reasons: [reason],
    proposal: null,
    ...extra,
  });
  if (
    !hashString(sourceHash) ||
    !hashString(donorEvidenceHash) ||
    !hashString(donorSourceHash)
  )
    return abstain("MISSING_OR_INVALID_SOURCE_EVIDENCE_HASH");
  if (
    sourceHash !== donorSourceHash ||
    (!Array.isArray(input.baseline) &&
      input.baseline?.sourceHash !== sourceHash)
  )
    return abstain("SOURCE_HASH_MISMATCH");
  if (!validIdentities(baseline)) return abstain("INVALID_BASELINE_IDENTITIES");
  if (!validWindow(window)) return abstain("INVALID_WINDOW");
  if (
    !validIdentities(donorRecords) ||
    !donorRecords.length ||
    !donorRecords.every(
      (record, index) =>
        validTimedRecord(record) &&
        (!index || record.sourceStart >= donorRecords[index - 1].sourceEnd),
    )
  )
    return abstain("INVALID_OR_UNORDERED_DONOR_RECORDS");

  const indices = baseline.flatMap((record, index) =>
    finite(record.sourceStart) &&
    finite(record.sourceEnd) &&
    record.sourceStart >= window.start &&
    record.sourceStart < window.end &&
    record.sourceEnd <= window.end &&
    record.sourceEnd >= record.sourceStart
      ? [index]
      : [],
  );
  if (!indices.length) return abstain("NO_COMPLETE_BASELINE_CUES_IN_WINDOW");
  if (indices.some((index, offset) => index !== indices[0] + offset))
    return abstain("TARGETS_NOT_CONTIGUOUS");
  const beforeRecords = indices.map((index) => baseline[index]);
  if (
    !beforeRecords.every(
      (record, index) =>
        validTimedRecord(record, true) &&
        (!index || record.sourceStart >= beforeRecords[index - 1].sourceStart),
    )
  )
    return abstain("TARGET_HAS_UNSUPPORTED_INVALID_RECORD");
  const anomaly = extremeAnomaly(beforeRecords);
  if (!anomaly.extreme.length)
    return abstain("NO_EXTREME_MACHINE_REPETITION", { anomaly });
  if (anomaly.unrelated.length)
    return abstain("TARGET_INCLUDES_NONANOMALOUS_RECORD", { anomaly });

  const targetIds = new Set(beforeRecords.map((record) => record.recordId));
  const protectedRecords = baseline.filter(
    (record) => !targetIds.has(record.recordId),
  );
  const envelope = {
    start: Math.min(...beforeRecords.map((record) => record.sourceStart)),
    end: Math.max(...beforeRecords.map((record) => record.sourceEnd)),
  };
  const excludedDonors = [],
    replacementRecords = [];
  for (const record of donorRecords) {
    const reasons = [];
    if (record.sourceStart < envelope.start || record.sourceEnd > envelope.end)
      reasons.push("OUTSIDE_TARGET_ENVELOPE");
    if (window.start > 0 && record.sourceStart <= window.start)
      reasons.push("LEFT_CROP_BOUNDARY_POSSIBLY_TRUNCATED");
    if (
      protectedRecords.some((protectedRecord) =>
        overlap(record, protectedRecord),
      )
    )
      reasons.push("OVERLAPS_PROTECTED_BASELINE_CUE");
    if (reasons.length)
      excludedDonors.push({ recordId: record.recordId, reasons });
    else replacementRecords.push(record);
  }
  if (!replacementRecords.length)
    return abstain("NO_WHOLE_SAFE_DONOR_CUES", { excludedDonors });
  if (
    replacementRecords.some((record) =>
      protectedRecords.some((r) => r.recordId === record.recordId),
    )
  )
    return abstain("DONOR_ID_COLLIDES_WITH_PROTECTED_RECORD");
  const boundaryDifferences = {
    startSeconds: difference(replacementRecords[0].sourceStart, envelope.start),
    endSeconds: difference(replacementRecords.at(-1).sourceEnd, envelope.end),
  };
  if (
    Math.abs(boundaryDifferences.startSeconds) >
      baselinePatchPolicy.maximumEnvelopeGapSeconds ||
    Math.abs(boundaryDifferences.endSeconds) >
      baselinePatchPolicy.maximumEnvelopeGapSeconds
  )
    return abstain("DONOR_ENVELOPE_COVERAGE_INSUFFICIENT", {
      boundaryDifferences,
      excludedDonors,
    });
  if (extremeAnomaly(replacementRecords).extreme.length)
    return abstain("DONOR_STILL_HAS_EXTREME_MACHINE_REPETITION");
  const invalidBeforeRecordIds = beforeRecords
    .filter((record) => record.sourceStart === record.sourceEnd)
    .map((record) => record.recordId);
  const uncertainties = [
    "TEXT_ONLY_MACHINE_ANOMALY_NOT_ACOUSTIC_TRUTH",
    "WHOLE_CUE_SUBSTITUTION_REQUIRES_REVIEW",
  ];
  if (boundaryDifferences.startSeconds || boundaryDifferences.endSeconds)
    uncertainties.push("ENVELOPE_BOUNDARY_DIFFERENCE_NOT_REALIGNED");
  if (replacementRecords.at(-1).sourceEnd === window.end)
    uncertainties.push("DONOR_TAIL_TOUCHES_CROP_BOUNDARY");
  if (
    replacementRecords.some(
      (record, index) =>
        index && record.sourceStart > replacementRecords[index - 1].sourceEnd,
    )
  )
    uncertainties.push("DONOR_INTERNAL_GAPS_NOT_ACOUSTICALLY_VERIFIED");
  if (invalidBeforeRecordIds.length)
    uncertainties.push(
      "INVALID_BASELINE_RECORD_SUBSTITUTED_NOT_TIMING_REPAIRED",
    );
  const proposal = {
    ...baseResult(),
    sourceHash,
    donorSourceHash,
    evidenceHash: donorEvidenceHash,
    baselineHash: baselinePatchHash(baseline),
    window: { start: window.start, end: window.end },
    envelope,
    targetRecordIds: beforeRecords.map((record) => record.recordId),
    beforeHash: baselinePatchHash(beforeRecords),
    beforeRecords: clone(beforeRecords),
    replacementRecords: clone(replacementRecords),
    replacementHash: baselinePatchHash(replacementRecords),
    donorRecords: clone(donorRecords),
    donorRecordsHash: baselinePatchHash(donorRecords),
    excludedDonors,
    anomaly,
    boundaryDifferences,
    invalidBeforeRecordIds,
    uncertainties,
    timingRepairClaimed: false,
    suggestionOnly: true,
  };
  proposal.patchId = `baseline-patch-${baselinePatchHash(proposal)}`;
  return {
    ...baseResult(),
    status: "PROPOSED",
    reasons: ["EXTREME_MACHINE_REPETITION_WHOLE_DONOR_REVIEW_ONLY"],
    proposal,
  };
}

/** Structural/digest validation; projection additionally replays the full policy. */
export function validateBaselinePatchProposal(proposal) {
  const reasons = [];
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal))
    return { valid: false, reasons: ["INVALID_PROPOSAL"] };
  if (
    proposal.version !== baselinePatchPolicy.version ||
    proposal.qualityStatus !== "needs-review" ||
    proposal.finalizationMethod !== "none" ||
    proposal.automaticApplication !== false ||
    proposal.acousticTimingVerified !== false ||
    proposal.timingRepairClaimed !== false ||
    proposal.referenceUsed !== false ||
    proposal.suggestionOnly !== true
  )
    reasons.push("INVALID_PROPOSAL_SAFETY_FLAGS");
  if (
    ![
      "sourceHash",
      "donorSourceHash",
      "evidenceHash",
      "baselineHash",
      "beforeHash",
      "replacementHash",
      "donorRecordsHash",
    ].every((key) => hashString(proposal[key]))
  )
    reasons.push("INVALID_PROPOSAL_HASHES");
  if (
    !Array.isArray(proposal.targetRecordIds) ||
    !proposal.targetRecordIds.length ||
    !proposal.targetRecordIds.every(recordId) ||
    new Set(proposal.targetRecordIds).size !== proposal.targetRecordIds.length
  )
    reasons.push("INVALID_TARGET_IDS");
  if (
    !validWindow(proposal.window) ||
    !validIdentities(proposal.beforeRecords) ||
    !validIdentities(proposal.replacementRecords) ||
    !proposal.replacementRecords.length ||
    !validIdentities(proposal.donorRecords) ||
    !proposal.donorRecords.length ||
    !proposal.replacementRecords.every((record) => validTimedRecord(record))
  )
    reasons.push("INVALID_PROPOSAL_RECORDS");
  try {
    const { patchId, ...bound } = proposal;
    if (patchId !== `baseline-patch-${baselinePatchHash(bound)}`)
      reasons.push("PROPOSAL_DIGEST_MISMATCH");
    if (
      proposal.beforeHash !== baselinePatchHash(proposal.beforeRecords) ||
      proposal.replacementHash !==
        baselinePatchHash(proposal.replacementRecords) ||
      proposal.donorRecordsHash !== baselinePatchHash(proposal.donorRecords)
    )
      reasons.push("RECORD_DIGEST_MISMATCH");
  } catch {
    reasons.push("UNHASHABLE_PROPOSAL");
  }
  return { valid: reasons.length === 0, reasons };
}

/** Atomic preview. Rejection and an empty selection both retain the full baseline. */
export function projectBaselinePatches(
  baselineInput,
  proposals,
  selectedPatchIds,
  options = {},
) {
  const baseline = recordsOf(baselineInput);
  if (!validIdentities(baseline))
    throw new TypeError("INVALID_BASELINE_IDENTITIES");
  const baselineHash = baselinePatchHash(baseline);
  const result = (
    status,
    reasons,
    records = baseline,
    changes = [],
    protectedRecords = baseline,
  ) => ({
    ...baseResult(),
    status,
    mode: "preview",
    reasons,
    records: clone(records),
    changes: clone(changes),
    baselineHash,
    projectedHash: baselinePatchHash(records),
    protectedCount: protectedRecords.length,
    protectedHash: baselinePatchHash(protectedRecords),
  });
  const reject = (reason) => result("REJECTED", [reason]);
  if (
    !Array.isArray(selectedPatchIds) ||
    new Set(selectedPatchIds).size !== selectedPatchIds.length
  )
    return reject("INVALID_OR_DUPLICATE_SELECTION");
  if (options.mode !== undefined && options.mode !== "preview")
    return reject("PREVIEW_ONLY");
  if (!selectedPatchIds.length) return result("IDENTITY", []);
  const sourceHash = options.sourceHash ?? baselineInput?.sourceHash;
  if (!hashString(sourceHash))
    return reject("SOURCE_HASH_REQUIRED_FOR_PROJECTION");
  if (!Array.isArray(baselineInput) && baselineInput.sourceHash !== sourceHash)
    return reject("SOURCE_HASH_MISMATCH");
  if (!Array.isArray(proposals)) return reject("INVALID_PROPOSAL_COLLECTION");
  const selected = [];
  for (const patchId of selectedPatchIds) {
    const matches = proposals.filter(
      (proposal) => proposal?.patchId === patchId,
    );
    if (matches.length !== 1)
      return reject("MISSING_OR_AMBIGUOUS_SELECTED_PATCH");
    const proposal = matches[0];
    const validation = validateBaselinePatchProposal(proposal);
    if (!validation.valid) return reject(validation.reasons.join(":"));
    if (
      proposal.sourceHash !== sourceHash ||
      proposal.donorSourceHash !== sourceHash
    )
      return reject("SOURCE_HASH_MISMATCH");
    if (proposal.baselineHash !== baselineHash)
      return reject("STALE_BASELINE_HASH");
    const start = baseline.findIndex(
      (record) => record.recordId === proposal.targetRecordIds[0],
    );
    const before = baseline.slice(
      start,
      start + proposal.targetRecordIds.length,
    );
    if (
      start < 0 ||
      before.some(
        (record, index) => record.recordId !== proposal.targetRecordIds[index],
      ) ||
      before.length !== proposal.targetRecordIds.length
    )
      return reject("TARGETS_NOT_CONTIGUOUS_OR_FOREIGN");
    if (baselinePatchHash(before) !== proposal.beforeHash)
      return reject("STALE_BEFORE_HASH");
    const replay = proposeBaselinePatch({
      baseline,
      donorRecords: proposal.donorRecords,
      window: proposal.window,
      sourceHash,
      donorSourceHash: proposal.donorSourceHash,
      donorEvidenceHash: proposal.evidenceHash,
    });
    if (
      replay.status !== "PROPOSED" ||
      baselinePatchHash(replay.proposal) !== baselinePatchHash(proposal)
    )
      return reject("PROPOSAL_POLICY_REPLAY_MISMATCH");
    selected.push({ proposal, start });
  }
  const used = new Set();
  for (const { proposal } of selected) {
    for (const id of proposal.targetRecordIds) {
      if (used.has(id)) return reject("PATCH_TARGET_CONFLICT");
      used.add(id);
    }
  }
  const allReplacement = selected.flatMap(
    ({ proposal }) => proposal.replacementRecords,
  );
  if (
    new Set(allReplacement.map((record) => record.recordId)).size !==
    allReplacement.length
  )
    return reject("PATCH_REPLACEMENT_ID_CONFLICT");
  for (let a = 0; a < selected.length; a++)
    for (let b = a + 1; b < selected.length; b++)
      if (
        selected[a].proposal.replacementRecords.some((left) =>
          selected[b].proposal.replacementRecords.some((right) =>
            overlap(left, right),
          ),
        )
      )
        return reject("PATCH_REPLACEMENT_TIMING_CONFLICT");
  const byStart = new Map(selected.map((item) => [item.start, item.proposal]));
  const records = [],
    changes = [];
  for (let index = 0; index < baseline.length; index++) {
    const proposal = byStart.get(index);
    if (!proposal) {
      records.push(baseline[index]);
      continue;
    }
    records.push(...proposal.replacementRecords);
    changes.push({
      patchId: proposal.patchId,
      targetRecordIds: proposal.targetRecordIds,
      beforeHash: proposal.beforeHash,
      replacementHash: proposal.replacementHash,
      beforeRecords: proposal.beforeRecords,
      replacementRecords: proposal.replacementRecords,
      invalidBeforeRecordIds: proposal.invalidBeforeRecordIds,
      timingRepairClaimed: false,
    });
    index += proposal.targetRecordIds.length - 1;
  }
  const protectedRecords = baseline.filter(
    (record) => !used.has(record.recordId),
  );
  const projectedProtected = records.filter(
    (record) => !allReplacement.some((r) => r.recordId === record.recordId),
  );
  if (
    baselinePatchHash(projectedProtected) !==
    baselinePatchHash(protectedRecords)
  )
    return reject("PROTECTED_RECORD_INTEGRITY_FAILURE");
  return result("PROJECTED", [], records, changes, protectedRecords);
}
