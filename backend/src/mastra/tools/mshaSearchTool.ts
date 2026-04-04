import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  findRelevantAccidents,
  summarizeForAgent,
} from "./mshaDataTool";

export const mshaSearchTool = createTool({
  id: "msha-search",
  description:
    "Search MSHA accident records using mine type and/or hazard keywords, then return summarized records for MUE analysis.",

  inputSchema: z.object({
    mineType: z.string().optional().default(""),
    keyword: z.string().optional().default(""),
    maxRecords: z.coerce.number().int().min(1).max(25).optional().default(15),
  }),

  outputSchema: z.object({
    totalMatches: z.number(),
    records: z.array(
      z.object({
        rowId: z.string(),
        mineId: z.string(),
        accidentDate: z.string(),
        mineType: z.string(),
        subunit: z.string(),
        accidentType: z.string(),
        degreeInjury: z.string(),
        narrative: z.string(),
        noInjuries: z.string(),
        fatalities: z.string(),
        coalMetalInd: z.string(),
      })
    ),
  }),

  execute: async (inputData) => {
    const rows = findRelevantAccidents({
      mineType: inputData.mineType,
      keyword: inputData.keyword,
    });

    const records = summarizeForAgent(rows).slice(0, inputData.maxRecords as number);

    return {
      totalMatches: rows.length,
      records,
    };
  },
});