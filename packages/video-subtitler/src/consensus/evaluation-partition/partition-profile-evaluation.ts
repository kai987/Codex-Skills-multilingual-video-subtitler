import {
  c61211ProfileSchema,
  c61211ProfileEvidenceSchema,
  type C61211Map,
  type C61211Profile,
  type C612Label,
  type C612Ranking,
  type C612GroupDecision,
} from "@mvl/shared";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import type { C612EvaluationCue } from "../top-k/fixed-group-evaluation.js";
import { evaluateC6121Profiles } from "../evaluation-recovery/c6121-profile-evaluation.js";
import { c61211Artifact, C61211_ROUTE_POLICY } from "./c61211-policy.js";
import { scoringC61211Adapter } from "./scoring-adapter.js";
export function profileC61211Checks(p: C61211Profile) {
  const g = C61211_ROUTE_POLICY.safeProfile;
  const values = [
    ["selected>0", p.selectedCount, p.selectedCount >= g.minimumSelected, ">0"],
    [
      "evaluableChangedBlocks",
      p.evaluableChangedBlocks,
      p.evaluableChangedBlocks >= g.minimumEvaluableChanges,
      ">=5",
    ],
    [
      "activeFolds",
      p.activeFoldCount,
      p.activeFoldCount >= g.minimumActiveFolds,
      ">=3",
    ],
    [
      "negativeFolds",
      p.negativeGainFoldCount,
      p.negativeGainFoldCount === 0,
      "0",
    ],
    ["unknownFolds", p.unknownGainFoldCount, p.unknownGainFoldCount === 0, "0"],
    [
      "changedBlockCoverage",
      p.changedBlockCoverage.ratio,
      (p.changedBlockCoverage.ratio ?? -1) >= g.minimumChangedCoverage,
      ">=0.80",
    ],
    [
      "changedMachineCoverage",
      p.changedMachineGroupCoverage.ratio,
      (p.changedMachineGroupCoverage.ratio ?? -1) >= g.minimumChangedCoverage,
      ">=0.80",
    ],
    [
      "precision",
      p.selectionPrecision,
      (p.selectionPrecision ?? -1) >= g.minimumPrecision,
      ">=0.85",
    ],
    [
      "harm",
      p.harmRate,
      p.harmRate !== null && p.harmRate <= g.maximumHarmRate,
      "<=0.10",
    ],
    [
      "normalizedJointGain",
      p.normalizedJointGain,
      p.normalizedJointGain !== null && p.normalizedJointGain > 0,
      ">0",
    ],
    [
      "materialDelta",
      p.materialDelta,
      p.materialDelta !== null && p.materialDelta <= 0,
      "<=0",
    ],
    [
      "catastrophic",
      p.catastrophicDeletionCount,
      p.catastrophicDeletionCount === 0,
      "0",
    ],
  ] as const;
  return values.map(([name, observed, passed, expected]) => ({
    name,
    observed: String(observed),
    passed,
    expected,
  }));
}
export function evaluateC61211Profiles(input: {
  frozen: C612FrozenInputs;
  map: C61211Map;
  gold: readonly C612EvaluationCue[];
  labels: readonly C612Label[];
  rankings: readonly C612Ranking[];
  decisions: readonly C612GroupDecision[];
  track: C61211Profile["track"];
}) {
  const adapter = scoringC61211Adapter(input.map);
  return evaluateC6121Profiles({ ...input, map: adapter }).map((old) => {
    const {
      supergroupMapHash,
      changedSupergroups,
      evaluableChangedSupergroups,
      changedSupergroupCoverage,
      zeroSelectionChangedCoverage,
      groups,
      ...rest
    } = old;
    void supergroupMapHash;
    void zeroSelectionChangedCoverage;
    const selectedCount = input.decisions
      .filter((d) => d.profileId === old.profileId)
      .reduce((n, d) => n + d.selections.length, 0);
    const profile = c61211ProfileSchema.parse({
      ...rest,
      partitionMapHash: input.map.semanticHash,
      selectedCount,
      changedBlocks: changedSupergroups,
      evaluableChangedBlocks: evaluableChangedSupergroups,
      changedBlockCoverage: changedSupergroupCoverage,
      groups: groups.map(({ supergroupId, ...g }) => ({
        ...g,
        partitionBlockId: supergroupId,
      })),
      safeProfileEligible: false,
    });
    // Statistical eligibility only. Global engineering/parity gates are checked
    // separately by the terminal route; this never authorizes production.
    profile.safeProfileEligible = profileC61211Checks(profile).every(
      (c) => c.passed,
    );
    return profile;
  });
}
export function evidenceC61211Profiles(
  map: C61211Map,
  profiles: readonly C61211Profile[],
) {
  return c61211ProfileEvidenceSchema.parse(
    c61211Artifact("c6-1-2-1-1-profile-evidence-coverage", {
      partitionMapHash: map.semanticHash,
      rows: profiles.map((p) => ({
        profileId: p.profileId,
        track: p.track,
        selectedCount: p.selectedCount,
        changedBlockCoverage: p.changedBlockCoverage,
        changedMachineGroupCoverage: p.changedMachineGroupCoverage,
        selectionPrecision: p.selectionPrecision,
        harmRate: p.harmRate,
        passed:
          p.selectedCount > 0 &&
          (p.changedBlockCoverage.ratio ?? -1) >= 0.8 &&
          (p.changedMachineGroupCoverage.ratio ?? -1) >= 0.8,
        safeProfileEligible: p.safeProfileEligible,
      })),
      evaluatorGateInput: false,
    }),
  );
}
