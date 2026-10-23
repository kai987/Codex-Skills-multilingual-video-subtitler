import {
  c6015PolicyVersion,
  decoderEvidenceSchema,
  machineVariantEvidenceBundleSchema,
  type C6015Mode,
  type DecoderEvidence,
  type MachineVariantEvidenceBundle,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

export interface VariantEvidenceInput {
  variantId: string;
  eventId: string;
  candidateId: string;
  text: string;
  interval: { start: number; end: number };
  eventInterval: { start: number; end: number };
  requestIds: readonly string[];
  sourceWindowIds: readonly string[];
  independentSupportGroups: readonly string[];
  correlatedSupportGroups: readonly string[];
  speechCoverage: number;
  reAsrOrigin: {
    isReAsr: boolean;
    requestFamilyIds: readonly string[];
    sourceGlobalVerified: boolean;
    promptIsolated: boolean;
  };
  decoderEvidence: DecoderEvidence;
}

export interface VariantTokenEvidenceInput {
  tokenId: string;
  variantId: string | null;
  text: string;
  lexical: boolean;
  trusted: boolean;
}

export interface VariantCtcEvidenceInput {
  variantId: string;
  evidenceId: string;
  score: number | null;
  edgePinned: boolean;
}

function lexicalCharacters(value: string): string[] {
  return Array.from(normalizeCandidateText(value));
}

function coverage(
  text: string,
  tokenTexts: readonly string[],
): {
  lexicalTokenCount: number;
  supportedLexicalTokenCount: number;
  coverageRatio: number;
} {
  const characters = lexicalCharacters(text);
  if (characters.length === 0) {
    return {
      lexicalTokenCount: 0,
      supportedLexicalTokenCount: 0,
      coverageRatio: 0,
    };
  }
  const tokenText = normalizeCandidateText(tokenTexts.join(""));
  let cursor = 0;
  let supported = 0;
  for (const character of characters) {
    const index = tokenText.indexOf(character, cursor);
    if (index < 0) continue;
    supported += 1;
    cursor = index + character.length;
  }
  return {
    lexicalTokenCount: characters.length,
    supportedLexicalTokenCount: supported,
    coverageRatio: supported / characters.length,
  };
}

function edgePosition(
  input: VariantEvidenceInput,
): DecoderEvidence["edgePosition"] {
  const tolerance = 0.03;
  const left =
    Math.abs(input.interval.start - input.eventInterval.start) <= tolerance;
  const right =
    Math.abs(input.interval.end - input.eventInterval.end) <= tolerance;
  if (left && right) return "both-edges";
  if (left) return "left-edge";
  if (right) return "right-edge";
  return "inside";
}

/**
 * Rebuilds evidence after every candidate-pool mutation. Tokens are joined only
 * by exact variantId; representative-cue tokens are never inherited.
 */
export function buildVariantEvidenceBundle(input: {
  mode: C6015Mode;
  variants: readonly VariantEvidenceInput[];
  tokens: readonly VariantTokenEvidenceInput[];
  ctcEvidence: readonly VariantCtcEvidenceInput[];
  generatedAt?: string;
}): MachineVariantEvidenceBundle {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const tokensByVariant = new Map<string, VariantTokenEvidenceInput[]>();
  for (const token of input.tokens) {
    if (token.variantId === null) continue;
    const values = tokensByVariant.get(token.variantId) ?? [];
    values.push(token);
    tokensByVariant.set(token.variantId, values);
  }
  const ctcByVariant = new Map<string, VariantCtcEvidenceInput[]>();
  for (const ctc of input.ctcEvidence) {
    const values = ctcByVariant.get(ctc.variantId) ?? [];
    values.push(ctc);
    ctcByVariant.set(ctc.variantId, values);
  }
  const variants = input.variants
    .map((variant) => {
      const exactTokens = tokensByVariant.get(variant.variantId) ?? [];
      const lexical = exactTokens.filter((token) => token.lexical);
      const trusted = lexical.filter((token) => token.trusted);
      const tokenCoverage = coverage(
        variant.text,
        trusted.map((token) => token.text),
      );
      const ctc = ctcByVariant.get(variant.variantId) ?? [];
      const ctcScores = ctc.flatMap((entry) =>
        entry.score === null ? [] : [entry.score],
      );
      const edge = edgePosition(variant);
      const normalizedDecoder = decoderEvidenceSchema.parse({
        ...variant.decoderEvidence,
        edgePosition:
          variant.decoderEvidence.status === "available"
            ? (variant.decoderEvidence.edgePosition ?? edge)
            : null,
      });
      const blockers = [
        ...(normalizedDecoder.status === "available"
          ? []
          : ["decoder-evidence-unavailable"]),
        ...(ctc.length === 0 ? ["ctc-evidence-unavailable"] : []),
        ...(trusted.length === 0
          ? ["variant-specific-trusted-token-unavailable"]
          : []),
        ...(variant.reAsrOrigin.isReAsr &&
        !variant.reAsrOrigin.sourceGlobalVerified
          ? ["reasr-source-global-lineage-unverified"]
          : []),
        ...(variant.reAsrOrigin.isReAsr && !variant.reAsrOrigin.promptIsolated
          ? ["reasr-prompt-isolation-failed"]
          : []),
      ];
      const evidenceCompleteness =
        blockers.length === 0
          ? ("COMPLETE" as const)
          : blockers.length >= 3
            ? ("UNAVAILABLE" as const)
            : ("PARTIAL" as const);
      const core = {
        variantId: variant.variantId,
        eventId: variant.eventId,
        candidateId: variant.candidateId,
        requestIds: [...new Set(variant.requestIds)].toSorted(),
        sourceWindowIds: [...new Set(variant.sourceWindowIds)].toSorted(),
        tokenIds: lexical.map((token) => token.tokenId).toSorted(),
        trustedGlobalTokenIds: trusted.map((token) => token.tokenId).toSorted(),
        tokenCoverage: {
          ...tokenCoverage,
          variantSpecific: true as const,
          representativeTokenLeakCount: 0 as const,
        },
        ctcEvidenceIds: ctc.map((entry) => entry.evidenceId).toSorted(),
        ctcScore:
          ctcScores.length === 0
            ? null
            : ctcScores.reduce((sum, value) => sum + value, 0) /
              ctcScores.length,
        decoderEvidence: normalizedDecoder,
        edgeEvidence: {
          leftEdgeRisk: edge === "left-edge" || edge === "both-edges",
          rightEdgeRisk: edge === "right-edge" || edge === "both-edges",
          evidenceIds: ctc
            .filter((entry) => entry.edgePinned)
            .map((entry) => entry.evidenceId)
            .toSorted(),
        },
        speechCoverage: Math.max(0, Math.min(1, variant.speechCoverage)),
        independentSupportGroups: [
          ...new Set(variant.independentSupportGroups),
        ].toSorted(),
        correlatedSupportGroups: [
          ...new Set(variant.correlatedSupportGroups),
        ].toSorted(),
        reAsrOrigin: {
          ...variant.reAsrOrigin,
          requestFamilyIds: [
            ...new Set(variant.reAsrOrigin.requestFamilyIds),
          ].toSorted(),
        },
        evidenceCompleteness,
        blockers,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.variantId.localeCompare(right.variantId),
    );
  const summary = {
    eventCount: new Set(variants.map((variant) => variant.eventId)).size,
    variantEvidenceCount: variants.length,
    completeCount: variants.filter(
      (variant) => variant.evidenceCompleteness === "COMPLETE",
    ).length,
    partialCount: variants.filter(
      (variant) => variant.evidenceCompleteness === "PARTIAL",
    ).length,
    unavailableCount: variants.filter(
      (variant) => variant.evidenceCompleteness === "UNAVAILABLE",
    ).length,
    reAsrVariantCount: variants.filter((variant) => variant.reAsrOrigin.isReAsr)
      .length,
    trustedTokenConsumedCount: new Set(
      variants.flatMap((variant) => variant.trustedGlobalTokenIds),
    ).size,
    representativeTokenLeakCount: 0 as const,
    fabricatedDecoderZeroCount: 0 as const,
  };
  const core = {
    mode: input.mode,
    tokenAssociationPolicy: "variant-id-only" as const,
    variants,
    summary,
  };
  return machineVariantEvidenceBundleSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-variant-evidence-bundle",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
