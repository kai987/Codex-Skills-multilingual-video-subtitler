import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";

it("pure audit runs reproducibly without child-process, addon, model or network permissions", () => {
  const source = fs.readFileSync(
    "packages/video-subtitler/src/machine-quality/timestamp-capability-audit.ts",
    "utf8",
  );
  expect(source).not.toContain("reazonspeech-k2-provider");
  expect(source).not.toContain("applyAcousticDecisions");
  const program = `
  import {auditPoints,providerCapabilities,checkActionCapabilities} from './packages/video-subtitler/dist/machine-quality/timestamp-capability-audit.js';
  import {ACOUSTIC_POLICY} from './packages/video-subtitler/dist/machine-quality/bounded-acoustic.js';
  import {spawnSync} from 'node:child_process';
  let denied=false;try{spawnSync('this-provider-must-never-start',[])}catch(e){denied=e.code==='ERR_ACCESS_DENIED'}
  if(!denied)throw Error('Child permission not denied');
  const identity={adapterHash:'neutral',runtime:'synthetic',model:'none',config:{}};
  console.log(JSON.stringify({denied,points:auditPoints([{token:'a',paddedAudioSeconds:2}],{window:{start:10,end:14},core:{start:11,end:13},padding:0.9,semantics:'VERIFIED'}),capabilities:checkActionCapabilities(providerCapabilities({whisper:identity,reazon:identity}),ACOUSTIC_POLICY,'OBSERVATION_ONLY')}));`;
  const run = () =>
    execFileSync(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${path.resolve(".")}`,
        "--input-type=module",
        "-e",
        program,
      ],
      { encoding: "utf8" },
    );
  const a = run(),
    b = run();
  expect(a).toBe(b);
  expect(a).toContain("STOP_SAME_POLICY_REINFERENCE");
});
