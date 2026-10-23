import {
  targets143Schema,
  items143Schema,
  regions143Schema,
  lexicalBindings143Schema,
  lexical142Schema,
  type Safety143,
  type Hierarchy143,
  type Obligations143,
  type Planner143,
  type Continuity143,
  type Policy143,
  type Policy142,
  type Lexical142,
  type Inventory142,
  type C60114Policy,
  type C60114ReviewTargets,
  type C60114ReviewItemsV4,
  type C60114ReviewRegionsV3,
  type C60113EvidenceFamilyGraph,
} from "@mvl/shared";
import { buildReviewGraph142 } from "./c601142-review-graph.js";
import { buildMissing142 } from "./c601142-lexical.js";
import { header142 } from "./c601142-policy.js";
import {
  hashed141,
  hash141,
  required141,
  union141,
  assertHash141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import {
  header143,
  difference143,
  intersection143,
  sampleCount143,
} from "./c601143-policy.js";
import { normalizeIndependentAsrLexical } from "../machine-quality/cross-model-normalization.js";

export function coreGraphProjection143(
  safety: Safety143,
  hierarchy: Hierarchy143,
) {
  assertHash141(safety);
  assertHash141(hierarchy);
  return hashed141({
    artifactType: "C601143_CORE_ONLY_TRANSACTION_COMPATIBILITY_PROJECTION",
    sourceIdentity: safety.sourceIdentity,
    originSafetyHash: safety.semanticHash,
    targets: safety.targets.map((b) => {
      const children = b.childUnitIds.map((id) =>
        required141(hierarchy.children.find((c) => c.childUnitId === id)),
      );
      return {
        targetId: b.targetId,
        clusterId: b.bundleId,
        parentIslandIds: b.parentClusterIds,
        memberCandidateIds: unique142(children.flatMap((c) => c.candidateIds)),
        reviewEventIds: children.map((c) => c.childUnitId),
        targetCoreUnion: children.flatMap((c) => c.nativeIntervalUnion),
        reviewEnvelope: b.reviewEnvelope,
        observationIds: unique142(children.flatMap((c) => c.observationIds)),
        evidenceIds: b.evidenceIds,
        sceneIds: b.sceneIds,
        evidenceStrata: b.evidenceStrata,
        detectorFamilies: b.detectorFamilies,
        independentFamilyCount: unique142(
          children.flatMap((c) => c.independentFamilies),
        ).length,
        maskedEvidenceIds: [],
      };
    }),
    summary: { targetUnionSeconds: safety.summary.speechCoreUnionSeconds },
  });
}

/** Bind frozen ASR candidates by exact native containment, never retarget a
 * request ID to new audio, clip a sentence into a child or infer new readings. */
export function projectFrozenLexical143(input: {
  frozen: Lexical142;
  safety: Safety143;
  hierarchy: Hierarchy143;
  policy: Policy143;
  compatibilityPolicy: Policy142;
}) {
  const { frozen, safety, hierarchy, policy } = input;
  [frozen, safety, hierarchy].forEach(assertHash141);
  const all = frozen.targets.flatMap((t) =>
    t.localizedTextCandidates.map((candidate) => ({
      candidate,
      sourceTargetId: t.targetId,
    })),
  );
  const unique = [
    ...new Map(all.map((v) => [hash141(v.candidate), v.candidate])).entries(),
  ];
  const selectedChildren = hierarchy.children.filter((c) =>
    safety.targets.some((b) => b.childUnitIds.includes(c.childUnitId)),
  );
  const entries = unique.map(([candidateHash, candidate]) => {
    const intersecting = safety.targets.filter(
      (b) =>
        intersection143([candidate.nativeInterval], b.nativeIntervalUnion)
          .length,
    );
    const contained = intersecting.filter(
      (b) =>
        !difference143([candidate.nativeInterval], b.nativeIntervalUnion)
          .length,
    );
    return {
      candidateHash,
      candidate,
      sourceTargetIds: unique142(
        all
          .filter((v) => hash141(v.candidate) === candidateHash)
          .map((v) => v.sourceTargetId),
      ),
      finalBundleIds: intersecting.map((b) => b.bundleId),
      childUnitIds: selectedChildren
        .filter(
          (c) =>
            intersection143([candidate.nativeInterval], c.nativeIntervalUnion)
              .length,
        )
        .map((c) => c.childUnitId),
      binding: contained.length
        ? "CORE_CONTAINED"
        : "CONTEXT_ONLY_UNPROJECTABLE",
      originalIntervalsPreserved: true,
      canonicalInsertAllowed: false,
      ...(!intersecting.length ? { binding: "OUTSIDE_FINAL_SELECTION" } : {}),
    };
  });
  const bindings = lexicalBindings143Schema.parse(
    hashed141({
      ...header143(policy, safety.sourceIdentity),
      artifactType: "machine-c601143-frozen-lexical-bindings",
      frozenLexicalArtifactHash: frozen.semanticHash,
      safetyHash: safety.semanticHash,
      previousLexicalArtifactHash: frozen.previousLexicalHash,
      entries,
      originalCandidateCount: all.length,
      deduplicatedCandidateCount: entries.length,
      coreContainedCount: entries.filter((e) => e.binding === "CORE_CONTAINED")
        .length,
      contextOnlyCount: entries.filter(
        (e) => e.binding === "CONTEXT_ONLY_UNPROJECTABLE",
      ).length,
      outsideSelectionCount: entries.filter(
        (e) => e.binding === "OUTSIDE_FINAL_SELECTION",
      ).length,
    }),
  );
  const coreProjection = coreGraphProjection143(safety, hierarchy);
  const targets = safety.targets.map((b) => {
    const candidates = unique
      .map(([, c]) => c)
      .filter(
        (c) => !difference143([c.nativeInterval], b.nativeIntervalUnion).length,
      );
    const families = unique142(candidates.map((c) => c.provider)),
      agreed: typeof b.nativeIntervalUnion = [],
      readingAgreed: typeof b.nativeIntervalUnion = [];
    let disagreement = false;
    for (const a of candidates.filter(
      (c) =>
        c.provider === "whisper-large-v3" &&
        c.localizationStatus === "EXACT_SOURCE_WINDOW",
    ))
      for (const c of candidates.filter(
        (c) =>
          c.provider === "reazonspeech-k2-v2" &&
          c.localizationStatus === "EXACT_SOURCE_WINDOW",
      )) {
        if (hash141(a.nativeInterval) !== hash141(c.nativeInterval)) continue;
        if (
          normalizeIndependentAsrLexical(a.text) ===
          normalizeIndependentAsrLexical(c.text)
        )
          agreed.push(a.nativeInterval);
        else if (
          a.reading &&
          a.reading === c.reading &&
          a.readingRuntimeHash === c.readingRuntimeHash
        )
          readingAgreed.push(a.nativeInterval);
        else disagreement = true;
      }
    const evidenceClass: Lexical142["targets"][number]["evidenceClass"] =
      agreed.length
        ? "CROSS_MODEL_LOCALIZED_AGREEMENT"
        : readingAgreed.length
          ? "PRONUNCIATION_AGREEMENT"
          : disagreement || families.length >= 2
            ? "CROSS_MODEL_DISAGREEMENT"
            : families[0] === "whisper-large-v3"
              ? "WHISPER_ONLY_LOCALIZED"
              : families[0] === "reazonspeech-k2-v2"
                ? "REAZON_ONLY_LOCALIZED"
                : entries.some((e) => e.finalBundleIds.includes(b.bundleId))
                  ? "CONTEXT_ONLY_UNPROJECTABLE"
                  : "LOCALIZATION_UNRESOLVED";
    return hashed141({
      targetId: b.targetId,
      targetCoreUnion: b.nativeIntervalUnion,
      requestIds: unique142(candidates.map((c) => c.requestId)),
      evidenceFamilies: families,
      evidenceClass,
      localizedTextCandidates: candidates,
      reliableLocalizedLexical: b.nativeIntervalUnion.every(
        (v) =>
          sampleCount143(intersection143([v], [...agreed, ...readingAgreed])) /
            sampleCount143([v]) >=
          input.compatibilityPolicy.coverage.full,
      ),
      localizedNativeIntervalUnion: union141(
        candidates.map((c) => c.nativeInterval),
      ),
      canonicalInsertAllowed: false,
    });
  });
  const lexical = lexical142Schema.parse(
    hashed141({
      ...header142(input.compatibilityPolicy, safety.sourceIdentity),
      artifactType: "machine-missing-lexical-evidence-v5",
      probesEvidenceHash: frozen.probesEvidenceHash,
      safetyHash: coreProjection.semanticHash,
      previousLexicalHash: frozen.previousLexicalHash,
      previousLexical: frozen.previousLexical,
      targets,
      summary: {
        targetCount: targets.length,
        crossModelCount: targets.filter(
          (t) => t.evidenceClass === "CROSS_MODEL_LOCALIZED_AGREEMENT",
        ).length,
        readingAgreementCount: targets.filter(
          (t) => t.evidenceClass === "PRONUNCIATION_AGREEMENT",
        ).length,
        singleModelCount: targets.filter((t) =>
          ["WHISPER_ONLY_LOCALIZED", "REAZON_ONLY_LOCALIZED"].includes(
            t.evidenceClass,
          ),
        ).length,
        emptyCount: 0,
        disagreementCount: targets.filter(
          (t) => t.evidenceClass === "CROSS_MODEL_DISAGREEMENT",
        ).length,
        reliableLocalizedCount: targets.filter(
          (t) => t.reliableLocalizedLexical,
        ).length,
        previousLocalizedTargetCount:
          frozen.summary.previousLocalizedTargetCount,
        localizedWhisperCandidateCount: targets
          .flatMap((t) => t.localizedTextCandidates)
          .filter(
            (c) =>
              c.provider === "whisper-large-v3" &&
              c.source === "CURRENT_C601142",
          ).length,
        localizedReazonCandidateCount: targets
          .flatMap((t) => t.localizedTextCandidates)
          .filter(
            (c) =>
              c.provider === "reazonspeech-k2-v2" &&
              c.source === "CURRENT_C601142",
          ).length,
        canonicalInsertCount: 0,
      },
    }),
  );
  return { bindings, lexical, coreProjection };
}

export function buildReviewGraph143(input: {
  policy: Policy143;
  compatibilityPolicy: Policy142;
  legacyPolicy: C60114Policy;
  inventory: Inventory142;
  safety: Safety143;
  hierarchy: Hierarchy143;
  obligations: Obligations143;
  planner: Planner143;
  continuity: Continuity143;
  frozenLexical: Lexical142;
  baselineTargets: C60114ReviewTargets;
  baselineItems: C60114ReviewItemsV4;
  baselineRegions: C60114ReviewRegionsV3;
  frozenR3Families: C60113EvidenceFamilyGraph;
}) {
  const { safety, hierarchy, policy, obligations, planner, continuity } = input;
  const { bindings, lexical, coreProjection } = projectFrozenLexical143({
    frozen: input.frozenLexical,
    safety,
    hierarchy,
    policy,
    compatibilityPolicy: input.compatibilityPolicy,
  });
  const missing = buildMissing142(
    input.inventory,
    coreProjection,
    lexical,
    input.compatibilityPolicy,
  );
  const compatibility = buildReviewGraph142({
    ...input,
    policy: input.compatibilityPolicy,
    compatibilityPolicy: input.legacyPolicy,
    safety: coreProjection,
    lexical,
    missing,
    supersessionHash: continuity.semanticHash,
  });
  const header = header143(policy, safety.sourceIdentity);
  const targets = targets143Schema.parse(
    hashed141({
      ...compatibility.targets,
      ...header,
      artifactType: "machine-review-target-intervals-v5",
      safetyHash: safety.semanticHash,
      obligationsHash: obligations.semanticHash,
      plannerCertificateHash: planner.semanticHash,
      continuityLedgerHash: continuity.semanticHash,
      targets: compatibility.targets.targets.map((t) => {
        const bundle = safety.targets.find(
            (b) => b.bundleId === t.safetyClusterId,
          ),
          children = hierarchy.children.filter(
            (c) =>
              bundle?.childUnitIds.includes(c.childUnitId) &&
              intersection143(c.nativeIntervalUnion, [t.nativeInterval]).length,
          );
        return hashed141({
          ...t,
          bundleId: bundle?.bundleId ?? null,
          childUnitIds: children.map((c) => c.childUnitId),
          phaseAObligationIds: unique142(
            children.flatMap((c) => c.obligationIds),
          ),
          bundleReviewEnvelope: bundle?.reviewEnvelope ?? null,
        });
      }),
    }),
  );
  const items = items143Schema.parse(
    hashed141({
      ...compatibility.items,
      ...header,
      artifactType: "machine-review-items-v7",
      targetsHash: targets.semanticHash,
      items: compatibility.items.items.map((item) => {
        const selected = targets.targets.filter(
          (t) => t.parentReviewItemId === item.reviewItemId,
        );
        return hashed141({
          ...item,
          bundleIds: unique142(
            selected.flatMap((t) => (t.bundleId ? [t.bundleId] : [])),
          ),
          childUnitIds: unique142(selected.flatMap((t) => t.childUnitIds)),
        });
      }),
    }),
  );
  const regions = regions143Schema.parse(
    hashed141({
      ...compatibility.regions,
      ...header,
      artifactType: "machine-review-regions-v6",
      targetsHash: targets.semanticHash,
      itemsHash: items.semanticHash,
      regions: compatibility.regions.regions.map((r) => {
        const selected = targets.targets.filter((t) =>
            r.reviewTargetIds.includes(t.reviewTargetId),
          ),
          childIds = unique142(selected.flatMap((t) => t.childUnitIds));
        return hashed141({
          ...r,
          bundleIds: unique142(
            selected.flatMap((t) => (t.bundleId ? [t.bundleId] : [])),
          ),
          childUnitIds: childIds,
          childNativeCoreUnion: union141(
            hierarchy.children
              .filter((c) => childIds.includes(c.childUnitId))
              .flatMap((c) => c.nativeIntervalUnion),
          ),
        });
      }),
    }),
  );
  return {
    compatibility,
    targets,
    items,
    regions,
    bindings,
    lexical,
    missing,
    coreProjection,
  };
}
