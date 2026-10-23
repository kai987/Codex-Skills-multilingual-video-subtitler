import { describe, it, expect } from "vitest";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import {
  c601141CodeCheckIds,
  c601141CodeValidationSchema,
  c601141MachineCodeSnapshotSchema,
  c601141SafetySchema,
  c601141BrowserAuditSchema,
  compileJsonSchema,
  assertJsonSchema,
  c601141Schemas,
  c601141DeliverySchemas,
  c601141EvaluationSchemas,
  c601141AcceptanceSchemas,
} from "@mvl/shared";
import { fixture141 } from "./fixtures/c601141-fixture.js";
import { auditShareable141 } from "../scripts/lib/c601141-shareable-audit.js";
import { assertValidationOnlyDelta141 } from "../scripts/lib/c601141-validation-remediation.js";

const hash = "a".repeat(64);
describe("C601141 strict acceptance and privacy boundaries", () => {
  it("rejects post-freeze runtime changes and unaudited validation changes", () => {
    const file = "schemas/c6-0-1-14-1-policy.schema.json",
      next = "b".repeat(64);
    const before = [{ relativePath: file, sha256: hash }],
      after = [{ relativePath: file, sha256: next }],
      receipt = [{ relativePath: file, beforeSha256: hash, afterSha256: next }];
    expect(assertValidationOnlyDelta141(before, after, receipt)).toEqual(
      receipt,
    );
    expect(() => assertValidationOnlyDelta141(before, after, [])).toThrow();
    const runtime = "packages/video-subtitler/src/review/c601141-policy.ts";
    expect(() =>
      assertValidationOnlyDelta141(
        [{ relativePath: runtime, sha256: hash }],
        [{ relativePath: runtime, sha256: next }],
        [{ relativePath: runtime, beforeSha256: hash, afterSha256: next }],
      ),
    ).toThrow();
  });
  it("strictly compiles every emitted schema and preserves the closed provider tuple", async () => {
    const names = Object.keys({
      ...c601141Schemas,
      ...c601141DeliverySchemas,
      ...c601141EvaluationSchemas,
      ...c601141AcceptanceSchemas,
    });
    for (const name of names) {
      const schema = JSON.parse(
        await readFile(
          new URL(`../schemas/${name}.schema.json`, import.meta.url),
          "utf8",
        ),
      ) as object;
      const validate = compileJsonSchema(schema);
      if (name === "c6-0-1-14-1-policy") {
        const policy = fixture141().policy;
        expect(() => assertJsonSchema(validate, policy)).not.toThrow();
        for (const providers of [
          [],
          ["whisper-large-v3"],
          ["reazonspeech-k2-v2", "whisper-large-v3"],
          [...policy.asr.providers, "unexpected-provider"],
        ])
          expect(() =>
            assertJsonSchema(validate, {
              ...policy,
              asr: { ...policy.asr, providers },
            }),
          ).toThrow();
      }
    }
    expect(names).toHaveLength(31);
  });
  it("requires every real code/setup check, not a short or duplicated success list", () => {
    const results = c601141CodeCheckIds.map((id) => ({
      id,
      command: ["node", "synthetic"],
      exitCode: 0,
      passed: true,
      elapsedSeconds: 1,
      logRelativePath: `${id}.log`,
      logSha256: hash,
      testSummary: [],
    }));
    const value = {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-1-code-validation",
      generatedAt: "2026-01-01T00:00:00.000Z",
      nodeVersion: "v24.0.0",
      packageManager: "npm@11.0.0",
      results,
      passed: true,
      realAsrExecutedByValidation: false,
      goldEvaluationExecutedByValidation: false,
      rankerTrainingExecutedByValidation: false,
    };
    expect(c601141CodeValidationSchema.safeParse(value).success).toBe(true);
    expect(
      c601141CodeValidationSchema.safeParse({
        ...value,
        results: results.slice(1),
      }).success,
    ).toBe(false);
    expect(
      c601141CodeValidationSchema.safeParse({
        ...value,
        results: results.map((r) => ({ ...r, id: "unit" })),
      }).success,
    ).toBe(false);
    expect(
      c601141CodeValidationSchema.safeParse({
        ...value,
        results: results.map((r) => ({ ...r, exitCode: 1 })),
      }).success,
    ).toBe(false);
  });
  it("enforces additionalProperties=false through generated JSON Schema as well as Zod", () => {
    const value = fixture141().safety;
    const validate = compileJsonSchema(z.toJSONSchema(c601141SafetySchema));
    expect(() => assertJsonSchema(validate, value)).not.toThrow();
    expect(() =>
      assertJsonSchema(validate, {
        ...value,
        goldText: "synthetic forbidden field",
      }),
    ).toThrow();
  });
  it("requires relative code snapshot entries and rejects extra local credentials", () => {
    const value = {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-1-machine-code-snapshot",
      files: [{ relativePath: "packages/synthetic.ts", sha256: hash }],
      semanticHash: hash,
    };
    expect(c601141MachineCodeSnapshotSchema.safeParse(value).success).toBe(
      true,
    );
    expect(
      c601141MachineCodeSnapshotSchema.safeParse({
        ...value,
        files: [{ relativePath: "../outside", sha256: hash }],
      }).success,
    ).toBe(false);
    expect(
      c601141MachineCodeSnapshotSchema.safeParse({
        ...value,
        token: "not allowed",
      }).success,
    ).toBe(false);
  });
  it("does not turn a failed browser check or created session into a pass", () => {
    const value = {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-1-browser-read-only-acceptance",
      visibility: "LOCAL_ONLY",
      checkedAt: "2026-01-01T00:00:00.000Z",
      workspaceDataByteHash: hash,
      workspaceJavascriptByteHash: hash,
      checks: [{ id: "synthetic", passed: false, detail: "failure" }],
      consoleErrorCount: 0,
      sessionBefore: null,
      sessionAfter: null,
      savedHumanDecisionCount: 0,
      humanTrialStarted: false,
      passed: true,
    };
    expect(c601141BrowserAuditSchema.safeParse(value).success).toBe(false);
    expect(
      c601141BrowserAuditSchema.safeParse({
        ...value,
        checks: [{ id: "synthetic", passed: true, detail: "" }],
        sessionAfter: {},
      }).success,
    ).toBe(false);
  });
  it("detects absolute paths, credential patterns, dialogue and source-time data in a purported public aggregate", () => {
    const result = auditShareable141({
      path: "/Users/synthetic/private",
      token: `hf_${"x".repeat(25)}`,
      candidateText: "synthetic",
      sourceInterval: { start: 1, end: 2 },
    });
    expect(result.passed).toBe(false);
    expect(result.absolutePathLeakCount).toBe(1);
    expect(result.secretPatternCount).toBe(1);
    expect(result.rawDialogueOrAudioFieldCount).toBe(1);
    expect(result.sourceOrGoldIntervalFieldCount).toBe(1);
  });
});
