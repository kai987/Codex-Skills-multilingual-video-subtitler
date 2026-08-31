import { describe, expect, it } from "vitest";
import { z } from "zod";
import { c61211GeneratedSchemas, c61211MapSchema } from "@mvl/shared";
import { c61211Fixture } from "./helpers/c61211-fixture.js";
import { partitionC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/monotonic-partition-solver.js";
import { validateC61211Artifact } from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import { verifyC61211SchemaContracts } from "../packages/video-subtitler/src/consensus/evaluation-partition/artifact-validator.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";

describe("C6.1.2.1.1 strict, version-separated artifact contracts", () => {
  it.each(c61211GeneratedSchemas)(
    "requires additionalProperties=false at every object in %s",
    (_name, schema) => {
      const walk = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
          value.forEach(walk);
          return;
        }
        const row = value as Record<string, unknown>;
        if (row.type === "object") expect(row.additionalProperties).toBe(false);
        Object.values(row).forEach(walk);
      };
      walk(
        z.toJSONSchema(schema, {
          target: "draft-2020-12",
          unrepresentable: "any",
        }),
      );
    },
  );
  it("matches all generated JSON Schemas to their strict source definitions", async () => {
    expect(
      await verifyC61211SchemaContracts(process.cwd()),
    ).toBeGreaterThanOrEqual(495);
    expect(c61211GeneratedSchemas).toHaveLength(39);
  });
  it.each(["root", "component", "block", "node-overlap"])(
    "rejects unknown properties in %s",
    (level) => {
      const { map } = partitionC61211(c61211Fixture().input);
      const target =
        level === "root"
          ? map
          : level === "component"
            ? c612Defined(map.components[0])
            : level === "block"
              ? c612Defined(map.blocks[0])
              : c612Defined(c612Defined(map.blocks[0]).nodeRetainedOverlap[0]);
      Object.assign(target, { privateGoldText: "forbidden" });
      expect(() => c61211MapSchema.parse(map)).toThrow();
    },
  );
  it.each(["policy", "version", "semantic"])(
    "rejects %s identity drift",
    (field) => {
      const { map } = partitionC61211(c61211Fixture().input);
      if (field === "policy") map.policyHash = "0".repeat(64);
      if (field === "version")
        Object.assign(map, { policyVersion: "c6.1.2.1" });
      if (field === "semantic") map.semanticHash = "0".repeat(64);
      expect(() => validateC61211Artifact(map)).toThrow();
    },
  );
  it("does not alias a legacy E2 map to an E3 artifact", () => {
    const p = partitionC61211(c61211Fixture().input);
    expect(() => validateC61211Artifact(p.graph.map)).toThrow(
      "UNKNOWN_ARTIFACT",
    );
    expect(p.map.e2MapHash).toBe(p.graph.map.semanticHash);
    expect(p.map.semanticHash).not.toBe(p.graph.map.semanticHash);
  });
});
