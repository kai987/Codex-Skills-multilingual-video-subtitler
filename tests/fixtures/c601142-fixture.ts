import {
  c601141SafetySchema,
  candidate142Schema,
  uncovered142Schema,
  type Candidate142,
  type C601141Safety,
} from "@mvl/shared";
import {
  policy141,
  header141,
  hashed141,
  hash141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import {
  policy142,
  header142,
} from "../../packages/video-subtitler/src/review/c601142-policy.js";
import { stratum142 } from "../../packages/video-subtitler/src/review/c601142-selection.js";
export const source142 = {
  sourceMediaSha256: "a".repeat(64),
  durationSeconds: 2400,
  sampleRate: 48000,
  audioStreamIndex: 0,
  audioTimebase: "1/48000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
};
export const native142 = (start: number, end: number) => ({
  startSample: Math.round(start * 48000),
  endSample: Math.round(end * 48000),
});
export function candidateFixture142(
  key: string,
  start: number,
  end: number,
  overrides: Partial<Candidate142> = {},
): Candidate142 {
  const families: Candidate142["detectorFamilies"] = ["PYANNOTE"],
    views = ["synthetic-pcm-view"];
  return candidate142Schema.parse(
    hashed141({
      islandId: `island-${key}`,
      parentIslandId: `island-${key}`,
      candidateId: `candidate-${key}`,
      nativeInterval: native142(start, end),
      sourceInterval: { start, end },
      observationIds: [`observation-${key}`],
      evidenceIds: [`evidence-${key}`],
      requestIds: [`run-${key}`],
      independentFamilies: families,
      independentFamilyCount: 1,
      distinctPcmViewIds: views,
      evidenceClass: "PYANNOTE_ONLY_SPEECH_POSITIVE",
      verifiedTimebase: true,
      strongContradiction: false,
      reliableLexical: false,
      detectorFamilies: families,
      evidenceStratum: stratum142(families, views),
      maskedEvidenceIds: [],
      speechTruthVerified: false,
      uncoveredRatio: 1,
      partialCueOverlap: false,
      partialExistingTargetOverlap: false,
      diversityBin: Math.floor(start / 60),
      priority: 500,
      sceneIds: [],
      ...overrides,
    }),
  );
}
export function uncoveredFixture142(candidates: Candidate142[]) {
  return uncovered142Schema.parse(
    hashed141({
      ...header142(policy142(), source142),
      artifactType: "machine-uncovered-speech-candidates-v2",
      inventoryHash: hash141(candidates),
      finalCueHash: hash141([]),
      previousTargetsHash: hash141([]),
      subtractedActiveSafetyHash: null,
      candidates,
      summary: {
        candidateCount: candidates.length,
        uncoveredSeconds: candidates.reduce(
          (n, c) => n + c.sourceInterval.end - c.sourceInterval.start,
          0,
        ),
      },
    }),
  );
}
export function oldSafetyFixture142(
  selected: Candidate142[] = [],
): C601141Safety {
  const targets = selected.map((c) => {
    const {
      detectorFamilies: _f,
      evidenceStratum: _s,
      maskedEvidenceIds: _m,
      speechTruthVerified: _t,
      sceneIds: _i,
      ...old
    } = c;
    void [_f, _s, _m, _t, _i];
    return hashed141({
      ...old,
      targetId: `old-${c.candidateId}`,
      targetType: "SPEECH_INVENTORY_POSSIBLE_UNCOVERED",
      requiredLevel: "RECOMMENDED",
      canonicalInsertAllowed: false,
    });
  });
  return c601141SafetySchema.parse(
    hashed141({
      ...header141(policy141(), source142),
      artifactType: "machine-missing-safety-reserve-targets-v1",
      uncoveredHash: hash141(selected),
      targets,
      audit: selected.map((c) => ({
        candidateId: c.candidateId,
        status: "SELECTED",
        reason: "SYNTHETIC_BASELINE",
      })),
      summary: {
        targetCount: targets.length,
        strongCount: 0,
        possibleCount: targets.length,
        targetUnionSeconds: selected.reduce(
          (n, c) => n + c.sourceInterval.end - c.sourceInterval.start,
          0,
        ),
        overflowCount: 0,
        auditOnlyCount: 0,
        catchAllTargetCount: 0,
        requiredLevelPromotionCount: 0,
      },
    }),
  );
}
