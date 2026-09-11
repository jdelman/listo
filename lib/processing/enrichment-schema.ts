import { z } from "zod";
import { ITEM_LABELS, type ItemType } from "../types";

// This schema is both sent to the model and used to validate its response.
export const specsSchema = z.object({
  name: z.string().nullable(), size: z.string().nullable(),
  measurements: z.array(z.object({ name: z.string(), value: z.union([z.string(), z.number()]), unit: z.enum(["in", "cm"]).nullable() }).strict()),
  price: z.number().nonnegative().nullable(), currency: z.string().nullable(),
  brand: z.string().nullable(), material: z.string().nullable(), color: z.string().nullable(),
  year: z.number().int().nullable(), tmdbId: z.number().int().nullable(),
  platform: z.enum(["youtube", "apple_music", "soundcloud", "other"]).nullable(),
  platformId: z.string().nullable(),
  attributes: z.array(z.object({ name: z.string(), value: z.union([z.string(), z.number(), z.array(z.string())]) }).strict()),
}).strict();
export const enrichmentSchema = z.object({
  category: z.enum(Object.keys(ITEM_LABELS) as [ItemType, ...ItemType[]]),
  description: z.string().trim().min(1), thumbnailUrl: z.string().nullable(), specs: specsSchema,
}).strict();

const nullable = (type: string) => ({ type: [type, "null"] });
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const enrichmentJsonSchema = object({
  category: { type: "string", enum: Object.keys(ITEM_LABELS) }, description: { type: "string" }, thumbnailUrl: nullable("string"),
  specs: object({
    name: nullable("string"), size: nullable("string"),
    measurements: { type: "array", items: object({ name: { type: "string" }, value: { type: ["string", "number"] }, unit: { enum: ["in", "cm", null] } }) },
    price: { ...nullable("number"), minimum: 0 }, currency: nullable("string"),
    brand: nullable("string"), material: nullable("string"), color: nullable("string"),
    year: nullable("integer"), tmdbId: nullable("integer"),
    platform: { enum: ["youtube", "apple_music", "soundcloud", "other", null] }, platformId: nullable("string"),
    attributes: { type: "array", items: object({ name: { type: "string" }, value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "array", items: { type: "string" } }] } }) },
  }),
});
