import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { InputError } from "./errors.js";

export interface JsonSchemaValidationResult {
  valid: boolean;
  errors: readonly ErrorObject[];
}

export function compileJsonSchema(schema: object): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const addFormats = addFormatsModule as unknown as (
    instance: Ajv2020,
  ) => Ajv2020;
  addFormats(ajv);
  return ajv.compile(schema);
}

export function validateJsonSchema(
  validate: ValidateFunction,
  value: unknown,
): JsonSchemaValidationResult {
  const valid = validate(value);
  return { valid, errors: validate.errors ?? [] };
}

export function assertJsonSchema(
  validate: ValidateFunction,
  value: unknown,
): void {
  const result = validateJsonSchema(validate, value);
  if (!result.valid) {
    throw new InputError("JSON Schema validation failed.", {
      errors: result.errors.map((error) => ({
        instancePath: error.instancePath,
        keyword: error.keyword,
        message: error.message,
      })),
    });
  }
}
