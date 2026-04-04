import crypto from "crypto";
import { z } from "zod";

import { mastra } from "../index";

import {
  queryUnderstandingInputSchema,
  buildQueryUnderstandingPrompt,
} from "../agents/queryUnderstandingAgent";
import { queryUnderstandingResponseSchema } from "../agents/querySchema";

import {
  mueAgentInputSchema,
  buildMueUserPrompt,
} from "../agents/mueAgent";
import { findMuesResponseSchema } from "../agents/mueSchema";

import {
  findRelevantAccidents,
  summarizeForAgent,
  type SummarizedMSHARecord,
} from "../tools/mshaDataTool";

export type FindMuesAgenticInput = {
  mineType?: string;
  keyword?: string;
};

const NO_MATCH_MESSAGE =
  "No MSHA accident records matched your filters. Try broader or different keywords.";

function groundedValidateMues(
  candidates: z.infer<typeof findMuesResponseSchema>,
  records: SummarizedMSHARecord[]
) {
  const maxIncidents = records.length;
  const maxFatalities = records.reduce(
    (sum, r) => sum + Number(r.fatalities || "0"),
    0
  );

  for (const candidate of candidates) {
    if (candidate.incidentCount > maxIncidents) {
      throw new Error(
        `Invalid incidentCount for ${candidate.name}: ${candidate.incidentCount} > ${maxIncidents}`
      );
    }

    if (candidate.fatalityCount > maxFatalities) {
      throw new Error(
        `Invalid fatalityCount for ${candidate.name}: ${candidate.fatalityCount} > ${maxFatalities}`
      );
    }

    if (!candidate.summary || candidate.summary.trim().length < 20) {
      throw new Error(`Weak summary for ${candidate.name}`);
    }
  }

  return candidates;
}

function mapEvidenceRecord(record: SummarizedMSHARecord) {
  return {
    rowId: record.rowId,
    mineId: record.mineId,
    accidentDate: record.accidentDate,
    accidentType: record.accidentType,
    degreeInjury: record.degreeInjury,
    narrative: record.narrative,
  };
}

export async function findMuesWithAgenticFlow(
  input: FindMuesAgenticInput
) {
  const requestId = crypto.randomUUID();
  const requestStartedAt = Date.now();

  console.log("[agentic] request started", {
    requestId,
    input,
    startedAt: new Date().toISOString(),
  });

  const queryAgent = mastra.getAgentById("query-understanding-agent");
  const mueAgent = mastra.getAgentById("mue-agent");

  if (!queryAgent) {
    throw new Error("query-understanding-agent is not registered.");
  }

  if (!mueAgent) {
    throw new Error("mue-agent is not registered.");
  }

  // STEP 1: Interpret query
  const queryInput = queryUnderstandingInputSchema.parse(input);

  const queryAgentStartedAt = Date.now();
  console.log("[agentic] calling query-understanding-agent", {
    requestId,
  });

  const queryResponse = await queryAgent.generate(
    buildQueryUnderstandingPrompt(queryInput),
    {
      structuredOutput: {
        schema: queryUnderstandingResponseSchema,
        jsonPromptInjection: true,
      },
    }
  );

  console.log("[agentic] query-understanding-agent completed", {
    requestId,
    durationMs: Date.now() - queryAgentStartedAt,
  });

  const interpreted = queryUnderstandingResponseSchema.parse(
    queryResponse.object
  );

  console.log("[agentic] query interpretation", {
    requestId,
    originalMineType: input.mineType ?? "",
    originalKeyword: input.keyword ?? "",
    normalizedMineType: interpreted.normalizedMineType,
    expandedKeywords: interpreted.expandedKeywords,
    interpretation: interpreted.interpretation,
  });

  // STEP 2: Merge and dedupe keywords
  const keywords = Array.from(
    new Set([input.keyword ?? "", ...interpreted.expandedKeywords].filter(Boolean))
  );

  const mergedKeyword = keywords.join(" ");

  console.log("[agentic] keyword coverage", {
    requestId,
    keywords,
    mergedKeyword,
    expandedKeywordCount: interpreted.expandedKeywords.length,
  });

  // STEP 3: Retrieve records
  const retrievalStartedAt = Date.now();

  const rows = findRelevantAccidents({
    mineType: interpreted.normalizedMineType || input.mineType,
    keyword: mergedKeyword,
  });

  console.log("[agentic] retrieval completed", {
    requestId,
    durationMs: Date.now() - retrievalStartedAt,
    retrievedRows: rows.length,
  });

  const summarizeStartedAt = Date.now();
  const summarized = summarizeForAgent(rows);

  console.log("[agentic] summarization completed", {
    requestId,
    durationMs: Date.now() - summarizeStartedAt,
    summarizedRows: summarized.length,
  });

  if (summarized.length === 0) {
    console.log("[agentic] no matching records — skipping mue-agent", {
      requestId,
      totalRequestDurationMs: Date.now() - requestStartedAt,
    });

    return {
      totalRecordsAnalyzed: 0,
      recordsSentToModel: 0,
      candidates: [],
      evidenceSample: [],
      evidenceForEvaluation: [],
      noMatchingRecords: true,
      message: NO_MATCH_MESSAGE,
      interpretation: interpreted,
      validationError: null as string | null,
    };
  }

  // STEP 4: Send top ranked records to MUE agent
  const limitedRecords = summarized.slice(0, 15);

  console.log("[agentic] retrieval funnel", {
    requestId,
    retrievedRows: rows.length,
    summarizedRows: summarized.length,
    recordsSentToModel: limitedRecords.length,
  });

  console.log("[agentic] records sent to model", {
    requestId,
    count: limitedRecords.length,
    records: limitedRecords.map((r) => ({
      rowId: r.rowId,
      mineId: r.mineId,
      accidentDate: r.accidentDate,
      accidentType: r.accidentType,
      degreeInjury: r.degreeInjury,
    })),
  });

  const agentInput = mueAgentInputSchema.parse({
    mineType: interpreted.normalizedMineType || input.mineType,
    keyword: input.keyword,
    records: limitedRecords,
  });

  const prompt = buildMueUserPrompt(agentInput);

  const avgNarrativeChars =
    limitedRecords.length > 0
      ? Math.round(
          limitedRecords.reduce(
            (sum, record) => sum + record.narrative.length,
            0
          ) / limitedRecords.length
        )
      : 0;

  console.log("[agentic] model input stats", {
    requestId,
    promptChars: prompt.length,
    recordsSentToModel: limitedRecords.length,
    avgNarrativeChars,
    accidentTypes: limitedRecords.slice(0, 5).map((r) => r.accidentType),
  });

  const mueAgentStartedAt = Date.now();
  console.log("[agentic] calling mue-agent", {
    requestId,
  });

  const response = await mueAgent.generate(prompt, {
    structuredOutput: {
      schema: findMuesResponseSchema,
      jsonPromptInjection: true,
    },
  });

  console.log("[agentic] mue-agent completed", {
    requestId,
    durationMs: Date.now() - mueAgentStartedAt,
    totalRequestDurationMs: Date.now() - requestStartedAt,
    hasObject: Boolean(response.object),
  });

  const validated = findMuesResponseSchema.parse(response.object);

  let grounded = validated;
  let validationError: string | null = null;

  try {
    grounded = groundedValidateMues(validated, limitedRecords);
  } catch (error) {
    validationError =
      error instanceof Error ? error.message : String(error);

    console.warn("[agentic] grounding validation failed", {
      requestId,
      validationError,
    });
  }

  console.log("[agentic] final output", {
    requestId,
    candidateCount: grounded.length,
    candidateNames: grounded.map((c) => c.name),
    totalRecordsAnalyzed: rows.length,
    recordsSentToModel: limitedRecords.length,
    totalRequestDurationMs: Date.now() - requestStartedAt,
    validationError,
  });

  return {
    totalRecordsAnalyzed: rows.length,
    recordsSentToModel: limitedRecords.length,
    candidates: grounded,

    // small preview for UI/debug
    evidenceSample: limitedRecords.slice(0, 5).map(mapEvidenceRecord),

    // full evidence used by evaluation
    evidenceForEvaluation: limitedRecords.map(mapEvidenceRecord),

    noMatchingRecords: false,
    message: undefined as string | undefined,
    interpretation: interpreted,
    validationError,
  };
}