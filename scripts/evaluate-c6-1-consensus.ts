import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  atomicWriteJson,
  c61AblationSchema,
  c61ConsensusSafetySchema,
  c61ConsensusProfileFreezeSchema,
  c61OracleSchema,
  c61ProfileSelectionsSchema,
  c61ReadOnlyProofSchema,
  c61ShadowManifestSchema,
  machineMultiAsrHypothesisUniverseSchema,
  machineMultiAsrRoverConsensusSchema,
  machineMultiAsrMbrConsensusSchema,
  machineMultiAsrTokenLatticeSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "@mvl/video-subtitler";
import {
  c61Fingerprint,
  c61Json,
  verifyC61MachineFreeze,
} from "../packages/video-subtitler/src/consensus/c61-artifact-io.js";
import { readC61GoldAfterFreeze } from "../packages/video-subtitler/src/consensus/consensus-evaluation-barrier.js";
import {
  evaluateC61Oracles,
  evaluateC61Profiles,
} from "../packages/video-subtitler/src/consensus/consensus-quality-evaluator.js";
import { attributeC61ConsensusErrors } from "../packages/video-subtitler/src/consensus/consensus-error-attribution.js";
import { decideC61ResearchRoute } from "../packages/video-subtitler/src/consensus/c61-route-decision.js";
import type { C61AssembledShadow } from "../packages/video-subtitler/src/consensus/consensus-shadow-assembly.js";

const { values } = parseArgs({
  options: {
    "machine-a": { type: "string" },
    "machine-b": { type: "string" },
    gold: { type: "string" },
    source: { type: "string" },
    "source-proof": { type: "string" },
    output: { type: "string" },
    prefix: { type: "string", default: "c6-1" },
    date: { type: "string", default: "20260830" },
  },
});
function required(
  name:
    "machine-a" | "machine-b" | "gold" | "source" | "source-proof" | "output",
) {
  const value = values[name];
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}
const firstRoot = required("machine-a"),
  secondRoot = required("machine-b"),
  goldPath = required("gold"),
  sourcePath = required("source"),
  output = required("output");
const prefix = values.prefix,
  date = values.date;
if (!/^[a-z0-9-]+$/u.test(prefix) || !/^\d{8}$/u.test(date))
  throw new Error("C61_UNSAFE_OUTPUT_NAME");
const root = (suffix: string) =>
  path.join(output, `${prefix}-${suffix}-${date}`);
// No Gold access precedes this exported dual-barrier primitive.
const barrier = await readC61GoldAfterFreeze(firstRoot, secondRoot, goldPath);
const sourceProof = c61ReadOnlyProofSchema.parse(
  await c61Json(required("source-proof")),
);
const sourceNow = await c61Fingerprint(sourcePath);
if (
  hash(sourceNow) !== hash(sourceProof.sourceBefore) ||
  sourceProof.machineFreezeHash !== barrier.freeze.semanticHash
)
  throw new Error("C61_SOURCE_PROOF_MISMATCH");
for (const name of [
  "existing-candidate-oracle",
  "legal-path-oracle",
  "quality-evaluation",
  "ablation",
])
  await mkdir(root(name), { recursive: false });
let qualityHash: string | null = null;
for (const [label, machineRoot] of [
  ["a", firstRoot],
  ["b", secondRoot],
] as const) {
  const universe = machineMultiAsrHypothesisUniverseSchema.parse(
    await c61Json(
      path.join(machineRoot, "machine-multi-asr-hypothesis-universe.json"),
    ),
  );
  const lattices = machineMultiAsrTokenLatticeSchema.parse(
    await c61Json(
      path.join(machineRoot, "machine-multi-asr-token-lattice.json"),
    ),
  ).lattices;
  const selections = c61ProfileSelectionsSchema.parse(
    await c61Json(path.join(machineRoot, "c6-1-profile-selections.json")),
  );
  const profileFreeze = c61ConsensusProfileFreezeSchema.parse(
    await c61Json(path.join(machineRoot, "c6-1-consensus-profile-freeze.json")),
  );
  const manifest = c61ShadowManifestSchema.parse(
    await c61Json(path.join(machineRoot, "c6-1-shadow-manifest.json")),
  );
  const safety = c61ConsensusSafetySchema.parse(
    await c61Json(
      path.join(machineRoot, "machine-multi-asr-consensus-safety-audit.json"),
    ),
  );
  const rover = machineMultiAsrRoverConsensusSchema.parse(
    await c61Json(
      path.join(machineRoot, "machine-multi-asr-rover-consensus.json"),
    ),
  );
  const mbr = machineMultiAsrMbrConsensusSchema.parse(
    await c61Json(
      path.join(machineRoot, "machine-multi-asr-mbr-consensus.json"),
    ),
  );
  const shadows: C61AssembledShadow[] = [];
  for (const profile of manifest.profiles) {
    const file = (extension: string) => {
      const match = profile.files.find((f) =>
        f.relativePath.endsWith(extension),
      );
      if (!match) throw new Error("C61_SHADOW_FORMAT_MISSING");
      return path.join(machineRoot, match.relativePath);
    };
    shadows.push({
      profileId: profile.profileId,
      subtitlePackage: subtitlePackageSchema.parse(
        await c61Json(file(".json")),
      ),
      ass: await readFile(file(".ass"), "utf8"),
      srt: await readFile(file(".srt"), "utf8"),
      vtt: await readFile(file(".vtt"), "utf8"),
      changedCueIds: profile.changedCueIds,
      decisions: profile.assemblyDecisions,
    });
  }
  const oracle = evaluateC61Oracles({
    universe,
    lattices: lattices.filter((lattice) =>
      selections.paths.some(
        (selection) =>
          selection.profileId === "P0" &&
          selection.eventId === lattice.eventId &&
          selection.latticeHash === lattice.semanticHash,
      ),
    ),
    gold: barrier.gold,
    machineFreezeHash: barrier.freeze.semanticHash,
  });
  const profileEvidence = Object.fromEntries(
    manifest.profiles.map((p) => [
      p.profileId,
      {
        acousticEvidenceUsed:
          p.profileId === "P5"
            ? new Set(
                rover.results
                  .filter((r) => r.profileId === p.profileId)
                  .flatMap((r) =>
                    r.candidateSupport
                      .filter((w) => w.acousticStatus === "EXACT_CACHE_MATCH")
                      .map((w) => w.acousticEvidenceId),
                  ),
              ).size
            : 0,
        // A blocked proposal can safely fall back to Current. It is distinct
        // from an accepted-path safety violation, which must remain zero.
        unsafeRejected:
          [
            ...rover.results,
            ...mbr.candidateMbrResults,
            ...mbr.latticeMbrResults,
          ].filter(
            (result) =>
              result.profileId === p.profileId &&
              result.outcome === "BLOCKED_UNSAFE",
          ).length +
          safety.paths.filter((p2) => p2.profileId === p.profileId && !p2.safe)
            .length,
      },
    ]),
  );
  const evaluated = evaluateC61Profiles({
    universe,
    paths: selections.paths,
    shadows,
    gold: barrier.gold,
    goldIdentity: barrier.goldIdentity,
    sourceIdentity: {
      fileName: path.basename(sourcePath),
      size: sourceNow.size,
      sha256: sourceNow.sha256,
    },
    freeze: barrier.freeze,
    profileFreeze,
    oracle,
    profileEvidence,
  });
  if (qualityHash !== null && qualityHash !== evaluated.quality.semanticHash)
    throw new Error("C61_AB_EVALUATION_PARITY_FAILED");
  qualityHash = evaluated.quality.semanticHash;
  const evaluationDirectory = path.join(root("quality-evaluation"), label);
  await mkdir(evaluationDirectory);
  await atomicWriteJson(
    path.join(evaluationDirectory, "c6-1-consensus-quality-evaluation.json"),
    evaluated.quality,
  );
  const attribution = attributeC61ConsensusErrors(evaluated.quality, oracle);
  await atomicWriteJson(
    path.join(evaluationDirectory, "c6-1-consensus-error-attribution.json"),
    attribution,
  );
  // Full evaluator excerpts remain local-only and are not admitted to machine outputs.
  for (const [i, result] of evaluated.fullEvaluations.entries())
    await atomicWriteJson(
      path.join(
        evaluationDirectory,
        `evaluation-${shadows[i]?.profileId ?? i}.local-only.json`,
      ),
      result,
    );
  const route = decideC61ResearchRoute({
    quality: evaluated.quality,
    oracle,
    safety,
    abParity: true,
  });
  await atomicWriteJson(
    path.join(evaluationDirectory, "c6-1-route-decision.json"),
    route,
  );
  const {
    semanticHash: _oracleHash,
    artifactType: _oracleType,
    ...oracleFields
  } = oracle;
  void _oracleHash;
  void _oracleType;
  const existing = {
    ...oracleFields,
    artifactType: "c6-1-existing-candidate-oracle" as const,
  };
  if (label === "a") {
    await atomicWriteJson(
      path.join(root("legal-path-oracle"), "c6-1-legal-path-oracle.json"),
      oracle,
    );
    await atomicWriteJson(
      path.join(
        root("existing-candidate-oracle"),
        "c6-1-existing-candidate-oracle.json",
      ),
      c61OracleSchema.parse({ ...existing, semanticHash: hash(existing) }),
    );
    const names: Record<string, string> = {
      P0: "A0_CURRENT_FINAL",
      P1: "A2_SIMPLE_ROVER",
      P2: "A3_PROVIDER_BALANCED_ROVER",
      P3: "A4_CORRELATION_AWARE_ROVER",
      P4: "A5_PRONUNCIATION_AWARE_ROVER",
      P5: "A6_ACOUSTIC_AWARE_ROVER",
      P6: "A7_CANDIDATE_LEVEL_MBR",
      P7: "A8_LEGAL_LATTICE_MBR",
      P8: "A9_ABSTENTION_FIRST_CONSENSUS",
    };
    const rows = evaluated.quality.profiles.map((p) => ({
      ablationId: names[p.profileId] ?? p.profileId,
      profileId: p.profileId,
      evaluationOnly: false,
      metrics: p.metrics,
      normalizedEventError:
        p.eventResults.reduce((n, e) => n + (e.outputError ?? 0), 0) /
        Math.max(1, oracle.goldCharacterCount),
      changedEvents: p.changedEvents,
      improved: p.improved,
      regressed: p.regressed,
      novelPaths: p.novelPaths,
      semanticHash: p.semanticHash,
    }));
    const oracleRows = [
      ["A1_BEST_EXISTING_CANDIDATE_ORACLE", oracle.bestExistingCandidateError],
      ["A10_LEGAL_PATH_ORACLE", oracle.bestLegalPathError],
      [
        "A11_UNRESTRICTED_SLOT_ORACLE_UNSAFE_UPPER_BOUND",
        oracle.unrestrictedSlotError,
      ],
    ] as const;
    const ablationBody = {
      schemaVersion: "1.0.0" as const,
      policyVersion: "c6.1-consensus-investigation-v1" as const,
      artifactType: "c6-1-consensus-ablation" as const,
      evaluationOnly: true as const,
      machineFreezeHash: barrier.freeze.semanticHash,
      rows: [
        ...rows,
        ...oracleRows.map(([id, error]) => ({
          ablationId: id,
          profileId: id,
          evaluationOnly: true,
          metrics: null,
          normalizedEventError: error / Math.max(1, oracle.goldCharacterCount),
          changedEvents: 0,
          improved: 0,
          regressed: 0,
          novelPaths: 0,
          semanticHash: oracle.semanticHash,
        })),
      ],
    };
    await atomicWriteJson(
      path.join(root("ablation"), "c6-1-consensus-ablation.json"),
      c61AblationSchema.parse({
        ...ablationBody,
        semanticHash: hash(ablationBody),
      }),
    );
  }
  console.log(
    JSON.stringify({
      replay: label,
      baseline: evaluated.quality.baseline,
      best: evaluated.quality.bestGoldFreeProfile,
      route: route.decision,
      oracle: {
        eligible: oracle.evaluableEventCount,
        current: oracle.currentError,
        existing: oracle.bestExistingCandidateError,
        legal: oracle.bestLegalPathError,
        consensusGain: oracle.consensusSpecificOracleGain,
      },
      profiles: evaluated.quality.profiles.map((p) => ({
        id: p.profileId,
        cer: p.metrics.normalizedCer,
        material: p.metrics.materialErrors,
        improved: p.improved,
        regressed: p.regressed,
        changedCues: p.renderedChangedCueCount,
      })),
    }),
  );
}
const goldAfter = await c61Fingerprint(goldPath),
  sourceAfter = await c61Fingerprint(sourcePath);
if (
  hash(goldAfter) !== hash(barrier.fingerprint) ||
  hash(sourceAfter) !== hash(sourceNow)
)
  throw new Error("C61_READ_ONLY_EVALUATION_FAILED");
await verifyC61MachineFreeze(firstRoot);
await verifyC61MachineFreeze(secondRoot);
const proof = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.1-consensus-investigation-v1" as const,
  artifactType: "c6-1-read-only-proof" as const,
  sourceBefore: sourceProof.sourceBefore,
  sourceAfter,
  goldBefore: barrier.fingerprint,
  goldAfter,
  sourceUnchanged: true,
  goldUnchanged: true,
  machineFreezeHash: barrier.freeze.semanticHash,
  goldFirstReadAt: barrier.goldFirstReadAt,
  frozenAt: barrier.freeze.frozenAt,
};
await atomicWriteJson(
  path.join(root("quality-evaluation"), "c6-1-read-only-proof.json"),
  c61ReadOnlyProofSchema.parse({ ...proof, semanticHash: hash(proof) }),
);
