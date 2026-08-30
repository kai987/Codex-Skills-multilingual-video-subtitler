import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { atomicWriteJson } from "@mvl/shared";
import {
  machineQualitySemanticHash,
  writeC60112ReviewWorkspace,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";
import { c60113FileHash, readC60113Json } from "./lib/c60113-acceptance-io.js";

const { values } = parseArgs({
  options: {
    workspace: { type: "string", multiple: true },
    output: { type: "string" },
  },
});
if (!values.workspace?.length || !values.output)
  throw new Error("--workspace and --output required");
const receipts = [];
for (const workspace of values.workspace) {
  const dataPath = path.join(workspace, "review-data.json");
  const dataBefore = await c60113FileHash(dataPath);
  const data = (await readC60113Json(dataPath)) as C60112ReviewWorkspaceData;
  const stage = await mkdtemp(path.join(tmpdir(), "c60113-ui-assets-"));
  await writeC60112ReviewWorkspace({
    workspaceDirectory: stage,
    reviewData: data,
  });
  if (
    machineQualitySemanticHash(
      await readC60113Json(path.join(stage, "review-data.json")),
    ) !== machineQualitySemanticHash(data)
  )
    throw new Error("UI_ASSET_REFRESH_CHANGED_FROZEN_WORKSPACE");
  const assets = [];
  for (const name of ["index.html", "assets/review.js", "assets/review.css"]) {
    const before = await c60113FileHash(path.join(workspace, name));
    await cp(path.join(stage, name), path.join(workspace, name));
    assets.push({
      name,
      before,
      after: await c60113FileHash(path.join(workspace, name)),
    });
  }
  const dataAfter = await c60113FileHash(dataPath);
  if (dataBefore !== dataAfter) throw new Error("FROZEN_DATA_CHANGED");
  receipts.push({
    workspace: path.basename(workspace),
    workspaceDataHash: machineQualitySemanticHash(data),
    dataByteHash: dataAfter,
    assets,
  });
}
await atomicWriteJson(values.output, {
  schemaVersion: "1.0.0",
  purpose: "UI_ASSET_BUGFIX_ONLY_FROZEN_MACHINE_INPUTS_UNCHANGED",
  receipts,
});
process.stdout.write(`${JSON.stringify(receipts, null, 2)}\n`);
