import {
  findRelevantAccidents,
  summarizeForAgent,
  loadIndexedAccidentData,
} from "../tools/mshaDataTool";

export type RunMuePreparationInput = {
  mineType?: string;
  keyword?: string;
};

export async function runMuePreparation(input: RunMuePreparationInput) {
  console.log("[runMuePreparation] input", input);

  const allRows = loadIndexedAccidentData();
  const totalDatasetSize = allRows.length;

  const matches = findRelevantAccidents(input);
  const summarized = summarizeForAgent(matches);

  console.log("[runMuePreparation] stats", {
    totalDatasetSize,
    matchedRows: matches.length,
    summarizedRows: summarized.length,
  });

  return {
    mineType: input.mineType ?? "",
    keyword: input.keyword ?? "",
    totalRecordsAnalyzed: totalDatasetSize,
    matchedRecords: matches.length,
    records: summarized,
  };
}