/** Explicit offline replay, no model runtime or reference option. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  deliverAudioCoverage,
  verifyAudioCoverage,
} from "./lib/audio-coverage-delivery.mjs";

export async function replayAudioCoverage(task, subtitlePath, outputRoot) {
  task = await fs.realpath(task);
  subtitlePath = await fs.realpath(subtitlePath);
  outputRoot = path.resolve(outputRoot);
  await safePath(outputRoot, true);
  for (const parent of [task, path.dirname(subtitlePath)])
    if (outputRoot === parent || outputRoot.startsWith(parent + path.sep))
      throw Error("OUTPUT_INSIDE_EXISTING_EVIDENCE");
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputRoot, "audio-coverage-"));
  return {
    root,
    ...(await deliverAudioCoverage({ task, subtitlePath, outputRoot: root })),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "replay" && args.length === 3)
      console.log(JSON.stringify(await replayAudioCoverage(...args), null, 2));
    else if (mode === "verify" && args.length === 1) {
      const audit = await verifyAudioCoverage(args[0]);
      console.log(
        JSON.stringify(
          { integrity: "passed", ...audit.coverage.summary, newInference: 0 },
          null,
          2,
        ),
      );
    } else
      throw Error(
        "Usage: replay TASK PREFERRED_SRT OUTPUT_ROOT | verify FROZEN_OUTPUT_ROOT",
      );
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
