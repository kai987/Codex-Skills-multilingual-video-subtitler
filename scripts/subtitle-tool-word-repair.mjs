import { readJson } from "./lib/local-asr-run.mjs";
import {
  prepareReview,
  loadReview,
  saveActions,
  exportReview,
} from "./lib/word-repair-run.mjs";
import { serveReview } from "./lib/word-repair-server.mjs";
const [command, arg, extra] = process.argv.slice(2);
try {
  if (
    [
      "prepare-patch",
      "verify-patch",
      "preview-patch",
      "apply-patch",
      "undo-patch",
    ].includes(command)
  ) {
    const api = await import("./lib/baseline-patch-run.mjs");
    const options = {
      exportPartial: process.argv.includes("--export-partial"),
    };
    let result;
    if (command === "prepare-patch")
      result = await api.prepareBaselinePatch(await readJson(arg));
    if (command === "verify-patch") {
      const w = await api.loadBaselinePatch(arg);
      result = {
        baselineRecords: w.baseline.length,
        proposals: w.proposals.length,
        newInferenceRequests: 0,
        qualityStatus: w.qualityStatus,
      };
    }
    if (command === "preview-patch")
      result = await api.previewBaselinePatch(arg, options);
    if (command === "apply-patch")
      result = await api.applyBaselinePatch(
        arg,
        await readJson(extra),
        options,
      );
    if (command === "undo-patch")
      result = await api.restoreBaselinePatch(arg, extra, options);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "prepare")
    console.log(
      JSON.stringify(await prepareReview(await readJson(arg)), null, 2),
    );
  else if (command === "verify") {
    const w = await loadReview(arg);
    console.log(
      JSON.stringify({
        units: w.units.length,
        items: w.items.length,
        status: w.qualityStatus,
        newInferenceCount: 0,
      }),
    );
  } else if (command === "apply") {
    await saveActions(arg, await readJson(extra));
    console.log(JSON.stringify(await exportReview(arg), null, 2));
  } else if (command === "export")
    console.log(JSON.stringify(await exportReview(arg), null, 2));
  else if (command === "serve") {
    const s = await serveReview(arg, extra ? Number(extra) : 0);
    console.log(s.url);
  } else
    throw Error(
      "Usage: node scripts/subtitle-tool-word-repair.mjs prepare <config.json> | verify|serve|export <run> | apply <run> <actions.json> | prepare-patch <config.json> | verify-patch|preview-patch <run> [--export-partial] | apply-patch <run> <actions.json> [--export-partial] | undo-patch <run> <snapshot-hash> [--export-partial]",
    );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
