import { describe, expect, it } from "vitest";

import { assessBaselinePreservation } from "@mvl/video-subtitler";

import { C60_TEST_HASH } from "./helpers/c6-0-protected-fixture.js";

const valid = {
  generatedAt: "2026-08-27T00:00:00.000Z",
  canonicalCueHashBefore: C60_TEST_HASH.cue,
  canonicalCueHashAfter: C60_TEST_HASH.cue,
  canonicalTimingHashBefore: C60_TEST_HASH.timing,
  canonicalTimingHashAfter: C60_TEST_HASH.timing,
  canonicalTextMutationCount: 0,
  canonicalTimingMutationCount: 0,
  humanAuthorityVerified: true,
  sourceReadOnlyVerified: true,
  humanSubtitleReadOnlyVerified: true,
  positiveCurrentOutputDefectEvidenceCount: 0,
  integrityFinalBlockerCount: 0,
  unknownObservedSignalCount: 0,
  freshnessIntegrityPassed: true,
  policyIntegrityPassed: true,
  serializationRoundTripPassed: true,
  formatSemanticParityPassed: true,
  presentationIntegrityPassed: true,
  reviewDeliveryIntegrityPassed: true,
  apply: true,
};

describe("C6.0 human-baseline preservation", () => {
  it("applies only when every authority and integrity check passes", () => {
    expect(assessBaselinePreservation(valid)).toMatchObject({
      eligible: true,
      applied: true,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
    });
  });

  it.each([
    { humanAuthorityVerified: false },
    { positiveCurrentOutputDefectEvidenceCount: 1 },
    { integrityFinalBlockerCount: 1 },
    { unknownObservedSignalCount: 1 },
    { canonicalTextMutationCount: 1 },
    { canonicalTimingMutationCount: 1 },
    { sourceReadOnlyVerified: false },
    { serializationRoundTripPassed: false },
  ])("fails closed for $", (patch) => {
    expect(assessBaselinePreservation({ ...valid, ...patch }).eligible).toBe(
      false,
    );
  });
});
