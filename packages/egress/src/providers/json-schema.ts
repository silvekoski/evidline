import { z, type ZodType } from "zod";

export function jsonSchemaOf(schema: ZodType): Record<string, unknown> {
  const { $schema: _draft, ...rest } = z.toJSONSchema(schema);
  return rest;
}
