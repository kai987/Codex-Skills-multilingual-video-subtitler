import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  configSchema,
  manifestSchema,
  evidenceSchema,
} from "../packages/video-subtitler/dist/standalone/tool.js";
const root = path.resolve(import.meta.dirname, "../schemas/subtitle-tool-v1");
await fs.mkdir(root, { recursive: true });
for (const [name, schema] of Object.entries({
  configuration: configSchema,
  task: manifestSchema,
  "primary-evidence": evidenceSchema,
}))
  await fs.writeFile(
    path.join(root, name + ".schema.json"),
    JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n",
  );
