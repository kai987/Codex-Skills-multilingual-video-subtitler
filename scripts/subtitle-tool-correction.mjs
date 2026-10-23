#!/usr/bin/env node
/* global AbortController */
import { Command } from "commander";
import { EvidenceRunner } from "./lib/bounded-asr-ab.mjs";
import {
  prepareCorrection,
  executeCorrection,
  assembleCorrection,
  verifyCorrection,
} from "./lib/correction-run.mjs";

export function correctionCommand() {
  const cli = new Command("correct").description(
    "Explicit, bounded Japanese correction candidate; immutable baseline and no reference prompts.",
  );
  cli
    .command("prepare")
    .requiredOption("--previous-run <path>")
    .requiredOption("--plan <path>")
    .requiredOption("--output-root <path>")
    .action(async (o) =>
      console.log(
        JSON.stringify({ run: await prepareCorrection(o), newASR: 0 }),
      ),
    );
  cli
    .command("execute")
    .requiredOption("--run <path>")
    .option("--authorize-local-asr")
    .action(async (o) => {
      const controller = new AbortController(),
        cancel = () => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try {
        console.log(
          JSON.stringify(
            await executeCorrection(o.run, {
              authorize: !!o.authorizeLocalAsr,
              runner: new EvidenceRunner(controller.signal),
              progress: (p) => console.log(JSON.stringify(p)),
            }),
          ),
        );
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    });
  cli
    .command("assemble")
    .requiredOption("--run <path>")
    .action(async (o) =>
      console.log(JSON.stringify(await assembleCorrection(o.run))),
    );
  cli
    .command("verify")
    .requiredOption("--run <path>")
    .action(async (o) =>
      console.log(JSON.stringify(await verifyCorrection(o.run))),
    );
  cli
    .command("evaluate")
    .requiredOption("--run <path>")
    .requiredOption("--reference <path>")
    .action(async (o) => {
      const { evaluateCorrection } =
        await import("./lib/correction-evaluation.mjs");
      console.log(JSON.stringify(await evaluateCorrection(o.run, o.reference)));
    });
  return cli;
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
)
  await correctionCommand().parseAsync();
