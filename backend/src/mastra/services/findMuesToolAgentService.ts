import { z } from "zod";

import { mastra } from "../index";

import {
  mueToolAgentInputSchema,
  buildMueToolUserPrompt,
} from "../agents/mueToolAgent";

import { findMuesResponseSchema } from "../agents/mueSchema";

import {
  queryUnderstandingInputSchema,
  buildQueryUnderstandingPrompt,
} from "../agents/queryUnderstandingAgent";

import { queryUnderstandingResponseSchema } from "../agents/querySchema";

import {
  findRelevantAccidents,
  summarizeForAgent,
} from "../tools/mshaDataTool";

const NO_MATCH_MESSAGE =
  "No MSHA accident records matched your filters. Try broader or different keywords.";

export type FindMuesToolAgentInput = {
  mineType?: string;
  keyword?: string;
};

const TOOL_MAX_RECORDS = 15;

export type FindMuesToolAgentResult = {
  candidates: z.infer<typeof findMuesResponseSchema>;
  interpretation: z.infer<typeof queryUnderstandingResponseSchema>;
  totalRecordsAnalyzed: number;
  recordsSentToModel: number;
  noMatchingRecords: boolean;
  message?: string;
};

export async function findMuesWithToolAgentFlow(
  input: FindMuesToolAgentInput
): Promise<FindMuesToolAgentResult> {
  console.log("[tool-agent] input", input);

  const queryAgent = mastra.getAgentById("query-understanding-agent");
  const mueToolAgent = mastra.getAgentById("mue-tool-agent");

  if (!queryAgent) {
    throw new Error("query-understanding-agent is not registered.");
  }

  if (!mueToolAgent) {
    throw new Error("mue-tool-agent is not registered.");
  }

  // STEP 1: Query understanding
  const queryInput = queryUnderstandingInputSchema.parse(input);

  const queryResponse = await queryAgent.generate(
    buildQueryUnderstandingPrompt(queryInput),
    {
      structuredOutput: {
        schema: queryUnderstandingResponseSchema,
        jsonPromptInjection: true,
      },
    }
  );

  const interpreted = queryUnderstandingResponseSchema.parse(
    queryResponse.object
  );

  console.log("[tool-agent] interpretation", interpreted);

  // STEP 2: Merge keywords
  const keywords = Array.from(
    new Set(
      [input.keyword ?? "", ...interpreted.expandedKeywords].filter(Boolean)
    )
  );

  const mergedKeyword = keywords.join(" ");

  console.log("[tool-agent] mergedKeyword", mergedKeyword);

  const mineTypeForSearch =
    interpreted.normalizedMineType || input.mineType || "";

  const rows = findRelevantAccidents({
    mineType: mineTypeForSearch,
    keyword: mergedKeyword,
  });

  const summarized = summarizeForAgent(rows);
  const cappedForMeta = summarized.slice(0, TOOL_MAX_RECORDS);

  console.log("[tool-agent] retrieval stats", {
    matchedRows: rows.length,
    summarizedRows: summarized.length,
    recordsSentToModelCap: cappedForMeta.length,
  });

  if (rows.length === 0) {
    return {
      candidates: [],
      interpretation: interpreted,
      totalRecordsAnalyzed: 0,
      recordsSentToModel: 0,
      noMatchingRecords: true,
      message: NO_MATCH_MESSAGE,
    };
  }

  // STEP 3: Call MUE TOOL AGENT (it will call mshaSearchTool internally)
  const agentInput = mueToolAgentInputSchema.parse({
    mineType: mineTypeForSearch,
    keyword: mergedKeyword,
  });

  const response = await mueToolAgent.generate(
    buildMueToolUserPrompt(agentInput),
    {
      structuredOutput: {
        schema: findMuesResponseSchema,
        jsonPromptInjection: true,
      },
    }
  );

  const validated = findMuesResponseSchema.parse(response.object);

  console.log("[tool-agent] candidates", validated);

  return {
    candidates: validated,
    interpretation: interpreted,
    totalRecordsAnalyzed: rows.length,
    recordsSentToModel: cappedForMeta.length,
    noMatchingRecords: false,
  };
}