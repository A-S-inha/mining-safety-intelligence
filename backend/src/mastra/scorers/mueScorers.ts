import { createScorer } from "@mastra/core/evals";
import {
    getGroundingAnalysis,
    getQualityAnalysis,
}from "../../../evaluation/mueMetrics";
import type { Candidate as MueCandidate, EvidenceRecord as MueEvidenceRecord } from "../../../evaluation/mueMetrics";

type MueScorerOutput = {
  candidates?: MueCandidate[];
  evidence?: MueEvidenceRecord[];
};

export const mueGroundingScore = createScorer({
  id: "mue-grounding-score",
  name: "MUE Grounding Score",
  description: "Checks whether MUE names are supported by evidence narratives.",
})
  .analyze(({ run }) => {
    const output = (run.output ?? {}) as MueScorerOutput;
    const candidates = output.candidates ?? [];
    const evidence = output.evidence ?? [];

    const narratives = evidence.map((r) =>
      String(r.narrative ?? "").toLowerCase()
    );

    let groundedCount = 0;

    for (const candidate of candidates) {
      const tokens = candidate.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 3);

      const supported = narratives.some((narrative) =>
        tokens.some((token) => narrative.includes(token))
      );

      if (supported) groundedCount++;
    }

    return {
      groundedCount,
      total: candidates.length,
    };
  })
  .generateScore(({ results }) => {
    const groundedCount = results.analyzeStepResult?.groundedCount ?? 0;
    const total = results.analyzeStepResult?.total ?? 0;

    if (total === 0) return 0;
    return groundedCount / total;
  })
  .generateReason(({ score, results }) => {
    const groundedCount = results.analyzeStepResult?.groundedCount ?? 0;
    const total = results.analyzeStepResult?.total ?? 0;

    return `Grounded ${groundedCount} of ${total} candidates. Score: ${score}`;
  });

export const mueQualityScore = createScorer({
  id: "mue-quality-score",
  name: "MUE Quality Score",
  description: "Checks structural quality of MUE candidates.",
})
  .analyze(({ run }) => {
    const output = (run.output ?? {}) as MueScorerOutput;
    const candidates = output.candidates ?? [];

    let validCount = 0;

    for (const c of candidates) {
      if (
        c.summary?.trim().length > 20 &&
        c.incidentCount > 0 &&
        Array.isArray(c.commonInjuries)
      ) {
        validCount++;
      }
    }

    return {
      validCount,
      total: candidates.length,
    };
  })
  .generateScore(({ results }) => {
    const validCount = results.analyzeStepResult?.validCount ?? 0;
    const total = results.analyzeStepResult?.total ?? 0;

    if (total === 0) return 0;
    return validCount / total;
  })
  .generateReason(({ score, results }) => {
    const validCount = results.analyzeStepResult?.validCount ?? 0;
    const total = results.analyzeStepResult?.total ?? 0;

    return `Structurally valid ${validCount} of ${total} candidates. Score: ${score}`;
  });