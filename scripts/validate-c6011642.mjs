import path from "node:path";
import { z } from "zod";
import Ajv2020 from "ajv/dist/2020.js";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import { occurrenceTailProposalSchema } from "../packages/video-subtitler/dist/machine-quality/occurrence-tail.js";
import {
  read,
  write,
  verify,
  checkFiles,
  hashFile,
  objectHash,
  variants,
  walk,
} from "./c6011642-common.mjs";
const output = process.argv[2],
  plan = verify(output);
checkFiles(output, read(path.join(output, "evidence-freeze.json")).files);
checkFiles(output, read(path.join(output, "generation-freeze.json")).files);
const baseline = subtitlePackageSchema.parse(
  read(path.join(output, "inputs/baseline.json")),
);
const proposal = occurrenceTailProposalSchema.parse(
  read(path.join(output, "boundary-proposals.json"))[0],
);
const ajv = new Ajv2020({ strict: false }),
  check = ajv.compile(
    z.toJSONSchema(occurrenceTailProposalSchema, { unrepresentable: "any" }),
  );
if (!check(proposal)) throw Error(JSON.stringify(check.errors));
const final = [];
for (const run of ["run-a", "run-b"])
  for (const variant of variants) {
    const root = path.join(output, run, variant),
      pkg = subtitlePackageSchema.parse(
        read(path.join(root, "subtitle-package.needs-review.json")),
      ),
      journal = read(path.join(root, "mutation-journal.json"));
    if (pkg.cues.length !== baseline.cues.length)
      throw Error("CUE_COUNT_CHANGED");
    const changed = [];
    for (let i = 0; i < pkg.cues.length; i++) {
      const a = { ...pkg.cues[i] },
        b = { ...baseline.cues[i] };
      if (a.end !== b.end)
        changed.push({ cueId: a.id, oldEnd: b.end, newEnd: a.end });
      if (a.id === plan.target.cueId) {
        delete a.end;
        delete b.end;
      }
      if (objectHash(a) !== objectHash(b))
        throw Error("PROTECTED_FIELDS_CHANGED");
    }
    if (
      changed.length > 1 ||
      changed.length !== journal.changes.length ||
      changed.some(
        (c) =>
          !journal.changes.some(
            (j) =>
              j.cueId === c.cueId &&
              j.newEnd === c.newEnd &&
              j.oldEnd === c.oldEnd,
          ),
      )
    )
      throw Error("JOURNAL_DIVERGENCE");
    if (variant !== "I2-original-tail-candidate" && changed.length)
      throw Error("OBSERVE_MUTATION");
    for (const ext of ["ass", "srt", "vtt"]) {
      const p = path.join(root, "machine-candidate." + ext);
      if (
        variant !== "I2-original-tail-candidate" &&
        hashFile(p) !==
          hashFile(
            path.join(
              output,
              run +
                "-legacy-replay/U2-extended-window-boundary/machine-candidate." +
                ext,
            ),
          )
      )
        throw Error("LEGACY_PARITY_FAILED");
      if (
        variant === "I0-legacy-boundary" &&
        hashFile(p) !==
          hashFile(
            path.join(
              plan.previous,
              "run-a/U2-extended-window-boundary/machine-candidate." + ext,
            ),
          )
      )
        throw Error("HISTORICAL_BYTE_PARITY_FAILED");
    }
    final.push({
      run,
      variant,
      cues: pkg.cues.length,
      changedEnds: changed.length,
    });
  }
const inventory = (r) =>
  walk(path.join(output, r)).map((p) => [
    path.relative(path.join(output, r), p),
    hashFile(p),
  ]);
if (objectHash(inventory("run-a")) !== objectHash(inventory("run-b")))
  throw Error("AB_HASH_MISMATCH");
const result = read(path.join(output, "tail-identifiability.json"));
for (const k of [
  "newASRRequests",
  "newModelInference",
  "newAcousticForwards",
  "newModelLoads",
  "newProviderStarts",
  "newAudioWindows",
])
  if (result.counts[k] !== 0) throw Error("ZERO_BUDGET_VIOLATION");
write(output, "validation.json", {
  engineeringIntegrity: "PASSED",
  strictPackages: final.length,
  strictNewProposals: 1,
  independentAJV: true,
  final,
  protectedOtherCues: baseline.cues.length - 1,
  allTextStartsStylesIdentitiesPreserved: true,
  abParity: true,
  legacyParity: true,
  counts: result.counts,
  evidenceIntegrity: result.windows.every(
    (w) => w.evidenceIntegrity === "PASSED",
  )
    ? "PASSED"
    : "FAILED",
  search: result.windows.map((w) => ({
    window: w.windowId,
    status: w.searchStatus,
  })),
  quality: read(path.join(output, "evaluation/metrics.json")).gate,
  audioConfirmed: false,
  listener: null,
  humanValidated: false,
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  status: "needs-review",
  finalizationMethod: "none",
});
console.log(JSON.stringify({ validated: true, final, counts: result.counts }));
