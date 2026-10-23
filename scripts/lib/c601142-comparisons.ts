import path from "node:path";
import {
  phaseA142Schema,
  sweeps142Schema,
  masked142Schema,
  asrProbes142Schema,
  uncovered142Schema,
  comparisonInputs142Schema,
  type Policy142,
  type Inventory142,
  type Safety142,
} from "@mvl/shared";
import type { State142, Baseline142 } from "./c601142-input.js";
import { buildWorkspace142 } from "./c601142-build-workspace.js";
import { workspaceProjection142 } from "./c601142-coverage-projection.js";
import { header142 } from "../../packages/video-subtitler/src/review/c601142-policy.js";
import {
  readJson141,
  durableJson141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
  duration141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { buildInventory142 } from "../../packages/video-subtitler/src/review/c601142-inventory.js";
import {
  buildLexical142,
  buildMissing142,
} from "../../packages/video-subtitler/src/review/c601142-lexical.js";
import {
  oldCandidates142,
  clusterCandidates142,
  selectSafety142,
  supersession142,
} from "../../packages/video-subtitler/src/review/c601142-selection.js";

/** A true detector-only ablation keeps all old 24 atomic slots. It cannot borrow
 * the clustering benefit from Phase A and then call the same output independent.
 * Native boundaries come exclusively from frozen machine artifacts. */
export function detectorOnlySafety142(
  old: Pick<Baseline142, "uncovered" | "inventory" | "safety">,
  policy: Policy142,
) {
  const converted = oldCandidates142(old.uncovered, old.inventory, policy);
  const selectedIds = new Set(old.safety.targets.map((t) => t.candidateId));
  const candidates = converted.candidates.filter((c) =>
    selectedIds.has(c.candidateId),
  );
  if (candidates.length !== old.safety.targets.length)
    throw new Error("C601142_DETECTOR_ONLY_OLD_ATOMS_UNBOUND");
  const uncovered = uncovered142Schema.parse(
    hashed141({
      ...converted,
      candidates,
      summary: {
        candidateCount: candidates.length,
        uncoveredSeconds: duration141(
          candidates.map((c) => c.nativeInterval),
          converted.sourceIdentity.sampleRate,
        ),
      },
    }),
  );
  const clusters = clusterCandidates142({
    uncovered,
    oldSafety: old.safety,
    policy,
    boundaries: {
      cueMasks: [],
      existingTargetMasks: [],
      sceneSamples: candidates.flatMap((c) => [
        c.nativeInterval.startSample,
        c.nativeInterval.endSample,
      ]),
      speakerSamples: [],
    },
    speechIntervals: old.inventory.observations
      .filter(
        (o) => o.verifiedTimebase && o.speechPositive && !o.strongContradiction,
      )
      .map((o) => o.nativeInterval),
  });
  const safety = selectSafety142({
    clusters,
    oldSafety: old.safety,
    policy,
    variant: "DETECTOR_CEILING_ONLY",
  });
  if (
    safety.targets.length !== old.safety.targets.length ||
    !safety.summary.oldCoveragePreserved
  )
    throw new Error("C601142_DETECTOR_ONLY_SLOT_PRESERVATION_FAILED");
  return { clusters, safety };
}
export async function buildComparisons142(input: {
  old: Baseline142;
  state: State142;
  policy: Policy142;
  inventory: Inventory142;
}) {
  const { old, state, policy } = input,
    dir = (role: string) => required141(state.outputs[role]),
    header = header142(policy, old.baseline.source);
  const phaseA = phaseA142Schema.parse(
    await readJson141(
      path.join(
        dir("selection-v2"),
        "c6-0-1-14-2-phase-a-selection-projection.json",
      ),
    ),
  );
  const fresh = sweeps142Schema.parse(
    await readJson141(
      path.join(
        dir("detectors-fresh"),
        "machine-independent-speech-presence-sweeps.json",
      ),
    ),
  );
  const emptySweeps = sweeps142Schema.parse(
    hashed141({
      ...fresh,
      mode: "EXACT_CACHE_ONLY",
      runs: [],
      evidenceSemanticHash: hash141([]),
      accounting: Object.fromEntries(
        Object.keys(fresh.accounting).map((key) => [key, 0]),
      ),
    }),
  );
  const masked = masked142Schema.parse(
    hashed141({
      ...header,
      artifactType: "machine-masked-speech-candidates-v1",
      scoreTracksHash: hash141([]),
      featureSourcePcmHash: hash141([]),
      candidates: [],
      summary: {
        candidateCount: 0,
        eligibleCount: 0,
        mainSupportedCount: 0,
        subthresholdOnlyCount: 0,
        independentCrossDetectorCount: 0,
        musicUnresolvedCount: 0,
        energyOnlyPromotedCount: 0,
        sameFamilyVoteInflationCount: 0,
      },
    }),
  );
  const oldOnlyInventory = buildInventory142({
    old: old.inventory,
    sweeps: emptySweeps,
    masked,
    policy,
    splitPoints: [],
  });
  const probes = asrProbes142Schema.parse(
    hashed141({
      ...old.asr,
      ...header,
      artifactType: "machine-c6-0-1-14-2-local-asr-probes",
      mode: "EXACT_CACHE_ONLY",
      requests: [],
      contextDecisions: [],
      planHash: hash141("NO_NEW_ASR_FOR_ABLATIONS"),
      selectionHash: phaseA.semanticHash,
      evidenceSemanticHash: hash141([]),
      accounting: {
        ...Object.fromEntries(
          Object.keys(old.asr.accounting).map((k) => [k, 0]),
        ),
        repeatedPreviousRequestCount: 0,
        targetBackfillCount: 0,
      },
    }),
  );
  const detectorOnly = detectorOnlySafety142(old, policy),
    baseProjection = required141(old.projections.variants.at(-1)).projection;
  const choices: {
    role: "A1" | "A2" | "A3" | "detector-only";
    safety: Safety142;
    inventory: Inventory142;
  }[] = [
    {
      role: "A1",
      safety: required141(phaseA.variants[0]),
      inventory: oldOnlyInventory,
    },
    {
      role: "A2",
      safety: required141(phaseA.variants[1]),
      inventory: oldOnlyInventory,
    },
    {
      role: "A3",
      safety: required141(phaseA.variants[2]),
      inventory: oldOnlyInventory,
    },
    {
      role: "detector-only",
      safety: detectorOnly.safety,
      inventory: input.inventory,
    },
  ];
  const entries = [];
  for (const choice of choices) {
    const workspaceRelativePath = `comparison-workspaces/${choice.role}`,
      directory = path.join(dir("review-package-v5"), workspaceRelativePath);
    const lexical = buildLexical142({
      policy,
      safety: choice.safety,
      probes,
      previousProbes: old.asr,
      previousLexical: old.lexical,
    });
    const missing = buildMissing142(
      choice.inventory,
      choice.safety,
      lexical,
      policy,
    );
    const ledger = supersession142(old.safety, choice.safety, policy);
    const built = await buildWorkspace142({
      baseline: old.baseline,
      policy,
      inventory: choice.inventory,
      safety: choice.safety,
      lexical,
      missing,
      supersessionHash: ledger.semanticHash,
      sourcePath: old.config.source,
      outputDirectory: directory,
      generatedAt: state.createdAt,
    });
    const projection = workspaceProjection142({
      baseline: baseProjection,
      workspace: built.workspaceData,
      inventory: choice.inventory,
      includeNewLexical: false,
    });
    await durableJson141(
      path.join(directory, "machine-coverage-projection.json"),
      projection,
    );
    entries.push(
      hashed141({
        role: choice.role,
        projection,
        workspaceRelativePath,
        safetyHash: choice.safety.semanticHash,
      }),
    );
  }
  await durableJson141(
    path.join(
      dir("review-package-v5"),
      "machine-detector-only-atomic-safety-selection.json",
    ),
    detectorOnly.safety,
  );
  const artifact = comparisonInputs142Schema.parse(
    hashed141({
      ...header,
      artifactType: "c6-0-1-14-2-comparison-input-projections",
      baselineProjectionHash: hash141(baseProjection),
      entries,
      detectorOnlySelectionPolicy:
        "PRESERVE_24_ATOMIC_BASELINE_SLOTS_WITHOUT_SELECTION_REPAIR",
      inferenceCount: 0,
      goldBlind: true,
    }),
  );
  await durableJson141(
    path.join(
      dir("review-package-v5"),
      "machine-comparison-input-projections.json",
    ),
    artifact,
  );
  return artifact;
}
