import path from "node:path";
import {
  nestedPreflight145Schema,
  projectionLedger145Schema,
  type Bundles143,
  type Continuity143,
  type Hierarchy143,
  type Obligations143,
  type Planner143,
  type Policy145,
  type Projections143,
  type ReviewAudio145,
  type ReviewItems145,
  type ReviewPlayback145,
  type ReviewRegions145,
  type ReviewTargets145,
  type Workspace143,
} from "@mvl/shared";
import {
  assertPreGoldIntegrity1431,
  buildProjectionRebindingLedger1431,
  preflightNestedSemanticIntegrity1431,
  type NestedArtifact1431Input,
  type NestedArtifactRowGroup1431,
} from "../../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import { safeRelative141 } from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { header145 } from "../../packages/video-subtitler/src/review/c601145-policy.js";
import type { Machine145 } from "./c601145-machine.js";

function verifyNested145(value: unknown): number {
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
    count += verifyNested145(child);
  return count;
}

export function preflightCoverageDelivery145(input: {
  root: string;
  policy: Policy145;
  projections: Projections143;
  workspace: Workspace143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  obligations: Obligations143;
  compatibilityPlanner: Planner143;
  compatibilitySafety: Workspace143["safety"];
  continuity: Continuity143;
  machine: Machine145;
  delivery: {
    targets: ReviewTargets145;
    items: ReviewItems145;
    regions: ReviewRegions145;
    audio: ReviewAudio145;
    playback: ReviewPlayback145;
  };
}) {
  const official = required141(
      input.projections.variants.find(
        (variant) => variant.stage === input.projections.officialStage,
      ),
      "C601145_OFFICIAL_PROJECTION_MISSING",
    ),
    sourceLedger = buildProjectionRebindingLedger1431({
      sourceRows: input.workspace.audio.audio,
      projectedRows: official.projection.physicalAudio,
      sourceIdentity: input.workspace.sourceIdentity,
      projectionId: official.officialPlanId,
      projectionStage: official.stage,
      sourceArtifactType: input.workspace.audio.artifactType,
      sourceSchemaVersion: input.workspace.audio.schemaVersion,
      projectedSchemaVersion: "1.0.0",
    }),
    projectionLedger = projectionLedger145Schema.parse(
      hashed141({
        ...header145(input.policy, input.workspace.sourceIdentity),
        artifactType: "machine-projection-hash-rebinding-ledger-v145",
        sourceProjectionLedgerHash: sourceLedger.semanticHash,
        artifacts: [
          {
            artifactType: input.workspace.audio.artifactType,
            sourceArtifactHash: input.workspace.audio.semanticHash,
            projectedArtifactHash: hash141(official.projection),
            rowCount: official.projection.physicalAudio.length,
            sourceRowsVerified: input.workspace.audio.audio.length,
            projectedRowsRehashed: official.projection.physicalAudio.length,
            staleHashCount: 0,
          },
        ],
        verifiedSourceRowCount: input.workspace.audio.audio.length,
        projectedRowCount: official.projection.physicalAudio.length,
        staleProjectionHashCount: 0,
        passed: true,
      }),
    );
  const artifact = (
    relativePath: string,
    value: { semanticHash: string },
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
  const sourcePreflight = preflightNestedSemanticIntegrity1431(
    input.projections,
    [
      artifact(
        "review-workspace/machine-review-target-intervals-v5.json",
        input.workspace.targets,
        [
          {
            rowType: "REVIEW_TARGET_ROW",
            rows: input.workspace.targets.targets,
            rowPath: (i) => `$.targets[${i}]`,
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
            rowPath: (i) => `$.regions[${i}]`,
            rowHashExpected: true,
          },
        ],
      ),
      artifact(
        "machine-artifacts/machine-missing-safety-reserve-targets-v3.json",
        input.compatibilitySafety,
        [
          {
            rowType: "SAFETY_TARGET_ROW",
            rows: input.compatibilitySafety.targets,
            rowPath: (i) => `$.targets[${i}]`,
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
            rowPath: (i) => `$.atoms[${i}]`,
            rowHashExpected: true,
          },
          {
            rowType: "SELECTABLE_CHILD_UNIT_ROW",
            rows: input.hierarchy.children,
            rowPath: (i) => `$.children[${i}]`,
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
            rowPath: (i) => `$.candidates[${i}]`,
            rowHashExpected: true,
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
            rowPath: (i) => `$.obligations[${i}]`,
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
      artifact(
        "machine-artifacts/machine-cross-stage-selection-continuity-ledger.json",
        input.continuity,
        [
          {
            rowType: "CONTINUITY_LEDGER_ROW",
            rows: input.continuity.entries,
            rowPath: (i) => `$.entries[${i}]`,
            rowHashExpected: false,
          },
        ],
      ),
    ],
  );
  assertPreGoldIntegrity1431(sourcePreflight);
  const machineArtifacts = (Object.values(input.machine) as unknown[]).filter(
      (value): value is { semanticHash: string } =>
        !!value && typeof value === "object" && "semanticHash" in value,
    ),
    artifacts: { semanticHash: string }[] = [
      ...machineArtifacts,
      ...Object.values(input.delivery),
      projectionLedger,
      sourceLedger,
      sourcePreflight,
    ],
    verifiedNestedRowCount = artifacts.reduce(
      (sum, value) => sum + verifyNested145(value),
      0,
    ),
    preflight = nestedPreflight145Schema.parse(
      hashed141({
        ...header145(input.policy, input.workspace.sourceIdentity),
        artifactType: "c6-0-1-14-5-nested-semantic-integrity-preflight",
        verifiedArtifactHashes: artifacts.map((value) => value.semanticHash),
        verifiedNestedRowCount,
        coverageUnitRowCount: input.machine.units.units.length,
        utilityRowCount: input.machine.unitUtility.rows.length,
        realizationRowCount:
          input.machine.realizations.candidates.length +
          input.machine.realizationDominance.retainedRealizationIds.length,
        jointFeasibilityRowCount: input.machine.jointFeasibility.rows.length,
        reviewDeliveryRowCount:
          input.delivery.targets.targets.length +
          input.delivery.items.items.length +
          input.delivery.regions.regions.length +
          input.delivery.audio.audio.length +
          input.delivery.playback.segments.length +
          input.delivery.playback.plans.length,
        projectionRowCount: input.projections.variants.reduce(
          (sum, variant) =>
            sum +
            variant.projection.physicalAudio.length +
            variant.projection.playbackSegments.length,
          0,
        ),
        nestedIntegrityFailures: 0,
        staleProjectionHashCount: 0,
        preGold: true,
        passed: true,
      }),
    );
  return { sourceLedger, sourcePreflight, projectionLedger, preflight };
}
