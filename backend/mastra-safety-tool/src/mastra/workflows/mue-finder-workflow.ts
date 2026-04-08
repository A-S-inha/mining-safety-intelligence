import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { FullOutput } from '@mastra/core/stream';
import { z } from 'zod';
import { getNimApiKey } from '../lib/mue-model';
import { getLogsDirectory } from '../lib/log-paths';
import { appendMueRunLog, buildGroundingReport } from '../lib/mue-grounding';
import { appendMueWorkflowStepTrace } from '../lib/mue-workflow-trace';
import { queryMshaAccidents } from '../lib/msha-query';
import {
  finalizeMueSearchPlan,
  mueSearchPlanSchema,
  mueFinderLlmSchema,
  mueFinderResultSchema,
  mshaSearchBundleSchema,
} from '../schemas/mue-schemas';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientPlannerFailure(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /504|502|503|Gateway Timeout|timeout|ECONNRESET|ETIMEDOUT|fetch failed|STRUCTURED_OUTPUT|schema validation|Invalid input|AI_APICallError|APICallError|429|Too Many Requests|rate limit/i.test(
    msg,
  );
}

const workflowInputSchema = z.object({
  keyword: z.string().describe('Hazard or equipment keyword(s)'),
  mineType: z.string().optional().default('').describe('Mine type context, e.g. underground coal'),
});

const afterPlanSchema = workflowInputSchema.extend({
  plan: mueSearchPlanSchema,
  plannerUsage: z.unknown().optional(),
});

const afterResearchSchema = afterPlanSchema.extend({
  researchSummary: z.string(),
  searchResult: mshaSearchBundleSchema,
  researchUsage: z.unknown().optional(),
});

function isMshaBundle(x: unknown): x is z.infer<typeof mshaSearchBundleSchema> {
  const parsed = mshaSearchBundleSchema.safeParse(x);
  return parsed.success;
}

function extractMshaFromGenerate(output: FullOutput): z.infer<typeof mshaSearchBundleSchema> | null {
  const chunks: unknown[] = [];
  for (const tr of output.toolResults ?? []) {
    if (tr.type === 'tool-result' && tr.payload?.result !== undefined) {
      chunks.push(tr.payload.result);
    }
  }
  for (const step of output.steps ?? []) {
    for (const tr of step.toolResults ?? []) {
      if (tr.type === 'tool-result' && tr.payload?.result !== undefined) {
        chunks.push(tr.payload.result);
      }
    }
  }
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (isMshaBundle(chunks[i])) return chunks[i] as z.infer<typeof mshaSearchBundleSchema>;
  }
  return null;
}

const planMueSearch = createStep({
  id: 'plan-mue-search',
  description: 'Planner agent: user text → structured MSHA search parameters',
  inputSchema: workflowInputSchema,
  outputSchema: afterPlanSchema,
  execute: async ({ inputData, mastra, runId, workflowId }) => {
    if (!inputData) throw new Error('Missing workflow input');
    const logDir = getLogsDirectory();
    const traceBase = {
      workflowId,
      workflowRunId: runId,
      inputKeyword: inputData.keyword,
      inputMineType: inputData.mineType ?? '',
    };
    await appendMueWorkflowStepTrace(logDir, {
      ...traceBase,
      stepId: 'plan-mue-search',
      phase: 'start',
      summary: {},
    });

    if (!getNimApiKey()) {
      const err =
        'NVIDIA API key is missing (set NVIDIA_API_KEY or NIM_API_KEY in backend/mastra-safety-tool/.env — see .env.example). ' +
        'An empty key causes NIM to respond with 401 Unauthorized. ' +
        'Note: mastra dev loads only the first existing file among .env.development, .env.local, and .env; put secrets in that file or remove an empty one that wins the search order.';
      await appendMueWorkflowStepTrace(logDir, {
        ...traceBase,
        stepId: 'plan-mue-search',
        phase: 'error',
        summary: {},
        error: err,
      });
      throw new Error(err);
    }
    const agent = mastra?.getAgentById('mue-query-planner');
    if (!agent) throw new Error('mue-query-planner agent not registered');

    const userBlock = `keyword: ${inputData.keyword}\nmineType: ${inputData.mineType || '(unspecified)'}`;

    const maxAttempts = 3;
    let lastError: unknown;
    let attemptsUsed = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attemptsUsed = attempt + 1;
      if (attempt > 0) {
        await sleep(2000 * attempt);
        mastra?.getLogger()?.warn('mue-query-planner retry', { attempt, keyword: inputData.keyword });
      }
      try {
        const gen = await agent.generate([{ role: 'user', content: userBlock }], {
          structuredOutput: { schema: mueSearchPlanSchema },
        });
        const raw = mueSearchPlanSchema.parse(gen.object ?? {});
        const plan = finalizeMueSearchPlan(raw, inputData.keyword, inputData.mineType ?? '');
        await appendMueWorkflowStepTrace(logDir, {
          ...traceBase,
          stepId: 'plan-mue-search',
          phase: 'end',
          summary: {
            attemptsUsed,
            plannedKeyword: plan.keyword,
            plannedMineTypeHint: plan.mineTypeHint,
            alternateKeywordsCount: plan.alternateKeywords?.length ?? 0,
            rationaleLength: plan.rationale?.length ?? 0,
            plannerUsage: gen.totalUsage,
          },
        });
        mastra?.getLogger()?.info('mue step plan-mue-search', {
          workflowRunId: runId,
          attemptsUsed,
          plannedKeyword: plan.keyword,
        });
        return {
          keyword: inputData.keyword,
          mineType: inputData.mineType,
          plan,
          plannerUsage: gen.totalUsage,
        };
      } catch (e) {
        lastError = e;
        if (!isTransientPlannerFailure(e) || attempt === maxAttempts - 1) {
          await appendMueWorkflowStepTrace(logDir, {
            ...traceBase,
            stepId: 'plan-mue-search',
            phase: 'error',
            summary: { attemptsUsed },
            error: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  },
});

const researchMsha = createStep({
  id: 'research-msha',
  description: 'Research agent: tool calls against local Accidents.txt; fallback broadens query',
  inputSchema: afterPlanSchema,
  outputSchema: afterResearchSchema,
  execute: async ({ inputData, mastra, runId, workflowId }) => {
    if (!inputData) throw new Error('Missing plan step output');
    const logDir = getLogsDirectory();
    const traceBase = {
      workflowId,
      workflowRunId: runId,
      inputKeyword: inputData.keyword,
      inputMineType: inputData.mineType ?? '',
    };
    await appendMueWorkflowStepTrace(logDir, {
      ...traceBase,
      stepId: 'research-msha',
      phase: 'start',
      summary: {
        plannedKeyword: inputData.plan.keyword,
        plannedMineTypeHint: inputData.plan.mineTypeHint,
      },
    });

    const agent = mastra?.getAgentById('mue-research');
    if (!agent) throw new Error('mue-research agent not registered');

    const payload = {
      instruction: 'Execute MSHA search per plan; broaden if zero results.',
      userKeyword: inputData.keyword,
      userMineType: inputData.mineType,
      plannedKeyword: inputData.plan.keyword,
      plannedMineTypeHint: inputData.plan.mineTypeHint,
      alternateKeywords: inputData.plan.alternateKeywords,
    };

    const gen = await agent.generate([{ role: 'user', content: JSON.stringify(payload) }], {
      maxSteps: 8,
    });

    let searchResult = extractMshaFromGenerate(gen);
    let researchPath: 'agent_tool' | 'alternate_keyword' | 'direct_fallback' | 'zero_match_bundle' =
      searchResult && searchResult.totalMatched > 0 ? 'agent_tool' : 'zero_match_bundle';

    if (!searchResult || searchResult.totalMatched === 0) {
      for (const alt of inputData.plan.alternateKeywords) {
        const retry = await queryMshaAccidents({
          keyword: alt || inputData.plan.keyword,
          mineTypeHint: inputData.plan.mineTypeHint || inputData.mineType,
          maxRecords: 120,
          ignoreMineContext: true,
        });
        if (retry.totalMatched > 0) {
          searchResult = retry;
          researchPath = 'alternate_keyword';
          break;
        }
      }
    }

    if (!searchResult) {
      searchResult = await queryMshaAccidents({
        keyword: inputData.plan.keyword,
        mineTypeHint: inputData.plan.mineTypeHint || inputData.mineType,
        maxRecords: 120,
        ignoreMineContext: true,
      });
      researchPath = 'direct_fallback';
    }

    const docNos = searchResult.records.map((r) => r.documentNo);
    await appendMueWorkflowStepTrace(logDir, {
      ...traceBase,
      stepId: 'research-msha',
      phase: 'end',
      summary: {
        researchPath,
        agentReturnedMatchingBundle: researchPath === 'agent_tool',
        totalMatched: searchResult.totalMatched,
        truncated: searchResult.truncated,
        retrievalMode: searchResult.retrievalMode,
        sampleSize: searchResult.records.length,
        matchedFatalityCount: searchResult.matchedFatalityCount,
        sampleFatalityCount: searchResult.sampleFatalityCount,
        accidentsFilePath: searchResult.filePath,
        researchSummaryLength: (gen.text ?? '').length,
        documentNosInSample: docNos,
        researchUsage: gen.totalUsage,
      },
    });
    mastra?.getLogger()?.info('mue step research-msha', {
      workflowRunId: runId,
      researchPath,
      totalMatched: searchResult.totalMatched,
      sampleSize: searchResult.records.length,
      retrievalMode: searchResult.retrievalMode,
    });

    return {
      ...inputData,
      researchSummary: gen.text ?? '',
      searchResult,
      researchUsage: gen.totalUsage,
    };
  },
});

const synthesizeMues = createStep({
  id: 'synthesize-mues',
  description: 'Synthesis agent: structured CCM Step 2 candidate MUEs from records',
  inputSchema: afterResearchSchema,
  outputSchema: mueFinderResultSchema,
  execute: async ({ inputData, mastra, runId, workflowId }) => {
    if (!inputData) throw new Error('Missing research step output');
    const logDir = getLogsDirectory();
    const traceBase = {
      workflowId,
      workflowRunId: runId,
      inputKeyword: inputData.keyword,
      inputMineType: inputData.mineType ?? '',
    };
    await appendMueWorkflowStepTrace(logDir, {
      ...traceBase,
      stepId: 'synthesize-mues',
      phase: 'start',
      summary: {
        recordsIn: inputData.searchResult.records.length,
        totalMatched: inputData.searchResult.totalMatched,
      },
    });

    const agent = mastra?.getAgentById('mue-synthesis');
    if (!agent) throw new Error('mue-synthesis agent not registered');

    try {
      const bundle = {
        searchMetadata: {
          userKeyword: inputData.keyword,
          userMineType: inputData.mineType,
          plannerRationale: inputData.plan.rationale,
          researchSummary: inputData.researchSummary,
          retrievalMode: inputData.searchResult.retrievalMode,
        },
        totalMatched: inputData.searchResult.totalMatched,
        truncated: inputData.searchResult.truncated,
        matchedFatalityCount: inputData.searchResult.matchedFatalityCount,
        sampleFatalityCount: inputData.searchResult.sampleFatalityCount,
        records: inputData.searchResult.records,
      };

      const gen = await agent.generate([{ role: 'user', content: JSON.stringify(bundle) }], {
        structuredOutput: { schema: mueFinderLlmSchema },
      });

      if (!gen.object) throw new Error('Synthesis returned no structured result');

      const groundingReport = buildGroundingReport(gen.object, inputData.searchResult.records, {
        totalMatched: inputData.searchResult.totalMatched,
        truncated: inputData.searchResult.truncated,
      });

      const result = mueFinderResultSchema.parse({
        ...gen.object,
        groundingReport,
      });

      await appendMueRunLog(logDir, {
        kind: 'mue-finder',
        runId: groundingReport.runId,
        workflowRunId: runId,
        timestamp: groundingReport.timestamp,
        input: { keyword: inputData.keyword, mineType: inputData.mineType ?? '' },
        search: {
          totalMatched: inputData.searchResult.totalMatched,
          truncated: inputData.searchResult.truncated,
          recordCount: inputData.searchResult.records.length,
          matchedFatalityCount: inputData.searchResult.matchedFatalityCount,
          sampleFatalityCount: inputData.searchResult.sampleFatalityCount,
          retrievalMode: inputData.searchResult.retrievalMode,
          documentNosInSample: inputData.searchResult.records.map((r) => r.documentNo),
        },
        usage: {
          planner: inputData.plannerUsage,
          research: inputData.researchUsage,
          synthesis: gen.totalUsage,
        },
        groundingReport,
      });

      await appendMueWorkflowStepTrace(logDir, {
        ...traceBase,
        stepId: 'synthesize-mues',
        phase: 'end',
        summary: {
          groundingRunId: groundingReport.runId,
          candidateMueCount: gen.object.candidateMues?.length ?? 0,
          overallCitationQuality: groundingReport.overallCitationQuality,
          supportingCitationRate: groundingReport.supportingCitationRate,
          retrievalSampleSize: groundingReport.retrievalSampleSize,
          warningsCount: groundingReport.warnings.length,
          synthesisUsage: gen.totalUsage,
        },
      });

      mastra?.getLogger()?.info('mue-finder-workflow completed', {
        workflowRunId: runId,
        runId: groundingReport.runId,
        overallCitationQuality: groundingReport.overallCitationQuality,
        supportingCitationRate: groundingReport.supportingCitationRate,
        totalMatched: inputData.searchResult.totalMatched,
        sampleSize: inputData.searchResult.records.length,
        matchedFatalityCount: inputData.searchResult.matchedFatalityCount,
        sampleFatalityCount: inputData.searchResult.sampleFatalityCount,
        retrievalMode: inputData.searchResult.retrievalMode,
        documentNosInSample: inputData.searchResult.records.map((r) => r.documentNo),
      });

      return result;
    } catch (e) {
      await appendMueWorkflowStepTrace(logDir, {
        ...traceBase,
        stepId: 'synthesize-mues',
        phase: 'error',
        summary: {},
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  },
});

export const mueFinderWorkflow = createWorkflow({
  id: 'mue-finder-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: mueFinderResultSchema,
})
  .then(planMueSearch)
  .then(researchMsha)
  .then(synthesizeMues);

mueFinderWorkflow.commit();
