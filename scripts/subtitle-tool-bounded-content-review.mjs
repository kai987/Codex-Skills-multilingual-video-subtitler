#!/usr/bin/env node
/* global AbortController */
import { Command } from "commander";
import {
  prepareReview,
  verifyBundle,
  summarizeReview,
} from "./lib/bounded-content-review.mjs";
const cli = new Command()
  .name("bounded-content-review")
  .description(
    "Frozen evidence only; no process, model, network or subtitle mutation.",
  );
const controller = new AbortController(),
  cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const show = async (fn, o) => {
  const result = await fn({ ...o, signal: controller.signal });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode;
};
cli
  .command("prepare")
  .requiredOption("--manifest <path>")
  .requiredOption("--diagnostics <path>")
  .requiredOption("--audio-root <path>")
  .requiredOption("--output-root <path>")
  .option(
    "--export-listening-audio",
    "Explicitly authorize derived byte-exact listening WAVs only",
  )
  .action((o) => show(prepareReview, o));
cli
  .command("verify")
  .requiredOption("--bundle <path>")
  .action((o) => show(() => verifyBundle(o.bundle), o));
cli
  .command("summarize")
  .requiredOption("--bundle <path>")
  .requiredOption("--annotations <path>")
  .requiredOption("--output-root <path>")
  .action((o) => show(summarizeReview, o));
try {
  await cli.parseAsync();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
