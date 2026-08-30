import path from "node:path";
import {
  c611BaselineSchema,
  c611CalibrationPolicySchema,
  c611CalibrationFoldsSchema,
  c611LegacyControlSchema,
  c611PolicyFreezeSchema,
  machineSelectiveExistingCandidateProposalsSchema,
  machineSelectiveMbrFeaturesSchema,
  machineExistingCandidateCompletenessRiskSchema,
  machineMultiAsrHypothesisUniverseSchema,
  machineMultiAsrTokenLatticeSchema,
  c61ProfileSelectionsSchema,
  c61ConsensusProfileFreezeSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { c61Json, c61FileHash } from "./c61-artifact-io.js";
import { verifyC611MachineFreeze } from "./c611-artifact-io.js";
import { prepareC611CalibrationSamples } from "./selective-mbr-calibration.js";

/** Load frozen choices, never rebuild/select a proposal after labels are accessible. */
export async function loadC611FrozenInputs(input: {
  machine: string;
  previous: string;
  repository: string;
}) {
  const freeze = await verifyC611MachineFreeze(input.machine, input.repository);
  for (const [name, sha] of Object.entries(freeze.inputHashes))
    if (name.startsWith("c61/")) {
      if ((await c61FileHash(path.join(input.previous, name.slice(4)))) !== sha)
        throw new Error("C611_C61_SOURCE_ARTIFACT_CHANGED");
    }
  const read = (name: string) => c61Json(path.join(input.machine, name));
  const proposals = machineSelectiveExistingCandidateProposalsSchema.parse(
    await read("machine-selective-existing-candidate-proposals.json"),
  );
  const features = machineSelectiveMbrFeaturesSchema.parse(
    await read("machine-selective-mbr-features.json"),
  );
  const universe = machineMultiAsrHypothesisUniverseSchema.parse(
    await c61Json(
      path.join(input.previous, "machine-multi-asr-hypothesis-universe.json"),
    ),
  );
  const all = machineMultiAsrTokenLatticeSchema.parse(
    await c61Json(
      path.join(input.previous, "machine-multi-asr-token-lattice.json"),
    ),
  );
  const selections = c61ProfileSelectionsSchema.parse(
    await c61Json(path.join(input.previous, "c6-1-profile-selections.json")),
  );
  const paths = selections.paths.filter((p) => p.profileId === "P0");
  return {
    freeze,
    proposals,
    features,
    universe,
    lattices: all.lattices.filter((l) =>
      paths.some(
        (p) => p.eventId === l.eventId && p.latticeHash === l.semanticHash,
      ),
    ),
    samples: prepareC611CalibrationSamples(proposals.records, features.rows),
    baseline: c611BaselineSchema.parse(await read("c6-1-1-baseline.json")),
    production: subtitlePackageSchema.parse(
      await read("subtitle-package.production.json"),
    ),
    completeness: machineExistingCandidateCompletenessRiskSchema.parse(
      await read("machine-existing-candidate-completeness-risk.json"),
    ),
    folds: c611CalibrationFoldsSchema.parse(
      await read("c6-1-1-calibration-folds.json"),
    ),
    calibrationPolicy: c611CalibrationPolicySchema.parse(
      await read("c6-1-1-calibration-policy.json"),
    ),
    policy: c611PolicyFreezeSchema.parse(
      await read("c6-1-1-policy-freeze.json"),
    ),
    legacy: c611LegacyControlSchema.parse(
      await read("c6-1-1-legacy-p6-control.json"),
    ),
    legacyPolicy: c61ConsensusProfileFreezeSchema.parse(
      await read("c6-1-consensus-profile-freeze.json"),
    ),
  };
}
export type C611FrozenInputs = Awaited<ReturnType<typeof loadC611FrozenInputs>>;
