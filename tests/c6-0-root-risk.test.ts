import { describe, expect, it } from "vitest";

import { buildFinalizationRootRisks } from "@mvl/video-subtitler";

describe("C6.0 root-risk deduplication", () => {
  it("groups derived and meta findings without weakening the strongest risk", () => {
    const roots = buildFinalizationRootRisks({
      signals: [
        {
          signalId: "signal-1",
          code: "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
          occurrenceCount: 7,
          policyMatched: true,
          rootRiskFamily: "safe-repair-not-established",
          blockingScope: "evidence-availability",
          evidencePolarity: "absence-of-support",
          originalDisposition: "CONTEXT_DEPENDENT",
          effectiveDisposition: "MUTATION_GUARD",
          currentOutputRisk: "UNKNOWN",
          proposedMutationRisk: "HIGH",
          finalBlocking: false,
          reasonCodes: ["SAFE_REPAIR_NOT_ESTABLISHED"],
        },
        {
          signalId: "signal-2",
          code: "CUE_ALIGNMENT_GATE_FAILED",
          occurrenceCount: 2,
          policyMatched: true,
          rootRiskFamily: "safe-repair-not-established",
          blockingScope: "automatic-mutation-safety",
          evidencePolarity: "absence-of-support",
          originalDisposition: "MUTATION_GUARD",
          effectiveDisposition: "MUTATION_GUARD",
          currentOutputRisk: "NO_POSITIVE_DEFECT_EVIDENCE",
          proposedMutationRisk: "HIGH",
          finalBlocking: false,
          reasonCodes: ["MUTATION_NOT_PROVEN_SAFE"],
        },
      ],
      findings: [
        {
          findingId: "finding-meta",
          severity: "blocking",
          code: "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
          cueIds: ["cue-1", "cue-2"],
          message: "meta",
        },
      ],
    });
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      effectiveDisposition: "MUTATION_GUARD",
      metaFindingIds: ["finding-meta"],
    });
  });
});
