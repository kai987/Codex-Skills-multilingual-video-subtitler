import { Command } from "commander";
import {
  prepare,
  execute,
  integrate,
  verifyIntegration,
  exists,
} from "./lib/local-asr-run.mjs";
import path from "node:path";
const program = new Command().description(
  "Private, explicitly authorized frozen-window ASR experiment; no product default change.",
);
program
  .command("execute")
  .option("--run <path>")
  .option("--resume")
  .option("--recovery-bundle <path>")
  .option("--audio-root <path>")
  .option("--model <path>")
  .option("--runtime <path>")
  .option("--authorization <path>")
  .option("--output-root <path>")
  .option("--authorize-frozen-local-asr")
  .action(async (o) => {
    if (!o.authorizeFrozenLocalAsr)
      throw Error("EXPLICIT_AUTHORIZATION_REQUIRED");
    if (o.run && !o.resume) throw Error("RESUME_FLAG_REQUIRED");
    if (!o.run)
      for (const k of [
        "recoveryBundle",
        "audioRoot",
        "model",
        "runtime",
        "authorization",
        "outputRoot",
      ])
        if (!o[k]) throw Error("MISSING_OPTION:" + k);
    const run = o.run ?? (await prepare(o));
    console.log(JSON.stringify({ run }));
    console.log(JSON.stringify(await execute(run, o.authorizeFrozenLocalAsr)));
  });
program
  .command("integrate")
  .requiredOption("--run <path>")
  .action(async (o) => console.log(JSON.stringify(await integrate(o.run))));
program
  .command("evaluate")
  .requiredOption("--run <path>")
  .action(async (o) => {
    const { evaluate } = await import("./lib/local-asr-evaluation.mjs");
    console.log(JSON.stringify(await evaluate(o.run)));
  });
program
  .command("verify")
  .requiredOption("--run <path>")
  .action(async (o) => {
    const r = await verifyIntegration(o.run);
    if (await exists(path.join(o.run, "results-freeze.json"))) {
      const { verifyResults } = await import("./lib/local-asr-evaluation.mjs");
      await verifyResults(o.run);
    }
    console.log(
      JSON.stringify({
        verified: true,
        before: r.input.baseline.length,
        inserted: r.result.inserted.length,
        after: r.result.records.length,
        newASR: 0,
      }),
    );
  });
await program.parseAsync();
