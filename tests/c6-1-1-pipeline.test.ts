import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  subtitlePackageSchema,
  c611BaselineSchema,
  c611LegacyControlSchema,
  type C61HypothesisEvent,
  type C61HypothesisInput,
} from "@mvl/shared";
import { buildC61HypothesisUniverse } from "../packages/video-subtitler/src/consensus/hypothesis-universe.js";
import {
  buildC611MachineProposals,
  C611_MACHINE_POLICY_DESCRIPTOR,
} from "../packages/video-subtitler/src/consensus/existing-candidate-proposal.js";
import { c611WithHash } from "../packages/video-subtitler/src/consensus/hierarchical-correlation-groups.js";
import { freezeC611CalibrationPolicy } from "../packages/video-subtitler/src/consensus/selective-mbr-calibration.js";
import { buildC611Folds } from "../packages/video-subtitler/src/consensus/selective-mbr-folds.js";
import { freezeC611Policy } from "../packages/video-subtitler/src/consensus/c611-policy.js";
import { C611_FIXED_ALIGNMENT_POLICY } from "../packages/video-subtitler/src/consensus/fixed-baseline-alignment-map.js";
import { C611_GROUPED_ORACLE_POLICY } from "../packages/video-subtitler/src/consensus/selective-mbr-oracles.js";
import { freezeC61Profiles } from "../packages/video-subtitler/src/consensus/c61-policy.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../packages/video-subtitler/src/blind-acceptance/gold-isolation.js";
import {
  freezeC611MachinePair,
  requireC611CompleteMachine,
  c611RequiredSourceFiles,
  C611_REQUIRED_PREVIOUS_INPUTS,
} from "../packages/video-subtitler/src/consensus/c611-artifact-io.js";
import { readC611GoldAfterFreeze } from "../packages/video-subtitler/src/consensus/c611-evaluation-barrier.js";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import type { C61MachineArtifactInput } from "../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";
const SHA = "a".repeat(64);
const temps: string[] = [];
async function temp() {
  const p = await mkdtemp(path.join(os.tmpdir(), "c611-pipeline-"));
  temps.push(p);
  return p;
}
afterEach(async () => {
  for (const p of temps.splice(0))
    await rm(p, { recursive: true, force: true });
});
function fixture(): C61MachineArtifactInput {
  const subtitlePackage = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.wav",
      container: "wav",
      durationSeconds: 20,
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
    cues: [
      {
        id: "cue-1",
        start: 2,
        end: 5,
        text: "明日は晴れる",
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: null,
      },
    ],
  });
  const event: C61HypothesisEvent = c611WithHash({
    eventId: "synthetic-event",
    sourceInterval: { start: 2, end: 5 },
    sourceCandidateIds: [
      "source-current",
      "source-w1",
      "source-w2",
      "source-r1",
    ],
    finalCueIds: ["cue-1"],
    currentText: "明日は晴れる",
    finalSpan: {
      finalCueId: "cue-1",
      spanStart: 0,
      spanEnd: 6,
      spanText: "明日は晴れる",
      lineageStatus: "EXACT",
      modifiable: true,
      evidenceHash: SHA,
    },
  });
  const make = (
    suffix: string,
    text: string,
    provider: C61HypothesisInput["providerFamily"],
  ): C61HypothesisInput => ({
    inputRecordId: `synthetic:${suffix}`,
    sourceCandidateId: `source-${suffix}`,
    eventId: event.eventId,
    providerFamily: provider,
    modelIdentity: `model-${provider}`,
    requestId: `request-${suffix}`,
    windowType: "CORE_EXACT",
    sourceInterval: { start: 2, end: 5 },
    displayText: text,
    pronunciationText: null,
    pronunciationEvidenceId: null,
    candidateRole: `${provider}_CORE_EXACT`,
    correlationLineage: [`decode-${suffix}`],
    provenanceHashes: [SHA],
    lineageVerified: true,
    sourceGlobalVerified: true,
    hardRejectionReasons: [],
    localizationBlockers: [],
    runtimeGoldInputCount: 0,
    humanDerived: false,
  });
  return {
    subtitlePackage,
    taskDirectory: "synthetic",
    events: [event],
    candidates: [
      make("current", "明日は晴れる", "CURRENT"),
      make("w1", "明日は晴れる", "WHISPER"),
      make("w2", "明日は曇り", "WHISPER"),
      make("r1", "明日は曇り", "REAZON"),
    ],
    sourceArtifactHashes: { "synthetic.json": SHA },
    acousticScores: [],
    baselineInventory: {
      canonicalCueCount: 1,
      canonicalEventCount: 1,
      historicalRawCandidateCount: 4,
      historicalDispositionCounts: {},
      inputRowsByArtifact: {},
      sourceMediaSha256: SHA,
      sourceDurationSeconds: 20,
      newAsrInferenceCount: 0,
      networkUsed: false,
      runtimeGoldInputCount: 0,
    },
  };
}

function synthetic() {
  const machine = fixture();
  const universe = buildC61HypothesisUniverse({
    events: machine.events,
    candidates: machine.candidates,
    sourceArtifactHashes: machine.sourceArtifactHashes,
  });
  const stage = buildC611MachineProposals({ machine, universe });
  const calibration = freezeC611CalibrationPolicy();
  const folds = buildC611Folds(
    stage.proposals.records.map((p) => ({
      eventId: p.eventId,
      proposalId: p.proposalId,
      sourceAudioIdentity: p.sourceAudioIdentity,
      sourceInterval: p.sourceInterval,
      acousticIntervals: p.acousticIntervals,
      cueIntervals: machine.subtitlePackage.cues.map((c) => ({
        start: c.start,
        end: c.end,
      })),
      finalCueIds: p.finalCueIds,
      sharedSpanKeys: [],
    })),
    calibration,
  );
  const policy = freezeC611Policy({
    fixedAlignment: C611_FIXED_ALIGNMENT_POLICY,
    machine: C611_MACHINE_POLICY_DESCRIPTOR,
    calibration,
    oracle: C611_GROUPED_ORACLE_POLICY,
  });
  const metrics = {
    exactCer: 0,
    normalizedCer: 0,
    coverage: 1,
    missing: 0,
    hallucination: 0,
    materialErrors: 0,
    cueCount: 1,
    severeTiming: 0,
    startMae: 0,
    endMae: 0,
    boundaryP95: 0,
    medianIoU: 1,
    overlap: 0,
  };
  const baseline = c611BaselineSchema.parse(
    c611WithHash({
      schemaVersion: "1.0.0",
      policyVersion: policy.policyVersion,
      artifactType: "c6-1-1-baseline",
      acceptanceCommit: "a".repeat(40),
      baselineBranch: "synthetic",
      c61MachineFreezeHash: SHA,
      sourceBefore: { size: 0, mtimeMs: 0, sha256: SHA },
      productionFiles: [],
      canonicalTextHash: c601CanonicalTextHash(machine.subtitlePackage.cues),
      canonicalTimingHash: c601CanonicalTimingHash(
        machine.subtitlePackage.cues,
      ),
      candidateUniverseHash: universe.semanticHash,
      inputHashes: machine.sourceArtifactHashes,
      officialArtifactHashes: {},
      candidateCounts: {},
      baselineMetrics: metrics,
      legacyP6Metrics: metrics,
      legacyEventEvaluation: {
        evaluable: 0,
        changed: 0,
        improved: 0,
        regressed: 0,
        neutral: 0,
        unevaluable: 0,
        renderedChangedCues: 0,
      },
      legacyOracle: {
        currentError: 0,
        bestExistingError: 0,
        bestLegalError: 0,
        unrestrictedError: 0,
        candidateOracleGain: 0,
      },
      pairwiseCount: 0,
      checks: [
        { name: "synthetic", passed: true, observed: "same", expected: "same" },
      ],
      baselineReplayPassed: true,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
      networkUsed: false,
      newAsrInferenceCount: 0,
      goldFileOpened: false,
    }),
  );
  const legacy = c611LegacyControlSchema.parse(
    c611WithHash({
      schemaVersion: "1.0.0",
      policyVersion: policy.policyVersion,
      artifactType: "c6-1-1-legacy-p6-control",
      originalManifestHash: SHA,
      originalSelectionsHash: SHA,
      samples: [],
      selectedProposalIds: [],
      originalCanonicalTextHash: baseline.canonicalTextHash,
      reproducedCanonicalTextHash: baseline.canonicalTextHash,
      canonicalTextParity: true,
      canonicalTimingParity: true,
      runtimeGoldInputCount: 0,
    }),
  );
  const artifacts = [
    baseline,
    stage.correlationGroups,
    stage.correlationAudit,
    stage.riskLedger,
    stage.proposals,
    stage.completeness,
    stage.features,
    folds,
    calibration,
    policy,
    legacy,
    freezeC61Profiles(SHA),
  ];
  const bindings = {
    proposalHash: stage.proposals.semanticHash,
    featureSchemaHash: stage.features.featureSchemaHash,
    featureTableHash: stage.features.semanticHash,
    candidateUniverseHash: universe.semanticHash,
    correlationPolicyHash: stage.correlationGroups.correlationPolicyHash,
    riskPolicyHash: stage.riskLedger.riskPolicyHash,
    foldHash: folds.semanticHash,
    policyHash: policy.semanticHash,
    baselineHash: baseline.semanticHash,
    inputHashes: {
      ...machine.sourceArtifactHashes,
      ...Object.fromEntries(
        C611_REQUIRED_PREVIOUS_INPUTS.map((name) => [`c61/${name}`, SHA]),
      ),
    },
  };
  return { machine, stage, folds, artifacts, bindings };
}
async function writeSynthetic(root: string, s: ReturnType<typeof synthetic>) {
  for (const artifact of s.artifacts)
    await writeFile(
      path.join(root, artifact.artifactType + ".json"),
      JSON.stringify(artifact),
    );
  await writeFile(
    path.join(root, "subtitle-package.production.json"),
    JSON.stringify(s.machine.subtitlePackage),
  );
}
describe("C6.1.1 complete freeze and evaluation barrier", () => {
  it("will not freeze complete files with an empty source-code inventory", async () => {
    const root = await temp();
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const s = synthetic();
    await writeSynthetic(a, s);
    await writeSynthetic(b, s);
    await expect(
      freezeC611MachinePair({
        a,
        b,
        repository: process.cwd(),
        sourceFiles: [],
        bindings: s.bindings,
      }),
    ).rejects.toThrow("SOURCE_FILES_INCOMPLETE");
  });
  it("freezes complete synthetic A/B source-mode artifacts before reading synthetic Gold and rejects subsequent corruption", async () => {
    const root = await temp();
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const s = synthetic();
    await writeSynthetic(a, s);
    await writeSynthetic(b, s);
    const gold = path.join(root, "synthetic.srt");
    await writeFile(gold, "1\n00:00:02,000 --> 00:00:05,000\n架空の評価文\n");
    // Vitest's bundled module resolver is not acceptance source execution.
    // Exercise the exact Node+tsx source-mode contract in an isolated child.
    const script = `
      import path from 'node:path';
      import {pathToFileURL} from 'node:url';
      import {writeFile} from 'node:fs/promises';
      const repository=process.cwd();
      const io=await import(pathToFileURL(path.join(repository,'packages/video-subtitler/src/consensus/c611-artifact-io.ts')).href);
      const gate=await import(pathToFileURL(path.join(repository,'packages/video-subtitler/src/consensus/c611-evaluation-barrier.ts')).href);
      const [a,b,serialized,gold]=process.argv.slice(1);
      const freeze=await io.freezeC611MachinePair({a,b,repository,sourceFiles:await io.c611RequiredSourceFiles(repository),bindings:JSON.parse(serialized)});
      const barrier=await gate.readC611GoldAfterFreeze({a,b,repository,gold});
      await writeFile(path.join(a,'machine-selective-mbr-features.json'),'{}');
      let corruptionBlocked=false;
      try {await gate.readC611GoldAfterFreeze({a,b,repository,gold:gold+'.must-not-touch'});} catch(e) {corruptionBlocked=String(e).includes('FROZEN_MACHINE_FILES_CHANGED');}
      console.log(JSON.stringify({sourceVerified:freeze.runtimeSourceExecutionVerified,sourceFiles:freeze.sourceCodeFiles.length,cues:barrier.goldIdentity.cueCount,ordered:Date.parse(barrier.goldFirstReadAt)>=Date.parse(freeze.frozenAt),corruptionBlocked}));
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
        a,
        b,
        JSON.stringify(s.bindings),
        gold,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: path.join(process.cwd(), "tsconfig.base.json"),
        },
      },
    );
    const receipt = JSON.parse(stdout) as Record<string, unknown>;
    expect(receipt.sourceVerified).toBe(true);
    expect(receipt.sourceFiles).toBeGreaterThan(5);
    expect(receipt.cues).toBe(1);
    expect(receipt.ordered).toBe(true);
    expect(receipt.corruptionBlocked).toBe(true);
  }, 30000);
  it("rejects empty A/B directories rather than issuing an empty accepted freeze", async () => {
    const root = await temp();
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    await mkdir(a);
    await mkdir(b);
    await expect(
      freezeC611MachinePair({
        a,
        b,
        repository: process.cwd(),
        sourceFiles: [],
        bindings: synthetic().bindings,
      }),
    ).rejects.toThrow("INCOMPLETE");
  });
  it("a self-hashed forged empty pair cannot reach even a nonexistent Gold pathname", async () => {
    const root = await temp();
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const body = {
      schemaVersion: "1.0.0",
      policyVersion: "c6.1.1-fixed-alignment-selective-existing-mbr-v1",
      artifactType: "c6-1-1-machine-feature-freeze",
      frozenAt: "2026-01-01T00:00:00.000Z",
      runtimeNodeVersion: process.versions.node,
      sharedSourceEntry: "packages/shared/src/index.ts",
      runtimeSourceExecutionVerified: true,
      ...synthetic().bindings,
      machineFiles: [],
      machineAggregateHash: hash([]),
      sourceCodeFiles: [],
      sourceCodeAggregateHash: hash([]),
      frozenBeforeGold: true,
      aBMachineParity: true,
      runtimeGoldInputCount: 0,
      newAsrInferenceCount: 0,
      networkUsed: false,
    };
    for (const dir of [a, b])
      await writeFile(
        path.join(dir, "c6-1-1-machine-feature-freeze.json"),
        JSON.stringify(c611WithHash(body)),
      );
    await expect(
      readC611GoldAfterFreeze({
        a,
        b,
        repository: process.cwd(),
        gold: path.join(root, "MUST_NOT_TOUCH_GOLD.ass"),
      }),
    ).rejects.toThrow("INCOMPLETE");
  });
  it("strictly verifies all thirteen synthetic machine files and their bound artifact identities", async () => {
    const root = await temp();
    const s = synthetic();
    await writeSynthetic(root, s);
    await expect(
      requireC611CompleteMachine(root, s.bindings),
    ).resolves.toBeUndefined();
  });
  it("a wrong feature-table binding cannot borrow a valid directory hash", async () => {
    const root = await temp();
    const s = synthetic();
    await writeSynthetic(root, s);
    await expect(
      requireC611CompleteMachine(root, {
        ...s.bindings,
        featureTableHash: "b".repeat(64),
      }),
    ).rejects.toThrow("CROSS_BINDING");
  });
  it("detects stale self-hashes even before a caller can freeze the changed file bytes", async () => {
    const root = await temp();
    const s = synthetic();
    await writeSynthetic(root, s);
    await writeFile(
      path.join(root, "machine-selective-existing-candidate-proposals.json"),
      JSON.stringify({ ...s.stage.proposals, semanticHash: "b".repeat(64) }),
    );
    await expect(requireC611CompleteMachine(root, s.bindings)).rejects.toThrow(
      "SEMANTIC_HASH",
    );
  });
  it("rejects unknown machine fields and unexpected files rather than silently widening the frozen allowlist", async () => {
    const root = await temp();
    const s = synthetic();
    await writeSynthetic(root, s);
    const file = path.join(root, "c6-1-1-baseline.json");
    const original = await readFile(file, "utf8");
    await writeFile(
      file,
      JSON.stringify({ ...JSON.parse(original), unknownField: true }),
    );
    await expect(
      requireC611CompleteMachine(root, s.bindings),
    ).rejects.toThrow();
    await writeFile(file, original);
    await writeFile(path.join(root, "unexpected.json"), "{}");
    await expect(requireC611CompleteMachine(root, s.bindings)).rejects.toThrow(
      "UNEXPECTED",
    );
  });
  it("a self-hashed missing fold unit is still a proposal-set mismatch", async () => {
    const root = await temp();
    const s = synthetic();
    await writeSynthetic(root, s);
    const { semanticHash: unused, ...body } = s.folds;
    void unused;
    const changed = c611WithHash({ ...body, units: [] });
    await writeFile(
      path.join(root, "c6-1-1-calibration-folds.json"),
      JSON.stringify(changed),
    );
    await expect(
      requireC611CompleteMachine(root, {
        ...s.bindings,
        foldHash: changed.semanticHash,
      }),
    ).rejects.toThrow("PROPOSAL_SET");
  });
  it("source inventory includes the real machine, barrier and evaluation entrypoints while excluding build/dependency trees", async () => {
    const files = await c611RequiredSourceFiles(process.cwd());
    expect(files).toContain("packages/shared/src/index.ts");
    expect(files).toContain("scripts/evaluate-c6-1-1-selective-mbr.ts");
    expect(files).toContain("package-lock.json");
    expect(files).toContain("tests/c6-1-1-pipeline.test.ts");
    expect(files).toContain("vitest.config.ts");
    expect(
      files.some((p) => p.includes("/dist/") || p.includes("/node_modules/")),
    ).toBe(false);
  });
});
