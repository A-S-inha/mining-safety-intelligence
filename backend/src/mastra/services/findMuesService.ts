import { mastra } from "../index";
import { runMuePreparation } from "../workflows/runMuePreparation";
import {
  buildMueUserPrompt,
  mueAgentInputSchema,
} from "../agents/mueAgent";
import { findMuesResponseSchema } from "../agents/mueSchema";

export type FindMuesServiceInput = {
  mineType?: string;
  keyword?: string;
};

const NO_MATCH_MESSAGE =
  "No MSHA accident records matched your filters (mine type, keyword, and severity). Try different keywords or a broader mine type.";

export async function findMuesWithAgent(input: FindMuesServiceInput) {
  const prepared = await runMuePreparation(input);

  console.log("[find-mues] preparation", {
    mineType: prepared.mineType,
    keyword: prepared.keyword,
    totalRecordsAnalyzed: prepared.totalRecordsAnalyzed,
  });

  if (prepared.records.length === 0) {
    console.log("[find-mues] no matching records — skipping LLM");
    return {
      totalRecordsAnalyzed: 0,
      recordsSentToModel: 0,
      candidates: [],
      noMatchingRecords: true,
      message: NO_MATCH_MESSAGE,
    };
  }

  const limitedRecords = prepared.records.slice(0, 8);

  const agentInput = mueAgentInputSchema.parse({
    mineType: prepared.mineType,
    keyword: prepared.keyword,
    records: limitedRecords,
  });

  const prompt = buildMueUserPrompt(agentInput);

  const agent = mastra.getAgentById("mue-agent");

  if (!agent) {
    throw new Error("mue-agent is not registered.");
  }

  const response = await agent.generate(prompt, {
    structuredOutput: {
      schema: findMuesResponseSchema,
      jsonPromptInjection: true,
    },
  });

  const validated = findMuesResponseSchema.parse(response.object);

  return {
    totalRecordsAnalyzed: prepared.totalRecordsAnalyzed,
    recordsSentToModel: limitedRecords.length,
    candidates: validated,
    noMatchingRecords: false,
    message: undefined as string | undefined,
  };
}