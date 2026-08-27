import type {
  MachineQualityRecoveryMode,
  MachineQualityRecoveryProfile,
  SubtitleCue,
} from "@mvl/shared";

export const C6011_MACHINE_QUALITY_POLICY_VERSION =
  "c6.0.1.1-machine-quality-recovery-v1" as const;

export function machineQualityTargetChunkSeconds(input: {
  mode: MachineQualityRecoveryMode;
  configured: number | undefined;
}): number | undefined {
  if (input.configured !== undefined) return input.configured;
  return input.mode === "enforce" ? 30 : undefined;
}

/**
 * Adjacent text becomes part of the Whisper decode prompt. Only the legacy
 * modes admit provisional cues; enforce is intentionally prompt-isolated until
 * a future evidence contract can prove every adjacent cue independently.
 */
export function recoveryPromptCuesForMachineQuality(input: {
  mode: MachineQualityRecoveryMode;
  provisionalCues: readonly SubtitleCue[];
}): readonly SubtitleCue[] {
  return input.mode === "enforce" ? [] : input.provisionalCues;
}

/**
 * Comparative and targeted refinement may use accepted cues for arbitration,
 * but enforce mode must not feed those still-machine-provisional strings back
 * into the decoder prompt.
 */
export function allowRefinementContextPromptForMachineQuality(
  mode: MachineQualityRecoveryMode,
): boolean {
  return mode !== "enforce";
}

export function machineQualityProfileUsesVad(
  profile: MachineQualityRecoveryProfile,
): boolean {
  return profile === "timing" || profile === "full";
}

export function allowBaselineCarryPromptForMachineQuality(
  mode: MachineQualityRecoveryMode,
): boolean {
  return mode !== "enforce";
}
