import fs from "node:fs";
import path from "node:path";
import {
  sha256,
  objectHash,
} from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
export { sha256, objectHash };
export const repo = path.resolve(import.meta.dirname, "..");
export const variants = [
  "T0-baseline",
  "T1-native-group",
  "T2-aligned-group",
  "T2-application-disabled",
];
export const read = (p) => JSON.parse(fs.readFileSync(p));
export const hashFile = (p) => sha256(fs.readFileSync(p));
export const write = (root, p, v) => {
  const dest = path.join(root, p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(
    dest,
    typeof v === "string" ? v : JSON.stringify(v, null, 2),
    { flag: "wx", flush: true },
  );
};
export function checkFiles(root, files) {
  for (const [p, h] of Object.entries(files)) {
    if (hashFile(path.resolve(root, p)) !== h)
      throw Error("Frozen file mismatch: " + p);
  }
}
export function verifyPlan(output) {
  const barrier = read(path.join(output, "prealignment-freeze.json"));
  checkFiles(output, barrier.files);
  const plan = read(path.join(output, "alignment-plan.json"));
  for (const [p, h] of Object.entries(plan.codeHashes))
    if (hashFile(path.join(repo, p)) !== h)
      throw Error("Prealigned implementation changed: " + p);
  return plan;
}
export function walk(p) {
  return fs
    .readdirSync(p, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(p, e.name))
        : e.isFile()
          ? [path.join(p, e.name)]
          : [],
    );
}
export function wavInfo(file) {
  const b = fs.readFileSync(file);
  if (
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE"
  )
    throw Error("Not physical PCM WAV");
  let rate, channels, bits, format, data;
  for (let i = 12; i + 8 <= b.length;) {
    const n = b.readUInt32LE(i + 4),
      tag = b.toString("ascii", i, i + 4);
    if (tag === "fmt ") {
      format = b.readUInt16LE(i + 8);
      channels = b.readUInt16LE(i + 10);
      rate = b.readUInt32LE(i + 12);
      bits = b.readUInt16LE(i + 22);
    }
    if (tag === "data") data = n;
    i += 8 + n + (n % 2);
  }
  if (format !== 1 || rate !== 16000 || channels !== 1 || bits !== 16 || !data)
    throw Error("Expected mono 16k PCM16");
  return {
    sampleCount: data / 2,
    sampleRate: rate,
    durationSeconds: data / 2 / rate,
    audioHash: sha256(b),
  };
}
