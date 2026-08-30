import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  buildC611MachineStage,
  writeC611MachineStage,
} from "../packages/video-subtitler/src/consensus/c611-machine-stage.js";
import {
  freezeC611MachinePair,
  c611RequiredSourceFiles,
} from "../packages/video-subtitler/src/consensus/c611-artifact-io.js";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";

function arg(name: string, required = true): string {
  const index = process.argv.indexOf(`--${name}`),
    value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && required) throw new Error(`Missing --${name}`);
  return value ?? "";
}
if (arg("network") !== "off")
  throw new Error("C611_ACCEPTANCE_NETWORK_MUST_BE_OFF");
const repository = process.cwd();
const inputs = {
  task: arg("task"),
  previous: arg("previous"),
  baselineFile: arg("baseline"),
};
const mode = arg("mode", false) || "preflight";
const a = await buildC611MachineStage(inputs);
const b = await buildC611MachineStage({ ...inputs, reverse: true });
const identities = (s: typeof a) =>
  [
    s.proposals,
    s.features,
    s.completeness,
    s.correlationGroups,
    s.correlationAudit,
    s.riskLedger,
    s.folds,
    s.calibrationPolicy,
    s.policy,
    s.legacy,
  ].map((x) => x.semanticHash);
if (hash(identities(a)) !== hash(identities(b)))
  throw new Error("C611_PREFLIGHT_MACHINE_PARITY_FAILED");
console.log(
  JSON.stringify({
    stage: "machine-preflight",
    proposalCount: a.proposals.records.length,
    eligible: a.proposals.records.filter(
      (p) => p.eligibilityStatus === "ELIGIBLE",
    ).length,
    foldStatus: a.folds.status,
    independentGroups: a.folds.groups.length,
    folds: a.folds.folds.map((f) => ({
      foldId: f.foldId,
      eventCount: f.eventIds.length,
      groupCount: f.groupIds.length,
    })),
    legacyP6Selected: a.legacy.selectedProposalIds.length,
    proposalHash: a.proposals.semanticHash,
    featureHash: a.features.semanticHash,
    aBMachineParity: true,
  }),
);
if (mode !== "preflight") {
  if (mode !== "freeze")
    throw new Error("C611_MODE_MUST_BE_PREFLIGHT_OR_FREEZE");
  const output = arg("output"),
    stamp = arg("stamp");
  const aRoot = path.join(output, `carnation-c6-1-1-final-a-${stamp}`),
    bRoot = path.join(output, `carnation-c6-1-1-final-b-${stamp}`);
  await mkdir(aRoot, { recursive: false });
  await mkdir(bRoot, { recursive: false });
  await writeC611MachineStage(path.join(aRoot, "machine"), a);
  await writeC611MachineStage(path.join(bRoot, "machine"), b);
  const sourceFiles = await c611RequiredSourceFiles(repository);
  const freeze = await freezeC611MachinePair({
    a: path.join(aRoot, "machine"),
    b: path.join(bRoot, "machine"),
    repository,
    sourceFiles,
    bindings: {
      proposalHash: a.proposals.semanticHash,
      featureSchemaHash: a.features.featureSchemaHash,
      featureTableHash: a.features.semanticHash,
      candidateUniverseHash: a.universe.semanticHash,
      correlationPolicyHash: a.correlationGroups.correlationPolicyHash,
      riskPolicyHash: a.riskLedger.riskPolicyHash,
      foldHash: a.folds.semanticHash,
      policyHash: a.policy.semanticHash,
      baselineHash: a.baseline.semanticHash,
      inputHashes: a.inputHashes,
    },
  });
  console.log(
    JSON.stringify({
      stage: "machine-freeze",
      aRoot,
      bRoot,
      frozenAt: freeze.frozenAt,
      freezeHash: freeze.semanticHash,
      aBParity: true,
      goldRead: false,
    }),
  );
}
