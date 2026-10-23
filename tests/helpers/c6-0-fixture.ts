import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CUE_HASH =
  "8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83";
const TIMING_HASH =
  "510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02";
const COMPONENT_IDS = [
  "overlap-acoustic-def4f9e5f20a6a24af59",
  "overlap-acoustic-5e6df4ca8c77b3a51802",
  "overlap-acoustic-de9815d25ae4c3a8e718",
  "overlap-acoustic-8ff7342e69430b941161",
  "overlap-acoustic-5475b241d7d856b45194",
  "overlap-acoustic-eef08480bdcbc8f48776",
  "overlap-acoustic-69e8f46141f7d9276a87",
] as const;
const CUE_NUMBERS = [
  [19, 20],
  [88, 89],
  [97, 98],
  [140, 141, 142],
  [145, 146],
  [163, 164],
  [174, 175, 176],
] as const;

function cueId(value: number): string {
  return `human-reviewed-${String(value).padStart(4, "0")}-fixture`;
}

async function json(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function createC60Fixture(root: string): Promise<{
  repoRoot: string;
  taskRoot: string;
  causalRoot: string;
  frozenRoot: string;
}> {
  const repoRoot = path.join(root, "repo");
  const taskRoot = path.join(root, "task");
  const causalRoot = path.join(root, "causal");
  const frozenRoot = path.join(root, "frozen");
  await mkdir(path.join(repoRoot, "packages", "fixture", "src"), {
    recursive: true,
  });
  await mkdir(taskRoot, { recursive: true });
  await writeFile(
    path.join(repoRoot, "packages", "fixture", "src", "finalization.ts"),
    [
      "export function fixtureFinalization() {",
      '  return ["FORCED_ALIGNMENT_COMPONENT_UNRESOLVED", "ILLEGAL_SUBTITLE_OVERLAP", "CTC_TARGET_UNREPRESENTABLE", "INVALID_CUE_TIMING"];',
      "}",
      "",
    ].join("\n"),
  );
  const items = COMPONENT_IDS.map((componentId, index) => {
    const cueIds = CUE_NUMBERS[index]?.map(cueId) ?? [];
    const start = 10 + index * 10;
    return {
      reviewId: `review-${index + 1}`,
      targetCueIds: cueIds,
      interval: { start, end: start + 4 },
      currentText: cueIds.map((id) => `text-${id}`).join("\n"),
      speakerEvidenceComponentId: componentId,
      blockers: [
        "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
        "ILLEGAL_SUBTITLE_OVERLAP",
        "CTC_START_WINDOW_UNSTABLE",
        ...(index === 3 ? ["CTC_TARGET_UNREPRESENTABLE"] : []),
      ],
      boundaryEvidence: [
        {
          evidenceId: `evidence-${index + 1}`,
          evidenceLineageId: `lineage-${index + 1}`,
          blockers: ["NEIGHBOR_INTRUSION"],
        },
      ],
    };
  });
  const findings = COMPONENT_IDS.flatMap((componentId, index) => {
    const cueIds = CUE_NUMBERS[index]?.map(cueId) ?? [];
    return [
      {
        findingId: `forced-${componentId}`,
        severity: "blocking",
        code: "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
        cueIds,
        message: "No safe forced-alignment repair established.",
      },
      {
        findingId: `overlap-${componentId}`,
        severity: "blocking",
        code: "ILLEGAL_SUBTITLE_OVERLAP",
        cueIds,
        message: "Overlap remains unresolved.",
      },
    ];
  });
  const finalization = {
    schemaVersion: "1.0.0",
    status: "needs-review",
    finalizationMethod: "none",
    outputCueHash: CUE_HASH,
    baseCueHash: CUE_HASH,
    findings,
    metrics: {
      blockingFindingCount: 14,
      reviewItemCount: 7,
      reviewAudioPlayableCount: 7,
    },
    humanReviewedBaseline: {
      authority: "user-confirmed-human-review",
      sourceReadOnlyVerified: true,
      cueHash: CUE_HASH,
    },
  };
  const review = {
    schemaVersion: "1.0.0",
    summary: { itemCount: 7 },
    items,
  };
  const components = COMPONENT_IDS.map((componentId, index) => ({
    componentId,
    resolutionStatus: index === 2 ? "resolved" : "unresolved",
    safeAutomaticAction: "none",
    timingActionable: false,
    blockers:
      index === 2
        ? ["SPEAKER_RELATIONSHIP_NOT_TIMING_ACTIONABLE"]
        : ["SPEAKER_WINDOW_UNSTABLE"],
    evidenceLineageId: `component-lineage-${index + 1}`,
  }));
  const canonicalCues = CUE_NUMBERS.flatMap((numbers, componentIndex) =>
    numbers.map((value, cueIndex) => {
      const start = 10 + componentIndex * 10 + cueIndex * 1.5;
      return {
        id: cueId(value),
        start,
        end: start + 2,
        text: `text-${value}`,
      };
    }),
  );
  const basicComponentArtifact = {
    schemaVersion: "1.0.0",
    components,
  };
  await json(
    path.join(taskRoot, "subtitle-finalization-report.json"),
    finalization,
  );
  await json(path.join(taskRoot, "subtitle-review-package.json"), review);
  await json(
    path.join(taskRoot, "subtitle-canonical-forced-alignment.json"),
    basicComponentArtifact,
  );
  await json(path.join(taskRoot, "subtitle-local-ctc-boundary-evidence.json"), {
    ...basicComponentArtifact,
    baseTimingHash: TIMING_HASH,
  });
  await json(path.join(taskRoot, "subtitle-local-speaker-evidence.json"), {
    ...basicComponentArtifact,
    summary: { resolvedComponentCount: 1 },
  });
  await json(
    path.join(taskRoot, "subtitle-local-separated-stream-evidence.json"),
    basicComponentArtifact,
  );
  await json(
    path.join(taskRoot, "subtitle-overlap-acoustic-resolution.json"),
    basicComponentArtifact,
  );
  await json(path.join(taskRoot, "subtitle-presentation-resolution.json"), {
    ...basicComponentArtifact,
    semanticHash: "d".repeat(64),
  });
  await json(
    path.join(taskRoot, "subtitle-timestamp-evidence-integrity.json"),
    basicComponentArtifact,
  );
  await json(path.join(taskRoot, "memory-assisted-ctc-target-audit.json"), {
    schemaVersion: "1.0.0",
    cues: [
      {
        cueId: cueId(140),
        beforeEncodable: false,
        afterProjectionEncodable: true,
        canonicalTextChanged: false,
      },
      {
        cueId: cueId(142),
        beforeEncodable: false,
        afterProjectionEncodable: true,
        canonicalTextChanged: false,
      },
    ],
  });
  await json(path.join(taskRoot, "subtitle-review-delivery-integrity.json"), {
    passed: true,
  });
  await json(path.join(taskRoot, "subtitle-package.human-reviewed-base.json"), {
    cues: canonicalCues,
  });
  await cp(taskRoot, causalRoot, { recursive: true });
  await cp(taskRoot, frozenRoot, { recursive: true });
  return { repoRoot, taskRoot, causalRoot, frozenRoot };
}
