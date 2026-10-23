/** Read-only replay on two explicit machine artifacts; writes only a new directory. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { deliverShortResponseObservation } from "./lib/short-response-observation.mjs";

const fileHash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
async function physicalPath(file) {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return path.join(
      await physicalPath(path.dirname(file)),
      path.basename(file),
    );
  }
}

export async function replayShortResponseObservation(
  recordsPath,
  subtitlePath,
  outputRoot,
) {
  const output = await physicalPath(path.resolve(outputRoot));
  for (const input of [recordsPath, subtitlePath]) {
    const parent = path.dirname(await fs.realpath(input));
    if (output === parent || output.startsWith(parent + path.sep))
      throw Error("OUTPUT_INSIDE_EXISTING_EVIDENCE");
  }
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "short-response-observe-"));
  const result = await deliverShortResponseObservation({
    recordsPath,
    subtitlePath,
    outputRoot: root,
  });
  const files = [result.artifact, result.index];
  const software = [
    new URL("./subtitle-tool-observe-short-responses.mjs", import.meta.url),
    new URL("./lib/short-response-observation.mjs", import.meta.url),
    new URL("../packages/subtitle-core/dist/parse.js", import.meta.url),
  ];
  await fs.writeFile(
    path.join(root, "machine-freeze.json"),
    JSON.stringify(
      {
        version: "short-response-observation-freeze-v1",
        files: Object.fromEntries(
          await Promise.all(
            files.map(async (f) => [path.basename(f), await fileHash(f)]),
          ),
        ),
        software: await Promise.all(
          software.map(async (f) => ({
            file: f.href,
            sha256: await fileHash(f),
          })),
        ),
        referenceUsed: false,
        newInference: 0,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return { root, ...result };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [records, subtitle, output, ...extra] = process.argv.slice(2);
    if (!records || !subtitle || !output || extra.length)
      throw Error(
        "Usage: MAPPED_RECORDS_JSON PREFERRED_SRT NEW_OUTPUT_ROOT (no inference)",
      );
    console.log(
      JSON.stringify(
        await replayShortResponseObservation(records, subtitle, output),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
