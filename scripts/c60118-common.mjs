import fs from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { repo, walk, digest, read } from "./c60117-common.mjs";
export function pcmIdentity(file) {
  const b = fs.readFileSync(file);
  if (
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE" ||
    b.readUInt32LE(4) + 8 !== b.length
  )
    throw Error("INVALID_WAV");
  let fmt = null,
    pcm = null;
  for (let i = 12; i + 8 <= b.length;) {
    const n = b.readUInt32LE(i + 4),
      tag = b.toString("ascii", i, i + 4);
    if (i + 8 + n > b.length) throw Error("TRUNCATED_WAV");
    if (tag === "fmt ") {
      if (n < 16) throw Error("INVALID_FMT");
      fmt = {
        format: b.readUInt16LE(i + 8),
        channels: b.readUInt16LE(i + 10),
        sampleRate: b.readUInt32LE(i + 12),
        bits: b.readUInt16LE(i + 22),
      };
    }
    if (tag === "data") {
      if (pcm) throw Error("MULTIPLE_PCM_CHUNKS");
      pcm = b.subarray(i + 8, i + 8 + n);
    }
    i += 8 + n + (n % 2);
  }
  if (
    !fmt ||
    !pcm ||
    fmt.format !== 1 ||
    fmt.channels !== 1 ||
    fmt.sampleRate !== 16000 ||
    fmt.bits !== 16 ||
    pcm.length % 2 ||
    !pcm.length
  )
    throw Error("PCM16_MONO_16K_REQUIRED");
  const sampleCount = pcm.length / 2,
    padded = Buffer.alloc((sampleCount + 28800) * 4);
  for (let i = 0; i < sampleCount; i++)
    padded.writeFloatLE(pcm.readInt16LE(i * 2) / 32768, (i + 14400) * 4);
  return {
    ...fmt,
    sampleCount,
    seconds: sampleCount / 16000,
    wavHash: digest(b),
    pcmHash: digest(pcm),
    paddedSampleCount: sampleCount + 28800,
    decodedFloat32Hash: digest(padded),
  };
}
export function implementationIdentity() {
  return Object.fromEntries(
    [
      ...walk(path.join(repo, "packages")).filter(
        (p) => p.includes("/dist/") && p.endsWith(".js"),
      ),
      ...walk(path.join(repo, "scripts")).filter(
        (p) =>
          p.includes("c60118") ||
          p.endsWith("reazonspeech_k2_worker.py") ||
          p.endsWith("c60117-common.mjs") ||
          p.endsWith("generate-c601172.mjs"),
      ),
    ].map((p) => [path.relative(repo, p), digest(fs.readFileSync(p))]),
  );
}
export function checkImplementation(root) {
  const expected = read(path.join(root, "implementation-identity.json"));
  for (const [p, h] of Object.entries(expected))
    if (digest(fs.readFileSync(path.join(repo, p))) !== h)
      throw Error("IMPLEMENTATION_DRIFT " + p);
}
