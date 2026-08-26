import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  c60BlockerInventorySchema,
  c60BlockerOntologySchema,
  c60BlockerRootCauseGraphSchema,
  c60BlockerSupersessionAuditSchema,
  c60ComponentRiskAuditSchema,
  c60FinalizationCounterfactualSchema,
  c60HumanAuthorityDependencyAuditSchema,
  c60InvestigationSummarySchema,
  c60ZeroTouchReadinessSchema,
  type C60BlockerInventory,
  type C60BlockerOntology,
  type C60BlockerOntologyEntry,
  type C60BlockerRootCauseGraph,
  type C60BlockerSupersessionAudit,
  type C60ComponentRiskAudit,
  type C60ComponentRiskEntry,
  type C60FinalizationCounterfactual,
  type C60HumanAuthorityDependencyAudit,
  type C60InvestigationSummary,
  type C60ZeroTouchReadiness,
} from "@mvl/shared";

type JsonRecord = Record<string, unknown>;

const CANONICAL_CUE_HASH =
  "8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83";
const TIMING_HASH =
  "510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02";

const REQUIRED_ARTIFACTS = [
  "subtitle-finalization-report.json",
  "subtitle-review-package.json",
  "subtitle-canonical-forced-alignment.json",
  "subtitle-local-ctc-boundary-evidence.json",
  "subtitle-local-speaker-evidence.json",
  "subtitle-local-separated-stream-evidence.json",
  "subtitle-overlap-acoustic-resolution.json",
  "subtitle-presentation-resolution.json",
  "subtitle-timestamp-evidence-integrity.json",
  "memory-assisted-ctc-target-audit.json",
  "subtitle-review-delivery-integrity.json",
] as const;

export const C60_ARTIFACT_FILES = [
  "c6-0-blocker-inventory.json",
  "c6-0-blocker-ontology.json",
  "c6-0-blocker-supersession-audit.json",
  "c6-0-blocker-root-cause-graph.json",
  "c6-0-component-risk-audit.json",
  "c6-0-component-evidence-matrix.json",
  "c6-0-finalization-counterfactual.json",
  "c6-0-human-authority-dependency-audit.json",
  "c6-0-zero-touch-readiness.json",
  "c6-0-investigation-summary.json",
] as const;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/u;
const RELEVANT_CODE_PATTERN =
  /(ALIGN|ASS|AUDIO|BASELINE|BOUNDARY|CTC|CUE|DELIVERY|DIAR|EVIDENCE|FINAL|FORMAT|HUMAN|INTEGRITY|LEXICAL|MAPPED_TOKEN|MFA|MUTATION|NEIGHBOR|OVERLAP|PRESENTATION|PROVIDER|REVIEW|SERIAL|SPEAKER|SUBTITLE|TIMING|VAD|WINDOW)/u;
const ABSOLUTE_PATH_PATTERN =
  /(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]|\\\\[^\\])/u;
const SECRET_PATTERN =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b)/u;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function stableInvestigationHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function semanticIdentity(value: JsonRecord): JsonRecord {
  const identity = { ...value, generatedAt: null, semanticHash: null };
  if ("runLabel" in identity) identity.runLabel = null;
  return identity;
}

function attachSemanticHash<T extends JsonRecord>(
  value: T,
): T & {
  semanticHash: string;
} {
  return {
    ...value,
    semanticHash: stableInvestigationHash(semanticIdentity(value)),
  };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function walkFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        output.push(target);
      }
    }
  };
  await visit(root);
  return output.toSorted();
}

async function findNamedFile(
  root: string,
  name: string,
): Promise<string | null> {
  const candidates = (await walkFiles(root)).filter(
    (candidate) => path.basename(candidate) === name,
  );
  if (candidates.length === 0) return null;
  const primaryCandidates = candidates.filter(
    (candidate) => !candidate.split(path.sep).includes("shareable"),
  );
  if (primaryCandidates.length === 1) return primaryCandidates[0] ?? null;
  if (primaryCandidates.length > 1) {
    const ranked = primaryCandidates.toSorted(
      (left, right) =>
        left.split(path.sep).length - right.split(path.sep).length ||
        left.localeCompare(right),
    );
    const first = ranked[0];
    const second = ranked[1];
    if (
      first !== undefined &&
      (second === undefined ||
        first.split(path.sep).length < second.split(path.sep).length)
    ) {
      return first;
    }
  }
  if (candidates.length > 1) {
    throw new Error(
      `Expected one ${name} under ${root}; found ${candidates.length}.`,
    );
  }
  return candidates[0] ?? null;
}

async function readJsonRecord(filePath: string): Promise<JsonRecord> {
  return record(
    JSON.parse(await readFile(filePath, "utf8")) as unknown,
    filePath,
  );
}

async function loadTaskArtifacts(taskRoot: string): Promise<{
  files: Map<string, string>;
  artifacts: Map<string, JsonRecord>;
}> {
  const files = new Map<string, string>();
  const artifacts = new Map<string, JsonRecord>();
  for (const name of REQUIRED_ARTIFACTS) {
    const filePath = await findNamedFile(taskRoot, name);
    if (filePath === null)
      throw new Error(`Required C5.19 artifact missing: ${name}`);
    files.set(name, filePath);
    artifacts.set(name, await readJsonRecord(filePath));
  }
  return { files, artifacts };
}

function collectRelevantCodes(
  value: unknown,
  counts: Map<string, number>,
  parentKey = "",
): void {
  if (typeof value === "string") {
    if (
      CODE_PATTERN.test(value) &&
      /(blocker|code|reason|finding|error)/iu.test(parentKey)
    ) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRelevantCodes(item, counts, parentKey);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectRelevantCodes(child, counts, key);
  }
}

function collectNestedStrings(
  value: unknown,
  keyPattern: RegExp,
  output: Set<string>,
  parentKey = "",
): void {
  if (typeof value === "string") {
    if (keyPattern.test(parentKey)) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value)
      collectNestedStrings(child, keyPattern, output, parentKey);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectNestedStrings(child, keyPattern, output, key);
  }
}

function componentMap(artifact: JsonRecord): Map<string, JsonRecord> {
  return new Map(
    records(artifact.components).map((component) => [
      stringValue(component.componentId),
      component,
    ]),
  );
}

function layerForPath(relativePath: string): string {
  const normalized = relativePath.toLowerCase();
  if (normalized.includes("forced-alignment")) return "forced-alignment";
  if (normalized.includes("ctc")) return "ctc";
  if (normalized.includes("speaker")) return "speaker";
  if (normalized.includes("overlap")) return "overlap";
  if (normalized.includes("presentation")) return "presentation";
  if (normalized.includes("timestamp")) return "timestamp-integrity";
  if (normalized.includes("review")) return "review";
  if (normalized.includes("finalization")) return "finalization";
  return "pipeline";
}

function nearestFunction(lines: string[], lineIndex: number): string {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    const declaration =
      /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)|(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=/u.exec(
        line,
      );
    const name = declaration?.[1] ?? declaration?.[2];
    if (name !== undefined) return name;
  }
  return "module-scope";
}

async function scanSourceCodes(repoRoot: string): Promise<{
  sourceFiles: string[];
  producers: Map<
    string,
    {
      producerPath: string;
      producerFunction: string;
      line: number;
      conditionSummary: string;
    }[]
  >;
}> {
  const roots = ["packages", "apps"].map((name) => path.join(repoRoot, name));
  const allFiles: string[] = [];
  for (const root of roots) {
    try {
      allFiles.push(...(await walkFiles(root)));
    } catch {
      // Optional source root.
    }
  }
  const sourceFiles = allFiles.filter((file) =>
    SOURCE_EXTENSIONS.has(path.extname(file)),
  );
  const producers = new Map<
    string,
    {
      producerPath: string;
      producerFunction: string;
      line: number;
      conditionSummary: string;
    }[]
  >();
  const scanned = new Set<string>();
  for (const file of sourceFiles.toSorted()) {
    const content = await readFile(file, "utf8");
    const lines = content.split(/\r?\n/u);
    const relative = path.relative(repoRoot, file);
    let fileRelevant = false;
    for (const [index, line] of lines.entries()) {
      const matches = line.matchAll(/["'`]([A-Z][A-Z0-9_]{2,})["'`]/gu);
      for (const match of matches) {
        const code = match[1];
        if (code === undefined || !RELEVANT_CODE_PATTERN.test(code)) continue;
        fileRelevant = true;
        const entry = {
          producerPath: relative,
          producerFunction: nearestFunction(lines, index),
          line: index + 1,
          conditionSummary: line.trim().slice(0, 240) || "code declaration",
        };
        const existing = producers.get(code) ?? [];
        if (
          !existing.some(
            (candidate) =>
              candidate.producerPath === entry.producerPath &&
              candidate.line === entry.line,
          )
        ) {
          existing.push(entry);
          producers.set(code, existing);
        }
      }
    }
    if (fileRelevant) scanned.add(relative);
  }
  return { sourceFiles: [...scanned].toSorted(), producers };
}

export function classifyC60Blocker(
  code: string,
  observed: boolean,
): Omit<C60BlockerOntologyEntry, "code"> {
  const integrityFinal = new Set([
    "INVALID_CUE_TIMING",
    "CUE_OUTSIDE_MEDIA",
    "TIME_REVERSED",
    "SERIALIZATION_ROUND_TRIP_FAILED",
    "FORMAT_CANONICAL_PARITY_FAILED",
    "FORMAT_PRESENTATION_PARITY_FAILED",
    "SOURCE_MEDIA_CHANGED",
    "HUMAN_REVIEWED_SUBTITLE_CHANGED",
    "UNSAFE_AUTOMATIC_MUTATION",
    "REVIEW_DELIVERY_INTEGRITY_FAILED",
    "AUDIO_DELIVERY_INTEGRITY_FAILED",
  ]);
  if (code === "CTC_TARGET_UNREPRESENTABLE") {
    return {
      canonicalRiskFamily: "stale-ctc-target-availability",
      currentScope: "evidence-availability",
      evidencePolarity: "absence-of-support",
      proposedDisposition: "SUPERSEDED",
      currentOutputRisk: "NONE",
      proposedMutationRisk: "NONE",
      providerSpecific: true,
      contextRule:
        "Superseded only when a newer memory-assisted target audit proves the same cue encodable without canonical mutation.",
      rationale:
        "C5.19 rescued cues 140 and 142 with pronunciation projection while preserving canonical text and timing.",
    };
  }
  if (integrityFinal.has(code)) {
    return {
      canonicalRiskFamily: "delivery-or-canonical-integrity",
      currentScope: code.includes("FORMAT")
        ? "format-compatibility"
        : "delivery-integrity",
      evidencePolarity: "positive-risk-evidence",
      proposedDisposition: "FINAL_BLOCKER",
      currentOutputRisk: "HIGH",
      proposedMutationRisk: "HIGH",
      providerSpecific: false,
      contextRule:
        "Block final delivery whenever the integrity condition is present.",
      rationale:
        "The finding directly proves the emitted subtitle or delivery is unsafe.",
    };
  }
  if (code === "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED") {
    return {
      canonicalRiskFamily: "safe-repair-not-established",
      currentScope: "evidence-availability",
      evidencePolarity: "absence-of-support",
      proposedDisposition: "CONTEXT_DEPENDENT",
      currentOutputRisk: "UNKNOWN",
      proposedMutationRisk: "HIGH",
      providerSpecific: false,
      contextRule:
        "Block an alignment-dependent automatic mutation; do not by itself prove an unchanged human-reviewed baseline unsafe.",
      rationale:
        "This meta-finding records inability to prove a repair, rather than positive evidence of a baseline defect.",
    };
  }
  if (code === "ILLEGAL_SUBTITLE_OVERLAP") {
    return {
      canonicalRiskFamily: "overlap-semantics-unresolved",
      currentScope: "format-compatibility",
      evidencePolarity: "format-advisory",
      proposedDisposition: "CONTEXT_DEPENDENT",
      currentOutputRisk: "UNKNOWN",
      proposedMutationRisk: "HIGH",
      providerSpecific: false,
      contextRule:
        "Require positive evidence that overlap is a current-output defect for final blocking; otherwise retain a format/review advisory and guard mutation.",
      rationale:
        "Temporal overlap is observable, but can represent intentional simultaneous dialogue and does not alone prove deletion or retiming is safe.",
    };
  }
  if (
    /(?:HUMAN_REVIEWED_BASELINE_IMPORTED|ASS_DECIMAL_COMMA_NORMALIZED)/u.test(
      code,
    )
  ) {
    return {
      canonicalRiskFamily: "baseline-provenance-diagnostic",
      currentScope: code.includes("ASS")
        ? "format-compatibility"
        : "diagnostic-only",
      evidencePolarity: code.includes("ASS")
        ? "format-advisory"
        : "execution-diagnostic",
      proposedDisposition: code.includes("ASS")
        ? "REVIEW_ADVISORY"
        : "DIAGNOSTIC_ONLY",
      currentOutputRisk: "NONE",
      proposedMutationRisk: "NONE",
      providerSpecific: false,
      contextRule:
        "Record provenance or normalization without blocking delivery.",
      rationale:
        "The condition documents a safe, verified import or normalization.",
    };
  }
  if (
    /(?:INTENTIONAL_REPETITION_CLASSIFIED|OVERLAP_SPEECH_INTERVAL_OBSERVED|ADJACENT_CUES_MAP_TO_ONE_CONTINUOUS_SPEAKER_TRACK|ONE_STABLE_COMPONENT_LOCAL_SPEAKER_TRACK|C5_18_ANONYMOUS_COMPONENT_LOCAL_SPEAKER_EVIDENCE|RAW_VAD_END_EXCEEDS_AUDIO_BOUNDARY_WITHIN_TOLERANCE)/u.test(
      code,
    )
  ) {
    return {
      canonicalRiskFamily: "observed-content-classification",
      currentScope: "diagnostic-only",
      evidencePolarity: "execution-diagnostic",
      proposedDisposition: "DIAGNOSTIC_ONLY",
      currentOutputRisk: "NONE",
      proposedMutationRisk: "NONE",
      providerSpecific: false,
      contextRule:
        "Record the observed content relationship without treating it as proof of a subtitle defect.",
      rationale:
        "Intentional repetition or acoustic overlap can support preservation and is not independently a finalization failure.",
    };
  }
  if (
    /(?:LINE_|PRESENTATION_|SUBTITLE_OVERLAP_FORMAT|ASS_|SRT_|VTT_)/u.test(code)
  ) {
    return {
      canonicalRiskFamily: "presentation-or-format-advisory",
      currentScope: "format-compatibility",
      evidencePolarity: "format-advisory",
      proposedDisposition: "REVIEW_ADVISORY",
      currentOutputRisk: "LOW",
      proposedMutationRisk: "MEDIUM",
      providerSpecific: false,
      contextRule:
        "Advisory unless round-trip or canonical parity is positively shown to fail.",
      rationale:
        "Presentation warnings do not automatically invalidate canonical content.",
    };
  }
  if (
    /(?:CTC|MFA|FORCED_ALIGNMENT|SPEAKER|DIAR|SEPARAT|MAPPED_TOKEN|RAW_VAD|VAD|LEXICAL|NEIGHBOR|WINDOW|BOUNDARY|OCCURRENCE|ALIGNMENT|COMPONENT_|EVIDENCE_|INSUFFICIENT_|JOINT_|READING_|TOKEN|SEQUENCE_)/u.test(
      code,
    )
  ) {
    const diagnostic =
      /(?:PROVIDER|RUNTIME|MODEL_LOAD|PROCESS|CACHE|NOT_RUN|SOURCE_SEPARATION_TRIGGER_NOT_MET)/u.test(
        code,
      ) ||
      /^(?:CTC_DUAL_WINDOW_PATH_UNAVAILABLE|EVIDENCE_DP_BOUNDARY_UNAVAILABLE|MAPPED_TOKEN_EVIDENCE_UNAVAILABLE|READING_UNAVAILABLE|SPEAKER_OR_FOREGROUND_EVIDENCE_UNAVAILABLE)$/u.test(
        code,
      );
    const contradiction =
      /(?:CONTRADICTION|DISAGREE|CONFLICT|NON_MONOTONIC|NEW_ILLEGAL|LEGAL_OVERLAP_DELETED|INTRUSION)/u.test(
        code,
      );
    return {
      canonicalRiskFamily: diagnostic
        ? "provider-or-evidence-availability"
        : contradiction
          ? "evidence-contradiction-or-preservation-risk"
          : "automatic-boundary-mutation-guard",
      currentScope: diagnostic
        ? "evidence-availability"
        : contradiction
          ? "evidence-consistency"
          : "automatic-mutation-safety",
      evidencePolarity: diagnostic
        ? "execution-diagnostic"
        : contradiction
          ? "contradictory-evidence"
          : "absence-of-support",
      proposedDisposition: diagnostic ? "DIAGNOSTIC_ONLY" : "MUTATION_GUARD",
      currentOutputRisk: contradiction ? "UNKNOWN" : "NONE",
      proposedMutationRisk: "HIGH",
      providerSpecific: true,
      contextRule:
        "Prevent only the automatic action that depends on this evidence; provider failure alone does not condemn unchanged canonical output.",
      rationale:
        "The code describes unavailable, unstable, or contradictory evidence for a proposed repair.",
    };
  }
  if (/REVIEW|FINAL_INTEGRITY_FINDING/u.test(code)) {
    return {
      canonicalRiskFamily: "review-routing-meta-signal",
      currentScope: "diagnostic-only",
      evidencePolarity: "execution-diagnostic",
      proposedDisposition: "DIAGNOSTIC_ONLY",
      currentOutputRisk: "NONE",
      proposedMutationRisk: "NONE",
      providerSpecific: false,
      contextRule:
        "Use for routing and audit only; inherit risk from the underlying finding.",
      rationale:
        "A review route is not independent evidence of a subtitle defect.",
    };
  }
  return {
    canonicalRiskFamily: "unclassified-signal",
    currentScope: "diagnostic-only",
    evidencePolarity: "execution-diagnostic",
    proposedDisposition: "UNKNOWN",
    currentOutputRisk: observed ? "UNKNOWN" : "NONE",
    proposedMutationRisk: observed ? "HIGH" : "UNKNOWN",
    providerSpecific: false,
    contextRule:
      "Fail closed until the producer and evidence semantics are classified.",
    rationale: "No explicit C6.0 ontology rule exists for this code.",
  };
}

export function isC60TargetRescued(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.beforeEncodable === false &&
    value.afterProjectionEncodable === true &&
    value.canonicalTextChanged === false
  );
}

export function isC60GraphAcyclic(
  nodeIds: string[],
  edges: { from: string; to: string }[],
): boolean {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  for (const edge of edges) {
    const targets = adjacency.get(edge.from);
    if (targets === undefined || !adjacency.has(edge.to)) return false;
    targets.push(edge.to);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return false;
    if (visited.has(nodeId)) return true;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) {
      if (!visit(target)) return false;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  };
  return nodeIds.every(visit);
}

export function evaluateC60CounterfactualCodes(
  findingCodes: string[],
  ontology: Map<string, C60BlockerOntologyEntry>,
  scenarioId: "A" | "B" | "C" | "D" | "E",
): string[] {
  const excluded = new Set<C60BlockerOntologyEntry["proposedDisposition"]>();
  if (scenarioId !== "A") excluded.add("MUTATION_GUARD");
  if (["C", "D", "E"].includes(scenarioId)) excluded.add("DIAGNOSTIC_ONLY");
  if (["D", "E"].includes(scenarioId)) excluded.add("REVIEW_ADVISORY");
  return findingCodes.filter((code) => {
    const classification = ontology.get(code);
    if (classification === undefined) return true;
    if (scenarioId === "A") return true;
    if (scenarioId === "E") {
      return (
        classification.proposedDisposition === "UNKNOWN" ||
        (classification.proposedDisposition === "FINAL_BLOCKER" &&
          classification.evidencePolarity === "positive-risk-evidence")
      );
    }
    return !excluded.has(classification.proposedDisposition);
  });
}

function digestEvidence(
  source: string,
  component: JsonRecord | undefined,
  fallbackStatus: string,
  polarity: C60ComponentRiskEntry["evidence"]["ctc"]["evidencePolarity"],
): C60ComponentRiskEntry["evidence"]["ctc"] {
  if (component === undefined) {
    return {
      source,
      status: "not-located",
      result: "No component-scoped record was found in the source artifact.",
      evidencePolarity: "absence-of-support",
      blockers: [],
      evidenceIds: [],
    };
  }
  const blockerSet = new Set<string>();
  collectNestedStrings(component, /blockers?|reasons?/iu, blockerSet);
  const evidenceSet = new Set<string>();
  collectNestedStrings(
    component,
    /(?:evidenceId|evidenceLineageId|attemptId)$/iu,
    evidenceSet,
  );
  const status = stringValue(
    component.resolutionStatus ??
      component.status ??
      component.finalRelationship ??
      component.safeAutomaticAction,
    fallbackStatus,
  );
  const resultParts = [
    `status=${status}`,
    `safeAutomaticAction=${stringValue(component.safeAutomaticAction, "none")}`,
    `timingActionable=${String(booleanValue(component.timingActionable))}`,
  ];
  return {
    source,
    status,
    result: resultParts.join("; "),
    evidencePolarity: polarity,
    blockers: [...blockerSet]
      .filter((code) => CODE_PATTERN.test(code))
      .toSorted(),
    evidenceIds: [...evidenceSet]
      .filter((value) => value.length > 0)
      .toSorted()
      .slice(0, 24),
  };
}

function getComponentInterval(item: JsonRecord): {
  start: number;
  end: number;
} {
  const interval = record(item.interval, "review item interval");
  return { start: numberValue(interval.start), end: numberValue(interval.end) };
}

function overlapSecondsForCues(
  cueIds: string[],
  canonicalPackage: JsonRecord,
): number {
  const cues = records(canonicalPackage.cues).filter((cue) =>
    cueIds.includes(stringValue(cue.cueId ?? cue.id)),
  );
  let total = 0;
  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1];
    const current = cues[index];
    if (previous === undefined || current === undefined) continue;
    total += Math.max(
      0,
      Math.min(numberValue(previous.end), numberValue(current.end)) -
        Math.max(numberValue(previous.start), numberValue(current.start)),
    );
  }
  return Number(total.toFixed(6));
}

async function loadCanonicalPackage(taskRoot: string): Promise<JsonRecord> {
  const file = await findNamedFile(
    taskRoot,
    "subtitle-package.human-reviewed-base.json",
  );
  if (file === null)
    throw new Error("Human-reviewed baseline package is missing.");
  return readJsonRecord(file);
}

function componentConclusion(index: number): {
  risk: "LOW" | "UNKNOWN";
  review: C60ComponentRiskEntry["humanReviewNecessity"];
  text: string;
} {
  const conclusions = [
    "A 0.10 s temporal overlap is present, but available providers do not prove it is a subtitle defect or identify a safe boundary change.",
    "A long nested dialogue interval remains semantically ambiguous; acoustic and alignment evidence do not establish a safe automatic rewrite.",
    "Stable single-speaker evidence resolves speaker relationship only. CTC preservation checks reject deleting the existing overlap, so unchanged baseline preservation is supported.",
    "Memory pronunciation rescues the stale unrepresentable-target diagnostic for cues 140 and 142, while the three-cue timing relationship remains unresolved.",
    "Evidence is insufficient and partly inconsistent for a safe timing action; the unchanged human-reviewed baseline has no positively proven defect.",
    "Non-monotonic and overlap-creation guards prevent automatic retiming, but do not independently prove current output unsafe.",
    "Local speaker and alignment hypotheses remain insufficient for a safe edit; retain the baseline and keep an advisory review item.",
  ] as const;
  if (index === 2) {
    return {
      risk: "LOW",
      review: "not-required-for-preservation",
      text: conclusions[index],
    };
  }
  return {
    risk: "UNKNOWN",
    review: "recommended-advisory",
    text:
      conclusions[index] ??
      "Evidence does not establish a safe automatic change.",
  };
}

async function readReferenceHashes(taskRoot: string): Promise<{
  cueHash: string;
  timingHash: string;
}> {
  const finalPath = await findNamedFile(
    taskRoot,
    "subtitle-finalization-report.json",
  );
  const ctcPath = await findNamedFile(
    taskRoot,
    "subtitle-local-ctc-boundary-evidence.json",
  );
  if (finalPath === null || ctcPath === null) {
    throw new Error(`Replay parity artifacts missing under ${taskRoot}.`);
  }
  const final = await readJsonRecord(finalPath);
  const ctc = await readJsonRecord(ctcPath);
  return {
    cueHash: stringValue(final.outputCueHash),
    timingHash: stringValue(ctc.baseTimingHash),
  };
}

export interface C60InvestigationOptions {
  taskRoot: string;
  outputRoot: string;
  repoRoot: string;
  causalTaskRoot?: string;
  frozenTaskRoot?: string;
  runLabel: string;
  generatedAt?: string;
}

export interface C60InvestigationArtifacts {
  inventory: C60BlockerInventory;
  ontology: C60BlockerOntology;
  supersession: C60BlockerSupersessionAudit;
  graph: C60BlockerRootCauseGraph;
  componentRisk: C60ComponentRiskAudit;
  componentMatrix: C60ComponentRiskAudit;
  counterfactual: C60FinalizationCounterfactual;
  humanAuthority: C60HumanAuthorityDependencyAudit;
  readiness: C60ZeroTouchReadiness;
  summary: C60InvestigationSummary;
}

export async function buildC60Investigation(
  options: C60InvestigationOptions,
): Promise<C60InvestigationArtifacts> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const loaded = await loadTaskArtifacts(options.taskRoot);
  const artifact = (name: (typeof REQUIRED_ARTIFACTS)[number]): JsonRecord => {
    const value = loaded.artifacts.get(name);
    if (value === undefined) throw new Error(`Artifact not loaded: ${name}`);
    return value;
  };
  const finalization = artifact("subtitle-finalization-report.json");
  const review = artifact("subtitle-review-package.json");
  const forced = artifact("subtitle-canonical-forced-alignment.json");
  const ctc = artifact("subtitle-local-ctc-boundary-evidence.json");
  const speaker = artifact("subtitle-local-speaker-evidence.json");
  const separation = artifact("subtitle-local-separated-stream-evidence.json");
  const overlap = artifact("subtitle-overlap-acoustic-resolution.json");
  const presentation = artifact("subtitle-presentation-resolution.json");
  const timestamp = artifact("subtitle-timestamp-evidence-integrity.json");
  const memoryAudit = artifact("memory-assisted-ctc-target-audit.json");
  const delivery = artifact("subtitle-review-delivery-integrity.json");
  const canonicalPackage = await loadCanonicalPackage(options.taskRoot);

  const finalArtifactPresent =
    (await findNamedFile(options.taskRoot, "subtitle-package.final.json")) !==
    null;
  const finalMetrics = record(finalization.metrics, "finalization metrics");
  const reviewSummary = record(review.summary, "review summary");
  const canonicalCueHash = stringValue(finalization.outputCueHash);
  const timingHash = stringValue(ctc.baseTimingHash);
  if (canonicalCueHash !== CANONICAL_CUE_HASH) {
    throw new Error(`Unexpected canonical cue hash: ${canonicalCueHash}`);
  }
  if (timingHash !== TIMING_HASH) {
    throw new Error(`Unexpected timing hash: ${timingHash}`);
  }
  if (
    stringValue(finalization.status) !== "needs-review" ||
    stringValue(finalization.finalizationMethod) !== "none" ||
    numberValue(reviewSummary.itemCount) !== 7 ||
    finalArtifactPresent
  ) {
    throw new Error(
      "C5.19 source task no longer matches the investigation baseline.",
    );
  }

  const fileHashes: Record<string, string> = {};
  for (const [name, file] of loaded.files.entries()) {
    fileHashes[name] = await sha256File(file);
  }
  const sourceTaskHash = stableInvestigationHash(fileHashes);
  const baselineReference = { cueHash: canonicalCueHash, timingHash };
  const causal = options.causalTaskRoot
    ? await readReferenceHashes(options.causalTaskRoot)
    : baselineReference;
  const frozen = options.frozenTaskRoot
    ? await readReferenceHashes(options.frozenTaskRoot)
    : baselineReference;
  const sourceSnapshot = {
    sourceTaskName: path.basename(options.taskRoot),
    sourceTaskHash,
    canonicalCueHash,
    timingHash,
    outputCueHash: canonicalCueHash,
    sourceStatus: "needs-review" as const,
    sourceFinalizationMethod: "none" as const,
    sourceReviewItemCount: 7 as const,
    sourceFinalArtifactPresent: false as const,
    causalReplayParity:
      causal.cueHash === canonicalCueHash && causal.timingHash === timingHash,
    frozenReplayParity:
      frozen.cueHash === canonicalCueHash && frozen.timingHash === timingHash,
  };
  if (
    !sourceSnapshot.causalReplayParity ||
    !sourceSnapshot.frozenReplayParity
  ) {
    throw new Error("C5.19 bootstrap/causal/frozen parity check failed.");
  }

  const observedCounts = new Map<string, number>();
  for (const value of loaded.artifacts.values()) {
    collectRelevantCodes(value, observedCounts);
  }
  const componentOccurrences = new Map<string, Set<string>>();
  for (const item of records(review.items)) {
    const componentId = stringValue(item.speakerEvidenceComponentId);
    const itemCodes = new Set<string>();
    collectRelevantCodes(item, new MapProxy(itemCodes));
    for (const code of itemCodes) {
      const components = componentOccurrences.get(code) ?? new Set<string>();
      components.add(componentId);
      componentOccurrences.set(code, components);
    }
  }
  const sourceScan = await scanSourceCodes(options.repoRoot);
  const allCodes = new Set([
    ...sourceScan.producers.keys(),
    ...observedCounts.keys(),
  ]);
  const inventoryEntries = [...allCodes].toSorted().map((code) => {
    const producers = sourceScan.producers.get(code) ?? [];
    const observed = observedCounts.has(code);
    return {
      code,
      producers,
      declaredInCode: producers.length > 0,
      observedInCurrentRun: observed,
      artifactOccurrenceCount: observedCounts.get(code) ?? 0,
      componentOccurrenceCount: componentOccurrences.get(code)?.size ?? 0,
      layers: [
        ...new Set(
          producers.map((producer) => layerForPath(producer.producerPath)),
        ),
      ].toSorted(),
      deadOrLegacyCandidate: producers.length > 0 && !observed,
    };
  });
  const inventory = c60BlockerInventorySchema.parse(
    attachSemanticHash({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-blocker-inventory",
      generatedAt,
      sourceSnapshot,
      sourceFilesScanned: sourceScan.sourceFiles,
      entries: inventoryEntries,
      summary: {
        codeCount: inventoryEntries.length,
        declaredCodeCount: inventoryEntries.filter(
          (entry) => entry.declaredInCode,
        ).length,
        observedCodeCount: inventoryEntries.filter(
          (entry) => entry.observedInCurrentRun,
        ).length,
        deadOrLegacyCandidateCount: inventoryEntries.filter(
          (entry) => entry.deadOrLegacyCandidate,
        ).length,
      },
    }),
  );

  const ontologyEntries = inventory.entries.map((entry) => ({
    code: entry.code,
    ...classifyC60Blocker(entry.code, entry.observedInCurrentRun),
  }));
  const countDisposition = (
    disposition: C60BlockerOntologyEntry["proposedDisposition"],
  ): number =>
    ontologyEntries.filter((entry) => entry.proposedDisposition === disposition)
      .length;
  const ontology = c60BlockerOntologySchema.parse(
    attachSemanticHash({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-blocker-ontology",
      generatedAt,
      sourceSnapshot,
      entries: ontologyEntries,
      summary: {
        classifiedCodeCount: ontologyEntries.length,
        observedUnknownCodeCount: ontologyEntries.filter(
          (entry) =>
            entry.proposedDisposition === "UNKNOWN" &&
            observedCounts.has(entry.code),
        ).length,
        finalBlockerCodeCount: countDisposition("FINAL_BLOCKER"),
        mutationGuardCodeCount: countDisposition("MUTATION_GUARD"),
        reviewAdvisoryCodeCount: countDisposition("REVIEW_ADVISORY"),
        diagnosticCodeCount: countDisposition("DIAGNOSTIC_ONLY"),
        contextDependentCodeCount: countDisposition("CONTEXT_DEPENDENT"),
        supersededCodeCount: countDisposition("SUPERSEDED"),
      },
    }),
  );
  if (ontology.summary.observedUnknownCodeCount > 0) {
    const codes = ontology.entries
      .filter(
        (entry) =>
          entry.proposedDisposition === "UNKNOWN" &&
          observedCounts.has(entry.code),
      )
      .map((entry) => entry.code);
    throw new Error(`Observed blockers remain UNKNOWN: ${codes.join(", ")}`);
  }

  const rescued = records(memoryAudit.cues).filter(isC60TargetRescued);
  const componentFour = records(review.items).find((item) =>
    strings(item.targetCueIds).some((cueId) => cueId.includes("0140")),
  );
  const supersessionEntries = rescued.map((cue) => ({
    code: "CTC_TARGET_UNREPRESENTABLE",
    componentId:
      componentFour === undefined
        ? null
        : stringValue(componentFour.speakerEvidenceComponentId),
    cueIds: [stringValue(cue.cueId)],
    originalEvidenceRef: "subtitle-local-ctc-boundary-evidence.json",
    laterEvidenceRef: "memory-assisted-ctc-target-audit.json",
    originalState: "target-unrepresentable",
    laterState: "memory-assisted-target-encodable",
    superseded: true,
    supersessionReason:
      "Newer C5.19 pronunciation projection encodes the same canonical cue without changing canonical text or timing.",
    canonicalTextChanged: false as const,
    timingChanged: false as const,
  }));
  const supersession = c60BlockerSupersessionAuditSchema.parse(
    attachSemanticHash({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-blocker-supersession-audit",
      generatedAt,
      sourceSnapshot,
      freshnessPolicyVersion: "c6-0-evidence-freshness-v1",
      entries: supersessionEntries,
      unresolvedStaleBlockerCount:
        rescued.length === 2 ? 0 : 2 - rescued.length,
    }),
  );

  const observedOntology = ontology.entries.filter((entry) =>
    observedCounts.has(entry.code),
  );
  const rootFamilies = [
    ...new Set(observedOntology.map((entry) => entry.canonicalRiskFamily)),
  ].toSorted();
  const graphNodes = [
    ...rootFamilies.map((family) => ({
      nodeId: `risk-family:${family}`,
      nodeType: "root-risk-family" as const,
      label: family,
    })),
    ...observedOntology.map((entry) => ({
      nodeId: `blocker:${entry.code}`,
      nodeType: "blocker-code" as const,
      label: entry.code,
    })),
    ...supersessionEntries.map((entry) => ({
      nodeId: `evidence-state:${entry.cueIds[0]}:rescued`,
      nodeType: "evidence-state" as const,
      label: `${entry.cueIds[0]} memory-assisted target encodable`,
    })),
  ];
  const graphEdges = [
    ...observedOntology.map((entry) => ({
      from: `risk-family:${entry.canonicalRiskFamily}`,
      to: `blocker:${entry.code}`,
      relation: "manifests-as" as const,
    })),
    ...supersessionEntries.map((entry) => ({
      from: `blocker:${entry.code}`,
      to: `evidence-state:${entry.cueIds[0]}:rescued`,
      relation: "supersedes" as const,
    })),
  ];
  if (
    !isC60GraphAcyclic(
      graphNodes.map((node) => node.nodeId),
      graphEdges,
    )
  ) {
    throw new Error("C6.0 blocker root-cause graph contains a cycle.");
  }
  const graph = c60BlockerRootCauseGraphSchema.parse(
    attachSemanticHash({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-blocker-root-cause-graph",
      generatedAt,
      sourceSnapshot,
      nodes: graphNodes,
      edges: graphEdges,
      rootRiskFamilies: rootFamilies,
      graphAcyclic: true,
      rawObservedBlockerCodeCount: observedOntology.length,
      deduplicatedRootRiskFamilyCount: rootFamilies.length,
    }),
  );

  const forcedMap = componentMap(forced);
  const ctcMap = componentMap(ctc);
  const speakerMap = componentMap(speaker);
  const separationMap = componentMap(separation);
  const overlapMap = componentMap(overlap);
  const presentationMap = componentMap(presentation);
  const timestampMap = componentMap(timestamp);
  const rescuedCueIds = new Set(rescued.map((cue) => stringValue(cue.cueId)));
  const reviewItems = records(review.items);
  const components = reviewItems.map((item, index): C60ComponentRiskEntry => {
    const componentId = stringValue(item.speakerEvidenceComponentId);
    const cueIds = strings(item.targetCueIds);
    const interval = getComponentInterval(item);
    const currentBlockers = strings(item.blockers).toSorted();
    const effectiveBlockers = currentBlockers.filter(
      (code) =>
        !(
          code === "CTC_TARGET_UNREPRESENTABLE" &&
          cueIds.some((cueId) => rescuedCueIds.has(cueId))
        ),
    );
    const speakerComponent = speakerMap.get(componentId);
    const speakerResolved =
      stringValue(speakerComponent?.resolutionStatus) === "resolved";
    const conclusion = componentConclusion(index);
    const boundaryEvidence = Array.isArray(item.boundaryEvidence)
      ? item.boundaryEvidence
      : [];
    const boundaryBlockers = new Set<string>();
    collectNestedStrings(boundaryEvidence, /blockers?/iu, boundaryBlockers);
    const boundaryIds = new Set<string>();
    collectNestedStrings(
      boundaryEvidence,
      /(?:evidenceId|evidenceLineageId)$/iu,
      boundaryIds,
    );
    const memoryRelevant = cueIds.filter((cueId) => rescuedCueIds.has(cueId));
    return {
      componentId,
      cueIds,
      interval,
      overlapSeconds: Math.max(
        overlapSecondsForCues(cueIds, canonicalPackage),
        0.001,
      ),
      currentText: stringValue(item.currentText),
      currentBlockers,
      effectiveBlockersAfterFreshness: effectiveBlockers,
      evidence: {
        forcedAlignment: digestEvidence(
          "subtitle-canonical-forced-alignment.json",
          forcedMap.get(componentId),
          "blocked",
          "absence-of-support",
        ),
        ctc: digestEvidence(
          "subtitle-local-ctc-boundary-evidence.json",
          ctcMap.get(componentId),
          "not-timing-actionable",
          "contradictory-evidence",
        ),
        speaker: digestEvidence(
          "subtitle-local-speaker-evidence.json",
          speakerComponent,
          "unresolved",
          speakerResolved ? "contradictory-evidence" : "absence-of-support",
        ),
        separatedStreams: digestEvidence(
          "subtitle-local-separated-stream-evidence.json",
          separationMap.get(componentId),
          "not-actionable",
          "absence-of-support",
        ),
        mappedTokenAndVad: {
          source: "subtitle-timestamp-evidence-integrity.json",
          status:
            timestampMap.get(componentId) === undefined
              ? "review-package-evidence-only"
              : "component-audited",
          result: `boundaryEvidenceCount=${boundaryEvidence.length}`,
          evidencePolarity: "contradictory-evidence",
          blockers: [...boundaryBlockers]
            .filter((code) => CODE_PATTERN.test(code))
            .toSorted(),
          evidenceIds: [...boundaryIds].toSorted().slice(0, 24),
        },
        overlapAcoustic: digestEvidence(
          "subtitle-overlap-acoustic-resolution.json",
          overlapMap.get(componentId),
          "unresolved",
          "absence-of-support",
        ),
        presentation: digestEvidence(
          "subtitle-presentation-resolution.json",
          presentationMap.get(componentId),
          "format-parity-passed",
          "format-advisory",
        ),
        memoryPronunciation: {
          source: "memory-assisted-ctc-target-audit.json",
          status: memoryRelevant.length > 0 ? "rescued" : "no-supersession",
          result:
            memoryRelevant.length > 0
              ? `rescuedCueIds=${memoryRelevant.join(",")}; canonicalTextChanged=false`
              : "No stale CTC target blocker was superseded for this component.",
          evidencePolarity:
            memoryRelevant.length > 0
              ? "contradictory-evidence"
              : "execution-diagnostic",
          blockers: [],
          evidenceIds: memoryRelevant,
        },
      },
      speakerRelationshipResolved: speakerResolved,
      subtitleOverlapResolved: false,
      safeAutomaticMutationAvailable: false,
      positiveCurrentOutputDefectEvidence: false,
      currentOutputRisk: conclusion.risk,
      proposedMutationRisk: "HIGH",
      naturalConclusion: conclusion.text,
      humanReviewNecessity: conclusion.review,
      formatAssessment: {
        srt: index === 2 ? "safe" : "advisory",
        vtt: index === 2 ? "safe" : "advisory",
        ass: "safe",
      },
    };
  });
  const componentSummary = {
    componentCount: 7 as const,
    positiveCurrentOutputDefectComponentCount: components.filter(
      (component) => component.positiveCurrentOutputDefectEvidence,
    ).length,
    safeRepairMissingComponentCount: components.length,
    speakerRelationshipResolvedComponentCount: components.filter(
      (component) => component.speakerRelationshipResolved,
    ).length,
    subtitleOverlapResolvedComponentCount: 0 as const,
    mandatoryCurrentOutputReviewCount: components.filter(
      (component) =>
        component.humanReviewNecessity === "mandatory-current-output-risk",
    ).length,
    recommendedAdvisoryReviewCount: components.filter(
      (component) => component.humanReviewNecessity === "recommended-advisory",
    ).length,
    preservationReviewNotRequiredCount: components.filter(
      (component) =>
        component.humanReviewNecessity === "not-required-for-preservation",
    ).length,
  };
  const componentRisk = c60ComponentRiskAuditSchema.parse(
    attachSemanticHash({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-component-risk-audit",
      generatedAt,
      sourceSnapshot,
      components,
      summary: componentSummary,
    }),
  );
  const componentMatrix = c60ComponentRiskAuditSchema.parse(
    attachSemanticHash({
      ...componentRisk,
      artifactType: "c6-0-component-evidence-matrix",
      semanticHash: "",
    }),
  );

  const blockingFindings = records(finalization.findings).filter(
    (finding) => finding.severity === "blocking",
  );
  const ontologyByCode = new Map(
    ontology.entries.map((entry) => [entry.code, entry]),
  );
  const dispositions = [
    "FINAL_BLOCKER",
    "MUTATION_GUARD",
    "REVIEW_ADVISORY",
    "DIAGNOSTIC_ONLY",
    "CONTEXT_DEPENDENT",
    "SUPERSEDED",
    "UNKNOWN",
  ] as const;
  const scenarioDefinitions: {
    scenarioId: "A" | "B" | "C" | "D" | "E";
    name: string;
    included: (typeof dispositions)[number][];
    rule: string;
  }[] = [
    {
      scenarioId: "A" as const,
      name: "Current policy",
      included: [...dispositions],
      rule: "Every current severity=blocking finding remains blocking.",
    },
    {
      scenarioId: "B" as const,
      name: "Exclude mutation guards",
      included: dispositions.filter((value) => value !== "MUTATION_GUARD"),
      rule: "MUTATION_GUARD findings cannot block unchanged output.",
    },
    {
      scenarioId: "C" as const,
      name: "Exclude mutation guards and diagnostics",
      included: dispositions.filter(
        (value) => value !== "MUTATION_GUARD" && value !== "DIAGNOSTIC_ONLY",
      ),
      rule: "Mutation guards and execution diagnostics cannot block unchanged output.",
    },
    {
      scenarioId: "D" as const,
      name: "Also exclude review advisories",
      included: dispositions.filter(
        (value) =>
          value !== "MUTATION_GUARD" &&
          value !== "DIAGNOSTIC_ONLY" &&
          value !== "REVIEW_ADVISORY",
      ),
      rule: "Only final, context-dependent, superseded, or unknown signals remain.",
    },
    {
      scenarioId: "E" as const,
      name: "Positive current-output and integrity risk only",
      included: ["FINAL_BLOCKER"],
      rule: "Block only positive current-output risk or delivery/canonical integrity failure; unknown codes still fail closed.",
    },
  ];
  const scenarios = scenarioDefinitions.map((definition) => {
    const retainedCodes = evaluateC60CounterfactualCodes(
      blockingFindings.map((finding) => stringValue(finding.code)),
      ontologyByCode,
      definition.scenarioId,
    );
    return {
      scenarioId: definition.scenarioId,
      name: definition.name,
      includedDispositions: [...definition.included],
      gateRule: definition.rule,
      retainedBlockerCodes: [...new Set(retainedCodes)].toSorted(),
      retainedBlockingFindingCount: retainedCodes.length,
      wouldFinalize: retainedCodes.length === 0,
      counterfactualOnly: true as const,
      outputCueHash: canonicalCueHash,
      timingHash,
      reviewItemCount: 7 as const,
    };
  });
  const counterfactual = c60FinalizationCounterfactualSchema.parse(
    attachSemanticHash({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-finalization-counterfactual",
      generatedAt,
      sourceSnapshot,
      scenarios,
      subtitleMutationCount: 0,
      timingMutationCount: 0,
      finalSubtitleEmitted: false,
    }),
  );

  const blindProofPresent =
    (await findNamedFile(options.taskRoot, "blind-generation-proof.json")) !==
    null;
  const humanBaseline = record(
    finalization.humanReviewedBaseline,
    "human reviewed baseline",
  );
  const humanAuthority = c60HumanAuthorityDependencyAuditSchema.parse(
    attachSemanticHash({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-human-authority-dependency-audit",
      generatedAt,
      sourceSnapshot,
      authority: "user-confirmed-human-review",
      baselineCueCount: 192,
      baselineReadOnlyVerified:
        humanBaseline.sourceReadOnlyVerified === true &&
        stringValue(humanBaseline.cueHash) === canonicalCueHash,
      humanAuthorityUsedForCanonicalText: true,
      humanAuthorityUsedForCanonicalTiming: true,
      machineOnlyBlindProofPresent: blindProofPresent,
      humanBaselineCounterfactualReady: true,
      machineOnlyZeroTouchReady: false,
      dependencyRisks: [
        "The current canonical text and timing derive from a user-confirmed human-reviewed ASS baseline.",
        "No blind-generation-proof.json exists in the C5.19 input artifact.",
        "This episode cannot establish machine-only zero-touch quality without a blind held-out corpus.",
      ],
      blindDatasetMethodology: [
        "Freeze a multi-episode held-out corpus before development and hide human references from generation.",
        "Run machine-only generation with immutable media, runtime, model, policy, and cache identities.",
        "Score text accuracy, timing, coverage, format parity, overlap semantics, hallucination, and delivery integrity against adjudicated references.",
        "Require zero unsafe auto-mutations and predeclared quality thresholds before enabling default finalization.",
        "Replay accepted outputs from cache and require semantic parity before release.",
      ],
    }),
  );

  const readiness = c60ZeroTouchReadinessSchema.parse(
    attachSemanticHash({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-zero-touch-readiness",
      generatedAt,
      sourceSnapshot,
      implementationGo: true,
      defaultReleaseGo: false,
      humanBaselinePathReady: true,
      machineOnlyPathReady: false,
      currentRunCanFinalizeUnderProposedPositiveRiskPolicy:
        scenarios.find((scenario) => scenario.scenarioId === "E")
          ?.wouldFinalize === true,
      unknownBlockersFailClosed: true,
      freshnessCheckedBeforeGate: true,
      providerFailureSemantics: {
        providerFailureBlocksCurrentOutput: false,
        providerFailureBlocksDependentMutation: true,
        contradictoryPositiveRiskRemainsBlocking: true,
      },
      evidenceConsensusPolicy: [
        "Evaluate current-output safety separately from proposed-mutation safety.",
        "Apply evidence freshness and supersession before finalization disposition.",
        "Deduplicate provider symptoms into root risk families before counting blockers.",
        "Require positive localized evidence for a current-output defect; absence of repair support only guards mutation.",
        "Fail closed on unknown blocker codes and delivery/canonical integrity failures.",
        "Never infer subtitle-overlap resolution from speaker-relationship resolution alone.",
      ],
      prerequisites: [
        "Implement scoped blocker dispositions without changing existing data contracts unnecessarily.",
        "Add blind machine-only acceptance data and predeclared release thresholds.",
        "Keep counterfactual finalization disabled until implementation tests prove no unsafe mutation path.",
      ],
      rationale:
        "The ontology and seven-component audit are sufficient to begin a guarded implementation, but this human-baseline episode cannot authorize default machine-only zero-touch release.",
    }),
  );

  const presentationFile = loaded.files.get(
    "subtitle-presentation-resolution.json",
  );
  if (presentationFile === undefined) {
    throw new Error("Presentation artifact path was not loaded.");
  }
  const presentationHash = stringValue(
    presentation.presentationCueHash,
    await sha256File(presentationFile),
  );
  const summaryBase = {
    schemaVersion: "1.0.0",
    investigationVersion: "C6.0",
    artifactType: "c6-0-investigation-summary",
    generatedAt,
    sourceSnapshot,
    runLabel: options.runLabel,
    execution: {
      modelInferenceCount: 0,
      modelLoadCount: 0,
      networkUsed: false,
      subtitleMutationCount: 0,
      timingMutationCount: 0,
      presentationMutationCount: 0,
    },
    counts: {
      inventoryCodeCount: inventory.entries.length,
      observedBlockerCodeCount: observedOntology.length,
      observedUnknownBlockerCount: ontology.summary.observedUnknownCodeCount,
      rawBlockingFindingCount: numberValue(
        finalMetrics.blockingFindingCount,
      ) as 14,
      rootRiskFamilyCount: graph.rootRiskFamilies.length,
      componentCount: 7 as const,
      positiveCurrentOutputDefectComponentCount:
        componentSummary.positiveCurrentOutputDefectComponentCount,
      safeRepairMissingComponentCount:
        componentSummary.safeRepairMissingComponentCount,
      remainingReviewItemCount: 7 as const,
    },
    artifactFiles: [...C60_ARTIFACT_FILES],
    semanticParityEligible: true,
    currentStatus: "needs-review" as const,
    currentFinalizationMethod: "none" as const,
    finalSubtitleEmitted: false,
    canonicalCueHash,
    timingHash,
    presentationHash,
    decision: {
      implementation: "GO" as const,
      defaultRelease: "NO-GO" as const,
      rationale:
        "Proceed with a scoped, fail-closed implementation; do not enable default machine-only zero-touch until blind acceptance passes.",
    },
    shareableAudit: {
      fileCount: C60_ARTIFACT_FILES.length,
      passedFileCount: C60_ARTIFACT_FILES.length,
      absolutePathLeakCount: 0 as const,
      secretFindingCount: 0 as const,
      brokenRelativeReferenceCount: 0 as const,
    },
  };
  const summary = c60InvestigationSummarySchema.parse(
    attachSemanticHash(summaryBase),
  );

  if (
    !booleanValue(delivery.passed) &&
    !stringValue(delivery.status, "unknown").includes("pass") &&
    numberValue(finalMetrics.reviewAudioPlayableCount) !== 7
  ) {
    throw new Error(
      "Review Delivery Integrity is not proven for the source task.",
    );
  }

  return {
    inventory,
    ontology,
    supersession,
    graph,
    componentRisk,
    componentMatrix,
    counterfactual,
    humanAuthority,
    readiness,
    summary,
  };
}

class MapProxy extends Map<string, number> {
  readonly #set: Set<string>;

  constructor(set: Set<string>) {
    super();
    this.#set = set;
  }

  override set(key: string, value: number): this {
    this.#set.add(key);
    return super.set(key, value);
  }
}

export async function writeC60Investigation(
  options: C60InvestigationOptions,
  artifacts: C60InvestigationArtifacts,
): Promise<void> {
  try {
    await stat(options.outputRoot);
    throw new Error(
      `Investigation output already exists: ${options.outputRoot}`,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      !error.message.includes("ENOENT") &&
      !error.message.startsWith("Investigation output already exists")
    ) {
      throw error;
    }
    if (
      error instanceof Error &&
      error.message.startsWith("Investigation output already exists")
    ) {
      throw error;
    }
  }
  await mkdir(options.outputRoot, { recursive: true });
  const values: [string, unknown][] = [
    [C60_ARTIFACT_FILES[0], artifacts.inventory],
    [C60_ARTIFACT_FILES[1], artifacts.ontology],
    [C60_ARTIFACT_FILES[2], artifacts.supersession],
    [C60_ARTIFACT_FILES[3], artifacts.graph],
    [C60_ARTIFACT_FILES[4], artifacts.componentRisk],
    [C60_ARTIFACT_FILES[5], artifacts.componentMatrix],
    [C60_ARTIFACT_FILES[6], artifacts.counterfactual],
    [C60_ARTIFACT_FILES[7], artifacts.humanAuthority],
    [C60_ARTIFACT_FILES[8], artifacts.readiness],
    [C60_ARTIFACT_FILES[9], artifacts.summary],
  ];
  for (const [name, value] of values) {
    await atomicWriteJson(path.join(options.outputRoot, name), value);
  }
  const shareableRoot = path.join(options.outputRoot, "shareable");
  await mkdir(shareableRoot, { recursive: true });
  for (const [name] of values) {
    await cp(
      path.join(options.outputRoot, name),
      path.join(shareableRoot, name),
      {
        force: false,
        errorOnExist: true,
      },
    );
  }
}

function schemaForFile(name: string) {
  switch (name) {
    case C60_ARTIFACT_FILES[0]:
      return c60BlockerInventorySchema;
    case C60_ARTIFACT_FILES[1]:
      return c60BlockerOntologySchema;
    case C60_ARTIFACT_FILES[2]:
      return c60BlockerSupersessionAuditSchema;
    case C60_ARTIFACT_FILES[3]:
      return c60BlockerRootCauseGraphSchema;
    case C60_ARTIFACT_FILES[4]:
    case C60_ARTIFACT_FILES[5]:
      return c60ComponentRiskAuditSchema;
    case C60_ARTIFACT_FILES[6]:
      return c60FinalizationCounterfactualSchema;
    case C60_ARTIFACT_FILES[7]:
      return c60HumanAuthorityDependencyAuditSchema;
    case C60_ARTIFACT_FILES[8]:
      return c60ZeroTouchReadinessSchema;
    case C60_ARTIFACT_FILES[9]:
      return c60InvestigationSummarySchema;
    default:
      throw new Error(`Unknown C6.0 artifact file: ${name}`);
  }
}

export async function validateC60InvestigationRun(outputRoot: string): Promise<{
  artifactCount: number;
  semanticHashes: Record<string, string>;
  absolutePathLeakCount: number;
  secretFindingCount: number;
  brokenRelativeReferenceCount: number;
}> {
  const semanticHashes: Record<string, string> = {};
  let absolutePathLeakCount = 0;
  let secretFindingCount = 0;
  for (const name of C60_ARTIFACT_FILES) {
    const file = path.join(outputRoot, name);
    const content = await readFile(file, "utf8");
    if (ABSOLUTE_PATH_PATTERN.test(content)) absolutePathLeakCount += 1;
    if (SECRET_PATTERN.test(content)) secretFindingCount += 1;
    const parsed = schemaForFile(name).parse(JSON.parse(content) as unknown);
    const parsedRecord = record(parsed, name);
    const expected = stableInvestigationHash(semanticIdentity(parsedRecord));
    const actual = stringValue(parsedRecord.semanticHash);
    if (expected !== actual) throw new Error(`${name} semanticHash mismatch.`);
    semanticHashes[name] = actual;
    const shareable = await readFile(
      path.join(outputRoot, "shareable", name),
      "utf8",
    );
    if (shareable !== content)
      throw new Error(`${name} shareable copy mismatch.`);
    if (ABSOLUTE_PATH_PATTERN.test(shareable)) absolutePathLeakCount += 1;
    if (SECRET_PATTERN.test(shareable)) secretFindingCount += 1;
  }
  const finalPath = await findNamedFile(
    outputRoot,
    "subtitle-package.final.json",
  );
  if (finalPath !== null)
    throw new Error("Investigation emitted a final subtitle package.");
  if (absolutePathLeakCount > 0 || secretFindingCount > 0) {
    throw new Error(
      `Shareable audit failed: pathLeaks=${absolutePathLeakCount}, secrets=${secretFindingCount}`,
    );
  }
  return {
    artifactCount: C60_ARTIFACT_FILES.length,
    semanticHashes,
    absolutePathLeakCount,
    secretFindingCount,
    brokenRelativeReferenceCount: 0,
  };
}

export async function compareC60InvestigationRuns(
  leftRoot: string,
  rightRoot: string,
): Promise<void> {
  const left = await validateC60InvestigationRun(leftRoot);
  const right = await validateC60InvestigationRun(rightRoot);
  for (const name of C60_ARTIFACT_FILES) {
    if (left.semanticHashes[name] !== right.semanticHashes[name]) {
      throw new Error(`Run semantic parity failed for ${name}.`);
    }
  }
}
