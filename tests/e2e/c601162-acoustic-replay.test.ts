import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
import { evidence } from "../helpers/c60116-quality-fixture.js";
import {
  matchedEvidenceSchema,
  replayPrimaryAssembly,
} from "../../packages/video-subtitler/src/machine-quality/matched-replay.js";
import {
  deriveAcousticCases,
  ACOUSTIC_POLICY,
} from "../../packages/video-subtitler/src/machine-quality/bounded-acoustic.js";
import {
  objectHash,
  sha256,
} from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";
it("generates deterministic E0/E1 from the same evidence with unavailable acoustics, no provider and no reference", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "c601162-test-"));
  try {
    const old = evidence(),
      primary = matchedEvidenceSchema.parse({
        version: "c601161-primary-evidence-v1",
        partition: old.partition,
        source: old.source,
        primaryRequests: old.primaryRequests,
        promptStatus: "HISTORICAL_TITLE_PROMPTED_EVIDENCE",
      });
    const bytes = JSON.stringify(primary),
      input = path.join(temp, "primary.json"),
      bundle = path.join(temp, "bundle.json");
    fs.writeFileSync(input, bytes);
    const cases = deriveAcousticCases(
      replayPrimaryAssembly(primary, false).trace,
      replayPrimaryAssembly(primary, true).trace,
      primary.source.sourceSampleRate,
    );
    fs.writeFileSync(
      bundle,
      JSON.stringify({
        version: "c601162-evidence-v1",
        primaryHash: sha256(bytes),
        planHash: "a".repeat(64),
        policyHash: objectHash(ACOUSTIC_POLICY),
        cases,
        observations: [],
        frozenAt: new Date().toISOString(),
      }),
    );
    for (const role of ["a", "b"]) {
      const target = path.join(temp, role);
      execFileSync(process.execPath, [
        "--permission",
        "--allow-fs-read=" + process.cwd(),
        "--allow-fs-read=" + temp,
        "--allow-fs-write=" + target,
        "--allow-fs-write=" + target + "/*",
        "scripts/generate-c601162.mjs",
        input,
        bundle,
        target,
      ]);
    }
    const a = JSON.parse(
      fs.readFileSync(path.join(temp, "a/experiment-manifest.json"), "utf8"),
    ) as {
      files: unknown[];
      newInference: number;
      variants: { status: string }[];
    };
    const b = JSON.parse(
      fs.readFileSync(path.join(temp, "b/experiment-manifest.json"), "utf8"),
    ) as { files: unknown[] };
    expect(a.files).toEqual(b.files);
    for (const ext of ["ass", "srt", "vtt"])
      expect(
        fs.readFileSync(
          path.join(temp, `a/E0-observe-only/machine-candidate.${ext}`),
        ),
      ).toEqual(
        fs.readFileSync(
          path.join(temp, `a/E1-acoustic-decision/machine-candidate.${ext}`),
        ),
      );
    expect(a.newInference).toBe(0);
    expect(
      a.variants.every((v: { status: string }) => v.status === "needs-review"),
    ).toBe(true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
