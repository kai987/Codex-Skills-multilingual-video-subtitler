import { describe, expect, it } from "vitest";

import {
  classifyC60Blocker,
  isC60TargetRescued,
} from "../scripts/c6-0-finalization-risk-lib.js";

describe("C6.0 evidence freshness", () => {
  it("supersedes only a later encodable target with no canonical mutation", () => {
    expect(
      isC60TargetRescued({
        beforeEncodable: false,
        afterProjectionEncodable: true,
        canonicalTextChanged: false,
      }),
    ).toBe(true);
    expect(
      isC60TargetRescued({
        beforeEncodable: false,
        afterProjectionEncodable: true,
        canonicalTextChanged: true,
      }),
    ).toBe(false);
    expect(
      classifyC60Blocker("CTC_TARGET_UNREPRESENTABLE", true),
    ).toMatchObject({ proposedDisposition: "SUPERSEDED" });
  });
});
