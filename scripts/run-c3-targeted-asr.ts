/**
 * Backward-compatible entry point retained for existing npm commands.
 *
 * C3 used two literal time windows. C4 deliberately removes those literals:
 * every targeted interval is now read from coverage-recovery-plan.json and is
 * produced by buildCoverageRecoveryPlan().
 */
console.warn(
  "targeted:c3-large-v3 is deprecated; executing the plan-driven C4 coverage-recovery worker.",
);

await import("./run-c4-coverage-recovery-asr.js");
