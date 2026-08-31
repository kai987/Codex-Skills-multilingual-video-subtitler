import {
  C612_FEATURE_NAMES,
  c612FeaturesSchema,
  type C61HypothesisUniverse,
  type C612Identity,
  type C612RankRow,
  type C612Completeness,
  type C612Group,
  type C612CtcScore,
} from "@mvl/shared";
import { artifact, hash, ratio, c612Defined } from "./c612-policy.js";
import { editDistance, textStructure, chars } from "./c612-structural.js";
export function buildTopKFeatures(input: {
  universe: C61HypothesisUniverse;
  identities: readonly C612Identity[];
  ranks: readonly C612RankRow[];
  completeness: readonly C612Completeness[];
  groups: readonly C612Group[];
  scores: readonly C612CtcScore[];
}) {
  const rows = input.identities
    .map((identity) => {
      const c = c612Defined(
        input.universe.candidates.find(
          (c) => c.candidateId === identity.candidateId,
        ),
      );
      const current = c612Defined(
        input.universe.candidates.find(
          (x) =>
            x.eventId === c.eventId &&
            x.providerFamily === "CURRENT" &&
            x.inclusionStatus === "INCLUDED",
        ),
      );
      const rank = c612Defined(
          input.ranks.find((r) => r.candidateId === c.candidateId),
        ),
        acoustic = c612Defined(
          input.completeness.find((r) => r.candidateId === c.candidateId),
        );
      const source = c612Defined(
          input.universe.events.find((e) => e.eventId === c.eventId),
        ),
        group = input.groups.find((g) =>
          g.eventIds.includes(c612Defined(c.eventId)),
        );
      const peers = input.identities.filter(
        (r) => r.eventId === c.eventId && r.providerFamily !== "CURRENT",
      );
      const sameText = peers.filter(
        (r) =>
          input.universe.candidates.find((x) => x.candidateId === r.candidateId)
            ?.normalizedText === c.normalizedText,
      );
      const shape = textStructure(current.normalizedText, c.normalizedText);
      const score = input.scores.find((r) => r.candidateId === c.candidateId),
        currentScore = input.scores.find(
          (r) => r.candidateId === current.candidateId,
        );
      const correlated = identity.observationIdentity
        ? peers.filter(
            (r) => r.observationIdentity === identity.observationIdentity,
          )
        : null;
      const supportProviders =
        sameText.length && sameText.every((r) => r.observationIdentity !== null)
          ? new Set(sameText.map((r) => r.providerFamily)).size
          : null;
      const ownProvider = peers.filter(
        (r) => r.providerFamily === c.providerFamily,
      );
      const s = acoustic.acousticCompletenessStatus;
      const values: (number | null)[] = [
        rank.rawMbrRank,
        rank.hierarchicalMbrRank,
        rank.rawMbrRisk,
        rank.hierarchicalMbrRisk,
        rank.rawMbrMargin,
        rank.hierarchicalMbrMargin,
        editDistance(current.normalizedText, c.normalizedText) /
          Math.max(
            1,
            chars(current.normalizedText).length,
            chars(c.normalizedText).length,
          ),
        current.pronunciationText && c.pronunciationText
          ? editDistance(current.pronunciationText, c.pronunciationText) /
            Math.max(
              1,
              chars(current.pronunciationText).length,
              chars(c.pronunciationText).length,
            )
          : null,
        shape.lengthRatio,
        shape.lcsRatio,
        shape.prefixRetention,
        shape.suffixRetention,
        shape.insertionRatio,
        shape.deletionRatio,
        Number(c.providerFamily === "WHISPER"),
        Number(c.providerFamily === "REAZON"),
        Number(c.providerFamily === "CURRENT"),
        correlated?.length ?? null,
        supportProviders,
        correlated ? Math.max(0, correlated.length - 1) : null,
        peers.every((p) => p.observationIdentity !== null)
          ? new Set(peers.map((p) => p.observationIdentity)).size
          : null,
        ownProvider.length &&
        ownProvider.every((p) => p.observationIdentity !== null)
          ? ratio(
              new Set(
                sameText
                  .filter((p) => p.providerFamily === c.providerFamily)
                  .map((p) => p.observationIdentity),
              ).size,
              new Set(ownProvider.map((p) => p.observationIdentity)).size,
            )
          : null,
        ownProvider.length
          ? sameText.filter((p) => p.providerFamily === c.providerFamily)
              .length / ownProvider.length
          : null,
        identity.requestedInterval && identity.coreInterval
          ? Number(
              identity.requestedInterval.start < identity.coreInterval.start ||
                identity.requestedInterval.end > identity.coreInterval.end,
            )
          : null,
        null,
        acoustic.candidateCtcLossPerToken,
        score?.audioHash &&
        score.audioHash === currentScore?.audioHash &&
        score.perTokenLoss !== null &&
        currentScore.perTokenLoss !== null
          ? currentScore.perTokenLoss - score.perTokenLoss
          : null,
        acoustic.candidateTokenSupportCoverage,
        acoustic.speechActivityCoverage,
        acoustic.speechBeforeFirstSupportedToken,
        acoustic.speechAfterLastSupportedToken,
        s === "VERIFIED_COMPLETE"
          ? 1
          : s === "LIKELY_COMPLETE"
            ? 0.5
            : ["INSUFFICIENT_EVIDENCE", "UNSCORABLE"].includes(s)
              ? null
              : 0,
        acoustic.requestLeftEdgeDistance === null ||
        acoustic.requestRightEdgeDistance === null
          ? null
          : Number(
              Math.min(
                acoustic.requestLeftEdgeDistance,
                acoustic.requestRightEdgeDistance,
              ) < 0.04,
            ),
        acoustic.adjacentUtteranceContaminationRisk,
        source.finalSpan ? Number(source.finalSpan.modifiable) : null,
        group ? Number(group.status.startsWith("FIXED_")) : null,
        Number(
          !!(
            c.provenanceHash &&
            c.sourceInterval &&
            (c.providerFamily === "CURRENT" || (c.modelIdentity && c.requestId))
          ),
        ),
        Number(
          !Array.from(c.displayText).some((t) => {
            const cp = c612Defined(t.codePointAt(0));
            return cp >= 0xd800 && cp <= 0xdfff;
          }),
        ),
      ];
      return {
        candidateId: c.candidateId,
        eventId: c612Defined(c.eventId),
        values,
        missing: values.map((v) => v === null),
        evidenceHashes: [hash(rank), hash(identity), hash(acoustic)].sort(),
      };
    })
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  return c612FeaturesSchema.parse(
    artifact("machine-c6-1-2-top-k-features", {
      featureNames: [...C612_FEATURE_NAMES],
      rows,
      rawTextFeatureCount: 0,
      goldFeatureCount: 0,
      datasetSpecificFeatureCount: 0,
      runtimeGoldInputCount: 0,
    }),
  );
}
