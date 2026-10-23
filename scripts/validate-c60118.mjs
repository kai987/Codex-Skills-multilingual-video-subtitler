import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import { completeCandidate } from "../packages/video-subtitler/dist/machine-quality/same-unit-candidate.js";
import { read, write, verify, oh } from "./c60117-common.mjs";
import { checkImplementation } from "./c60118-common.mjs";
const root = path.resolve(process.argv[2]);
for (const f of [
  "input-freeze.json",
  "model-input-freeze.json",
  "generation-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
  "evaluation-freeze.json",
])
  verify(root, f);
checkImplementation(root);
execFileSync("diff", [
  "-qr",
  path.join(root, "run-a"),
  path.join(root, "run-b"),
]);
const plan = read(path.join(root, "request-plan.json")),
  ledger = read(path.join(root, "execution-ledger.json"));
if (
  ledger.actualRecognitionAttempts > 14 ||
  ledger.retries > 2 ||
  ledger.decodedSeconds > 480 ||
  !read(path.join(root, "baseline-parity.json")).passed
)
  throw Error("BUDGET_OR_PARITY_FAILED");
let packages = 0;
for (const run of ["run-a", "run-b"])
  for (const u of plan.units) {
    const folder = path.join(root, run, u.id),
      raw = read(path.join(root, "evidence/reazon-same-unit", u.id + ".json"));
    if (raw.responseHash !== oh(raw.response)) throw Error("RAW_HASH_DRIFT");
    const c = completeCandidate(raw.response),
      r = read(path.join(folder, "R0-second-asr-transcript/transcript.json"));
    if (
      c.text !== r.text ||
      (c.text !== null &&
        fs.readFileSync(
          path.join(folder, "R0-second-asr-transcript/transcript.txt"),
          "utf8",
        ) !== c.text)
    )
      throw Error("LOSSY_TEXT");
    if (
      fs
        .readdirSync(path.join(folder, "R0-second-asr-transcript"))
        .some((f) => /\.(ass|srt|vtt)$/.test(f))
    )
      throw Error("FAKE_TIMED_R0");
    const p = subtitlePackageSchema.parse(
      read(
        path.join(folder, "W1-frozen-G11/subtitle-package.needs-review.json"),
      ),
    );
    if (p.primarySubtitle.validationStatus !== "needs-review")
      throw Error("INVALID_RELEASE_STATE");
    for (const [ext, parser] of Object.entries({
      ass: parseAss,
      srt: parseSrt,
      vtt: parseVtt,
    })) {
      const cues = parser(
        fs.readFileSync(
          path.join(folder, "W1-frozen-G11/machine-candidate." + ext),
          "utf8",
        ),
      );
      if (
        cues.length !== p.cues.length ||
        cues.some(
          (c, i) =>
            c.text.replace(/\s/gu, "") !== p.cues[i].text.replace(/\s/gu, ""),
        )
      )
        throw Error("ROUNDTRIP_FAILED");
    }
    packages++;
  }
const gain = read(path.join(root, "evaluation/candidate-gain.json"));
write(path.join(root, "validation.json"), {
  passed: true,
  packages,
  ABByteParity: true,
  rawTextLossless: true,
  G11Frozen: true,
  ledger,
  route: gain.route,
  status: "needs-review",
});
write(
  path.join(root, "OUTPUT_INDEX.md"),
  "# C6.0.1.18 same-unit candidate comparison\n\n" +
    gain.route +
    "; W1 remains unchanged. R0 is a full-text candidate, not a validated subtitle. No automatic selection or fine subtitle application. Known-development, reference-segmented units only.\n\n" +
    plan.units
      .map(
        (u) =>
          "- " +
          u.id +
          ": [same WAV](" +
          u.audio +
          "), [W0](run-a/" +
          u.id +
          "/W0-primary-transcript/transcript.txt), [G11 ASS](run-a/" +
          u.id +
          "/W1-frozen-G11/machine-candidate.ass), [G11 SRT](run-a/" +
          u.id +
          "/W1-frozen-G11/machine-candidate.srt), [G11 VTT](run-a/" +
          u.id +
          "/W1-frozen-G11/machine-candidate.vtt), [Reazon complete text](run-a/" +
          u.id +
          "/R0-second-asr-transcript/transcript.txt), [raw source](evidence/reazon-same-unit/" +
          u.id +
          ".json)",
      )
      .join("\n") +
    "\n\nSee evaluation/per-unit-comparison.csv and candidate-gain.json for all S/D/I/N, categories, paired denominators and oracle-only diagnostics. All detailed artifacts remain LOCAL_RESEARCH_PACKAGE_NOT_PUBLIC_SHAREABLE.\n",
);
console.log("VALIDATED " + packages + " packages");
