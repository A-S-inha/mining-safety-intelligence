import { findRelevantAccidents, summarizeForAgent } from "../tools/mshaDataTool";

export type RunMuePreparationInput = {
  mineType?: string;
  keyword?: string;
};

export async function runMuePreparation(input: RunMuePreparationInput) {
  const matches = findRelevantAccidents(input);
  const summarized = summarizeForAgent(matches);

  return {
    mineType: input.mineType ?? "",
    keyword: input.keyword ?? "",
    totalRecordsAnalyzed: summarized.length,
    records: summarized,
  };
}