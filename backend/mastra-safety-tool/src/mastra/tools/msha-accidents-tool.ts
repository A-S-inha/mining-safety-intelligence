import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { queryMshaAccidents } from '../lib/msha-query';

export const mshaAccidentsTool = createTool({
  id: 'search-msha-accidents',
  description:
    'Search local MSHA accident/injury records (pipe-delimited Accidents.txt). Filters to serious/fatal outcomes by default. Matching: token mode (all words as substrings) or BM25 when MSHA_RETRIEVAL_MODE=bm25. Each record includes degreeInjuryCd; in token mode the returned sample is ordered by injury code severity (01 first) when MSHA_SAMPLE_FATALITY_FIRST is enabled. Returns a sample plus totalMatched.',
  inputSchema: z.object({
    keyword: z.string().describe('Hazard or equipment terms; all tokens must appear in narrative/classification/equipment fields'),
    mineTypeHint: z.string().describe('Mine context, e.g. underground coal, surface metal'),
    maxRecords: z
      .number()
      .int()
      .min(10)
      .max(200)
      .optional()
      .describe('Max rows to return (default 80)'),
    ignoreMineContext: z
      .boolean()
      .optional()
      .describe('If true, ignore underground/surface/coal/metal filter'),
    includeAllSeverities: z
      .boolean()
      .optional()
      .describe('If true, include minor injuries (not recommended for MUE finder)'),
  }),
  outputSchema: z.object({
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
  }),
  execute: async (input) => {
    const maxRecords = input.maxRecords ?? 80;
    return queryMshaAccidents({
      keyword: input.keyword,
      mineTypeHint: input.mineTypeHint,
      maxRecords,
      ignoreMineContext: input.ignoreMineContext,
      includeAllSeverities: input.includeAllSeverities,
    });
  },
});
