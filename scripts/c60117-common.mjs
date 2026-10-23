import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
export const repo = path.resolve(import.meta.dirname, "..");
export const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export const digest = (b) => createHash("sha256").update(b).digest("hex");
export const oh = (v) => digest(JSON.stringify(v));
export async function hash(p) {
  const h = createHash("sha256");
  for await (const b of fs.createReadStream(p)) h.update(b);
  return h.digest("hex");
}
export function write(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === "string" ? v : JSON.stringify(v, null, 2), {
    flag: "wx",
    flush: !process.permission,
  });
}
export function walk(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(root, e.name))
        : e.isFile()
          ? [path.join(root, e.name)]
          : [],
    )
    .sort();
}
export function freeze(root, name, files) {
  for (const f of files) {
    const fd = fs.openSync(f, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  write(path.join(root, name), {
    frozenAt: new Date().toISOString(),
    files: Object.fromEntries(
      files.map((f) => [path.relative(root, f), digest(fs.readFileSync(f))]),
    ),
  });
}
export function verify(root, name) {
  const f = read(path.join(root, name));
  for (const [p, h] of Object.entries(f.files)) {
    const q = path.resolve(root, p);
    if (!q.startsWith(root + path.sep) || digest(fs.readFileSync(q)) !== h)
      throw Error("Freeze mismatch: " + p);
  }
  return f;
}
export const childEnv = {
  PATH: process.env.PATH,
  LANG: "en_US.UTF-8",
  TZ: "UTC",
  HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1",
  PYTHONDONTWRITEBYTECODE: "1",
};
export function isolated(script, args, inputs, target) {
  const libs = fs
    .readdirSync(path.join(repo, "packages"))
    .map((p) => path.join(repo, "packages", p, "dist"))
    .filter((p) => fs.existsSync(p));
  execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      "(version 1)(allow default)(deny network*)",
      process.execPath,
      "--permission",
      ...[
        path.join(repo, "scripts", script),
        path.join(repo, "scripts/c60117-common.mjs"),
        path.join(repo, "node_modules"),
        ...libs,
        ...inputs,
        target,
      ].map((p) => "--allow-fs-read=" + p),
      "--allow-fs-write=" + target,
      path.join(repo, "scripts", script),
      ...args,
    ],
    { stdio: "inherit", env: childEnv },
  );
}
export function wavInfo(p) {
  const b = fs.readFileSync(p);
  if (
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE"
  )
    throw Error("WAV required");
  let rate = 0,
    count = 0;
  for (let i = 12; i + 8 <= b.length;) {
    const n = b.readUInt32LE(i + 4),
      tag = b.toString("ascii", i, i + 4);
    if (tag === "fmt ") {
      if (
        b.readUInt16LE(i + 8) !== 1 ||
        b.readUInt16LE(i + 10) !== 1 ||
        b.readUInt16LE(i + 22) !== 16
      )
        throw Error("Mono PCM16 required");
      rate = b.readUInt32LE(i + 12);
    }
    if (tag === "data") count = n / 2;
    i += 8 + n + (n % 2);
  }
  if (rate !== 16000 || !Number.isInteger(count) || count <= 0)
    throw Error("Invalid samples");
  return { sampleRate: rate, sampleCount: count, seconds: count / rate };
}
export const VARIANTS = [
  "P0-primary-minimal",
  "P1-current-matched",
  "P2-one-family-recovery",
  "P2-repair-disabled",
];
