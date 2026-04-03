import { runMuePreparation } from "./workflows/runMuePreparation";

async function main() {
  const result = await runMuePreparation({
    mineType: "coal",
    keyword: "fall",
  });

  console.log("Total prepared records:", result.totalRecordsAnalyzed);
  console.log(JSON.stringify(result.records.slice(0, 3), null, 2));
}

main().catch((error) => {
  console.error("Test failed:", error);
});