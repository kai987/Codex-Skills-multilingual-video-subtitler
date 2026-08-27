import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  blindProvenanceAuditSchema,
  InputError,
  machineBaselineEvidenceCoverageSchema,
  machineShadowFinalizationPolicySchema,
  machineShadowFinalizationSchema,
  subtitleFinalizationReportSchema,
  subtitlePackageSchema,
  type BlindGenerationInputManifest,
  type BlindProvenanceAudit,
  type MachineBaselineEvidenceCoverage,
  type MachineShadowFinalization,
  type MachineShadowFinalizationPolicy,
} from "@mvl/shared";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";

import { locateSubtitlePackage } from "../finalization-support.js";
import { c60SemanticHash } from "../finalization-risk-policy.js";
import { C601_MACHINE_SHADOW_POLICY } from "./policy.js";
import { sha256BlindFile } from "./gold-isolation.js";

type EvidenceStatus = "passed" | "failed" | "unknown" | "not-applicable";

interface EvidenceDimension {
  dimensionId: string;
  requiredForFinalCandidate: boolean;
  status: EvidenceStatus;
  evidenceRefs: string[];
  reasonCodes: string[];
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readJsonRecord(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  if (!(await isFile(filePath))) return null;
  const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function firstFiniteInteger(
  value: Record<string, unknown> | null,
  keys: readonly string[],
): number {
  if (value === null) return 0;
  for (const key of keys) {
    if (key in value) return finiteInteger(value[key]);
  }
  for (const nested of Object.values(value)) {
    if (
      typeof nested === "object" &&
      nested !== null &&
      !Array.isArray(nested)
    ) {
      const found = firstFiniteInteger(nested as Record<string, unknown>, keys);
      if (found > 0) return found;
    }
  }
  return 0;
}

function dimension(input: {
  dimensionId: string;
  required?: boolean;
  status: EvidenceStatus;
  evidenceRefs?: string[];
  reasonCodes?: string[];
}): EvidenceDimension {
  return {
    dimensionId: input.dimensionId,
    requiredForFinalCandidate: input.required ?? true,
    status: input.status,
    evidenceRefs: input.evidenceRefs ?? [],
    reasonCodes: input.reasonCodes ?? [],
  };
}

async function artifactDimension(input: {
  subtitleDirectory: string;
  dimensionId: string;
  relativePath: string;
  required?: boolean;
}): Promise<EvidenceDimension> {
  const present = await isFile(
    path.join(input.subtitleDirectory, input.relativePath),
  );
  return dimension({
    dimensionId: input.dimensionId,
    ...(input.required === undefined ? {} : { required: input.required }),
    status: present ? "passed" : "unknown",
    evidenceRefs: present ? [input.relativePath] : [],
    reasonCodes: present
      ? []
      : [`${input.dimensionId.toUpperCase()}_EVIDENCE_ABSENT`],
  });
}

export function createMachineShadowPolicy(): MachineShadowFinalizationPolicy {
  return machineShadowFinalizationPolicySchema.parse(
    C601_MACHINE_SHADOW_POLICY,
  );
}

export async function buildMachineBaselineEvidenceCoverage(input: {
  taskDirectory: string;
  generatedAt: string;
  manifest: BlindGenerationInputManifest;
}): Promise<MachineBaselineEvidenceCoverage> {
  const located = await locateSubtitlePackage(input.taskDirectory);
  const packageValue = subtitlePackageSchema.parse(
    JSON.parse(await readFile(located.packagePath, "utf8")),
  );
  if (packageValue.cues.length === 0) {
    throw new InputError("Blind machine output contains no subtitle cues.", {
      packagePath: located.packagePath,
    });
  }
  const subtitleFiles = packageValue.subtitleFiles;
  const srtPath =
    subtitleFiles.srt === null
      ? null
      : path.join(located.subtitleDirectory, subtitleFiles.srt);
  const vttPath =
    subtitleFiles.vtt === null
      ? null
      : path.join(located.subtitleDirectory, subtitleFiles.vtt);
  const assPath =
    subtitleFiles.ass === null
      ? null
      : path.join(located.subtitleDirectory, subtitleFiles.ass);
  let serializationPassed: boolean;
  let formatSemanticParityPassed: boolean;
  try {
    if (srtPath === null || vttPath === null || assPath === null) {
      throw new Error("missing-format");
    }
    const [srt, vtt, ass] = await Promise.all([
      readFile(srtPath, "utf8"),
      readFile(vttPath, "utf8"),
      readFile(assPath, "utf8"),
    ]);
    const parsedCounts = [
      parseSrt(srt).length,
      parseVtt(vtt).length,
      parseAss(ass).length,
    ];
    serializationPassed = parsedCounts.every(
      (count) => count === packageValue.cues.length,
    );
    formatSemanticParityPassed = serializationPassed;
  } catch {
    serializationPassed = false;
    formatSemanticParityPassed = false;
  }

  const finalReportPath = path.join(
    located.subtitleDirectory,
    "subtitle-finalization-report.json",
  );
  const finalReport = subtitleFinalizationReportSchema.parse(
    JSON.parse(await readFile(finalReportPath, "utf8")),
  );
  if (
    finalReport.status !== "needs-review" ||
    finalReport.finalizationMethod !== "none"
  ) {
    throw new InputError(
      "C6.0.1 blind production output must remain needs-review with no finalization method.",
      {
        status: finalReport.status,
        finalizationMethod: finalReport.finalizationMethod,
      },
    );
  }

  const reviewQueue = await readJsonRecord(
    path.join(located.subtitleDirectory, "final-review-queue.json"),
  );
  const unresolvedHighRiskRegionCount = firstFiniteInteger(reviewQueue, [
    "uniqueReviewGroupCount",
    "reviewEventCount",
    "humanReviewFindingCount",
  ]);
  const dimensions: EvidenceDimension[] = [
    dimension({
      dimensionId: "source-integrity",
      status:
        packageValue.source.fileName === input.manifest.sourceVideo.fileName
          ? "passed"
          : "failed",
      evidenceRefs: ["subtitle-package.json"],
      reasonCodes:
        packageValue.source.fileName === input.manifest.sourceVideo.fileName
          ? []
          : ["SOURCE_IDENTITY_MISMATCH"],
    }),
    dimension({
      dimensionId: "canonical-integrity",
      status: packageValue.cues.every(
        (cue) => cue.end > cue.start && cue.text.length > 0,
      )
        ? "passed"
        : "failed",
      evidenceRefs: ["subtitle-package.json"],
    }),
    dimension({
      dimensionId: "serialization-roundtrip",
      status: serializationPassed ? "passed" : "failed",
      evidenceRefs: [
        ...(subtitleFiles.srt === null ? [] : [subtitleFiles.srt]),
        ...(subtitleFiles.vtt === null ? [] : [subtitleFiles.vtt]),
        ...(subtitleFiles.ass === null ? [] : [subtitleFiles.ass]),
      ],
    }),
    dimension({
      dimensionId: "format-semantic-parity",
      status: formatSemanticParityPassed ? "passed" : "failed",
      evidenceRefs: ["subtitle-finalization-report.json"],
      reasonCodes: finalReport.qualityGate.formatSemanticParityPassed
        ? []
        : ["FINALIZATION_FORMAT_PARITY_NOT_PASSED"],
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "transcription-quality",
      relativePath: "transcription-quality.json",
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "final-integrity",
      relativePath: "final-subtitle-integrity.json",
    }),
    dimension({
      dimensionId: "asr-provenance",
      status: (await isFile(
        path.join(input.taskDirectory, "audio", "raw-transcription.json"),
      ))
        ? "passed"
        : "unknown",
      evidenceRefs: (await isFile(
        path.join(input.taskDirectory, "audio", "raw-transcription.json"),
      ))
        ? ["../audio/raw-transcription.json"]
        : [],
      reasonCodes: (await isFile(
        path.join(input.taskDirectory, "audio", "raw-transcription.json"),
      ))
        ? []
        : ["RAW_TRANSCRIPTION_PROVENANCE_ABSENT"],
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "token-timestamp-evidence",
      relativePath: "subtitle-timestamp-evidence-integrity.json",
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "vad-evidence",
      relativePath: "acoustic-scenes.json",
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "mapped-token-evidence",
      relativePath: "subtitle-timestamp-evidence-integrity.json",
      required: false,
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "mfa-evidence",
      relativePath: "subtitle-canonical-forced-alignment.json",
      required: false,
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "ctc-evidence",
      relativePath: "subtitle-local-ctc-boundary-evidence.json",
      required: false,
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "speaker-evidence",
      relativePath: "subtitle-local-speaker-evidence.json",
      required: false,
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "missing-dialogue-evidence",
      relativePath: "missing-dialogue-recovery.json",
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "hallucination-evidence",
      relativePath: "transcription-quality.json",
    }),
    await artifactDimension({
      subtitleDirectory: located.subtitleDirectory,
      dimensionId: "presentation-integrity",
      relativePath: "presentation-constraint-integrity.json",
    }),
  ];

  const metrics = await readJsonRecord(
    path.join(located.subtitleDirectory, "whisper-execution-metrics.json"),
  );
  const required = dimensions.filter((item) => item.requiredForFinalCandidate);
  const unknownSignalCount = dimensions.filter(
    (item) => item.status === "unknown",
  ).length;
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "machine-baseline-evidence-coverage" as const,
    coverageVersion: "c6.0.1-machine-evidence-coverage-v1" as const,
    generatedAt: input.generatedAt,
    generationRunId: input.manifest.generationRunId,
    inputManifestHash: input.manifest.inputSemanticHash,
    machinePackageHash: await sha256BlindFile(located.packagePath),
    dimensions,
    modelRuntimeIdentities: input.manifest.runtimeIdentities,
    modelExecutionCounts: {
      whisper: firstFiniteInteger(metrics, ["asrRequestCount"]),
      mfa: 0,
      ctc: 0,
      speaker: 0,
      separation: 0,
      sudachi: 0,
      openai: 0 as const,
      onlineSubtitleSearch: 0 as const,
      modelLoadCount: firstFiniteInteger(metrics, ["modelLoadCount"]),
      modelInferenceCount: firstFiniteInteger(metrics, ["asrRequestCount"]),
    },
    summary: {
      requiredDimensionCount: required.length,
      passedRequiredDimensionCount: required.filter(
        (item) => item.status === "passed",
      ).length,
      failedRequiredDimensionCount: required.filter(
        (item) => item.status === "failed",
      ).length,
      unknownRequiredDimensionCount: required.filter(
        (item) => item.status === "unknown",
      ).length,
      criticalEvidenceCoveragePassed: required.every(
        (item) => item.status === "passed",
      ),
      unresolvedHighRiskRegionCount,
      unknownSignalCount,
    },
  };
  return machineBaselineEvidenceCoverageSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}

export function evaluateMachineShadowFinalization(input: {
  generatedAt: string;
  manifest: BlindGenerationInputManifest;
  provenance: BlindProvenanceAudit;
  evidence: MachineBaselineEvidenceCoverage;
  policy?: MachineShadowFinalizationPolicy;
}): MachineShadowFinalization {
  const provenance = blindProvenanceAuditSchema.parse(input.provenance);
  const evidence = machineBaselineEvidenceCoverageSchema.parse(input.evidence);
  const policy = input.policy ?? createMachineShadowPolicy();
  const status = (id: string): EvidenceStatus =>
    evidence.dimensions.find((item) => item.dimensionId === id)?.status ??
    "unknown";
  const sourceIntegrityPassed = status("source-integrity") === "passed";
  const canonicalIntegrityPassed = status("canonical-integrity") === "passed";
  const serializationPassed = status("serialization-roundtrip") === "passed";
  const formatSemanticParityPassed =
    status("format-semantic-parity") === "passed";
  const unknownSignalCountZero = evidence.summary.unknownSignalCount === 0;
  const positiveCurrentOutputDefectEvidenceCount =
    evidence.summary.unresolvedHighRiskRegionCount;
  const checks = {
    sourceIntegrityPassed,
    canonicalIntegrityPassed,
    serializationPassed,
    formatSemanticParityPassed,
    unknownSignalCountZero,
    positiveCurrentOutputDefectEvidenceCountZero:
      positiveCurrentOutputDefectEvidenceCount === 0,
    criticalEvidenceCoveragePassed:
      evidence.summary.criticalEvidenceCoveragePassed,
    noUnresolvedHighRiskMachineRegion:
      evidence.summary.unresolvedHighRiskRegionCount === 0,
    noGoldDerivedProvenance: provenance.knownHumanIdentityMatches.length === 0,
    blindIsolationPassed: provenance.passed,
  };
  const rejected =
    !checks.sourceIntegrityPassed ||
    !checks.canonicalIntegrityPassed ||
    !checks.serializationPassed ||
    !checks.formatSemanticParityPassed ||
    !checks.noGoldDerivedProvenance ||
    !checks.blindIsolationPassed;
  const finalCandidate = !rejected && Object.values(checks).every(Boolean);
  const shadowMachineOutcome = rejected
    ? ("REJECTED" as const)
    : finalCandidate
      ? ("FINAL_CANDIDATE" as const)
      : ("REVIEW_REQUIRED" as const);
  const reasonCodes = rejected
    ? ["MACHINE_SHADOW_HARD_REJECTION"]
    : finalCandidate
      ? ["ALL_POSITIVE_MACHINE_EVIDENCE_CHECKS_PASSED"]
      : [
          ...(checks.unknownSignalCountZero
            ? []
            : ["UNKNOWN_SIGNAL_FAIL_CLOSED"]),
          ...(checks.positiveCurrentOutputDefectEvidenceCountZero
            ? []
            : ["CURRENT_OUTPUT_DEFECT_EVIDENCE_REQUIRES_REVIEW"]),
          ...(checks.criticalEvidenceCoveragePassed
            ? []
            : ["CRITICAL_MACHINE_EVIDENCE_INCOMPLETE"]),
        ];
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "machine-shadow-finalization" as const,
    policyVersion: policy.policyVersion,
    generatedAt: input.generatedAt,
    generationRunId: input.manifest.generationRunId,
    policyHash: policy.policyHash,
    evidenceCoverageHash: evidence.semanticHash,
    provenanceAuditHash: provenance.semanticHash,
    checks,
    positiveCurrentOutputDefectEvidenceCount,
    shadowMachineOutcome,
    productionStatus: "needs-review" as const,
    productionFinalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    blindAcceptanceRequired: true as const,
    reasonCodes,
  };
  return machineShadowFinalizationSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}
