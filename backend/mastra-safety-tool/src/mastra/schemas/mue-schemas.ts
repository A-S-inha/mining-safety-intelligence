import { z } from 'zod';
import { mueGroundingReportSchema } from '../lib/mue-grounding';

/** Matches tool / queryMshaAccidents output for workflow wiring */
export const mshaSearchBundleSchema = z.object({
  records: z.array(
    z.object({
      documentNo: z.string(),
      subunit: z.string(),
      accidentType: z.string(),
      degreeInjuryCd: z.string(),
      degreeInjury: z.string(),
      classification: z.string(),
      narrative: z.string(),
      coalMetalInd: z.string(),
      ugLocation: z.string(),
      miningEquip: z.string(),
      calYr: z.string(),
    }),
  ),
  totalMatched: z.number(),
  truncated: z.boolean(),
  filePath: z.string(),
  matchedFatalityCount: z.number(),
  sampleFatalityCount: z.number(),
  retrievalMode: z.enum(['token', 'bm25']),
});

export type MshaSearchBundle = z.infer<typeof mshaSearchBundleSchema>;

/**
 * Planner output driving MSHA tool calls.
 * NIM / Llama sometimes omits fields or returns 504; defaults keep the workflow from failing on partial JSON.
 */
export const mueSearchPlanSchema = z.object({
  keyword: z
    .string()
    .default('')
    .describe('Primary hazard or equipment terms to match narratives and classifications'),
  mineTypeHint: z
    .string()
    .default('')
    .describe('Mine context: e.g. underground coal, surface metal, mill; empty string if unknown'),
  alternateKeywords: z
    .array(z.string())
    .max(5)
    .default([])
    .describe('Fallback single-token or shorter phrases if the primary keyword is too narrow'),
  rationale: z
    .string()
    .default('')
    .describe('One sentence: how the plan maps the user request to MSHA fields'),
});

export type MueSearchPlan = z.infer<typeof mueSearchPlanSchema>;

/** Fill empty planner fields from user input (after LLM partial / flaky structured output). */
export function finalizeMueSearchPlan(
  parsed: MueSearchPlan,
  userKeyword: string,
  userMineType: string,
): MueSearchPlan {
  const kw = userKeyword.trim();
  const mt = userMineType.trim();
  const keyword = parsed.keyword.trim() || kw;
  const alts = parsed.alternateKeywords
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 5);
  return {
    keyword,
    mineTypeHint: parsed.mineTypeHint.trim(),
    alternateKeywords: alts.length > 0 ? alts : kw ? [kw] : [],
    rationale:
      parsed.rationale.trim() ||
      `Map user hazard "${kw}"${mt ? ` and mine type "${mt}"` : ''} to MSHA narrative/classification search terms.`,
  };
}

/** v1 — LLM-only output (groundingReport is added in the workflow after validation). */
export const mueFinderLlmSchema = z.object({
  querySummary: z.string().describe('How records were scoped (mine context, keyword, serious/fatal filter)'),
  candidateMues: z.array(
    z.object({
      rank: z.number().int().min(1),
      title: z.string().describe('Short MUE-style name'),
      description: z.string().describe('One-line description'),
      incidentCount: z.number().int().min(0),
      fatalityCount: z.number().int().min(0),
      commonInjuryTypes: z.array(z.string()).describe('Most frequent DEGREE_INJURY / nature patterns in the cluster'),
      narrativeSummary: z.string().describe('One paragraph plain English grounded in the supplied records'),
      materialityFlag: z.enum(['high', 'medium', 'low']).describe('CCM-style potential for catastrophic harm'),
      supportingDocumentNos: z
        .array(z.string())
        .max(30)
        .describe('MSHA DOCUMENT_NO values from the provided records only — never invent IDs'),
    }),
  ),
  dataNotes: z.string().describe('Limitations, e.g. truncated sample size or broadened search'),
});

/** v1 — API / UI payload including deterministic grounding metrics */
export const mueFinderResultSchema = mueFinderLlmSchema.extend({
  groundingReport: mueGroundingReportSchema.describe(
    'Server-computed checks: citation validity vs retrieval sample and fatality consistency on cited rows',
  ),
});

export type MueFinderResult = z.infer<typeof mueFinderResultSchema>;
