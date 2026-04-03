import { z } from "zod";

export const severitySchema = z.enum(["Low", "Medium", "High", "Critical"]);

export const materialitySchema = z.enum(["Material", "Review"]);

export const mueItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  incidentCount: z.number(),
  fatalityCount: z.number(),
  commonInjuries: z.array(z.string()),
  severity: severitySchema,
  materiality: materialitySchema,
  summary: z.string(),
});

export const findMuesResponseSchema = z.array(mueItemSchema);

export type MUEItem = z.infer<typeof mueItemSchema>;
export type FindMuesResponse = z.infer<typeof findMuesResponseSchema>;