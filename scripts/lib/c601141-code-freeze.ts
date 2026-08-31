import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { c601141MachineCodeSnapshotSchema } from "@mvl/shared";
import {
  fileHash141,
  readJson141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hashed141,
  hash141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

/** Hash source, tests, schemas and dependency contracts, never generated model
 * outputs or runtime binaries. Documentation can record post-freeze results. */
export async function machineCodeSnapshot141(root: string) {
  const { stdout } = await promisify(execFile)(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
  const paths = [
    ...new Set(
      stdout
        .split("\0")
        .filter((file) => /\.(?:ts|tsx|py|json|lock|yaml|yml)$/u.test(file)),
    ),
  ].sort();
  const files = [];
  for (const file of paths)
    files.push({
      relativePath: file,
      sha256: await fileHash141(path.join(root, file)),
    });
  return c601141MachineCodeSnapshotSchema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-1-machine-code-snapshot",
      files,
    }),
  );
}
export async function verifyMachineCode141(root: string, snapshotPath: string) {
  const current = await machineCodeSnapshot141(root),
    frozen = c601141MachineCodeSnapshotSchema.parse(
      await readJson141(snapshotPath),
    );
  if (hash141(current) !== hash141(frozen))
    throw new Error("C601141_MACHINE_CODE_CHANGED_AFTER_FINAL_FREEZE");
  return current;
}
