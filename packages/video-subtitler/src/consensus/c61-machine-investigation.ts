import {
  machineMultiAsrTextRepresentationsSchema,
  machineMultiAsrPairwiseAlignmentsSchema,
  machineMultiAsrMultipleAlignmentsSchema,
  machineMultiAsrTokenLatticeSchema,
  machineMultiAsrConfusionNetworkSchema,
  machineMultiAsrSpanConsensusSchema,
  machineMultiAsrRoverConsensusSchema,
  machineMultiAsrMbrConsensusSchema,
  c61ProfileSelectionsSchema,
  type C61CandidateText,
  type C61PairwiseAlignment,
  type C61MultipleAlignment,
  type C61TokenLattice,
  type C61ConfusionNetwork,
  type C61ConsensusSpan,
  type C61RoverResult,
  type C61CandidateMbrResult,
  type C61LatticeMbrResult,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { buildC61HypothesisUniverse } from "./hypothesis-universe.js";
import {
  bindC61AcousticEvidence,
  type C61MachineArtifactInput,
} from "./c61-artifact-adapter.js";
import { buildC61Representations } from "./japanese-text-representation.js";
import {
  alignC61Pair,
  C61_ALIGNMENT_COSTS,
} from "./pairwise-sequence-alignment.js";
import { alignC61Multiple } from "./multiple-sequence-alignment.js";
import { buildC61TokenLattice } from "./token-lattice.js";
import { buildC61ConfusionNetwork } from "./confusion-network.js";
import { buildC61ConsensusSpans } from "./consensus-span.js";
import { freezeC61Profiles } from "./c61-policy.js";
import { decodeRover } from "./rover-decoder.js";
import { candidateMbr } from "./candidate-mbr.js";
import { latticeMbr, materializeC61Path } from "./lattice-mbr.js";
import {
  auditC61Consensus,
  type C61ProfilePath,
} from "./consensus-safety-audit.js";
import { assembleC61Shadow } from "./consensus-shadow-assembly.js";

const artifact = <T extends object>(type: string, fields: T) => {
  const body = {
    schemaVersion: "1.0.0",
    policyVersion: "c6.1-consensus-investigation-v1",
    artifactType: type,
    ...fields,
  };
  return { ...body, semanticHash: hash(body) };
};

/** Algorithm results remain pure; the orchestrator adds the frozen profile
 * authority and hashes that authority with the unchanged result body.
 */
const withProfile = <T extends { semanticHash: string }>(
  result: T,
  profileId: string,
) => {
  const { semanticHash, ...body } = result;
  if (hash(body) !== semanticHash)
    throw new Error("C61_DECODER_RESULT_HASH_MISMATCH");
  const tagged = { ...body, profileId };
  return { ...tagged, semanticHash: hash(tagged) };
};

/** Machine-only pure orchestration: no Gold path, labels, filesystem or network. */
export function investigateC61Machine(
  input: C61MachineArtifactInput,
  options: { permute?: boolean; progress?: (message: string) => void } = {},
) {
  const rawCandidates = options.permute
    ? [...input.candidates].reverse()
    : input.candidates;
  const universe = buildC61HypothesisUniverse({
    events: input.events,
    candidates: rawCandidates,
    sourceArtifactHashes: input.sourceArtifactHashes,
  });
  const candidates: C61CandidateText[] = universe.candidates.flatMap((c) => {
    if (
      c.inclusionStatus !== "INCLUDED" ||
      c.eventId === null ||
      c.sourceInterval === null
    )
      return [];
    return [
      {
        candidateId: c.candidateId,
        eventId: c.eventId,
        sourceInterval: c.sourceInterval,
        providerFamily: c.providerFamily,
        displayText: c.displayText,
        normalizedText: c.normalizedText,
        pronunciationText: c.pronunciationText,
        correlationGroupId: c.correlationGroupId,
        provenanceHash: c.provenanceHash,
        rawVoteCandidateIds: [
          ...new Set(
            universe.candidates
              .filter(
                (other) =>
                  (other.inclusionStatus === "INCLUDED" ||
                    other.inclusionStatus === "NORMALIZED_DUPLICATE") &&
                  other.providerFamily === c.providerFamily &&
                  other.eventId === c.eventId &&
                  other.normalizedText === c.normalizedText,
              )
              .map((other) => other.sourceCandidateId),
          ),
        ].toSorted(),
      },
    ];
  });
  const representations = buildC61Representations(
    options.permute ? [...candidates].reverse() : candidates,
  );
  const profileFreeze = freezeC61Profiles(
    hash({
      costs: C61_ALIGNMENT_COSTS,
      mainCenter: "CENTER_PROVIDER_BALANCED_MEDOID",
      pronunciationAware: false,
      alignmentAblations: [
        {
          profileId: "ALIGN_PRONUNCIATION_R2",
          center: "CENTER_PROVIDER_BALANCED_MEDOID",
          pronunciationAware: true,
          roverVariant: "R2",
        },
        {
          profileId: "ALIGN_CENTER_CURRENT_R2",
          center: "CENTER_CURRENT",
          pronunciationAware: false,
          roverVariant: "R2",
        },
        {
          profileId: "ALIGN_CENTER_MEDOID_R2",
          center: "CENTER_MEDOID",
          pronunciationAware: false,
          roverVariant: "R2",
        },
      ],
      switchRule: "SHARED_UNAMBIGUOUS_EXACT_SURFACE_ANCHOR",
      eventGoldMapping:
        "SINGLE_TEMPORAL_OVERLAP_WITH_BIDIRECTIONAL_0.5_COVERAGE",
      shadowPolicy: "EXACT_MODIFIABLE_SPAN_NO_SPLIT_NO_TIMING_GENERIC_LAYOUT",
    }),
  );
  const acoustics = bindC61AcousticEvidence(universe, input.acousticScores);
  const pairwise: C61PairwiseAlignment[] = [],
    multiple: C61MultipleAlignment[] = [],
    lattices: C61TokenLattice[] = [],
    networks: C61ConfusionNetwork[] = [],
    spans: C61ConsensusSpan[] = [];
  const rover: C61RoverResult[] = [],
    candidateMbrResults: C61CandidateMbrResult[] = [],
    latticeMbrResults: C61LatticeMbrResult[] = [],
    paths: C61ProfilePath[] = [];
  for (const [eventIndex, event] of universe.events.entries()) {
    const eventCandidates = candidates.filter(
      (c) => c.eventId === event.eventId,
    );
    if (!eventCandidates.length) continue;
    const reps = representations.filter(
      (r) => r.candidate.eventId === event.eventId,
    );
    for (const [i, left] of reps.entries())
      for (const right of reps.slice(i + 1))
        pairwise.push(alignC61Pair(left, right));
    const eventAlignments = (
      [
        "CENTER_CURRENT",
        "CENTER_MEDOID",
        "CENTER_PROVIDER_BALANCED_MEDOID",
      ] as const
    ).map((center) => alignC61Multiple(reps, center));
    multiple.push(...eventAlignments);
    const main = eventAlignments.at(-1);
    if (main === undefined) throw new Error("C61_MISSING_MAIN_ALIGNMENT");
    const lattice = buildC61TokenLattice(main, reps);
    const network = buildC61ConfusionNetwork(lattice);
    lattices.push(lattice);
    networks.push(network);
    const current =
      eventCandidates.find((c) => c.providerFamily === "CURRENT")
        ?.candidateId ?? null;
    spans.push(...buildC61ConsensusSpans(lattice, current ?? undefined));
    const currentPath = lattice.candidatePaths.find(
      (p) => p.candidateId === current,
    );
    const keep = currentPath
      ? materializeC61Path(
          lattice,
          currentPath.nodeIds,
          eventCandidates,
          current,
        )
      : null;
    for (const profile of profileFreeze.profiles) {
      let selected = keep;
      if (
        profile.decoder === "ROVER" ||
        profile.decoder === "ABSTENTION_FIRST" ||
        profile.decoder === "EXISTING_ONLY"
      ) {
        const result = decodeRover({
          candidates: eventCandidates,
          lattice,
          network,
          currentCandidateId: current,
          variant: profile.roverVariant ?? "R2",
          acousticEvidence: acoustics,
          outputMode:
            profile.decoder === "EXISTING_ONLY"
              ? "EXISTING_CANDIDATE_ONLY"
              : "LEGAL_LATTICE_PATH",
          allowAmbiguousSlots: profile.allowAmbiguousSlots,
          minimumMargin: profile.minimumMargin,
        });
        rover.push(withProfile(result, profile.profileId));
        selected = result.selectedPath;
      } else if (profile.decoder === "CANDIDATE_MBR") {
        const result = candidateMbr({
          candidates: eventCandidates,
          currentCandidateId: current,
          distanceMethod: profile.distanceMethod,
        });
        candidateMbrResults.push(withProfile(result, profile.profileId));
        const selectedCandidate = lattice.candidatePaths.find(
          (p) => p.candidateId === result.selectedCandidateId,
        );
        selected = selectedCandidate
          ? materializeC61Path(
              lattice,
              selectedCandidate.nodeIds,
              eventCandidates,
              current,
              profile.maxProviderSwitches,
              result.selectedCandidateId ?? undefined,
            )
          : keep;
      } else if (profile.decoder === "LATTICE_MBR") {
        const result = latticeMbr({
          candidates: eventCandidates,
          lattice,
          currentCandidateId: current,
          distanceMethod: profile.distanceMethod,
        });
        latticeMbrResults.push(withProfile(result, profile.profileId));
        selected = result.selectedPath;
      }
      paths.push({
        profileId: profile.profileId,
        eventId: event.eventId,
        latticeHash: lattice.semanticHash,
        path: selected,
        maxProviderSwitches: profile.maxProviderSwitches,
      });
    }
    const stable = decodeRover({
      candidates: eventCandidates,
      lattice,
      network,
      currentCandidateId: current,
      variant: "R3",
      acousticEvidence: acoustics,
    });
    rover.push(withProfile(stable, "R3_STABILITY"));
    paths.push({
      profileId: "R3_STABILITY",
      eventId: event.eventId,
      latticeHash: lattice.semanticHash,
      path: stable.selectedPath,
      maxProviderSwitches: 2,
    });
    for (const maxProviderSwitches of profileFreeze.switchAblations) {
      const result = latticeMbr({
        candidates: eventCandidates,
        lattice,
        currentCandidateId: current,
        searchOptions: { maxProviderSwitches },
      });
      latticeMbrResults.push(
        withProfile(result, `SWITCH_${maxProviderSwitches ?? "UNLIMITED"}`),
      );
      paths.push({
        profileId: `SWITCH_${maxProviderSwitches ?? "UNLIMITED"}`,
        eventId: event.eventId,
        latticeHash: lattice.semanticHash,
        path: result.selectedPath,
        maxProviderSwitches,
      });
    }
    for (const method of ["GRAPHEME", "PRONUNCIATION"] as const) {
      const result = candidateMbr({
        candidates: eventCandidates,
        currentCandidateId: current,
        distanceMethod: method,
      });
      candidateMbrResults.push(withProfile(result, `MBR_${method}`));
      const candidatePath = lattice.candidatePaths.find(
        (p) => p.candidateId === result.selectedCandidateId,
      );
      paths.push({
        profileId: `MBR_${method}`,
        eventId: event.eventId,
        latticeHash: lattice.semanticHash,
        path: candidatePath
          ? materializeC61Path(
              lattice,
              candidatePath.nodeIds,
              eventCandidates,
              current,
              0,
              result.selectedCandidateId ?? undefined,
            )
          : keep,
        maxProviderSwitches: 0,
      });
    }
    // Supplementary graphs use the exact frozen alignment/voting policy. They
    // never replace the main P0–P9 graph or expand its legal-path oracle.
    for (const ablation of profileFreeze.alignmentAblations) {
      const existingAlignment = eventAlignments.find(
        (alignment) =>
          alignment.profile === ablation.center &&
          alignment.pronunciationAware === ablation.pronunciationAware,
      );
      const alignment =
        existingAlignment ??
        alignC61Multiple(reps, ablation.center, {
          pronunciationAware: ablation.pronunciationAware,
        });
      if (!existingAlignment) multiple.push(alignment);
      const ablationLattice = buildC61TokenLattice(alignment, reps);
      const ablationNetwork = buildC61ConfusionNetwork(ablationLattice);
      lattices.push(ablationLattice);
      networks.push(ablationNetwork);
      const result = decodeRover({
        candidates: eventCandidates,
        lattice: ablationLattice,
        network: ablationNetwork,
        currentCandidateId: current,
        variant: ablation.roverVariant,
        acousticEvidence: acoustics,
        allowAmbiguousSlots: ablation.allowAmbiguousSlots,
        minimumMargin: ablation.minimumMargin,
      });
      rover.push(withProfile(result, ablation.profileId));
      paths.push({
        profileId: ablation.profileId,
        eventId: event.eventId,
        latticeHash: ablationLattice.semanticHash,
        path: result.selectedPath,
        maxProviderSwitches: ablation.maxProviderSwitches,
      });
    }
    if (eventIndex % 20 === 0)
      options.progress?.(
        `C6.1 event ${eventIndex + 1}/${universe.events.length}; candidates=${eventCandidates.length}`,
      );
  }
  const audit = auditC61Consensus({
    paths,
    lattices,
    productionTextMutation: 0,
    productionTimingMutation: 0,
    runtimeGoldInputCount: 0,
  });
  if (!audit.safety.engineeringPassed)
    throw new Error(
      `C61_SELECTED_PATH_SAFETY_FAILED:${JSON.stringify(audit.safety)}`,
    );
  const shadows = [...new Set(paths.map((p) => p.profileId))]
    .sort()
    .map((profileId) =>
      assembleC61Shadow({
        profileId,
        production: input.subtitlePackage,
        events: universe.events,
        paths,
        lattices,
      }),
    );
  return {
    universe,
    profileFreeze,
    paths,
    shadows,
    lattices,
    acoustics,
    ...audit,
    artifacts: {
      "machine-multi-asr-hypothesis-universe.json": universe,
      "machine-multi-asr-text-representations.json":
        machineMultiAsrTextRepresentationsSchema.parse(
          artifact("machine-multi-asr-text-representations", {
            representations,
          }),
        ),
      "machine-multi-asr-pairwise-alignments.json":
        machineMultiAsrPairwiseAlignmentsSchema.parse(
          artifact("machine-multi-asr-pairwise-alignments", {
            alignments: pairwise,
          }),
        ),
      "machine-multi-asr-multiple-alignments.json":
        machineMultiAsrMultipleAlignmentsSchema.parse(
          artifact("machine-multi-asr-multiple-alignments", {
            alignments: multiple,
          }),
        ),
      "machine-multi-asr-token-lattice.json":
        machineMultiAsrTokenLatticeSchema.parse(
          artifact("machine-multi-asr-token-lattice", { lattices }),
        ),
      "machine-multi-asr-confusion-network.json":
        machineMultiAsrConfusionNetworkSchema.parse(
          artifact("machine-multi-asr-confusion-network", { networks }),
        ),
      "machine-multi-asr-span-consensus.json":
        machineMultiAsrSpanConsensusSchema.parse(
          artifact("machine-multi-asr-span-consensus", { spans }),
        ),
      "machine-multi-asr-rover-consensus.json":
        machineMultiAsrRoverConsensusSchema.parse(
          artifact("machine-multi-asr-rover-consensus", { results: rover }),
        ),
      "machine-multi-asr-mbr-consensus.json":
        machineMultiAsrMbrConsensusSchema.parse(
          artifact("machine-multi-asr-mbr-consensus", {
            candidateMbrResults,
            latticeMbrResults,
          }),
        ),
      "machine-multi-asr-consensus-path-provenance.json": audit.provenance,
      "machine-multi-asr-consensus-safety-audit.json": audit.safety,
      "c6-1-consensus-profile-freeze.json": profileFreeze,
      "c6-1-profile-selections.json": c61ProfileSelectionsSchema.parse(
        artifact("c6-1-profile-selections", { paths }),
      ),
    },
  };
}
