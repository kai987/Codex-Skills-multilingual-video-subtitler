import {
  InputError,
  type SubtitleCue,
  type SubtitleLocalCtcBoundaryEvidence,
} from "@mvl/shared";

const TIMING_EPSILON_SECONDS = 0.001;

type CtcTimingMutation = SubtitleLocalCtcBoundaryEvidence["mutations"][number];

export interface CtcTimingApplicationEvidence {
  mutations: readonly CtcTimingMutation[];
  components: readonly {
    componentId: string;
    cueIds: readonly string[];
    timingMutationApplied: boolean;
    mutations: readonly CtcTimingMutation[];
  }[];
}

/**
 * Materialize only mutations already authorized by the C5.18.1 evidence gate.
 * This layer deliberately has no text-rewrite path and rechecks component
 * atomicity plus the serialized before/after contract before touching cues.
 */
export function applyCtcTimingMutations(input: {
  cues: readonly SubtitleCue[];
  evidence: CtcTimingApplicationEvidence;
}): SubtitleCue[] {
  const mutationByCueId = new Map<string, CtcTimingMutation>();
  for (const mutation of input.evidence.mutations) {
    if (mutationByCueId.has(mutation.cueId)) {
      throw new InputError(
        `Multiple CTC timing mutations target cue ${mutation.cueId}.`,
      );
    }
    mutationByCueId.set(mutation.cueId, mutation);
  }

  const sourceCueIds = new Set(input.cues.map((cue) => cue.id));
  for (const mutation of input.evidence.mutations) {
    if (!sourceCueIds.has(mutation.cueId)) {
      throw new InputError(
        `CTC timing mutation references an unknown cue: ${mutation.cueId}`,
      );
    }
  }

  for (const component of input.evidence.components) {
    const componentMutationCueIds = new Set(
      component.mutations.map((mutation) => mutation.cueId),
    );
    const artifactMutationCueIds = new Set(
      input.evidence.mutations
        .filter((mutation) => mutation.componentId === component.componentId)
        .map((mutation) => mutation.cueId),
    );
    const atomicCueIds = new Set(component.cueIds);
    const expectedApplied = component.timingMutationApplied;
    const complete = [...atomicCueIds].every(
      (cueId) =>
        componentMutationCueIds.has(cueId) && artifactMutationCueIds.has(cueId),
    );
    if (
      expectedApplied !== complete ||
      componentMutationCueIds.size !== artifactMutationCueIds.size ||
      (expectedApplied && componentMutationCueIds.size !== atomicCueIds.size)
    ) {
      throw new InputError(
        `CTC component mutation is not atomic: ${component.componentId}`,
      );
    }
  }

  const output = input.cues.map((cue) => {
    const mutation = mutationByCueId.get(cue.id);
    if (mutation === undefined) return { ...cue };
    if (
      Math.abs(cue.start - mutation.oldStart) > TIMING_EPSILON_SECONDS ||
      Math.abs(cue.end - mutation.oldEnd) > TIMING_EPSILON_SECONDS
    ) {
      throw new InputError(`CTC timing prior mismatch: ${cue.id}`);
    }
    if (
      Math.abs(mutation.deltaStart) > 0.5 + TIMING_EPSILON_SECONDS ||
      Math.abs(mutation.deltaEnd) > 0.5 + TIMING_EPSILON_SECONDS ||
      mutation.newEnd - mutation.newStart < 0.4 - TIMING_EPSILON_SECONDS
    ) {
      throw new InputError(
        `CTC timing mutation exceeds safety limits: ${cue.id}`,
      );
    }
    return { ...cue, start: mutation.newStart, end: mutation.newEnd };
  });

  for (let index = 0; index < input.cues.length; index += 1) {
    const before = input.cues[index];
    const after = output[index];
    if (before === undefined || after === undefined) {
      throw new InputError("C5.18.1 source cue iteration was inconsistent.");
    }
    if (
      after.id !== before.id ||
      after.text !== before.text ||
      after.speaker !== before.speaker ||
      after.style !== before.style
    ) {
      throw new InputError(
        "C5.18.1 timing materialization changed non-timing canonical data.",
      );
    }
  }
  return output;
}
