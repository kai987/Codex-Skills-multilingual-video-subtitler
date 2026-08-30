import { mkdtemp, writeFile, mkdir, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import {
  C611_CALIBRATION_FEATURE_NAMES,
  type C611CalibrationSample,
  type C611CalibrationLabel,
  type C611FixedAlignmentEvaluation,
} from "@mvl/shared";
import {
  C611_REGRESSION_STAGES,
  c611RegressionEvidenceSchema,
} from "../packages/shared/src/c6-1-1-validation-schemas.js";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { c61FileHash } from "../packages/video-subtitler/src/consensus/c61-artifact-io.js";
import { c61Require } from "../packages/video-subtitler/src/consensus/japanese-text-representation.js";
import { freezeC611CalibrationPolicy } from "../packages/video-subtitler/src/consensus/selective-mbr-calibration.js";
import { buildC611Folds } from "../packages/video-subtitler/src/consensus/selective-mbr-folds.js";
import { runC611Oof } from "../packages/video-subtitler/src/consensus/selective-mbr-oof.js";
import { buildC611FixedBaselineAlignmentMap } from "../packages/video-subtitler/src/consensus/fixed-baseline-alignment-map.js";
import { evaluateC611FixedAlignment } from "../packages/video-subtitler/src/consensus/fixed-alignment-paired-evaluator.js";
import {
  parseC611VitestCounts,
  resolveC611ArtifactFile,
  validateC611Artifacts,
  validateC611FixedArithmetic,
  validateC611OofIsolation,
  validateC611RegressionEvidence,
  validateC611ShareablePrivacy,
  validateC611StrictTree,
  verifyC611SelfHash,
} from "../packages/video-subtitler/src/consensus/selective-mbr-artifact-validator.js";

const header = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.1.1-fixed-alignment-selective-existing-mbr-v1" as const,
};
function rehash<T extends { semanticHash: string }>(value: T): T {
  const { semanticHash, ...body } = value;
  void semanticHash;
  return { ...body, semanticHash: hash(body) } as T;
}
function fixed(): C611FixedAlignmentEvaluation {
  const baselineCues = [
    { id: "m1", start: 0, end: 2, text: "赤い空" },
    { id: "m2", start: 5, end: 7, text: "ありがとう" },
  ];
  const goldCues = [
    { id: "g1", start: 0, end: 2, text: "青い空" },
    { id: "g2", start: 5, end: 7, text: "ありがとう" },
  ];
  const map = buildC611FixedBaselineAlignmentMap({
    baselineCues,
    goldCues,
    eventBindings: [
      { eventId: "e1", finalCueIds: ["m1"] },
      { eventId: "e2", finalCueIds: ["m2"] },
    ],
    barrier: {
      machineFreezeHash: hash("synthetic"),
      machineFrozenAt: "2026-01-01T00:00:00.000Z",
      goldFirstReadAt: "2026-01-01T00:00:01.000Z",
    },
  });
  return evaluateC611FixedAlignment({
    map,
    baselineCues,
    goldCues,
    shadowCues: [
      { ...c61Require(baselineCues[0]), text: "青い空" },
      c61Require(baselineCues[1]),
    ],
    profileId: "S3",
  });
}
function oofFixture() {
  const policy = freezeC611CalibrationPolicy();
  const samples: C611CalibrationSample[] = Array.from(
    { length: 15 },
    (_, i) => ({
      proposalId: `p${i}`,
      eventId: `e${i}`,
      currentCandidateId: `current${i}`,
      proposedCandidateId: `candidate${i}`,
      eligibilityStatus: "ELIGIBLE",
      values: Object.fromEntries(
        C611_CALIBRATION_FEATURE_NAMES.map((key) => [
          key,
          key === "rawMbrMargin" || key === "hierarchicalMbrMargin"
            ? i % 2
              ? 0.1
              : 0.9
            : 0,
        ]),
      ),
      missingFlags: Object.fromEntries(
        C611_CALIBRATION_FEATURE_NAMES.map((key) => [key, false]),
      ),
      proposalHash: hash(["proposal", i]),
      featureHash: hash(["features", i]),
    }),
  );
  const labels: C611CalibrationLabel[] = samples.map((s, i) => {
    const body = {
      proposalId: s.proposalId,
      eventId: s.eventId,
      groupIds: [`g${i}`],
      groupIdentityHash: hash(i),
      outcome:
        i % 2 ? ("SWITCH_REGRESSES" as const) : ("SWITCH_IMPROVES" as const),
      baselineError: 3,
      proposedError: i % 2 ? 4 : 2,
      exactGain: i % 2 ? -1 : 1,
      normalizedGain: i % 2 ? -1 : 1,
    };
    return { ...body, semanticHash: hash(body) };
  });
  const folds = buildC611Folds(
    samples.map((s, i) => ({
      eventId: s.eventId,
      proposalId: s.proposalId,
      sourceAudioIdentity: hash("synthetic-audio"),
      sourceInterval: { start: i * 10, end: i * 10 + 2 },
      acousticIntervals: [],
      cueIntervals: [],
      finalCueIds: [`cue${i}`],
      sharedSpanKeys: [],
    })),
    policy,
  );
  const result = runC611Oof({
    samples,
    labels,
    folds,
    policy,
    legacy: {
      samples,
      labels,
      selectedProposalIds: samples.map((s) => s.proposalId),
    },
  });
  return { result, folds };
}
async function regressionFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "c611-qa-synthetic-"));
  await mkdir(path.join(root, "logs"));
  const checks = await Promise.all(
    C611_REGRESSION_STAGES.map(async (stage, i) => {
      const tests = ["unit", "e2e", "targeted"].includes(stage)
        ? { passed: 12, failed: 0, skipped: stage === "unit" ? 2 : 0 }
        : null;
      const logRelativePath = `logs/${i}.log`,
        text = tests
          ? `SYNTHETIC FIXTURE NOT REAL QA\n Tests  ${tests.passed} passed${tests.skipped ? ` | ${tests.skipped} skipped` : ""} (14)\n`
          : `SYNTHETIC FIXTURE NOT REAL QA\n${stage} succeeded\n`;
      await writeFile(path.join(root, logRelativePath), text);
      return {
        stage,
        command: `synthetic ${stage}`,
        exitCode: 0,
        durationMs: 1,
        logRelativePath,
        logSha256: await c61FileHash(path.join(root, logRelativePath)),
        tests,
        skipReasons: tests?.skipped
          ? ["Synthetic opt-in model fixtures disabled; no inference"]
          : [],
      };
    }),
  );
  const body = {
    ...header,
    artifactType: "c6-1-1-regression-evidence" as const,
    sourceCodeAggregateHash: hash("synthetic-source"),
    checks,
    freshModelInferenceAllowed: false as const,
    sourceUnchangedDuringChecks: true as const,
  };
  const evidence = c611RegressionEvidenceSchema.parse({
      ...body,
      semanticHash: hash(body),
    }),
    file = path.join(root, "qa.json");
  await writeFile(file, JSON.stringify(evidence));
  return { root, file, evidence };
}

describe("C6.1.1 independent artifact acceptance", () => {
  test("accepts fixed unique-group arithmetic without reading any Gold file", () =>
    expect(() => validateC611FixedArithmetic(fixed())).not.toThrow());
  test("rejects honest-self-hashed fabricated aggregate gain", () => {
    const value = fixed();
    value.summary.normalizedGain++;
    expect(() => validateC611FixedArithmetic(rehash(value))).toThrow(
      "SUMMARY_ARITHMETIC",
    );
  });
  test("rejects duplicate fixed group counting", () => {
    const value = fixed();
    value.groups.push(c61Require(value.groups[0]));
    expect(() => validateC611FixedArithmetic(rehash(value))).toThrow(
      "DUPLICATED_FIXED_GROUP",
    );
  });
  test("rejects self-hashed group outcome contradicting edit gains", () => {
    const value = fixed();
    value.groups[0] = rehash({
      ...c61Require(value.groups[0]),
      outcome: "REGRESSED",
    });
    expect(() => validateC611FixedArithmetic(rehash(value))).toThrow(
      "OUTCOME_MISMATCH",
    );
  });
  test("rejects unevaluable groups retaining zero instead of null evidence", () => {
    const value = fixed();
    value.groups[0] = rehash({
      ...c61Require(value.groups[0]),
      outcome: "UNEVALUABLE",
    });
    expect(() => validateC611FixedArithmetic(rehash(value))).toThrow(
      "UNEVALUABLE_GROUP_HAS_ERROR",
    );
  });
  test("accepts exact outer/inner split membership and model provenance", () => {
    const { result, folds } = oofFixture();
    expect(() => validateC611OofIsolation(result, folds)).not.toThrow();
  });
  test("detects test IDs leaked into self-hashed model even if audit claims zero leakage", () => {
    const { result, folds } = oofFixture();
    const index = result.calibrationAudits.findIndex(
      (a) => a.profileId === "S6",
    );
    const audit = c61Require(result.calibrationAudits[index]);
    audit.model = rehash({
      ...audit.model,
      trainingProposalIds: [
        ...audit.model.trainingProposalIds,
        c61Require(audit.outerTestProposalIds[0]),
      ],
    });
    result.calibrationAudits[index] = rehash(audit);
    expect(() => validateC611OofIsolation(result, folds)).toThrow(
      "OUTER_MODEL_TEST_LEAKAGE",
    );
  });
  test("rejects absent OOF prediction rows", () => {
    const { result, folds } = oofFixture();
    result.decisions.pop();
    expect(() => validateC611OofIsolation(result, folds)).toThrow(
      "OOF_TEST_UNIVERSE_INCOMPLETE",
    );
  });
  test("parses final Vitest total, keeping skipped tests explicit", () => {
    expect(
      parseC611VitestCounts(
        "\x1b[32m Tests  936 passed | 2 skipped (938)\x1b[0m\n",
      ),
    ).toEqual({ passed: 936, failed: 0, skipped: 2 });
    expect(parseC611VitestCounts("no test summary")).toBeNull();
  });
  test("accepts all nine synthetic QA stages with verifiable log hashes", async () => {
    const f = await regressionFixture();
    expect(
      await validateC611RegressionEvidence(f.file, hash("synthetic-source")),
    ).toEqual(f.evidence);
  });
  test("rejects forged QA counts despite self-hashed manifest", async () => {
    const f = await regressionFixture();
    c61Require(
      c61Require(f.evidence.checks.find((c) => c.stage === "unit")).tests,
    ).passed++;
    await writeFile(f.file, JSON.stringify(rehash(f.evidence)));
    await expect(
      validateC611RegressionEvidence(f.file, hash("synthetic-source")),
    ).rejects.toThrow("REPORTED_TEST_COUNTS");
  });
  test("rejects unexplained skipped tests", async () => {
    const f = await regressionFixture();
    c61Require(f.evidence.checks.find((c) => c.stage === "unit")).skipReasons =
      [];
    await writeFile(f.file, JSON.stringify(rehash(f.evidence)));
    await expect(
      validateC611RegressionEvidence(f.file, hash("synthetic-source")),
    ).rejects.toThrow("UNEXPLAINED_SKIPS");
  });
  test("rejects changed QA logs", async () => {
    const f = await regressionFixture();
    await writeFile(
      path.join(f.root, c61Require(f.evidence.checks[0]).logRelativePath),
      "altered",
    );
    await expect(
      validateC611RegressionEvidence(f.file, hash("synthetic-source")),
    ).rejects.toThrow("LOG_HASH_MISMATCH");
  });
  test("rejects duplicate QA stage replacing a mandatory one", async () => {
    const f = await regressionFixture();
    c61Require(f.evidence.checks[1]).stage = c61Require(
      f.evidence.checks[0],
    ).stage;
    await writeFile(f.file, JSON.stringify(rehash(f.evidence)));
    await expect(
      validateC611RegressionEvidence(f.file, hash("synthetic-source")),
    ).rejects.toThrow("STAGE_COVERAGE");
  });
  test("rejects QA evidence for another source snapshot", async () => {
    const f = await regressionFixture();
    await expect(
      validateC611RegressionEvidence(f.file, hash("other-source")),
    ).rejects.toThrow("QA_SOURCE_HASH_MISMATCH");
  });
  test("rejects traversal and symlink escapes without opening their content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c611-path-synthetic-"));
    await writeFile(path.join(root, "allowed.json"), "{}");
    await symlink(
      path.join(root, "allowed.json"),
      path.join(root, "linked.json"),
    );
    await expect(
      resolveC611ArtifactFile(root, "../private.json"),
    ).rejects.toThrow("UNSAFE_ARTIFACT_REFERENCE");
    await expect(resolveC611ArtifactFile(root, "linked.json")).rejects.toThrow(
      "SYMLINK_ARTIFACT_REJECTED",
    );
  });
  test("strict tree validates registered policy and rejects unknown extra JSON", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c611-schema-synthetic-"));
    await writeFile(
      path.join(root, "policy.json"),
      JSON.stringify(freezeC611CalibrationPolicy()),
    );
    expect(await validateC611StrictTree(root)).toBe(1);
    await writeFile(
      path.join(root, "unregistered.json"),
      JSON.stringify({ artifactType: "unregistered" }),
    );
    await expect(validateC611StrictTree(root)).rejects.toThrow(
      "UNREGISTERED_ARTIFACT",
    );
  });
  test("self-hash is independently required even on parseable artifact", () => {
    const p = freezeC611CalibrationPolicy();
    p.neighborGapSeconds = 1;
    expect(() => verifyC611SelfHash(p)).toThrow("INVALID_SELF_HASH");
  });
  test("missing artifact roots yield FAILED, never invented zero-error acceptance", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c611-absent-synthetic-"));
    const result = await validateC611Artifacts({
      a: path.join(root, "a"),
      b: path.join(root, "b"),
      repository: path.join(root, "repo"),
    });
    expect(result.engineeringPassed).toBe(false);
    expect(result.sourceReadOnly).toBe(false);
    expect(result.regressionEvidenceHash).toBeNull();
    expect(result.qualityGateStatus).toBe(
      "UNAVAILABLE_INVALID_OR_MISSING_ARTIFACTS",
    );
    expect(result.validatorRawSourceRechecked).toBe(false);
    expect(result.validatorRawGoldRechecked).toBe(false);
  });
  test("CLI refuses existing output directory before touching input trees", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c611-cli-synthetic-"));
    const marker = path.join(root, "existing.txt");
    await writeFile(marker, "preserve");
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          path.resolve("node_modules/tsx/dist/cli.mjs"),
          "--tsconfig",
          "tsconfig.base.json",
          "scripts/validate-c6-1-1-selective-mbr.ts",
          "--a",
          path.join(root, "a"),
          "--b",
          path.join(root, "b"),
          "--repository",
          process.cwd(),
          "--output",
          root,
          "--network",
          "off",
        ],
        { cwd: process.cwd(), timeout: 30000 },
      ),
    ).rejects.toThrow();
    expect(await readFile(marker, "utf8")).toBe("preserve");
  });
  test("shareable schema rejects text fields, not just obvious secrets", () =>
    expect(() =>
      validateC611ShareablePrivacy({
        artifactType: "c6-1-1-shareable-summary",
        rawGoldText: "must never be shared",
      }),
    ).toThrow());
});
