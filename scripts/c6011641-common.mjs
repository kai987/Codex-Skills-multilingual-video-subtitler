import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
export {
  read,
  write,
  hashFile,
  objectHash,
  walk,
  checkFiles,
  repo,
  wavInfo,
} from "./c601164-common.mjs";
import {
  read,
  write,
  hashFile,
  walk,
  checkFiles,
  repo,
} from "./c601164-common.mjs";
export const variants = [
  "U0-previous-T2",
  "U1-original-window-boundary",
  "U2-extended-window-boundary",
  "U2-application-disabled",
];
export const oldInputs = [
  "inputs/primary.json",
  "inputs/old-evidence.json",
  "inputs/stored-evidence.json",
  "source-groups.json",
  "alignments.json",
  "alignment-plan.json",
];
export function freeze(root, name, paths) {
  for (const p of paths) {
    const fd = fs.openSync(p, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  write(root, name, {
    frozenAt: new Date().toISOString(),
    files: Object.fromEntries(
      paths.map((p) => [path.relative(root, p), hashFile(p)]),
    ),
    goldRead: false,
  });
}
export function verify(root) {
  const f = read(path.join(root, "prealignment-freeze.json"));
  checkFiles(root, f.files);
  const p = read(path.join(root, "boundary-plan.json"));
  checkFiles(repo, p.codeHashes);
  return p;
}
export function isolated(script, inputs, target) {
  execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      "(version 1)(allow default)(deny network*)",
      process.execPath,
      "--permission",
      "--allow-fs-read=" + repo,
      ...inputs.map((p) => "--allow-fs-read=" + p),
      "--allow-fs-read=" + target,
      "--allow-fs-read=" + target + "/*",
      "--allow-fs-write=" + target,
      "--allow-fs-write=" + target + "/*",
      path.join(repo, script),
      ...inputs,
      target,
    ],
    {
      stdio: "inherit",
      env: { PATH: process.env.PATH, LANG: "en_US.UTF-8", TZ: "UTC" },
    },
  );
}
export function payload(root) {
  return walk(root).filter((p) => !p.endsWith("experiment-manifest.json"));
}
