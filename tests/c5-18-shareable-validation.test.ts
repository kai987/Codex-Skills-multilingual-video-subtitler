import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  c5161ShareableExecutionSummarySchema,
  c518FreshCacheObserveValidationSchema,
  shareableArtifactManifestSchema,
} from "@mvl/shared";
import {
  appendC518ValidationToShareable,
  auditC5161ShareableArtifacts,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const generatedAt = "2026-08-26T00:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("C5.18 post-validation shareable materialization", () => {
  it("adds the strict validation artifact and refreshes execution and manifest identities", async () => {
    const taskRoot = await mkdtemp(path.join(tmpdir(), "mvl-c518-shareable-"));
    temporaryDirectories.push(taskRoot);
    const shareable = path.join(taskRoot, "shareable");
    await mkdir(shareable);

    const execution = c5161ShareableExecutionSummarySchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "c5-16-1-shareable-execution-summary",
      generatedAt,
      taskIdentityHash: HASH,
      pathPolicy: "shareable-relative-only",
      shareable: true,
      localOnlySource: {
        fileName: "c5-18-speaker-evidence-replay-summary.json",
        sha256: HASH,
        path: null,
      },
      internalArtifacts: [],
      externalFiles: [],
      execution: {},
      outcome: {},
    });
    const executionText = `${JSON.stringify(execution, null, 2)}\n`;
    await writeFile(
      path.join(shareable, "execution-summary.json"),
      executionText,
    );
    const manifest = shareableArtifactManifestSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "shareable-artifact-manifest",
      policyVersion: "c5.18-shareable-artifact-policy-v1",
      generatedAt,
      taskIdentityHash: HASH,
      pathPolicy: "shareable-relative-only",
      shareable: true,
      items: [
        {
          sourceArtifactName: "c5-18-speaker-evidence-replay-summary.json",
          sourceArtifactHash: HASH,
          shareablePath: "shareable/execution-summary.json",
          shareableHash: sha256(executionText),
          schemaName: "execution-summary.schema.json",
          pathReplacementCount: 0,
          secretRedactionCount: 0,
          absolutePathLeakCount: 0,
          prohibitedSecretCount: 0,
          validationPassed: true,
        },
      ],
      summary: {
        artifactCount: 1,
        validationPassedCount: 1,
        absolutePathLeakCount: 0,
        prohibitedSecretCount: 0,
        pathReplacementCount: 0,
        secretRedactionCount: 0,
      },
    });
    await writeFile(
      path.join(shareable, "shareable-artifact-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const validation = c518FreshCacheObserveValidationSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "c5-18-fresh-cache-observe-validation",
      validationVersion: "C5.18",
      generatedAt,
      freshRunId: "fresh",
      observeRunId: "observe",
      cacheReplayRunId: "cache",
      freshSpeakerEvidenceSemanticHash: HASH,
      observeSpeakerEvidenceSemanticHash: HASH,
      cacheSpeakerEvidenceSemanticHash: HASH,
      freshComponentDecisionHash: HASH,
      observeComponentDecisionHash: HASH,
      cacheComponentDecisionHash: HASH,
      freshMutationHash: HASH,
      observeMutationHash: HASH,
      cacheMutationHash: HASH,
      freshOutputCueHash: HASH,
      observeOutputCueHash: HASH,
      cacheOutputCueHash: HASH,
      freshInferenceCount: 14,
      observeInferenceCount: 14,
      cacheHitCount: 14,
      cacheInferenceCount: 0,
      cacheModelLoadCount: 0,
      observeTimingMutationCount: 0,
      speakerEvidenceSemanticParity: true,
      componentDecisionParity: true,
      mutationParity: true,
      outputCueParity: true,
      validationPassed: true,
      semanticHash: HASH,
    });
    const validationPath = path.join(
      taskRoot,
      "c5-18-fresh-cache-observe-validation.json",
    );
    await writeFile(validationPath, `${JSON.stringify(validation, null, 2)}\n`);

    const result = await appendC518ValidationToShareable({
      taskRoot,
      validationPath,
    });
    expect(result.validationPassed).toBe(true);
    expect(result.manifest.summary).toMatchObject({
      artifactCount: 2,
      validationPassedCount: 2,
      absolutePathLeakCount: 0,
      prohibitedSecretCount: 0,
    });
    expect(result.manifest.taskIdentityHash).not.toBe(HASH);
    const updatedExecution = c5161ShareableExecutionSummarySchema.parse(
      JSON.parse(
        await readFile(path.join(shareable, "execution-summary.json"), "utf8"),
      ) as unknown,
    );
    expect(updatedExecution.taskIdentityHash).toBe(
      result.manifest.taskIdentityHash,
    );
    expect(updatedExecution.internalArtifacts).toContain(
      "c5-18-fresh-cache-observe-validation.json",
    );
    expect(await auditC5161ShareableArtifacts(shareable)).toMatchObject({
      validationPassed: true,
    });
  });
});
