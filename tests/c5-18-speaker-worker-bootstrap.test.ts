import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("C5.18 model-free Python speaker bootstrap", () => {
  it.each(["unset", "0"])(
    "forces bundled-font-only offline setup before imports when inherited setting is %s",
    (initialState) => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        MPL_IGNORE_SYSTEM_FONTS: "0",
        HF_HUB_OFFLINE: "0",
        TRANSFORMERS_OFFLINE: "0",
        HF_HUB_DISABLE_TELEMETRY: "0",
        HF_TOKEN: "neutral-fixture-not-a-credential",
        HUGGING_FACE_HUB_TOKEN: "neutral-fixture-not-a-credential",
      };
      if (initialState === "unset") {
        delete environment.MPL_IGNORE_SYSTEM_FONTS;
      }
      const result = spawnSync(
        process.env.MVL_TEST_PYTHON ?? "python3",
        [
          "-B",
          "-S",
          "tests/helpers/speaker_worker_bootstrap_stub.py",
          initialState,
        ],
        {
          cwd: process.cwd(),
          env: environment,
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 64 * 1024,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout) as unknown).toEqual({
        initialSystemFontsSetting: initialState,
        systemFontsIgnoredBeforeImport: true,
        offlineEnvironmentVerified: true,
        tokenEnvironmentStripped: true,
        firstThirdPartyImportDenied: "numpy",
        thirdPartyModulesLoaded: 0,
        realModelLoads: 0,
        realAcousticForwards: 0,
      });
    },
  );
});
