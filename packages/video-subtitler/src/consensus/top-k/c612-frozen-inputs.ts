import path from "node:path";
import type { z } from "zod";
import {
  machineMultiAsrHypothesisUniverseSchema,
  subtitlePackageSchema,
  c612RankAuditSchema,
  c612TopKSchema,
  c612IdentitySchema,
  c612FeaturesSchema,
  c612ContractionSchema,
  c612CompletenessSchema,
  c612FoldsSchema,
  c612MappingSchema,
  c612CorrelationAuditSchema,
  c612CtcSchema,
  c612BaselineSchema,
  c612ProfileFreezeSchema,
  c612FullIdentitySchema,
  machineSelectiveExistingCandidateProposalsSchema,
  machineExistingCandidateMbrRiskLedgerSchema,
} from "@mvl/shared";
import { c61Json } from "../c61-artifact-io.js";
import { verifyC612MachineFreeze } from "./c612-machine-stage.js";
import { C612_RERANKER_PROFILE_HASH } from "./linear-reranker.js";
export async function readC612FrozenInputs(root: string, repository: string) {
  const freeze = await verifyC612MachineFreeze(root, repository);
  const parse = async <S extends z.ZodType>(
    name: string,
    schema: S,
  ): Promise<z.infer<S>> =>
    schema.parse(await c61Json(path.join(root, "machine", name + ".json")));
  const profiles = await parse(
    "c6-1-2-reranker-profile-freeze",
    c612ProfileFreezeSchema,
  );
  if (profiles.profileHash !== C612_RERANKER_PROFILE_HASH)
    throw new Error("C612_PROFILE_FREEZE_CHANGED");
  return {
    freeze,
    profiles,
    fullIdentities: await parse(
      "machine-c6-1-2-full-correlation-identity",
      c612FullIdentitySchema,
    ),
    legacyRisks: await parse(
      "machine-input-c611-risk-ledger",
      machineExistingCandidateMbrRiskLedgerSchema,
    ),
    legacyProposals: await parse(
      "machine-input-c611-proposals",
      machineSelectiveExistingCandidateProposalsSchema,
    ),
    universe: await parse(
      "machine-input-hypothesis-universe",
      machineMultiAsrHypothesisUniverseSchema,
    ),
    production: await parse(
      "subtitle-package.production",
      subtitlePackageSchema,
    ),
    ranks: await parse(
      "machine-c6-1-2-full-candidate-rank-audit",
      c612RankAuditSchema,
    ),
    topK: await parse("machine-c6-1-2-top-k-candidate-set", c612TopKSchema),
    identities: await parse(
      "machine-c6-1-2-candidate-correlation-identity",
      c612IdentitySchema,
    ),
    features: await parse("machine-c6-1-2-top-k-features", c612FeaturesSchema),
    contraction: await parse(
      "machine-c6-1-2-contraction-audit",
      c612ContractionSchema,
    ),
    completeness: await parse(
      "machine-c6-1-2-candidate-acoustic-completeness",
      c612CompletenessSchema,
    ),
    folds: await parse("c6-1-2-folds", c612FoldsSchema),
    mapping: await parse(
      "c6-1-2-fixed-cue-group-mapping-v2",
      c612MappingSchema,
    ),
    correlation: await parse(
      "machine-c6-1-2-correlation-audit",
      c612CorrelationAuditSchema,
    ),
    scores: await parse("machine-c6-1-2-candidate-ctc-scores", c612CtcSchema),
    baseline: await parse("c6-1-2-baseline-replay", c612BaselineSchema),
  };
}
export type C612FrozenInputs = Awaited<ReturnType<typeof readC612FrozenInputs>>;
