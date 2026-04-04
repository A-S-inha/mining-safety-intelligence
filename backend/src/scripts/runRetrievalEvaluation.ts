import fs from "fs";
import path from "path";
import { findMuesWithAgenticFlow } from "../mastra/services/findMuesAgenticService";

import {
  getGroundingScore,
  getGroundingReason,
  getQualityScore,
  getQualityReason,
} from "../../evaluation/mueMetrics";

/* ================= TYPES ================= */

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

type AgenticFlowResult = {
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

type EvalSuccess = Awaited<ReturnType<typeof runSingleCase>>;

type EvalFailure = {
  id: string;
  name: string;
  input: {
    mineType?: string;
    keyword?: string;
  };
  passed: false;
  error: string;
};

type EvalRunResult = EvalSuccess | EvalFailure;

/* ================= HELPERS ================= */

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeLower(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function buildEvidenceText(evidence: EvidenceRecord[]): string {
  return evidence
    .map((r) =>
      [
        r.narrative ?? "",
        r.accidentType ?? "",
        r.degreeInjury ?? "",
      ].join(" ")
    )
    .join(" ")
    .toLowerCase();
}

/* ================= METRICS ================= */

function scoreEvidenceTerms(
  evidence: EvidenceRecord[],
  expectedTerms: string[],
  minTermHitRate: number
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
    matchedTerms,
    missingTerms,
    hitRate,
    minTermHitRate,
    passed: hitRate >= minTermHitRate,
  };
}

function scoreEvidenceVolume(
  evidence: EvidenceRecord[],
  minEvidenceRecords: number
) {
  return {
    evidenceCount: evidence.length,
    minEvidenceRecords,
    passed: evidence.length >= minEvidenceRecords,
  };
}

function scoreCandidates(candidates: Candidate[], maxCandidates: number) {
  const issues: string[] = [];

  if (candidates.length > maxCandidates) {
    issues.push(
      `Too many candidates returned: ${candidates.length} > ${maxCandidates}`
    );
  }

  for (const candidate of candidates) {
    if (!candidate.id?.trim()) issues.push(`Candidate missing id`);
    if (!candidate.name?.trim()) issues.push(`Candidate missing name`);
    if (!candidate.summary?.trim())
      issues.push(`Candidate "${candidate.name}" missing summary`);
    if (candidate.incidentCount <= 0)
      issues.push(
        `Candidate "${candidate.name}" has non-positive incidentCount`
      );
    if (candidate.fatalityCount < 0)
      issues.push(
        `Candidate "${candidate.name}" has negative fatalityCount`
      );
    if (!Array.isArray(candidate.commonInjuries))
      issues.push(
        `Candidate "${candidate.name}" commonInjuries is not an array`
      );
  }

  return {
    candidateCount: candidates.length,
    maxCandidates,
    issues,
    passed: issues.length === 0,
  };
}

/* ===== Debug grounding (detailed) ===== */

function tokenizeCandidateName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

function scoreGrounding(candidates: Candidate[], evidence: EvidenceRecord[]) {
  const narratives = evidence.map((r) => safeLower(r.narrative));

  const candidateChecks = candidates.map((candidate) => {
    const tokens = tokenizeCandidateName(candidate.name);

    const supportingNarratives = narratives.filter((narrative) =>
      tokens.some((token) => narrative.includes(token))
    );

    return {
      candidate: candidate.name,
      nameTokensUsed: tokens,
      supportingNarrativeCount: supportingNarratives.length,
      grounded: supportingNarratives.length > 0 || tokens.length === 0,
    };
  });

  return {
    candidateChecks,
    passed: candidateChecks.every((c) => c.grounded),
  };
}

function overallPass(sections: Array<{ passed: boolean }>) {
  return sections.every((s) => s.passed);
}

/* ================= CORE ================= */

async function runSingleCase(testCase: EvalCase) {
  const minEvidenceRecords =
    testCase.minEvidenceRecords ??
    (testCase.queryType === "broad"
      ? 5
      : testCase.queryType === "medium"
      ? 4
      : 3);

  const minTermHitRate =
    testCase.minTermHitRate ??
    (testCase.queryType === "broad" ? 0.5 : 0.6);

  const maxCandidates = testCase.maxCandidates ?? 3;

  console.log(`\nRunning case: ${testCase.id} — ${testCase.name}`);

  const result: AgenticFlowResult = await findMuesWithAgenticFlow(
    testCase.input
  );

  const evidence: EvidenceRecord[] = Array.isArray(result.evidenceForEvaluation)
    ? result.evidenceForEvaluation
    : Array.isArray(result.evidenceSample)
    ? result.evidenceSample
    : [];

  const evidenceSample: EvidenceRecord[] = Array.isArray(result.evidenceSample)
    ? result.evidenceSample
    : [];

  const candidates: Candidate[] = Array.isArray(result.candidates)
    ? result.candidates
    : [];

  /* ===== Metrics ===== */

  const evidenceVolume = scoreEvidenceVolume(evidence, minEvidenceRecords);
  const evidenceTerms = scoreEvidenceTerms(
    evidence,
    testCase.expectedEvidenceTerms,
    minTermHitRate
  );
  const candidateQuality = scoreCandidates(candidates, maxCandidates);

  const grounding = scoreGrounding(candidates, evidence);

  /* ===== Shared KPI scores ===== */

  const groundingScore = getGroundingScore(candidates, evidence);
  const groundingReason = getGroundingReason(candidates, evidence);

  const qualityScore = getQualityScore(candidates);
  const qualityReason = getQualityReason(candidates);

  /* ===== Validation ===== */

  const validation = {
    hasError: Boolean(result.validationError),
    error: result.validationError ?? null,
    passed: !result.validationError,
  };

  const passed = overallPass([
    evidenceVolume,
    evidenceTerms,
    candidateQuality,
    grounding,
    validation,
  ]);

  return {
    id: testCase.id,
    name: testCase.name,
    queryType: testCase.queryType,
    input: testCase.input,
    notes: testCase.notes ?? "",
    interpretation: result.interpretation ?? null,

    serviceStats: {
      totalRecordsAnalyzed: result.totalRecordsAnalyzed ?? 0,
      recordsSentToModel: result.recordsSentToModel ?? 0,
      noMatchingRecords: result.noMatchingRecords ?? false,
      message: result.message ?? "",
    },

    evaluation: {
      evidenceVolume,
      evidenceTerms,
      candidateQuality,
      grounding,

      mastraStyleScores: {
        groundingScore,
        groundingReason,
        qualityScore,
        qualityReason,
      },

      validation,
      passed,
    },

    rawOutput: {
      evidenceSample,
      evidenceForEvaluation: evidence,
      candidates,
    },
  };
}

/* ================= MAIN ================= */

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

  const runStartedAt = new Date().toISOString();
  const allResults: EvalRunResult[] = [];

  for (const testCase of cases) {
    try {
      const caseResult = await runSingleCase(testCase);
      allResults.push(caseResult);

      fs.writeFileSync(
        path.join(resultsDir, `${testCase.id}.retrieval.json`),
        JSON.stringify(caseResult, null, 2),
        "utf-8"
      );

      console.log(
        `Finished ${testCase.id}: ${
          caseResult.evaluation.passed ? "PASS" : "FAIL"
        }`
      );
    } catch (error) {
      const failure: EvalFailure = {
        id: testCase.id,
        name: testCase.name,
        input: testCase.input,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };

      allResults.push(failure);

      fs.writeFileSync(
        path.join(resultsDir, `${testCase.id}.retrieval.json`),
        JSON.stringify(failure, null, 2),
        "utf-8"
      );

      console.error(`Failed ${testCase.id}:`, failure.error);
    }
  }

  const passedCount = allResults.filter(
    (r) => ("evaluation" in r ? r.evaluation.passed : r.passed) === true
  ).length;

  const summary = {
    runStartedAt,
    runFinishedAt: new Date().toISOString(),
    totalCases: allResults.length,
    passedCases: passedCount,
    failedCases: allResults.length - passedCount,
  };

  fs.writeFileSync(
    path.join(resultsDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8"
  );

  console.log("\nEvaluation complete");
  console.log(`Passed: ${summary.passedCases}/${summary.totalCases}`);
}

main().catch((err) => {
  console.error("Evaluation run failed:", err);
  process.exit(1);
});