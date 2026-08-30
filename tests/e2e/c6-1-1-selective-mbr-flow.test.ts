import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  subtitlePackageSchema,
  blindEvaluationPolicySchema,
  type C61HypothesisInput,
  type C611Baseline,
  type C611MachineFeatureFreeze,
  type C611LegacyControl,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../../packages/video-subtitler/src/blind-acceptance/gold-isolation.js";
import { evaluateMachineCues } from "../../packages/video-subtitler/src/blind-acceptance/gold-evaluation.js";
import { c61MetricsFromEvaluation } from "../../packages/video-subtitler/src/consensus/consensus-quality-evaluator.js";
import type { C61MachineArtifactInput } from "../../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";
import { investigateC61Machine } from "../../packages/video-subtitler/src/consensus/c61-machine-investigation.js";
import {
  buildC611MachineProposals,
  C611_MACHINE_POLICY_DESCRIPTOR,
} from "../../packages/video-subtitler/src/consensus/existing-candidate-proposal.js";
import {
  freezeC611CalibrationPolicy,
  prepareC611CalibrationSamples,
} from "../../packages/video-subtitler/src/consensus/selective-mbr-calibration.js";
import { buildC611Folds } from "../../packages/video-subtitler/src/consensus/selective-mbr-folds.js";
import {
  freezeC611Policy,
  C611_POLICY_VERSION,
} from "../../packages/video-subtitler/src/consensus/c611-policy.js";
import { C611_FIXED_ALIGNMENT_POLICY } from "../../packages/video-subtitler/src/consensus/fixed-baseline-alignment-map.js";
import { C611_GROUPED_ORACLE_POLICY } from "../../packages/video-subtitler/src/consensus/selective-mbr-oracles.js";
import { assembleC611ExistingShadow } from "../../packages/video-subtitler/src/consensus/selective-mbr-shadow-assembly.js";
import {
  evaluateC611FrozenStage,
  finalizeC611Route,
} from "../../packages/video-subtitler/src/consensus/c611-evaluation-stage.js";
import { buildC611ErrorAttribution } from "../../packages/video-subtitler/src/consensus/selective-mbr-error-attribution.js";
import { buildC611ReviewSuggestions } from "../../packages/video-subtitler/src/consensus/selective-mbr-review-suggestions.js";
import type { C611FrozenInputs } from "../../packages/video-subtitler/src/consensus/c611-frozen-inputs.js";
import { c61TreeFiles } from "../../packages/video-subtitler/src/consensus/c61-artifact-io.js";

const SHA = hash("synthetic-only"),
  frozenAt = "2020-01-01T00:00:00.000Z",
  firstReadAt = "2020-01-01T00:00:01.000Z";
/** Synthetic authority fixture, never an acceptance receipt or real transcript. */
function fixture() {
  const production = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.wav",
      container: "wav",
      durationSeconds: 220,
    },
    identity: { title: "Synthetic", season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      ass: "synthetic.ass",
      srt: "synthetic.srt",
      vtt: "synthetic.vtt",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    warnings: [],
    cues: Array.from({ length: 20 }, (_, i) => ({
      id: `cue-${i}`,
      text: "甲乙",
      start: i * 10 + 1,
      end: i * 10 + 3,
      language: "ja",
      languages: ["ja"],
      speaker: null,
      confidence: null,
    })),
  });
  const events = production.cues.map((c, i) => {
    const body = {
      eventId: `event-${i}`,
      sourceInterval: { start: c.start, end: c.end },
      sourceCandidateIds: [`w-${i}`, `r-${i}`, `current-${i}`],
      finalCueIds: [c.id],
      currentText: c.text,
      finalSpan: {
        finalCueId: c.id,
        spanStart: 0,
        spanEnd: 2,
        spanText: c.text,
        lineageStatus: "EXACT",
        modifiable: true,
        evidenceHash: SHA,
      },
    };
    return { ...body, semanticHash: hash(body) };
  });
  const candidates: C61HypothesisInput[] = events.flatMap((e) =>
    (["CURRENT", "WHISPER", "REAZON"] as const).map((provider) => ({
      inputRecordId: `input-${e.eventId}-${provider}`,
      sourceCandidateId: `${e.eventId}-${provider}`,
      eventId: e.eventId,
      providerFamily: provider,
      modelIdentity: provider,
      requestId: `request-${e.eventId}-${provider}`,
      windowType: "CORE_EXACT",
      sourceInterval: e.sourceInterval,
      displayText: provider === "CURRENT" ? "甲乙" : "甲丙",
      pronunciationText: null,
      pronunciationEvidenceId: null,
      candidateRole: "CORE_EXACT",
      correlationLineage: [e.eventId, provider],
      provenanceHashes: [SHA],
      lineageVerified: true,
      sourceGlobalVerified: true,
      hardRejectionReasons: [],
      localizationBlockers: [],
      runtimeGoldInputCount: 0,
      humanDerived: false,
    })),
  );
  const machine: C61MachineArtifactInput = {
    subtitlePackage: production,
    taskDirectory: "synthetic",
    events,
    candidates,
    sourceArtifactHashes: { "synthetic.json": SHA },
    acousticScores: [],
    baselineInventory: {
      canonicalCueCount: 20,
      canonicalEventCount: 20,
      historicalRawCandidateCount: 60,
      historicalDispositionCounts: {},
      inputRowsByArtifact: {},
      sourceMediaSha256: SHA,
      sourceDurationSeconds: 220,
      newAsrInferenceCount: 0,
      networkUsed: false,
      runtimeGoldInputCount: 0,
    },
  };
  const old = investigateC61Machine(machine),
    universe = old.universe;
  const lattices = old.lattices.filter((l) =>
    old.paths.some(
      (p) => p.profileId === "P0" && p.latticeHash === l.semanticHash,
    ),
  );
  const stage = buildC611MachineProposals({
    universe,
    machine,
    productionPackage: production,
  });
  const samples = prepareC611CalibrationSamples(
      stage.proposals.records,
      stage.features.rows,
    ),
    calibrationPolicy = freezeC611CalibrationPolicy();
  const folds = buildC611Folds(
    stage.proposals.records.map((p) => ({
      proposalId: p.proposalId,
      eventId: p.eventId,
      sourceAudioIdentity: p.sourceAudioIdentity,
      sourceInterval: p.sourceInterval,
      acousticIntervals: p.acousticIntervals,
      cueIntervals: [],
      finalCueIds: p.finalCueIds,
      sharedSpanKeys: [],
    })),
    calibrationPolicy,
  );
  const policy = freezeC611Policy({
    fixedAlignment: C611_FIXED_ALIGNMENT_POLICY,
    machine: C611_MACHINE_POLICY_DESCRIPTOR,
    calibration: calibrationPolicy,
    oracle: C611_GROUPED_ORACLE_POLICY,
  });
  const legacySamples = samples.map((p) => ({
    ...p,
    proposalId: `legacy-p6:${p.eventId}`,
  }));
  const legacyShadow = assembleC611ExistingShadow({
    profileId: "S1",
    production,
    universe,
    lattices,
    selections: legacySamples.map((p) => ({
      eventId: p.eventId,
      candidateId: p.proposedCandidateId,
      selected: p.eligibilityStatus === "ELIGIBLE",
    })),
  });
  const legacyBody: Omit<C611LegacyControl, "semanticHash"> = {
    schemaVersion: "1.0.0",
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-legacy-p6-control",
    originalManifestHash: SHA,
    originalSelectionsHash: SHA,
    samples: legacySamples,
    selectedProposalIds: legacySamples
      .filter((p) => p.eligibilityStatus === "ELIGIBLE")
      .map((p) => p.proposalId),
    originalCanonicalTextHash: c601CanonicalTextHash(
      legacyShadow.subtitlePackage.cues,
    ),
    reproducedCanonicalTextHash: c601CanonicalTextHash(
      legacyShadow.subtitlePackage.cues,
    ),
    canonicalTextParity: true,
    canonicalTimingParity: true,
    runtimeGoldInputCount: 0,
  };
  const freeze: C611MachineFeatureFreeze = {
    schemaVersion: "1.0.0",
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-machine-feature-freeze",
    runtimeNodeVersion: process.version,
    sharedSourceEntry: "packages/shared/src/index.ts",
    runtimeSourceExecutionVerified: true,
    frozenAt,
    proposalHash: stage.proposals.semanticHash,
    featureSchemaHash: stage.features.featureSchemaHash,
    featureTableHash: stage.features.semanticHash,
    candidateUniverseHash: universe.semanticHash,
    correlationPolicyHash: stage.correlationGroups.correlationPolicyHash,
    riskPolicyHash: stage.riskLedger.riskPolicyHash,
    foldHash: folds.semanticHash,
    policyHash: policy.semanticHash,
    baselineHash: SHA,
    machineFiles: [],
    machineAggregateHash: SHA,
    sourceCodeFiles: [],
    sourceCodeAggregateHash: SHA,
    inputHashes: {},
    frozenBeforeGold: true,
    aBMachineParity: true,
    runtimeGoldInputCount: 0,
    newAsrInferenceCount: 0,
    networkUsed: false,
    semanticHash: SHA,
  };
  const gold = production.cues.map((c, i) => ({
    id: `gold-${i}`,
    start: c.start,
    end: c.end,
    text: i % 4 === 0 ? "甲乙" : "甲丙",
  }));
  const fingerprint = { size: 1, mtimeMs: 0, sha256: SHA },
    goldIdentity = {
      fileName: "synthetic.ass",
      size: 1,
      sha256: SHA,
      cueCount: 20,
      timestampNormalizationCount: 0,
      firstReadAt,
      readOnlyVerified: true,
    };
  const metric = (cues: typeof production.cues) =>
    c61MetricsFromEvaluation(
      evaluateMachineCues({
        generatedAt: frozenAt,
        generationRunId: "synthetic",
        sourceIdentity: { fileName: "synthetic.wav", size: 1, sha256: SHA },
        freeze: { freezeSemanticHash: SHA, frozenArtifactAggregateHash: SHA },
        machineCues: cues,
        goldCues: gold,
        goldIdentity,
        policy: blindEvaluationPolicySchema.parse({
          ...old.profileFreeze.evaluationPolicy,
          frozenAt,
        }),
        evaluationWallTimeMs: 0,
        outputHashAfterGold: SHA,
      }),
    );
  const baseline: C611Baseline = {
    schemaVersion: "1.0.0",
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-baseline",
    acceptanceCommit: "a".repeat(40),
    baselineBranch: "synthetic",
    c61MachineFreezeHash: SHA,
    sourceBefore: fingerprint,
    productionFiles: [],
    canonicalTextHash: c601CanonicalTextHash(production.cues),
    canonicalTimingHash: c601CanonicalTimingHash(production.cues),
    candidateUniverseHash: universe.semanticHash,
    inputHashes: {},
    officialArtifactHashes: {},
    candidateCounts: {},
    baselineMetrics: metric(production.cues),
    legacyP6Metrics: metric(legacyShadow.subtitlePackage.cues),
    legacyEventEvaluation: {
      evaluable: 20,
      changed: 20,
      improved: 15,
      regressed: 5,
      neutral: 0,
      unevaluable: 0,
      renderedChangedCues: 20,
    },
    legacyOracle: {
      currentError: 15,
      bestExistingError: 0,
      bestLegalError: 0,
      unrestrictedError: 0,
      candidateOracleGain: 15,
    },
    pairwiseCount: 0,
    checks: [],
    baselineReplayPassed: true,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
    networkUsed: false,
    newAsrInferenceCount: 0,
    goldFileOpened: false,
    semanticHash: SHA,
  };
  const frozen: C611FrozenInputs = {
    freeze,
    proposals: stage.proposals,
    features: stage.features,
    universe,
    lattices,
    samples,
    baseline,
    production,
    completeness: stage.completeness,
    folds,
    calibrationPolicy,
    policy,
    legacy: { ...legacyBody, semanticHash: hash(legacyBody) },
    legacyPolicy: old.profileFreeze,
  };
  return {
    frozen,
    barrier: {
      freeze,
      goldFirstReadAt: firstReadAt,
      fingerprint,
      goldIdentity,
      gold,
    },
  };
}
describe("C6.1.1 synthetic integrated OOF shadow evaluation", () => {
  it("keeps P0, reproduces legacy control, evaluates fixed groups and preserves A/B parity", async () => {
    const input = fixture(),
      tmp = await mkdtemp(path.join(os.tmpdir(), "c611-e2e-"));
    const roots = [path.join(tmp, "a"), path.join(tmp, "b")];
    try {
      for (const root of roots) await mkdir(root);
      const a = await evaluateC611FrozenStage({
        ...input,
        root: roots[0] ?? "",
        sourceFileName: "synthetic.wav",
      });
      const b = await evaluateC611FrozenStage({
        ...input,
        root: roots[1] ?? "",
        sourceFileName: "synthetic.wav",
        reverse: true,
      });
      expect(a.profileResults.semanticHash).toBe(b.profileResults.semanticHash);
      expect(hash(await c61TreeFiles(roots[0] ?? ""))).toBe(
        hash(await c61TreeFiles(roots[1] ?? "")),
      );
      expect(a.profileResults.profiles[0]?.appliedSelectionCount).toBe(0);
      expect(a.profileResults.profiles[1]?.appliedSelectionCount).toBe(20);
      expect(
        a.profileResults.profiles.every((p) => p.fixed.invariance.eligible),
      ).toBe(true);
      expect(a.oracle.summary.bestExistingCandidateOracle.normalizedGain).toBe(
        15,
      );
      const diagnostics = buildC611ErrorAttribution({
        proposals: input.frozen.proposals,
        features: input.frozen.features,
        completeness: input.frozen.completeness,
        labels: a.labels,
        decisions: a.oof.decisions.filter((d) => d.profileId !== "S1"),
        appliedEventIdsByProfile: a.appliedEventIdsByProfile,
      });
      expect(diagnostics.profiles.some((p) => p.profileId === "S1")).toBe(
        false,
      );
      expect(
        buildC611ReviewSuggestions({
          universe: input.frozen.universe,
          proposals: input.frozen.proposals,
          decisions: a.oof.decisions,
          profileId: "S6",
          appliedEventIdsByProfile: a.appliedEventIdsByProfile,
        }).rows,
      ).toHaveLength(20);
      const { route, future } = finalizeC611Route({
        frozen: input.frozen,
        evaluation: a,
        aBDeterministic: true,
        sourceReadOnly: true,
        goldReadOnly: true,
        productionFilesUnchanged: true,
      });
      expect(route.machineOnlyReleaseAuthorized).toBe(false);
      expect(route.c602Status).toBe("HOLD");
      if (!route.futureModelTrainingAuthorized) {
        expect(future.model).toBeNull();
        expect(future.threshold).toBeNull();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 120000);
});
