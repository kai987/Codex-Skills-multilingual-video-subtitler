import { describe, expect, it } from "vitest";

import { isC60GraphAcyclic } from "../scripts/c6-0-finalization-risk-lib.js";

describe("C6.0 root-cause graph", () => {
  it("accepts family-to-code-to-evidence DAGs", () => {
    expect(
      isC60GraphAcyclic(
        ["family", "code", "evidence"],
        [
          { from: "family", to: "code" },
          { from: "code", to: "evidence" },
        ],
      ),
    ).toBe(true);
  });

  it("rejects cycles and dangling edges", () => {
    expect(
      isC60GraphAcyclic(
        ["family", "code"],
        [
          { from: "family", to: "code" },
          { from: "code", to: "family" },
        ],
      ),
    ).toBe(false);
    expect(
      isC60GraphAcyclic(["family"], [{ from: "family", to: "missing" }]),
    ).toBe(false);
  });
});
