import fs from "fs";
import path from "path";

import { findMuesWithAgent } from "../mastra/services/findMuesService";
import { findMuesWithAgenticFlow } from "../mastra/services/findMuesAgenticService";
import {
  getGroundingScore,
  getQualityScore,
} from "../../evaluation/mueMetrics";

type EvalCase = {
  id: string;
  name: string;
  queryType: "broad" | "medium" | "narrow";
  input: {
    mineType?: string;
    keyword?: string;
  };
  expectedEvidenceTerms: string[];
  minEvidenceRecords?: number;
  minTermHitRate?: number;
  maxCandidates?: number;
  notes?: string;
};

type EvidenceRecord = {
  rowId?: string;
  mineId?: string;
  accidentDate?: string;
  accidentType?: string;
  degreeInjury?: string;
  narrative?: string;
};

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

type BaselineResult = {
  totalRecordsAnalyzed?: number;
  matchedRecords?: number;
  recordsSentToModel?: number;
  candidates?: Candidate[];
  evidenceSample?: EvidenceRecord[];
  evidenceForEvaluation?: EvidenceRecord[];
  noMatchingRecords?: boolean;
  message?: string;
  validationError?: string | null;
};

type AgenticResult = {
  totalRecordsAnalyzed?: number;
  recordsSentToModel?: number;
  candidates?: Candidate[];
  evidenceSample?: EvidenceRecord[];
  evidenceForEvaluation?: EvidenceRecord[];
  noMatchingRecords?: boolean;
  message?: string;
  interpretation?: unknown;
  validationError?: string | null;
};

type ComparisonFlowMetrics = {
  totalRecordsAnalyzed: number;
  matchedRecords: number;
  recordsSentToModel: number;
  noMatchingRecords: boolean;
  message: string;
  evidenceCount: number;
  termHitRate: number;
  matchedTerms: string[];
  missingTerms: string[];
  groundingScore: number;
  qualityScore: number;
  candidateCount: number;
  candidateNames: string[];
  recordIds: string[];
  validationError: string | null;
};

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildEvidenceText(evidence: EvidenceRecord[]): string {
  return evidence
    .map((r) =>
      [r.narrative ?? "", r.accidentType ?? "", r.degreeInjury ?? ""].join(" ")
    )
    .join(" ")
    .toLowerCase();
}

function scoreEvidenceTerms(
  evidence: EvidenceRecord[],
  expectedTerms: string[]
) {
  const text = buildEvidenceText(evidence);

  const matchedTerms = expectedTerms.filter((term) =>
    text.includes(term.toLowerCase())
  );

  const missingTerms = expectedTerms.filter(
    (term) => !matchedTerms.includes(term)
  );

  const hitRate =
    expectedTerms.length === 0 ? 1 : matchedTerms.length / expectedTerms.length;

  return {
    hitRate,
    matchedTerms,
    missingTerms,
  };
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((v): v is string => Boolean(v?.trim())))
  );
}

function computeOverlap(a: string[], b: string[]) {
  const setA = new Set(a);
  const overlapIds = b.filter((id) => setA.has(id));

  return {
    overlapCount: overlapIds.length,
    overlapIds,
  };
}

async function evaluateBaselineFlow(
  testCase: EvalCase
): Promise<ComparisonFlowMetrics> {
  const result: BaselineResult = await findMuesWithAgent(testCase.input);

  const evidence: EvidenceRecord[] = Array.isArray(result.evidenceForEvaluation)
    ? result.evidenceForEvaluation
    : Array.isArray(result.evidenceSample)
      ? result.evidenceSample
      : [];

  const candidates: Candidate[] = Array.isArray(result.candidates)
    ? result.candidates
    : [];

  const evidenceTerms = scoreEvidenceTerms(
    evidence,
    testCase.expectedEvidenceTerms
  );

  const recordIds = uniqueNonEmpty(evidence.map((e) => e.rowId));

  return {
    totalRecordsAnalyzed: result.totalRecordsAnalyzed ?? 0,
    matchedRecords: result.matchedRecords ?? evidence.length,
    recordsSentToModel: result.recordsSentToModel ?? 0,
    noMatchingRecords: result.noMatchingRecords ?? false,
    message: result.message ?? "",
    evidenceCount: evidence.length,
    termHitRate: evidenceTerms.hitRate,
    matchedTerms: evidenceTerms.matchedTerms,
    missingTerms: evidenceTerms.missingTerms,
    groundingScore: getGroundingScore(candidates, evidence),
    qualityScore: getQualityScore(candidates),
    candidateCount: candidates.length,
    candidateNames: candidates.map((c) => c.name),
    recordIds,
    validationError: result.validationError ?? null,
  };
}

async function evaluateAgenticFlow(
  testCase: EvalCase
): Promise<
  ComparisonFlowMetrics & {
    interpretation: unknown | null;
  }
> {
  const result: AgenticResult = await findMuesWithAgenticFlow(testCase.input);

  const evidence: EvidenceRecord[] = Array.isArray(result.evidenceForEvaluation)
    ? result.evidenceForEvaluation
    : Array.isArray(result.evidenceSample)
      ? result.evidenceSample
      : [];

  const candidates: Candidate[] = Array.isArray(result.candidates)
    ? result.candidates
    : [];

  const evidenceTerms = scoreEvidenceTerms(
    evidence,
    testCase.expectedEvidenceTerms
  );

  const recordIds = uniqueNonEmpty(evidence.map((e) => e.rowId));

  return {
    totalRecordsAnalyzed: result.totalRecordsAnalyzed ?? 0,
    matchedRecords: evidence.length,
    recordsSentToModel: result.recordsSentToModel ?? 0,
    noMatchingRecords: result.noMatchingRecords ?? false,
    message: result.message ?? "",
    evidenceCount: evidence.length,
    termHitRate: evidenceTerms.hitRate,
    matchedTerms: evidenceTerms.matchedTerms,
    missingTerms: evidenceTerms.missingTerms,
    groundingScore: getGroundingScore(candidates, evidence),
    qualityScore: getQualityScore(candidates),
    candidateCount: candidates.length,
    candidateNames: candidates.map((c) => c.name),
    recordIds,
    validationError: result.validationError ?? null,
    interpretation: result.interpretation ?? null,
  };
}

async function main() {
  const casesPath = path.join(
    process.cwd(),
    "evaluation",
    "cases",
    "mue_eval_cases.json"
  );

  const resultsDir = path.join(process.cwd(), "evaluation", "results");
  ensureDir(resultsDir);

  if (!fs.existsSync(casesPath)) {
    throw new Error(`Cases file not found: ${casesPath}`);
  }

  const raw = fs.readFileSync(casesPath, "utf-8");
  const cases = JSON.parse(raw) as EvalCase[];

  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("Cases file is empty or invalid.");
  }

  const runStartedAt = new Date().toISOString();
  const results: any[] = [];

  for (const testCase of cases) {
    console.log(`\nComparing case: ${testCase.id} — ${testCase.name}`);

    try {
      const baseline = await evaluateBaselineFlow(testCase);
      const agentic = await evaluateAgenticFlow(testCase);

      const overlap = computeOverlap(baseline.recordIds, agentic.recordIds);

      const comparison = {
        id: testCase.id,
        name: testCase.name,
        queryType: testCase.queryType,
        input: testCase.input,
        notes: testCase.notes ?? "",
        baseline,
        agentic: {
          ...agentic,
          interpretation: agentic.interpretation,
        },
        overlap,
      };

      results.push(comparison);

      const perCasePath = path.join(
        resultsDir,
        `${testCase.id}.comparison.json`
      );
      fs.writeFileSync(
        perCasePath,
        JSON.stringify(comparison, null, 2),
        "utf-8"
      );

      console.log("Baseline:", {
        matchedRecords: baseline.matchedRecords,
        recordsSentToModel: baseline.recordsSentToModel,
        evidenceCount: baseline.evidenceCount,
        termHitRate: baseline.termHitRate,
        groundingScore: baseline.groundingScore,
        qualityScore: baseline.qualityScore,
        candidateCount: baseline.candidateCount,
        validationError: baseline.validationError,
      });

      console.log("Agentic:", {
        matchedRecords: agentic.matchedRecords,
        recordsSentToModel: agentic.recordsSentToModel,
        evidenceCount: agentic.evidenceCount,
        termHitRate: agentic.termHitRate,
        groundingScore: agentic.groundingScore,
        qualityScore: agentic.qualityScore,
        candidateCount: agentic.candidateCount,
        validationError: agentic.validationError,
      });
    } catch (error) {
      const failure = {
        id: testCase.id,
        name: testCase.name,
        queryType: testCase.queryType,
        input: testCase.input,
        error: error instanceof Error ? error.message : String(error),
      };

      results.push(failure);

      const perCasePath = path.join(
        resultsDir,
        `${testCase.id}.comparison.json`
      );
      fs.writeFileSync(
        perCasePath,
        JSON.stringify(failure, null, 2),
        "utf-8"
      );

      console.error(`Failed comparison for ${testCase.id}:`, failure.error);
    }
  }

  const summary = {
    runStartedAt,
    runFinishedAt: new Date().toISOString(),
    totalCases: results.length,
    results: results.map((r) => ({
      id: r.id,
      name: r.name,
      hasError: Boolean(r.error),
      baselineMatchedRecords: r.baseline?.matchedRecords ?? 0,
      agenticMatchedRecords: r.agentic?.matchedRecords ?? 0,
      baselineRecordsSentToModel: r.baseline?.recordsSentToModel ?? 0,
      agenticRecordsSentToModel: r.agentic?.recordsSentToModel ?? 0,
      baselineGroundingScore: r.baseline?.groundingScore ?? 0,
      agenticGroundingScore: r.agentic?.groundingScore ?? 0,
      baselineTermHitRate: r.baseline?.termHitRate ?? 0,
      agenticTermHitRate: r.agentic?.termHitRate ?? 0,
      overlapCount: r.overlap?.overlapCount ?? 0,
    })),
  };

  const summaryPath = path.join(resultsDir, "comparison.summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");

  console.log("\nComparison complete");
  console.log(`Summary written to: ${summaryPath}`);
}

main().catch((error) => {
  console.error("Comparison run failed:", error);
  process.exit(1);
});