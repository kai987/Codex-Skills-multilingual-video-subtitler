#!/usr/bin/env node
/* global AbortController */
import { Command } from "commander";
import { plan, runB, report } from "./lib/bounded-asr-ab.mjs";
const cli = new Command()
  .name("subtitle-tool-bounded-asr-ab")
  .description(
    "Opt-in local experiment; product defaults unchanged. No model work in help/dry-run/report.",
  );
cli
  .command("plan")
  .requiredOption("--input <path>")
  .requiredOption("--baseline-task <path>")
  .requiredOption("--baseline-plan <path>")
  .requiredOption("--base-sha <sha>")
  .requiredOption("--vad-model <path>")
  .requiredOption("--vad-library <path>")
  .requiredOption("--python <path>")
  .requiredOption("--output-root <path>")
  .option(
    "--dry-run",
    "No files/models; show pending configuration, not verified VAD boundaries",
  )
  .action(async (o) =>
    console.log(
      JSON.stringify(
        o.dryRun
          ? { state: "PENDING_NOT_VERIFIED", newInference: 0, options: o }
          : await plan(o),
        null,
        2,
      ),
    ),
  );
cli
  .command("run")
  .requiredOption("--manifest <path>")
  .option(
    "--execute-b",
    "Authorize only this frozen B plan, resume cumulative ledger",
  )
  .action(async (o) => {
    if (!o.executeB) throw Error("--execute-b required");
    const controller = new AbortController(),
      cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      console.log(
        JSON.stringify(
          await runB(o.manifest, { signal: controller.signal }),
          null,
          2,
        ),
      );
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  });
cli
  .command("report")
  .requiredOption("--manifest <path>")
  .option(
    "--output-root <path>",
    "Required disjoint output tree; never overwrite the original run",
  )
  .option(
    "--export-partial",
    "Explicitly export only legal timed subset, preserve all other raw records",
  )
  .action(async (o) => {
    const result = await report(o.manifest, o);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  });
try {
  await cli.parseAsync();
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
