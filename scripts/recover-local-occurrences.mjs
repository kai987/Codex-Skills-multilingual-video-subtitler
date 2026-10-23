/** Offline, separate-copy decision replay over identity-verified saved evidence. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifyContext } from "./replay-recovery-context.mjs";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import { decideOccurrenceRecovery } from "./lib/occurrence-recovery-decision.mjs";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const payload = ["decisions.json", "provenance.json"];
const code = [
  import.meta.filename,
  ...[
    "lib/occurrence-recovery-decision.mjs",
    "lib/source-occurrence-routing.mjs",
    "lib/vad-local-recovery.mjs",
    "lib/speech-support-policy.mjs",
  ].map((f) => path.join(import.meta.dirname, f)),
];

function replay(input) {
  const rows = input.targets.map((target) =>
    decideOccurrenceRecovery({ baseline: input.baseline, ...target }),
  );
  return {
    rows,
    summary: {
      targets: rows.length,
      executedTargets: rows.filter((r) => !r.notRun).length,
      retainedDonors: rows.reduce((n, r) => n + r.retainedDonors, 0),
      unpairedDonors: rows.reduce(
        (n, r) =>
          n + r.evidence.filter((d) => !d.pairedDecisionIds.length).length,
        0,
      ),
      pairedSegments: rows.reduce((n, r) => n + r.pairDecisions.length, 0),
      reviewCandidates: rows.reduce((n, r) => n + r.reviewCandidates.length, 0),
      priorCandidateTargets: rows.filter(
        (r) => r.originalDecision.status === "CANDIDATE",
      ).length,
      newInference: 0,
      modelLoads: 0,
      subtitleMutations: 0,
      droppedDonors: 0,
      qualityStatus: "needs-review",
      finalizationMethod: "none",
    },
  };
}

export async function recoverLocalOccurrences(evidence, outputParent) {
  evidence = await fs.realpath(evidence);
  outputParent = path.resolve(outputParent);
  await safePath(outputParent, true);
  await verifyContext(evidence);
  const parent = await json(path.join(evidence, "provenance.json"));
  for (const input of [evidence, parent.source])
    assert(
      outputParent !== input && !outputParent.startsWith(input + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
  const originalVerification = await verifyRecovery(parent.source);
  const bindings = await Promise.all(
    [
      ...code,
      path.join(evidence, "machine-freeze.json"),
      path.join(evidence, "machine-inputs.json"),
      path.join(parent.source, "machine-freeze.json"),
    ].map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  const result = replay(await json(path.join(evidence, "machine-inputs.json")));
  await fs.mkdir(outputParent, { recursive: true });
  const root = await fs.mkdtemp(
    path.join(outputParent, "occurrence-decision-"),
  );
  await put(path.join(root, "decisions.json"), result);
  await put(path.join(root, "provenance.json"), {
    evidence,
    bindings,
    originalVerification,
    labelsUsed: false,
    referenceUsed: false,
    previouslyExposedDevelopmentEpisode: true,
    inputBaseline:
      "historical-machine-baseline-not-current-human-assisted-subtitles",
    scope: "offline-review-candidates-not-automatic-subtitle-application",
  });
  for (const b of bindings)
    assert.equal(await fileHash(b.file), b.sha256, "SOURCE_CHANGED");
  await put(path.join(root, "freeze.json"), {
    files: Object.fromEntries(
      await Promise.all(
        payload.map(async (f) => [f, await fileHash(path.join(root, f))]),
      ),
    ),
  });
  return { root, ...(await verifyLocalOccurrences(root)) };
}

export async function verifyLocalOccurrences(root) {
  await safePath(root);
  const freeze = await json(path.join(root, "freeze.json"));
  assert.deepEqual(
    Object.keys(freeze.files).sort(),
    payload,
    "PAYLOAD_INVENTORY",
  );
  for (const [f, digest] of Object.entries(freeze.files)) {
    await safePath(path.join(root, f));
    assert.equal(await fileHash(path.join(root, f)), digest, "OUTPUT_CHANGED");
  }
  const p = await json(path.join(root, "provenance.json"));
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, "SOURCE_CHANGED");
  await verifyContext(p.evidence);
  const result = replay(
    await json(path.join(p.evidence, "machine-inputs.json")),
  );
  assert.deepEqual(
    await json(path.join(root, "decisions.json")),
    result,
    "DECISION_REPLAY_CHANGED",
  );
  return { integrity: "passed", ...result.summary };
}
