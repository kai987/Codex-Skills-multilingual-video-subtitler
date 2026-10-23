import { describe, expect, it } from "vitest";

import { classifyC60Blocker } from "../scripts/c6-0-finalization-risk-lib.js";

describe("C6.0 blocker ontology", () => {
  it("separates current-output blockers from mutation guards and diagnostics", () => {
    expect(classifyC60Blocker("INVALID_CUE_TIMING", true)).toMatchObject({
      proposedDisposition: "FINAL_BLOCKER",
      currentOutputRisk: "HIGH",
    });
    expect(classifyC60Blocker("CTC_START_WINDOW_UNSTABLE", true)).toMatchObject(
      {
        proposedDisposition: "MUTATION_GUARD",
        currentOutputRisk: "NONE",
        proposedMutationRisk: "HIGH",
      },
    );
    expect(
      classifyC60Blocker("FORCED_ALIGNMENT_COMPONENT_UNRESOLVED", true),
    ).toMatchObject({ proposedDisposition: "CONTEXT_DEPENDENT" });
    expect(classifyC60Blocker("ILLEGAL_SUBTITLE_OVERLAP", true)).toMatchObject({
      proposedDisposition: "CONTEXT_DEPENDENT",
      evidencePolarity: "format-advisory",
    });
  });

  it("fails closed for an unknown observed code", () => {
    expect(classifyC60Blocker("TOTALLY_NEW_BLOCKER", true)).toMatchObject({
      proposedDisposition: "UNKNOWN",
      currentOutputRisk: "UNKNOWN",
      proposedMutationRisk: "HIGH",
    });
  });
});
