import type {
  AsrRequestTimelineContract,
  CandidateConsensusMode,
  GlobalTokenTimelineMode,
  SubtitleCue,
} from "@mvl/shared";

import { buildAcousticEventFamilies } from "./acoustic-event-family.js";
import { applyCrossWindowConsensus } from "./candidate-consensus.js";
import { buildCueTimelineEvidence } from "./cue-timeline-evidence.js";
import { buildGlobalTokenTimeline } from "./global-token-timeline.js";
import { enforceLexicalConservation } from "./lexical-conservation.js";
import { classifyOverlapEvents } from "./overlap-event-classification.js";
import { enforceTimingNonDegradation } from "./timing-non-degradation.js";

export function runCandidatePrecisionWorkflow(input: {
  cues: readonly SubtitleCue[];
  evidenceCues: readonly SubtitleCue[];
  requestTimelineContract: AsrRequestTimelineContract;
  candidateConsensus: CandidateConsensusMode;
  globalTokenTimeline: GlobalTokenTimelineMode;
  generatedAt?: string;
}) {
  const family = buildAcousticEventFamilies({
    cues: input.evidenceCues,
    mode: input.candidateConsensus,
    sourceMediaSha256:
      input.requestTimelineContract.requests[0]?.sourceMediaSha256 ?? null,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const consensus = applyCrossWindowConsensus({
    cues: input.evidenceCues,
    families: family.artifact,
    mode: input.candidateConsensus,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const tokenTimeline = buildGlobalTokenTimeline({
    // Token provenance remains request-specific even when text candidates are
    // consolidated into one acoustic-event family.
    cues: input.evidenceCues,
    requestContract: input.requestTimelineContract,
    mode: input.globalTokenTimeline,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const cueTimeline = buildCueTimelineEvidence({
    cues: input.cues,
    tokenTimeline,
    mode: input.globalTokenTimeline,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const timing = enforceTimingNonDegradation({
    cues: input.cues,
    evidence: cueTimeline,
    mode: input.globalTokenTimeline,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const lexical = enforceLexicalConservation({
    before: input.cues,
    proposed: timing.cues,
    mode: input.candidateConsensus,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const overlap = classifyOverlapEvents({
    cues: lexical.cues,
    mode: input.candidateConsensus,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  return {
    cues: lexical.cues,
    evidenceCues: consensus.cues,
    acousticEventFamilies: family.artifact,
    crossWindowConsensus: consensus.artifact,
    requestTimelineContract: input.requestTimelineContract,
    globalTokenTimeline: tokenTimeline,
    cueTimelineEvidence: cueTimeline,
    timingNonDegradation: timing.artifact,
    lexicalConservation: lexical.artifact,
    overlapEventClassification: overlap,
  };
}
