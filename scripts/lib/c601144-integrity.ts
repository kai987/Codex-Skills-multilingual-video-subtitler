import path from "node:path";
import {
  nestedPreflight144Schema,
  type BundleUtility144,
  type ChildUtility144,
  type AtomUtility144,
  type ForcedInclusion144,
  type OptionalChildLedger144,
  type Planner144,
  type PlanComparison144,
  type Propagation144,
  type Projections143,
  type SafetyTargets144,
  type UtilityPolicy144,
  type Workspace143,
  type ReviewTargets144,
  type ReviewItems144,
  type ReviewRegions144,
  type ReviewAudio144,
  type ReviewPlayback144,
  type Hierarchy143,
  type Bundles143,
  type Obligations143,
  type Planner143,
  type Continuity143,
} from "@mvl/shared";
import {
  assertPreGoldIntegrity1431,
  buildProjectionRebindingLedger1431,
  preflightNestedSemanticIntegrity1431,
  type NestedArtifact1431Input,
  type NestedArtifactRowGroup1431,
} from "../../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import {
  assertHash141,
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { safeRelative141 } from "../../packages/video-subtitler/src/review/c601141-io.js";
import { header144 } from "../../packages/video-subtitler/src/review/c601144-policy.js";

function verifyAllNestedHashes144(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  let count = 0;
  if (
    !Array.isArray(value) &&
    typeof (value as { semanticHash?: unknown }).semanticHash === "string"
  ) {
    assertHash141(value as { semanticHash: string });
    count++;
  }
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>))
    count += verifyAllNestedHashes144(child);
  return count;
}

export function preflightUtilityDelivery144(input: {
  root: string;
  policy: UtilityPolicy144;
  projections: Projections143;
  workspace: Workspace143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  obligations: Obligations143;
  compatibilityPlanner: Planner143;
  continuity: Continuity143;
  utility: {
    atoms: AtomUtility144;
    children: ChildUtility144;
    bundles: BundleUtility144;
    propagation: Propagation144;
    forced: ForcedInclusion144;
    optional: OptionalChildLedger144;
    planner: Planner144;
    comparison: PlanComparison144;
    safety: SafetyTargets144;
  };
  delivery: {
    targets: ReviewTargets144;
    items: ReviewItems144;
    regions: ReviewRegions144;
    audio: ReviewAudio144;
    playback: ReviewPlayback144;
  };
}) {
  const official = required141(
      input.projections.variants.find(
        (variant) => variant.stage === input.projections.officialStage,
      ),
    ),
    ledger = buildProjectionRebindingLedger1431({
      sourceRows: input.workspace.audio.audio,
      projectedRows: official.projection.physicalAudio,
      sourceIdentity: input.workspace.sourceIdentity,
      projectionId: official.officialPlanId,
      projectionStage: official.stage,
      sourceArtifactType: input.workspace.audio.artifactType,
      sourceSchemaVersion: input.workspace.audio.schemaVersion,
      projectedSchemaVersion: "1.0.0",
    });
  const artifact = (
    relativePath: string,
    value: { semanticHash: string; artifactType?: string },
    rowGroups: NestedArtifactRowGroup1431[],
  ): NestedArtifact1431Input => ({
    artifactPathRelative: safeRelative141(
      input.root,
      path.join(input.root, relativePath),
    ),
    artifact: value,
    artifactRowType: required141(rowGroups[0]).rowType,
    rowGroups,
  });
  const oldNestedArtifacts: NestedArtifact1431Input[] = [
    artifact(
      "review-workspace/machine-review-target-intervals-v5.json",
      input.workspace.targets,
      [
        {
          rowType: "REVIEW_TARGET_ROW",
          rows: input.workspace.targets.targets,
          rowPath: (index) => `$.targets[${index}]`,
          rowHashExpected: true,
        },
      ],
    ),
    artifact(
      "review-workspace/machine-review-regions-v6.json",
      input.workspace.regions,
      [
        {
          rowType: "REVIEW_REGION_ROW",
          rows: input.workspace.regions.regions,
          rowPath: (index) => `$.regions[${index}]`,
          rowHashExpected: true,
        },
      ],
    ),
    artifact(
      "machine-artifacts/machine-missing-safety-reserve-targets-v3.json",
      input.workspace.safety,
      [
        {
          rowType: "SAFETY_TARGET_ROW",
          rows: input.workspace.safety.targets,
          rowPath: (index) => `$.targets[${index}]`,
          rowHashExpected: true,
        },
      ],
    ),
    artifact(
      "machine-artifacts/machine-selectable-speech-child-units-v1.json",
      input.hierarchy,
      [
        {
          rowType: "HIERARCHICAL_ATOM_ROW",
          rows: input.hierarchy.atoms,
          rowPath: (index) => `$.atoms[${index}]`,
          rowHashExpected: true,
        },
        {
          rowType: "SELECTABLE_CHILD_UNIT_ROW",
          rows: input.hierarchy.children,
          rowPath: (index) => `$.children[${index}]`,
          rowHashExpected: true,
        },
      ],
    ),
    artifact(
      "machine-artifacts/machine-review-target-bundle-candidates-v1.json",
      input.bundles,
      [
        {
          rowType: "TARGET_BUNDLE_ROW",
          rows: input.bundles.candidates,
          rowPath: (index) => `$.candidates[${index}]`,
          rowHashExpected: true,
        },
      ],
    ),
    artifact(
      "machine-artifacts/machine-cross-stage-selection-continuity-ledger.json",
      input.continuity,
      [
        {
          rowType: "CONTINUITY_LEDGER_ROW",
          rows: input.continuity.entries,
          rowPath: (index) => `$.entries[${index}]`,
          rowHashExpected: false,
        },
      ],
    ),
    artifact(
      "machine-artifacts/machine-phase-a-coverage-obligations.json",
      input.obligations,
      [
        {
          rowType: "PHASE_A_OBLIGATION_ROW",
          rows: input.obligations.obligations,
          rowPath: (index) => `$.obligations[${index}]`,
          rowHashExpected: true,
        },
      ],
    ),
    artifact(
      "machine-artifacts/machine-final-safety-planner-certificate.json",
      input.compatibilityPlanner,
      [
        {
          rowType: "PLANNER_CERTIFICATE",
          rows: [input.compatibilityPlanner],
          rowPath: () => "$",
          rowHashExpected: true,
        },
      ],
    ),
    artifact("machine-projection-hash-rebinding-ledger.json", ledger, [
      {
        rowType: "PROJECTION_REBINDING_LEDGER_ROW",
        rows: ledger.entries,
        rowPath: (index) => `$.entries[${index}]`,
        rowHashExpected: true,
      },
    ]),
  ];
  const sourceProjectionPreflight = preflightNestedSemanticIntegrity1431(
    input.projections,
    oldNestedArtifacts,
  );
  assertPreGoldIntegrity1431(sourceProjectionPreflight);

  const all = [
      ...Object.values(input.utility),
      ...Object.values(input.delivery),
      ledger,
      sourceProjectionPreflight,
    ],
    verifiedNestedRowCount = all.reduce(
      (sum, artifactValue) => sum + verifyAllNestedHashes144(artifactValue),
      0,
    ),
    utilityRowCount =
      input.utility.atoms.rows.length +
      input.utility.children.rows.length +
      input.utility.bundles.rows.length +
      input.utility.propagation.entries.length +
      input.utility.forced.evaluatedChildren.length +
      input.utility.optional.entries.length +
      input.utility.safety.targets.length,
    reviewDeliveryRowCount =
      input.delivery.targets.targets.length +
      input.delivery.items.items.length +
      input.delivery.regions.regions.length +
      input.delivery.audio.audio.length +
      input.delivery.playback.segments.length +
      input.delivery.playback.plans.length,
    projectionRowCount = input.projections.variants.reduce(
      (sum, variant) =>
        sum +
        variant.projection.physicalAudio.length +
        variant.projection.playbackSegments.length,
      0,
    );
  const preflight = nestedPreflight144Schema.parse(
    hashed141({
      ...header144(input.policy, input.workspace.sourceIdentity),
      artifactType: "c6-0-1-14-4-nested-semantic-integrity-preflight",
      sourceProjectionPreflightHash: sourceProjectionPreflight.semanticHash,
      verifiedArtifactHashes: all.map((value) => value.semanticHash),
      verifiedNestedRowCount,
      utilityRowCount,
      reviewDeliveryRowCount,
      projectionRowCount,
      nestedIntegrityFailures: 0,
      staleProjectionHashCount: 0,
      preGold: true,
      passed: true,
    }),
  );
  return { ledger, sourceProjectionPreflight, preflight };
}
