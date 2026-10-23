/** Evaluation-only: machine audit and policy are frozen before opening Gold. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseSrt } from "../packages/subtitle-core/dist/parse.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const norm = (s) => s.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const overlaps = (a, b) => a.start < b.end && a.end > b.start;

export async function evaluateShortResponseObservation(root, reference) {
  const freeze = await read(path.join(root, "machine-freeze.json"));
  assert.equal(freeze.version, "short-response-observation-freeze-v1");
  const verify = async () => {
    for (const [name, hash] of Object.entries(freeze.files)) {
      assert.equal(path.basename(name), name, "UNSAFE_FROZEN_FILE");
      assert.equal(
        sha(await fs.readFile(path.join(root, name))),
        hash,
        `CHANGED:${name}`,
      );
    }
    for (const s of freeze.software)
      assert.equal(
        sha(await fs.readFile(new URL(s.file))),
        s.sha256,
        "CHANGED_OBSERVATION_CODE",
      );
  };
  await verify();
  const audit = await read(path.join(root, "SHORT_RESPONSE_OBSERVATION.json"));
  for (const input of audit.inputs)
    assert.equal(
      sha(await fs.readFile(input.file)),
      input.sha256,
      "CHANGED_MACHINE_INPUT",
    );
  // Read Gold only after all frozen-machine checks above.
  const referenceBytes = await fs.readFile(reference);
  const machine = parseSrt(await fs.readFile(audit.inputs[1].file, "utf8"));
  const end = Math.max(...machine.map((r) => r.end));
  const comparison = compareReference({
    referenceAss: referenceBytes.toString("utf8"),
    baselineRecords: machine,
    candidateRecords: machine,
    windows: [
      {
        id: "full-delivered-range",
        start: 0,
        end,
        kind: "unchanged-machine-development-evaluation",
      },
    ],
  }).perWindow[0];
  const refs = comparison.reference.records.filter(
    (r) => Array.from(norm(r.text)).length <= 6 && r.end - r.start <= 2,
  );
  const cases = refs.map((r) => ({
    id: `reference-line-${r.line}`,
    start: r.start,
    end: r.end,
    expectedText: r.text,
    observationOverlapIds: audit.preferred.entries
      .filter((m) => overlaps(m, r))
      .map((m) => m.id),
    machineOverlapCount: machine.filter((m) => overlaps(m, r)).length,
    exactWholeCueWithinTwoSeconds: machine.some(
      (m) => norm(m.text) === norm(r.text) && Math.abs(m.start - r.start) <= 2,
    ),
    targetStringInOverlappingCue: machine.some(
      (m) => overlaps(m, r) && norm(m.text).includes(norm(r.text)),
    ),
  }));
  const user = await read(
    new URL(
      "../tests/fixtures/short-response-human-evaluation.json",
      import.meta.url,
    ),
  );
  const knownUserCase = {
    ...user,
    observationOverlapIds: audit.preferred.entries
      .filter((r) => overlaps(r, user.activityHint))
      .map((r) => r.id),
    tinyClipExactMatches: user.machineTexts.filter(
      (text) => norm(text) === norm(user.expectedText),
    ).length,
    decision: "KEEP_REVIEW_NO_AUTOMATIC_REPLACEMENT",
  };
  const report = {
    version: "short-response-development-evaluation-v1",
    machineFreezeHash: sha(
      await fs.readFile(path.join(root, "machine-freeze.json")),
    ),
    referenceHash: sha(referenceBytes),
    selection:
      "Evaluation-only: strict Dialogue style, first line, normalized length <=6 and duration <=2 seconds; no policy retuning after seeing results.",
    cases,
    knownUserCase,
    summary: {
      selectedReferenceCases: cases.length,
      casesWithObservationOverlap: cases.filter(
        (c) => c.observationOverlapIds.length,
      ).length,
      casesWithoutMachineOverlap: cases.filter(
        (c) => c.machineOverlapCount === 0,
      ).length,
      exactWholeCueMatchesWithinTwoSeconds: cases.filter(
        (c) => c.exactWholeCueWithinTwoSeconds,
      ).length,
      targetStringPresentInOverlappingCue: cases.filter(
        (c) => c.targetStringInOverlappingCue,
      ).length,
      observedPreferredCues: audit.preferred.observedCount,
      confirmedErrorRecall: null,
      reviewPrecision: null,
      falseAutomaticReplacements: 0,
      automaticReplacementsAttempted: 0,
      subtitleTextMutations: 0,
      subtitleTimingMutations: 0,
      newInference: 0,
      independentHoldoutValidation: "not-run",
    },
    limitations: [
      "Known-video development data, not held-out independent-generation validation.",
      "Temporal overlap and substring matches are diagnostics, not speech accuracy or error recall.",
      "Reference timing is not acoustic verification; activity hint for user case is not human-aligned timing.",
      "No complete error adjudication, so review precision and confirmed-error recall remain unknown.",
      "Zero false automatic replacements follows from zero replacements attempted, not a validated repair capability.",
    ],
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
  await verify();
  for (const input of audit.inputs)
    assert.equal(
      sha(await fs.readFile(input.file)),
      input.sha256,
      "CHANGED_MACHINE_INPUT",
    );
  assert.equal(
    sha(await fs.readFile(reference)),
    report.referenceHash,
    "CHANGED_REFERENCE",
  );
  await fs.writeFile(
    path.join(root, "reference-evaluation.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  return report.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [root, reference, ...extra] = process.argv.slice(2);
    if (!root || !reference || extra.length)
      throw Error("Usage: FROZEN_OBSERVATION_ROOT REFERENCE_ASS");
    console.log(
      JSON.stringify(
        await evaluateShortResponseObservation(root, reference),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
