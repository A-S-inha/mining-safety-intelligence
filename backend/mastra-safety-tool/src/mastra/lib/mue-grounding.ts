import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { stringifyJsonlLine } from './json-stringify-safe';

export const mueGroundingReportSchema = z.object({
  runId: z.string(),
  timestamp: z.string(),
  retrievalSampleSize: z.number(),
  totalMatchedInQuery: z.number(),
  truncated: z.boolean(),
  supportingCitationRate: z
    .number()
    .describe('Share of supportingDocumentNos that appear in the retrieval sample (0–1)'),
  perMue: z.array(
    z.object({
      title: z.string(),
      supportingDocumentNosCount: z.number(),
      validCitationsInSample: z.number(),
      invalidSupportingIds: z.array(z.string()),
      modelFatalityCount: z.number(),
      fatalitiesInCitedRecords: z.number(),
      fatalityCountDelta: z.number(),
    }),
  ),
  overallCitationQuality: z.enum(['good', 'mixed', 'poor']),
  warnings: z.array(z.string()),
});

export type MueGroundingReport = z.infer<typeof mueGroundingReportSchema>;

export type MueFinderLlmPayload = {
  querySummary: string;
  candidateMues: Array<{
    rank: number;
    title: string;
    description: string;
    incidentCount: number;
    fatalityCount: number;
    commonInjuryTypes: string[];
    narrativeSummary: string;
    materialityFlag: 'high' | 'medium' | 'low';
    supportingDocumentNos: string[];
  }>;
  dataNotes: string;
};

function isFatality(degreeInjury: string): boolean {
  return degreeInjury.toUpperCase().includes('FATALITY');
}

export function buildGroundingReport(
  llmResult: MueFinderLlmPayload,
  records: Array<{ documentNo: string; degreeInjury: string }>,
  meta: { totalMatched: number; truncated: boolean },
): MueGroundingReport {
  const runId = randomUUID();
  const timestamp = new Date().toISOString();
  const docToRow = new Map(records.map((r) => [r.documentNo, r]));
  const sampleIds = new Set(records.map((r) => r.documentNo));

  const perMue = llmResult.candidateMues.map((m) => {
    const ids = m.supportingDocumentNos ?? [];
    const invalidSupportingIds = ids.filter((id) => !sampleIds.has(id));
    const validCitationsInSample = ids.filter((id) => sampleIds.has(id)).length;
    let fatalitiesInCitedRecords = 0;
    for (const id of ids) {
      const row = docToRow.get(id);
      if (row && isFatality(row.degreeInjury)) fatalitiesInCitedRecords += 1;
    }
    return {
      title: m.title,
      supportingDocumentNosCount: ids.length,
      validCitationsInSample,
      invalidSupportingIds,
      modelFatalityCount: m.fatalityCount,
      fatalitiesInCitedRecords,
      fatalityCountDelta: m.fatalityCount - fatalitiesInCitedRecords,
    };
  });

  const allCited = llmResult.candidateMues.flatMap((m) => m.supportingDocumentNos ?? []);
  const validAll = allCited.filter((id) => sampleIds.has(id)).length;
  const supportingCitationRate = allCited.length === 0 ? 1 : validAll / allCited.length;

  const warnings: string[] = [];
  if (meta.truncated) {
    warnings.push(
      `Retrieval sample is truncated (${records.length} of ${meta.totalMatched} matched rows); cluster incident counts may not be verifiable from the sample alone.`,
    );
  }
  for (const row of perMue) {
    if (row.invalidSupportingIds.length > 0) {
      warnings.push(
        `MUE "${row.title}": ${row.invalidSupportingIds.length} supporting DOCUMENT_NO not present in retrieval sample.`,
      );
    }
    if (Math.abs(row.fatalityCountDelta) > 0) {
      warnings.push(
        `MUE "${row.title}": model fatalityCount (${row.modelFatalityCount}) vs fatalities in cited sample rows (${row.fatalitiesInCitedRecords}); delta ${row.fatalityCountDelta}.`,
      );
    }
  }

  let overallCitationQuality: MueGroundingReport['overallCitationQuality'] = 'good';
  if (supportingCitationRate < 0.85 || perMue.some((p) => p.invalidSupportingIds.length > 0)) {
    overallCitationQuality = 'mixed';
  }
  if (supportingCitationRate < 0.5 || perMue.some((p) => p.invalidSupportingIds.length > 2)) {
    overallCitationQuality = 'poor';
  }

  return mueGroundingReportSchema.parse({
    runId,
    timestamp,
    retrievalSampleSize: records.length,
    totalMatchedInQuery: meta.totalMatched,
    truncated: meta.truncated,
    supportingCitationRate,
    perMue,
    overallCitationQuality,
    warnings,
  });
}

export type MueRunLogRecord = {
  kind: 'mue-finder';
  /** Grounding / synthesis correlation id (per completion). */
  runId: string;
  /** Mastra workflow execution id (ties mue-runs.jsonl to mue-workflow-steps.jsonl). */
  workflowRunId?: string;
  timestamp: string;
  input: { keyword: string; mineType: string };
  search: {
    totalMatched: number;
    truncated: boolean;
    recordCount: number;
    matchedFatalityCount: number;
    sampleFatalityCount: number;
    retrievalMode: 'token' | 'bm25';
    /** DOCUMENT_NO values in the sample passed to the synthesis LLM (same order as `records` in the API). */
    documentNosInSample: string[];
  };
  usage?: {
    planner?: unknown;
    research?: unknown;
    synthesis?: unknown;
  };
  groundingReport: MueGroundingReport;
};

export async function appendMueRunLog(logDir: string, record: MueRunLogRecord): Promise<void> {
  await mkdir(logDir, { recursive: true });
  const path = join(logDir, 'mue-runs.jsonl');
  await appendFile(path, stringifyJsonlLine(record), 'utf8');
}
