import { describe, expect, it } from "vitest";
import { fixture145 } from "../fixtures/c601145-fixture.js";
import { runJointFeasibility145 } from "../../packages/video-subtitler/src/review/c601145-joint-feasibility.js";

describe("C6.0.1.14.5 replay-only coverage Unit flow", () => {
  it("runs Unit -> realization -> exact planner -> joint audit -> Safety V5 without Gold", () => {
    const fixture = fixture145(),
      joint = runJointFeasibility145({
        policy: fixture.policy145,
        obligations: fixture.obligations,
        hierarchy: fixture.hierarchy,
        bundles: fixture.bundles,
        dominance: fixture.dominance,
        units: fixture.units145,
        unitUtility: fixture.unitUtility145,
        realizations: fixture.realizations145,
        realizationDominance: fixture.realizationDominance145,
        baselinePlanner: fixture.legacy,
        productionPlanner: fixture.planner145,
        individuallyFeasibleUnselectedHighTierChildCount: 7,
      });
    expect(joint.allRequiredAuditsComplete).toBe(true);
    expect(joint.searchIncompleteCount).toBe(0);
    expect(joint.individuallyFeasibleUnselectedHighTierChildCount).toBe(7);
    expect(joint.individuallyFeasibleChildDiagnosticOnly).toBe(true);
    expect(fixture.planner145.productGoContract).toBe(
      "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
    );
    expect(fixture.safety145.obligationCoverageRatio).toBe(1);
    expect(fixture.safety145.activeTargetCount).toBeLessThanOrEqual(24);
  });
});
