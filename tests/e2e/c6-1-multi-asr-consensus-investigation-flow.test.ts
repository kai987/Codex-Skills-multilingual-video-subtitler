import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type * as nodeFs from "node:fs/promises";
import type * as nodeChildProcess from "node:child_process";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import {
  atomicWriteJson,
  c61BaselineSchema,
  c61ConsensusProfileFreezeSchema,
  c61ConsensusProvenanceSchema,
  c61ConsensusSafetySchema,
  c61MachineFreezeSchema,
  c61OracleSchema,
  c61ProfileSelectionsSchema,
  c61QualityEvaluationSchema,
  c61RouteDecisionSchema,
  c61ShadowManifestSchema,
  machineMultiAsrConfusionNetworkSchema,
  machineMultiAsrHypothesisUniverseSchema,
  machineMultiAsrMbrConsensusSchema,
  machineMultiAsrMultipleAlignmentsSchema,
  machineMultiAsrPairwiseAlignmentsSchema,
  machineMultiAsrRoverConsensusSchema,
  machineMultiAsrSpanConsensusSchema,
  machineMultiAsrTextRepresentationsSchema,
  machineMultiAsrTokenLatticeSchema,
  subtitlePackageSchema,
  type C61HypothesisEvent,
  type C61HypothesisInput,
  type C61ShadowManifest,
} from "@mvl/shared";
import { formatAss } from "@mvl/subtitle-core";

import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../../packages/video-subtitler/src/blind-acceptance/gold-isolation.js";
import { machineQualitySemanticHash as hash } from "../../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import type { C61MachineArtifactInput } from "../../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";
import {
  c61FileHash,
  c61Fingerprint,
  c61TreeFiles,
  freezeC61MachinePair,
  verifyC61MachineFreeze,
} from "../../packages/video-subtitler/src/consensus/c61-artifact-io.js";
import { investigateC61Machine } from "../../packages/video-subtitler/src/consensus/c61-machine-investigation.js";
import {
  auditC61Consensus,
  resolveC61ProfileLattice,
} from "../../packages/video-subtitler/src/consensus/consensus-safety-audit.js";
import { assembleC61Shadow } from "../../packages/video-subtitler/src/consensus/consensus-shadow-assembly.js";
import { readC61GoldAfterFreeze } from "../../packages/video-subtitler/src/consensus/consensus-evaluation-barrier.js";
import {
  evaluateC61Oracles,
  evaluateC61Profiles,
} from "../../packages/video-subtitler/src/consensus/consensus-quality-evaluator.js";
import { decideC61ResearchRoute } from "../../packages/video-subtitler/src/consensus/c61-route-decision.js";

const access = vi.hoisted(() => ({
  goldPath: "",
  goldReads: 0,
  goldStats: 0,
  modelSpawns: 0,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile).mockImplementation(async (...args) => {
      if (args[0] === access.goldPath) access.goldReads += 1;
      return actual.readFile(...args);
    }),
    stat: vi.fn(actual.stat).mockImplementation(async (...args) => {
      if (args[0] === access.goldPath) access.goldStats += 1;
      return actual.stat(...args);
    }),
  };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeChildProcess>();
  return {
    ...actual,
    spawn: () => {
      access.modelSpawns += 1;
      throw new Error("C61_E2E_MODEL_PROCESS_FORBIDDEN");
    },
  };
});

const temporaryDirectories: string[] = [];
const SHA = "a".repeat(64);
afterEach(async () => {
  access.goldPath = "";
  access.goldReads = 0;
  access.goldStats = 0;
  access.modelSpawns = 0;
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function candidate(
  id: string,
  eventId: string,
  displayText: string,
  providerFamily: C61HypothesisInput["providerFamily"],
): C61HypothesisInput {
  const start = eventId === "event-1" ? 1 : eventId === "event-2" ? 3 : 6;
  return {
    inputRecordId: `synthetic-machine.json#${id}`,
    sourceCandidateId: id,
    eventId,
    providerFamily,
    modelIdentity: `${providerFamily}-synthetic-model`,
    requestId: `request:${id}`,
    windowType: "CORE_EXACT",
    sourceInterval: { start, end: start + 1 },
    displayText,
    pronunciationText: null,
    pronunciationEvidenceId: null,
    candidateRole:
      providerFamily === "CURRENT"
        ? "CURRENT_FINAL"
        : `${providerFamily}_CORE_EXACT`,
    correlationLineage: [providerFamily, eventId, "null-prompt"],
    provenanceHashes: [SHA],
    lineageVerified: true,
    sourceGlobalVerified: true,
    hardRejectionReasons: [],
    localizationBlockers: [],
    runtimeGoldInputCount: 0,
    humanDerived: false,
  };
}

function fixture(): C61MachineArtifactInput {
  const pkg = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.wav",
      container: "wav",
      durationSeconds: 10,
    },
    identity: {
      title: "Synthetic consensus fixture",
      season: null,
      episode: null,
      year: null,
    },
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
        start: 1,
        end: 2,
        text: "いかえ",
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: null,
      },
      {
        id: "cue-2",
        start: 3,
        end: 4,
        text: "はいはい",
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: null,
      },
    ],
  });
  const events: C61HypothesisEvent[] = pkg.cues.map((cue, index) => {
    const body = {
      eventId: `event-${index + 1}`,
      sourceInterval: { start: cue.start, end: cue.end },
      sourceCandidateIds: [`w${index + 1}`],
      finalCueIds: [cue.id],
      currentText: cue.text,
      finalSpan: {
        finalCueId: cue.id,
        spanStart: 0,
        spanEnd: Array.from(cue.text).length,
        spanText: cue.text,
        lineageStatus: "EXACT",
        modifiable: true,
        evidenceHash: SHA,
      },
    };
    return { ...body, semanticHash: hash(body) };
  });
  const absent = {
    eventId: "event-3",
    sourceInterval: { start: 6, end: 7 },
    sourceCandidateIds: ["untrusted"],
    finalCueIds: [],
    currentText: null,
    finalSpan: null,
  };
  events.push({ ...absent, semanticHash: hash(absent) });
  const candidates = [
    candidate("current-1", "event-1", "いかえ", "CURRENT"),
    candidate("w1", "event-1", "あかえ", "WHISPER"),
    candidate("w2", "event-1", "あかお", "WHISPER"),
    candidate("r1", "event-1", "いかう", "REAZON"),
    candidate("r2", "event-1", "うかう", "REAZON"),
    candidate("w1-copy", "event-1", "あかえ", "WHISPER"),
    candidate("current-2", "event-2", "はいはい", "CURRENT"),
    candidate("w3", "event-2", "はいはい", "WHISPER"),
    candidate("r3", "event-2", "はい", "REAZON"),
    {
      ...candidate("untrusted", "event-3", "採用禁止", "WHISPER"),
      modelIdentity: null,
    },
    {
      ...candidate("rejected", "event-1", "除外候補", "WHISPER"),
      hardRejectionReasons: ["CONFIRMED_SYNTHETIC_HARD_REJECTION"],
    },
  ];
  return {
    subtitlePackage: pkg,
    taskDirectory: "",
    events,
    candidates,
    sourceArtifactHashes: { "synthetic-machine.json": hash(candidates) },
    acousticScores: [],
    baselineInventory: {
      canonicalCueCount: pkg.cues.length,
      canonicalEventCount: events.length,
      historicalRawCandidateCount: candidates.length,
      historicalDispositionCounts: {},
      inputRowsByArtifact: { "synthetic-machine.json": candidates.length },
      sourceMediaSha256: SHA,
      sourceDurationSeconds: 10,
      newAsrInferenceCount: 0,
      networkUsed: false,
      runtimeGoldInputCount: 0,
    },
  };
}

type MachineRun = ReturnType<typeof investigateC61Machine>;
function mainLattices(run: MachineRun) {
  const hashes = new Set(
    run.paths
      .filter((entry) => entry.profileId === "P0")
      .map((entry) => entry.latticeHash),
  );
  return run.lattices.filter((lattice) => hashes.has(lattice.semanticHash));
}
const artifactSchemas: Record<string, z.ZodType> = {
  "machine-multi-asr-hypothesis-universe.json":
    machineMultiAsrHypothesisUniverseSchema,
  "machine-multi-asr-text-representations.json":
    machineMultiAsrTextRepresentationsSchema,
  "machine-multi-asr-pairwise-alignments.json":
    machineMultiAsrPairwiseAlignmentsSchema,
  "machine-multi-asr-multiple-alignments.json":
    machineMultiAsrMultipleAlignmentsSchema,
  "machine-multi-asr-token-lattice.json": machineMultiAsrTokenLatticeSchema,
  "machine-multi-asr-confusion-network.json":
    machineMultiAsrConfusionNetworkSchema,
  "machine-multi-asr-span-consensus.json": machineMultiAsrSpanConsensusSchema,
  "machine-multi-asr-rover-consensus.json": machineMultiAsrRoverConsensusSchema,
  "machine-multi-asr-mbr-consensus.json": machineMultiAsrMbrConsensusSchema,
  "machine-multi-asr-consensus-path-provenance.json":
    c61ConsensusProvenanceSchema,
  "machine-multi-asr-consensus-safety-audit.json": c61ConsensusSafetySchema,
  "c6-1-consensus-profile-freeze.json": c61ConsensusProfileFreezeSchema,
  "c6-1-profile-selections.json": c61ProfileSelectionsSchema,
};

async function writeMachine(
  root: string,
  input: C61MachineArtifactInput,
  run: MachineRun,
) {
  await mkdir(root, { recursive: true });
  const productionPath = path.join(root, "subtitle-package.production.json");
  await atomicWriteJson(productionPath, input.subtitlePackage);
  const productionFiles = [
    {
      relativePath: "subtitle-package.production.json",
      sha256: await c61FileHash(productionPath),
      size: (await readFile(productionPath)).length,
    },
  ];
  const baseline = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
    artifactType: "c6-1-baseline" as const,
    sourceMediaSha256: SHA,
    machineDraftHash: productionFiles[0]?.sha256 ?? SHA,
    cueCount: input.subtitlePackage.cues.length,
    canonicalTextHash: c601CanonicalTextHash(input.subtitlePackage.cues),
    canonicalTimingHash: c601CanonicalTimingHash(input.subtitlePackage.cues),
    productionFiles,
    officialBaselineSemanticHash: hash(input.subtitlePackage),
    baselineReplayPassed: true,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    c602Status: "HOLD" as const,
  };
  await atomicWriteJson(
    path.join(root, "c6-1-baseline.json"),
    c61BaselineSchema.parse({ ...baseline, semanticHash: hash(baseline) }),
  );
  for (const [name, artifact] of Object.entries(run.artifacts)) {
    const schema = artifactSchemas[name];
    expect(schema, name).toBeDefined();
    expect(schema?.safeParse(artifact).success, name).toBe(true);
    expect(
      schema?.safeParse({ ...artifact, injectedGoldWinner: "forbidden" })
        .success,
      name,
    ).toBe(false);
    await atomicWriteJson(path.join(root, name), artifact);
  }
  const profiles: C61ShadowManifest["profiles"] = [];
  for (const shadow of run.shadows) {
    const relative = `research-shadow/${shadow.profileId.toLowerCase()}`;
    const directory = path.join(root, relative);
    await mkdir(directory, { recursive: true });
    await atomicWriteJson(
      path.join(directory, "subtitle-package.research-shadow.json"),
      shadow.subtitlePackage,
    );
    for (const extension of ["ass", "srt", "vtt"] as const) {
      await writeFile(
        path.join(
          directory,
          `subtitle.c6-1-${shadow.profileId.toLowerCase()}-shadow.${extension}`,
        ),
        shadow[extension],
      );
    }
    profiles.push({
      profileId: shadow.profileId,
      files: (await c61TreeFiles(directory)).map((file) => ({
        ...file,
        relativePath: `${relative}/${file.relativePath}`,
      })),
      cueCount: shadow.subtitlePackage.cues.length,
      changedCueIds: shadow.changedCueIds,
      canonicalTextHash: c601CanonicalTextHash(shadow.subtitlePackage.cues),
      canonicalTimingHash: c601CanonicalTimingHash(shadow.subtitlePackage.cues),
      assemblyDecisions: shadow.decisions,
    });
  }
  const manifest = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
    artifactType: "c6-1-shadow-manifest" as const,
    outputRole: "RESEARCH_SHADOW_OUTPUT" as const,
    privacy: "LOCAL_ONLY" as const,
    profiles,
    productionMutationCount: 0,
  };
  await atomicWriteJson(
    path.join(root, "c6-1-shadow-manifest.json"),
    c61ShadowManifestSchema.parse({
      ...manifest,
      semanticHash: hash(manifest),
    }),
  );
  return productionFiles;
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mvl-c61-consensus-e2e-"));
  temporaryDirectories.push(root);
  return root;
}

describe("C6.1 complete Gold-isolated consensus investigation", () => {
  it("replays machine-only candidates through legal consensus, dual freeze, Gold oracles and safe route without mutating production", async () => {
    const root = await temporaryRoot();
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    access.goldPath = path.join(root, "post-freeze.synthetic.ass");
    const network = vi.fn(() => {
      throw new Error("C61_E2E_NETWORK_FORBIDDEN");
    });
    vi.stubGlobal("fetch", network);
    const input = fixture();
    const before = structuredClone(input);
    const first = investigateC61Machine(input);
    const second = investigateC61Machine(input, { permute: true });
    expect(first.universe.summary).toMatchObject({
      inputCandidateCount: 11,
      unsupportedProvenanceCount: 1,
      hardRejectedCount: 1,
      normalizedDuplicateCount: 1,
      unaccountedCandidateCount: 0,
    });
    expect(first.lattices).toHaveLength(8);
    expect(mainLattices(first)).toHaveLength(2);
    expect(first.paths.every((entry) => entry.latticeHash != null)).toBe(true);
    expect(first.shadows).toHaveLength(21);
    const decoderResults = [
      ...first.artifacts["machine-multi-asr-rover-consensus.json"].results,
      ...first.artifacts["machine-multi-asr-mbr-consensus.json"]
        .candidateMbrResults,
      ...first.artifacts["machine-multi-asr-mbr-consensus.json"]
        .latticeMbrResults,
    ];
    expect(decoderResults).toHaveLength(40);
    expect(
      new Set(
        decoderResults.map((result) => `${result.profileId}:${result.eventId}`),
      ).size,
    ).toBe(decoderResults.length);
    for (const result of decoderResults) {
      const { semanticHash, ...body } = result;
      expect(hash(body)).toBe(semanticHash);
      expect(
        first.paths.some(
          (entry) =>
            entry.profileId === result.profileId &&
            entry.eventId === result.eventId,
        ),
      ).toBe(true);
    }
    for (const [profileId, center, pronunciationAware] of [
      ["ALIGN_PRONUNCIATION_R2", "CENTER_PROVIDER_BALANCED_MEDOID", true],
      ["ALIGN_CENTER_CURRENT_R2", "CENTER_CURRENT", false],
      ["ALIGN_CENTER_MEDOID_R2", "CENTER_MEDOID", false],
    ] as const) {
      const paths = first.paths.filter(
        (entry) => entry.profileId === profileId,
      );
      expect(paths).toHaveLength(2);
      for (const entry of paths) {
        const lattice = resolveC61ProfileLattice(
          entry,
          first.lattices,
          first.paths,
        );
        expect(lattice).not.toBeNull();
        expect(
          first.artifacts[
            "machine-multi-asr-multiple-alignments.json"
          ].alignments.find(
            (alignment) => alignment.semanticHash === lattice?.alignmentHash,
          ),
        ).toMatchObject({ profile: center, pronunciationAware });
      }
    }
    expect(
      first.universe.eventScopes.find((event) => event.eventId === "event-3")
        ?.scope,
    ).toBe("UNLOCALIZABLE");
    expect(first.safety.engineeringPassed).toBe(true);
    expect(
      Object.values(first.safety.counts).every((count) => count === 0),
    ).toBe(true);
    expect(
      first.provenance.paths.every(
        (entry) =>
          entry.provenanceComplete &&
          entry.tokens.map((token) => token.outputSurface).join("") ===
            entry.outputText,
      ),
    ).toBe(true);
    expect(first.artifacts).toEqual(second.artifacts);
    expect(first.shadows).toEqual(second.shadows);
    expect(first.universe.runtimeGoldInputCount).toBe(0);
    expect(access.goldReads).toBe(0);
    expect(access.goldStats).toBe(0);
    const productionFiles = await writeMachine(a, input, first);
    await writeMachine(b, input, second);
    const productionBefore = await c61Fingerprint(
      path.join(a, "subtitle-package.production.json"),
    );
    await expect(
      readC61GoldAfterFreeze(a, b, access.goldPath),
    ).rejects.toThrow();
    expect(access.goldReads).toBe(0);
    expect(access.goldStats).toBe(0);
    const freeze = await freezeC61MachinePair({
      a,
      b,
      policyHash: first.profileFreeze.semanticHash,
      inputHashes: input.sourceArtifactHashes,
      productionFiles,
    });
    expect((await verifyC61MachineFreeze(a)).semanticHash).toBe(
      freeze.semanticHash,
    );
    expect((await verifyC61MachineFreeze(b)).machineAggregateHash).toBe(
      freeze.machineAggregateHash,
    );
    expect(
      c61MachineFreezeSchema.safeParse({ ...freeze, unknown: 1 }).success,
    ).toBe(false);
    expect(access.goldReads).toBe(0);
    expect(access.goldStats).toBe(0);
    // The synthetic answer is not present in either machine directory and only
    // becomes a file after all machine decisions and both outputs are frozen.
    await writeFile(
      access.goldPath,
      formatAss(
        input.subtitlePackage.cues.map((cue, index) => ({
          ...cue,
          text: index === 0 ? "あかう" : "はいはい",
        })),
      ),
    );
    const evaluationInput = await readC61GoldAfterFreeze(a, b, access.goldPath);
    expect(access.goldReads).toBe(1);
    expect(access.goldStats).toBe(2);
    expect(evaluationInput.goldFirstReadAt >= freeze.frozenAt).toBe(true);
    expect(evaluationInput.gold).toHaveLength(2);
    const oracle = evaluateC61Oracles({
      universe: first.universe,
      lattices: mainLattices(first),
      gold: evaluationInput.gold,
      machineFreezeHash: freeze.semanticHash,
    });
    expect(c61OracleSchema.safeParse(oracle).success).toBe(true);
    expect(oracle.bestLegalPathError).toBeLessThan(
      oracle.bestExistingCandidateError,
    );
    expect(oracle.consensusSpecificOracleGain).toBeGreaterThan(0);
    expect(oracle.unrestrictedSlotError).toBeLessThanOrEqual(
      oracle.bestLegalPathError,
    );
    expect(
      oracle.events.find((event) => event.eventId === "event-3")
        ?.evaluationStatus,
    ).toBe("NO_INCLUDED_CANDIDATE");
    const profileEvidence = Object.fromEntries(
      first.shadows.map((shadow) => [
        shadow.profileId,
        {
          acousticEvidenceUsed: 0,
          unsafeRejected: first.safety.paths.filter(
            (entry) => entry.profileId === shadow.profileId && !entry.safe,
          ).length,
        },
      ]),
    );
    const evaluated = evaluateC61Profiles({
      universe: first.universe,
      paths: first.paths,
      shadows: first.shadows,
      gold: evaluationInput.gold,
      goldIdentity: evaluationInput.goldIdentity,
      sourceIdentity: { fileName: "synthetic.wav", size: 0, sha256: SHA },
      freeze,
      profileFreeze: first.profileFreeze,
      oracle,
      profileEvidence,
    });
    expect(
      c61QualityEvaluationSchema.safeParse(evaluated.quality).success,
    ).toBe(true);
    expect(
      evaluated.quality.profiles.every(
        (profile) =>
          profile.metrics.cueCount === 2 && profile.timingHashUnchanged,
      ),
    ).toBe(true);
    const route = decideC61ResearchRoute({
      quality: evaluated.quality,
      oracle,
      safety: first.safety,
      abParity:
        first.artifacts["machine-multi-asr-token-lattice.json"].semanticHash ===
        second.artifacts["machine-multi-asr-token-lattice.json"].semanticHash,
    });
    expect(c61RouteDecisionSchema.safeParse(route).success).toBe(true);
    expect(route).toMatchObject({
      c602Status: "HOLD",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
    });
    expect(route.decision).not.toBe("CONSENSUS_ENGINEERING_INVALID");
    expect(route.evidenceHashes).toContain(oracle.semanticHash);
    expect(
      await c61Fingerprint(path.join(a, "subtitle-package.production.json")),
    ).toEqual(productionBefore);
    expect(await verifyC61MachineFreeze(a)).toEqual(freeze);
    expect(input).toEqual(before);
    expect(
      first.shadows.find((shadow) => shadow.profileId === "P0")?.subtitlePackage
        .cues,
    ).toEqual(input.subtitlePackage.cues);
    expect(network).not.toHaveBeenCalled();
    expect(access.modelSpawns).toBe(0);
  }, 30_000);

  it("rejects incomplete, forged and corrupted freezes before accessing Gold", async () => {
    const root = await temporaryRoot();
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    access.goldPath = path.join(root, "should-not-be-read.ass");
    await mkdir(a);
    await mkdir(b);
    await writeFile(access.goldPath, "not a usable subtitle");
    await expect(
      freezeC61MachinePair({
        a,
        b,
        policyHash: SHA,
        inputHashes: {},
        productionFiles: [],
      }),
    ).rejects.toThrow();
    await expect(
      readC61GoldAfterFreeze(a, b, access.goldPath),
    ).rejects.toThrow();
    await atomicWriteJson(path.join(a, "c6-1-machine-freeze.json"), {
      schemaVersion: "1.0.0",
      semanticHash: SHA,
    });
    await expect(
      readC61GoldAfterFreeze(a, b, access.goldPath),
    ).rejects.toThrow();
    expect(access.goldReads).toBe(0);
    expect(access.goldStats).toBe(0);
    await rm(path.join(a, "c6-1-machine-freeze.json"));
    const input = fixture();
    const run = investigateC61Machine(input);
    const productionFiles = await writeMachine(a, input, run);
    await writeMachine(b, input, run);
    const freeze = await freezeC61MachinePair({
      a,
      b,
      policyHash: run.profileFreeze.semanticHash,
      inputHashes: input.sourceArtifactHashes,
      productionFiles,
    });
    const frozenFile = path.join(
      b,
      "machine-multi-asr-hypothesis-universe.json",
    );
    await writeFile(frozenFile, `${await readFile(frozenFile, "utf8")} `);
    await expect(readC61GoldAfterFreeze(a, b, access.goldPath)).rejects.toThrow(
      "C61_FROZEN_MACHINE_FILES_CHANGED",
    );
    expect(access.goldReads).toBe(0);
    expect(access.goldStats).toBe(0);
    expect(await verifyC61MachineFreeze(a)).toEqual(freeze);
  }, 30_000);

  it("rejects a nonzero runtime Gold counter before alignment or rendering", () => {
    const input = fixture();
    const contaminated = {
      ...input,
      candidates: input.candidates.map((entry, index) =>
        index === 0 ? { ...entry, runtimeGoldInputCount: 1 } : entry,
      ),
    };
    expect(() =>
      investigateC61Machine(contaminated as unknown as C61MachineArtifactInput),
    ).toThrow();
    expect(access.goldReads).toBe(0);
    expect(access.modelSpawns).toBe(0);
  });

  it("binds supplementary paths to their exact graph and rejects mismatched or ambiguous graph identity", () => {
    const input = fixture();
    const run = investigateC61Machine(input);
    const entry = run.paths.find(
      (path) =>
        path.profileId === "ALIGN_PRONUNCIATION_R2" &&
        path.eventId === "event-1",
    );
    if (!entry?.path)
      throw new Error("Synthetic supplementary path is missing");
    const primary = run.paths.find(
      (path) => path.profileId === "P0" && path.eventId === "event-1",
    );
    expect(entry.latticeHash).not.toBe(primary?.latticeHash);
    expect(
      resolveC61ProfileLattice(entry, [...run.lattices].reverse(), run.paths)
        ?.semanticHash,
    ).toBe(entry.latticeHash);
    expect(
      resolveC61ProfileLattice(
        { ...entry, latticeHash: null },
        [...run.lattices].reverse(),
        run.paths,
      )?.semanticHash,
    ).toBe(primary?.latticeHash);
    expect(
      resolveC61ProfileLattice({ ...entry, latticeHash: null }, run.lattices),
    ).toBeNull();
    const forged = { ...entry, latticeHash: "f".repeat(64) };
    expect(
      resolveC61ProfileLattice(forged, run.lattices, run.paths),
    ).toBeNull();
    expect(() =>
      auditC61Consensus({
        paths: [forged],
        lattices: run.lattices,
        productionTextMutation: 0,
        productionTimingMutation: 0,
        runtimeGoldInputCount: 0,
      }),
    ).toThrow("C61_MISSING_LATTICE_FOR_SAFETY");
    const shadow = assembleC61Shadow({
      profileId: entry.profileId,
      production: input.subtitlePackage,
      events: run.universe.events,
      paths: [{ ...forged, path: { ...entry.path, displayText: "あかう" } }],
      lattices: run.lattices,
    });
    expect(shadow.subtitlePackage.cues).toEqual(input.subtitlePackage.cues);
    expect(
      shadow.decisions.find((decision) => decision.eventId === "event-1"),
    ).toMatchObject({ status: "BLOCKED_UNSAFE" });
    expect(access.goldReads).toBe(0);
    expect(access.modelSpawns).toBe(0);
  });
});
