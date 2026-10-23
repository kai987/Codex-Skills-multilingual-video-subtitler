import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  state142Schema,
  policy142Schema,
  safety142Schema,
  inventory142Schema,
  clusters142Schema,
  uncovered142Schema,
  scoreTracks142Schema,
  lexical142Schema,
  missing142Schema,
  projections142Schema,
  comparisonInputs142Schema,
} from "@mvl/shared";
import { loadBaseline142, type State142 } from "./c601142-input.js";
import { verifyFinalFreeze142 } from "./c601142-final.js";
import {
  readJson141,
  fileHash141,
  safeRelative141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  assertHash141,
  hash141,
  required141,
  native141,
  union141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { decodeScores142 } from "../../packages/video-subtitler/src/review/c601142-scores.js";
import {
  assertReplayOnly143,
  assertSource143,
} from "../../packages/video-subtitler/src/review/c601143-policy.js";
import type {
  ExistingScore143,
  HierarchyBoundaries143,
} from "../../packages/video-subtitler/src/review/c601143-hierarchical-clusters.js";

export const config143Schema = z
  .object({
    baselineState: z.string().min(1),
    outputRoot: z.string().min(1),
    prefix: z.string().regex(/^[a-z0-9-]+$/u),
    date: z.string().regex(/^\d{8}$/u),
    executionPolicy: z.literal("replay-only"),
  })
  .strict()
  .refine(
    (v) =>
      Object.values(v).every(
        (s) => !/(?:^|[/_-])(?:gold|human-correction)(?:[/_.-]|$)/iu.test(s),
      ),
    "Gold forbidden in machine config",
  );
export type Config143 = z.infer<typeof config143Schema>;
export interface State143 {
  config: Config143;
  configHash: string;
  outputs: Record<string, string>;
  createdAt: string;
  policyPath: string;
}

/** All paths below select machine artifacts explicitly. An evaluation-directory
 * run-paths file is only routing metadata; no Gold/evaluation result is opened. */
export async function loadBaseline143(config: Config143) {
  config143Schema.parse(config);
  assertReplayOnly143(config.executionPolicy);
  const state: State142 = state142Schema.parse(
    await readJson141(config.baselineState),
  );
  if (hash141(state.config) !== state.configHash)
    throw new Error("C601143_BASELINE_STATE_HASH_MISMATCH");
  const dir = (role: string) =>
    required141(state.outputs[role], `C601143_MISSING_BASELINE_ROLE:${role}`);
  const old = await loadBaseline142(state.config);
  const finalA = await verifyFinalFreeze142(
    state.config.outputRoot,
    dir("final-a"),
    old.config.source,
  );
  const finalB = await verifyFinalFreeze142(
    state.config.outputRoot,
    dir("final-b"),
  );
  const inputBindings: { relativePath: string; byteHash: string }[] = [];
  const read = async (role: string, name: string) => {
    if (
      /(?:^|[/_-])(?:gold|evaluation|human-correction)(?:[/_.-]|$)/iu.test(name)
    )
      throw new Error("C601143_MACHINE_INPUT_GOLD_PATH_FORBIDDEN");
    const file = path.join(dir(role), name);
    safeRelative141(dir(role), file);
    const byteHash = await fileHash141(file),
      value = await readJson141(file);
    if ((await fileHash141(file)) !== byteHash)
      throw new Error("C601143_BASELINE_ARTIFACT_CHANGED_DURING_READ");
    inputBindings.push({
      relativePath: safeRelative141(config.outputRoot, file),
      byteHash,
    });
    return value;
  };
  const compatibilityPolicy = policy142Schema.parse(
    await readJson141(state.policyPath),
  );
  const phaseA = safety142Schema.parse(
    await read(
      "selection-v2",
      "machine-missing-safety-reserve-targets-v2.json",
    ),
  );
  const inventory = inventory142Schema.parse(
    await read(
      "inventory-v5",
      "machine-source-global-speech-inventory-v5.json",
    ),
  );
  const parents = clusters142Schema.parse(
    await read("inventory-v5", "machine-safety-target-clusters-v2.json"),
  );
  const uncovered = uncovered142Schema.parse(
    await read("inventory-v5", "machine-uncovered-speech-candidates-v2.json"),
  );
  const oldFinal = safety142Schema.parse(
    await read("final-a", "machine-missing-safety-reserve-targets-v2.json"),
  );
  const scoreTracks = scoreTracks142Schema.parse(
    await read(
      "detectors-fresh",
      "machine-speech-detector-score-tracks-v1.json",
    ),
  );
  const lexical = lexical142Schema.parse(
    await read("final-a", "machine-missing-lexical-evidence-v5.json"),
  );
  const missing = missing142Schema.parse(
    await read("final-a", "machine-missing-speech-evidence-v5.json"),
  );
  const projections = projections142Schema.parse(
    await read("final-a", "machine-coverage-projections.json"),
  );
  const comparisons = comparisonInputs142Schema.parse(
    await read(
      "review-package-v5",
      "machine-comparison-input-projections.json",
    ),
  );
  [
    compatibilityPolicy,
    phaseA,
    inventory,
    parents,
    uncovered,
    oldFinal,
    scoreTracks,
    lexical,
    missing,
    projections,
    comparisons,
  ].forEach(assertHash141);
  [phaseA, inventory, parents, uncovered, oldFinal, lexical].forEach((v) =>
    assertSource143(v.sourceIdentity, old.baseline.source),
  );
  const scores: ExistingScore143[] = [];
  for (const track of scoreTracks.tracks) {
    assertHash141(track);
    const file = path.join(dir("detectors-fresh"), track.relativePath);
    safeRelative141(dir("detectors-fresh"), file);
    if ((await fileHash141(file)) !== track.scoreSha256)
      throw new Error("C601143_EXISTING_SCORE_TRACK_BYTES_CHANGED");
    const values = decodeScores142(await readFile(file));
    if ((await fileHash141(file)) !== track.scoreSha256)
      throw new Error("C601143_SCORE_TRACK_READ_RACE");
    scores.push({ track, values, byteHashVerified: true });
    inputBindings.push({
      relativePath: safeRelative141(config.outputRoot, file),
      byteHash: track.scoreSha256,
    });
  }
  const rate = old.baseline.source.sampleRate;
  const boundaries: HierarchyBoundaries143 = {
    finalCueMasks: union141(
      old.baseline.subtitlePackage.cues.map((c) => native141(c, rate)),
    ),
    immutableTargetMasks: union141(
      old.baseline.previous.targets.targets.map((t) =>
        native141(t.sourceInterval, rate),
      ),
    ),
    // Detector-negative frames do not establish verified silence. Only the
    // already saved source-global silence boundary artifact may do so.
    verifiedSilence: [],
    discontinuitySamples: [],
    verifiedSilencePoints: old.baseline.previous.islands.boundaries
      .filter((b) => b.kind === "SILENCE")
      .map((b) => ({
        atSample: Math.round(b.at * rate),
        evidenceHash: hash141(b),
      })),
    sceneSamples: old.baseline.previous.islands.boundaries
      .filter((b) => b.kind === "SCENE")
      .map((b) => Math.round(b.at * rate)),
    speakerSamples: old.baseline.previous.islands.boundaries
      .filter((b) => b.kind === "SPEAKER")
      .map((b) => Math.round(b.at * rate)),
  };
  const immutableAudioIntervals = union141(
    old.baseline.previous.audio.audio.map((f) =>
      native141(f.actualSourceInterval ?? f.sourceInterval, rate),
    ),
  );
  return {
    state,
    dir,
    old,
    finalA,
    finalB,
    compatibilityPolicy,
    phaseA,
    inventory,
    parents,
    uncovered,
    oldFinal,
    scoreTracks,
    scores,
    lexical,
    missing,
    projections,
    comparisons,
    boundaries,
    immutableAudioIntervals,
    inputBindings,
  };
}
export type Baseline143 = Awaited<ReturnType<typeof loadBaseline143>>;
