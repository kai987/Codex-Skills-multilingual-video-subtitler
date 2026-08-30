import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import ts from "typescript";
import {
  atomicWriteFile,
  atomicWriteJson,
  c61BaselineSchema,
  c61ConsensusSafetySchema,
  c61ConsensusProfileFreezeSchema,
  c61GeneratedSchemas,
  c61OracleSchema,
  c61ProfileSelectionsSchema,
  c61QualityEvaluationSchema,
  c61ReadOnlyProofSchema,
  c61RegressionEvidenceSchema,
  c61RouteDecisionSchema,
  c61ShareableSummarySchema,
  c61ShadowManifestSchema,
  c61ValidationSchema,
  machineMultiAsrHypothesisUniverseSchema,
  machineMultiAsrRoverConsensusSchema,
  machineMultiAsrMbrConsensusSchema,
  machineMultiAsrTokenLatticeSchema,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
  type C61MachineFreeze,
} from "@mvl/shared";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
  machineQualitySemanticHash as hash,
} from "@mvl/video-subtitler";
import {
  c61FileHash,
  c61Fingerprint,
  c61Json,
  c61TreeFiles,
  verifyC61MachineFreeze,
} from "../packages/video-subtitler/src/consensus/c61-artifact-io.js";
import {
  assembleC61Shadow,
  type C61AssembledShadow,
} from "../packages/video-subtitler/src/consensus/consensus-shadow-assembly.js";
import { readC61GoldAfterFreeze } from "../packages/video-subtitler/src/consensus/consensus-evaluation-barrier.js";
import {
  evaluateC61Oracles,
  evaluateC61Profiles,
} from "../packages/video-subtitler/src/consensus/consensus-quality-evaluator.js";
import { attributeC61ConsensusErrors } from "../packages/video-subtitler/src/consensus/consensus-error-attribution.js";
import { decideC61ResearchRoute } from "../packages/video-subtitler/src/consensus/c61-route-decision.js";

const { values } = parseArgs({
  options: {
    "machine-a": { type: "string" },
    "machine-b": { type: "string" },
    "evaluation-root": { type: "string" },
    task: { type: "string" },
    source: { type: "string" },
    gold: { type: "string" },
    output: { type: "string" },
    "run-regressions": { type: "boolean", default: false },
  },
});
function required(
  name:
    | "machine-a"
    | "machine-b"
    | "evaluation-root"
    | "task"
    | "source"
    | "gold"
    | "output",
): string {
  const value = values[name];
  if (!value?.trim()) throw new Error(`Missing --${name}.`);
  return path.resolve(value);
}
const roots = {
  a: required("machine-a"),
  b: required("machine-b"),
  evaluation: required("evaluation-root"),
  task: required("task"),
  source: required("source"),
  gold: required("gold"),
  output: required("output"),
};
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const header = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.1-consensus-investigation-v1" as const,
};
type Validation = ReturnType<typeof c61ValidationSchema.parse>;
const checks: Validation["checks"] = [];
function check(
  checkId: string,
  passed: boolean,
  detail: string,
  evidenceHashes: string[] = [],
): void {
  checks.push({ checkId, passed, detail, evidenceHashes });
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${checkId}: ${detail}\n`);
}
function semantic(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("semanticHash" in value))
    return false;
  const { semanticHash, ...body } = value;
  return typeof semanticHash === "string" && hash(body) === semanticHash;
}
function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
// Acceptance-only reconciliation: the official C6.0.1.12 overlap baseline
// counts every positively intersecting cue pair. The unchanged legacy quality
// evaluator instead counts adjacent entries whose start precedes the prior end.
// Preserve both definitions and their independently reproducible timing proof.
function countOverlapPairs(
  cues: readonly { id: string; start: number; end: number }[],
): {
  allPairs: number;
  adjacentPairs: number;
  pairEvidenceHash: string;
} {
  const allPairs: [number, number][] = [];
  const adjacentPairs: [number, number][] = [];
  for (const [leftIndex, left] of cues.entries()) {
    const previous = cues[leftIndex - 1];
    if (previous && left.start < previous.end)
      adjacentPairs.push([leftIndex - 1, leftIndex]);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < cues.length;
      rightIndex += 1
    ) {
      const right = cues[rightIndex];
      if (
        right &&
        Math.max(left.start, right.start) < Math.min(left.end, right.end)
      )
        allPairs.push([leftIndex, rightIndex]);
    }
  }
  return {
    allPairs: allPairs.length,
    adjacentPairs: adjacentPairs.length,
    pairEvidenceHash: hash({
      timings: cues.map(({ id, start, end }) => ({ id, start, end })),
      allPairs,
      adjacentPairs,
    }),
  };
}
async function ensureValidationChild(
  name: "logs" | "shareable",
): Promise<string> {
  const directory = path.join(roots.output, name);
  await mkdir(directory, { recursive: true });
  if (
    (await lstat(directory)).isSymbolicLink() ||
    !within(await realpath(roots.output), await realpath(directory))
  )
    throw new Error("C61_VALIDATION_CHILD_SYMLINK_REJECTED");
  return directory;
}
async function taskDirectory(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  if (
    entries.some(
      (entry) =>
        entry.isFile() && entry.name === "subtitle-package.needs-review.json",
    )
  )
    return root;
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  const match = matches[0];
  if (matches.length !== 1 || !match)
    throw new Error("C61_TASK_DIRECTORY_AMBIGUOUS");
  return path.join(root, match.name);
}
function siblingEvaluation(name: string): string {
  const basename = path.basename(roots.evaluation);
  if (!/-quality-evaluation-\d{8}$/u.test(basename))
    throw new Error("C61_EXPECTED_DATED_QUALITY_EVALUATION_ROOT");
  return path.join(
    path.dirname(roots.evaluation),
    basename.replace(/-quality-evaluation-(\d{8})$/u, `-${name}-$1`),
  );
}
async function strictJsonTree(root: string): Promise<number> {
  let count = 0;
  for (const file of await c61TreeFiles(root)) {
    if (!file.relativePath.endsWith(".json")) continue;
    const value = await c61Json(path.join(root, file.relativePath));
    if (!value || typeof value !== "object")
      throw new Error("C61_JSON_OBJECT_REQUIRED");
    if (
      "packageType" in value &&
      value.packageType === "multilingual-subtitle-package"
    )
      subtitlePackageSchema.parse(value);
    else if (file.relativePath.endsWith(".local-only.json"))
      machineVsGoldEvaluationSchema.parse(value);
    else {
      const type = "artifactType" in value ? value.artifactType : null;
      const entry = c61GeneratedSchemas.find(([name]) => name === type);
      if (!entry)
        throw new Error(`C61_UNREGISTERED_JSON_ARTIFACT:${file.relativePath}`);
      entry[1].parse(value);
      if (!semantic(value))
        throw new Error(
          `C61_INVALID_ARTIFACT_SEMANTIC_HASH:${file.relativePath}`,
        );
    }
    count += 1;
  }
  return count;
}
async function frozenInputParity(
  freeze: C61MachineFreeze,
  upstream: string,
): Promise<{ passed: boolean; codeCount: number }> {
  let passed = true;
  let codeCount = 0;
  for (const [name, expected] of Object.entries(freeze.inputHashes)) {
    let file: string;
    if (name.startsWith("code/consensus/")) {
      file = path.join(
        repository,
        "packages/video-subtitler/src/consensus",
        name.slice("code/consensus/".length),
      );
      codeCount += 1;
    } else if (name === "code/package-lock.json") {
      file = path.join(repository, "package-lock.json");
      codeCount += 1;
    } else file = path.join(upstream, name);
    if (!within(repository, file) && !within(upstream, file))
      throw new Error("C61_UNSAFE_FROZEN_INPUT_PATH");
    if ((await c61FileHash(file)) !== expected) passed = false;
  }
  return { passed, codeCount };
}

// Do not even stat the Gold path until both complete frozen machine trees verify.
const first = await verifyC61MachineFreeze(roots.a);
const second = await verifyC61MachineFreeze(roots.b);
if (first.semanticHash !== second.semanticHash)
  throw new Error("C61_VALIDATION_DUAL_FREEZE_MISMATCH");
const resolvedOutput = await realpath(roots.output).catch(
  async (error: unknown) => {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    return path.join(
      await realpath(path.dirname(roots.output)),
      path.basename(roots.output),
    );
  },
);
for (const root of [roots.a, roots.b, roots.evaluation, roots.task]) {
  if (
    within(await realpath(root), resolvedOutput) ||
    within(resolvedOutput, await realpath(root))
  )
    throw new Error("C61_VALIDATION_OUTPUT_MUST_BE_SEPARATE");
}
await mkdir(roots.output, { recursive: true });
const upstream = await taskDirectory(roots.task);
const baseline = c61BaselineSchema.parse(
  await c61Json(path.join(roots.a, "c6-1-baseline.json")),
);
const production = subtitlePackageSchema.parse(
  await c61Json(path.join(upstream, "subtitle-package.needs-review.json")),
);
const productionOverlapPairs = countOverlapPairs(production.cues);
const proof = c61ReadOnlyProofSchema.parse(
  await c61Json(path.join(roots.evaluation, "c6-1-read-only-proof.json")),
);
if (
  !semantic(proof) ||
  proof.machineFreezeHash !== first.semanticHash ||
  proof.goldFirstReadAt === null ||
  proof.goldBefore === null ||
  proof.goldAfter === null ||
  Date.parse(proof.goldFirstReadAt) < Date.parse(first.frozenAt)
)
  throw new Error("C61_INVALID_READ_ONLY_BARRIER_PROOF");
const barrier = await readC61GoldAfterFreeze(roots.a, roots.b, roots.gold);
const sourceBefore = await c61Fingerprint(roots.source);
const goldBefore = await c61Fingerprint(roots.gold);
const goldIdentity = {
  ...barrier.goldIdentity,
  firstReadAt: proof.goldFirstReadAt,
};
const sourceIdentity = {
  fileName: path.basename(roots.source),
  size: sourceBefore.size,
  sha256: sourceBefore.sha256,
};
check(
  "dual-freeze",
  true,
  "Both complete machine trees and their independently recomputed safety audit verified.",
  [first.semanticHash],
);
check(
  "read-only-recorded-proof",
  semantic(proof) &&
    hash(proof.sourceBefore) === hash(proof.sourceAfter) &&
    hash(proof.goldBefore) === hash(proof.goldAfter) &&
    hash(sourceBefore) === hash(proof.sourceBefore) &&
    sourceBefore.sha256 === baseline.sourceMediaSha256 &&
    hash(goldBefore) === hash(proof.goldBefore),
  "Source and Gold size, mtime and SHA-256 match the pre/post execution fingerprints.",
  [proof.semanticHash],
);
const codeParity = await frozenInputParity(first, upstream);
check(
  "frozen-source-artifacts-and-code",
  codeParity.passed && codeParity.codeCount > 0,
  `Verified all frozen machine inputs, including ${codeParity.codeCount} code/lock files.`,
  [hash(first.inputHashes)],
);

const machineFilesA = await c61TreeFiles(roots.a);
const machineFilesB = await c61TreeFiles(roots.b);
const semanticParity: Record<string, boolean> = {};
const byteParity: Record<string, boolean> = {};
for (const file of machineFilesA) {
  const other = machineFilesB.find(
    (entry) => entry.relativePath === file.relativePath,
  );
  byteParity[`machine/${file.relativePath}`] =
    other?.sha256 === file.sha256 && other.size === file.size;
  if (file.relativePath.endsWith(".json") && other)
    semanticParity[`machine/${file.relativePath}`] =
      hash(await c61Json(path.join(roots.a, file.relativePath))) ===
      hash(await c61Json(path.join(roots.b, file.relativePath)));
}
check(
  "machine-ab-file-set",
  machineFilesA.length === machineFilesB.length &&
    Object.values(byteParity).every(Boolean),
  `Compared ${machineFilesA.length} complete frozen files byte-for-byte.`,
  [first.machineAggregateHash, second.machineAggregateHash],
);
let schemaCount = 0;
for (const root of [
  roots.a,
  roots.b,
  roots.evaluation,
  siblingEvaluation("existing-candidate-oracle"),
  siblingEvaluation("legal-path-oracle"),
  siblingEvaluation("ablation"),
])
  schemaCount += await strictJsonTree(root);
check(
  "strict-artifact-schemas",
  true,
  `Strictly parsed ${schemaCount} JSON artifacts; all C6.1 wrappers also passed semantic hash verification.`,
  [hash(c61GeneratedSchemas.map(([name]) => name))],
);
let textMutation = Number(
  c601CanonicalTextHash(production.cues) !== baseline.canonicalTextHash,
);
let timingMutation = Number(
  c601CanonicalTimingHash(production.cues) !== baseline.canonicalTimingHash,
);
let productionFilesUnchanged = true;
for (const file of first.productionFiles)
  if (
    (await c61FileHash(path.join(upstream, file.relativePath))) !==
      file.sha256 ||
    (await stat(path.join(upstream, file.relativePath))).size !== file.size
  )
    productionFilesUnchanged = false;
check(
  "production-canonical-text-timing",
  textMutation === 0 &&
    timingMutation === 0 &&
    production.cues.length === baseline.cueCount,
  "Production canonical text, timing and cue count match the frozen baseline.",
  [baseline.canonicalTextHash, baseline.canonicalTimingHash],
);
check(
  "production-original-files",
  productionFilesUnchanged &&
    first.productionFiles.some((file) => file.relativePath.endsWith(".ass")) &&
    first.productionFiles.some((file) => file.relativePath.endsWith(".srt")) &&
    first.productionFiles.some((file) => file.relativePath.endsWith(".vtt")),
  `Rehashed ${first.productionFiles.length} original production JSON/ASS/SRT/VTT files.`,
  [hash(first.productionFiles)],
);

let qualityResult:
  ReturnType<typeof c61QualityEvaluationSchema.parse> | undefined;
let universeResult:
  ReturnType<typeof machineMultiAsrHypothesisUniverseSchema.parse> | undefined;
let safetyResult: ReturnType<typeof c61ConsensusSafetySchema.parse> | undefined;
let routeResult: ReturnType<typeof c61RouteDecisionSchema.parse> | undefined;
const originalOracle = c61OracleSchema.parse(
  await c61Json(
    path.join(
      siblingEvaluation("legal-path-oracle"),
      "c6-1-legal-path-oracle.json",
    ),
  ),
);
for (const [label, root] of [
  ["a", roots.a],
  ["b", roots.b],
] as const) {
  const universe = machineMultiAsrHypothesisUniverseSchema.parse(
    await c61Json(
      path.join(root, "machine-multi-asr-hypothesis-universe.json"),
    ),
  );
  const lattices = machineMultiAsrTokenLatticeSchema.parse(
    await c61Json(path.join(root, "machine-multi-asr-token-lattice.json")),
  ).lattices;
  const selections = c61ProfileSelectionsSchema.parse(
    await c61Json(path.join(root, "c6-1-profile-selections.json")),
  );
  const manifest = c61ShadowManifestSchema.parse(
    await c61Json(path.join(root, "c6-1-shadow-manifest.json")),
  );
  const safety = c61ConsensusSafetySchema.parse(
    await c61Json(
      path.join(root, "machine-multi-asr-consensus-safety-audit.json"),
    ),
  );
  const rover = machineMultiAsrRoverConsensusSchema.parse(
    await c61Json(path.join(root, "machine-multi-asr-rover-consensus.json")),
  );
  const mbr = machineMultiAsrMbrConsensusSchema.parse(
    await c61Json(path.join(root, "machine-multi-asr-mbr-consensus.json")),
  );
  const uniqueDecoderProfiles = [
    rover.results,
    mbr.candidateMbrResults,
    mbr.latticeMbrResults,
  ].every(
    (results) =>
      results.every(
        (result) =>
          typeof result.profileId === "string" && result.profileId.length > 0,
      ) &&
      new Set(
        results.map((result) => `${result.eventId}\0${result.profileId ?? ""}`),
      ).size === results.length,
  );
  check(
    `decoder-profile-identity-${label}`,
    uniqueDecoderProfiles,
    "Every ROVER, candidate-MBR and lattice-MBR result has an explicit, unique event/profile identity.",
    [rover.semanticHash, mbr.semanticHash],
  );
  const profileFreeze = c61ConsensusProfileFreezeSchema.parse(
    await c61Json(path.join(root, "c6-1-consensus-profile-freeze.json")),
  );
  const shadows: C61AssembledShadow[] = [];
  const shadowOverlapEvidence: {
    profileId: string;
    allPairs: number;
    adjacentPairs: number;
    timingHash: string;
    pairEvidenceHash: string;
  }[] = [];
  let shadowParity = true;
  for (const profile of manifest.profiles) {
    const assembled = assembleC61Shadow({
      profileId: profile.profileId,
      production,
      events: universe.events,
      paths: selections.paths,
      lattices,
    });
    const locate = (extension: string) => {
      const file = profile.files.find((entry) =>
        entry.relativePath.endsWith(extension),
      );
      if (!file) throw new Error("C61_INCOMPLETE_SHADOW_FORMATS");
      return path.join(root, file.relativePath);
    };
    const storedPackage = subtitlePackageSchema.parse(
      await c61Json(locate(".json")),
    );
    if (
      hash(storedPackage) !== hash(assembled.subtitlePackage) ||
      hash(profile.assemblyDecisions) !== hash(assembled.decisions) ||
      hash(profile.changedCueIds) !== hash(assembled.changedCueIds)
    )
      shadowParity = false;
    for (const extension of ["ass", "srt", "vtt"] as const)
      if (
        (await readFile(locate(`.${extension}`), "utf8")) !==
        assembled[extension]
      )
        shadowParity = false;
    if (
      c601CanonicalTimingHash(storedPackage.cues) !==
        baseline.canonicalTimingHash ||
      storedPackage.cues.length !== baseline.cueCount
    )
      shadowParity = false;
    shadowOverlapEvidence.push({
      profileId: profile.profileId,
      ...countOverlapPairs(storedPackage.cues),
      timingHash: c601CanonicalTimingHash(storedPackage.cues),
    });
    shadows.push(assembled);
  }
  check(
    `shadow-reassembly-${label}`,
    shadowParity,
    `Independently reassembled ${shadows.length} profiles; compared package, event decisions, all display formats, timing and cue count.`,
    [manifest.semanticHash],
  );
  check(
    `shadow-overlap-pair-invariance-${label}`,
    productionOverlapPairs.allPairs === 48 &&
      shadowOverlapEvidence.every(
        (entry) =>
          entry.allPairs === productionOverlapPairs.allPairs &&
          entry.adjacentPairs === productionOverlapPairs.adjacentPairs &&
          entry.timingHash === baseline.canonicalTimingHash &&
          entry.pairEvidenceHash === productionOverlapPairs.pairEvidenceHash,
      ),
    `Independently counted all intersecting pairs and adjacent-entry overlaps for every frozen shadow: ${JSON.stringify(shadowOverlapEvidence.map(({ profileId, allPairs, adjacentPairs }) => ({ profileId, allPairs, adjacentPairs })))}. No evaluator metric or subtitle timing was rewritten.`,
    [
      manifest.semanticHash,
      baseline.canonicalTimingHash,
      hash(shadowOverlapEvidence),
    ],
  );
  const mainLattices = lattices.filter((lattice) =>
    selections.paths.some(
      (selection) =>
        selection.profileId === "P0" &&
        selection.eventId === lattice.eventId &&
        selection.latticeHash === lattice.semanticHash,
    ),
  );
  if (
    mainLattices.length !==
    selections.paths.filter((selection) => selection.profileId === "P0").length
  )
    throw new Error("C61_MAIN_ORACLE_LATTICE_BINDING_MISMATCH");
  const oracle = evaluateC61Oracles({
    universe,
    lattices: mainLattices,
    gold: barrier.gold,
    machineFreezeHash: first.semanticHash,
  });
  check(
    `exact-oracle-recompute-${label}`,
    hash(oracle) === hash(originalOracle),
    "Recomputed existing-candidate, exact legal-path and unrestricted-slot evaluation from the frozen graph.",
    [oracle.semanticHash],
  );
  const profileEvidence = Object.fromEntries(
    manifest.profiles.map((profile) => [
      profile.profileId,
      {
        acousticEvidenceUsed:
          profile.profileId === "P5"
            ? new Set(
                rover.results
                  .filter(
                    (result) =>
                      result.profileId === "P5" && result.variant === "R5",
                  )
                  .flatMap((result) =>
                    result.candidateSupport
                      .filter(
                        (weight) =>
                          weight.acousticStatus === "EXACT_CACHE_MATCH",
                      )
                      .map((weight) => weight.acousticEvidenceId),
                  ),
              ).size
            : 0,
        unsafeRejected:
          [
            ...rover.results,
            ...mbr.candidateMbrResults,
            ...mbr.latticeMbrResults,
          ].filter(
            (result) =>
              result.profileId === profile.profileId &&
              result.outcome === "BLOCKED_UNSAFE",
          ).length +
          safety.paths.filter(
            (entry) => entry.profileId === profile.profileId && !entry.safe,
          ).length,
      },
    ]),
  );
  const recomputed = evaluateC61Profiles({
    universe,
    paths: selections.paths,
    shadows,
    gold: barrier.gold,
    goldIdentity,
    sourceIdentity,
    freeze: first,
    oracle,
    profileEvidence,
    profileFreeze,
  });
  const evaluationDirectory = path.join(roots.evaluation, label);
  const storedQuality = c61QualityEvaluationSchema.parse(
    await c61Json(
      path.join(evaluationDirectory, "c6-1-consensus-quality-evaluation.json"),
    ),
  );
  const route = decideC61ResearchRoute({
    quality: recomputed.quality,
    oracle,
    safety,
    abParity: true,
  });
  const storedRoute = c61RouteDecisionSchema.parse(
    await c61Json(path.join(evaluationDirectory, "c6-1-route-decision.json")),
  );
  let fullParity =
    hash(storedQuality) === hash(recomputed.quality) &&
    hash(storedRoute) === hash(route) &&
    hash(
      await c61Json(
        path.join(evaluationDirectory, "c6-1-consensus-error-attribution.json"),
      ),
    ) === hash(attributeC61ConsensusErrors(recomputed.quality, oracle));
  for (const [index, evaluation] of recomputed.fullEvaluations.entries()) {
    const profile = shadows[index];
    if (
      !profile ||
      hash(
        await c61Json(
          path.join(
            evaluationDirectory,
            `evaluation-${profile.profileId}.local-only.json`,
          ),
        ),
      ) !== hash(evaluation)
    )
      fullParity = false;
  }
  check(
    `gold-evaluation-recompute-${label}`,
    fullParity,
    "Independently reran profile/global evaluation, full local evidence, attribution and research-route gates after dual freeze.",
    [storedQuality.semanticHash, route.semanticHash],
  );
  qualityResult = storedQuality;
  universeResult = universe;
  safetyResult = safety;
  routeResult = route;
}
const evaluationA = await c61TreeFiles(path.join(roots.evaluation, "a"));
const evaluationB = await c61TreeFiles(path.join(roots.evaluation, "b"));
for (const file of evaluationA) {
  const other = evaluationB.find(
    (entry) => entry.relativePath === file.relativePath,
  );
  byteParity[`evaluation/${file.relativePath}`] = other?.sha256 === file.sha256;
  if (other)
    semanticParity[`evaluation/${file.relativePath}`] =
      hash(
        await c61Json(path.join(roots.evaluation, "a", file.relativePath)),
      ) ===
      hash(await c61Json(path.join(roots.evaluation, "b", file.relativePath)));
}
check(
  "evaluation-ab-parity",
  evaluationA.length === evaluationB.length &&
    Object.entries(byteParity)
      .filter(([name]) => name.startsWith("evaluation/"))
      .every(([, value]) => value),
  `Compared ${evaluationA.length} post-freeze A/B evaluation files.`,
  [hash(evaluationA), hash(evaluationB)],
);

// Architectural attestation, not a claim of operating-system packet capture.
const sourceFiles = Object.keys(first.inputHashes).filter((name) =>
  name.startsWith("code/consensus/"),
);
let forbiddenRuntimeCalls = 0;
let forbiddenGoldImports = 0;
let answerLiteralMatches = 0;
const goldFragments = barrier.gold
  .map((cue) => cue.text.normalize("NFKC").replace(/\s+/gu, ""))
  .filter((text) => Array.from(text).length >= 12);
for (const name of sourceFiles) {
  const filename = path.join(
    repository,
    "packages/video-subtitler/src/consensus",
    name.slice("code/consensus/".length),
  );
  const source = ts.createSourceFile(
    filename,
    await readFile(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const imported = node.moduleSpecifier.text;
      if (
        /^(?:node:)?(?:child_process|https?|net|dgram)$/u.test(imported) ||
        /^(?:undici|axios|node-fetch)$/u.test(imported)
      )
        forbiddenRuntimeCalls += 1;
      if (
        /(?:gold-evaluation|consensus-(?:oracle|quality)-evaluator|consensus-evaluation-barrier|consensus-error-attribution)/u.test(
          imported,
        )
      )
        forbiddenGoldImports += 1;
    }
    const dangerousCalls = [
      "fetch",
      "WebSocket",
      "spawn",
      "spawnSync",
      "exec",
      "execSync",
      "execFile",
      "execFileSync",
    ];
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      if (dangerousCalls.includes(name)) forbiddenRuntimeCalls += 1;
      if (
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          name === "require") &&
        node.arguments.some(
          (argument) =>
            ts.isStringLiteralLike(argument) &&
            /(?:child_process|node:https?|node:net|undici|node-fetch|consensus-(?:oracle|quality)-evaluator|consensus-evaluation-barrier)/u.test(
              argument.text,
            ),
        )
      )
        forbiddenRuntimeCalls += 1;
    }
    if (ts.isStringLiteralLike(node)) {
      const literal = node.text.normalize("NFKC").replace(/\s+/gu, "");
      if (goldFragments.some((fragment) => literal.includes(fragment)))
        answerLiteralMatches += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
check(
  "machine-runtime-no-inference-network-entrypoints",
  sourceFiles.length > 0 && forbiddenRuntimeCalls === 0,
  `AST inspected ${sourceFiles.length} frozen runtime modules: ${forbiddenRuntimeCalls} model-process/network entrypoints. Frozen runs declare inference=0, network=false; this is structural evidence, not packet capture.`,
  [hash(sourceFiles)],
);
check(
  "machine-runtime-gold-isolation",
  forbiddenGoldImports === 0 && answerLiteralMatches === 0,
  `Runtime evaluator/Gold imports=${forbiddenGoldImports}; long answer-text literals=${answerLiteralMatches}; machine freeze was verified before validator Gold access.`,
);

type Regression = ReturnType<typeof c61RegressionEvidenceSchema.parse>;
const regressionChecks: Regression["checks"] = [];
const regressionModelPolicy = {
  MVL_MFA_INTEGRATION_TEST: "0",
  MVL_SPEAKER_INTEGRATION_TEST: "0",
};
const modelOptInExclusions = [
  "tests/e2e/c5-17-forced-alignment-flow.test.ts: optional real MFA integration",
  "tests/c5-18-speaker-runtime.test.ts: optional real speaker model integration",
];
async function listTestFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listTestFiles(absolute)));
    else if (entry.isFile() && /^(?:c5-19|c6-).*\.test\.ts$/u.test(entry.name))
      files.push(path.relative(repository, absolute));
  }
  return files.toSorted();
}
async function runRegression(
  name: string,
  executable: string,
  args: string[],
  recorded: string[],
): Promise<void> {
  process.stdout.write(`RUN ${name}\n`);
  const started = Date.now();
  const chunks: Buffer[] = [];
  const isTestStage = ["unit", "e2e", "targeted"].includes(name);
  const command = isTestStage
    ? [
        "env",
        ...Object.entries(regressionModelPolicy).map(
          ([key, value]) => `${key}=${value}`,
        ),
        ...recorded,
      ]
    : recorded;
  if (isTestStage)
    chunks.push(
      Buffer.from(
        `C6.1 regression execution policy: ${JSON.stringify(regressionModelPolicy)}\nOnly the two opt-in real-model integrations are disabled because this investigation forbids new model inference: ${modelOptInExclusions.join("; ")}.\nExisting cached C6 protected and C5.17.2 review-delivery fixtures retain their normal discovery/environment; no cached test is disabled by this harness. All passed/skipped/failed counts below come from the actual Vitest summary, not an assumed count.\n`,
      ),
    );
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(executable, args, {
      cwd: repository,
      env: {
        ...process.env,
        ...(isTestStage ? regressionModelPolicy : {}),
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => chunks.push(Buffer.from(error.message)));
    child.on("close", (code) => resolve(code ?? 1));
  });
  const log = stripVTControlCharacters(Buffer.concat(chunks).toString("utf8"));
  const summary =
    log
      .split(/\r?\n/u)
      .filter((line) => /^\s*Tests\s/u.test(line))
      .at(-1) ?? "";
  const count = (word: string) =>
    Number(new RegExp(`(\\d+) ${word}`, "u").exec(summary)?.[1] ?? 0);
  const logPath = path.join(roots.output, "logs", `${name}.log`);
  await atomicWriteFile(logPath, log);
  regressionChecks.push({
    name,
    command,
    exitCode,
    passed: count("passed"),
    skipped: count("skipped"),
    failed: count("failed"),
    durationMs: Date.now() - started,
    logSha256: await c61FileHash(logPath),
  });
  process.stdout.write(
    `DONE ${name}: exit=${exitCode}; ${summary.trim() || "non-test check"}\n`,
  );
}
if (values["run-regressions"]) {
  await ensureValidationChild("logs");
  const npmCli = process.env.npm_execpath;
  const npm = (args: string[]): { executable: string; args: string[] } =>
    npmCli
      ? { executable: process.execPath, args: [npmCli, ...args] }
      : { executable: "npm", args };
  const commands: [string, string[]][] = [
    ["schemas", ["run", "generate:schemas"]],
    ["typecheck", ["run", "typecheck"]],
    ["lint", ["run", "lint"]],
    ["format-check", ["run", "format:check"]],
    ["build", ["run", "build"]],
    ["unit", ["test", "--", "--maxWorkers=4"]],
    ["e2e", ["run", "test:e2e", "--", "--maxWorkers=4"]],
    [
      "targeted",
      [
        "exec",
        "--",
        "vitest",
        "run",
        "--maxWorkers=4",
        ...(await listTestFiles(path.join(repository, "tests"))),
      ],
    ],
  ];
  for (const [name, args] of commands) {
    const command = npm(args);
    await runRegression(name, command.executable, command.args, [
      "npm",
      ...args,
    ]);
  }
  const skillValidator = path.join(
    homedir(),
    ".codex/skills/.system/skill-creator/scripts/quick_validate.py",
  );
  await runRegression(
    "skill-validation",
    "python3",
    [skillValidator, ".agents/skills/multilingual-video-subtitler"],
    [
      "python3",
      "skill-creator/scripts/quick_validate.py",
      ".agents/skills/multilingual-video-subtitler",
    ],
  );
}
const regressionBody = {
  ...header,
  artifactType: "c6-1-regression-evidence" as const,
  checks: regressionChecks,
  allPassed:
    regressionChecks.length === 9 &&
    regressionChecks.every(
      (entry) => entry.exitCode === 0 && entry.failed === 0,
    ) &&
    regressionChecks
      .filter((entry) => ["unit", "e2e", "targeted"].includes(entry.name))
      .every((entry) => entry.passed > 0),
};
const regressions = c61RegressionEvidenceSchema.parse({
  ...regressionBody,
  semanticHash: hash(regressionBody),
});
await atomicWriteJson(
  path.join(roots.output, "c6-1-regression-evidence.json"),
  regressions,
);
check(
  "full-regressions",
  regressions.allPassed,
  values["run-regressions"]
    ? `Nine sequential QA stages executed; raw local logs are SHA-256 bound. Actual test results: ${JSON.stringify(regressionChecks.filter((entry) => ["unit", "e2e", "targeted"].includes(entry.name)).map(({ name, passed, skipped, failed }) => ({ name, passed, skipped, failed })))}. The two real-model opt-in integrations are deliberately excluded; cached fixture tests are not disabled.`
    : "Not executed: rerun with --run-regressions; engineering acceptance remains incomplete.",
  [regressions.semanticHash],
);
check(
  "regression-no-new-model-policy",
  !values["run-regressions"] ||
    (["unit", "e2e", "targeted"] as const).every((name) =>
      regressionChecks.some(
        (entry) =>
          entry.name === name &&
          Object.entries(regressionModelPolicy).every(([key, value]) =>
            entry.command.includes(`${key}=${value}`),
          ),
      ),
    ),
  values["run-regressions"]
    ? `All test stages explicitly disabled only new-model opt-ins: ${modelOptInExclusions.join("; ")}. The three cached-fixture discovery variables were left untouched. Recorded skip totals remain the observed Vitest counts; skips are not reported as passed tests.`
    : "Regression commands were not executed; no model integration was invoked by this harness.",
  [hash(regressionModelPolicy), regressions.semanticHash],
);
const generatedSchemas = (
  await readdir(path.join(repository, "schemas"))
).filter((file) => file.endsWith(".schema.json"));
const schemaFilesPresent = c61GeneratedSchemas.every(([name]) =>
  generatedSchemas.includes(`${name}.schema.json`),
);
check(
  "generated-schema-files",
  schemaFilesPresent,
  `${generatedSchemas.length} total generated schemas; ${c61GeneratedSchemas.length} C6.1 registry entries must all be present.`,
);
const sourceAfter = await c61Fingerprint(roots.source);
const goldAfter = await c61Fingerprint(roots.gold);
const sourceReadOnly =
  hash(sourceBefore) === hash(sourceAfter) &&
  hash(sourceAfter) === hash(proof.sourceBefore);
const goldReadOnly =
  hash(goldBefore) === hash(goldAfter) &&
  hash(goldAfter) === hash(proof.goldBefore);
check(
  "post-validation-read-only",
  sourceReadOnly && goldReadOnly,
  "Source and Gold size, mtime and SHA-256 stayed unchanged through all validation stages.",
  [sourceAfter.sha256, goldAfter.sha256],
);
check(
  "post-validation-frozen-inputs",
  (await frozenInputParity(first, upstream)).passed,
  "Runtime source and original evidence still match frozen input identities after QA.",
);
let productionFilesAfterUnchanged = true;
for (const file of first.productionFiles) {
  if (
    (await c61FileHash(path.join(upstream, file.relativePath))) !==
      file.sha256 ||
    (await stat(path.join(upstream, file.relativePath))).size !== file.size
  )
    productionFilesAfterUnchanged = false;
}
const productionAfter = subtitlePackageSchema.parse(
  await c61Json(path.join(upstream, "subtitle-package.needs-review.json")),
);
textMutation = Math.max(
  textMutation,
  Number(
    c601CanonicalTextHash(productionAfter.cues) !== baseline.canonicalTextHash,
  ),
);
timingMutation = Math.max(
  timingMutation,
  Number(
    c601CanonicalTimingHash(productionAfter.cues) !==
      baseline.canonicalTimingHash,
  ),
);
check(
  "post-validation-production-files",
  productionFilesAfterUnchanged && textMutation === 0 && timingMutation === 0,
  "Production package and every original ASS/SRT/VTT byte hash remained unchanged after all QA commands.",
  [hash(first.productionFiles)],
);
await verifyC61MachineFreeze(roots.a);
await verifyC61MachineFreeze(roots.b);
if (!qualityResult || !universeResult || !safetyResult || !routeResult)
  throw new Error("C61_MISSING_VALIDATED_RESULTS");
// User-specified known-development baseline; never imported by a machine decoder
// or used to tune policy. A mismatch is a failed acceptance, not a new target.
const expectedBaseline = {
  cueCount: 161,
  exactCer: 0.6601049869,
  normalizedCer: 0.6015625,
  coverage: 0.96484375,
  missing: 6,
  hallucination: 1,
  materialErrors: 77,
  severeTiming: 53,
  startMae: 1.6091082275,
  endMae: 1.6078355157,
  boundaryP95: 5.385,
  medianIoU: 0.5824665676,
  overlap: 48,
};
const baselineMetrics = qualityResult.baseline;
check(
  "legacy-adjacent-overlap-metric",
  baselineMetrics.overlap === productionOverlapPairs.adjacentPairs,
  `Frozen legacy quality overlap=${baselineMetrics.overlap}; independent adjacent-entry count=${productionOverlapPairs.adjacentPairs}. Official C6.0.1.12 overlap uses all intersecting cue pairs=${productionOverlapPairs.allPairs}, expected=48. The two metrics have different counting conventions; this acceptance-only reconciliation leaves frozen policy, evaluator and quality artifacts unchanged.`,
  [
    qualityResult.semanticHash,
    baseline.canonicalTimingHash,
    productionOverlapPairs.pairEvidenceHash,
  ],
);
const baselineMismatches = Object.entries(expectedBaseline).flatMap(
  ([key, expected]) => {
    const actual =
      key === "overlap"
        ? productionOverlapPairs.allPairs
        : baselineMetrics[key as keyof typeof expectedBaseline];
    return Math.abs(actual - expected) <= 1e-9
      ? []
      : [{ metric: key, expected, actual }];
  },
);
check(
  "user-specified-p0-baseline",
  baselineMismatches.length === 0,
  baselineMismatches.length === 0
    ? "P0 matches every user-specified C6.0.1.12 acceptance metric within 1e-9; official overlap=48 is independently counted over all intersecting cue pairs, not the legacy adjacent-entry metric."
    : `Known baseline mismatch: ${JSON.stringify(baselineMismatches)}`,
  [qualityResult.semanticHash, productionOverlapPairs.pairEvidenceHash],
);
const preShareablePassed =
  checks.every((entry) => entry.passed) &&
  Object.values(byteParity).every(Boolean) &&
  Object.values(semanticParity).every(Boolean);
const summaryBody = {
  ...header,
  artifactType: "c6-1-shareable-summary" as const,
  engineeringPassed: preShareablePassed,
  route: routeResult.decision,
  c602Status: "HOLD" as const,
  productionMutationCount: textMutation + timingMutation,
  candidateCounts: Object.fromEntries(
    Object.entries(universeResult.summary).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  ),
  safetyCounts: safetyResult.counts,
  profiles: qualityResult.profiles.map((profile) => ({
    profileId: profile.profileId,
    normalizedCer: profile.metrics.normalizedCer,
    exactCer: profile.metrics.exactCer,
    materialErrors: profile.metrics.materialErrors,
    hallucination: profile.metrics.hallucination,
    missing: profile.metrics.missing,
    coverage: profile.metrics.coverage,
    improved: profile.improved,
    regressed: profile.regressed,
  })),
  localTextIncluded: false as const,
  rawAudioIncluded: false as const,
  absolutePathsIncluded: false as const,
};
const summary = c61ShareableSummarySchema.parse({
  ...summaryBody,
  semanticHash: hash(summaryBody),
});
const summaryText = JSON.stringify(summary);
const absolutePaths = /(?:\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)/u.test(
  summaryText,
);
const secrets =
  /(?:sk-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN .*PRIVATE KEY-----)/u.test(
    summaryText,
  );
const sourceText =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(summaryText) ||
  goldFragments.some((fragment) => summaryText.includes(fragment));
check(
  "shareable-allowlist-audit",
  !absolutePaths && !secrets && !sourceText,
  `Strict metric-only summary: absolute paths=${Number(absolutePaths)}, secrets=${Number(secrets)}, source/Gold text=${Number(sourceText)}; no audio, notes, events or subtitle strings copied.`,
  [summary.semanticHash],
);
await ensureValidationChild("shareable");
const unexpectedShareableFiles = (
  await c61TreeFiles(path.join(roots.output, "shareable"))
).filter((file) => file.relativePath !== "c6-1-shareable-summary.json");
check(
  "shareable-file-allowlist",
  unexpectedShareableFiles.length === 0,
  `Shareable directory permits only the audited metric summary; unexpected files=${unexpectedShareableFiles.length}.`,
);
if (
  !absolutePaths &&
  !secrets &&
  !sourceText &&
  unexpectedShareableFiles.length === 0
) {
  await atomicWriteJson(
    path.join(roots.output, "shareable", "c6-1-shareable-summary.json"),
    summary,
  );
}
const finalBody = {
  ...header,
  artifactType: "c6-1-validation" as const,
  checks,
  semanticParity,
  byteParity,
  productionTextMutation: textMutation,
  productionTimingMutation: timingMutation,
  runtimeGoldInputCount: 0,
  newAsrInferenceCount: 0,
  networkUsed: false,
  sourceReadOnly,
  goldReadOnly,
  engineeringPassed:
    checks.every((entry) => entry.passed) &&
    Object.values(semanticParity).every(Boolean) &&
    Object.values(byteParity).every(Boolean),
};
const validation = c61ValidationSchema.parse({
  ...finalBody,
  semanticHash: hash(finalBody),
});
await atomicWriteJson(
  path.join(roots.output, "c6-1-validation.json"),
  validation,
);
process.stdout.write(
  `${JSON.stringify({ engineeringPassed: validation.engineeringPassed, checks: checks.length, failed: checks.filter((entry) => !entry.passed).map((entry) => entry.checkId), schemaCount: generatedSchemas.length, regressionChecks: regressionChecks.length, validationHash: validation.semanticHash })}\n`,
);
if (!validation.engineeringPassed) process.exitCode = 1;
