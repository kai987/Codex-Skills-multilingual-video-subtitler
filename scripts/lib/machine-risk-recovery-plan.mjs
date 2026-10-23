/** Pure risk localization and budgeting. It neither executes nor repairs anything. */
import { createHash } from "node:crypto";

export const machineRiskRecoveryPolicy = Object.freeze({
  version: "machine-risk-recovery-plan-v1",
  defaultMaxRequests: 8,
  defaultMaxAudioSeconds: 240,
  maximumWindowSeconds: 30,
  contextSeconds: 0,
  maximumPlannedWindows: 10000,
  exactRepeatHighPriorityMinimumCues: 6,
  exactRepeatHighPriorityMinimumCharacters: 8,
  windowPartition: "balanced-near-equal-source-crops; no cue changes",
  priorityOrder:
    "risk-class; incomplete-evidence-first; risk-code-count; record-count; source-time",
  regionMerge:
    "same-issue-envelope-including-inter-cue-gaps; overlapping-or-touching-union",
  pointLocalization: "valid-stored-start-only; no invented cue interval",
  evidenceMeaning: "coverage-only; existing evidence is not repair or approval",
});

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const object = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const fail = (message) => {
  throw Error(`MACHINE_RISK_PLAN_${message}`);
};
function keys(value, allowed, label) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail(`INVALID_${label}`);
}
// Tagged numbers preserve invalid original metadata instead of conflating NaN
// with null. Object key ordering never changes an identity.
function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "number")
    return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!object(value)) fail("UNHASHABLE_INPUT");
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}
const hash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const sorted = (values) => [...new Set(values)].sort();
const recordIdentity = (r, i) =>
  r.id === undefined ? `cue-index-${i}` : String(r.id);
function jsonValue(value) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && finite(value)) return;
  if (Array.isArray(value)) {
    value.forEach(jsonValue);
    return;
  }
  if (object(value)) {
    Object.values(value).forEach(jsonValue);
    return;
  }
  fail("INVALID_JSON_BINDING");
}
function fraction(value) {
  const [mantissa, exp = "0"] = String(value).split(/e/iu);
  const [whole, decimal = ""] = mantissa.split(".");
  const scale = decimal.length - Number(exp);
  const n = BigInt(whole + decimal);
  return scale >= 0
    ? { n, d: 10n ** BigInt(scale) }
    : { n: n * 10n ** BigInt(-scale), d: 1n };
}
function reduced(n, d) {
  let a = n < 0n ? -n : n,
    b = d;
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return { n: n / a, d: d / a };
}
const add = (a, b) => reduced(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a, b) => reduced(a.n * b.d - b.n * a.d, a.d * b.d);
const number = (v) => {
  if (Number.isFinite(Number(v.n)) && Number.isFinite(Number(v.d)))
    return Number(v.n) / Number(v.d);
  const n = (v.n < 0n ? -v.n : v.n).toString(),
    d = v.d.toString();
  return (
    (v.n < 0n ? -1 : 1) *
    (Number(n.slice(0, 16)) / Number(d.slice(0, 16))) *
    10 **
      (n.length - Math.min(n.length, 16) - d.length + Math.min(d.length, 16))
  );
};
const duration = (s, e) => subtract(fraction(e), fraction(s));
const seconds = (s, e) => number(duration(s, e));
const exceeds = (a, b) => a.n * b.d > b.n * a.d;
function nextDown(value) {
  const buffer = new ArrayBuffer(8),
    view = new DataView(buffer);
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}
function roundDown(exact) {
  const candidate = number(exact);
  return exceeds(fraction(candidate), exact) ? nextDown(candidate) : candidate;
}
function coverage(intervals, start, end) {
  let total = { n: 0n, d: 1n },
    last = start;
  for (const [a, b] of intervals
    .map(([s, e]) => [Math.max(s, start), Math.min(e, end)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (b > last) total = add(total, duration(Math.max(a, last), b));
    last = Math.max(last, b);
  }
  return number(total);
}
const priorityFor = (codes, issues) =>
  Math.min(
    ...codes.map((code) => {
      if (
        [
          "NEIGHBORING_SHARED_SUBSTRING",
          "CROSS_CUE_PHRASE_REPETITION",
        ].includes(code)
      )
        return 0;
      if (code === "NEIGHBORING_EXACT_REPETITION")
        return issues.some(
          (issue) =>
            issue.code === code &&
            (issue.cueIndexes.length >=
              machineRiskRecoveryPolicy.exactRepeatHighPriorityMinimumCues ||
              Array.from(issue.evidence?.normalizedText ?? "").length >=
                machineRiskRecoveryPolicy.exactRepeatHighPriorityMinimumCharacters),
        )
          ? 0
          : 3;
      if (code === "INVALID_TIME") return 1;
      if (code === "INTRA_CUE_REPETITION") return 2;
      if (code === "LONG_SPAN_WEAK_BOUNDARY") return 4;
      return 3;
    }),
  );

export function buildMachineRiskRecoveryPlan(input) {
  keys(
    input,
    ["records", "audit", "sourceEnd", "binding", "budget", "evidenceWindows"],
    "INPUT",
  );
  const { records, audit, sourceEnd, binding } = input;
  if (!finite(sourceEnd) || sourceEnd <= 0) fail("INVALID_SOURCE_END");
  if (!object(binding)) fail("INVALID_BINDING");
  jsonValue(binding);
  if (!Array.isArray(records)) fail("INVALID_RECORDS");
  const identities = new Set();
  records.forEach((r, i) => {
    if (
      !object(r) ||
      typeof r.text !== "string" ||
      (r.id !== undefined &&
        typeof r.id !== "string" &&
        !Number.isSafeInteger(r.id)) ||
      (r.index !== undefined && (!Number.isSafeInteger(r.index) || r.index < 0))
    )
      fail("INVALID_RECORD");
    const id = recordIdentity(r, i);
    if (!id || identities.has(id)) fail("DUPLICATE_RECORD_ID");
    identities.add(id);
    canonical(r);
  });
  if (
    !object(audit) ||
    audit.version !== "machine-content-audit-v1" ||
    !Array.isArray(audit.issues) ||
    !object(audit.summary) ||
    audit.summary.recordCount !== records.length ||
    !object(audit.policy) ||
    (audit.policy.sourceEnd != null && audit.policy.sourceEnd !== sourceEnd)
  )
    fail("INVALID_AUDIT");
  jsonValue(audit);
  const budget = {
    maxRequests: machineRiskRecoveryPolicy.defaultMaxRequests,
    maxAudioSeconds: machineRiskRecoveryPolicy.defaultMaxAudioSeconds,
    maxWindowSeconds: machineRiskRecoveryPolicy.maximumWindowSeconds,
    ...(input.budget === undefined ? {} : input.budget),
  };
  keys(
    input.budget === undefined ? {} : input.budget,
    ["maxRequests", "maxAudioSeconds", "maxWindowSeconds"],
    "BUDGET",
  );
  if (
    !Number.isSafeInteger(budget.maxRequests) ||
    budget.maxRequests < 0 ||
    !finite(budget.maxAudioSeconds) ||
    budget.maxAudioSeconds < 0 ||
    !finite(budget.maxWindowSeconds) ||
    budget.maxWindowSeconds <= 0 ||
    budget.maxWindowSeconds > 30
  )
    fail("INVALID_BUDGET");
  const evidenceWindows =
    input.evidenceWindows === undefined ? [] : input.evidenceWindows;
  if (!Array.isArray(evidenceWindows)) fail("INVALID_EVIDENCE");
  const evidenceIds = new Set();
  for (const e of evidenceWindows) {
    keys(e, ["id", "start", "end", "candidateStatus"], "EVIDENCE");
    if (
      typeof e.id !== "string" ||
      !e.id ||
      evidenceIds.has(e.id) ||
      !finite(e.start) ||
      !finite(e.end) ||
      e.start < 0 ||
      e.end <= e.start ||
      e.end > sourceEnd ||
      !["unverified", "still-risky", "reviewed"].includes(e.candidateStatus)
    )
      fail("INVALID_EVIDENCE");
    evidenceIds.add(e.id);
  }
  const issuesSeen = new Set(),
    risks = new Map();
  for (const issue of audit.issues) {
    if (
      !object(issue) ||
      typeof issue.id !== "string" ||
      !issue.id ||
      issuesSeen.has(issue.id) ||
      typeof issue.code !== "string" ||
      !/^[A-Z][A-Z0-9_]*$/u.test(issue.code) ||
      !Array.isArray(issue.cueIndexes) ||
      !issue.cueIndexes.length ||
      new Set(issue.cueIndexes).size !== issue.cueIndexes.length ||
      !Array.isArray(issue.cues) ||
      issue.cues.length !== issue.cueIndexes.length
    )
      fail("INVALID_ISSUE");
    issuesSeen.add(issue.id);
    issue.cueIndexes.forEach((i, position) => {
      if (!Number.isSafeInteger(i) || i < 0 || i >= records.length)
        fail("INVALID_CUE_INDEX");
      const r = records[i],
        c = issue.cues[position];
      if (
        !object(c) ||
        c.cueIndex !== i ||
        c.id !== (r.id ?? null) ||
        c.recordIndex !== (r.index ?? null) ||
        c.start !== (finite(r.start) ? r.start : null) ||
        c.end !== (finite(r.end) ? r.end : null)
      )
        fail("AUDIT_RECORD_MISMATCH");
      const risk = risks.get(i) ?? {
        cueIndex: i,
        recordId: recordIdentity(r, i),
        riskCodes: [],
        issueIds: [],
      };
      risk.riskCodes.push(issue.code);
      risk.issueIds.push(issue.id);
      risks.set(i, risk);
    });
  }
  const intervals = [],
    points = [],
    unlocatable = [];
  for (const risk of risks.values()) {
    risk.riskCodes = sorted(risk.riskCodes);
    risk.issueIds = sorted(risk.issueIds);
    const r = records[risk.cueIndex];
    if (
      finite(r.start) &&
      finite(r.end) &&
      r.start >= 0 &&
      r.end > r.start &&
      r.end <= sourceEnd
    )
      intervals.push({ start: r.start, end: r.end, risks: [risk] });
    else if (finite(r.start) && r.start >= 0 && r.start <= sourceEnd)
      points.push({ start: r.start, end: r.start, risks: [risk] });
    else unlocatable.push({ ...risk, reason: "NO_VALID_STORED_SOURCE_START" });
  }
  // A multi-cue warning explicitly links its own records. Its request envelope
  // includes intervening gaps, without pretending those gaps contain speech.
  // Identical text in separate, unrelated warnings never creates such an edge.
  for (const issue of audit.issues) {
    const linked = issue.cueIndexes
      .map((i) =>
        intervals.find((r) => r.risks.some((risk) => risk.cueIndex === i)),
      )
      .filter(Boolean);
    if (linked.length > 1)
      intervals.push({
        start: Math.min(...linked.map((r) => r.start)),
        end: Math.max(...linked.map((r) => r.end)),
        risks: linked.flatMap((r) => r.risks),
      });
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const grouped = [];
  for (const interval of intervals) {
    const previous = grouped.at(-1);
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
      previous.risks.push(...interval.risks);
    } else grouped.push({ ...interval, risks: [...interval.risks] });
  }
  for (const point of points.sort((a, b) => a.start - b.start)) {
    const prior = grouped.find(
      (r) => point.start >= r.start && point.start <= r.end,
    );
    if (prior) prior.risks.push(...point.risks);
    else grouped.push({ ...point, risks: [...point.risks] });
  }
  const hashes = {
    records: hash(records),
    audit: hash(audit),
    binding: hash(binding),
    policy: hash(machineRiskRecoveryPolicy),
  };
  const regions = grouped
    .map((r) => {
      const cueIndexes = [...new Set(r.risks.map((x) => x.cueIndex))].sort(
        (a, b) => a - b,
      );
      const riskCodes = sorted(r.risks.flatMap((x) => x.riskCodes));
      const issueIds = sorted(r.risks.flatMap((x) => x.issueIds));
      const row = {
        kind: r.end > r.start ? "interval" : "point",
        start: r.start,
        end: r.end,
        cueIndexes,
        recordIds: cueIndexes.map((i) => recordIdentity(records[i], i)),
        riskCodes,
        issueIds,
        priority: priorityFor(
          riskCodes,
          audit.issues.filter((issue) => issueIds.includes(issue.id)),
        ),
      };
      const applicable = evidenceWindows.filter((e) =>
        row.kind === "point"
          ? e.start <= row.start && e.end > row.start
          : e.start < row.end && e.end > row.start,
      );
      const evidenceCoverageSeconds = coverage(
        applicable.map((e) => [e.start, e.end]),
        row.start,
        row.end,
      );
      const evidenceUncoveredSeconds = Math.max(
        0,
        number(
          subtract(
            duration(row.start, row.end),
            fraction(evidenceCoverageSeconds),
          ),
        ),
      );
      return {
        id: `risk-region-${hash({ binding: hashes.binding, ...row }).slice(0, 24)}`,
        ...row,
        evidenceIds: applicable.map((e) => e.id).sort(),
        evidenceStatuses: sorted(applicable.map((e) => e.candidateStatus)),
        evidenceCoverageSeconds,
        evidenceUncoveredSeconds,
        evidenceCoverage:
          row.kind === "point"
            ? "not-applicable"
            : !evidenceCoverageSeconds
              ? "none"
              : evidenceUncoveredSeconds
                ? "partial"
                : "full",
      };
    })
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Number(a.evidenceCoverage === "full") -
          Number(b.evidenceCoverage === "full") ||
        b.riskCodes.length - a.riskCodes.length ||
        b.recordIds.length - a.recordIds.length ||
        a.start - b.start ||
        a.end - b.end ||
        a.id.localeCompare(b.id),
    );
  const windows = [];
  let used = { n: 0n, d: 1n },
    selectedCount = 0;
  for (const r of regions) {
    const span = duration(r.start, r.end),
      maximum = fraction(budget.maxWindowSeconds);
    const numerator = span.n * maximum.d,
      denominator = span.d * maximum.n;
    const count = Number((numerator + denominator - 1n) / denominator);
    if (
      count >
      machineRiskRecoveryPolicy.maximumPlannedWindows - windows.length
    )
      fail("TOO_MANY_WINDOWS");
    let start = r.start;
    for (let part = 1; part <= count; part++) {
      const exact = add(fraction(r.start), {
        n: span.n * BigInt(part),
        d: span.d * BigInt(count),
      });
      const end = part === count ? r.end : roundDown(exact);
      if (end <= start || exceeds(duration(start, end), maximum))
        fail("UNREPRESENTABLE_WINDOW");
      const cost = duration(start, end),
        next = add(used, cost);
      const requestExceeded = selectedCount >= budget.maxRequests,
        timeExceeded = exceeds(next, fraction(budget.maxAudioSeconds));
      const selected = !requestExceeded && !timeExceeded;
      if (selected) {
        used = next;
        selectedCount++;
      }
      const row = {
        regionId: r.id,
        start,
        end,
        seconds: number(cost),
        status: selected ? "selected" : "deferred-budget",
        reason: selected
          ? "PLAN_ONLY_NOT_EXECUTION_AUTHORITY"
          : requestExceeded
            ? "REQUEST_BUDGET"
            : "AUDIO_SECONDS_BUDGET",
      };
      windows.push({
        id: `risk-window-${hash({ regionId: r.id, start, end }).slice(0, 24)}`,
        ...row,
      });
      start = end;
    }
    const selected = windows.filter(
      (w) => w.regionId === r.id && w.status === "selected",
    );
    const total = seconds(r.start, r.end);
    r.selectedCoverageSeconds = coverage(
      selected.map((w) => [w.start, w.end]),
      r.start,
      r.end,
    );
    r.uncoveredSeconds = Math.max(
      0,
      number(subtract(fraction(total), fraction(r.selectedCoverageSeconds))),
    );
    r.selectionCoverage =
      r.kind === "point"
        ? "not-applicable"
        : !r.selectedCoverageSeconds
          ? "none"
          : r.uncoveredSeconds
            ? "partial"
            : "full";
    r.status =
      r.kind === "point"
        ? "locatable-point"
        : r.selectionCoverage === "full"
          ? "selected"
          : r.selectionCoverage === "partial"
            ? "partial"
            : "deferred-budget";
    r.repairStatus = "NOT_REPAIRED_BY_PLAN";
  }
  const sum = (key) =>
    number(
      regions.reduce((total, r) => add(total, fraction(r[key])), {
        n: 0n,
        d: 1n,
      }),
    );
  const result = {
    version: machineRiskRecoveryPolicy.version,
    policy: machineRiskRecoveryPolicy,
    budget,
    hashes,
    inputHash: hash({
      records,
      audit,
      sourceEnd,
      binding,
      budget,
      evidenceWindows,
    }),
    sourceEnd,
    binding: globalThis.structuredClone(binding),
    evidenceWindows: globalThis.structuredClone(evidenceWindows),
    status: "needs-review",
    referenceUsed: false,
    newASRRequests: 0,
    automaticDispatch: false,
    retainOriginal: true,
    textMutations: 0,
    timingMutations: 0,
    machineOnlyReleaseAuthorized: false,
    regions,
    windows,
    unlocatable: unlocatable.sort((a, b) => a.cueIndex - b.cueIndex),
    summary: {
      riskRegionCount: regions.length,
      intervalRegionCount: regions.filter((r) => r.kind === "interval").length,
      pointRegionCount: regions.filter((r) => r.kind === "point").length,
      unlocatableRecordCount: unlocatable.length,
      riskyRecordCount: risks.size,
      totalRiskSeconds: number(
        regions.reduce((total, r) => add(total, duration(r.start, r.end)), {
          n: 0n,
          d: 1n,
        }),
      ),
      plannedWindowCount: windows.length,
      selectedRequestCount: selectedCount,
      selectedAudioSeconds: number(used),
      deferredWindowCount: windows.length - selectedCount,
      selectedCoverageSeconds: sum("selectedCoverageSeconds"),
      uncoveredSeconds: sum("uncoveredSeconds"),
      evidenceCoverageSeconds: sum("evidenceCoverageSeconds"),
      evidenceUncoveredSeconds: sum("evidenceUncoveredSeconds"),
    },
  };
  return { ...result, planHash: hash(result) };
}
