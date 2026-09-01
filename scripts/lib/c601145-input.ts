import path from "node:path";
import {
  atomUtility144Schema,
  bundleUtility144Schema,
  childUtility144Schema,
  forcedInclusion144Schema,
  optionalChildLedger144Schema,
  planner144Schema,
  reviewAudio144Schema,
  reviewItems144Schema,
  reviewPlayback144Schema,
  reviewRegions144Schema,
  reviewTargets144Schema,
  safetyTargets144Schema,
  utilityPolicy144Schema,
} from "@mvl/shared";
import {
  readJson141,
  safeRelative141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  assertHash141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { loadInputs144 } from "./c601144-input.js";

export async function loadInputs145(previousStatePath: string) {
  const inherited = await loadInputs144(previousStatePath),
    state = inherited.previousState,
    outputRoot = path.resolve(state.config.outputRoot),
    output = (role: string) =>
      required141(
        state.outputs[role],
        `C601145_PREVIOUS_OUTPUT_MISSING:${role}`,
      ),
    read = (role: string, ...parts: string[]) => {
      const file = path.join(output(role), ...parts);
      safeRelative141(outputRoot, file);
      if (/(?:^|[/_-])gold(?:[/_.-]|$)/iu.test(file))
        throw new Error("C601145_MACHINE_INPUT_GOLD_PATH_FORBIDDEN");
      return readJson141(file);
    };

  const [
    previousUtilityPolicy,
    atomUtility,
    childUtility,
    bundleUtility,
    utilityPlanner,
    safetyV4,
    reviewTargetsV6,
    reviewItemsV8,
    reviewRegionsV7,
    reviewAudioV7,
    reviewPlaybackV6,
    forcedInclusion144,
    optionalChildLedger144,
  ] = await Promise.all([
    read("baseline", "c6-0-1-14-4-machine-evidence-utility-policy.json").then(
      (value) => utilityPolicy144Schema.parse(value),
    ),
    read("atom-utility", "machine-evidence-atom-utility-v1.json").then(
      (value) => atomUtility144Schema.parse(value),
    ),
    read("child-utility", "machine-selectable-child-utility-v1.json").then(
      (value) => childUtility144Schema.parse(value),
    ),
    read("bundle-utility", "machine-target-bundle-utility-v1.json").then(
      (value) => bundleUtility144Schema.parse(value),
    ),
    read(
      "utility-planner",
      "machine-utility-aware-final-planner-certificate.json",
    ).then((value) => planner144Schema.parse(value)),
    read(
      "utility-planner",
      "machine-missing-safety-reserve-targets-v4.json",
    ).then((value) => safetyTargets144Schema.parse(value)),
    read(
      "final-a",
      "review-workspace",
      "machine-review-target-intervals-v6.json",
    ).then((value) => reviewTargets144Schema.parse(value)),
    read("final-a", "review-workspace", "machine-review-items-v8.json").then(
      (value) => reviewItems144Schema.parse(value),
    ),
    read("final-a", "review-workspace", "machine-review-regions-v7.json").then(
      (value) => reviewRegions144Schema.parse(value),
    ),
    read(
      "final-a",
      "review-workspace",
      "machine-review-audio-manifest-v7.json",
    ).then((value) => reviewAudio144Schema.parse(value)),
    read(
      "final-a",
      "review-workspace",
      "machine-review-playback-timeline-v6.json",
    ).then((value) => reviewPlayback144Schema.parse(value)),
    read(
      "optional-child-ledger",
      "machine-forced-inclusion-planner-results.json",
    ).then((value) => forcedInclusion144Schema.parse(value)),
    read(
      "optional-child-ledger",
      "machine-optional-speech-child-coverage-ledger.json",
    ).then((value) => optionalChildLedger144Schema.parse(value)),
  ]);

  [
    previousUtilityPolicy,
    atomUtility,
    childUtility,
    bundleUtility,
    utilityPlanner,
    safetyV4,
    reviewTargetsV6,
    reviewItemsV8,
    reviewRegionsV7,
    reviewAudioV7,
    reviewPlaybackV6,
    forcedInclusion144,
    optionalChildLedger144,
  ].forEach(assertHash141);

  if (
    atomUtility.hierarchyHash !== inherited.hierarchy.semanticHash ||
    childUtility.atomUtilityHash !== atomUtility.semanticHash ||
    bundleUtility.childUtilityHash !== childUtility.semanticHash ||
    utilityPlanner.atomUtilityHash !== atomUtility.semanticHash ||
    utilityPlanner.childUtilityHash !== childUtility.semanticHash ||
    utilityPlanner.bundleUtilityHash !== bundleUtility.semanticHash ||
    safetyV4.plannerCertificateHash !== utilityPlanner.semanticHash ||
    reviewPlaybackV6.audioManifestHash !== reviewAudioV7.semanticHash
  )
    throw new Error("C601145_OFFICIAL_144_BINDING_CHANGED");

  return {
    ...inherited,
    previousUtilityPolicy,
    atomUtility,
    childUtility,
    bundleUtility,
    utilityPlanner,
    safetyV4,
    reviewTargetsV6,
    reviewItemsV8,
    reviewRegionsV7,
    reviewAudioV7,
    reviewPlaybackV6,
    forcedInclusion144,
    optionalChildLedger144,
    priorFinalA: output("final-a"),
    priorFinalB: output("final-b"),
    priorEvaluation: output("evaluation"),
    existingTargetIntervals: safetyV4.targets.flatMap(
      (target) => target.atomicCoreIntervals,
    ),
    existingPlaybackIntervals: reviewAudioV7.audio.map(
      (audio) => audio.nativeSourceInterval,
    ),
  };
}

export type Inputs145 = Awaited<ReturnType<typeof loadInputs145>>;
