import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
it("enforces Gold read, subprocess, addon and network denial at OS/runtime boundary", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "c60117-isolation-"));
  const gold = path.join(root, "sealed-reference.txt");
  writeFileSync(gold, "NEUTRAL TEST SECRET");
  const code = `import fs from 'node:fs'; import {execFileSync} from 'node:child_process'; import net from 'node:net';
 const denied={};for(const [k,f]of Object.entries({gold:()=>fs.readFileSync(${JSON.stringify(gold)}),child:()=>execFileSync('/usr/bin/true'),addon:()=>process.dlopen({exports:{}},'/nonexistent.node')})){try{f();denied[k]=false;}catch(e){denied[k]=k==='addon'?e.code==='ERR_DLOPEN_DISABLED':e.code==='ERR_ACCESS_DENIED';}}
 await new Promise((resolve,reject)=>{const s=net.createConnection({host:'127.0.0.1',port:9});s.on('error',e=>{denied.network=['EPERM','EACCES'].includes(e.code);resolve();});s.on('connect',()=>reject(Error('network allowed')));s.setTimeout(1000,()=>{s.destroy();reject(Error('network timeout'));});});console.log(JSON.stringify(denied));`;
  const out = execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      "(version 1)(allow default)(deny network*)",
      process.execPath,
      "--permission",
      "--input-type=module",
      "-e",
      code,
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 5000 },
  );
  expect(JSON.parse(out)).toEqual({
    gold: true,
    child: true,
    addon: true,
    network: true,
  });
});
