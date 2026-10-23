import {
  inventory142Schema,
  observation142Schema,
  c60114ReviewTargetsSchema,
  c601141SafetySchema,
  uncovered142Schema,
} from "@mvl/shared";
import {
  source142,
  candidateFixture142,
  uncoveredFixture142,
  oldSafetyFixture142,
} from "./c601142-fixture.js";
import { fixture142 } from "./c601142-review-fixture.js";
import {
  hash141,
  hashed141,
  union141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { policy142 } from "../../packages/video-subtitler/src/review/c601142-policy.js";
import {
  clusterCandidates142,
  selectSafety142,
} from "../../packages/video-subtitler/src/review/c601142-selection.js";
import {
  policy143,
  sampleCount143,
} from "../../packages/video-subtitler/src/review/c601143-policy.js";
import { buildCoverageObligations143 } from "../../packages/video-subtitler/src/review/c601143-coverage-obligations.js";
import {
  buildHierarchy143,
  type HierarchyBoundaries143,
} from "../../packages/video-subtitler/src/review/c601143-hierarchical-clusters.js";
import {
  buildTargetBundles143,
  pruneDominatedBundles143,
} from "../../packages/video-subtitler/src/review/c601143-target-bundles.js";

export function fixture143(
  parts = [
    candidateFixture142("a", 20, 21),
    candidateFixture142("b", 21.4, 22.4),
    candidateFixture142("new", 100, 101),
  ],
  mandatoryIndices = [0, 1],
  overrides: Partial<HierarchyBoundaries143> = {},
  sourceOverride = source142,
) {
  const base = fixture142(sourceOverride),
    source = base.source,
    policy = policy143(),
    compatibilityPolicy = policy142();
  const noBoundaries = {
    cueMasks: [],
    existingTargetMasks: [],
    sceneSamples: [],
    speakerSamples: [],
  };
  const oldSafety = c601141SafetySchema.parse(
    hashed141({ ...oldSafetyFixture142(), sourceIdentity: source }),
  );
  const uncovered = (rows: typeof parts) =>
    uncovered142Schema.parse(
      hashed141({ ...uncoveredFixture142(rows), sourceIdentity: source }),
    );
  const cluster = (rows: typeof parts) =>
    clusterCandidates142({
      uncovered: uncovered(rows),
      oldSafety,
      policy: compatibilityPolicy,
      boundaries: noBoundaries,
      speechIntervals: rows.map((c) => c.nativeInterval),
    });
  const mandatory = parts.filter((_, i) => mandatoryIndices.includes(i));
  const phaseA = selectSafety142({
    clusters: cluster(mandatory),
    oldSafety,
    policy: compatibilityPolicy,
    variant: "SELECTION_REPAIR_ONLY",
  });
  const parents = cluster(parts);
  const observations = parts.map((c) =>
    observation142Schema.parse({
      observationId: c.observationIds[0],
      nativeInterval: c.nativeInterval,
      family: c.detectorFamilies[0],
      correlationGroup: c.independentFamilies[0],
      viewId: c.distinctPcmViewIds[0],
      profileId: "synthetic-profile",
      evidenceIds: c.evidenceIds,
      requestIds: c.requestIds,
      verifiedTimebase: c.verifiedTimebase,
      speechPositive: true,
      strongContradiction: c.strongContradiction,
      reliableLexical: false,
      scoreLevel: "MAIN",
      independentSpeechTruth: false,
      scoreTrackHash: null,
    }),
  );
  const core = union141(parts.map((c) => c.nativeInterval));
  const inventory = inventory142Schema.parse(
    hashed141({
      ...base.inventory,
      observations,
      islands: [],
      summary: {
        observationCount: observations.length,
        islandCount: 0,
        multiDetectorCount: 0,
        mainSpeechUnionSeconds: sampleCount143(core) / source.sampleRate,
        maskedCandidateUnionSeconds: 0,
        totalEvidenceUnionSeconds: sampleCount143(core) / source.sampleRate,
        newDetectorObservationCount: observations.length,
        unresolvedCount: 0,
        parentEnvelopeAsSpeechCount: 0,
        correlationInflationCount: 0,
      },
    }),
  );
  const immutableTargets = c60114ReviewTargetsSchema.parse(
    hashed141({
      ...base.old.baselineTargets,
      sourceIdentity: source,
      targets: [],
      summary: Object.fromEntries(
        Object.keys(base.old.baselineTargets.summary).map((key) => [key, 0]),
      ),
    }),
  );
  const obligations = buildCoverageObligations143({
    phaseA,
    immutableTargets,
    policy,
  });
  const boundaries: HierarchyBoundaries143 = {
    finalCueMasks: [],
    immutableTargetMasks: [],
    verifiedSilence: [],
    discontinuitySamples: [],
    sceneSamples: [],
    speakerSamples: [],
    ...overrides,
  };
  const hierarchy = buildHierarchy143({
    inventory,
    parents,
    phaseA,
    candidates: parts,
    obligations,
    policy,
    boundaries,
    scores: [],
    scoreTracksHash: hash141([]),
  });
  const bundles = buildTargetBundles143({
    hierarchy,
    obligations,
    immutableAudioIntervals: [],
    cueMasks: boundaries.finalCueMasks,
    policy,
  });
  const dominance = pruneDominatedBundles143({ bundles, policy });
  return {
    policy,
    compatibilityPolicy,
    phaseA,
    inventory,
    parents,
    parts,
    immutableTargets,
    obligations,
    boundaries,
    hierarchy,
    bundles,
    dominance,
    base,
  };
}
