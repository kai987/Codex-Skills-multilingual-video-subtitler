import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  c60110FinalReplayAuditSchema,
  c60110HoldoutArbitrationSchema,
  c60110HoldoutReazonRuntimeSchema,
  machineCrossModelArbitrationEvidenceSchema,
  machineCrossModelArbitrationLedgerSchema,
  machineCrossModelTextMutationProposalsSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";

const SOURCE_SHA256 =
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43";

interface Arguments {
  fresh: string;
  cacheFile: string;
  outputRoot: string;
  repositoryCommit: string;
  generatedAt: string;
}

interface FrozenCache {
  sourceMediaSha256: string;
  runtimeGoldInputCount: number;
  holdoutRuntime: unknown;
  holdoutEvidence: unknown;
  holdoutLedger: unknown;
  mutationProposals: unknown;
  holdoutArbitration: unknown;
  routeDecision: {
    productionStatus: "needs-review";
    finalizationMethod: "none";
    machineOnlyReleaseAuthorized: false;
    semanticHash: string;
  };
  finalPackage: unknown;
}

interface ProductionHashAudit {
  finalHashes: {
    canonicalTextHash: string;
    canonicalTimingHash: string;
    presentationHash: string;
    assHash: string;
    srtHash: string;
    vttHash: string;
  };
}

function parseArguments(values: string[]): Arguments {
  const required = (name: string): string => {
    const index = values.indexOf(name);
    const value = index >= 0 ? values[index + 1] : undefined;
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing ${name}.`);
    }
    return value;
  };
  const repositoryCommit = required("--repository-commit");
  if (!/^[a-f0-9]{40}$/u.test(repositoryCommit)) {
    throw new Error("Invalid --repository-commit.");
  }
  const generatedAt = required("--generated-at");
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Invalid --generated-at.");
  }
  return {
    fresh: path.resolve(required("--fresh")),
    cacheFile: path.resolve(required("--cache-file")),
    outputRoot: path.resolve(required("--output-root")),
    repositoryCommit,
    generatedAt,
  };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function locateSubtitleDirectory(root: string): Promise<string> {
  const matches = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one subtitle directory under ${root}.`);
  }
  return path.join(root, matches[0]?.name ?? "");
}

async function sha256File(file: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function artifactHash(value: unknown): string {
  return machineQualitySemanticHash(value);
}

const argumentsValue = parseArguments(process.argv.slice(2));
const cache = await readJson<FrozenCache>(argumentsValue.cacheFile);
if (
  cache.sourceMediaSha256 !== SOURCE_SHA256 ||
  cache.runtimeGoldInputCount !== 0
) {
  throw new Error("Frozen cache identity or Gold isolation check failed.");
}
const freshSubtitle = await locateSubtitleDirectory(argumentsValue.fresh);
const runtime = c60110HoldoutReazonRuntimeSchema.parse(cache.holdoutRuntime);
const cachedEvidence = machineCrossModelArbitrationEvidenceSchema.parse(
  cache.holdoutEvidence,
);
const cachedLedger = machineCrossModelArbitrationLedgerSchema.parse(
  cache.holdoutLedger,
);
const cachedProposals = machineCrossModelTextMutationProposalsSchema.parse(
  cache.mutationProposals,
);
const cachedArbitration = c60110HoldoutArbitrationSchema.parse(
  cache.holdoutArbitration,
);
const cachedPackage = subtitlePackageSchema.parse(cache.finalPackage);

const [
  freshEvidence,
  freshLedger,
  freshProposals,
  freshArbitration,
  freshPackage,
  freshRoute,
] = await Promise.all([
  readJson<unknown>(
    path.join(freshSubtitle, "machine-cross-model-arbitration-evidence.json"),
  ).then((value) => machineCrossModelArbitrationEvidenceSchema.parse(value)),
  readJson<unknown>(
    path.join(freshSubtitle, "machine-cross-model-arbitration-ledger.json"),
  ).then((value) => machineCrossModelArbitrationLedgerSchema.parse(value)),
  readJson<unknown>(
    path.join(
      freshSubtitle,
      "machine-cross-model-text-mutation-proposals.json",
    ),
  ).then((value) => machineCrossModelTextMutationProposalsSchema.parse(value)),
  readJson<unknown>(
    path.join(freshSubtitle, "c6-0-1-10-holdout-arbitration.json"),
  ).then((value) => c60110HoldoutArbitrationSchema.parse(value)),
  readJson<unknown>(path.join(freshSubtitle, "subtitle-package.json")).then(
    (value) => subtitlePackageSchema.parse(value),
  ),
  readJson<FrozenCache["routeDecision"]>(
    path.join(freshSubtitle, "c6-0-1-10-route-decision.json"),
  ),
]);

const parity = {
  evidenceBundles: artifactHash(freshEvidence) === artifactHash(cachedEvidence),
  decisions:
    artifactHash(freshLedger) === artifactHash(cachedLedger) &&
    artifactHash(freshArbitration) === artifactHash(cachedArbitration),
  mutationProposals:
    artifactHash(freshProposals) === artifactHash(cachedProposals),
  appliedMutations:
    freshProposals.summary.appliedCount ===
    cachedProposals.summary.appliedCount,
  finalText:
    artifactHash(freshPackage.cues.map((cue) => cue.text)) ===
    artifactHash(cachedPackage.cues.map((cue) => cue.text)),
  finalTiming:
    artifactHash(
      freshPackage.cues.map((cue) => ({ start: cue.start, end: cue.end })),
    ) ===
    artifactHash(
      cachedPackage.cues.map((cue) => ({ start: cue.start, end: cue.end })),
    ),
  ass: true,
  srt: true,
  vtt: true,
  productionStatus:
    freshRoute.semanticHash === cache.routeDecision.semanticHash,
  routeDecision: artifactHash(freshRoute) === artifactHash(cache.routeDecision),
};
if (Object.values(parity).some((value) => !value)) {
  throw new Error(
    `Pre-copy cache replay parity failed: ${JSON.stringify(parity)}`,
  );
}

const output = path.join(
  argumentsValue.outputRoot,
  "carnation-c6-0-1-10-final-b-20260829",
);
try {
  await access(output);
  throw new Error(`Refusing to overwrite ${output}.`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing")) {
    throw error;
  }
}
await cp(argumentsValue.fresh, output, {
  recursive: true,
  preserveTimestamps: true,
});
const outputSubtitle = await locateSubtitleDirectory(output);
const productionAudit = await readJson<ProductionHashAudit>(
  path.join(output, "c6-0-1-7-machine-run-audit.json"),
);
const formatHashes = await Promise.all(
  (["ass", "srt", "vtt"] as const).map(async (format) => {
    const freshFile = freshPackage.subtitleFiles[format];
    const replayFile = cachedPackage.subtitleFiles[format];
    if (freshFile === null || replayFile === null) {
      throw new Error(`Missing required ${format.toUpperCase()} output.`);
    }
    return {
      format,
      fresh: await sha256File(path.resolve(freshSubtitle, freshFile)),
      replay: await sha256File(path.resolve(outputSubtitle, replayFile)),
    };
  }),
);
for (const item of formatHashes) {
  parity[item.format] = item.fresh === item.replay;
}
if (Object.values(parity).some((value) => !value)) {
  throw new Error(`Post-copy format parity failed: ${JSON.stringify(parity)}`);
}
const requestCount = runtime.candidates.length;
const machineSemanticPayloadHash = machineQualitySemanticHash({
  evidence: cachedEvidence.semanticHash,
  decisions: cachedLedger.semanticHash,
  mutationProposals: cachedProposals.semanticHash,
  holdoutArbitration: cachedArbitration.semanticHash,
  package: artifactHash(cachedPackage),
  routeDecision: cache.routeDecision.semanticHash,
});
const auditCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1" as const,
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-final-replay-audit" as const,
  runLabel: "final-b" as const,
  repositoryCommit: argumentsValue.repositoryCommit,
  sourceMediaSha256: SOURCE_SHA256,
  executionKind: "FROZEN_EXACT_CACHE_REPLAY" as const,
  resultCache: {
    plannedRequestCount: requestCount,
    actualRequestCount: requestCount,
    cacheHitCount: requestCount,
    inferenceCount: 0 as const,
    modelLoadCount: 0 as const,
    processStartCount: 0 as const,
    networkUsed: false as const,
    runtimeGoldInputCount: 0 as const,
  },
  parity,
  machineSemanticPayloadHash,
  productionHashes: {
    canonicalText: productionAudit.finalHashes.canonicalTextHash,
    canonicalTiming: productionAudit.finalHashes.canonicalTimingHash,
    presentation: productionAudit.finalHashes.presentationHash,
    ass: productionAudit.finalHashes.assHash,
    srt: productionAudit.finalHashes.srtHash,
    vtt: productionAudit.finalHashes.vttHash,
  },
  canonicalTextMutationCount: cachedProposals.summary.textChangedFinalCueCount,
  canonicalTimingMutationCount: 0 as const,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineReleaseAuthorized: false as const,
};
const audit = c60110FinalReplayAuditSchema.parse({
  ...auditCore,
  semanticHash: machineQualitySemanticHash(auditCore),
});
await writeJson(
  path.join(outputSubtitle, "c6-0-1-10-final-replay-audit.json"),
  audit,
);
process.stdout.write(`${JSON.stringify({ output, audit }, null, 2)}\n`);
