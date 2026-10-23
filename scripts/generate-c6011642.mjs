import fs from "node:fs";
import path from "node:path";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import {
  occurrenceTailProposalSchema,
  applyOccurrenceTail,
} from "../packages/video-subtitler/dist/machine-quality/occurrence-tail.js";
import {
  read,
  hashFile,
  objectHash,
  localWrite as write,
  variants,
} from "./c6011642-common.mjs";
const [pkgFile, planFile, resultFile, output] = process.argv.slice(2);
const pkg = subtitlePackageSchema.parse(read(pkgFile)),
  plan = read(planFile),
  result = read(resultFile);
if (
  result.version !== plan.protocol.version ||
  result.targetCueId !== plan.target.cueId
)
  throw Error("FOREIGN_PROTOCOL_RESULT");
const target = pkg.cues.find((c) => c.id === plan.target.cueId);
if (!target || objectHash(target) !== plan.target.cueHash)
  throw Error("STALE_CUE_BINDING");
const proposal = occurrenceTailProposalSchema.parse({
  version: "c6011642-original-tail-proposal-v1",
  cueId: target.id,
  cueHash: objectHash(target),
  evidenceHash: hashFile(resultFile),
  mathematicalPathExists: result.mathematicalPathExists,
  originalSupportEstablished: result.originalSupportEstablished,
  occurrenceDistinguished: result.occurrenceDistinguished,
  tailIdentifiable: result.tailIdentifiable,
  proposedEnd: result.proposedEnd,
  sourceRange: plan.requests.find((r) => r.windowId === "W+4").window,
  configuredStabilityTolerance: result.configuredStabilityTolerance,
  candidateEndRange: result.candidateEndRange,
  reasons: result.reasons,
  audioConfirmed: false,
  listener: null,
});
fs.mkdirSync(output);
for (const variant of variants) {
  const applied = applyOccurrenceTail(
    pkg.cues,
    proposal,
    plan.target.cueId,
    variant === "I2-original-tail-candidate",
  );
  const cues = applied.cues;
  for (let i = 0; i < cues.length; i++) {
    const a = { ...cues[i] },
      b = { ...pkg.cues[i] };
    if (a.id === plan.target.cueId) {
      delete a.end;
      delete b.end;
    }
    if (objectHash(a) !== objectHash(b)) throw Error("NON_TARGET_END_MUTATION");
  }
  const escaped = cues.map((c) => ({
    ...c,
    text: c.text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
  }));
  const formats = {
    ass: formatAss(cues),
    srt: formatSrt(escaped),
    vtt: formatVtt(escaped),
  };
  for (const [ext, parse] of Object.entries({
    ass: parseAss,
    srt: parseSrt,
    vtt: parseVtt,
  })) {
    write(output, variant + "/machine-candidate." + ext, formats[ext]);
    const actual = parse(
      fs.readFileSync(
        path.join(output, variant, "machine-candidate." + ext),
        "utf8",
      ),
    );
    if (
      actual.length !== cues.length ||
      actual.some(
        (c, i) =>
          c.text.replaceAll("\n", "") !==
            cues[i].text.replaceAll("\n", "").trim() ||
          Math.abs(c.start - cues[i].start) >
            (ext === "ass" ? 0.011 : 0.0011) ||
          Math.abs(c.end - cues[i].end) > (ext === "ass" ? 0.011 : 0.0011),
      )
    )
      throw Error("FORMAT_ROUNDTRIP_MISMATCH");
  }
  write(
    output,
    variant + "/subtitle-package.needs-review.json",
    subtitlePackageSchema.parse({ ...pkg, cues }),
  );
  write(output, variant + "/mutation-journal.json", {
    protocol: proposal.version,
    proposal,
    changes: applied.changes,
    rejectedReason: applied.rejectedReason,
    enabled: applied.enabled,
  });
  write(output, variant + "/generation-state.json", {
    cueCount: cues.length,
    textHash: objectHash(cues.map((c) => c.text)),
    timingHash: objectHash(cues.map((c) => [c.start, c.end])),
    presentationHash: objectHash(formats),
    changedEnds: applied.changes.length,
    status: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    defaultPromotionAuthorized: false,
    machineOnlyReleaseAuthorized: false,
  });
}
write(output, "boundary-proposals.json", [proposal]);
console.log("GENERATED_OCCURRENCE_CONTROLS");
