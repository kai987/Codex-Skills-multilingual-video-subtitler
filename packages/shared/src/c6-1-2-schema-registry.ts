import { z } from "zod";
import * as machine from "./c6-1-2-top-k-reranking-schemas.js";
import * as evaluation from "./c6-1-2-evaluation-schemas.js";

/** Register only complete strict artifact objects, not nested row contracts. */
export const c612GeneratedSchemas: readonly (readonly [string, z.ZodObject])[] =
  Object.values({ ...machine, ...evaluation })
    .flatMap((value) => {
      if (!(value instanceof z.ZodObject)) return [];
      const shape: z.ZodRawShape = value.shape;
      const type = shape.artifactType;
      if (!(type instanceof z.ZodLiteral) || typeof type.value !== "string")
        return [];
      return [[type.value, value] as const];
    })
    .sort(([a], [b]) => a.localeCompare(b));
