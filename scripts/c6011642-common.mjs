import fs from "node:fs";
import path from "node:path";
export {
  read,
  write,
  hashFile,
  objectHash,
  walk,
  checkFiles,
  repo,
} from "./c601164-common.mjs";
import { read, checkFiles, repo } from "./c601164-common.mjs";
export { freeze, isolated, oldInputs } from "./c6011641-common.mjs";
export const variants = [
  "I0-legacy-boundary",
  "I1-identifiability-observe",
  "I2-original-tail-candidate",
];
export function verify(root) {
  const p = read(path.join(root, "plan.json"));
  checkFiles(root, read(path.join(root, "protocol-freeze.json")).files);
  checkFiles(repo, p.codeHashes);
  return p;
}
export function localWrite(root, p, v) {
  const dest = path.join(root, p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(
    dest,
    typeof v === "string" ? v : JSON.stringify(v, null, 2),
    { flag: "wx" },
  );
}
