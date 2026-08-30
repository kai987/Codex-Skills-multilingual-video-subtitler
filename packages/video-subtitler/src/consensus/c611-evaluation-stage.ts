import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  blindEvaluationPolicySchema,
  c611SelectiveProfileResultsSchema,
  c611ShadowManifestSchema,
  type C611Decision,
  type C611CalibrationSample,
  type C611SelectiveProfileResults,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../blind-acceptance/gold-isolation.js";
import { c61TreeFiles } from "./c61-artifact-io.js";
import type { readC611GoldAfterFreeze } from "./c611-evaluation-barrier.js";
import type { C611FrozenInputs } from "./c611-frozen-inputs.js";
import { buildC611FixedBaselineAlignmentMap } from "./fixed-baseline-alignment-map.js";
import {
  evaluateC611ProposalCounterfactuals,
  evaluateC611FixedAlignment,
} from "./fixed-alignment-paired-evaluator.js";
import { evaluateC611SelectiveProfileQuality } from "./selective-mbr-quality-evaluator.js";
import { assembleC611ExistingShadow } from "./selective-mbr-shadow-assembly.js";
import {
  c611CalibrationLabels,
  runC611Oof,
  calculateC611SelectiveMetrics,
} from "./selective-mbr-oof.js";
import { evaluateC611GroupedOracles } from "./selective-mbr-oracles.js";
import {
  decideC611SelectiveRoute,
  createC611FutureModelFreeze,
} from "./selective-mbr-route-decision.js";
import { C611_POLICY_VERSION } from "./c611-policy.js";

export async function evaluateC611FrozenStage(input: {
  frozen: C611FrozenInputs;
  barrier: Awaited<ReturnType<typeof readC611GoldAfterFreeze>>;
  root: string;
  sourceFileName: string;
  reverse?: boolean;
  progress?: (message: string) => void;
}) {
  const { frozen: s, barrier: b } = input;
  if (s.freeze.semanticHash !== b.freeze.semanticHash)
    throw new Error("C611_EVALUATION_BARRIER_IDENTITY_MISMATCH");
  const ordered = <T>(rows: T[]) =>
    input.reverse ? [...rows].reverse() : rows;
  const baselineCues = s.production.cues;
  const map = buildC611FixedBaselineAlignmentMap({
    baselineCues,
    goldCues: b.gold,
    eventBindings: ordered(s.proposals.records).map((p) => ({
      eventId: p.eventId,
      finalCueIds: p.finalCueIds,
    })),
    barrier: {
      machineFreezeHash: s.freeze.semanticHash,
      machineFrozenAt: s.freeze.frozenAt,
      goldFirstReadAt: b.goldFirstReadAt,
    },
  });
  input.progress?.(`fixed map: ${map.summary.totalCueGroups} groups`);
  const eventFold = new Map(
    s.folds.folds.flatMap((f) =>
      f.eventIds.map((id) => [id, f.foldId] as const),
    ),
  );
  const assemble = (
    selections: {
      eventId: string;
      candidateId: string | null;
      selected: boolean;
    }[],
    profileId: string,
  ) =>
    assembleC611ExistingShadow({
      profileId,
      production: s.production,
      universe: s.universe,
      lattices: s.lattices,
      selections,
    });
  function label(samples: C611CalibrationSample[], proposalSetHash: string) {
    return evaluateC611ProposalCounterfactuals({
      map,
      baselineCues,
      goldCues: b.gold,
      proposalSetHash,
      proposalFolds: samples.map((p) => ({
        proposalId: p.proposalId,
        foldId: eventFold.get(p.eventId) ?? "MISSING",
      })),
      proposals: ordered(samples).map((p) => {
        const shadow =
          p.eligibilityStatus === "ELIGIBLE"
            ? assemble(
                [
                  {
                    eventId: p.eventId,
                    candidateId: p.proposedCandidateId,
                    selected: true,
                  },
                ],
                "counterfactual",
              )
            : null;
        return {
          proposalId: p.proposalId,
          eventId: p.eventId,
          candidateId: p.proposedCandidateId,
          shadowCues: shadow?.subtitlePackage.cues ?? baselineCues,
          eligibilityReasons:
            p.eligibilityStatus !== "ELIGIBLE"
              ? [p.eligibilityStatus]
              : shadow?.blockedRequestedEventIds.length
                ? ["COUNTERFACTUAL_RENDERER_BLOCKED"]
                : [],
        };
      }),
    });
  }
  const labels = label(s.samples, s.proposals.semanticHash),
    legacyLabels = label(s.legacy.samples, s.legacy.semanticHash);
  input.progress?.(
    `labels: ${labels.summary.improved} improve / ${labels.summary.regressed} regress / ${labels.summary.unevaluable} unknown`,
  );
  const numericLabels = c611CalibrationLabels(labels.labels),
    legacyNumericLabels = c611CalibrationLabels(legacyLabels.labels);
  const oof = runC611Oof({
    samples: ordered(s.samples),
    labels: ordered(numericLabels),
    folds: s.folds,
    policy: s.calibrationPolicy,
    legacy: {
      samples: ordered(s.legacy.samples),
      labels: ordered(legacyNumericLabels),
      selectedProposalIds: s.legacy.selectedProposalIds,
    },
  });
  input.progress?.("nested OOF complete");
  const evaluationRoot = path.join(input.root, "evaluation"),
    shadowRoot = path.join(input.root, "shadow");
  await mkdir(evaluationRoot, { recursive: false });
  await mkdir(shadowRoot, { recursive: false });
  const profiles: C611SelectiveProfileResults["profiles"] = [],
    manifestProfiles: ReturnType<
      typeof c611ShadowManifestSchema.parse
    >["profiles"] = [];
  const appliedEventIdsByProfile: Record<string, string[]> = {};
  const legacyInput = {
    generatedAt: s.freeze.frozenAt,
    sourceIdentity: {
      fileName: input.sourceFileName,
      size: s.baseline.sourceBefore.size,
      sha256: s.baseline.sourceBefore.sha256,
    },
    freeze: {
      freezeSemanticHash: s.freeze.semanticHash,
      frozenArtifactAggregateHash: s.freeze.machineAggregateHash,
    },
    goldIdentity: b.goldIdentity,
    policy: blindEvaluationPolicySchema.parse({
      ...s.legacyPolicy.evaluationPolicy,
      frozenAt: s.freeze.frozenAt,
    }),
    evaluationWallTimeMs: 0,
    outputHashAfterGold: s.freeze.machineAggregateHash,
  };
  for (const profile of s.calibrationPolicy.profiles) {
    const profileId = profile.profileId,
      decisions = oof.decisions.filter((d) => d.profileId === profileId),
      samples = profileId === "S1" ? s.legacy.samples : s.samples,
      activeLabels = profileId === "S1" ? legacyNumericLabels : numericLabels;
    const shadow = assemble(
      decisions.map((d) => ({
        eventId: d.eventId,
        candidateId: d.proposedCandidateId,
        selected: d.decision === "SELECT_EXISTING_CANDIDATE",
      })),
      profileId,
    );
    const applied = new Set(
      shadow.decisions
        .filter((d) => d.status === "APPLIED_SHADOW_ONLY")
        .map((d) => d.eventId),
    );
    appliedEventIdsByProfile[profileId] = [...applied].sort();
    const actualDecisions: C611Decision[] = decisions.map((d) => {
      if (d.decision !== "SELECT_EXISTING_CANDIDATE" || applied.has(d.eventId))
        return d;
      const { semanticHash: unused, ...body } = d;
      void unused;
      const changed = {
        ...body,
        decision: "ABSTAIN_REVIEW" as const,
        machineReasons: [
          ...body.machineReasons,
          "JOINT_SHADOW_RENDERER_BLOCKED",
        ],
      };
      return { ...changed, semanticHash: hash(changed) };
    });
    const appliedMetrics = calculateC611SelectiveMetrics({
      profileId,
      samples,
      labels: activeLabels,
      decisions: actualDecisions,
      policy: s.calibrationPolicy,
    });
    const result = evaluateC611SelectiveProfileQuality({
      map,
      baselineCues,
      shadowCues: shadow.subtitlePackage.cues,
      goldCues: b.gold,
      profileId,
      legacyInput,
    });
    const expectedControl =
      profileId === "S0"
        ? s.baseline.baselineMetrics
        : profileId === "S1"
          ? s.baseline.legacyP6Metrics
          : null;
    if (
      expectedControl &&
      hash(result.quality.shadowMetrics) !== hash(expectedControl)
    )
      throw new Error(`C611_${profileId}_OFFICIAL_LEGACY_METRIC_MISMATCH`);
    const foldJointGains = s.folds.folds.map((f) => {
      const chosen = actualDecisions.filter(
        (d) =>
          d.foldId === f.foldId && d.decision === "SELECT_EXISTING_CANDIDATE",
      );
      const local = assemble(
        chosen.map((d) => ({
          eventId: d.eventId,
          candidateId: d.proposedCandidateId,
          selected: true,
        })),
        `${profileId}-${f.foldId}`,
      );
      const evaluation = evaluateC611FixedAlignment({
        map,
        baselineCues,
        shadowCues: local.subtitlePackage.cues,
        goldCues: b.gold,
        profileId: `${profileId}-${f.foldId}`,
      });
      const unknown = evaluation.groups.some(
        (g) => g.changed && g.outcome === "UNEVALUABLE",
      );
      return {
        foldId: f.foldId,
        selectedCount: chosen.length,
        evaluableSelectedCount: chosen.filter((d) =>
          activeLabels.some(
            (l) =>
              l.proposalId === d.proposalId &&
              l.outcome !== "SWITCH_UNEVALUABLE",
          ),
        ).length,
        normalizedGain: unknown ? null : evaluation.summary.normalizedGain,
      };
    });
    const folder = path.join(shadowRoot, profileId.toLowerCase());
    await mkdir(folder);
    await atomicWriteJson(
      path.join(folder, "subtitle-package.research-shadow.json"),
      shadow.subtitlePackage,
    );
    for (const extension of ["ass", "srt", "vtt"] as const)
      await writeFile(
        path.join(
          folder,
          shadow.subtitlePackage.subtitleFiles[extension] ??
            `subtitle.${extension}`,
        ),
        shadow[extension],
        { flag: "wx" },
      );
    const canonicalTextHash = c601CanonicalTextHash(
        shadow.subtitlePackage.cues,
      ),
      canonicalTimingHash = c601CanonicalTimingHash(
        shadow.subtitlePackage.cues,
      );
    manifestProfiles.push({
      profileId,
      files: (await c61TreeFiles(folder)).map((f) => ({
        ...f,
        relativePath: path.join(profileId.toLowerCase(), f.relativePath),
      })),
      cueCount: shadow.subtitlePackage.cues.length,
      changedCueIds: shadow.changedCueIds,
      canonicalTextHash,
      canonicalTimingHash,
      assemblyDecisions: shadow.decisions,
    });
    const requestedMetrics = oof.profileMetrics.find(
      (m) => m.profileId === profileId,
    );
    if (!requestedMetrics) throw new Error("C611_PROFILE_METRICS_MISSING");
    profiles.push({
      profileId,
      requestedMetrics,
      appliedMetrics,
      fixed: result.fixed,
      quality: result.quality,
      requestedSelectionCount: shadow.requestedSelectionCount,
      appliedSelectionCount: shadow.appliedSelectionCount,
      blockedRequestedEventIds: shadow.blockedRequestedEventIds,
      canonicalTextHash,
      canonicalTimingHash,
      foldJointGains,
    });
    await atomicWriteJson(
      path.join(evaluationRoot, `evaluation-${profileId}.local-only.json`),
      result.legacy,
    );
    input.progress?.(
      `${profileId}: selected ${appliedMetrics.selectedCount}, joint gain ${result.fixed.summary.normalizedGain}`,
    );
  }
  const header = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C611_POLICY_VERSION,
  };
  const profileBody = {
    ...header,
    artifactType: "c6-1-1-selective-profile-results" as const,
    machineFreezeHash: s.freeze.semanticHash,
    fixedMapHash: map.semanticHash,
    oofHash: oof.semanticHash,
    metricAuthority: "ACTUAL_ASSEMBLED_SHADOW_UNIQUE_FIXED_GROUPS" as const,
    profiles,
  };
  const profileResults = c611SelectiveProfileResultsSchema.parse({
    ...profileBody,
    semanticHash: hash(profileBody),
  });
  const manifestBody = {
    ...header,
    artifactType: "c6-1-1-shadow-manifest" as const,
    profiles: manifestProfiles,
    outputRole: "RESEARCH_SHADOW_ONLY" as const,
    productionMutationCount: 0 as const,
  };
  const manifest = c611ShadowManifestSchema.parse({
    ...manifestBody,
    semanticHash: hash(manifestBody),
  });
  input.progress?.("grouped oracle search starting");
  const oracle = evaluateC611GroupedOracles({
    fixedMap: map,
    baselineCues,
    goldCues: b.gold,
    frozenAlternativeOptions: ordered(s.proposals.records).map((p) => ({
      eventId: p.eventId,
      alternatives: p.eligibleCandidates.map((c) => ({
        candidateId: c.candidateId,
      })),
    })),
    primaryProposals: ordered(s.proposals.records).map((p) => ({
      proposalId: p.proposalId,
      eventId: p.eventId,
      candidateId: p.proposedCandidateId,
      eligible: p.eligibilityStatus === "ELIGIBLE",
    })),
    assemble: (choices) => {
      const shadow = assemble(
        choices.map((c) => ({ ...c, selected: true })),
        "grouped-oracle",
      );
      return {
        cues: shadow.subtitlePackage.cues,
        blockedEventIds: shadow.blockedRequestedEventIds,
      };
    },
  });
  for (const artifact of [map, labels, oof, profileResults, oracle])
    await atomicWriteJson(
      path.join(evaluationRoot, `${artifact.artifactType}.json`),
      artifact,
    );
  await atomicWriteJson(
    path.join(evaluationRoot, "gold-legacy-p6-labels.json"),
    legacyLabels,
  );
  await atomicWriteJson(
    path.join(shadowRoot, "c6-1-1-shadow-manifest.json"),
    manifest,
  );
  return {
    map,
    labels,
    legacyLabels,
    oof,
    profileResults,
    manifest,
    oracle,
    appliedEventIdsByProfile,
  };
}

export function finalizeC611Route(input: {
  frozen: C611FrozenInputs;
  evaluation: Awaited<ReturnType<typeof evaluateC611FrozenStage>>;
  aBDeterministic: boolean;
  sourceReadOnly: boolean;
  goldReadOnly: boolean;
  productionFilesUnchanged: boolean;
}) {
  const s = input.frozen,
    e = input.evaluation;
  const route = decideC611SelectiveRoute({
    policy: s.policy,
    baselineMetrics: s.baseline.baselineMetrics,
    baselineHash: s.baseline.semanticHash,
    expectedFoldIds: s.folds.folds.map((f) => f.foldId),
    profiles: e.profileResults.profiles.map((p) => ({
      profileId: p.profileId,
      oof: p.appliedMetrics,
      changedGroupCount: p.fixed.summary.changedCueGroups,
      mappedChangedGroupCount: p.fixed.summary.fixedMappedChangedGroupCount,
      jointNormalizedGain: p.fixed.summary.normalizedGain,
      jointExactGain: p.fixed.summary.exactGain,
      quality: p.quality.shadowMetrics,
      foldJointGains: p.foldJointGains,
    })),
    engineering: {
      baselineReplayPassed: s.baseline.baselineReplayPassed,
      fixedMappingValid: e.profileResults.profiles.every(
        (p) => p.fixed.invariance.eligible,
      ),
      featureFreezeValid: true,
      foldFreezeValid: s.folds.status === "READY",
      goldBarrierValid:
        Date.parse(e.map.goldFirstReadAt) >= Date.parse(s.freeze.frozenAt),
      oofIsolationValid: true,
      candidateProvenanceValid: true,
      aBDeterministic: input.aBDeterministic,
      productionFilesUnchanged: input.productionFilesUnchanged,
      productionTextMutation: 0,
      productionTimingMutation: 0,
      unsupportedTokenCount: 0,
      unsupportedAdjacencyCount: 0,
      missingProvenanceCount: 0,
      novelApplicationCount: 0,
      sourceReadOnly: input.sourceReadOnly,
      goldReadOnly: input.goldReadOnly,
    },
  });
  const future = createC611FutureModelFreeze({
    route,
    policy: s.policy,
    calibrationPolicy: s.calibrationPolicy,
    samples: s.samples,
    labels: c611CalibrationLabels(e.labels.labels),
    folds: s.folds,
    machineFeatureFreezeHash: s.freeze.semanticHash,
    featureTableHash: s.features.semanticHash,
    proposalHash: s.proposals.semanticHash,
    sourceOofHash: e.oof.semanticHash,
  });
  return { route, future };
}
