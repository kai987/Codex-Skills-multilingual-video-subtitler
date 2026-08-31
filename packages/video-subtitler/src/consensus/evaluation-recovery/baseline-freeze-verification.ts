import path from "node:path";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  c6121BaselineSchema,
  c6121FileSchema,
  c612GroupLabelsSchema,
  c612CandidateLabelsSchema,
  c612RankingsSchema,
  c612GroupDecisionsSchema,
  c612ConfigurationsSchema,
  c612ValidationSchema,
  type C6121Baseline,
} from "@mvl/shared";
import { readC612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import {
  verifyRerankingFreeze,
  treeFiles,
  assertJsonSemanticHash,
} from "../top-k/c612-delivery-io.js";
import {
  hash,
  c6121Artifact,
  demand,
  validateC6121Artifact,
} from "./c6121-policy.js";
export type C6121File = ReturnType<typeof c6121FileSchema.parse>;
export async function fingerprintC6121(
  filename: string,
  role: string,
): Promise<C6121File> {
  const before = await stat(filename),
    digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) {
    demand(Buffer.isBuffer(chunk), "C6121_EXPECTED_BINARY_STREAM");
    digest.update(chunk);
  }
  const after = await stat(filename);
  demand(
    before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      before.ino === after.ino,
    "C6121_FILE_CHANGED_DURING_HASH",
  );
  let semanticHash: string | null = null;
  if (filename.endsWith(".json")) {
    const value: unknown = JSON.parse(await readFile(filename, "utf8"));
    if (
      value &&
      typeof value === "object" &&
      "semanticHash" in value &&
      typeof value.semanticHash === "string"
    )
      semanticHash = value.semanticHash;
  }
  return c6121FileSchema.parse({
    role,
    path: filename,
    bytes: before.size,
    sha256: digest.digest("hex"),
    semanticHash,
    mtimeMs: before.mtimeMs,
    inode: before.ino,
  });
}
export async function writeC6121Artifact(directory: string, value: unknown) {
  const parsed = validateC6121Artifact(value);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, String(parsed.artifactType) + ".json");
  await writeFile(file, JSON.stringify(parsed, null, 2) + "\n", { flag: "wx" });
  return file;
}
export async function readC6121Artifact(file: string) {
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  return validateC6121Artifact(value);
}
export async function verifyC6121Snapshot(baseline: C6121Baseline) {
  const files = [];
  for (const original of baseline.files) {
    const current = await fingerprintC6121(original.path, original.role);
    demand(
      hash(current) === hash(original),
      "C6121_FROZEN_INPUT_CHANGED:" +
        original.role +
        ":" +
        path.basename(original.path),
    );
    files.push(current);
  }
  demand(
    hash(files) === baseline.inputAggregateHash,
    "C6121_INPUT_AGGREGATE_CHANGED",
  );
  return hash(files);
}
export interface C6121RunPaths {
  taskA: string;
  taskB: string;
  frozenRepository: string;
  baselineRepository: string;
  baselineValidation: string;
  historicalRun: string;
  productionDirectories: string[];
  source: string;
}
/** This entry point deliberately has no Gold path or callback. */
export async function prepareC6121Baseline(paths: C6121RunPaths) {
  const frozen = await readC612FrozenInputs(
    paths.taskA,
    paths.frozenRepository,
  );
  const peer = await readC612FrozenInputs(paths.taskB, paths.frozenRepository);
  const reranking = await verifyRerankingFreeze(paths.taskA),
    otherReranking = await verifyRerankingFreeze(paths.taskB);
  demand(
    reranking.machineFreezeHash === frozen.freeze.semanticHash &&
      otherReranking.machineFreezeHash === peer.freeze.semanticHash,
    "C6121_RERANKING_FREEZE_BINDING",
  );
  const comparable = (files: typeof frozen.freeze.files) =>
    files.filter(
      (f) =>
        f.relativePath !== "machine-c6-1-2-acoustic-completeness-runtime.json",
    );
  demand(
    hash(comparable(frozen.freeze.files)) ===
      hash(comparable(peer.freeze.files)),
    "C6121_MACHINE_A_B_DIFFERENCE",
  );
  const schemaRead = async <T>(relative: string, parse: (x: unknown) => T) =>
    parse(await assertJsonSemanticHash(path.join(paths.taskA, relative)));
  const oldBindings = await schemaRead(
    "evaluation/gold-c6-1-2-fixed-group-labels.json",
    (v) => c612GroupLabelsSchema.parse(v),
  );
  const oldLabels = await schemaRead(
    "evaluation/gold-c6-1-2-top-k-candidate-labels.json",
    (v) => c612CandidateLabelsSchema.parse(v),
  );
  const rankings = await schemaRead(
    "reranking/c6-1-2-oof-candidate-rankings.json",
    (v) => c612RankingsSchema.parse(v),
  );
  const decisions = await schemaRead(
    "reranking/c6-1-2-oof-group-decisions.json",
    (v) => c612GroupDecisionsSchema.parse(v),
  );
  const configurations = await schemaRead(
    "reranking/machine-c6-1-2-group-shadow-configurations.json",
    (v) => c612ConfigurationsSchema.parse(v),
  );
  const validation = c612ValidationSchema.parse(
    await assertJsonSemanticHash(paths.baselineValidation),
  );
  demand(validation.passed, "C6121_BASELINE_ACCEPTANCE_FAILED");
  const files: C6121File[] = [];
  for (const [role, root] of [
    ["frozen-a", paths.taskA],
    ["frozen-b", paths.taskB],
  ] as const)
    for (const relative of await treeFiles(root))
      files.push(
        await fingerprintC6121(
          path.join(root, relative),
          role + "/" + relative,
        ),
      );
  for (const file of frozen.freeze.codeFiles)
    files.push(
      await fingerprintC6121(
        path.join(paths.frozenRepository, file.relativePath),
        "generation-source/" + file.relativePath,
      ),
    );
  files.push(
    await fingerprintC6121(paths.baselineValidation, "baseline-acceptance"),
  );
  const historicalRelative =
    "evaluation/c6-1-1-fixed-baseline-alignment-map.json";
  const historical = await fingerprintC6121(
    path.join(paths.historicalRun, historicalRelative),
    "historical-e1-map",
  );
  demand(
    historical.sha256 ===
      frozen.baseline.inputFiles.find(
        (f) => f.relativePath === historicalRelative,
      )?.sha256,
    "C6121_HISTORICAL_MAPPING_CHANGED",
  );
  files.push(historical);
  const source = await fingerprintC6121(paths.source, "source-video");
  demand(
    source.sha256 === frozen.freeze.sourceIdentity,
    "C6121_SOURCE_IDENTITY_CHANGED",
  );
  files.push(source);
  for (let index = 0; index < paths.productionDirectories.length; index++) {
    const root = paths.productionDirectories[index];
    demand(root, "C6121_PRODUCTION_PATH_MISSING");
    for (const expected of frozen.baseline.productionFiles) {
      const file = await fingerprintC6121(
        path.join(root, expected.relativePath),
        "production-" + String(index) + "/" + expected.relativePath,
      );
      demand(
        file.sha256 === expected.sha256 && file.bytes === expected.size,
        "C6121_PRODUCTION_FILE_MISMATCH",
      );
      files.push(file);
    }
  }
  const counts = {
    productionCueCount: frozen.production.cues.length,
    canonicalEventCount: frozen.universe.events.length,
    eligibleEventCount: new Set(frozen.topK.sets.map((s) => s.eventId)).size,
    inputCandidateCount: frozen.universe.candidates.length,
    includedCandidateCount: frozen.universe.candidates.filter(
      (candidate) => candidate.inclusionStatus === "INCLUDED",
    ).length,
    topKCandidateCount: frozen.features.rows.length,
    frozenMachineGroupCount: frozen.mapping.groups.length,
    stableGoldBindingCount: oldBindings.rows.filter((r) =>
      r.status.startsWith("FIXED_"),
    ).length,
    goldBindingAmbiguousCount: oldBindings.rows.filter(
      (r) => r.status === "AMBIGUOUS",
    ).length,
    noMappingCount: oldBindings.rows.filter((r) => r.status === "NO_MAPPING")
      .length,
  };
  const expected = {
    productionCueCount: 161,
    canonicalEventCount: 199,
    eligibleEventCount: 141,
    inputCandidateCount: 1496,
    includedCandidateCount: 832,
    topKCandidateCount: 519,
    frozenMachineGroupCount: 113,
    stableGoldBindingCount: 20,
    goldBindingAmbiguousCount: 90,
    noMappingCount: 3,
  };
  // These are acceptance assertions for the user-pinned baseline, never runtime/model features.
  const checks = Object.entries(counts).map(([name, value]) => ({
    name,
    passed: value === expected[name as keyof typeof expected],
    observed: String(value),
    expected: String(expected[name as keyof typeof expected]),
  }));
  const git = (root: string) =>
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  const baselineCommit = git(paths.baselineRepository),
    generationSourceCommit = git(paths.frozenRepository);
  demand(
    baselineCommit === "d7667e30aac250b5f36ffd38f70637f858e0aff5",
    "C6121_BASELINE_COMMIT_CHANGED",
  );
  demand(
    checks.every((c) => c.passed),
    "C6121_PINNED_BASELINE_COUNTS_CHANGED:" +
      JSON.stringify(checks.filter((c) => !c.passed)),
  );
  const baseline = c6121BaselineSchema.parse(
    c6121Artifact("c6-1-2-1-baseline-freeze-verification", {
      machineFrozenAt: new Date().toISOString(),
      machineFreezeHashes: [
        frozen.freeze.semanticHash,
        peer.freeze.semanticHash,
      ],
      rerankingFreezeHashes: [
        reranking.semanticHash,
        otherReranking.semanticHash,
      ],
      sourceIdentity: source.sha256,
      generationSourceCommit,
      baselineCommit,
      files,
      inputAggregateHash: hash(files),
      productionTextHash: frozen.freeze.productionTextHash,
      productionTimingHash: frozen.freeze.productionTimingHash,
      checks,
      passed: true,
      rawGoldReadCount: 0,
      modelExecutionCount: 0,
      networkUsed: false,
    }),
  );
  return {
    baseline,
    frozen,
    peer,
    oldBindings,
    oldLabels,
    rankings,
    decisions,
    configurations,
    source,
  };
}
export type C6121Prepared = Awaited<ReturnType<typeof prepareC6121Baseline>>;
