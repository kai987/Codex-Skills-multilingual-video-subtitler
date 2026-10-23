import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { durableJson141 } from "../../packages/video-subtitler/src/review/c601141-io.js";
import { policy141 } from "../../packages/video-subtitler/src/review/c601141-policy.js";

export async function fingerprintControls141(directory: string) {
  const file = path.join(directory, "synthetic-fingerprint-input.json");
  await durableJson141(file, {
    policy: policy141().fingerprint,
    views: [],
    clips: [],
  });
  const { stdout } = await promisify(execFile)(
    process.env.MVL_C601141_FINGERPRINT_TEST_PYTHON ?? "python3",
    ["scripts/runtime/c601141_audio_fingerprint.py", "--input", file],
    {
      cwd: process.cwd(),
      timeout: 30000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  return JSON.parse(stdout) as {
    controls: {
      passed: boolean;
      statuses: Record<string, string>;
      exactOffsetErrorSamples: number;
      gainOffsetErrorSamples: number;
      goldInputCount: number;
    };
    results: unknown[];
  };
}
