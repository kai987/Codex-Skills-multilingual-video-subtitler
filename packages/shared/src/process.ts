import { spawn } from "node:child_process";

import { ExternalProcessError, MissingDependencyError } from "./errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunProcessOptions {
  cwd?: string;
  allowNonZero?: boolean;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
}

export interface ProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: RunProcessOptions,
  ): Promise<ProcessResult>;
}

export class NodeProcessRunner implements ProcessRunner {
  async run(
    executable: string,
    args: readonly string[],
    options: RunProcessOptions = {},
  ): Promise<ProcessResult> {
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        env: options.environment ?? process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });
      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      const timeout =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        if (error.code === "ENOENT") {
          reject(new MissingDependencyError(executable));
          return;
        }
        reject(new ExternalProcessError(executable, null, stderr, error));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        const exitCode = code ?? 1;
        if (exitCode !== 0 && options.allowNonZero !== true) {
          reject(new ExternalProcessError(executable, code, stderr));
          return;
        }
        resolve({ stdout, stderr, exitCode });
      });
    });
  }
}

export async function assertExecutable(
  runner: ProcessRunner,
  executable: string,
): Promise<void> {
  try {
    await runner.run(executable, ["-version"]);
  } catch (error) {
    if (error instanceof MissingDependencyError) throw error;
    throw new MissingDependencyError(executable);
  }
}
