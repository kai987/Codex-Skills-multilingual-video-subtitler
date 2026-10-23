import {
  contractPolicy145Schema,
  type ContractPolicy145,
  type Policy145,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { hashed141 } from "./c601141-policy.js";
import { header145 } from "./c601145-policy.js";

export function buildContractPolicy145(input: {
  policy: Policy145;
  sourceIdentity: C60114SourceIdentity;
}): ContractPolicy145 {
  return contractPolicy145Schema.parse(
    hashed141({
      ...header145(input.policy, input.sourceIdentity),
      artifactType: "machine-review-safety-contract-policy-v1",
      productGoContract: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
      contracts: [
        {
          contractType: "TARGET_CORE_LOCALIZATION_CONTRACT_V1",
          role: "LOCALIZATION_DIAGNOSTIC",
          goldCoverageThreshold: 0.8,
          unitCoverageThreshold: input.policy.coreCompleteUnitCoverageThreshold,
          anchorMinimumOverlapSeconds: null,
          anchorMinimumUnitCoverageRatio: null,
          maximumReviewEnvelopeSeconds: null,
          maximumOneSideContextSeconds: null,
        },
        {
          contractType: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
          role: "PRODUCT_GO",
          goldCoverageThreshold: input.policy.playbackGoldCoverageThreshold,
          unitCoverageThreshold: input.policy.playbackUnitCoverageThreshold,
          anchorMinimumOverlapSeconds:
            input.policy.machineAnchorMinimumOverlapSeconds,
          anchorMinimumUnitCoverageRatio:
            input.policy.machineAnchorMinimumUnitCoverageRatio,
          maximumReviewEnvelopeSeconds:
            input.policy.maximumReviewEnvelopeSeconds,
          maximumOneSideContextSeconds:
            input.policy.maximumOneSideContextSeconds,
        },
      ],
      frozenPreGold: true,
      machineOnlyReleaseAuthorized: false,
      thresholdChangeAllowedPostFreeze: false,
      wholeEpisodeCatchAllAllowed: false,
    }),
  );
}
