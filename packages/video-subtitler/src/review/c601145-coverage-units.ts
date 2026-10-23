import {
  coverageUnits145Schema,
  type CoverageUnit145,
  type CoverageUnits145,
  type Hierarchy143,
  type Policy145,
  type Samples142,
} from "@mvl/shared";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
  union141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import {
  difference143,
  intersection143,
  sampleCount143,
} from "./c601143-policy.js";
import { header145 } from "./c601145-policy.js";

type Atom145 = Hierarchy143["atoms"][number];

const sortedUnique145 = (values: readonly string[]) =>
  unique142(values).sort((a, b) => a.localeCompare(b));

const seconds145 = (sample: number, rate: number) => sample / rate;

export function coverageUnitIdentity145(input: {
  policy: Policy145;
  sourceIdentity: Hierarchy143["sourceIdentity"];
  atomicNativeIntervals: Samples142[];
  independentEvidenceFamilies: string[];
}) {
  const payload = {
    sourceMediaSha256: input.sourceIdentity.sourceMediaSha256,
    sourceAudioStreamIdentity: {
      audioStreamIndex: input.sourceIdentity.audioStreamIndex,
      audioTimebase: input.sourceIdentity.audioTimebase,
      sampleRate: input.sourceIdentity.sampleRate,
    },
    atomicNativeIntervals: union141(input.atomicNativeIntervals),
    boundaryPolicyVersion: input.policy.coverageUnitBoundaryPolicyVersion,
    correlationNormalizedEvidenceFamilies: sortedUnique145(
      input.independentEvidenceFamilies,
    ),
  };
  const fingerprint = hash141(payload);
  return {
    coverageUnitId: `speech-coverage-unit-v145-${fingerprint.slice(0, 24)}`,
    segmentationFingerprint: fingerprint,
  };
}

function hardBoundaryBetween145(
  hierarchy: Hierarchy143,
  group: readonly Atom145[],
  next: Atom145,
) {
  const previous = group.at(-1);
  if (!previous) return false;
  const lower = previous.nativeInterval.startSample;
  const upper = next.nativeInterval.startSample;
  return hierarchy.boundaries.some(
    (boundary) =>
      boundary.hard && boundary.atSample > lower && boundary.atSample <= upper,
  );
}

function posterior145(atoms: readonly Atom145[]) {
  let weighted = 0,
    weight = 0,
    maximum = 0,
    covered = 0;
  for (const atom of atoms) {
    const samples =
      atom.nativeInterval.endSample - atom.nativeInterval.startSample;
    maximum = Math.max(maximum, atom.posterior.maximum ?? 0);
    if (atom.posterior.status === "VERIFIED_EXISTING_TRACK") {
      weighted += (atom.posterior.mean ?? 0) * samples;
      weight += samples;
      covered += samples;
    }
  }
  const total = atoms.reduce(
    (sum, atom) =>
      sum + atom.nativeInterval.endSample - atom.nativeInterval.startSample,
    0,
  );
  return {
    maximum,
    weightedMean: weight ? weighted / weight : 0,
    coveredUnionRatio: total ? covered / total : 0,
    webRtcBinarySupport: atoms.some((atom) =>
      atom.detectorFamilies.includes("WEBRTC"),
    ),
  };
}

function buildUnit145(input: {
  policy: Policy145;
  hierarchy: Hierarchy143;
  atoms: Atom145[];
  existingTargetIntervals: Samples142[];
  existingPlaybackIntervals: Samples142[];
}): CoverageUnit145 {
  const { hierarchy, atoms } = input,
    rate = hierarchy.sourceIdentity.sampleRate,
    atomicNativeIntervals = union141(atoms.map((atom) => atom.nativeInterval)),
    coreUnionSamples = sampleCount143(atomicNativeIntervals),
    envelopeInterval = {
      startSample: required141(atomicNativeIntervals[0]).startSample,
      endSample: required141(atomicNativeIntervals.at(-1)).endSample,
    },
    independentEvidenceFamilies = sortedUnique145(
      atoms.flatMap((atom) => atom.independentFamilies),
    ),
    identity = coverageUnitIdentity145({
      policy: input.policy,
      sourceIdentity: hierarchy.sourceIdentity,
      atomicNativeIntervals,
      independentEvidenceFamilies,
    }),
    atomIds = new Set(atoms.map((atom) => atom.atomId)),
    children = hierarchy.children.filter((child) =>
      child.atomIds.some((atomId) => atomIds.has(atomId)),
    );
  return coverageUnits145Schema.shape.units.element.parse(
    hashed141({
      ...identity,
      sourceIdentity: hierarchy.sourceIdentity,
      atomicNativeIntervals,
      atomicSourceIntervals: atomicNativeIntervals.map((interval) => ({
        start: seconds145(interval.startSample, rate),
        end: seconds145(interval.endSample, rate),
      })),
      coreUnionSamples,
      coreUnionSeconds: coreUnionSamples / rate,
      envelopeInterval,
      envelopeSeconds:
        (envelopeInterval.endSample - envelopeInterval.startSample) / rate,
      internalSilenceIntervals: difference143(
        [envelopeInterval],
        atomicNativeIntervals,
      ),
      evidenceAtomIds: atoms.map((atom) => atom.atomId).sort(),
      childUnitIds: children.map((child) => child.childUnitId).sort(),
      parentClusterIds: sortedUnique145(
        atoms.flatMap((atom) => atom.parentClusterIds),
      ),
      detectorFamilies: sortedUnique145(
        atoms.flatMap((atom) => atom.detectorFamilies),
      ),
      independentEvidenceFamilies,
      evidenceStrata: sortedUnique145(
        atoms.flatMap((atom) => atom.evidenceStrata),
      ),
      distinctPcmViewIds: sortedUnique145(
        atoms.flatMap((atom) => atom.distinctPcmViewIds),
      ),
      posteriorSummary: posterior145(atoms),
      phaseAObligationIds: sortedUnique145(
        atoms.flatMap((atom) => atom.obligationIds),
      ),
      timelineBins: [
        ...new Set(atoms.flatMap((atom) => atom.timelineBins)),
      ].sort((a, b) => a - b),
      sceneIds: sortedUnique145(atoms.flatMap((atom) => atom.sceneIds)),
      candidateIds: sortedUnique145(atoms.flatMap((atom) => atom.candidateIds)),
      strongContradiction: atoms.some((atom) => atom.strongContradiction),
      verifiedTimebase: atoms.every((atom) => atom.verifiedTimebase),
      existingTargetCoverage:
        sampleCount143(
          intersection143(atomicNativeIntervals, input.existingTargetIntervals),
        ) / coreUnionSamples,
      existingPlaybackCoverage:
        sampleCount143(
          intersection143(
            atomicNativeIntervals,
            input.existingPlaybackIntervals,
          ),
        ) / coreUnionSamples,
    }),
  );
}

export function buildCoverageUnits145(input: {
  policy: Policy145;
  hierarchy: Hierarchy143;
  obligationsHash: string;
  existingTargetIntervals: Samples142[];
  existingPlaybackIntervals: Samples142[];
}): CoverageUnits145 {
  assertHash141(input.policy);
  assertHash141(input.hierarchy);
  const mergeGapSamples = Math.round(
      input.policy.coverageUnitMergeGapSeconds *
        input.hierarchy.sourceIdentity.sampleRate,
    ),
    atoms = input.hierarchy.atoms
      .filter(
        (atom) =>
          atom.verifiedTimebase &&
          atom.eligibleEvidence &&
          !atom.strongContradiction &&
          !atom.cueCovered &&
          !atom.immutableTargetCovered,
      )
      .sort(
        (a, b) =>
          a.nativeInterval.startSample - b.nativeInterval.startSample ||
          a.nativeInterval.endSample - b.nativeInterval.endSample ||
          a.atomId.localeCompare(b.atomId),
      ),
    groups: Atom145[][] = [];
  for (const atom of atoms) {
    const group = groups.at(-1),
      currentEnd = group
        ? Math.max(...group.map((row) => row.nativeInterval.endSample))
        : -1,
      gap = atom.nativeInterval.startSample - currentEnd;
    if (
      !group ||
      gap > mergeGapSamples ||
      hardBoundaryBetween145(input.hierarchy, group, atom)
    )
      groups.push([atom]);
    else group.push(atom);
  }
  const units = groups.map((group) =>
    buildUnit145({
      ...input,
      atoms: group,
    }),
  );
  for (let index = 1; index < units.length; index++) {
    const previous = required141(units[index - 1]),
      current = required141(units[index]);
    if (
      previous.envelopeInterval.startSample >
      current.envelopeInterval.startSample
    )
      throw new Error("C601145_COVERAGE_UNITS_NOT_SOURCE_ORDERED");
  }
  return coverageUnits145Schema.parse(
    hashed141({
      ...header145(input.policy, input.hierarchy.sourceIdentity),
      artifactType: "machine-speech-safety-coverage-units-v1",
      hierarchyHash: input.hierarchy.semanticHash,
      obligationsHash: input.obligationsHash,
      boundaryPolicyVersion: input.policy.coverageUnitBoundaryPolicyVersion,
      mergeGapSamples,
      units,
      coverageUnitCount: units.length,
      eligibleCoverageUnitCount: units.filter(
        (unit) => unit.verifiedTimebase && !unit.strongContradiction,
      ).length,
      sourceOrdered: true,
      intervalIntegrityPassed: true,
      sourceIdentityConsistent: true,
      childPartitionIndependent: true,
    }),
  );
}
