import "dotenv/config";
import { mastra } from "./index";
import { runMuePreparation } from "./workflows/runMuePreparation";
import { buildMueUserPrompt } from "./agents/mueAgent";
import { findMuesResponseSchema } from "./agents/mueSchema";

async function main() {
  const prepared = await runMuePreparation({
    mineType: "coal",
    keyword: "fall",
  });

  console.log("Prepared records:", prepared.totalRecordsAnalyzed);

  const agent = mastra.getAgentById("mue-agent");
  const limitedRecords = prepared.records.slice(0, 15);
  if (!agent) {
    throw new Error("mue-agent is not registered.");
  }

  const prompt = buildMueUserPrompt({
    mineType: prepared.mineType,
    keyword: prepared.keyword,
    records: limitedRecords,
  });

  const response = await agent.generate(prompt, {
    structuredOutput: {
      schema: findMuesResponseSchema,
    },
  });

  console.log("Structured object:");
  console.log(JSON.stringify(response.object, null, 2));
}

main().catch((error) => {
  console.error("Agent test failed:", error);
});