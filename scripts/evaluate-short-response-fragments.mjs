/** Evaluation-only feedback import. Does not apply text or timing to subtitles. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  verifyReadiness,
  checkFrozen,
} from "./evaluate-short-response-readiness.mjs";

const normalize = (s) => s.normalize("NFKC").replace(/[\s\p{P}]/gu, "");
const hash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const put = async (file, data) =>
  fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
function keys(value, expected) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "OBJECT_REQUIRED",
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expected].sort(),
    "UNKNOWN_OR_MISSING_FIELDS",
  );
}

function compare(records, annotation) {
  const common = {
    records,
    targetTimingVerified: false,
    targetTextCorrect: null,
  };
  if (annotation.kind === "interjection-type-only")
    return {
      ...common,
      status: "not-scorable-type-only",
      literalFragmentPresent: null,
    };
  const text = normalize(annotation.rawText);
  const literalFragmentPresent = records
    .map((r) => normalize(r.text))
    .join("")
    .includes(text);
  return {
    ...common,
    status: literalFragmentPresent
      ? "literal-fragment-present"
      : "literal-fragment-not-found",
    literalFragmentPresent,
    components: annotation.rawText
      .trim()
      .split(/\s+/u)
      .map((part) => ({
        text: part,
        matchingRecordIndexes: records.flatMap((r, i) =>
          normalize(r.text).includes(normalize(part)) ? [i] : [],
        ),
      })),
    comparisonScope:
      "literal-surface-presence-in-request-or-playback-overlapping-cue-envelopes-not-acoustic-localization",
  };
}

export function evaluateFragmentFeedback(
  readiness,
  baseline,
  feedback,
  parentFreezeHash,
) {
  keys(feedback, ["version", "parentFreezeHash", "source", "annotations"]);
  assert.equal(feedback.version, "short-response-fragment-feedback-v1");
  assert.equal(
    feedback.source,
    "explicit-user-clip-list-in-current-conversation",
  );
  assert.match(parentFreezeHash, /^[0-9a-f]{64}$/u);
  assert.equal(feedback.parentFreezeHash, parentFreezeHash, "STALE_FEEDBACK");
  const expected = readiness.rows.filter(
    (r) => r.speechTruth === true && !r.wholeReference,
  );
  assert(Array.isArray(feedback.annotations), "ANNOTATIONS_REQUIRED");
  assert.deepEqual(
    feedback.annotations.map((r) => r.id).sort(),
    expected.map((r) => r.id).sort(),
    "COHORT_MISMATCH",
  );
  const labels = new Map(feedback.annotations.map((r) => [r.id, r]));
  assert.equal(labels.size, feedback.annotations.length, "DUPLICATE_FEEDBACK");
  const rows = expected.map((r) => {
    const a = labels.get(r.id);
    keys(a, ["id", "audioHash", "rawText", "kind"]);
    assert.equal(a.audioHash, r.audioHash, "WRONG_AUDIO");
    assert(typeof a.rawText === "string" && a.rawText.trim(), "EMPTY_FEEDBACK");
    assert(
      ["heard-fragment", "interjection-type-only"].includes(a.kind),
      "UNKNOWN_KIND",
    );
    if (a.kind === "interjection-type-only")
      assert.equal(a.rawText, "语气词", "TYPE_NOT_TRANSCRIPT");
    else
      assert(
        normalize(a.rawText) &&
          /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(a.rawText),
        "JAPANESE_FRAGMENT_REQUIRED",
      );
    const neighbors = baseline.filter(
      (c) => c.start < r.playback.end && c.end > r.playback.start,
    );
    return {
      id: r.id,
      audioHash: r.audioHash,
      suppliedText: a.rawText,
      annotationKind: a.kind,
      lexicalFragment: a.kind === "heard-fragment" ? a.rawText : null,
      speechType:
        a.kind === "interjection-type-only"
          ? "interjection"
          : r.interjectionTypeTruth,
      priorRelation: r.relationLabel,
      target: r.target,
      playback: r.playback,
      annotationScope: "heard-in-clip-no-word-level-source-times-supplied",
      completeUtteranceConfirmed: false,
      confirmedInterval: null,
      baseline: compare(neighbors, a),
      localAsr: r.backends.map((b) =>
        b.status === "not-run"
          ? {
              backend: b.backend,
              status: "not-run",
              literalFragmentPresent: null,
            }
          : { backend: b.backend, ...compare(b.records, a) },
      ),
      subtitleMutationAuthorized: false,
    };
  });
  return {
    version: "short-response-fragment-comparison-v1",
    rows,
    summary: {
      feedbackRows: rows.length,
      lexicalFragments: rows.filter((r) => r.lexicalFragment !== null).length,
      typeOnly: rows.filter(
        (r) => r.annotationKind === "interjection-type-only",
      ).length,
      baselineLiteralFragmentPresence: rows.filter(
        (r) => r.baseline.literalFragmentPresent === true,
      ).length,
      originalCohortUnits: readiness.rows.length,
      previousCompleteUtteranceLabelsPreserved: readiness.rows.filter(
        (r) => r.wholeReference,
      ).length,
      newCompleteUtteranceLabels: 0,
      targetLexicalAccuracy: null,
      boundaryAccuracy: null,
      episodeAccuracy: null,
      newInference: 0,
      modelLoads: 0,
      subtitleMutations: 0,
    },
    limitations: [
      "Fragment presence is not target occurrence verification or a missing-subtitle decision.",
      "Literal mismatch can reflect orthography; no kana reading or semantic equivalence is inferred.",
      "Cue-envelope intersections and playback bounds are not supplied word timing.",
      "Type-only interjections have no known Japanese spelling; do not manufacture one.",
      "Previously exposed development data, evaluation only, not blind generation or release.",
    ],
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}

export async function importFragmentFeedback(parent, labelsFile, output) {
  parent = await fs.realpath(parent);
  labelsFile = await fs.realpath(labelsFile);
  output = path.resolve(output);
  assert(
    output !== parent && !output.startsWith(parent + path.sep),
    "OUTPUT_INSIDE_PARENT",
  );
  await verifyReadiness(parent);
  const bindings = await Promise.all(
    [
      path.join(parent, "evaluation-freeze.json"),
      labelsFile,
      import.meta.filename,
    ].map(async (file) => ({ file, sha256: await hash(file) })),
  );
  const feedback = await json(labelsFile);
  const readiness = await json(path.join(parent, "readiness.json"));
  const inputs = await json(path.join(parent, "evaluation-inputs.json"));
  const result = evaluateFragmentFeedback(
    readiness,
    inputs.snapshot.baseline,
    feedback,
    bindings[0].sha256,
  );
  await fs.mkdir(output, { recursive: true });
  output = await fs.realpath(output);
  assert(
    output !== parent && !output.startsWith(parent + path.sep),
    "OUTPUT_INSIDE_PARENT",
  );
  const root = await fs.mkdtemp(path.join(output, "feedback-"));
  await put(path.join(root, "user-feedback.json"), feedback);
  await put(path.join(root, "comparison.json"), result);
  await put(path.join(root, "provenance.json"), {
    parent,
    bindings,
    role: "evaluation-only",
    newInference: 0,
  });
  await verifyReadiness(parent);
  for (const b of bindings)
    assert.equal(await hash(b.file), b.sha256, "INPUT_CHANGED");
  const files = {};
  for (const n of ["user-feedback.json", "comparison.json", "provenance.json"])
    files[n] = await hash(path.join(root, n));
  await put(path.join(root, "evaluation-freeze.json"), { files });
  return {
    root,
    summary: result.summary,
    ...(await verifyFragmentFeedback(root)),
  };
}

export async function verifyFragmentFeedback(root) {
  const checked = await checkFrozen(root, "evaluation-freeze.json");
  root = checked.root;
  const provenance = await json(path.join(root, "provenance.json"));
  for (const b of provenance.bindings)
    assert.equal(await hash(b.file), b.sha256, "BOUND_INPUT_CHANGED");
  await verifyReadiness(provenance.parent);
  const readiness = await json(path.join(provenance.parent, "readiness.json"));
  const inputs = await json(
    path.join(provenance.parent, "evaluation-inputs.json"),
  );
  const feedback = await json(path.join(root, "user-feedback.json"));
  assert.deepEqual(
    feedback,
    await json(provenance.bindings[1].file),
    "FEEDBACK_CHANGED",
  );
  assert.deepEqual(
    await json(path.join(root, "comparison.json")),
    evaluateFragmentFeedback(
      readiness,
      inputs.snapshot.baseline,
      feedback,
      provenance.bindings[0].sha256,
    ),
    "REPLAY_CHANGED",
  );
  return {
    integrity: "passed",
    payloadFiles: checked.count,
    newInference: 0,
    subtitleMutations: 0,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [command, ...args] = process.argv.slice(2);
  assert(
    (command === "import" && args.length === 3) ||
      (command === "verify" && args.length === 1),
    "import READINESS LABELS OUTPUT | verify ROOT",
  );
  console.log(
    JSON.stringify(
      command === "import"
        ? await importFragmentFeedback(...args)
        : await verifyFragmentFeedback(...args),
      null,
      2,
    ),
  );
}
