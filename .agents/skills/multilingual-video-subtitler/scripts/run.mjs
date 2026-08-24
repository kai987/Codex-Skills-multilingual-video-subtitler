#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const argumentsFromUser = process.argv.slice(2);
const requestedMode = argumentsFromUser[0];
const script =
  requestedMode === "finalize"
    ? "subtitle-finalize"
    : requestedMode === "review"
      ? "subtitle-review"
      : "subtitle";
const forwardedArguments =
  requestedMode === "finalize" || requestedMode === "review"
    ? argumentsFromUser.slice(1)
    : argumentsFromUser;
const child = spawn("npm", ["run", script, "--", ...forwardedArguments], {
  cwd: repositoryRoot,
  shell: false,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
