import { unionSamples, gates } from "./content-review-plan.mjs";
import { z } from "zod";
export const criteria = [
  "missingSpeech",
  "unsupportedOutput",
  "unnecessaryRepetition",
  "seamCorrespondence",
];
export const issueValues = [
  "NOT_CHECKED",
  "NO_ISSUE_OBSERVED",
  "ISSUE_OBSERVED",
  "UNJUDGEABLE",
];
export const statuses = [
  "NOT_PERFORMED",
  "IN_PROGRESS",
  "REVIEWED",
  "UNJUDGEABLE",
];
export const columns = [
  "reviewId",
  "bundleIdentity",
  "status",
  "reviewer",
  "reviewedAt",
  "actuallyListened",
  "listenedStart",
  "listenedEnd",
  ...["A", "B"].flatMap((s) => criteria.map((c) => `${s}_${c}`)),
  "overall",
  "notes",
];
export const referenceSchema = "paired-human-declaration-reference-v2";
export const exitContract = "invalid-1-complete-0-pending-2-v2";
export const referenceUses = [
  "NOT_DECLARED",
  "NOT_VIEWED",
  "VIEWED",
  "UNKNOWN",
];
export const overallValues = ["A", "B", "EQUAL", "UNJUDGEABLE"];
export const schemaColumns = (schema) =>
  schema === referenceSchema ? [...columns, "referenceUse"] : columns;
export function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false,
    atStart = true;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const field = () => {
    row.push(cell);
    cell = "";
    closed = false;
    atStart = true;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"') {
      if (!atStart || closed) throw Error("CSV_UNEXPECTED_QUOTE");
      quoted = true;
      atStart = false;
      continue;
    }
    if (c === ",") {
      field();
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      field();
      rows.push(row);
      row = [];
      continue;
    }
    if (closed) throw Error("CSV_AFTER_QUOTE");
    cell += c;
    atStart = false;
  }
  if (quoted) throw Error("CSV_UNCLOSED_QUOTE");
  if (row.length || cell || closed) {
    field();
    rows.push(row);
  }
  return rows;
}
export const csvCell = (s) => '"' + String(s).replaceAll('"', '""') + '"';
export function template(items, bundleIdentity, schema) {
  const columns = schemaColumns(schema);
  return (
    [
      columns,
      ...items.map((i) =>
        columns.map((k) =>
          k === "reviewId"
            ? i.reviewId
            : k === "bundleIdentity"
              ? bundleIdentity
              : k === "status"
                ? "NOT_PERFORMED"
                : k === "referenceUse"
                  ? "NOT_DECLARED"
                  : /^[AB]_/.test(k)
                    ? "NOT_CHECKED"
                    : "",
        ),
      ),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n") + "\r\n"
  );
}
export function evaluateCsv(text, bundle, items) {
  const columns = schemaColumns(bundle.annotationSchema);
  const withReference = bundle.annotationSchema === referenceSchema;
  const warnings = [],
    fileErrors = [],
    rowErrors = [],
    foreignRows = [];
  let parsed = [];
  try {
    parsed = parseCsv(text);
  } catch (e) {
    fileErrors.push(e.message);
  }
  const headers = parsed.shift() || [];
  if (new Set(headers).size !== headers.length)
    fileErrors.push("DUPLICATE_HEADERS");
  for (const c of columns)
    if (!headers.includes(c)) fileErrors.push("MISSING_COLUMN:" + c);
  for (const c of headers)
    if (!columns.includes(c)) warnings.push("UNKNOWN_COLUMN_PRESERVED:" + c);
  const grouped = new Map();
  for (const [i, values] of parsed.entries()) {
    const row = Object.fromEntries(headers.map((h, j) => [h, values[j] ?? ""]));
    if (!items.some((x) => x.reviewId === row.reviewId)) {
      foreignRows.push({ row: i + 2, reason: "UNKNOWN_REVIEW_ID" });
      continue;
    }
    const group = grouped.get(row.reviewId) || [];
    group.push({ row, number: i + 2, width: values.length });
    grouped.set(row.reviewId, group);
    if (values.some((v) => /^[\s]*[=+@-]/u.test(v)))
      warnings.push(
        `SPREADSHEET_FORMULA_LIKE_TEXT_ROW_${i + 2}: preserved as inert data; do not enable formulas`,
      );
  }
  const valid = new Map();
  for (const item of items) {
    const g = grouped.get(item.reviewId) || [],
      errors = [...fileErrors];
    if (g.length !== 1)
      errors.push(g.length ? "DUPLICATE_REVIEW_ID" : "MISSING_ROW");
    const r = g[0]?.row;
    if (r) {
      if (g[0].width !== headers.length) errors.push("COLUMN_COUNT");
      if (r.bundleIdentity !== bundle.identity) errors.push("FOREIGN_BUNDLE");
      if (!statuses.includes(r.status)) errors.push("UNKNOWN_STATUS");
      if (r.actuallyListened && !["TRUE", "FALSE"].includes(r.actuallyListened))
        errors.push("INVALID_LISTENING_DECLARATION");
      for (const side of ["A", "B"])
        for (const c of criteria)
          if (!issueValues.includes(r[side + "_" + c]))
            errors.push("INVALID_ISSUE_ENUM:" + side + "_" + c);
      if (r.overall && !overallValues.includes(r.overall))
        errors.push("INVALID_COMPARISON_ENUM");
      if (withReference && !referenceUses.includes(r.referenceUse))
        errors.push("INVALID_REFERENCE_USE");
      if (["REVIEWED", "UNJUDGEABLE"].includes(r.status)) {
        if (withReference && r.referenceUse === "NOT_DECLARED")
          errors.push("REFERENCE_USE_REQUIRED");
        if (r.actuallyListened !== "TRUE")
          errors.push("ACTUAL_LISTENING_NOT_DECLARED");
        if (
          !z.string().datetime({ offset: true }).safeParse(r.reviewedAt)
            .success ||
          !Number.isFinite(Date.parse(r.reviewedAt))
        )
          errors.push("REVIEW_DATETIME_REQUIRED");
        if (!r.notes.trim()) errors.push("NOTES_REQUIRED");
        const s = Number(r.listenedStart),
          e = Number(r.listenedEnd);
        if (
          !r.listenedStart ||
          !r.listenedEnd ||
          !Number.isFinite(s) ||
          !Number.isFinite(e) ||
          s > item.start ||
          e < item.end ||
          s < item.bounds.playbackStart ||
          e > item.bounds.playbackEnd
        )
          errors.push("FULL_EVALUATION_INTERVAL_NOT_DECLARED");
        for (const side of ["A", "B"])
          for (const c of criteria)
            if (r[side + "_" + c] === "NOT_CHECKED")
              errors.push("PAIRED_CRITERION_NOT_CHECKED");
        if (!r.overall) errors.push("COMPARISON_REQUIRED");
        if (r.status === "UNJUDGEABLE" && r.overall !== "UNJUDGEABLE")
          errors.push("UNJUDGEABLE_COMPARISON_REQUIRED");
        if (item.audioStatus !== "READY")
          errors.push("LISTENING_ARTIFACT_NOT_READY");
      }
    }
    if (errors.length)
      rowErrors.push({ reviewId: item.reviewId, errors: [...new Set(errors)] });
    else valid.set(item.reviewId, r);
  }
  const groups = {};
  for (const kind of ["stratified", "seam", "targeted"]) {
    const planned = items.filter((i) => i.kind === kind),
      counts = {
        planned: planned.length,
        notPerformed: 0,
        inProgress: 0,
        reviewed: 0,
        unjudgeable: 0,
        invalidOrMissing: 0,
      };
    const comparison = { denominator: 0, A: 0, B: 0, EQUAL: 0, UNJUDGEABLE: 0 };
    const pairedCriteria = Object.fromEntries(
      criteria.map((c) => [
        c,
        { denominator: 0, A_issues: 0, B_issues: 0, unjudgeableItems: 0 },
      ]),
    );
    const intervals = [],
      judgeable = [];
    const referenceUseCounts = Object.fromEntries(
      referenceUses.map((v) => [v, 0]),
    );
    for (const i of planned) {
      const r = valid.get(i.reviewId);
      if (!r) {
        counts.invalidOrMissing++;
        continue;
      }
      counts[
        {
          NOT_PERFORMED: "notPerformed",
          IN_PROGRESS: "inProgress",
          REVIEWED: "reviewed",
          UNJUDGEABLE: "unjudgeable",
        }[r.status]
      ]++;
      if (withReference) referenceUseCounts[r.referenceUse]++;
      if (["REVIEWED", "UNJUDGEABLE"].includes(r.status)) {
        comparison.denominator++;
        comparison[r.overall]++;
        for (const c of criteria) {
          const v = pairedCriteria[c],
            a = r["A_" + c],
            b = r["B_" + c];
          if (a === "UNJUDGEABLE" || b === "UNJUDGEABLE") v.unjudgeableItems++;
          else {
            v.denominator++;
            v.A_issues += Number(a === "ISSUE_OBSERVED");
            v.B_issues += Number(b === "ISSUE_OBSERVED");
          }
        }
        intervals.push([
          i.bounds.evaluationStartSample,
          i.bounds.evaluationEndSample,
        ]);
        if (
          r.status === "REVIEWED" &&
          r.overall !== "UNJUDGEABLE" &&
          criteria.every((c) =>
            ["A", "B"].every((s) => r[s + "_" + c] !== "UNJUDGEABLE"),
          )
        )
          judgeable.push([
            i.bounds.evaluationStartSample,
            i.bounds.evaluationEndSample,
          ]);
      }
    }
    groups[kind] = {
      counts,
      comparison,
      pairedCriteria,
      reviewedEvaluationSampleUnion: unionSamples(intervals),
      reviewedEvaluationSeconds:
        unionSamples(intervals) / bundle.pcm.sampleRate,
      declaredListenedEvaluationSampleUnion: unionSamples(intervals),
      contentJudgeableEvaluationSampleUnion: unionSamples(judgeable),
      referenceUseCounts: withReference ? referenceUseCounts : null,
    };
  }
  const reviewed = items.filter((i) =>
    ["REVIEWED", "UNJUDGEABLE"].includes(valid.get(i.reviewId)?.status),
  );
  const complete =
    reviewed.length === items.length &&
    !rowErrors.length &&
    !foreignRows.length &&
    !fileErrors.length;
  const inputValid =
    !rowErrors.length && !foreignRows.length && !fileErrors.length;
  const sampleUnion = (predicate) =>
    unionSamples(
      items
        .filter((i) => predicate(valid.get(i.reviewId)))
        .map((i) => [
          i.bounds.evaluationStartSample,
          i.bounds.evaluationEndSample,
        ]),
    );
  return {
    validation: {
      valid: inputValid,
      fileErrors,
      rowErrors,
      foreignRows,
      warnings,
      unknownColumnBytesPreserved: true,
    },
    summary: {
      ...gates,
      annotationProvenance: "HUMAN_DECLARED_NOT_SOFTWARE_VERIFIED",
      contentEvaluationStatus: complete
        ? "HUMAN_DECLARED_EVALUATION_COMPLETE"
        : "AWAITING_HUMAN_REVIEW",
      humanAnnotationFilesRead: 1,
      humanDeclaredReviewedItems: reviewed.length,
      exitCodeContract: exitContract,
      referenceUseIsSelfDeclarationNotBlindProof: withReference,
      declaredListenedEvaluationSampleUnion: sampleUnion(
        (r) => r && ["REVIEWED", "UNJUDGEABLE"].includes(r.status),
      ),
      contentJudgeableEvaluationSampleUnion: sampleUnion(
        (r) =>
          r?.status === "REVIEWED" &&
          r.overall !== "UNJUDGEABLE" &&
          criteria.every((c) =>
            ["A", "B"].every((s) => r[s + "_" + c] !== "UNJUDGEABLE"),
          ),
      ),
      groups,
      reviewedEvaluationSampleUnion: unionSamples(
        reviewed.map((i) => [
          i.bounds.evaluationStartSample,
          i.bounds.evaluationEndSample,
        ]),
      ),
      unitInterpretation:
        "Overlapping review intervals are not independent utterances. Issue counts are not hallucination rates. No CER or release decision.",
      automaticWinner: null,
      releaseAuthorityGranted: false,
    },
    exitCode: !inputValid ? 1 : complete ? 0 : 2,
  };
}
