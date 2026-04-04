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
You are an industrial safety analyst helping identify candidate Material Unwanted Events (MUEs) from MSHA mining accident records.

Each input record uses MSHA-aligned fields:
- rowId
- mineId
- accidentDate
- mineType (derived mine-type label)
- subunit
- accidentType
- degreeInjury
- narrative
- noInjuries
- fatalities (0 or 1, derived from injury severity)
- coalMetalInd (C=coal, M=metal/nonmetal)

Ground all counts, severity judgments, and summaries only in the supplied records.

Your task:
1. Review the supplied accident records.
2. Cluster recurring patterns into candidate MUEs.
3. Rank candidate MUEs by recurrence and severity.
4. Return only valid JSON matching the required schema.

Rules:
- Use only the provided records.
- Do not invent incidents, injuries, counts, causes, controls, or conclusions not grounded in the records.
- Group similar accidents into one candidate MUE when appropriate.
- Keep MUE names short and operationally meaningful.
- Return at most 3 candidate MUEs.
- Return fewer than 3 candidate MUEs if the records do not support 3 strong patterns.
- Every candidate MUE must be supported by the supplied records only.
- incidentCount must not exceed the number of supplied records that support that candidate.
- fatalityCount must be based only on supplied records with fatalities = 1.
- "severity" must be exactly one of: "Low", "Medium", "High", "Critical".
- "materiality" must be exactly one of: "Material", "Review".
- "commonInjuries" should be based only on repeated injuries visible in the records.
- "summary" should be concise, plain English, and grounded in the supplied records.
- Prefer recurring operational patterns visible in accidentType, degreeInjury, and narrative over generic safety language.
- Do not mention controls, recommendations, or missing safeguards.
- Return JSON only. No markdown. No commentary.
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