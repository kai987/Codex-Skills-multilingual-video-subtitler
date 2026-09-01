import {
  atomUtility144Schema,
  bundleUtility144Schema,
  childUtility144Schema,
  pathologyAudit144Schema,
  propagation144Schema,
  type AtomUtility144,
  type AtomUtilityRow144,
  type BundleUtility144,
  type BundleUtilityRow144,
  type Bundles143,
  type Candidate142,
  type ChildUtility144,
  type ChildUtilityRow144,
  type Hierarchy143,
  type Planner143,
  type Propagation144,
  type Samples142,
  type UtilityPolicy144,
} from "@mvl/shared";
import {
  assertHash141,
  hash141,
  hashed141,
  id141,
  required141,
  union141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import { sampleCount143 } from "./c601143-policy.js";
import {
  C601144_TIERS,
  durationBucket144,
  emptyTierCounts144,
  header144,
  nonzero144,
  tierOrdinal144,
} from "./c601144-policy.js";

export interface TextCandidateFeature144 {
  nativeInterval: Samples142;
  provider: "whisper-large-v3" | "reazonspeech-k2-v2";
  localizationStatus: string;
  relation:
    | "SINGLE_PROVIDER_LOCALIZED"
    | "MULTI_PROVIDER_DISAGREEMENT"
    | "PRONUNCIATION_AGREEMENT"
    | "CROSS_MODEL_LOCALIZED_AGREEMENT";
  hallucinationRiskClass: "NONE" | "REVIEW_ONLY";
}

const intersects = (a: Samples142, b: Samples142) =>
  a.startSample < b.endSample && b.startSample < a.endSample;
const stratumOrdinal = (value: string) => {
  if (value === "MULTI_DETECTOR" || value === "EXISTING_VERIFIED") return 5;
  if (value.endsWith("_EXCLUSIVE")) return 4;
  if (value === "MULTI_VIEW_SAME_DETECTOR") return 3;
  if (value === "MASKED_SUBTHRESHOLD") return 2;
  if (value === "AUDIT_ONLY") return 1;
  return 0;
};
const posteriorClass = (atom: Hierarchy143["atoms"][number]) => {
  if (
    atom.posterior.status !== "VERIFIED_EXISTING_TRACK" ||
    atom.posterior.mean === null
  )
    return { name: "POSTERIOR_UNAVAILABLE" as const, ordinal: 1 };
  if (atom.posterior.mean >= 0.5)
    return { name: "POSTERIOR_HIGH" as const, ordinal: 4 };
  if (atom.posterior.mean >= 0.25)
    return { name: "POSTERIOR_MEDIUM" as const, ordinal: 3 };
  return { name: "POSTERIOR_LOW" as const, ordinal: 2 };
};
const textClass = (features: TextCandidateFeature144[]) => {
  const providers = unique142(features.map((feature) => feature.provider));
  const relations = new Set(features.map((feature) => feature.relation));
  if (!features.length)
    return {
      name: "NO_LOCALIZED_TEXT_CANDIDATE" as const,
      ordinal: 0,
      providers,
    };
  if (relations.has("CROSS_MODEL_LOCALIZED_AGREEMENT"))
    return {
      name: "CROSS_MODEL_LOCALIZED_AGREEMENT" as const,
      ordinal: 4,
      providers,
    };
  if (relations.has("PRONUNCIATION_AGREEMENT"))
    return {
      name: "PRONUNCIATION_AGREEMENT" as const,
      ordinal: 3,
      providers,
    };
  if (providers.length > 1 || relations.has("MULTI_PROVIDER_DISAGREEMENT"))
    return {
      name: "MULTI_PROVIDER_DISAGREEMENT" as const,
      ordinal: 2,
      providers,
    };
  return {
    name: "SINGLE_PROVIDER_LOCALIZED" as const,
    ordinal: 1,
    providers,
  };
};
const independentFamilies = (families: readonly string[]) =>
  unique142(
    families.filter((family) =>
      [
        "SILERO",
        "PYANNOTE",
        "WEBRTC",
        "LEGACY_FINGERPRINT",
        "EXISTING_VERIFIED",
      ].includes(family),
    ),
  );
const tierForAtom = (input: {
  verified: boolean;
  contradicted: boolean;
  eligible: boolean;
  protected: boolean;
  families: string[];
  strata: string[];
}) => {
  if (!input.verified || input.contradicted || !input.families.length)
    return "TIER_0_INELIGIBLE_OR_CONTRADICTED" as const;
  if (input.protected || !input.eligible)
    return input.strata.includes("MASKED_SUBTHRESHOLD")
      ? ("TIER_2_MASKED_OR_SUBTHRESHOLD_SPEECH" as const)
      : ("TIER_1_AUDIT_ONLY_SPEECH_CANDIDATE" as const);
  if (input.families.length >= 2)
    return "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH" as const;
  if (input.strata.some((value) => value.endsWith("_EXCLUSIVE")))
    return "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH" as const;
  return "TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH" as const;
};

export function auditLegacyPriority144(input: {
  policy: UtilityPolicy144;
  candidates: Candidate142[];
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  planner: Planner143;
}) {
  const { policy, candidates, hierarchy, bundles, planner } = input;
  [policy, hierarchy, bundles, planner].forEach(assertHash141);
  candidates.forEach(assertHash141);
  const positiveCandidates = candidates.filter(
    (candidate) =>
      candidate.verifiedTimebase &&
      !candidate.strongContradiction &&
      candidate.detectorFamilies.length > 0 &&
      candidate.uncoveredRatio > 0,
  );
  const positiveAtoms = hierarchy.atoms.filter(
    (atom) =>
      atom.verifiedTimebase &&
      atom.eligibleEvidence &&
      !atom.strongContradiction &&
      atom.detectorFamilies.length > 0 &&
      !atom.cueCovered &&
      !atom.immutableTargetCovered,
  );
  const selected = bundles.candidates.filter((bundle) =>
    planner.selectedBundleIds.includes(bundle.bundleId),
  );
  const candidateNonzero = candidates.filter(
    (candidate) => candidate.priority !== 0,
  ).length;
  const atomNonzero = hierarchy.atoms.filter(
    (atom) => atom.machinePriority !== 0,
  ).length;
  const eligibleChildren = hierarchy.children.filter((child) => child.eligible);
  const childNonzero = eligibleChildren.filter(
    (child) => child.machinePriority !== 0,
  ).length;
  const eligibleBundles = bundles.candidates.filter(
    (bundle) => bundle.eligible,
  );
  const bundleNonzero = eligibleBundles.filter(
    (bundle) => bundle.machinePriority !== 0,
  ).length;
  const roots = [
    ...(candidateNonzero === 0
      ? (["NO_TEXT_CANDIDATE_PRIORITY_SOURCE"] as const)
      : []),
    ...(positiveAtoms.length > 0 && atomNonzero === 0
      ? (["SPEECH_EVIDENCE_NOT_INCLUDED_IN_PRIORITY"] as const)
      : []),
    ...(atomNonzero === 0 && childNonzero === 0 && bundleNonzero === 0
      ? (["ALL_ZERO_SENTINEL_PROPAGATION"] as const)
      : []),
    ...(required141(planner.objectiveVector[1], "LEGACY_OBJECTIVE_MISSING") >
      0 &&
    required141(planner.objectiveVector[4], "LEGACY_PRIORITY_MISSING") === 0
      ? ([
          "RAW_DURATION_OBJECTIVE_SATURATED",
          "PLANNER_OBJECTIVE_PRIORITY_DOMINATED",
        ] as const)
      : []),
  ];
  return pathologyAudit144Schema.parse(
    hashed141({
      ...header144(policy, hierarchy.sourceIdentity),
      artifactType: "machine-evidence-utility-pathology-audit",
      candidateArtifactHash: hash141(candidates),
      hierarchyHash: hierarchy.semanticHash,
      bundleArtifactHash: bundles.semanticHash,
      plannerCertificateHash: planner.semanticHash,
      candidateCount: candidates.length,
      candidatePriorityNonzeroCount: candidateNonzero,
      candidatePriorityZeroCount: candidates.length - candidateNonzero,
      positiveSpeechCandidateCount: positiveCandidates.length,
      atomCount: hierarchy.atoms.length,
      positiveEvidenceAtomCount: positiveAtoms.length,
      atomWithAssociatedCandidateCount: hierarchy.atoms.filter(
        (atom) => atom.candidateIds.length,
      ).length,
      atomWithoutAssociatedCandidateCount: hierarchy.atoms.filter(
        (atom) => !atom.candidateIds.length,
      ).length,
      atomMachinePriorityNonzeroCount: atomNonzero,
      positiveAtomWithZeroPriorityCount: positiveAtoms.filter(
        (atom) => atom.machinePriority === 0,
      ).length,
      childCount: hierarchy.children.length,
      eligibleChildCount: eligibleChildren.length,
      eligibleChildMachinePriorityNonzeroCount: childNonzero,
      eligibleChildZeroPriorityCount: eligibleChildren.length - childNonzero,
      bundleCount: bundles.candidates.length,
      eligibleBundleCount: eligibleBundles.length,
      eligibleBundleMachinePriorityNonzeroCount: bundleNonzero,
      eligibleBundleZeroPriorityCount: eligibleBundles.length - bundleNonzero,
      selectedBundleCount: selected.length,
      selectedBundleMachinePrioritySum: selected.reduce(
        (sum, bundle) => sum + bundle.machinePriority,
        0,
      ),
      plannerMachinePriorityObjectiveValue: required141(
        planner.objectiveVector[4],
      ),
      allZeroPriorityAtAtomLayer: atomNonzero === 0,
      allZeroPriorityAtChildLayer: childNonzero === 0,
      allZeroPriorityAtBundleLayer: bundleNonzero === 0,
      rawDurationObjectiveSaturated:
        planner.speechCoreUnionSeconds === 60 &&
        required141(planner.objectiveVector[1]) > 0,
      rootCauseClassifications: roots.length ? roots : ["UNKNOWN"],
      goldReadAttempted: false,
    }),
  );
}

export function buildAtomUtility144(input: {
  policy: UtilityPolicy144;
  hierarchy: Hierarchy143;
  lexicalArtifactHash: string;
  textCandidates: TextCandidateFeature144[];
}): AtomUtility144 {
  const { policy, hierarchy } = input;
  [policy, hierarchy].forEach(assertHash141);
  const rows = hierarchy.atoms.map((atom): AtomUtilityRow144 => {
    assertHash141(atom);
    const families = independentFamilies(atom.detectorFamilies),
      protectedCoverage = atom.cueCovered || atom.immutableTargetCovered,
      tier = tierForAtom({
        verified: atom.verifiedTimebase,
        contradicted: atom.strongContradiction,
        eligible: atom.eligibleEvidence,
        protected: protectedCoverage,
        families,
        strata: atom.evidenceStrata,
      }),
      duration =
        (atom.nativeInterval.endSample - atom.nativeInterval.startSample) /
        hierarchy.sourceIdentity.sampleRate,
      bucket = durationBucket144(duration),
      posterior = posteriorClass(atom),
      localized = input.textCandidates.filter((candidate) =>
        intersects(candidate.nativeInterval, atom.nativeInterval),
      ),
      text = textClass(localized),
      detectorExclusive = atom.evidenceStrata.some((value) =>
        value.endsWith("_EXCLUSIVE"),
      ),
      eligible =
        atom.verifiedTimebase &&
        atom.eligibleEvidence &&
        !atom.strongContradiction &&
        families.length > 0 &&
        !protectedCoverage,
      tierScore = tierOrdinal144(tier),
      maxStratum = Math.max(0, ...atom.evidenceStrata.map(stratumOrdinal)),
      speech = eligible
        ? [
            tierScore,
            Math.min(5, families.length),
            maxStratum,
            posterior.ordinal,
            detectorExclusive ? 1 : 0,
            Math.min(8, atom.distinctPcmViewIds.length),
            bucket.ordinal,
            2,
          ]
        : Array<number>(8).fill(0),
      textVector = [
        text.ordinal,
        Math.min(2, text.providers.length),
        localized.length ? 1 : 0,
        localized.some((row) => row.hallucinationRiskClass === "REVIEW_ONLY")
          ? 0
          : 1,
      ],
      review = eligible
        ? [...speech, text.ordinal, Math.min(2, text.providers.length)]
        : Array<number>(10).fill(0),
      feature = {
        verifiedTimebase: atom.verifiedTimebase,
        eligibleEvidence: atom.eligibleEvidence,
        strongContradiction: atom.strongContradiction,
        detectorFamilies: families,
        evidenceStrata: atom.evidenceStrata,
        posterior: posterior.name,
        protectedCoverage,
        durationBucket: bucket.name,
        textCandidateClass: text.name,
      };
    if (eligible && !nonzero144(speech))
      throw new Error("POSITIVE_EVIDENCE_ATOM_ZERO_UTILITY");
    return atomUtility144Schema.shape.rows.element.parse(
      hashed141({
        atomId: atom.atomId,
        sourceAtomHash: atom.semanticHash,
        verifiedTimebase: atom.verifiedTimebase,
        eligibleEvidence: atom.eligibleEvidence,
        strongContradiction: atom.strongContradiction,
        detectorFamilies: atom.detectorFamilies,
        independentEvidenceFamilies: families,
        evidenceStrata: atom.evidenceStrata,
        distinctPcmViewCount: atom.distinctPcmViewIds.length,
        posteriorSupportClass: posterior.name,
        uncoveredCoverageClass: protectedCoverage
          ? "FULLY_PROTECTED"
          : atom.cueCovered || atom.immutableTargetCovered
            ? "PARTIALLY_UNCOVERED"
            : "FULLY_UNCOVERED",
        durationBucket: bucket.name,
        detectorExclusiveNovelty: detectorExclusive,
        textCandidateAvailability: localized.length > 0,
        textCandidateClass: text.name,
        textCandidateProviderCount: text.providers.length,
        speechEvidenceTier: tier,
        speechEvidenceUtilityVector: speech,
        textCandidateUtilityVector: textVector,
        reviewSafetyUtilityVector: review,
        utilityEligibility: eligible,
        utilityReasons: eligible
          ? ["VERIFIED_GOLD_FREE_SPEECH_EVIDENCE"]
          : atom.strongContradiction
            ? ["STRONG_CONTRADICTION"]
            : protectedCoverage
              ? ["PROTECTED_INTERVAL_AUDIT_ONLY"]
              : ["NO_ELIGIBLE_POSITIVE_MACHINE_EVIDENCE"],
        featureHash: hash141(feature),
      }),
    );
  });
  const positive = rows.filter((row) => row.utilityEligibility),
    zero = positive.filter(
      (row) => !nonzero144(row.speechEvidenceUtilityVector),
    );
  if (zero.length) throw new Error("POSITIVE_EVIDENCE_ATOM_ZERO_UTILITY");
  const tiers = emptyTierCounts144();
  rows.forEach((row) => tiers[row.speechEvidenceTier]++);
  return atomUtility144Schema.parse(
    hashed141({
      ...header144(policy, hierarchy.sourceIdentity),
      artifactType: "machine-evidence-atom-utility-v1",
      hierarchyHash: hierarchy.semanticHash,
      lexicalArtifactHash: input.lexicalArtifactHash,
      rows,
      rowCount: rows.length,
      positiveEvidenceAtomCount: positive.length,
      nonzeroSpeechUtilityCount: rows.filter((row) =>
        nonzero144(row.speechEvidenceUtilityVector),
      ).length,
      positiveEvidenceZeroUtilityCount: 0,
      tierCounts: tiers,
    }),
  );
}

export function buildChildUtility144(input: {
  policy: UtilityPolicy144;
  hierarchy: Hierarchy143;
  atoms: AtomUtility144;
}): ChildUtility144 {
  const { policy, hierarchy, atoms } = input;
  [policy, hierarchy, atoms].forEach(assertHash141);
  if (atoms.hierarchyHash !== hierarchy.semanticHash)
    throw new Error("C601144_ATOM_UTILITY_HIERARCHY_BINDING_CHANGED");
  const atomMap = new Map(atoms.rows.map((row) => [row.atomId, row]));
  const rows = hierarchy.children.map((child): ChildUtilityRow144 => {
    assertHash141(child);
    const members = child.atomIds.map((atomId) =>
        required141(atomMap.get(atomId), "C601144_CHILD_ATOM_UTILITY_MISSING"),
      ),
      eligibleMembers = members.filter((row) => row.utilityEligibility),
      tiers = emptyTierCounts144();
    members.forEach((row) => tiers[row.speechEvidenceTier]++);
    const highest =
        C601144_TIERS.find((tier) => tiers[tier] > 0) ??
        "TIER_0_INELIGIBLE_OR_CONTRADICTED",
      families = unique142(
        eligibleMembers.flatMap((row) => row.independentEvidenceFamilies),
      ),
      strata = unique142(eligibleMembers.flatMap((row) => row.evidenceStrata)),
      verifiedAtomIds = new Set(eligibleMembers.map((row) => row.atomId)),
      verifiedIntervals = union141(
        hierarchy.atoms
          .filter((atom) => verifiedAtomIds.has(atom.atomId))
          .map((atom) => atom.nativeInterval),
      ),
      seconds =
        sampleCount143(verifiedIntervals) / hierarchy.sourceIdentity.sampleRate,
      capped = durationBucket144(seconds).ordinal,
      posterior = Math.max(
        0,
        ...eligibleMembers.map(
          (row) => row.speechEvidenceUtilityVector[3] ?? 0,
        ),
      ),
      textClassScore = Math.max(
        0,
        ...members.map((row) => row.textCandidateUtilityVector[0] ?? 0),
      ),
      textProviders = Math.max(
        0,
        ...members.map((row) => row.textCandidateUtilityVector[1] ?? 0),
      ),
      eligible = child.eligible && eligibleMembers.length > 0,
      detectorExclusive = eligibleMembers.some(
        (row) => row.detectorExclusiveNovelty,
      ),
      speech = eligible
        ? [
            tiers.TIER_5_VERIFIED_MULTI_FAMILY_SPEECH,
            tiers.TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH,
            tiers.TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH,
            tiers.TIER_2_MASKED_OR_SUBTHRESHOLD_SPEECH,
            tierOrdinal144(highest),
            families.length,
            strata.length,
            posterior,
            capped,
          ]
        : Array<number>(9).fill(0),
      text = [textClassScore, textProviders],
      review = eligible ? [...speech, ...text] : Array<number>(11).fill(0);
    if (eligible && !nonzero144(review))
      throw new Error("ELIGIBLE_CHILD_ZERO_REVIEW_SAFETY_UTILITY");
    return childUtility144Schema.shape.rows.element.parse(
      hashed141({
        childUnitId: child.childUnitId,
        sourceChildHash: child.semanticHash,
        memberAtomIds: child.atomIds,
        memberAtomUtilityHashes: members.map((row) => row.semanticHash),
        speechEvidenceTierCounts: tiers,
        highestSpeechEvidenceTier: highest,
        independentDetectorFamilies: families,
        evidenceStrata: strata,
        verifiedSpeechCoreIntervals: verifiedIntervals,
        verifiedSpeechCoreUnionSeconds: seconds,
        cappedDurationUtility: capped,
        detectorExclusiveNovelty: detectorExclusive,
        speechEvidenceUtilityVector: speech,
        textCandidateUtilityVector: text,
        reviewSafetyUtilityVector: review,
        utilityEligibility: eligible,
        utilityReasons: eligible
          ? ["ELIGIBLE_CHILD_WITH_VERIFIED_POSITIVE_ATOM"]
          : child.strongContradiction
            ? ["CHILD_CONTRADICTION_GATE"]
            : ["CHILD_NOT_UTILITY_ELIGIBLE"],
      }),
    );
  });
  const eligibleChildren = hierarchy.children.filter((child) => child.eligible),
    eligibleRows = rows.filter((row) =>
      eligibleChildren.some((child) => child.childUnitId === row.childUnitId),
    ),
    zero = eligibleRows.filter(
      (row) => !nonzero144(row.reviewSafetyUtilityVector),
    );
  if (zero.length) throw new Error("ELIGIBLE_CHILD_ZERO_REVIEW_SAFETY_UTILITY");
  return childUtility144Schema.parse(
    hashed141({
      ...header144(policy, hierarchy.sourceIdentity),
      artifactType: "machine-selectable-child-utility-v1",
      hierarchyHash: hierarchy.semanticHash,
      atomUtilityHash: atoms.semanticHash,
      rows,
      rowCount: rows.length,
      eligibleChildCount: eligibleRows.length,
      nonzeroEligibleChildUtilityCount: eligibleRows.length,
      eligibleChildZeroUtilityCount: 0,
      durationCappedChildCount: rows.filter(
        (row) => row.cappedDurationUtility === policy.durationUtilityCap,
      ).length,
    }),
  );
}

export function buildBundleUtility144(input: {
  policy: UtilityPolicy144;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  children: ChildUtility144;
}): BundleUtility144 {
  const { policy, hierarchy, bundles, children } = input;
  [policy, hierarchy, bundles, children].forEach(assertHash141);
  if (
    children.hierarchyHash !== hierarchy.semanticHash ||
    bundles.childrenHash !== hierarchy.semanticHash
  )
    throw new Error("C601144_BUNDLE_UTILITY_GEOMETRY_BINDING_CHANGED");
  const childMap = new Map(children.rows.map((row) => [row.childUnitId, row]));
  const geometryMap = new Map(
    hierarchy.children.map((child) => [child.childUnitId, child]),
  );
  const rows = bundles.candidates.map((bundle): BundleUtilityRow144 => {
    assertHash141(bundle);
    const childRows = bundle.childUnitIds.map((childId) =>
        required141(
          childMap.get(childId),
          "C601144_BUNDLE_CHILD_UTILITY_MISSING",
        ),
      ),
      optionalRows = childRows.filter(
        (row) =>
          required141(geometryMap.get(row.childUnitId)).obligationIds.length ===
          0,
      ),
      optionalIds = optionalRows.map((row) => row.childUnitId),
      optionalIntervals = union141(
        optionalIds.flatMap(
          (childId) =>
            required141(geometryMap.get(childId)).nativeIntervalUnion,
        ),
      ),
      optionalSeconds =
        sampleCount143(optionalIntervals) / hierarchy.sourceIdentity.sampleRate,
      tiers = emptyTierCounts144();
    childRows.forEach((row) => {
      for (const tier of C601144_TIERS)
        tiers[tier] += row.speechEvidenceTierCounts[tier];
    });
    const optionalTierCounts = emptyTierCounts144();
    optionalRows.forEach(
      (row) => optionalTierCounts[row.highestSpeechEvidenceTier]++,
    );
    const families = unique142(
        childRows.flatMap((row) => row.independentDetectorFamilies),
      ),
      strata = unique142(childRows.flatMap((row) => row.evidenceStrata)),
      speech = [
        optionalTierCounts.TIER_5_VERIFIED_MULTI_FAMILY_SPEECH,
        optionalTierCounts.TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH,
        optionalTierCounts.TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH,
        optionalTierCounts.TIER_2_MASKED_OR_SUBTHRESHOLD_SPEECH,
        optionalRows.filter((row) =>
          [
            "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
            "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
            "TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH",
          ].includes(row.highestSpeechEvidenceTier),
        ).length,
        families.length,
        strata.length,
        optionalRows.reduce((sum, row) => sum + row.cappedDurationUtility, 0),
      ],
      text = [
        optionalRows.reduce(
          (sum, row) => sum + (row.textCandidateUtilityVector[0] ?? 0),
          0,
        ),
        optionalRows.reduce(
          (sum, row) => sum + (row.textCandidateUtilityVector[1] ?? 0),
          0,
        ),
      ],
      review = [...speech, ...text],
      optionalReview = optionalRows.length
        ? review
        : Array<number>(review.length).fill(0);
    if (
      bundle.eligible &&
      optionalRows.some((row) => row.utilityEligibility) &&
      !nonzero144(optionalReview)
    )
      throw new Error("ELIGIBLE_OPTIONAL_BUNDLE_ZERO_UTILITY");
    return bundleUtility144Schema.shape.rows.element.parse(
      hashed141({
        bundleId: bundle.bundleId,
        sourceBundleHash: bundle.semanticHash,
        childUnitIds: bundle.childUnitIds,
        childUtilityHashes: childRows.map((row) => row.semanticHash),
        coveredObligationIds: bundle.obligationIds,
        optionalChildIds: optionalIds,
        speechEvidenceTierCounts: tiers,
        independentDetectorFamilies: families,
        evidenceStrata: strata,
        optionalSpeechCoreIntervals: optionalIntervals,
        optionalSpeechCoreUnionSeconds: optionalSeconds,
        cappedOptionalDurationUtility: optionalRows.reduce(
          (sum, row) => sum + row.cappedDurationUtility,
          0,
        ),
        detectorExclusiveNovelty: childRows.some(
          (row) => row.detectorExclusiveNovelty,
        ),
        timelineNovelty: bundle.timelineBins.length,
        sceneNovelty: bundle.sceneIds.length,
        speechEvidenceUtilityVector: speech,
        textCandidateUtilityVector: text,
        reviewSafetyUtilityVector: review,
        optionalReviewSafetyUtilityVector: optionalReview,
        targetSlotCost: 1,
        coreCostSamples: sampleCount143(bundle.nativeIntervalUnion),
        predictedAudioCostSamples: sampleCount143(
          bundle.predictedAudioIntervals,
        ),
        internalSilenceCostSamples: sampleCount143(bundle.internalGapIntervals),
        utilityReasons: optionalRows.length
          ? ["OPTIONAL_CHILD_UTILITY_UNION"]
          : ["MANDATORY_OBLIGATION_BUNDLE_NO_OPTIONAL_UTILITY"],
      }),
    );
  });
  const eligibleBundles = bundles.candidates.filter(
      (bundle) => bundle.eligible,
    ),
    eligibleRows = rows.filter((row) =>
      eligibleBundles.some((bundle) => bundle.bundleId === row.bundleId),
    ),
    zeroOptional = eligibleRows.filter(
      (row) =>
        row.optionalChildIds.length > 0 &&
        !nonzero144(row.optionalReviewSafetyUtilityVector),
    );
  if (zeroOptional.length)
    throw new Error("ELIGIBLE_OPTIONAL_BUNDLE_ZERO_UTILITY");
  return bundleUtility144Schema.parse(
    hashed141({
      ...header144(policy, bundles.sourceIdentity),
      artifactType: "machine-target-bundle-utility-v1",
      bundlesHash: bundles.semanticHash,
      childUtilityHash: children.semanticHash,
      rows,
      rowCount: rows.length,
      eligibleBundleCount: eligibleRows.length,
      nonzeroEligibleBundleUtilityCount: eligibleRows.filter((row) =>
        nonzero144(row.reviewSafetyUtilityVector),
      ).length,
      eligibleOptionalBundleZeroUtilityCount: 0,
    }),
  );
}

export function buildPropagationLedger144(input: {
  policy: UtilityPolicy144;
  hierarchy: Hierarchy143;
  atoms: AtomUtility144;
  children: ChildUtility144;
  bundles: BundleUtility144;
  selectedBundleIds?: string[];
  plannerCertificateHash?: string;
}): Propagation144 {
  const { policy, hierarchy, atoms, children, bundles } = input;
  [policy, hierarchy, atoms, children, bundles].forEach(assertHash141);
  const atomSource = new Map(hierarchy.atoms.map((row) => [row.atomId, row])),
    childSource = new Map(
      hierarchy.children.map((row) => [row.childUnitId, row]),
    ),
    childUtility = new Map(children.rows.map((row) => [row.childUnitId, row])),
    bundleByChild = new Map<string, BundleUtilityRow144[]>();
  bundles.rows.forEach((bundle) =>
    bundle.childUnitIds.forEach((childId) =>
      bundleByChild.set(childId, [
        ...(bundleByChild.get(childId) ?? []),
        bundle,
      ]),
    ),
  );
  const entries = atoms.rows
    .filter((atom) => atom.utilityEligibility)
    .map((atom) => {
      const source = required141(atomSource.get(atom.atomId)),
        child = required141(
          hierarchy.children.find((row) => row.atomIds.includes(atom.atomId)),
          "C601144_POSITIVE_ATOM_CHILD_MISSING",
        ),
        childRow = required141(childUtility.get(child.childUnitId)),
        bundleRows = bundleByChild.get(child.childUnitId) ?? [],
        atomPropagated = nonzero144(atom.reviewSafetyUtilityVector),
        childPropagated = nonzero144(childRow.reviewSafetyUtilityVector),
        bundlePropagated = bundleRows.some((bundle) =>
          nonzero144(bundle.reviewSafetyUtilityVector),
        ),
        geometryGated = !child.eligible,
        consumed = bundleRows.some((bundle) =>
          input.selectedBundleIds?.includes(bundle.bundleId),
        );
      if (
        !atomPropagated ||
        (!geometryGated && (!childPropagated || !bundlePropagated))
      )
        throw new Error(
          [
            "C601144_SILENT_UTILITY_PROPAGATION_LOSS",
            atom.atomId,
            child.childUnitId,
            child.eligible ? "ELIGIBLE" : "INELIGIBLE",
            nonzero144(childRow.reviewSafetyUtilityVector)
              ? "CHILD_NONZERO"
              : "CHILD_ZERO",
            bundleRows.length ? "HAS_BUNDLE" : "NO_BUNDLE",
          ].join(":"),
        );
      return propagation144Schema.shape.entries.element.parse(
        hashed141({
          propagationId: id141("utility-propagation-v144", {
            atom: atom.atomId,
            child: child.childUnitId,
          }),
          evidenceObservationIds: source.observationIds,
          atomId: atom.atomId,
          atomUtilityHash: atom.semanticHash,
          childUnitId: child.childUnitId,
          childUtilityHash: childRow.semanticHash,
          bundleIds: bundleRows.map((bundle) => bundle.bundleId),
          bundleUtilityHashes: bundleRows.map((bundle) => bundle.semanticHash),
          independentFamilyDedup: Math.max(
            0,
            source.independentFamilies.length -
              atom.independentEvidenceFamilies.length,
          ),
          durationDedup: Math.max(
            0,
            child.atomIds.length -
              required141(childSource.get(child.childUnitId))
                .nativeIntervalUnion.length,
          ),
          tierPropagation: childPropagated,
          textUtilityPropagation: childPropagated,
          reviewSafetyPropagation: bundlePropagated,
          zeroedAtStage: geometryGated ? "CHILD" : "NONE",
          zeroReason: geometryGated ? "FROZEN_CHILD_GEOMETRY_INELIGIBLE" : null,
          finalPlannerConsumption: geometryGated ? false : consumed,
        }),
      );
    });
  return propagation144Schema.parse(
    hashed141({
      ...header144(policy, hierarchy.sourceIdentity),
      artifactType: "machine-evidence-utility-propagation-ledger",
      atomUtilityHash: atoms.semanticHash,
      childUtilityHash: children.semanticHash,
      bundleUtilityHash: bundles.semanticHash,
      plannerCertificateHash: input.plannerCertificateHash ?? null,
      entries,
      positiveEvidenceRows: entries.length,
      atomUtilityProduced: entries.length,
      childUtilityProduced: unique142(
        entries
          .filter((row) => row.tierPropagation)
          .map((row) => row.childUnitId),
      ).length,
      bundleUtilityProduced: unique142(
        entries
          .filter((row) => row.reviewSafetyPropagation)
          .flatMap((row) => row.bundleIds),
      ).length,
      plannerUtilityConsumed: entries.filter(
        (row) => row.finalPlannerConsumption,
      ).length,
      explicitGeometryDropCount: entries.filter(
        (row) => row.zeroReason === "FROZEN_CHILD_GEOMETRY_INELIGIBLE",
      ).length,
      silentUtilityLossCount: 0,
      droppedBetweenEvidenceAndAtom: 0,
      droppedBetweenAtomAndChild: 0,
      droppedBetweenChildAndBundle: 0,
      droppedBetweenBundleAndPlanner: 0,
    }),
  );
}
