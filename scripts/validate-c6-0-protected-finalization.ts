import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  atomicWriteJson,
  c60ProtectedFinalizationReplaySummarySchema,
  c60ProtectedFinalizationValidationSchema,
  c60ProtectedRiskPolicySchema,
  InputError,
  subtitleFinalizationReportSchema,
  subtitleFinalizationRiskAssessmentSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
} from "@mvl/shared";
import {
  auditC5161ShareableArtifacts,
  auditC60ProtectedShareableArtifacts,
  c60PolicyEntry,
  c60SemanticHash,
  canonicalTimingHash,
  generateC60ProtectedShareableArtifacts,
  locateSubtitlePackage,
  sha256LocalFile,
  sha256Value,
  verifyC60ProtectedRiskPolicy,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    legacy: { type: "string" },
    default: { type: "string" },
    observe: { type: "string" },
    "enforce-a": { type: "string" },
    "enforce-b": { type: "string" },
    "negative-control": { type: "string" },
    "source-video": { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

type RequiredRunOption =
  | "legacy"
  | "default"
  | "observe"
  | "enforce-a"
  | "enforce-b"
  | "negative-control";

function requiredRunPath(key: RequiredRunOption): string {
  const value = values[key];
  if (value !== undefined) return value;
  throw new InputError(
    "Usage: npm run validate:c6-0-protected-finalization -- --legacy <task> --default <task> --observe <task> --enforce-a <task> --enforce-b <task> --negative-control <task> [--source-video <video> --human-reviewed-subtitle <ASS> --output <json>]",
  );
}

for (const key of [
  "legacy",
  "default",
  "observe",
  "enforce-a",
  "enforce-b",
  "negative-control",
] as const) {
  requiredRunPath(key);
}

type RunLabel =
  | "legacy"
  | "default"
  | "observe"
  | "enforce-a"
  | "enforce-b"
  | "negative-control";

interface LoadedRun {
  label: RunLabel;
  taskRoot: string;
  subtitleDirectory: string;
  report: ReturnType<typeof subtitleFinalizationReportSchema.parse>;
  subtitlePackage: ReturnType<typeof subtitlePackageSchema.parse>;
  presentation: ReturnType<typeof subtitlePresentationResolutionSchema.parse>;
  risk: ReturnType<
    typeof subtitleFinalizationRiskAssessmentSchema.parse
  > | null;
  replay: ReturnType<
    typeof c60ProtectedFinalizationReplaySummarySchema.parse
  > | null;
  finalPackageExists: boolean;
  serializedHashes: { srt: string; vtt: string; ass: string };
}

async function exists(filePath: string): Promise<boolean> {
  return await stat(filePath).then(
    (value) => value.isFile(),
    () => false,
  );
}

async function loadRun(label: RunLabel, rawTask: string): Promise<LoadedRun> {
  const taskRoot = path.resolve(rawTask);
  const located = await locateSubtitlePackage(taskRoot);
  const report = subtitleFinalizationReportSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          located.subtitleDirectory,
          "subtitle-finalization-report.json",
        ),
        "utf8",
      ),
    ) as unknown,
  );
  const packagePath = path.join(
    located.subtitleDirectory,
    report.outputPaths.subtitlePackage,
  );
  const subtitlePackage = subtitlePackageSchema.parse(
    JSON.parse(await readFile(packagePath, "utf8")) as unknown,
  );
  const presentation = subtitlePresentationResolutionSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          located.subtitleDirectory,
          report.outputPaths.presentationResolution ??
            "subtitle-presentation-resolution.json",
        ),
        "utf8",
      ),
    ) as unknown,
  );
  const riskPath = path.join(
    located.subtitleDirectory,
    "subtitle-finalization-risk-assessment.json",
  );
  const replayPath = path.join(
    taskRoot,
    "c6-0-protected-finalization-replay-summary.json",
  );
  const risk = (await exists(riskPath))
    ? subtitleFinalizationRiskAssessmentSchema.parse(
        JSON.parse(await readFile(riskPath, "utf8")) as unknown,
      )
    : null;
  const replay = (await exists(replayPath))
    ? c60ProtectedFinalizationReplaySummarySchema.parse(
        JSON.parse(await readFile(replayPath, "utf8")) as unknown,
      )
    : null;
  return {
    label,
    taskRoot,
    subtitleDirectory: located.subtitleDirectory,
    report,
    subtitlePackage,
    presentation,
    risk,
    replay,
    finalPackageExists: await exists(
      path.join(located.subtitleDirectory, "subtitle-package.final.json"),
    ),
    serializedHashes: {
      srt: await sha256LocalFile(
        path.join(located.subtitleDirectory, report.outputPaths.srt),
      ),
      vtt: await sha256LocalFile(
        path.join(located.subtitleDirectory, report.outputPaths.vtt),
      ),
      ass: await sha256LocalFile(
        path.join(located.subtitleDirectory, report.outputPaths.ass),
      ),
    },
  };
}

const [legacy, defaultRun, observe, enforceA, enforceB, negative] =
  await Promise.all([
    loadRun("legacy", requiredRunPath("legacy")),
    loadRun("default", requiredRunPath("default")),
    loadRun("observe", requiredRunPath("observe")),
    loadRun("enforce-a", requiredRunPath("enforce-a")),
    loadRun("enforce-b", requiredRunPath("enforce-b")),
    loadRun("negative-control", requiredRunPath("negative-control")),
  ]);
const runs = [legacy, defaultRun, observe, enforceA, enforceB, negative];

const runIdentity = (run: LoadedRun) => ({
  status: run.report.status,
  method: run.report.finalizationMethod,
  cueHash: sha256Value(run.subtitlePackage.cues),
  timingHash: canonicalTimingHash(run.subtitlePackage.cues),
  presentationHash: run.presentation.presentationCueHash,
  reviewCount: run.report.metrics.reviewItemCount,
  outputNames: {
    srt: run.report.outputPaths.srt,
    vtt: run.report.outputPaths.vtt,
    ass: run.report.outputPaths.ass,
    package: run.report.outputPaths.subtitlePackage,
  },
  finalPackageExists: run.finalPackageExists,
});
const legacyDefaultParity =
  JSON.stringify(runIdentity(legacy)) ===
  JSON.stringify(runIdentity(defaultRun));
const enforceSemanticParity =
  enforceA.replay !== null &&
  enforceB.replay !== null &&
  [
    "riskPolicyHash",
    "freshnessHash",
    "rootRiskHash",
    "riskAssessmentHash",
    "reviewDispositionHash",
    "protectedOutcome",
    "canonicalCueHashAfter",
    "canonicalTimingHashAfter",
    "presentationHash",
  ].every(
    (key) =>
      enforceA.replay?.[key as keyof typeof enforceA.replay] ===
      enforceB.replay?.[key as keyof typeof enforceB.replay],
  ) &&
  JSON.stringify(enforceA.serializedHashes) ===
    JSON.stringify(enforceB.serializedHashes);
const cueHashes = runs.map((run) => sha256Value(run.subtitlePackage.cues));
const timingHashes = runs.map((run) =>
  canonicalTimingHash(run.subtitlePackage.cues),
);
const presentationHashes = runs.map(
  (run) => run.presentation.presentationCueHash,
);
const canonicalCueParity = new Set(cueHashes).size === 1;
const canonicalTimingParity = new Set(timingHashes).size === 1;
const presentationParity = new Set(presentationHashes).size === 1;
const machineNegativeControlBlocked =
  negative.risk?.protectedOutcome === "MACHINE_ONLY_NOT_AUTHORIZED" &&
  negative.report.status === "needs-review" &&
  negative.report.finalizationMethod === "none" &&
  !negative.finalPackageExists &&
  negative.risk.signalAssessments.some(
    (signal) => signal.code === "MACHINE_ONLY_BLIND_ACCEPTANCE_REQUIRED",
  );
const unknownFailClosed =
  c60PolicyEntry("C6_TEST_UNKNOWN_BLOCKER") === undefined;
const integrityFailClosed =
  c60PolicyEntry("SOURCE_MEDIA_CHANGED")?.disposition === "FINAL_BLOCKER" &&
  c60PolicyEntry("SERIALIZATION_SEMANTIC_PARITY_FAILED")?.disposition ===
    "FINAL_BLOCKER";
const protectedRuns = [observe, enforceA, enforceB, negative];
const policyIntegrityPassed = protectedRuns.every((run) => {
  const policyPath = path.join(
    run.subtitleDirectory,
    "c6-0-protected-risk-policy.json",
  );
  return c60ProtectedRiskPolicySchema.safeParse(
    JSON.parse(readFileSyncPortable(policyPath)) as unknown,
  ).success;
});
function readFileSyncPortable(filePath: string): string {
  return readFileSync(filePath, "utf8");
}
const policyHashIntegrityPassed = protectedRuns.every((run) => {
  const policy = c60ProtectedRiskPolicySchema.parse(
    JSON.parse(
      readFileSyncPortable(
        path.join(run.subtitleDirectory, "c6-0-protected-risk-policy.json"),
      ),
    ) as unknown,
  );
  return verifyC60ProtectedRiskPolicy(policy);
});
const freshnessIntegrityPassed = protectedRuns.every(
  (run) => run.risk?.baselinePreservation.checks.freshnessIntegrityPassed,
);
const shareableAudits = await Promise.all(
  runs.map((run) =>
    run.risk === null
      ? auditC5161ShareableArtifacts(path.join(run.taskRoot, "shareable"))
      : auditC60ProtectedShareableArtifacts(
          path.join(run.taskRoot, "shareable-c6-0-protected-finalization"),
        ),
  ),
);
const shareableAuditPassed = shareableAudits.every(
  (audit) =>
    audit.validationPassed &&
    audit.absolutePathLeakCount === 0 &&
    audit.prohibitedSecretCount === 0 &&
    audit.brokenRelativeReferenceCount === 0,
);
const sourceHash =
  values["source-video"] === undefined
    ? null
    : await sha256LocalFile(path.resolve(values["source-video"]));
const humanHash =
  values["human-reviewed-subtitle"] === undefined
    ? null
    : await sha256LocalFile(path.resolve(values["human-reviewed-subtitle"]));
const inputReadOnlyVerified =
  (sourceHash === null ||
    sourceHash ===
      "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43") &&
  (humanHash === null ||
    humanHash ===
      "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e");
const expectedHumanAcceptance =
  observe.risk?.protectedOutcome === "FINAL_SAFE_WITH_ADVISORIES" &&
  observe.risk.summary.legacyBlockingFindingCount === 14 &&
  observe.risk.summary.positiveCurrentOutputDefectEvidenceCount === 0 &&
  observe.risk.summary.effectiveProtectedFinalBlockerCount === 0 &&
  observe.risk.summary.effectiveMandatoryReviewCount === 0 &&
  observe.risk.summary.effectiveAdvisoryReviewCount === 6 &&
  observe.risk.summary.preservationSupportedReviewCount === 1 &&
  observe.risk.summary.speakerRelationshipResolvedComponentCount === 1 &&
  observe.risk.summary.subtitleOverlapResolvedComponentCount === 0 &&
  enforceA.report.status === "human-validated" &&
  enforceA.report.finalizationMethod === "human" &&
  enforceA.finalPackageExists &&
  enforceB.report.status === "human-validated" &&
  enforceB.report.finalizationMethod === "human" &&
  enforceB.finalPackageExists;
const zeroExecution = protectedRuns.every((run) => run.replay !== null);
const passed =
  legacyDefaultParity &&
  enforceSemanticParity &&
  canonicalCueParity &&
  canonicalTimingParity &&
  presentationParity &&
  machineNegativeControlBlocked &&
  unknownFailClosed &&
  integrityFailClosed &&
  policyIntegrityPassed &&
  policyHashIntegrityPassed &&
  freshnessIntegrityPassed &&
  shareableAuditPassed &&
  inputReadOnlyVerified &&
  expectedHumanAcceptance &&
  zeroExecution;
const generatedAt = new Date().toISOString();
const base = {
  schemaVersion: "1.0.0" as const,
  artifactType: "c6-0-protected-finalization-validation" as const,
  validationVersion: "c6.0-protected-finalization-validation-v1" as const,
  generatedAt,
  runs: runs.map((run) => ({
    runLabel: run.label,
    taskName: path.basename(run.taskRoot),
    mode:
      run.label === "legacy" || run.label === "default"
        ? ("legacy" as const)
        : run.label === "observe"
          ? ("protected-observe" as const)
          : ("protected-enforce" as const),
    protectedOutcome: run.risk?.protectedOutcome ?? null,
    status: run.report.status,
    finalizationMethod: run.report.finalizationMethod,
    canonicalCueHash: sha256Value(run.subtitlePackage.cues),
    canonicalTimingHash: canonicalTimingHash(run.subtitlePackage.cues),
    presentationHash: run.presentation.presentationCueHash,
    riskAssessmentHash: run.risk?.semanticHash ?? null,
    finalPackageExists: run.finalPackageExists,
  })),
  legacyDefaultParity,
  enforceSemanticParity,
  canonicalCueParity,
  canonicalTimingParity,
  presentationParity,
  machineNegativeControlBlocked,
  unknownFailClosed,
  integrityFailClosed,
  policyIntegrityPassed: policyIntegrityPassed && policyHashIntegrityPassed,
  freshnessIntegrityPassed,
  shareableAuditPassed,
  inputReadOnlyVerified,
  modelInferenceCount: 0 as const,
  modelLoadCount: 0 as const,
  networkUsed: false as const,
  passed,
};
const validation = c60ProtectedFinalizationValidationSchema.parse({
  ...base,
  semanticHash: c60SemanticHash(base),
});
const outputPath = path.resolve(
  values.output ??
    path.join(
      path.dirname(legacy.taskRoot),
      "c6-0-protected-finalization-validation.json",
    ),
);
await atomicWriteJson(outputPath, validation, { overwrite: true });
await Promise.all(
  protectedRuns.map((run) =>
    generateC60ProtectedShareableArtifacts({
      taskRoot: run.taskRoot,
      subtitleDirectory: run.subtitleDirectory,
      validationPath: outputPath,
    }),
  ),
);
const finalShareableAudits = await Promise.all(
  runs.map((run) =>
    run.risk === null
      ? auditC5161ShareableArtifacts(path.join(run.taskRoot, "shareable"))
      : auditC60ProtectedShareableArtifacts(
          path.join(run.taskRoot, "shareable-c6-0-protected-finalization"),
        ),
  ),
);
const finalShareableAuditPassed = finalShareableAudits.every(
  (audit) =>
    audit.validationPassed &&
    audit.absolutePathLeakCount === 0 &&
    audit.prohibitedSecretCount === 0 &&
    audit.brokenRelativeReferenceCount === 0,
);
if (!finalShareableAuditPassed) {
  throw new InputError(
    "C6.0 shareable audit failed after adding the validation artifact.",
  );
}
process.stdout.write(
  `${JSON.stringify(
    {
      ok: validation.passed,
      outputPath,
      ...validation,
      shareableAudits: finalShareableAudits.map((audit, index) => ({
        runLabel: runs[index]?.label,
        validationPassed: audit.validationPassed,
        absolutePathLeakCount: audit.absolutePathLeakCount,
        prohibitedSecretCount: audit.prohibitedSecretCount,
        brokenRelativeReferenceCount: audit.brokenRelativeReferenceCount,
      })),
    },
    null,
    2,
  )}\n`,
);
if (!validation.passed) process.exitCode = 1;
