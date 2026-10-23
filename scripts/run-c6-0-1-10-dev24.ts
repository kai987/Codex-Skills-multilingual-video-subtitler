import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  GoldCrossModelComplementarityEvaluation,
  GoldSecondAsrControlRegression,
  MachineCrossModelComparison,
  MachineCrossModelCtcArbitration,
  MachineIndependentAsrCandidates,
  MachineSecondAsrDiagnosticSet,
  MachineSecondAsrStability,
} from "@mvl/shared";
import {
  buildC60110ControlRegressionEvaluation,
  buildC60110Dev24Evaluation,
  buildC60110PolicyFreeze,
  buildC60110PolicyProfiles,
  buildC60110QualityPolicy,
  buildMachineCrossModelArbitrationEvidence,
  buildMachineCrossModelArbitrationLedger,
  genericHallucinationRisk,
  machineQualitySemanticHash,
  type C60110CandidateInput,
  type C60110EvidenceEventInput,
  type C60110MachineEvidenceInput,
} from "@mvl/video-subtitler";

const SOURCE_SHA256 =
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43";
const AVAILABLE_ORACLE_GAIN = 22;

interface Arguments {
  baseline: string;
  outputRoot: string;
  generatedAt: string;
}

interface CandidatePoolArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    currentVariantId: string;
    selectedVariantId: string;
  }[];
  candidates: {
    eventId: string;
    candidateId: string;
    text: string;
    evidenceCompleteness: string;
    sourceGlobalVerified: boolean;
    semanticHash: string;
  }[];
}

interface CueLineageArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    finalCueIds: string[];
    semanticHash: string;
  }[];
}

interface TextSpanLineageArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    finalCueId: string | null;
    spanStart: number | null;
    spanEnd: number | null;
    spanText: string | null;
    lineageStatus:
      | "EXACT"
      | "NORMALIZED_EXACT"
      | "DERIVED_FROM_SPLIT"
      | "DERIVED_FROM_MERGE"
      | "AMBIGUOUS"
      | "UNRESOLVED";
    modifiable: boolean;
    blockers: string[];
    semanticHash: string;
  }[];
}

interface CoreStabilityArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    class: C60110EvidenceEventInput["whisperStability"]["class"];
    semanticHash: string;
  }[];
}

interface RiskFact {
  factType: string;
  evidenceClass:
    | "POSITIVE_CORRECTNESS_EVIDENCE"
    | "POSITIVE_ERROR_EVIDENCE"
    | "CONFLICTING_EVIDENCE"
    | "EVIDENCE_ABSENCE"
    | "UNKNOWN";
  severity: string;
  evidenceMissing: boolean;
  sourceEvidenceIds: string[];
}

interface RiskArtifact {
  semanticHash: string;
  events: { eventId: string; riskFacts: RiskFact[]; semanticHash: string }[];
}

interface DevInputFreeze {
  schemaVersion: "1.0.0";
  artifactType: "c6-0-1-10-dev24-input-freeze";
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1";
  generatedAt: string;
  sourceMediaSha256: string;
  eventIds: string[];
  machineArtifactFileHashes: Record<string, string>;
  machineArtifactSemanticHashes: Record<string, string>;
  byteReusedFromC6019: true;
  semanticReusedFromC6019: true;
  frozenBeforeDevGold: true;
  runtimeGoldInputCount: 0;
  semanticHash: string;
}

function parseArguments(values: string[]): Arguments {
  const required = (name: string): string => {
    const index = values.indexOf(name);
    const result = index >= 0 ? values[index + 1] : undefined;
    if (result === undefined || result.startsWith("--")) {
      throw new Error(`Missing ${name}.`);
    }
    return path.resolve(result);
  };
  const generatedIndex = values.indexOf("--generated-at");
  const generatedAt =
    generatedIndex >= 0 ? values[generatedIndex + 1] : undefined;
  if (generatedAt === undefined || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Missing valid --generated-at.");
  }
  return {
    baseline: required("--baseline"),
    outputRoot: required("--output-root"),
    generatedAt,
  };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function locateSubtitleDirectory(root: string): Promise<string> {
  const matches = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one subtitle directory under ${root}.`);
  }
  return path.join(root, matches[0]?.name ?? "");
}

async function snapshot(
  baseline: string,
  destination: string,
  artifacts: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    await access(destination);
    throw new Error(`Refusing to overwrite existing output ${destination}.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing")) {
      throw error;
    }
  }
  await cp(baseline, destination, {
    recursive: true,
    preserveTimestamps: true,
  });
  const subtitle = await locateSubtitleDirectory(destination);
  await Promise.all(
    Object.entries(artifacts).map(([name, artifact]) =>
      writeJson(path.join(subtitle, name), artifact),
    ),
  );
}

function candidateCompleteness(value: string | undefined) {
  return value === "COMPLETE"
    ? ("COMPLETE" as const)
    : value === undefined
      ? ("UNAVAILABLE" as const)
      : ("PARTIAL" as const);
}

function evidenceFromFact(
  riskEvent: RiskArtifact["events"][number] | undefined,
  factType: string,
  reasonCode:
    | "WHISPER_DECODER_INSTABILITY"
    | "WHISPER_LEXICALLY_UNSTABLE"
    | "WHISPER_INCOMPLETE_SPEECH_SUPPORT",
): C60110MachineEvidenceInput {
  const fact = riskEvent?.riskFacts.find(
    (value) => value.factType === factType,
  );
  if (fact === undefined) {
    return {
      status: "EVIDENCE_ABSENCE",
      strong: false,
      evidenceMissing: true,
      sourceEvidenceIds: [],
      reasonCodes: [],
    };
  }
  return {
    status: fact.evidenceClass,
    strong: fact.severity === "STRONG",
    evidenceMissing: fact.evidenceMissing,
    sourceEvidenceIds: fact.sourceEvidenceIds,
    reasonCodes:
      fact.evidenceClass === "POSITIVE_ERROR_EVIDENCE" ? [reasonCode] : [],
  };
}

function uniqueCandidates(
  values: readonly C60110CandidateInput[],
): C60110CandidateInput[] {
  const seen = new Set<string>();
  return values.filter((candidate) => {
    const key = `${candidate.candidateId}\u0000${candidate.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const argumentsValue = parseArguments(process.argv.slice(2));
const baselineSubtitle = await locateSubtitleDirectory(argumentsValue.baseline);

// Machine-only C6.0.1.9 artifacts are read first. No Gold-derived file is
// opened until all three DEV24 decision ledgers are persisted.
const machineFileNames = [
  "machine-second-asr-diagnostic-set.json",
  "machine-independent-asr-candidates.json",
  "machine-second-asr-stability.json",
  "machine-cross-model-comparison.json",
  "machine-cross-model-ctc-arbitration.json",
  "machine-candidate-pool-c6-0-1-5.json",
  "machine-event-to-final-cue-lineage.json",
  "machine-event-final-text-span-lineage.json",
  "machine-core-asr-stability.json",
  "machine-reasr-risk-v2.json",
] as const;
const [
  diagnosticSet,
  reazonCandidates,
  reazonStability,
  comparison,
  ctcArbitration,
  pool,
  cueLineage,
  textSpanLineage,
  coreStability,
  risk,
] = await Promise.all([
  readJson<MachineSecondAsrDiagnosticSet>(
    path.join(baselineSubtitle, machineFileNames[0]),
  ),
  readJson<MachineIndependentAsrCandidates>(
    path.join(baselineSubtitle, machineFileNames[1]),
  ),
  readJson<MachineSecondAsrStability>(
    path.join(baselineSubtitle, machineFileNames[2]),
  ),
  readJson<MachineCrossModelComparison>(
    path.join(baselineSubtitle, machineFileNames[3]),
  ),
  readJson<MachineCrossModelCtcArbitration>(
    path.join(baselineSubtitle, machineFileNames[4]),
  ),
  readJson<CandidatePoolArtifact>(
    path.join(baselineSubtitle, machineFileNames[5]),
  ),
  readJson<CueLineageArtifact>(
    path.join(baselineSubtitle, machineFileNames[6]),
  ),
  readJson<TextSpanLineageArtifact>(
    path.join(baselineSubtitle, machineFileNames[7]),
  ),
  readJson<CoreStabilityArtifact>(
    path.join(baselineSubtitle, machineFileNames[8]),
  ),
  readJson<RiskArtifact>(path.join(baselineSubtitle, machineFileNames[9])),
]);
if (diagnosticSet.sourceMediaSha256 !== SOURCE_SHA256) {
  throw new Error("Frozen DEV24 source identity mismatch.");
}

const candidateById = new Map(
  pool.candidates.map(
    (candidate) => [candidate.candidateId, candidate] as const,
  ),
);
const poolEventById = new Map(
  pool.events.map((event) => [event.eventId, event] as const),
);
const comparisonById = new Map(
  comparison.events.map((event) => [event.eventId, event] as const),
);
const reazonStabilityById = new Map(
  reazonStability.events.map((event) => [event.eventId, event] as const),
);
const ctcById = new Map(
  ctcArbitration.events.map((event) => [event.eventId, event] as const),
);
const cueLineageById = new Map(
  cueLineage.events.map((event) => [event.eventId, event] as const),
);
const textSpanById = new Map(
  textSpanLineage.events.map((event) => [event.eventId, event] as const),
);
const coreStabilityById = new Map(
  coreStability.events.map((event) => [event.eventId, event] as const),
);
const riskById = new Map(
  risk.events.map((event) => [event.eventId, event] as const),
);

const evidenceInputs: C60110EvidenceEventInput[] = diagnosticSet.events.map(
  (diagnostic) => {
    const poolEvent = poolEventById.get(diagnostic.eventId);
    const currentId =
      poolEvent?.selectedVariantId ?? poolEvent?.currentVariantId ?? "missing";
    const currentPoolCandidate = candidateById.get(currentId);
    const span = textSpanById.get(diagnostic.eventId);
    const currentText =
      span?.spanText ??
      currentPoolCandidate?.text ??
      "[machine-text-unavailable]";
    const compare = comparisonById.get(diagnostic.eventId);
    const exact = reazonCandidates.candidates.find(
      (candidate) =>
        candidate.eventId === diagnostic.eventId &&
        candidate.windowType === "CORE_EXACT",
    );
    const context = reazonCandidates.candidates.find(
      (candidate) =>
        candidate.eventId === diagnostic.eventId &&
        candidate.windowType === "CORE_CONTEXT",
    );
    const stability = reazonStabilityById.get(diagnostic.eventId);
    const ctc = ctcById.get(diagnostic.eventId);
    const riskEvent = riskById.get(diagnostic.eventId);
    const whisperClass =
      coreStabilityById.get(diagnostic.eventId)?.class ?? "NOT_RUN";
    const currentPronunciation = compare?.whisperCandidates.find(
      (candidate) => candidate.candidateId === currentId,
    )?.pronunciationText;
    const current: C60110CandidateInput = {
      candidateId: currentId,
      providerFamily: "WHISPER",
      text: currentText,
      ...(currentPronunciation === undefined
        ? {}
        : { pronunciationText: currentPronunciation }),
      hallucinationRisk: genericHallucinationRisk({
        text: currentText,
        durationSeconds:
          diagnostic.coreInterval.end - diagnostic.coreInterval.start,
      }),
      evidenceAvailability: candidateCompleteness(
        currentPoolCandidate?.evidenceCompleteness,
      ),
      ...(currentPoolCandidate?.semanticHash === undefined
        ? {}
        : { sourceSemanticHash: currentPoolCandidate.semanticHash }),
    };
    const alternates = uniqueCandidates(
      (compare?.whisperCandidates ?? [])
        .filter((candidate) => candidate.candidateId !== currentId)
        .map((candidate) => ({
          candidateId: candidate.candidateId,
          providerFamily: "WHISPER" as const,
          text: candidate.displayText,
          pronunciationText: candidate.pronunciationText,
          hallucinationRisk: candidate.hallucinationRisk,
          evidenceAvailability: "PARTIAL" as const,
        })),
    );
    return {
      eventId: diagnostic.eventId,
      diagnosticRole: diagnostic.role,
      currentFinalCueIds:
        cueLineageById.get(diagnostic.eventId)?.finalCueIds ?? [],
      currentFinalSpanLineage: {
        finalCueId: span?.finalCueId ?? null,
        spanStart: span?.spanStart ?? null,
        spanEnd: span?.spanEnd ?? null,
        lineageStatus: span?.lineageStatus ?? "UNRESOLVED",
        modifiable: span?.modifiable ?? false,
        blockers: span?.blockers ?? ["text-span-lineage-unavailable"],
        semanticHash:
          span?.semanticHash ??
          machineQualitySemanticHash({
            eventId: diagnostic.eventId,
            unavailable: true,
          }),
      },
      currentWhisperCandidate: current,
      alternateWhisperCandidates: alternates,
      reazonCoreExactCandidate:
        exact === undefined
          ? null
          : {
              candidateId: exact.candidateId,
              providerFamily: "REAZON",
              text: exact.displayText,
              pronunciationText: exact.pronunciationText,
              hallucinationRisk: exact.diagnostics.repetitionRisk,
              evidenceAvailability:
                exact.evidenceAvailability === "COMPLETE"
                  ? "COMPLETE"
                  : "PARTIAL",
              sourceSemanticHash: exact.semanticHash,
            },
      reazonCoreContextCandidate:
        context === undefined
          ? null
          : {
              candidateId: context.candidateId,
              providerFamily: "REAZON",
              text: context.displayText,
              pronunciationText: context.pronunciationText,
              hallucinationRisk: context.diagnostics.repetitionRisk,
              evidenceAvailability:
                context.evidenceAvailability === "COMPLETE"
                  ? "COMPLETE"
                  : "PARTIAL",
              sourceSemanticHash: context.semanticHash,
            },
      whisperStability: {
        class: whisperClass,
        sourceEvidenceIds: [
          coreStabilityById.get(diagnostic.eventId)?.semanticHash ??
            riskEvent?.semanticHash ??
            diagnostic.semanticHash,
        ],
      },
      reazonStability: {
        class: stability?.stabilityClass ?? "UNCOMPARABLE",
        sourceEvidenceIds:
          stability === undefined ? [] : [stability.semanticHash],
      },
      whisperDecoderEvidence: evidenceFromFact(
        riskEvent,
        "decoderWeak",
        "WHISPER_DECODER_INSTABILITY",
      ),
      whisperTokenEvidence: evidenceFromFact(
        riskEvent,
        "tokenConflict",
        "WHISPER_LEXICALLY_UNSTABLE",
      ),
      requestEdgeEvidence: evidenceFromFact(
        riskEvent,
        "requestEdgeRisk",
        "WHISPER_INCOMPLETE_SPEECH_SUPPORT",
      ),
      speechCompletenessEvidence: evidenceFromFact(
        riskEvent,
        "speechIncomplete",
        "WHISPER_INCOMPLETE_SPEECH_SUPPORT",
      ),
      ctc: {
        whisperSupport: ctc?.ctcWhisperEvidence ?? null,
        reazonSupport: ctc?.ctcReazonEvidence ?? null,
        outcome: ctc?.outcome ?? "CTC_NOT_RUN",
        sourceEvidenceIds: ctc?.evidenceIds ?? [],
      },
      coreLocalizationStatus:
        diagnostic.coreStatus === "VERIFIED"
          ? "VERIFIED"
          : "VERIFIED_WITH_CAUTION",
      crossEventAmbiguity: whisperClass === "ADJACENT_UTTERANCE_CONTAMINATION",
      runtimeProvenanceComplete:
        exact?.evidenceAvailability === "COMPLETE" &&
        context?.evidenceAvailability === "COMPLETE",
    };
  },
);

const machineFileHashes: Record<string, string> = Object.fromEntries(
  await Promise.all(
    machineFileNames.map(
      async (name) =>
        [name, await sha256File(path.join(baselineSubtitle, name))] as const,
    ),
  ),
);
const machineSemanticHashes = {
  diagnosticSet: diagnosticSet.semanticHash,
  independentCandidates: reazonCandidates.semanticHash,
  reazonStability: reazonStability.semanticHash,
  comparison: comparison.semanticHash,
  ctcArbitration: ctcArbitration.semanticHash,
  candidatePool: pool.semanticHash,
  cueLineage: cueLineage.semanticHash,
  textSpanLineage: textSpanLineage.semanticHash,
  whisperStability: coreStability.semanticHash,
  risk: risk.semanticHash,
};
const inputFreezeCore = {
  schemaVersion: "1.0.0" as const,
  artifactType: "c6-0-1-10-dev24-input-freeze" as const,
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1" as const,
  generatedAt: argumentsValue.generatedAt,
  sourceMediaSha256: SOURCE_SHA256,
  eventIds: diagnosticSet.events.map((event) => event.eventId),
  machineArtifactFileHashes: machineFileHashes,
  machineArtifactSemanticHashes: machineSemanticHashes,
  byteReusedFromC6019: true as const,
  semanticReusedFromC6019: true as const,
  frozenBeforeDevGold: true as const,
  runtimeGoldInputCount: 0 as const,
};
const inputFreeze: DevInputFreeze = {
  ...inputFreezeCore,
  semanticHash: machineQualitySemanticHash({
    ...inputFreezeCore,
    generatedAt: undefined,
  }),
};
const profiles = buildC60110PolicyProfiles({
  generatedAt: argumentsValue.generatedAt,
});
const evidence = buildMachineCrossModelArbitrationEvidence({
  generatedAt: argumentsValue.generatedAt,
  scope: "DEV24",
  sourceMediaSha256: SOURCE_SHA256,
  upstreamSemanticHashes: {
    dev24InputFreeze: inputFreeze.semanticHash,
    c6019MachineFreeze: machineQualitySemanticHash(machineSemanticHashes),
  },
  events: evidenceInputs,
});
const ledgers = profiles.profiles.map((profile) =>
  buildMachineCrossModelArbitrationLedger({
    generatedAt: argumentsValue.generatedAt,
    scope: "DEV24",
    evidence,
    profiles,
    profileName: profile.profile,
    arbitrationPolicyHash: profile.semanticHash,
    productionEnforcementEnabled: true,
  }),
);
const commonMachineArtifacts = {
  "c6-0-1-10-dev24-input-freeze.json": inputFreeze,
  "c6-0-1-10-policy-profiles.json": profiles,
  "machine-cross-model-arbitration-evidence.json": evidence,
};
const outputNames = {
  evidence: "carnation-c6-0-1-10-dev24-evidence-20260829",
  CONSERVATIVE: "carnation-c6-0-1-10-dev24-conservative-20260829",
  BALANCED: "carnation-c6-0-1-10-dev24-balanced-20260829",
  AGGRESSIVE_SHADOW: "carnation-c6-0-1-10-dev24-aggressive-shadow-20260829",
  freeze: "carnation-c6-0-1-10-policy-freeze-20260829",
} as const;
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.evidence),
  commonMachineArtifacts,
);
for (const ledger of ledgers) {
  await snapshot(
    argumentsValue.baseline,
    path.join(argumentsValue.outputRoot, outputNames[ledger.policyProfile]),
    {
      ...commonMachineArtifacts,
      "machine-cross-model-arbitration-ledger.json": ledger,
      "c6-0-1-10-dev24-machine-decision-freeze.json": {
        schemaVersion: "1.0.0",
        policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
        artifactType: "c6-0-1-10-dev24-machine-decision-freeze",
        generatedAt: argumentsValue.generatedAt,
        profile: ledger.policyProfile,
        decisionsFrozenBeforeGold: true,
        decisionLedgerSemanticHash: ledger.semanticHash,
        runtimeGoldInputCount: 0,
        semanticHash: machineQualitySemanticHash({
          profile: ledger.policyProfile,
          decisionLedgerSemanticHash: ledger.semanticHash,
        }),
      },
    },
  );
}

// Gold-derived C6.0.1.9 evaluation artifacts are first opened here, after the
// three machine decision ledgers and their freeze files exist on disk.
const [complementarity, controls] = await Promise.all([
  readJson<GoldCrossModelComplementarityEvaluation>(
    path.join(
      baselineSubtitle,
      "gold-cross-model-complementarity-evaluation.json",
    ),
  ),
  readJson<GoldSecondAsrControlRegression>(
    path.join(baselineSubtitle, "gold-second-asr-control-regression.json"),
  ),
]);
const dev24Evaluation = buildC60110Dev24Evaluation({
  generatedAt: argumentsValue.generatedAt,
  profiles,
  ledgers,
  complementarity,
  controls,
  goldIdentityHash: complementarity.goldIdentityHash,
  availableOracleGain: AVAILABLE_ORACLE_GAIN,
});
const policyFreeze = buildC60110PolicyFreeze({
  generatedAt: argumentsValue.generatedAt,
  profiles,
  dev24Evaluation,
});
const qualityPolicy = buildC60110QualityPolicy({
  generatedAt: argumentsValue.generatedAt,
  policyFreeze,
});
const selectedLedger =
  policyFreeze.selectedProductionProfile === "DISABLED"
    ? ledgers.find((ledger) => ledger.policyProfile === "CONSERVATIVE")
    : ledgers.find(
        (ledger) =>
          ledger.policyProfile === policyFreeze.selectedProductionProfile,
      );
if (selectedLedger === undefined) throw new Error("Selected ledger missing.");
const controlEvaluation = buildC60110ControlRegressionEvaluation({
  generatedAt: argumentsValue.generatedAt,
  ledger: selectedLedger,
  controls,
});
const evaluationArtifacts = {
  ...commonMachineArtifacts,
  "machine-cross-model-arbitration-ledger.json": selectedLedger,
  "c6-0-1-10-dev24-evaluation.json": dev24Evaluation,
  "c6-0-1-10-control-regression-evaluation.json": controlEvaluation,
  "c6-0-1-10-policy-freeze.json": policyFreeze,
  "c6-0-1-10-quality-policy.json": qualityPolicy,
};
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.freeze),
  evaluationArtifacts,
);

const state = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-10-dev24-frozen-state",
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
  generatedAt: argumentsValue.generatedAt,
  sourceMediaSha256: SOURCE_SHA256,
  inputFreeze,
  profiles,
  evidence,
  ledgers,
  dev24Evaluation,
  controlEvaluation,
  policyFreeze,
  qualityPolicy,
  runtimeGoldInputCount: 0,
};
await writeJson(path.resolve("temp/c6-0-1-10-dev24-frozen-state.json"), state);

process.stdout.write(
  `${JSON.stringify(
    {
      outputNames,
      inputFreeze: inputFreeze.semanticHash,
      evidence: evidence.summary,
      profiles: Object.fromEntries(
        ledgers.map((ledger) => [ledger.policyProfile, ledger.summary]),
      ),
      evaluations: Object.fromEntries(
        dev24Evaluation.profiles.map((profile) => [profile.profile, profile]),
      ),
      selectedProductionProfile: policyFreeze.selectedProductionProfile,
      enforcementEnabled: policyFreeze.enforcementEnabled,
      arbitrationPolicyHash: policyFreeze.arbitrationPolicyHash,
      control: controlEvaluation,
    },
    null,
    2,
  )}\n`,
);
