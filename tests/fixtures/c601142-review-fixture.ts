import {
  asrProbes142Schema,
  masked142Schema,
  sweeps142Schema,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { fixture141 } from "./c601141-fixture.js";
import {
  policy142,
  header142,
} from "../../packages/video-subtitler/src/review/c601142-policy.js";
import {
  hash141,
  hashed141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { buildInventory142 } from "../../packages/video-subtitler/src/review/c601142-inventory.js";
import { uncoveredSpeech141 } from "../../packages/video-subtitler/src/review/c601141-inventory.js";
import {
  oldCandidates142,
  phaseA142,
} from "../../packages/video-subtitler/src/review/c601142-selection.js";
import { selectAsr142 } from "../../packages/video-subtitler/src/review/c601142-asr.js";
import {
  buildLexical142,
  buildMissing142,
} from "../../packages/video-subtitler/src/review/c601142-lexical.js";
import { buildReviewGraph142 } from "../../packages/video-subtitler/src/review/c601142-review-graph.js";

export function fixture142(sourceOverride?: C60114SourceIdentity) {
  const old = fixture141(sourceOverride),
    policy = policy142(),
    h = hash141("synthetic-only"),
    header = header142(policy, old.source);
  const sweeps = sweeps142Schema.parse(
    hashed141({
      ...header,
      artifactType: "machine-independent-speech-presence-sweeps",
      mode: "EXACT_CACHE_ONLY",
      planHash: h,
      runs: [],
      accounting: {
        plannedRuns: 0,
        inferenceCount: 0,
        cacheHits: 0,
        cacheMisses: 0,
        modelLoadCount: 0,
        providerProcessStartCount: 0,
        webrtcRuns: 0,
        sileroRuns: 0,
        pyannoteRuns: 0,
        persistedResultCount: 0,
        failedCount: 0,
        retryCount: 0,
        backfillCount: 0,
        fullMediaAsrCount: 0,
        networkRequestCount: 0,
      },
      evidenceSemanticHash: h,
    }),
  );
  const masked = masked142Schema.parse(
    hashed141({
      ...header,
      artifactType: "machine-masked-speech-candidates-v1",
      scoreTracksHash: h,
      candidates: [],
      featureSourcePcmHash: h,
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
  const inventory = buildInventory142({
    old: old.inventory,
    sweeps,
    masked,
    policy,
    splitPoints: [],
  });
  const previousUncovered = uncoveredSpeech141({
    inventory: old.inventory,
    policy: old.policy,
    cues: [{ start: 3, end: 5 }],
    previousTargets: old.baselineTargets.targets,
    finalCueHash: h,
    previousTargetsHash: old.baselineTargets.semanticHash,
  });
  const uncovered = oldCandidates142(previousUncovered, old.inventory, policy);
  const phaseA = phaseA142(
    {
      uncovered,
      oldSafety: old.safety,
      policy,
      boundaries: {
        cueMasks: [],
        existingTargetMasks: [],
        sceneSamples: [],
        speakerSamples: [],
      },
      speechIntervals: old.inventory.observations.map((o) => o.nativeInterval),
    },
    old.selection.selectionFrozenAt,
  );
  const safety = phaseA.safety,
    selection = selectAsr142(
      safety,
      old.probes,
      policy,
      old.selection.selectionFrozenAt,
    );
  const probes = asrProbes142Schema.parse(
    hashed141({
      ...old.probes,
      ...header,
      artifactType: "machine-c6-0-1-14-2-local-asr-probes",
      planHash: h,
      selectionHash: selection.semanticHash,
      requests: [],
      accounting: {
        ...old.probes.accounting,
        repeatedPreviousRequestCount: 0,
        targetBackfillCount: 0,
      },
    }),
  );
  const lexical = buildLexical142({
    policy,
    safety,
    probes,
    previousProbes: old.probes,
    previousLexical: old.lexical,
  });
  const missing = buildMissing142(inventory, safety, lexical, policy);
  const graph = buildReviewGraph142({
    policy,
    inventory,
    safety,
    lexical,
    missing,
    supersessionHash: phaseA.supersession.semanticHash,
    compatibilityPolicy: old.compatibilityPolicy,
    baselineTargets: old.baselineTargets,
    baselineItems: old.baselineItems,
    baselineRegions: old.baselineRegions,
    frozenR3Families: old.frozenR3Families,
  });
  return {
    old,
    policy,
    inventory,
    sweeps,
    masked,
    uncovered,
    phaseA,
    safety,
    selection,
    probes,
    lexical,
    missing,
    graph,
    source: old.source,
  };
}
