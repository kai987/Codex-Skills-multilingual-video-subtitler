import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import Ajv2020 from "ajv/dist/2020.js";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import { boundaryProposalSchema } from "../packages/video-subtitler/dist/machine-quality/boundary-support.js";
import {
  read,
  write,
  hashFile,
  objectHash,
  checkFiles,
  verify,
  variants,
} from "./c6011641-common.mjs";
const output = process.argv[2],
  plan = verify(output);
checkFiles(
  output,
  read(path.join(output, "boundary-evidence-freeze.json")).files,
);
checkFiles(output, read(path.join(output, "generation-freeze.json")).files);
const validator = new Ajv2020({ strict: false });
const proposalJSON = z.toJSONSchema(boundaryProposalSchema),
  check = validator.compile(proposalJSON);
let count = 0;
for (const ps of Object.values(
  read(path.join(output, "boundary-proposals.json")),
))
  for (const p of ps) {
    boundaryProposalSchema.parse(p);
    if (!check(p)) throw Error(JSON.stringify(check.errors));
    count++;
  }
const baseline = read(
  path.join(output, "run-a/U0-previous-T2/subtitle-package.needs-review.json"),
).cues;
const ids = new Set(plan.targets.map((t) => t.cueId));
for (const run of ["run-a", "run-b"])
  for (const variant of variants) {
    const pkg = subtitlePackageSchema.parse(
      read(
        path.join(output, run, variant, "subtitle-package.needs-review.json"),
      ),
    );
    if (pkg.cues.length !== baseline.length) throw Error("CUE_COUNT_CHANGED");
    for (let i = 0; i < pkg.cues.length; i++) {
      const a = { ...pkg.cues[i] },
        b = { ...baseline[i] };
      if (ids.has(a.id)) {
        delete a.end;
        delete b.end;
      }
      if (objectHash(a) !== objectHash(b))
        throw Error("PROTECTED_FIELD_MUTATION");
    }
    const journal = read(
      path.join(output, run, variant, "mutation-journal.json"),
    );
    const differences = pkg.cues.filter((c, i) => c.end !== baseline[i].end);
    if (differences.length !== journal.changes.length)
      throw Error("JOURNAL_EXPORT_MISMATCH");
    for (const c of differences)
      if (!journal.changes.some((j) => j.cueId === c.id && j.newEnd === c.end))
        throw Error("MISSING_JOURNAL_CHANGE");
  }
const events = fs
    .readFileSync(path.join(output, "boundary-evidence/events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse),
  execution = read(path.join(output, "boundary-execution.json"));
if (
  events.filter((e) => e.type === "logical-task-start").length !==
    execution.attempts ||
  events.filter((e) => e.type === "acoustic-forward-start").length !==
    execution.acousticForwards ||
  execution.attempts > 4 ||
  execution.seconds > 90 ||
  execution.newASRRequests !== 0
)
  throw Error("EXECUTION_LEDGER_MISMATCH");
const w0 = read(path.join(output, "boundary-evidence/W0.json")),
  old = read(path.join(output, "previous/diagnostic.json"));
const comparison = {
  tokenSpansIdentical:
    objectHash(w0.fullWindowAlignment.tokenSpans) ===
    objectHash(old.tokenSpans),
  normalizedPathLogScoreBefore: old.normalizedPathLogScore,
  normalizedPathLogScoreAfter: w0.fullWindowAlignment.normalizedPathLogScore,
  maxFrameDifference: Math.max(
    ...old.tokenSpans.map((s, i) =>
      Math.max(
        Math.abs(
          s.startFrame - w0.fullWindowAlignment.tokenSpans[i].startFrame,
        ),
        Math.abs(
          s.endFrameExclusive -
            w0.fullWindowAlignment.tokenSpans[i].endFrameExclusive,
        ),
      ),
    ),
  ),
};
for (const r of plan.requests) {
  const raw = read(
    path.join(output, "boundary-evidence", r.requestId + ".json"),
  );
  if (
    raw.status === "SUCCESS" &&
    hashFile(path.join(output, "boundary-evidence", raw.frameEvidence.file)) !==
      raw.frameEvidence.sha256
  )
    throw Error("FRAME_EVIDENCE_HASH_MISMATCH");
}
write(output, "validation.json", {
  engineering: "PASSED",
  schemaValidatedProposals: count,
  strictPackages: 8,
  textStartStyleCueIdentityPreserved: true,
  untouchedCueCount: baseline.length - ids.size,
  execution,
  w0SameAlgorithmComparison: comparison,
  generationFreezeHash: hashFile(path.join(output, "generation-freeze.json")),
  defaultPromotionAuthorized: false,
  humanValidated: false,
  status: "needs-review",
  finalizationMethod: "none",
});
console.log(
  JSON.stringify(
    {
      validated: true,
      comparison,
      proposals: count,
      untouched: baseline.length - ids.size,
    },
    null,
    2,
  ),
);
