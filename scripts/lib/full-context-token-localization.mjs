/** Diagnostic consumer only: token timestamps are not acoustic boundary proof. */
import assert from "node:assert/strict";

const interval = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a < b;
const overlaps = (a, b, c, d) => Math.max(a, c) < Math.min(b, d);

export function localizeStoredContext(audit, probes) {
  assert.equal(audit.referenceUsed, false, "REFERENCE_INPUT_NOT_ALLOWED");
  assert.match(audit.binding.sourceHash, /^[a-f0-9]{64}$/u);
  assert.equal(new Set(probes.map((p) => p.id)).size, probes.length);
  return probes.map((probe) => {
    assert(
      interval(probe.start, probe.end) &&
        interval(probe.targetStart, probe.targetEnd) &&
        probe.targetStart >= probe.start &&
        probe.targetEnd <= probe.end,
      "INVALID_SOURCE_INTERVAL",
    );
    const context = [];
    for (const request of audit.requests) {
      for (const row of request.rows) {
        if (!overlaps(row.sourceStart, row.sourceEnd, probe.start, probe.end))
          continue;
        assert.equal(row.requestId, request.requestId, "REQUEST_MISMATCH");
        assert.equal(row.provenance.validated, true, "UNBOUND_ROW");
        assert.equal(row.provenance.timebase, "source-global", "TIMEBASE");
        for (const key of ["sourceHash", "modelHash", "runtimeHash"])
          assert.equal(
            row.provenance[key],
            audit.binding[key],
            `BINDING:${key}`,
          );
        const lexical = row.tokens.filter((t) => t.text.trim());
        const formatting = row.tokens.filter((t) => !t.text.trim());
        // This exception removes ONLY whitespace zero-duration warnings, not
        // lexical zero durations, clock/order problems, or parent text mismatch.
        const whitespaceOnlyZero =
          lexical.every((t) => t.issues.length === 0) &&
          formatting.some((t) => t.issues.includes("ZERO_DURATION"));
        const blockingIssues = [
          ...request.requestIssues,
          ...row.issues.filter(
            (i) => !(i === "ZERO_DURATION" && whitespaceOnlyZero),
          ),
        ];
        if (
          row.tokens
            .map((t) => t.text)
            .join("")
            .trim() !== row.text.trim()
        )
          blockingIssues.push("TOKEN_TEXT_MISMATCH");
        const tokens = lexical.map((t) => {
          const usable =
            blockingIssues.length === 0 &&
            t.issues.length === 0 &&
            interval(t.sourceStart, t.sourceEnd) &&
            t.sourceStart >= row.sourceStart &&
            t.sourceEnd <= row.sourceEnd;
          return {
            ...t,
            structurallyUsable: usable,
            relation: !usable
              ? "invalid-timing"
              : overlaps(
                    t.sourceStart,
                    t.sourceEnd,
                    probe.targetStart,
                    probe.targetEnd,
                  )
                ? "heuristic-overlap"
                : t.sourceEnd <= probe.targetStart
                  ? "before-target"
                  : "after-target",
            acousticBoundaryVerified: false,
          };
        });
        context.push({
          requestId: row.requestId,
          recordId: row.recordId,
          fullText: row.text,
          sourceStart: row.sourceStart,
          sourceEnd: row.sourceEnd,
          provenance: row.provenance,
          originalIssues: row.issues,
          blockingIssues,
          formattingTokens: formatting,
          lexicalTokens: tokens,
          whitespaceOnlyZeroSeparated: whitespaceOnlyZero,
          // Full parent text and all tokens retained; no time interpolation,
          // first-match occurrence selection, or cross-request deduplication.
          canAutoRetime: false,
        });
      }
    }
    return {
      probe,
      context,
      diagnostic: context.some((r) =>
        r.lexicalTokens.some((t) => t.relation === "heuristic-overlap"),
      )
        ? "UNVERIFIED_TOKEN_OVERLAP"
        : "NO_USABLE_TOKEN_OVERLAP",
      confirmsMissingSpeech: false,
      canInsertSubtitle: false,
      canAutoRetime: false,
      proposedRepair: null,
    };
  });
}
