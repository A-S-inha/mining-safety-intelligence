import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { queryUnderstandingResponseSchema } from "./querySchema";

export const queryUnderstandingInputSchema = z.object({
  mineType: z.string().optional().default(""),
  keyword: z.string().optional().default(""),
});

const queryUnderstandingSystemPrompt = `
You interpret user search intent for MSHA mining accident retrieval.

The user may provide:
- a mine type
- a hazard keyword
- or both

Your job:
1. Normalize the mineType into a short, clean search phrase if provided.
2. Expand the keyword into a conservative list of closely related mining hazard search terms.
3. Keep the expansions relevant to mining accident records and likely narrative wording.
4. Return only valid JSON matching the required schema.

Rules:
- Be conservative. Only include terms that are closely related to the user's input.
- Do not invent unrelated hazards or broad safety topics.
- Preserve the user's original meaning.
- If mineType is empty, return an empty string for normalizedMineType.
- If keyword is empty, return an empty array for expandedKeywords.
- Include the original keyword in expandedKeywords if keyword is provided.
- Prefer short phrases that might realistically appear in accident narratives.
- Return JSON only. No markdown. No commentary.
`;

export function buildQueryUnderstandingPrompt(
  input: z.infer<typeof queryUnderstandingInputSchema>
) {
  return JSON.stringify(
    {
      query: {
        mineType: input.mineType,
        keyword: input.keyword,
      },
      outputSchema: {
        normalizedMineType: "string",
        expandedKeywords: ["string"],
        interpretation: "string",
      },
    },
    null,
    2
  );
}

export const queryUnderstandingAgent = new Agent({
  id: "query-understanding-agent",
  name: "Query Understanding Agent",
  instructions: queryUnderstandingSystemPrompt,
  model: "nvidia/meta/llama-3.3-70b-instruct",
  // model: "anthropic/claude-sonnet-4-20250514",
});

export function validateQueryUnderstandingOutput(output: unknown) {
  return queryUnderstandingResponseSchema.parse(output);
}