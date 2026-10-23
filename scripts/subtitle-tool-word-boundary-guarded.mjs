/** Current experiment entry. Legacy runner stays byte-identical for frozen replay. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { verifyContext } from "./subtitle-tool-speech-context.mjs";
import { boundaryWindows } from "./lib/word-boundary-probe.mjs";
import { auditAlignmentCoverage } from "./lib/alignment-coverage.mjs";
import {
  prepareWordBoundary,
  runWordBoundary,
  verifyWordBoundary,
} from "./subtitle-tool-word-boundary.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
export async function afterCoverageCheck(input, operation) {
  const audit = auditAlignmentCoverage(input);
  assert.equal(
    audit.blockers.length,
    0,
    `ALIGNMENT_INPUT_COVERAGE_BLOCKED:${audit.blockers.join(",")}`,
  );
  // Permission is diagnostic only; original runner still enforces reservation,
  // source/runtime hashes, bounded calls and no subtitle mutation.
  return operation();
}
async function contextInput(parent, planned) {
  await verifyContext(parent);
  const p = await json(path.join(parent, "plan.json"));
  const baseline = await json(path.join(parent, "baseline-records.json"));
  assert.equal(p.selected.length, 1, "ONE_FROZEN_TARGET_REQUIRED");
  const target = boundaryWindows(
    p.selected[0],
    baseline,
    p.duration,
    p.audioOffset,
  );
  if (planned) {
    assert.equal(planned.text, target.text);
    assert.deepEqual(planned.recordIds, target.recordIds);
    assert.deepEqual(
      planned.windows.map(({ id, start, end, frames }) => ({
        id,
        start,
        end,
        frames,
      })),
      target.windows,
    );
  }
  return {
    baseline,
    recordIds: target.recordIds,
    text: target.text,
    windows: target.windows,
    views: await json(path.join(parent, "views.json")),
    viewWindow: p.selected[0],
    offset: p.audioOffset,
    end: p.duration,
  };
}
export async function guardedWordBoundary(command, a, b, c) {
  assert(a, "INPUT_REQUIRED");
  if (command === "verify") return verifyWordBoundary(a);
  if (command === "prepare") {
    assert(b && c, "SETTINGS_AND_OUTPUT_REQUIRED");
    return afterCoverageCheck(await contextInput(a), () =>
      prepareWordBoundary(a, b, c),
    );
  }
  assert.equal(command, "run", "UNKNOWN_COMMAND");
  assert.equal(b, "--authorize-local", "EXPLICIT_LOCAL_ALIGNMENT_REQUIRED");
  const p = await json(path.join(a, "plan.json"));
  return afterCoverageCheck(await contextInput(p.parent, p), () =>
    runWordBoundary(a, true),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        await guardedWordBoundary(...process.argv.slice(2)),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
