import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { findMuesResponseSchema } from "./mueSchema";

export const mueAgentInputSchema = z.object({
  mineType: z.string().optional().default(""),
  keyword: z.string().optional().default(""),
  records: z.array(
    z.object({
      rowId: z.string(),
      mineId: z.string(),
      accidentDate: z.string(),
      /** Derived MINE_TYPE–style label (SUBUNIT + UG_LOCATION + COAL_METAL_IND); no MINE_TYPE column in source file. */
      mineType: z.string(),
      subunit: z.string(),
      accidentType: z.string(),
      degreeInjury: z.string(),
      narrative: z.string(),
      noInjuries: z.string(),
      /** Derived 0|1 from DEGREE_INJURY (e.g. FATALITY); no FATALITIES column in this extract. */
      fatalities: z.string(),
      coalMetalInd: z.string(),
    })
  ),
});

export const mueSystemPrompt = `
You are an industrial safety analyst identifying candidate Material Unwanted Events (MUEs) from MSHA mining accident records.

Each record contains:
- rowId
- mineId
- accidentDate
- mineType
- subunit
- accidentType
- degreeInjury
- narrative
- noInjuries
- fatalities
- coalMetalInd

Use only the provided records.

Task:
- Identify repeated hazard patterns from the records
- Return the most critical patterns first

Rules:
- Return at least 1 candidate if at least 2 records show a similar pattern
- Prefer splitting clusters into narrower well defined patterns rather than merging into broad categories
- If two groups differ in mechanism for example caught in belt vs falling material, split into two candidates
- Prefer repeated accidentType patterns
- If useful, refine the name using repeated narrative or equipment wording
- Keep names short and close to the record wording
- Do not invent causes, controls, recommendations, or unsupported conclusions
- incidentCount must equal the number of supporting records
- fatalityCount must equal the number of supporting records with fatalities = 1
- commonInjuries must be based only on repeated injuries in the records
- Return at least 3 candidates
- Return fewer if fewer strong patterns exist
- Only return an empty array if no repeated pattern exists at all

Ranking:
- First by fatalityCount
- Then by incidentCount

Severity:
- Critical = any fatalities
- High = repeated serious injuries
- Medium = repeated moderate injuries
- Low = less severe repeated injuries

Materiality:
- Material = any fatalities or clearly recurring serious pattern
- Review = otherwise

Return only valid JSON matching the required schema.
No markdown.
No explanation.
JSON only.

`;

export function buildMueUserPrompt(input: z.infer<typeof mueAgentInputSchema>) {
  return JSON.stringify(
    {
      query: {
        mineType: input.mineType,
        keyword: input.keyword,
      },
      records: input.records,
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

export const mueAgent = new Agent({
  id: "mue-agent",
  name: "MUE Finder Agent",
  instructions: mueSystemPrompt,
  model: "nvidia/meta/llama-3.3-70b-instruct",
  // model: "anthropic/claude-sonnet-4-20250514",
});

export function validateMueAgentOutput(output: unknown) {
  return findMuesResponseSchema.parse(output);
}