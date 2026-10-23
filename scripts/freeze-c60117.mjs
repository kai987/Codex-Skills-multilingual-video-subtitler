import fs from "node:fs";
import path from "node:path";
import {
  read,
  write,
  oh,
  digest,
  walk,
  freeze,
  repo,
  verify,
} from "./c60117-common.mjs";
const [rootArg] = process.argv.slice(2),
  root = path.resolve(rootArg);
const selected = read(path.join(root, "selected-config.json"));
if (selected.repair !== "occurrence-overlap-required")
  throw Error("Selection not recorded");
const code = [
  "package.json",
  "package-lock.json",
  ...walk(path.join(repo, "scripts")).filter((p) =>
    path.basename(p).includes("c60117"),
  ),
  ...walk(path.join(repo, "packages")).filter(
    (p) => p.includes("/dist/") && p.endsWith(".js"),
  ),
  ...walk(
    path.join(repo, "packages/video-subtitler/src/machine-quality"),
  ).filter((p) => /representative-|matched-replay/.test(p)),
  ...walk(path.join(repo, "tests")).filter((p) => p.includes("c60117")),
].map((p) => (path.isAbsolute(p) ? p : path.join(repo, p)));
write(
  path.join(root, "final-code-identity.json"),
  Object.fromEntries(
    code.map((p) => [path.relative(repo, p), digest(fs.readFileSync(p))]),
  ),
);
const runs = ["d-final-a", "d-final-b", "c-final-a", "c-final-b"];
for (const r of runs) verify(root, r + "-freeze.json");
freeze(root, "final-code-config-freeze.json", [
  path.join(root, "selected-config.json"),
  path.join(root, "final-code-identity.json"),
  path.join(root, "development-repair-plan.json"),
  ...walk(path.join(root, "configs")),
  ...runs.map((r) => path.join(root, r + "-freeze.json")),
]);
console.log(
  "FINAL FROZEN " + oh(read(path.join(root, "final-code-config-freeze.json"))),
);
