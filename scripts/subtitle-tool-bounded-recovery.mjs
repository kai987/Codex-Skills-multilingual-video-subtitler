#!/usr/bin/env node
/* global AbortController */
import { Command } from "commander";
import { buildRecovery, verifyRecovery } from "./lib/bounded-recovery.mjs";
const cli = new Command()
  .name("bounded-recovery")
  .description("Offline representation recovery and future ASR planning only.");
const controller = new AbortController(),
  cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const show = async (fn) => console.log(JSON.stringify(await fn(), null, 2));
cli
  .command("build")
  .requiredOption("--diagnostics <path>")
  .requiredOption("--reference-bundle <path>")
  .requiredOption("--output-root <path>")
  .option("--export-recovered-subtitles")
  .action((o) =>
    show(() => buildRecovery({ ...o, signal: controller.signal })),
  );
for (const command of ["verify", "report"])
  cli
    .command(command)
    .requiredOption("--bundle <path>")
    .action((o) => show(() => verifyRecovery(o.bundle)));
try {
  await cli.parseAsync();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
