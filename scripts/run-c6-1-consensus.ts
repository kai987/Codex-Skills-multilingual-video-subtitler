import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  atomicWriteJson,
  atomicWriteFile,
  c61BaselineSchema,
  c61InputInventorySchema,
  c61ReadOnlyProofSchema,
  c61ShadowManifestSchema,
  type C61ShadowManifest,
} from "@mvl/shared";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
  machineQualitySemanticHash as hash,
} from "@mvl/video-subtitler";
import { loadC61MachineArtifacts } from "../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";
import { investigateC61Machine } from "../packages/video-subtitler/src/consensus/c61-machine-investigation.js";
import {
  c61FileHash,
  c61Fingerprint,
  c61Json,
  c61TreeFiles,
  freezeC61MachinePair,
} from "../packages/video-subtitler/src/consensus/c61-artifact-io.js";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    output: { type: "string" },
    source: { type: "string" },
    "baseline-file": { type: "string" },
    prefix: { type: "string", default: "c6-1" },
    date: { type: "string", default: "20260830" },
    mode: { type: "string", default: "full" },
    network: { type: "string", default: "off" },
  },
});
function required(
  name: "task" | "output" | "source" | "baseline-file",
): string {
  const value = values[name];
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}
if (values.network !== "off" || values.mode !== "full")
  throw new Error("C61_REQUIRES_OFFLINE_FULL_MODE");
const prefix = values.prefix,
  date = values.date;
if (!/^[a-z0-9-]+$/u.test(prefix) || !/^\d{8}$/u.test(date))
  throw new Error("C61_UNSAFE_OUTPUT_NAME");
const task = required("task"),
  source = required("source"),
  output = required("output");
const sourceBefore = await c61Fingerprint(source);
const upstream = await loadC61MachineArtifacts(task);
const official = (await c61Json(required("baseline-file"))) as {
  machineDraftHash: string;
  cueCount: number;
  sourceMediaSha256: string;
  semanticHash: string;
  productionStatus: string;
};
const packageHash = await c61FileHash(
  path.join(upstream.taskDirectory, "subtitle-package.needs-review.json"),
);
if (
  official.machineDraftHash !== packageHash ||
  official.cueCount !== upstream.subtitlePackage.cues.length ||
  official.sourceMediaSha256 !== sourceBefore.sha256 ||
  official.productionStatus !== "needs-review"
)
  throw new Error("C61_OFFICIAL_BASELINE_MISMATCH");
const productionFiles = [];
for (const entry of (
  await readdir(upstream.taskDirectory, { withFileTypes: true })
).filter(
  (e) =>
    e.isFile() &&
    (/\.(ass|srt|vtt)$/u.test(e.name) ||
      /^subtitle-package.*\.json$/u.test(e.name)),
)) {
  productionFiles.push({
    relativePath: entry.name,
    sha256: await c61FileHash(path.join(upstream.taskDirectory, entry.name)),
    size: (await stat(path.join(upstream.taskDirectory, entry.name))).size,
  });
}
productionFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
const baselineBody = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.1-consensus-investigation-v1" as const,
  artifactType: "c6-1-baseline" as const,
  sourceMediaSha256: sourceBefore.sha256,
  machineDraftHash: packageHash,
  cueCount: upstream.subtitlePackage.cues.length,
  canonicalTextHash: c601CanonicalTextHash(upstream.subtitlePackage.cues),
  canonicalTimingHash: c601CanonicalTimingHash(upstream.subtitlePackage.cues),
  productionFiles,
  officialBaselineSemanticHash: official.semanticHash,
  baselineReplayPassed: true,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineOnlyReleaseAuthorized: false as const,
  c602Status: "HOLD" as const,
};
const baseline = c61BaselineSchema.parse({
  ...baselineBody,
  semanticHash: hash(baselineBody),
});
const root = (suffix: string) =>
  path.join(output, `${prefix}-${suffix}-${date}`);
const stageNames: Record<string, string> = {
  "machine-multi-asr-hypothesis-universe.json": "hypothesis-universe",
  "machine-multi-asr-text-representations.json": "text-representations",
  "machine-multi-asr-pairwise-alignments.json": "pairwise-alignments",
  "machine-multi-asr-multiple-alignments.json": "multiple-alignments",
  "machine-multi-asr-token-lattice.json": "token-lattice",
  "machine-multi-asr-confusion-network.json": "confusion-network",
  "machine-multi-asr-rover-consensus.json": "rover",
  "machine-multi-asr-mbr-consensus.json": "mbr",
  "machine-multi-asr-span-consensus.json": "span-consensus",
  "machine-multi-asr-consensus-safety-audit.json": "safety-audit",
};
// Collision-safe: reserve every fresh output before expensive algorithm work.
for (const suffix of [
  "baseline",
  ...Object.values(stageNames),
  "shadow-profiles",
  "final-a",
  "final-b",
])
  await mkdir(root(suffix), { recursive: false });
await atomicWriteJson(
  path.join(root("baseline"), "c6-1-baseline.json"),
  baseline,
);
const inventory = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.1-consensus-investigation-v1" as const,
  artifactType: "c6-1-input-inventory" as const,
  ...upstream.baselineInventory,
};
await atomicWriteJson(
  path.join(root("baseline"), "c6-1-input-inventory.json"),
  c61InputInventorySchema.parse({
    ...inventory,
    semanticHash: hash(inventory),
  }),
);
let policyHash = "";
for (const replay of ["a", "b"] as const) {
  const loaded = await loadC61MachineArtifacts(task);
  if (hash(loaded.sourceArtifactHashes) !== hash(upstream.sourceArtifactHashes))
    throw new Error("C61_INPUT_CHANGED_DURING_REPLAY");
  const run = investigateC61Machine(loaded, {
    permute: replay === "b",
    progress: console.log,
  });
  policyHash = run.profileFreeze.semanticHash;
  const target = root(`final-${replay}`);
  await atomicWriteJson(path.join(target, "c6-1-baseline.json"), baseline);
  await atomicWriteJson(
    path.join(target, "subtitle-package.production.json"),
    loaded.subtitlePackage,
  );
  for (const [name, artifact] of Object.entries(run.artifacts)) {
    await atomicWriteJson(path.join(target, name), artifact);
    const stage = stageNames[name];
    if (replay === "a" && stage)
      await atomicWriteJson(path.join(root(stage), name), artifact);
  }
  const profiles: C61ShadowManifest["profiles"] = [];
  for (const shadow of run.shadows) {
    const relative = `research-shadow/${shadow.profileId.toLowerCase()}`;
    const directory = path.join(target, relative);
    await mkdir(directory, { recursive: true });
    const stem = `subtitle.c6-1-${shadow.profileId.toLowerCase()}-shadow`;
    await atomicWriteJson(
      path.join(directory, "subtitle-package.research-shadow.json"),
      shadow.subtitlePackage,
    );
    for (const extension of ["ass", "srt", "vtt"] as const)
      await atomicWriteFile(
        path.join(directory, `${stem}.${extension}`),
        shadow[extension],
      );
    profiles.push({
      profileId: shadow.profileId,
      files: (await c61TreeFiles(directory)).map((f) => ({
        ...f,
        relativePath: `${relative}/${f.relativePath}`,
      })),
      cueCount: shadow.subtitlePackage.cues.length,
      changedCueIds: shadow.changedCueIds,
      canonicalTextHash: c601CanonicalTextHash(shadow.subtitlePackage.cues),
      canonicalTimingHash: c601CanonicalTimingHash(shadow.subtitlePackage.cues),
      assemblyDecisions: shadow.decisions,
    });
  }
  const manifestBody = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
    artifactType: "c6-1-shadow-manifest" as const,
    outputRole: "RESEARCH_SHADOW_OUTPUT" as const,
    privacy: "LOCAL_ONLY" as const,
    profiles,
    productionMutationCount: 0,
  };
  await atomicWriteJson(
    path.join(target, "c6-1-shadow-manifest.json"),
    c61ShadowManifestSchema.parse({
      ...manifestBody,
      semanticHash: hash(manifestBody),
    }),
  );
  if (replay === "a")
    await cp(
      path.join(target, "research-shadow"),
      path.join(root("shadow-profiles"), "research-shadow"),
      { recursive: true, errorOnExist: true, force: false },
    );
  console.log(
    JSON.stringify({
      replay,
      universe: run.universe.summary,
      safe: run.safety.engineeringPassed,
      profiles: profiles.map((p) => ({
        profileId: p.profileId,
        changedCues: p.changedCueIds.length,
      })),
    }),
  );
}
if (hash(await c61Fingerprint(source)) !== hash(sourceBefore))
  throw new Error("C61_SOURCE_CHANGED");
for (const file of productionFiles)
  if (
    (await c61FileHash(
      path.join(upstream.taskDirectory, file.relativePath),
    )) !== file.sha256
  )
    throw new Error("C61_PRODUCTION_CHANGED");
const codeHashes: Record<string, string> = {};
const consensusSource = path.resolve("packages/video-subtitler/src/consensus");
for (const entry of await readdir(consensusSource)) {
  if (
    entry.endsWith(".ts") &&
    !entry.includes("evaluator") &&
    !entry.includes("evaluation-barrier") &&
    !entry.includes("error-attribution")
  )
    codeHashes[`code/consensus/${entry}`] = await c61FileHash(
      path.join(consensusSource, entry),
    );
}
codeHashes["code/package-lock.json"] = await c61FileHash(
  path.resolve("package-lock.json"),
);
const freeze = await freezeC61MachinePair({
  a: root("final-a"),
  b: root("final-b"),
  policyHash,
  inputHashes: { ...upstream.sourceArtifactHashes, ...codeHashes },
  productionFiles,
});
const readOnly = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.1-consensus-investigation-v1" as const,
  artifactType: "c6-1-read-only-proof" as const,
  sourceBefore,
  sourceAfter: await c61Fingerprint(source),
  goldBefore: null,
  goldAfter: null,
  sourceUnchanged: true,
  goldUnchanged: null,
  machineFreezeHash: freeze.semanticHash,
  goldFirstReadAt: null,
  frozenAt: freeze.frozenAt,
};
await atomicWriteJson(
  path.join(root("baseline"), "c6-1-read-only-proof.json"),
  c61ReadOnlyProofSchema.parse({ ...readOnly, semanticHash: hash(readOnly) }),
);
console.log(
  JSON.stringify({
    machineFreeze: freeze.semanticHash,
    machineAggregateHash: freeze.machineAggregateHash,
    files: freeze.machineFiles.length,
    finalA: root("final-a"),
    finalB: root("final-b"),
    goldOpened: false,
    asrInference: 0,
  }),
);
