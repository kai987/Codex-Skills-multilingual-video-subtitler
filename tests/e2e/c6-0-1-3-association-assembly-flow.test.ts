import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  machineCandidateAssociationLedgerSchema,
  machineCanonicalAssemblySchema,
  machineTimelineTransformChainSchema,
} from "@mvl/shared";
import { resolveCompetingHypotheses } from "@mvl/transcription-core";
import {
  buildAcousticEventFamilies,
  buildGlobalTokenTimeline,
  runCandidateAssociationAssembly,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  baselineCue,
  noVadCue,
  requestContract,
  vadCue,
} from "../helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.3 association/assembly artifact flow", () => {
  it("round-trips strict artifacts while preserving machine-only semantics", async () => {
    const cues = [baselineCue, noVadCue, vadCue];
    const hypothesis = resolveCompetingHypotheses({
      cues,
      evidenceCues: cues,
      mode: "top-score",
    });
    const families = buildAcousticEventFamilies({
      cues,
      mode: "enforce",
      sourceMediaSha256: requestContract.requests[0]?.sourceMediaSha256 ?? null,
      generatedAt: "2026-08-28T00:00:00.000Z",
    }).artifact;
    const result = runCandidateAssociationAssembly({
      atoms: hypothesis.atomization.atoms,
      atomicClusters: hypothesis.atomicClusters,
      candidateEvidence: hypothesis.candidateEvidence,
      topScoreResolution: hypothesis.topScoreResolution,
      winnerCues: hypothesis.cues,
      acousticEventFamilies: families,
      globalTokenTimeline: buildGlobalTokenTimeline({
        cues,
        requestContract,
        mode: "enforce",
        generatedAt: "2026-08-28T00:00:00.000Z",
      }),
      requestTimelineContract: requestContract,
      candidateAssociation: "enforce",
      canonicalAssembly: "enforce",
      timelineTransformChain: "enforce",
      generatedAt: "2026-08-28T00:00:00.000Z",
    });
    const root = await mkdtemp(path.join(tmpdir(), "c6-0-1-3-flow-"));
    const entries = [
      [
        "machine-candidate-association-ledger.json",
        result.candidateAssociationLedger,
        machineCandidateAssociationLedgerSchema,
      ],
      [
        "machine-canonical-assembly.json",
        result.canonicalAssembly,
        machineCanonicalAssemblySchema,
      ],
      [
        "machine-timeline-transform-chain.json",
        result.timelineTransformChain,
        machineTimelineTransformChainSchema,
      ],
    ] as const;
    for (const [fileName, artifact, schema] of entries) {
      const target = path.join(root, fileName);
      await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      const replayed: unknown = JSON.parse(await readFile(target, "utf8"));
      expect(schema.safeParse(replayed).success).toBe(true);
    }
    expect(result.canonicalNonDegradation.summary).toMatchObject({
      unsupportedStrongTextDeletionCount: 0,
      unsupportedMergeCount: 0,
      unsupportedTimeExpansionCount: 0,
      runtimeNonDegradationPassed: true,
    });
  });
});
