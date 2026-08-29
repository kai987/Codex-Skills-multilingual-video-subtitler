import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

let temporaryRoot: string;
let syntheticRoot: string;
let datasetRoot: string;

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function validateSynthetic() {
  return run("npm", [
    "exec",
    "--",
    "tsx",
    "scripts/validate-c6-0-1-12-runs.ts",
    "--synthetic-only",
    "--synthetic-root",
    syntheticRoot,
    "--dataset-root",
    datasetRoot,
  ]);
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mvl-c60112-synthetic-integrity-"),
  );
  syntheticRoot = path.join(temporaryRoot, "synthetic");
  datasetRoot = path.join(temporaryRoot, "dataset");
  const generated = run("npm", [
    "run",
    "review:synthetic-workflow",
    "--",
    "--output",
    syntheticRoot,
    "--dataset-output",
    datasetRoot,
  ]);
  if (generated.status !== 0) {
    throw new Error(`${generated.stdout}\n${generated.stderr}`);
  }
}, 30_000);

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("C6.0.1.12 synthetic workflow integrity", () => {
  it("accepts the real workspace/session/CLI apply nine-action closure", () => {
    const result = validateSynthetic();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout) as unknown).toMatchObject({
      passed: true,
      correctionCount: 9,
      auditCount: 9,
    });
  }, 20_000);

  it("rejects a forged self-reported validation artifact", async () => {
    const validationPath = path.join(
      syntheticRoot,
      "c6-0-1-12-synthetic-workflow-validation.json",
    );
    const original = await readFile(validationPath, "utf8");
    try {
      const value = JSON.parse(original) as {
        actionCoverage: Record<string, number>;
      };
      value.actionCoverage.MANUAL_EDIT = 2;
      await writeFile(validationPath, `${JSON.stringify(value, null, 2)}\n`);
      const result = validateSynthetic();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/action|validation|semantic/iu);
    } finally {
      await writeFile(validationPath, original);
    }
  }, 20_000);

  it("rejects an audit link that no longer backs the correction/session", async () => {
    const auditPath = path.join(syntheticRoot, "session", "review-audit.jsonl");
    const original = await readFile(auditPath, "utf8");
    try {
      const lines = original.trim().split(/\r?\n/u);
      const first = JSON.parse(lines[0] ?? "{}") as {
        newDecision: string | null;
      };
      first.newDecision = "correction-forged-link";
      lines[0] = JSON.stringify(first);
      await writeFile(auditPath, `${lines.join("\n")}\n`);
      const result = validateSynthetic();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/audit|session|correction/iu);
    } finally {
      await writeFile(auditPath, original);
    }
  }, 20_000);
});
