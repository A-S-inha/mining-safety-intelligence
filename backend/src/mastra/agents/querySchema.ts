import { z } from "zod";

export const queryUnderstandingResponseSchema = z.object({
  normalizedMineType: z.string(),
  expandedKeywords: z.array(z.string()),
  interpretation: z.string(),
});

export type QueryUnderstandingResponse = z.infer<
  typeof queryUnderstandingResponseSchema
>;