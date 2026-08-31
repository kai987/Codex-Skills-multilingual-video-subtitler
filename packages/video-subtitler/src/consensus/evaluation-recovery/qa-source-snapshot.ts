import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { hash } from "./c6121-policy.js";
/** Release reports and clocks are not executable input; all source, schemas,
 * tests, lockfiles, configs and the named skill are included in QA identity. */
export async function c6121QaSourceSnapshot(repository: string) {
  const all = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repository, encoding: "utf8" },
  );
  const paths = [...new Set(all.split("\0").filter(Boolean))]
    .filter((file) =>
      /^(?:packages\/|apps\/|scripts\/|tests\/|schemas\/|\.agents\/skills\/multilingual-video-subtitler\/|package(?:-lock)?\.json$|tsconfig|eslint\.config|vitest\.config)/.test(
        file,
      ),
    )
    .sort();
  const rows = await Promise.all(
    paths.map(async (relativePath) => ({
      relativePath,
      sha256: createHash("sha256")
        .update(await readFile(path.join(repository, relativePath)))
        .digest("hex"),
    })),
  );
  return { rows, semanticHash: hash(rows) };
}
