import path from "node:path";
import {
  bundles143Schema,
  dominance143Schema,
  hierarchy143Schema,
  obligations143Schema,
  planner143Schema,
  policy143Schema,
  state143Schema,
} from "@mvl/shared";
import type { TextCandidateFeature144 } from "../../packages/video-subtitler/src/review/c601144-utility.js";
import {
  readJson141,
  safeRelative141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  assertHash141,
  hash141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { loadBaseline143 } from "./c601143-input.js";

const relation144 = (
  evidenceClass: string,
): TextCandidateFeature144["relation"] => {
  if (evidenceClass === "PRONUNCIATION_AGREEMENT")
    return "PRONUNCIATION_AGREEMENT";
  if (evidenceClass === "CROSS_MODEL_LOCALIZED_AGREEMENT")
    return "CROSS_MODEL_LOCALIZED_AGREEMENT";
  if (evidenceClass === "CROSS_MODEL_DISAGREEMENT")
    return "MULTI_PROVIDER_DISAGREEMENT";
  return "SINGLE_PROVIDER_LOCALIZED";
};

/**
 * Load only the frozen machine-side C6.0.1.14.3.1 inputs. The state may point
 * at an evaluation directory as routing metadata, but no evaluation or Gold
 * artifact is opened here. Raw recognized text is deliberately not copied
 * into the returned utility feature set.
 */
export async function loadInputs144(previousStatePath: string) {
  const absoluteState = path.resolve(previousStatePath);
  const previousState = state143Schema.parse(await readJson141(absoluteState));
  if (hash141(previousState.config) !== previousState.configHash)
    throw new Error("C601144_PREVIOUS_STATE_CONFIG_CHANGED");

  const outputRoot = path.resolve(previousState.config.outputRoot);
  safeRelative141(outputRoot, absoluteState);
  const output = (role: string) =>
      required141(
        previousState.outputs[role],
        `C601144_PREVIOUS_OUTPUT_MISSING:${role}`,
      ),
    read = (role: string, name: string) => {
      const file = path.join(output(role), name);
      safeRelative141(outputRoot, file);
      if (/(?:^|[/_-])gold(?:[/_.-]|$)/iu.test(file))
        throw new Error("C601144_MACHINE_INPUT_GOLD_PATH_FORBIDDEN");
      return readJson141(file);
    };

  const [
    baseline,
    previousPolicy,
    obligations,
    hierarchy,
    bundles,
    dominance,
    planner,
  ] = await Promise.all([
    loadBaseline143(previousState.config),
    readJson141(previousState.policyPath).then((value) =>
      policy143Schema.parse(value),
    ),
    read("obligations", "machine-phase-a-coverage-obligations.json").then(
      (value) => obligations143Schema.parse(value),
    ),
    read(
      "hierarchical-children",
      "machine-selectable-speech-child-units-v1.json",
    ).then((value) => hierarchy143Schema.parse(value)),
    read(
      "target-bundles",
      "machine-review-target-bundle-candidates-v1.json",
    ).then((value) => bundles143Schema.parse(value)),
    read("target-bundles", "machine-target-bundle-dominance-ledger.json").then(
      (value) => dominance143Schema.parse(value),
    ),
    read("final-planner", "machine-final-safety-planner-certificate.json").then(
      (value) => planner143Schema.parse(value),
    ),
  ]);
  [previousPolicy, obligations, hierarchy, bundles, dominance, planner].forEach(
    assertHash141,
  );

  if (
    hierarchy.obligationsHash !== obligations.semanticHash ||
    bundles.childrenHash !== hierarchy.semanticHash ||
    dominance.candidatesHash !== bundles.semanticHash ||
    planner.obligationsHash !== obligations.semanticHash ||
    planner.candidatesHash !== bundles.semanticHash ||
    planner.dominanceHash !== dominance.semanticHash
  )
    throw new Error("C601144_C6011431_GEOMETRY_BINDING_CHANGED");

  const textCandidates: TextCandidateFeature144[] =
    baseline.lexical.targets.flatMap((target) => {
      const relation = relation144(target.evidenceClass);
      return target.localizedTextCandidates.map((candidate) => ({
        nativeInterval: candidate.nativeInterval,
        provider: candidate.provider,
        localizationStatus: candidate.localizationStatus,
        relation,
        hallucinationRiskClass:
          target.evidenceClass === "CROSS_MODEL_DISAGREEMENT"
            ? "REVIEW_ONLY"
            : "NONE",
      }));
    });

  return {
    previousState,
    baseline,
    previousPolicy,
    obligations,
    hierarchy,
    bundles,
    dominance,
    planner,
    textCandidates,
    machineInputHashes: {
      obligations: obligations.semanticHash,
      hierarchy: hierarchy.semanticHash,
      bundles: bundles.semanticHash,
      dominance: dominance.semanticHash,
      planner: planner.semanticHash,
      inventory: baseline.inventory.semanticHash,
      candidates: baseline.uncovered.semanticHash,
      lexical: baseline.lexical.semanticHash,
    },
  };
}

export type Inputs144 = Awaited<ReturnType<typeof loadInputs144>>;
