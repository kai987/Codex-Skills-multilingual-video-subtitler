import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60112Interval,
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  type C60112Interval,
  type C60112ReviewItem,
  type C60112ReviewItemType,
  type C60112ReviewPolicy,
  type C60112ReviewReasonCode,
  type C60112SuggestedAction,
} from "./c60112-policy.js";
import { scoreC60112ReviewRisk } from "./review-priority.js";

export interface C60112MachineReviewSignal {
  reviewGroupId?: string;
  eventIds: readonly string[];
  finalCueIds: readonly string[];
  itemTypes: readonly C60112ReviewItemType[];
  sourceInterval: C60112Interval;
  coreInterval?: C60112Interval;
  currentText: string | null;
  candidateIds: readonly string[];
  evidenceIds: readonly string[];
  reviewReasons: readonly C60112ReviewReasonCode[];
  suggestedActions?: readonly C60112SuggestedAction[];
  sceneIds?: readonly string[];
  speakerGroupIds?: readonly string[];
}

export interface C60112MachineReviewItemsArtifact {
  schemaVersion: "1.0.0";
  policyVersion: C60112ReviewPolicy["policyVersion"];
  artifactType: "c6-0-1-12-machine-review-items";
  policyHash: string;
  sourceTimebase: "SOURCE_GLOBAL_SECONDS";
  runtimeGoldInputCount: 0;
  items: C60112ReviewItem[];
  summary: {
    signalCount: number;
    itemCount: number;
    multiLabelItemCount: number;
    orphanItemCount: number;
    requiredItemCount: number;
  };
  semanticHash: string;
}

interface MutableItem {
  eventIds: Set<string>;
  finalCueIds: Set<string>;
  itemTypes: Set<C60112ReviewItemType>;
  sourceInterval: C60112Interval;
  coreInterval: C60112Interval;
  currentText: string | null;
  candidateIds: Set<string>;
  evidenceIds: Set<string>;
  reviewReasons: Set<C60112ReviewReasonCode>;
  suggestedActions: Set<C60112SuggestedAction>;
  sceneIds: Set<string>;
  speakerGroupIds: Set<string>;
}

function cleanIdentifiers(values: readonly string[], label: string): string[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.some((value) => /[\r\n]/u.test(value))) {
    throw new Error(`INVALID_REVIEW_IDENTIFIER:${label}`);
  }
  return [...new Set(cleaned)].toSorted();
}

function defaultSuggestedActions(
  types: ReadonlySet<C60112ReviewItemType>,
): C60112SuggestedAction[] {
  const actions = new Set<C60112SuggestedAction>([
    "KEEP_CURRENT",
    "UNRESOLVED",
  ]);
  if (types.has("MISSING_SPEECH_RISK")) {
    actions.add("ADD_NEW_CUE");
    actions.add("MARK_FALSE_POSITIVE");
  }
  if (types.has("TIMING_BOUNDARY_RISK") || types.has("TIMING_SEVERE_RISK")) {
    actions.add("TIMING_EDIT");
  }
  if (
    [...types].some(
      (type) =>
        type.startsWith("TEXT_") ||
        type === "EVIDENCE_CONFLICT" ||
        type === "SPAN_LINEAGE_BLOCKED",
    )
  ) {
    actions.add("USE_REAZON");
    actions.add("USE_WHISPER_ALTERNATE");
    actions.add("MANUAL_EDIT");
  }
  return [...actions].toSorted();
}

function groupIdentity(signal: C60112MachineReviewSignal): string {
  if (
    signal.reviewGroupId !== undefined &&
    signal.reviewGroupId.trim() !== ""
  ) {
    return `explicit:${signal.reviewGroupId.trim()}`;
  }
  const eventIds = cleanIdentifiers(signal.eventIds, "eventIds");
  if (eventIds.length > 0) return `events:${eventIds.join("|")}`;
  const cueIds = cleanIdentifiers(signal.finalCueIds, "finalCueIds");
  if (cueIds.length > 0) return `cues:${cueIds.join("|")}`;
  return `orphan:${machineQualitySemanticHash({
    sourceInterval: signal.sourceInterval,
    coreInterval: signal.coreInterval ?? signal.sourceInterval,
    evidenceIds: cleanIdentifiers(signal.evidenceIds, "evidenceIds"),
  })}`;
}

function validateSignal(
  signal: C60112MachineReviewSignal,
  index: number,
): void {
  assertC60112Interval(signal.sourceInterval, `signal-${index}-source`);
  const core = signal.coreInterval ?? signal.sourceInterval;
  assertC60112Interval(core, `signal-${index}-core`);
  if (
    core.start < signal.sourceInterval.start ||
    core.end > signal.sourceInterval.end
  ) {
    throw new Error(`CORE_INTERVAL_OUTSIDE_SOURCE:signal-${index}`);
  }
  if (signal.itemTypes.length === 0) {
    throw new Error(`REVIEW_ITEM_TYPE_REQUIRED:signal-${index}`);
  }
  if (signal.reviewReasons.length === 0) {
    throw new Error(`REVIEW_REASON_REQUIRED:signal-${index}`);
  }
}

function mergeText(
  existing: string | null,
  incoming: string | null,
  groupId: string,
): string | null {
  if (existing === null) return incoming;
  if (incoming === null || existing === incoming) return existing;
  throw new Error(`REVIEW_ITEM_CURRENT_TEXT_CONFLICT:${groupId}`);
}

function addAll<T>(target: Set<T>, values: readonly T[]): void {
  values.forEach((value) => {
    target.add(value);
  });
}

function mutableFromSignal(signal: C60112MachineReviewSignal): MutableItem {
  const itemTypes = new Set(signal.itemTypes);
  return {
    eventIds: new Set(cleanIdentifiers(signal.eventIds, "eventIds")),
    finalCueIds: new Set(cleanIdentifiers(signal.finalCueIds, "finalCueIds")),
    itemTypes,
    sourceInterval: { ...signal.sourceInterval },
    coreInterval: { ...(signal.coreInterval ?? signal.sourceInterval) },
    currentText: signal.currentText,
    candidateIds: new Set(
      cleanIdentifiers(signal.candidateIds, "candidateIds"),
    ),
    evidenceIds: new Set(cleanIdentifiers(signal.evidenceIds, "evidenceIds")),
    reviewReasons: new Set(signal.reviewReasons),
    suggestedActions: new Set(
      signal.suggestedActions ?? defaultSuggestedActions(itemTypes),
    ),
    sceneIds: new Set(cleanIdentifiers(signal.sceneIds ?? [], "sceneIds")),
    speakerGroupIds: new Set(
      cleanIdentifiers(signal.speakerGroupIds ?? [], "speakerGroupIds"),
    ),
  };
}

function mergeSignal(
  target: MutableItem,
  signal: C60112MachineReviewSignal,
  groupId: string,
): void {
  addAll(target.eventIds, cleanIdentifiers(signal.eventIds, "eventIds"));
  addAll(
    target.finalCueIds,
    cleanIdentifiers(signal.finalCueIds, "finalCueIds"),
  );
  addAll(target.itemTypes, signal.itemTypes);
  addAll(
    target.candidateIds,
    cleanIdentifiers(signal.candidateIds, "candidateIds"),
  );
  addAll(
    target.evidenceIds,
    cleanIdentifiers(signal.evidenceIds, "evidenceIds"),
  );
  addAll(target.reviewReasons, signal.reviewReasons);
  addAll(
    target.suggestedActions,
    signal.suggestedActions ?? defaultSuggestedActions(target.itemTypes),
  );
  addAll(target.sceneIds, cleanIdentifiers(signal.sceneIds ?? [], "sceneIds"));
  addAll(
    target.speakerGroupIds,
    cleanIdentifiers(signal.speakerGroupIds ?? [], "speakerGroupIds"),
  );
  target.sourceInterval = {
    start: Math.min(target.sourceInterval.start, signal.sourceInterval.start),
    end: Math.max(target.sourceInterval.end, signal.sourceInterval.end),
  };
  const core = signal.coreInterval ?? signal.sourceInterval;
  target.coreInterval = {
    start: Math.min(target.coreInterval.start, core.start),
    end: Math.max(target.coreInterval.end, core.end),
  };
  target.currentText = mergeText(
    target.currentText,
    signal.currentText,
    groupId,
  );
}

function finalizeItem(
  groupId: string,
  item: MutableItem,
  policy: C60112ReviewPolicy,
): C60112ReviewItem {
  const itemTypes = [...item.itemTypes].toSorted();
  const reviewReasons = [...item.reviewReasons].toSorted();
  const priority = scoreC60112ReviewRisk({
    itemTypes,
    reviewReasons,
    policy,
  });
  const stableIdentity = {
    groupId,
    eventIds: [...item.eventIds].toSorted(),
    finalCueIds: [...item.finalCueIds].toSorted(),
    sourceInterval: item.sourceInterval,
    coreInterval: item.coreInterval,
  };
  const reviewItemId = `review-item-${machineQualitySemanticHash(stableIdentity).slice(0, 20)}`;
  const core = {
    reviewItemId,
    eventIds: stableIdentity.eventIds,
    finalCueIds: stableIdentity.finalCueIds,
    itemTypes,
    sourceInterval: item.sourceInterval,
    coreInterval: item.coreInterval,
    currentText: item.currentText,
    candidateIds: [...item.candidateIds].toSorted(),
    evidenceIds: [...item.evidenceIds].toSorted(),
    reviewReasons,
    priorityTier: priority.priorityTier,
    priorityScore: priority.priorityScore,
    requiredLevel: priority.requiredLevel,
    suggestedActions: [...item.suggestedActions].toSorted(),
    sceneIds: [...item.sceneIds].toSorted(),
    speakerGroupIds: [...item.speakerGroupIds].toSorted(),
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export function buildC60112ReviewItems(input: {
  signals: readonly C60112MachineReviewSignal[];
  policy: C60112ReviewPolicy;
}): C60112MachineReviewItemsArtifact {
  assertC60112ReviewPolicy(input.policy);
  assertC60112MachineOnlyInput(input.signals, "build-review-items.signals");
  const groups = new Map<string, MutableItem>();
  input.signals.forEach((signal, index) => {
    validateSignal(signal, index);
    const groupId = groupIdentity(signal);
    const existing = groups.get(groupId);
    if (existing === undefined) {
      groups.set(groupId, mutableFromSignal(signal));
    } else {
      mergeSignal(existing, signal, groupId);
    }
  });
  const items = [...groups.entries()]
    .map(([groupId, item]) => finalizeItem(groupId, item, input.policy))
    .toSorted(
      (left, right) =>
        left.sourceInterval.start - right.sourceInterval.start ||
        left.sourceInterval.end - right.sourceInterval.end ||
        left.reviewItemId.localeCompare(right.reviewItemId),
    );
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: input.policy.policyVersion,
    artifactType: "c6-0-1-12-machine-review-items" as const,
    policyHash: input.policy.semanticHash,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    runtimeGoldInputCount: 0 as const,
    items,
    summary: {
      signalCount: input.signals.length,
      itemCount: items.length,
      multiLabelItemCount: items.filter((item) => item.itemTypes.length > 1)
        .length,
      orphanItemCount: items.filter((item) => item.finalCueIds.length === 0)
        .length,
      requiredItemCount: items.filter(
        (item) => item.requiredLevel === "REQUIRED",
      ).length,
    },
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}
