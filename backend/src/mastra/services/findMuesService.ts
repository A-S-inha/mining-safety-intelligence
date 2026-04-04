import { mastra } from "../index";
import { runMuePreparation } from "../workflows/runMuePreparation";
import {
  buildMueUserPrompt,
  mueAgentInputSchema,
} from "../agents/mueAgent";
import { findMuesResponseSchema } from "../agents/mueSchema";

type Candidate = {
  id: string;
  name: string;
  incidentCount: number;
  fatalityCount: number;
  commonInjuries: string[];
  severity: "Low" | "Medium" | "High" | "Critical";
  materiality: "Material" | "Review";
  summary: string;
};

type EvidenceRecord = {
  rowId: string;
  mineId: string;
  accidentDate: string;
  accidentType: string;
  degreeInjury: string;
  narrative: string;
};

export type FindMuesServiceInput = {
  mineType?: string;
  keyword?: string;
};

export type FindMuesServiceResult = {
  totalRecordsAnalyzed: number;
  matchedRecords: number;
  recordsSentToModel: number;
  candidates: Candidate[];
  evidenceSample: EvidenceRecord[];
  evidenceForEvaluation: EvidenceRecord[];
  noMatchingRecords: boolean;
  message?: string;
  validationError: string | null;
};

const NO_MATCH_MESSAGE =
  "No MSHA accident records matched your filters (mine type, keyword, and severity). Try different keywords or a broader mine type.";

function mapEvidenceRecord(record: {
  rowId: string;
  mineId: string;
  accidentDate: string;
  accidentType: string;
  degreeInjury: string;
  narrative: string;
}): EvidenceRecord {
  return {
    rowId: record.rowId,
    mineId: record.mineId,
    accidentDate: record.accidentDate,
    accidentType: record.accidentType,
    degreeInjury: record.degreeInjury,
    narrative: record.narrative,
  };
}

function groundedValidateMues(
  candidates: Candidate[],
  evidenceRecords: Array<{ fatalities: string }>
): string | null {
  const maxIncidents = evidenceRecords.length;
  const maxFatalities = evidenceRecords.reduce(
    (sum, r) => sum + Number(r.fatalities || "0"),
    0
  );

  for (const candidate of candidates) {
    if (candidate.incidentCount > maxIncidents) {
      return `Invalid incidentCount for ${candidate.name}: ${candidate.incidentCount} > ${maxIncidents}`;
    }

    if (candidate.fatalityCount > maxFatalities) {
      return `Invalid fatalityCount for ${candidate.name}: ${candidate.fatalityCount} > ${maxFatalities}`;
    }

    if (!candidate.summary || candidate.summary.trim().length < 20) {
      return `Weak summary for ${candidate.name}`;
    }
  }

  return null;
}

export async function findMuesWithAgent(
  input: FindMuesServiceInput
): Promise<FindMuesServiceResult> {
  const prepared = await runMuePreparation(input);

  console.log("[find-mues] preparation", {
    mineType: prepared.mineType,
    keyword: prepared.keyword,
    totalDatasetSize: prepared.totalRecordsAnalyzed,
    matchedRecords: prepared.matchedRecords,
  });

  if (prepared.records.length === 0) {
    console.log("[find-mues] no matching records — skipping LLM");
    return {
      totalRecordsAnalyzed: prepared.totalRecordsAnalyzed,
      matchedRecords: 0,
      recordsSentToModel: 0,
      candidates: [],
      evidenceSample: [],
      evidenceForEvaluation: [],
      noMatchingRecords: true,
      message: NO_MATCH_MESSAGE,
      validationError: null,
    };
  }

  // Match agentic flow: use top 15, not 8
  const limitedRecords = prepared.records.slice(0, 15);

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

  const candidates = findMuesResponseSchema.parse(response.object);
  const validationError = groundedValidateMues(candidates, limitedRecords);

  return {
    // For fair comparison, report matched retrieved records here
    totalRecordsAnalyzed: prepared.matchedRecords,
    matchedRecords: prepared.matchedRecords,
    recordsSentToModel: limitedRecords.length,
    candidates,
    evidenceSample: limitedRecords.slice(0, 5).map(mapEvidenceRecord),
    evidenceForEvaluation: limitedRecords.map(mapEvidenceRecord),
    noMatchingRecords: false,
    message: undefined,
    validationError,
  };
}