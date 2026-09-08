import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseSrt } from "../packages/subtitle-core/dist/index.js";
import {
  read,
  write,
  verify,
  freeze,
  walk,
  hash,
  isolated,
  oh,
} from "./c60117-common.mjs";
import { checkImplementation } from "./c60118-common.mjs";
const root = path.resolve(process.argv[2]);
verify(root, "input-freeze.json");
verify(root, "model-input-freeze.json");
checkImplementation(root);
const plan = read(path.join(root, "request-plan.json")),
  receipt = read(path.join(root, "input-receipt.local-only.json"));
const parity = [],
  clocks = [];
for (const run of ["run-a", "run-b"]) {
  for (const u of plan.units) {
    const input = path.join(root, "generator-input", u.id + ".json"),
      response = path.join(root, "evidence/reazon-same-unit", u.id + ".json"),
      out = path.join(root, run, u.id);
    if (read(response).planHash !== oh(plan))
      throw Error("RESPONSE_PLAN_DRIFT");
    fs.mkdirSync(out, { recursive: true });
    const startedAt = new Date().toISOString();
    isolated(
      "generate-c60118.mjs",
      [input, response, out],
      [input, response],
      out,
    );
    clocks.push({
      run,
      unit: u.id,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    const w0 = fs.readFileSync(
      path.join(out, "W0-primary-transcript/transcript.txt"),
      "utf8",
    );
    const oldEvidence = read(
      path.join(receipt.baselineRoot, "generator-input", u.id + ".json"),
    );
    if (
      w0 !==
      oldEvidence.primaryRequests
        .flatMap((r) => r.segments.map((s) => s.text))
        .join("")
    )
      throw Error("W0_RAW_PARITY_FAILED");
    const p0 = parseSrt(
      fs.readFileSync(
        path.join(
          receipt.baselineRoot,
          "run-a",
          u.id,
          "P0-primary-minimal/machine-candidate.srt",
        ),
        "utf8",
      ),
    )
      .map((c) => c.text)
      .join("");
    // Display line breaks are the only difference allowed in this raw projection check.
    if (w0.replace(/\r?\n/gu, "") !== p0.replace(/\r?\n/gu, ""))
      throw Error("W0_P0_TEXT_DRIFT");
    for (const ext of ["ass", "srt", "vtt"]) {
      const actual = await hash(
          path.join(out, "W1-frozen-G11", "machine-candidate." + ext),
        ),
        expected = await hash(
          path.join(
            receipt.baselineRoot,
            "run-a",
            u.id,
            "G11-composed",
            "machine-candidate." + ext,
          ),
        );
      if (actual !== expected) throw Error("G11_FORMAT_DRIFT");
      parity.push({ run, unit: u.id, ext, sha256: actual, passed: true });
    }
  }
  freeze(root, run + "-freeze.json", walk(path.join(root, run)));
}
execFileSync("diff", [
  "-qr",
  path.join(root, "run-a"),
  path.join(root, "run-b"),
]);
write(path.join(root, "baseline-parity.json"), {
  passed: true,
  comparisons: parity,
  W0RawParity: 12,
  W0P0TextParity: 12,
});
write(path.join(root, "replay-clocks.json"), clocks);
write(path.join(root, "experiment-manifest.json"), {
  version: "C6.0.1.18",
  units: 12,
  ABByteParity: true,
  G11Frozen: true,
  modelRequestsInReplay: 0,
  generationReferenceReads: 0,
  referenceAccessEnforcement:
    "Node exact file allowlist; no subprocess/addon; OS deny network",
  status: "needs-review",
  finalizationMethod: "none",
  humanValidated: false,
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  BENCHMARK_REFERENCE_SEGMENTED: true,
  HELDOUT_VALIDATION: "NOT_RUN",
  UNSEGMENTED_END_TO_END_VALIDATION: "NOT_RUN",
  AUTOMATIC_CROSS_MODEL_SELECTION: "NOT_IMPLEMENTED",
  FINAL_SUBTITLE_APPLICATION: "NOT_IMPLEMENTED",
});
freeze(
  root,
  "generation-freeze.json",
  [
    "input-freeze.json",
    "model-input-freeze.json",
    "run-a-freeze.json",
    "run-b-freeze.json",
    "baseline-parity.json",
    "replay-clocks.json",
    "execution-ledger.json",
    "experiment-manifest.json",
  ]
    .map((f) => path.join(root, f))
    .concat(
      walk(path.join(root, "evidence/reazon-same-unit")),
      walk(path.join(root, "attempts")),
    ),
);
console.log("A/B and W0/W1 parity passed");
