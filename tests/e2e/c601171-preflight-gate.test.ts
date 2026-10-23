import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
it("the real model CLI refuses failed preflight before attempting a provider", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c601171-gate-"));
  const m = {
    version: "c601171-generation-v1",
    frozenRepairHash: "a".repeat(64),
    units: [],
  };
  fs.mkdirSync(path.join(root, "dataset"));
  fs.writeFileSync(
    path.join(root, "dataset/generation-manifest.json"),
    JSON.stringify(m),
  );
  fs.writeFileSync(
    path.join(root, "dataset/model-gate.json"),
    JSON.stringify({
      status: "DATA_PREFLIGHT_FAILED",
      generationManifestHash: createHash("sha256")
        .update(JSON.stringify(m))
        .digest("hex"),
    }),
  );
  fs.writeFileSync(
    path.join(root, "frozen-repair-identity.json"),
    JSON.stringify({ code: {} }),
  );
  fs.writeFileSync(
    path.join(root, "model-input-freeze.json"),
    JSON.stringify({ files: {} }),
  );
  const r = spawnSync(
    process.execPath,
    ["scripts/run-c601171.mjs", "generate-primary", root],
    { encoding: "utf8" },
  );
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("DATA_PREFLIGHT_FAILED");
  expect(fs.existsSync(path.join(root, "attempts"))).toBe(false);
});
