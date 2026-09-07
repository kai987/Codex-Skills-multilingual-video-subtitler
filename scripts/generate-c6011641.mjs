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
  BOUNDARY_POLICY,
  proposeBoundary,
  applyBoundaryEnds,
} from "../packages/video-subtitler/dist/machine-quality/boundary-support.js";
import { read, hashFile, objectHash, variants } from "./c6011641-common.mjs";
// Permission-isolated Node cannot fsync. The parent flushes and hashes outputs
// before freezing; the generator still refuses every existing destination.
const write = (root, p, value) => {
  const dest = path.join(root, p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(
    dest,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    { flag: "wx" },
  );
};
const args = process.argv.slice(2),
  output = args.pop(),
  [pkgFile, planFile, ...evidenceFiles] = args;
const pkg = subtitlePackageSchema.parse(read(pkgFile)),
  plan = read(planFile);
if (objectHash(plan.policy) !== objectHash(BOUNDARY_POLICY))
  throw Error("BOUNDARY_POLICY_CHANGED");
const results = evidenceFiles.map((file) => ({ file, raw: read(file) }));
const observation = (id, cueId) => {
  const entry = results.find((r) => r.raw.requestId === id),
    request = plan.requests.find((r) => r.requestId === id);
  if (!entry || !request) return undefined;
  const r = entry.raw,
    transition = r.acousticTransitions?.find((t) => t.cueId === cueId)?.result
      ?.selected;
  if (
    r.status === "SUCCESS" &&
    (r.frameEvidence.audioHash !== request.audioHash ||
      r.targetText !== request.targetText)
  )
    throw Error("BOUNDARY_EVIDENCE_IDENTITY_MISMATCH");
  return {
    windowId: id,
    window: request.window,
    status: r.status,
    mappingComplete:
      r.status === "SUCCESS" && r.pieces.join("") === request.targetText,
    spans: r.partialAlignment?.tokenSpans ?? [],
    ambiguous: r.partialAlignment?.status === "OCCURRENCE_AMBIGUOUS",
    frameSeconds: r.frameEvidence?.frameCellSeconds ?? 0.02,
    transitionSeconds: transition?.seconds ?? null,
    unassignedSuffix: r.partialAlignment?.unassignedSuffixFrames ?? [],
    evidenceHash: hashFile(entry.file),
  };
};
const proposals = {};
for (const id of ["W0", "W+4"])
  proposals[id] = plan.targets.map((t) => {
    const c = pkg.cues.find((c) => c.id === t.cueId);
    if (!c || objectHash(c) !== t.cueHash) throw Error("BASELINE_CUE_CHANGED");
    const o = observation(id, c.id) ?? {
      windowId: id,
      window: plan.appliedGroup.group.readEnvelope,
      status: "UNAVAILABLE",
      mappingComplete: false,
      spans: [],
      ambiguous: false,
      frameSeconds: 0.02,
      transitionSeconds: null,
      unassignedSuffix: [],
      evidenceHash: objectHash(null),
    };
    return proposeBoundary(
      c,
      t.firstTokenIndex,
      t.lastTokenIndex,
      o,
      {
        meanPosterior: t.oldTail.map((s) => s.meanPosterior),
        normalizedPathLogScore: t.oldNormalizedPathLogScore,
        firstTokenStart: t.oldFirstTokenStart,
      },
      id === "W+4" ? observation("W+2", c.id) : undefined,
    );
  });
fs.mkdirSync(output);
const summaries = [];
for (const variant of variants) {
  const proposed =
    variant === "U0-previous-T2"
      ? []
      : proposals[variant === "U1-original-window-boundary" ? "W0" : "W+4"];
  const applied = applyBoundaryEnds(
    pkg.cues,
    proposed,
    plan.targets.map((t) => t.cueId),
    variant !== "U2-application-disabled" && variant !== "U0-previous-T2",
  );
  const cues = applied.cues;
  for (let i = 0; i < cues.length; i++) {
    const before = { ...pkg.cues[i] },
      after = { ...cues[i] };
    delete before.end;
    delete after.end;
    if (objectHash(before) !== objectHash(after))
      throw Error("NON_END_MUTATION");
    if (
      !plan.targets.some((t) => t.cueId === cues[i].id) &&
      cues[i].end !== pkg.cues[i].end
    )
      throw Error("PROTECTED_END_MUTATION");
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
  for (const [ext, parser] of Object.entries({
    ass: parseAss,
    srt: parseSrt,
    vtt: parseVtt,
  })) {
    write(output, `${variant}/machine-candidate.${ext}`, formats[ext]);
    const parsed = parser(
      fs.readFileSync(
        path.join(output, variant, "machine-candidate." + ext),
        "utf8",
      ),
    );
    if (
      parsed.length !== cues.length ||
      parsed.some(
        (c, i) =>
          c.text.replaceAll("\n", "") !==
            cues[i].text.replaceAll("\n", "").trim() ||
          Math.abs(c.end - cues[i].end) > (ext === "ass" ? 0.011 : 0.0011),
      )
    )
      throw Error("EXPORT_ROUNDTRIP_FAILED");
    if (
      ["U0-previous-T2", "U2-application-disabled"].includes(variant) &&
      hashFile(path.join(output, variant, "machine-candidate." + ext)) !==
        plan.baselineHashes[ext]
    )
      throw Error("HISTORICAL_T2_BYTE_PARITY_FAILED");
  }
  write(
    output,
    variant + "/subtitle-package.needs-review.json",
    subtitlePackageSchema.parse({ ...pkg, cues }),
  );
  write(output, variant + "/mutation-journal.json", {
    proposals: proposed,
    ...applied,
    cues: undefined,
    changes: applied.applied.map((p) => ({
      cueId: p.cueId,
      oldEnd: pkg.cues.find((c) => c.id === p.cueId).end,
      newEnd: p.proposedSubtitleEnd,
      evidenceHash: p.evidenceHash,
    })),
  });
  const summary = {
    variant,
    cueCount: cues.length,
    changedEnds: applied.applied.length,
    textHash: objectHash(cues.map((c) => c.text)),
    timingHash: objectHash(cues.map((c) => [c.start, c.end])),
    immutableFieldsHash: objectHash(
      cues.map((c) => {
        const x = { ...c };
        delete x.end;
        return x;
      }),
    ),
    presentationHash: objectHash(formats),
    status: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    defaultPromotionAuthorized: false,
    machineOnlyReleaseAuthorized: false,
  };
  write(output, variant + "/generation-state.json", summary);
  summaries.push(summary);
}
write(output, "boundary-proposals.json", proposals);
write(output, "experiment-manifest.json", {
  variants: summaries,
  newASR: 0,
  newCTC: 0,
  modelLoads: 0,
});
console.log(
  "GENERATED_END_ONLY_CONTROLS",
  summaries.map((s) => ({ variant: s.variant, changedEnds: s.changedEnds })),
);
