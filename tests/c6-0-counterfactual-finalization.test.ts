import { describe, expect, it } from "vitest";

import {
  classifyC60Blocker,
  evaluateC60CounterfactualCodes,
} from "../scripts/c6-0-finalization-risk-lib.js";

describe("C6.0 read-only finalization counterfactual", () => {
  it("keeps the current gate but permits only positive-risk Scenario E", () => {
    const codes = [
      "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
      "ILLEGAL_SUBTITLE_OVERLAP",
    ];
    const ontology = new Map(
      codes.map((code) => [code, { code, ...classifyC60Blocker(code, true) }]),
    );
    expect(evaluateC60CounterfactualCodes(codes, ontology, "A")).toEqual(codes);
    expect(evaluateC60CounterfactualCodes(codes, ontology, "D")).toEqual(codes);
    expect(evaluateC60CounterfactualCodes(codes, ontology, "E")).toEqual([]);
  });

  it("never removes unknown or positive integrity failures", () => {
    const codes = ["UNKNOWN_NEW_GATE", "INVALID_CUE_TIMING"];
    const ontology = new Map(
      codes.map((code) => [code, { code, ...classifyC60Blocker(code, true) }]),
    );
    expect(evaluateC60CounterfactualCodes(codes, ontology, "E")).toEqual(codes);
  });
});
