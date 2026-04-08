import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stringifyJsonlLine } from './json-stringify-safe';

export type MueWorkflowStepTrace = {
  kind: 'mue-workflow-step';
  ts: string;
  workflowId: string;
  workflowRunId: string;
  stepId: string;
  phase: 'start' | 'end' | 'error';
  inputKeyword: string;
  inputMineType: string;
  summary: Record<string, unknown>;
  error?: string;
};

export async function appendMueWorkflowStepTrace(
  logDir: string,
  partial: Omit<MueWorkflowStepTrace, 'kind' | 'ts' | 'summary'> & { summary?: Record<string, unknown> },
): Promise<void> {
  await mkdir(logDir, { recursive: true });
  const line: MueWorkflowStepTrace = {
    kind: 'mue-workflow-step',
    ts: new Date().toISOString(),
    summary: partial.summary ?? {},
    workflowId: partial.workflowId,
    workflowRunId: partial.workflowRunId,
    stepId: partial.stepId,
    phase: partial.phase,
    inputKeyword: partial.inputKeyword,
    inputMineType: partial.inputMineType,
    ...(partial.error !== undefined ? { error: partial.error } : {}),
  };
  const path = join(logDir, 'mue-workflow-steps.jsonl');
  await appendFile(path, stringifyJsonlLine(line), 'utf8');
}
