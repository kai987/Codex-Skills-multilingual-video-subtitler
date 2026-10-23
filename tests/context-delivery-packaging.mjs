import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("production script import closure is included in the runtime package allowlist", async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const packager = await fs.readFile(
    path.join(repo, "scripts/package-subtitle-tool.mjs"),
    "utf8",
  );
  const allowed = new Set(
    [...packager.matchAll(/"(scripts\/[^"\n]+\.mjs)"/gu)].map((m) => m[1]),
  );
  const visited = new Set();
  const visit = async (relative) => {
    if (visited.has(relative)) return;
    visited.add(relative);
    assert(allowed.has(relative), `NOT_PACKAGED:${relative}`);
    const source = await fs.readFile(path.join(repo, relative), "utf8");
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\()\s*["'](\.[^"']+\.mjs)["']/gu,
    )) {
      const child = path.posix.normalize(
        path.posix.join(path.posix.dirname(relative), match[1]),
      );
      if (child.startsWith("scripts/")) await visit(child);
    }
  };
  await visit("scripts/subtitle-tool.mjs");
  assert(visited.has("scripts/lib/seam-context-delivery.mjs"));
  assert(visited.has("scripts/lib/seam-context-text.mjs"));
  assert(
    ![...visited].some((p) =>
      /replay-frozen-candidates|replay-seam-context-text|subtitle-reference-comparison/u.test(
        p,
      ),
    ),
  );
});
