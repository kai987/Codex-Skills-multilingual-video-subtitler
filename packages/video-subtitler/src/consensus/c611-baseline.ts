import path from "node:path";
import {
  c611BaselineSchema,
  c61BaselineSchema,
  c61QualityEvaluationSchema,
  c61OracleSchema,
  c61ValidationSchema,
  machineMultiAsrHypothesisUniverseSchema,
  machineMultiAsrPairwiseAlignmentsSchema,
  type C611Baseline,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../blind-acceptance/gold-isolation.js";
import {
  c61FileHash,
  c61Fingerprint,
  c61Json,
  verifyC61MachineFreeze,
} from "./c61-artifact-io.js";
import { loadC61MachineArtifacts } from "./c61-artifact-adapter.js";
import { buildC61HypothesisUniverse } from "./hypothesis-universe.js";
import { C611_POLICY_VERSION } from "./c611-policy.js";

/** Acceptance assertions are supplied baseline facts, never runtime decisions. */
export async function replayC611Baseline(input: {
  previousA: string;
  previousB: string;
  upstreamTask: string;
  source: string;
  quality: string;
  oracle: string;
  validation: string;
  acceptanceCommit: string;
  baselineBranch: string;
}): Promise<C611Baseline> {
  const first = await verifyC61MachineFreeze(input.previousA);
  const second = await verifyC61MachineFreeze(input.previousB);
  const machine = await loadC61MachineArtifacts(input.upstreamTask);
  const universe = buildC61HypothesisUniverse({
    events: machine.events,
    candidates: machine.candidates,
    sourceArtifactHashes: machine.sourceArtifactHashes,
  });
  const official = machineMultiAsrHypothesisUniverseSchema.parse(
    await c61Json(
      path.join(input.previousA, "machine-multi-asr-hypothesis-universe.json"),
    ),
  );
  const baseline = c61BaselineSchema.parse(
    await c61Json(path.join(input.previousA, "c6-1-baseline.json")),
  );
  const quality = c61QualityEvaluationSchema.parse(
    await c61Json(input.quality),
  );
  const oracle = c61OracleSchema.parse(await c61Json(input.oracle));
  const validation = c61ValidationSchema.parse(await c61Json(input.validation));
  const pairwise = machineMultiAsrPairwiseAlignmentsSchema.parse(
    await c61Json(
      path.join(input.previousA, "machine-multi-asr-pairwise-alignments.json"),
    ),
  );
  const p0 = quality.profiles.find((p) => p.profileId === "P0"),
    p6 = quality.profiles.find((p) => p.profileId === "P6");
  if (!p0 || !p6) throw new Error("C611_BASELINE_PROFILE_MISSING");
  const included = universe.candidates.filter(
    (c) => c.inclusionStatus === "INCLUDED",
  );
  const counts = {
    ...universe.summary,
    currentControlCount: included.filter((c) => c.providerFamily === "CURRENT")
      .length,
    realAsrCandidateCount: included.filter(
      (c) => c.providerFamily !== "CURRENT",
    ).length,
  };
  const checks: C611Baseline["checks"] = [];
  const expect = (name: string, observed: unknown, expected: unknown) =>
    checks.push({
      name,
      passed: hash(observed) === hash(expected),
      observed: JSON.stringify(observed),
      expected: JSON.stringify(expected),
    });
  expect(
    "acceptance-commit",
    input.acceptanceCommit,
    "2e9dbf4c909afd159e3aabc3ac876180cbd188ef",
  );
  expect(
    "acceptance-branch",
    input.baselineBranch,
    "codex/c6-1-multi-asr-confusion-network-mbr-investigation",
  );
  expect(
    "complete-dual-machine-freeze",
    first.semanticHash,
    second.semanticHash,
  );
  expect(
    "candidate-universe-rebuilt",
    universe.semanticHash,
    official.semanticHash,
  );
  expect(
    "reverse-input-universe-parity",
    buildC61HypothesisUniverse({
      events: [...machine.events].reverse(),
      candidates: [...machine.candidates].reverse(),
      sourceArtifactHashes: machine.sourceArtifactHashes,
    }).semanticHash,
    official.semanticHash,
  );
  expect(
    "official-runtime-policy",
    baseline.policyVersion,
    "c6.1-consensus-investigation-v1",
  );
  const expectedCounts = {
    inputCandidateCount: 1496,
    includedCandidateCount: 832,
    currentControlCount: 161,
    realAsrCandidateCount: 671,
    includedWhisperCount: 446,
    includedReazonCount: 225,
    normalizedDuplicateCount: 424,
    hardRejectedCount: 2,
    unaccountedCandidateCount: 0,
    canonicalEventCount: 199,
    multiHypothesisEventCount: 182,
    multiProviderEventCount: 173,
  };
  for (const [key, value] of Object.entries(expectedCounts))
    expect(`recomputed-${key}`, counts[key as keyof typeof counts], value);
  expect("baseline-cue-count", machine.subtitlePackage.cues.length, 161);
  expect(
    "canonical-text",
    c601CanonicalTextHash(machine.subtitlePackage.cues),
    baseline.canonicalTextHash,
  );
  expect(
    "canonical-timing",
    c601CanonicalTimingHash(machine.subtitlePackage.cues),
    baseline.canonicalTimingHash,
  );
  expect("pairwise-count", pairwise.alignments.length, 1518);
  expect("prior-engineering-validation", validation.engineeringPassed, true);
  expect(
    "prior-validation-checks",
    validation.checks.every((c) => c.passed),
    true,
  );
  expect(
    "legacy-evaluable-event-count",
    p6.eventResults.filter((e) => e.outcome !== "UNEVALUABLE").length,
    38,
  );
  expect("legacy-p6-changes", p6.changedEvents, 99);
  expect(
    "legacy-p6-outcomes",
    [p6.improved, p6.regressed, p6.neutral],
    [8, 6, 24],
  );
  expect(
    "p0-quality",
    [
      p0.metrics.normalizedCer,
      p0.metrics.coverage,
      p0.metrics.missing,
      p0.metrics.hallucination,
      p0.metrics.materialErrors,
      p0.metrics.severeTiming,
    ],
    [0.6015625, 0.96484375, 6, 1, 77, 53],
  );
  expect(
    "p6-quality",
    [
      p6.metrics.normalizedCer,
      p6.metrics.coverage,
      p6.metrics.missing,
      p6.metrics.hallucination,
      p6.metrics.materialErrors,
    ],
    [0.58251953125, 0.96484375, 6, 0, 78],
  );
  expect(
    "legacy-oracle-errors",
    [
      oracle.currentError,
      oracle.bestExistingCandidateError,
      oracle.bestLegalPathError,
      oracle.unrestrictedSlotError,
    ],
    [210, 107, 103, 90],
  );
  const sourceBefore = await c61Fingerprint(input.source);
  expect("source-identity", sourceBefore.sha256, baseline.sourceMediaSha256);
  for (const file of baseline.productionFiles)
    expect(
      `production-file:${file.relativePath}`,
      await c61FileHash(path.join(machine.taskDirectory, file.relativePath)),
      file.sha256,
    );
  const officialArtifactHashes = Object.fromEntries(
    await Promise.all(
      Object.entries({
        baseline: path.join(input.previousA, "c6-1-baseline.json"),
        universe: path.join(
          input.previousA,
          "machine-multi-asr-hypothesis-universe.json",
        ),
        quality: input.quality,
        oracle: input.oracle,
        validation: input.validation,
      }).map(async ([key, file]) => [key, await c61FileHash(file)] as const),
    ),
  );
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-baseline" as const,
    acceptanceCommit: input.acceptanceCommit,
    baselineBranch: input.baselineBranch,
    c61MachineFreezeHash: first.semanticHash,
    sourceBefore,
    productionFiles: baseline.productionFiles,
    canonicalTextHash: baseline.canonicalTextHash,
    canonicalTimingHash: baseline.canonicalTimingHash,
    candidateUniverseHash: universe.semanticHash,
    inputHashes: machine.sourceArtifactHashes,
    officialArtifactHashes,
    candidateCounts: counts,
    baselineMetrics: p0.metrics,
    legacyP6Metrics: p6.metrics,
    legacyEventEvaluation: {
      evaluable: p6.eventResults.filter((e) => e.outcome !== "UNEVALUABLE")
        .length,
      changed: p6.changedEvents,
      improved: p6.improved,
      regressed: p6.regressed,
      neutral: p6.neutral,
      unevaluable: p6.unevaluable,
      renderedChangedCues: p6.renderedChangedCueCount,
    },
    legacyOracle: {
      currentError: oracle.currentError,
      bestExistingError: oracle.bestExistingCandidateError,
      bestLegalError: oracle.bestLegalPathError,
      unrestrictedError: oracle.unrestrictedSlotError,
      candidateOracleGain:
        oracle.currentError - oracle.bestExistingCandidateError,
    },
    pairwiseCount: pairwise.alignments.length,
    checks,
    baselineReplayPassed: checks.every((c) => c.passed),
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    c602Status: "HOLD" as const,
    networkUsed: false as const,
    newAsrInferenceCount: 0 as const,
    goldFileOpened: false as const,
  };
  return c611BaselineSchema.parse({ ...body, semanticHash: hash(body) });
}
