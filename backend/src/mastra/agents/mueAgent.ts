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

Each input record contains:
- rowId
- mineId
- accidentDate
- mineType
- subunit
- accidentType
- degreeInjury
- narrative
- noInjuries
- fatalities (0 or 1)
- coalMetalInd (C=coal, M=metal/nonmetal)

You MUST base all reasoning strictly on the provided records.

--------------------------------------------------
OBJECTIVE
--------------------------------------------------

Identify the MOST CRITICAL recurring operational hazard patterns (MUEs), supported directly by the records.

--------------------------------------------------
DEFINITION OF A VALID MUE
--------------------------------------------------

A valid MUE must:
- Represent a CLEAR, REPEATED pattern across MULTIPLE records (minimum 2)
- Be directly observable from narrative, accidentType, or injury fields
- Use terminology that appears explicitly in the records (avoid abstraction)

INVALID examples:
- Generic categories like "Equipment Interaction", "Over-exertion", "Falling Objects"
- Any label not clearly supported by repeated wording in narratives

VALID examples:
- "Conveyor Belt Contact Injuries"
- "Lime Exposure to Eyes"
- "Caught Between Belt and Roller"

--------------------------------------------------
TASK
--------------------------------------------------

1. Identify clusters of records that share clear overlapping terms or patterns.
2. Only form a cluster if at least 2 records support it.
3. For each cluster:
   - Count supporting records → incidentCount
   - Count fatalities → fatalityCount
   - Extract repeated injury types → commonInjuries
4. Rank clusters using:
   - PRIMARY: fatalityCount (higher = more critical)
   - SECONDARY: incidentCount (higher = more frequent)
5. Return the TOP 3 most critical MUEs (or fewer if not enough strong patterns exist).

--------------------------------------------------
STRICT RULES
--------------------------------------------------

- Use ONLY the provided records. No external knowledge.
- DO NOT infer causes, controls, or missing safeguards.
- DO NOT generalize beyond visible evidence.
- DO NOT create a cluster unless it is clearly supported by ≥2 records.
- MUE names MUST include words present in the narratives or accidentType.
- incidentCount MUST equal the number of supporting records.
- fatalityCount MUST equal the number of supporting records with fatalities = 1.
- If records are weak or inconsistent, return fewer candidates.

--------------------------------------------------
SEVERITY CLASSIFICATION
--------------------------------------------------

Assign severity based ONLY on observed data:

- Critical → any fatalities present
- High → multiple serious injuries (days away / restricted)
- Medium → moderate injury patterns
- Low → minor or infrequent injuries

--------------------------------------------------
MATERIALITY
--------------------------------------------------

- Material → high recurrence OR any fatalities
- Review → lower recurrence and no fatalities

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------

Return ONLY valid JSON matching this schema:

[
  {
    "id": "string",
    "name": "string",
    "incidentCount": number,
    "fatalityCount": number,
    "commonInjuries": ["string"],
    "severity": "Low | Medium | High | Critical",
    "materiality": "Material | Review",
    "summary": "string"
  }
]

- summary must describe the pattern using only evidence from records.
- No markdown. No explanation. JSON only.
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