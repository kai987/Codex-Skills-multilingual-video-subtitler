/** Pure machine candidate assembly. No reference, filesystem, or provider access. */
import { createHash } from "node:crypto";
import { decimal } from "./bounded-diagnostics.mjs";

export const correctionPolicy = Object.freeze({
  version: "machine-correction-candidate-v1",
  requiredViews: 2,
  agreement: "exact-after-unicode-whitespace-removal-only",
  ownership: "continuous-complete-lexical-token-group-no-clipping",
  baselineOwnership: "whole-record-IDs-overlapping-candidate-corridor",
  boundaryStabilitySeconds: 0.35,
  naturalGapSeconds: 0.35,
  minimumBaselineSimilarity: 0.5,
  minimumRetainedLength: 0.7,
  projection: "inward-common-centisecond-grid",
  zeroDurationLexical: "reject",
  collision: "reject-all-members",
  selection: "narrower-request-then-request-id-no-averaging",
  finalizationMethod: "none",
  humanValidated: false,
  machineOnlyReleaseAuthorized: false,
});

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const norm = (text) => text.replace(/\p{White_Space}/gu, "");
const validUnicode = (text) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\uFFFD/u.test(
    text,
  );
const bounds = (start, end) =>
  Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const interval = (record) => ({
  start: record.sourceStart,
  end: record.sourceEnd,
});
const requireValue = (condition, reason) => {
  if (!condition) throw Error(reason);
};
const isHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const unique = (values) => new Set(values).size === values.length;
const grid = (value, direction) => {
  const q = decimal(value),
    scaled = q.n * 100n;
  return (
    Number(direction === "start" ? (scaled + q.d - 1n) / q.d : scaled / q.d) /
    100
  );
};
const differenceWithin = (left, right, maximum) => {
  const a = decimal(left),
    b = decimal(right),
    limit = decimal(maximum);
  const numerator = a.n * b.d - b.n * a.d;
  return (
    (numerator < 0n ? -numerator : numerator) * limit.d <= limit.n * a.d * b.d
  );
};
const gapAtLeast = (next, previous, minimum) => {
  const a = decimal(next),
    b = decimal(previous),
    limit = decimal(minimum);
  return (a.n * b.d - b.n * a.d) * limit.d >= limit.n * a.d * b.d;
};

function similarity(left, right) {
  const a = Array.from(norm(left)),
    b = Array.from(norm(right));
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  a.forEach((c, i) => {
    const next = [i + 1];
    b.forEach((d, j) => {
      next.push(
        Math.min(
          next[j] + 1,
          previous[j + 1] + 1,
          previous[j] + (c === d ? 0 : 1),
        ),
      );
    });
    previous = next;
  });
  return 1 - previous[b.length] / Math.max(a.length, b.length, 1);
}

function repetitionRisk(text) {
  const chars = Array.from(norm(text));
  for (let i = 0; i < chars.length; i++) {
    let run = i + 1;
    while (run < chars.length && chars[run] === chars[i]) run++;
    if (run - i >= 12) return true;
    for (let width = 2; width <= 8; width++) {
      let end = i + width;
      while (
        end + width <= chars.length &&
        chars.slice(i, i + width).every((c, j) => c === chars[end + j])
      )
        end += width;
      if (end - i >= 12 && (end - i) / width >= 3) return true;
    }
  }
  return false;
}

/** Keep decoder order. Sorting timestamps before validation would hide inversions. */
function projectView(view, target, accounting) {
  requireValue(view.status === "completed", "VIEW_NOT_COMPLETED");
  requireValue(
    typeof view.requestId === "string" &&
      view.requestId.length > 0 &&
      isHash(view.audioHash) &&
      isHash(view.rawHash),
    "VIEW_IDENTITY_INVALID",
  );
  requireValue(
    bounds(view.requestStart, view.requestEnd) &&
      view.requestStart <= target.start &&
      view.requestEnd >= target.end,
    "REQUEST_DOES_NOT_CONTAIN_OWNERSHIP",
  );
  requireValue(
    Array.isArray(view.segments) && view.segments.length > 0,
    "TOKEN_EVIDENCE_MISSING",
  );
  const selected = [],
    excluded = [];
  let previousEnd = -Infinity,
    lexicalIndex = 0;
  for (const [segmentIndex, segment] of view.segments.entries()) {
    requireValue(
      segment.sourceTextComplete === true &&
        typeof segment.text === "string" &&
        validUnicode(segment.text),
      "SOURCE_TEXT_INCOMPLETE",
    );
    requireValue(
      bounds(segment.start, segment.end) &&
        segment.start >= view.requestStart &&
        segment.end <= view.requestEnd,
      "SEGMENT_OUTSIDE_REQUEST",
    );
    requireValue(
      Array.isArray(segment.tokens) && segment.tokens.length > 0,
      "TOKEN_EVIDENCE_MISSING",
    );
    requireValue(
      segment.tokens.every(
        (token) => token.kind === "LEXICAL" || token.kind === "CONTROL",
      ),
      "TOKEN_VOCABULARY_UNVERIFIED",
    );
    requireValue(
      segment.tokens
        .filter((token) => token.kind === "LEXICAL")
        .map((token) => token.text)
        .join("") === segment.text,
      "SOURCE_TEXT_ACCOUNTING_MISMATCH",
    );
    for (const [tokenIndex, token] of segment.tokens.entries()) {
      if (token.kind === "CONTROL") continue;
      requireValue(
        typeof token.text === "string" && validUnicode(token.text),
        "TOKEN_TEXT_INVALID",
      );
      requireValue(
        Array.isArray(token.flags) && token.flags.length === 0,
        "TOKEN_FLAGS_PRESENT",
      );
      requireValue(
        token.timeStatus === "INTERVAL" && bounds(token.start, token.end),
        "LEXICAL_INTERVAL_UNAVAILABLE",
      );
      requireValue(
        token.start >= segment.start &&
          token.end <= segment.end &&
          token.start >= view.requestStart &&
          token.end <= view.requestEnd,
        "TOKEN_OUTSIDE_PARENT_OR_REQUEST",
      );
      requireValue(token.start >= previousEnd, "TOKEN_ORDER_NONMONOTONIC");
      previousEnd = token.end;
      const row = {
        lexicalIndex: lexicalIndex++,
        segmentIndex,
        tokenIndex,
        text: token.text,
        start: token.start,
        end: token.end,
      };
      const inside = token.start >= target.start && token.end <= target.end;
      requireValue(
        inside || !overlaps(token, target),
        "TOKEN_CROSSES_OWNERSHIP_BOUNDARY",
      );
      (inside ? selected : excluded).push(row);
      accounting.push({
        ...row,
        disposition: inside
          ? "SELECTED"
          : token.end <= target.start
            ? "EXCLUDED_CONTEXT_BEFORE"
            : "EXCLUDED_CONTEXT_AFTER",
      });
    }
  }
  requireValue(
    selected.length > 0 &&
      norm(selected.map((token) => token.text).join("")).length > 0,
    "EMPTY_OWNED_TEXT",
  );
  requireValue(
    selected.every(
      (token, i) =>
        !i || token.lexicalIndex === selected[i - 1].lexicalIndex + 1,
    ),
    "DISCONNECTED_SOURCE_SPAN",
  );
  const groups = [];
  for (const token of selected) {
    const previous = groups.at(-1),
      last = previous?.at(-1);
    if (
      !last ||
      /[。！？!?][」』）\]]*\s*$/u.test(last.text) ||
      gapAtLeast(token.start, last.end, correctionPolicy.naturalGapSeconds)
    )
      groups.push([token]);
    else previous.push(token);
  }
  const projected = groups.map((tokens) => {
    const start = tokens[0].start,
      end = tokens.at(-1).end;
    const item = {
      text: tokens.map((token) => token.text).join(""),
      start,
      end,
      projectedStart: grid(start, "start"),
      projectedEnd: grid(end, "end"),
      tokenCoordinates: tokens.map((token) => [
        token.segmentIndex,
        token.tokenIndex,
      ]),
    };
    requireValue(
      norm(item.text).length > 0 &&
        bounds(item.projectedStart, item.projectedEnd),
      "CUE_PROJECTION_COLLAPSE",
    );
    return item;
  });
  const text = selected.map((token) => token.text).join("");
  requireValue(
    projected.map((group) => group.text).join("") === text,
    "GROUP_TEXT_ACCOUNTING_MISMATCH",
  );
  requireValue(!repetitionRisk(text), "REPETITION_RISK");
  return {
    requestId: view.requestId,
    requestStart: view.requestStart,
    requestEnd: view.requestEnd,
    audioHash: view.audioHash,
    rawHash: view.rawHash,
    text,
    groups: projected,
    accounting,
    selectedCount: selected.length,
    excludedContextCount: excluded.length,
  };
}

function proposal(baseline, target, views) {
  const before = baseline.filter((record) =>
    target.baselineIds.includes(record.recordId),
  );
  const decision = {
    targetId: target.id,
    status: "ABSTAINED",
    action: null,
    reasons: [],
    selectedRequestId: null,
    evidence: [],
    viewAssessments: [],
    similarity: null,
    retainedLengthRatio: null,
    before,
    after: [],
  };
  try {
    requireValue(
      before.length === target.baselineIds.length,
      "TARGET_BASELINE_ID_MISSING",
    );
    requireValue(
      before.every((record) => overlaps(interval(record), target)),
      "BASELINE_TARGET_OUTSIDE_OWNERSHIP",
    );
    requireValue(
      views.length === correctionPolicy.requiredViews,
      "TWO_VIEWS_REQUIRED",
    );
    // A coarse old cue may extend outside this corridor; its complete record and
    // text are still replaced atomically by ID. Only new token evidence must fit.
    for (const view of views) {
      const accounting = [];
      try {
        const projected = projectView(view, target, accounting);
        decision.evidence.push(projected);
        decision.viewAssessments.push({
          requestId: view.requestId,
          rawHash: view.rawHash,
          status: "QUALIFIED",
          reason: null,
          accountingComplete: true,
        });
      } catch (error) {
        decision.viewAssessments.push({
          requestId: view.requestId,
          rawHash: view.rawHash,
          status: "REJECTED",
          reason: error.message,
          accountingComplete: false,
          partialAccounting: accounting,
        });
      }
    }
    const failed = decision.viewAssessments.find(
      (view) => view.status === "REJECTED",
    );
    requireValue(!failed, failed?.reason);
    const evidence = decision.evidence;
    requireValue(
      unique(evidence.map((view) => view.requestId)) &&
        unique(evidence.map((view) => view.audioHash)),
      "INDEPENDENT_VIEW_IDENTITY_REQUIRED",
    );
    const [a, b] = evidence;
    requireValue(norm(a.text) === norm(b.text), "VIEW_TEXT_DISAGREEMENT");
    // Compare every natural cue boundary, not merely the union envelope.
    requireValue(
      a.groups.length === b.groups.length &&
        a.groups.every(
          (group, i) => norm(group.text) === norm(b.groups[i].text),
        ),
      "VIEW_GROUP_DISAGREEMENT",
    );
    requireValue(
      a.groups.every(
        (group, i) =>
          differenceWithin(
            group.start,
            b.groups[i].start,
            correctionPolicy.boundaryStabilitySeconds,
          ) &&
          differenceWithin(
            group.end,
            b.groups[i].end,
            correctionPolicy.boundaryStabilitySeconds,
          ),
      ),
      "VIEW_BOUNDARY_UNSTABLE",
    );
    const chosen = [...evidence].sort(
      (left, right) =>
        left.requestEnd -
          left.requestStart -
          (right.requestEnd - right.requestStart) ||
        left.requestId.localeCompare(right.requestId),
    )[0];
    decision.selectedRequestId = chosen.requestId;
    const oldText = before.map((record) => record.text).join("");
    if (before.length) {
      decision.similarity = similarity(oldText, chosen.text);
      decision.retainedLengthRatio =
        Array.from(norm(chosen.text)).length /
        Math.max(1, Array.from(norm(oldText)).length);
      requireValue(
        decision.similarity >= correctionPolicy.minimumBaselineSimilarity,
        "BASELINE_TEXT_UNRELATED",
      );
      requireValue(
        decision.retainedLengthRatio >= correctionPolicy.minimumRetainedLength,
        "BASELINE_TEXT_LOSS_RISK",
      );
    }
    const unowned = baseline.filter(
      (record) => !target.baselineIds.includes(record.recordId),
    );
    requireValue(
      chosen.groups.every((group) =>
        unowned.every(
          (record) =>
            !overlaps(group, interval(record)) &&
            !overlaps(
              { start: group.projectedStart, end: group.projectedEnd },
              interval(record),
            ),
        ),
      ),
      "UNOWNED_BASELINE_COLLISION",
    );
    if (!before.length) {
      const first = chosen.groups[0],
        last = chosen.groups.at(-1);
      const previous = unowned
        .filter((record) => record.sourceEnd <= first.start)
        .sort((left, right) => right.sourceEnd - left.sourceEnd)[0];
      const next = unowned
        .filter((record) => record.sourceStart >= last.end)
        .sort((left, right) => left.sourceStart - right.sourceStart)[0];
      requireValue(
        ![previous, next].some(
          (record) =>
            record &&
            (norm(record.text) === norm(chosen.text) ||
              chosen.groups.some(
                (group) => norm(record.text) === norm(group.text),
              )),
        ),
        "POTENTIAL_DUPLICATE_INSERTION",
      );
    }
    const id = digest({
      policy: correctionPolicy.version,
      targetId: target.id,
      before,
      evidence,
    });
    decision.after = chosen.groups.map((group, i) => ({
      recordId: `correction-${id.slice(0, 24)}-${i + 1}`,
      text: group.text,
      sourceStart: group.projectedStart,
      sourceEnd: group.projectedEnd,
      source: "paired-local-machine-correction",
      correction: {
        targetId: target.id,
        baselineIds: [...target.baselineIds],
        requestId: chosen.requestId,
        audioHash: chosen.audioHash,
        rawHash: chosen.rawHash,
        tokenCoordinates: group.tokenCoordinates,
        rawInterval: { start: group.start, end: group.end },
        policyVersion: correctionPolicy.version,
      },
    }));
    const sameText = norm(oldText) === norm(chosen.text);
    const sameCues =
      before.length === decision.after.length &&
      before.every(
        (record, i) =>
          record.text === decision.after[i].text &&
          record.sourceStart === decision.after[i].sourceStart &&
          record.sourceEnd === decision.after[i].sourceEnd,
      );
    requireValue(!sameCues, "NO_CHANGE");
    decision.action = !before.length
      ? "INSERT"
      : decision.after.length > before.length
        ? "SPLIT"
        : sameText
          ? "RETIME"
          : "REPLACE";
    decision.status = "PROPOSED";
  } catch (error) {
    decision.reasons.push(error.message);
  }
  return decision;
}

export function buildCorrection(baseline, plan, views) {
  requireValue(
    Array.isArray(baseline) &&
      Array.isArray(plan?.targets) &&
      Array.isArray(views),
    "INPUT_CONTRACT",
  );
  requireValue(
    baseline.every(
      (record) =>
        typeof record.recordId === "string" &&
        typeof record.text === "string" &&
        bounds(record.sourceStart, record.sourceEnd),
    ) && unique(baseline.map((record) => record.recordId)),
    "BASELINE_CONTRACT",
  );
  requireValue(
    baseline.every(
      (record, i) => !i || record.sourceStart >= baseline[i - 1].sourceStart,
    ),
    "BASELINE_ORDER",
  );
  requireValue(
    plan.targets.every(
      (target) =>
        typeof target.id === "string" &&
        bounds(target.start, target.end) &&
        Array.isArray(target.baselineIds) &&
        target.baselineIds.every((id) => typeof id === "string") &&
        unique(target.baselineIds),
    ) && unique(plan.targets.map((target) => target.id)),
    "TARGET_CONTRACT",
  );
  requireValue(
    views.every((view) =>
      plan.targets.some((target) => target.id === view.targetId),
    ),
    "UNPLANNED_VIEW",
  );
  const baselineSnapshot = JSON.stringify(baseline);
  const decisions = plan.targets.map((target) =>
    proposal(
      baseline,
      target,
      views.filter((view) => view.targetId === target.id),
    ),
  );
  for (let i = 0; i < decisions.length; i++) {
    for (let j = i + 1; j < decisions.length; j++) {
      const left = decisions[i],
        right = decisions[j],
        a = plan.targets[i],
        b = plan.targets[j];
      if (
        overlaps(a, b) ||
        a.baselineIds.some((id) => b.baselineIds.includes(id)) ||
        left.after.some((record) =>
          right.after.some((other) =>
            overlaps(interval(record), interval(other)),
          ),
        )
      ) {
        for (const decision of [left, right]) {
          decision.reasons.push("MULTI_TARGET_CONFLICT");
          decision.status = "ABSTAINED";
        }
      }
    }
  }
  const changes = [];
  for (const decision of decisions) {
    if (decision.status !== "PROPOSED") continue;
    decision.status = "APPLIED_TO_CANDIDATE";
    changes.push({
      targetId: decision.targetId,
      action: decision.action,
      before: decision.before,
      after: decision.after,
    });
  }
  const replaced = new Set(
    changes.flatMap((change) => change.before.map((record) => record.recordId)),
  );
  const records = [
    ...baseline.filter((record) => !replaced.has(record.recordId)),
    ...changes.flatMap((change) => change.after),
  ].sort((a, b) => a.sourceStart - b.sourceStart);
  requireValue(
    JSON.stringify(baseline) === baselineSnapshot,
    "BASELINE_MUTATED",
  );
  return {
    policy: correctionPolicy,
    records,
    decisions,
    changes,
    status: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
  };
}
