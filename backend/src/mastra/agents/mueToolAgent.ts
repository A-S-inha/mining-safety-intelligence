import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { findMuesResponseSchema } from "./mueSchema";
import { mshaSearchTool } from "../tools/mshaSearchTool";

export const mueToolAgentInputSchema = z.object({
  mineType: z.string().optional().default(""),
  keyword: z.string().optional().default(""),
});

export const mueToolAgentSystemPrompt = `
You are an industrial safety analyst helping identify candidate Material Unwanted Events (MUEs) from MSHA mining accident records.

You have access to a tool called "mshaSearch".
You must use this tool first to retrieve relevant MSHA accident evidence before producing any final answer.

Your task:
1. Use the mshaSearch tool with the provided mineType and keyword.
2. Review the returned accident records.
3. Cluster recurring patterns into candidate MUEs.
4. Rank candidate MUEs by recurrence and severity.
5. Return only valid JSON matching the required schema.

Rules:
- Always call the mshaSearch tool before producing candidates.
- Use only the records returned by the tool.
- Do not invent incidents, injuries, counts, causes, controls, or conclusions not grounded in the retrieved records.
- Group similar accidents into one candidate MUE when appropriate.
- Keep MUE names short and operationally meaningful.
- Return at most 3 candidate MUEs.
- Return fewer than 3 candidate MUEs if the records do not support 3 strong patterns.
- Every candidate MUE must be supported by the retrieved records only.
- incidentCount must not exceed the number of retrieved records that support that candidate.
- fatalityCount must be based only on retrieved records with fatalities = 1.
- "severity" must be exactly one of: "Low", "Medium", "High", "Critical".
- "materiality" must be exactly one of: "Material", "Review".
- "commonInjuries" should be based only on repeated injuries visible in the records.
- "summary" should be concise, plain English, and grounded in the evidence.
- Prefer recurring operational patterns visible in accidentType, degreeInjury, and narrative over generic safety language.
- Do not mention controls, recommendations, or missing safeguards.
- If the tool returns no records, return an empty array.
- Return JSON only. No markdown. No commentary.
`;

export function buildMueToolUserPrompt(
  input: z.infer<typeof mueToolAgentInputSchema>
) {
  return JSON.stringify(
    {
      query: {
        mineType: input.mineType,
        keyword: input.keyword,
      },
      toolInstruction:
        'Call the "mshaSearch" tool first using the provided query, then generate grounded MUE candidates from the returned records only.',
      outputSchema: [
        {
          id: "string",
          name: "string",
          incidentCount: "number",
          fatalityCount: "number",
          commonInjuries: ["string"],
          severity: "Low | Medium | High | Critical",
          materiality: "Material | Review",
          summary: "string",
        },
      ],
    },
    null,
    2
  );
}

export const mueToolAgent = new Agent({
  id: "mue-tool-agent",
  name: "MUE Tool Agent",
  instructions: mueToolAgentSystemPrompt,
  model: "nvidia/meta/llama-3.3-70b-instruct",
  tools: {
    mshaSearch: mshaSearchTool,
  },
});

export function validateMueToolAgentOutput(output: unknown) {
  return findMuesResponseSchema.parse(output);
}