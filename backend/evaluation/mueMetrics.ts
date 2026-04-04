export type Candidate = {
  id: string;
  name: string;
  incidentCount: number;
  fatalityCount: number;
  commonInjuries: string[];
  severity: "Low" | "Medium" | "High" | "Critical";
  materiality: "Material" | "Review";
  summary: string;
};

export type EvidenceRecord = {
  narrative?: string;
};

export function tokenizeCandidateName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function getGroundingAnalysis(
  candidates: Candidate[],
  evidence: EvidenceRecord[]
) {
  const narratives = evidence.map((r) =>
    String(r.narrative ?? "").toLowerCase()
  );

  let groundedCount = 0;

  for (const candidate of candidates) {
    const tokens = tokenizeCandidateName(candidate.name);

    const supported =
      tokens.length === 0
        ? false
        : narratives.some((narrative) =>
            tokens.some((token) => narrative.includes(token))
          );

    if (supported) groundedCount++;
  }

  return {
    groundedCount,
    total: candidates.length,
  };
}

export function getGroundingScore(
  candidates: Candidate[],
  evidence: EvidenceRecord[]
): number {
  const { groundedCount, total } = getGroundingAnalysis(candidates, evidence);
  if (total === 0) return 0;
  return groundedCount / total;
}

export function getGroundingReason(
  candidates: Candidate[],
  evidence: EvidenceRecord[]
): string {
  const { groundedCount, total } = getGroundingAnalysis(candidates, evidence);
  const score = total === 0 ? 0 : groundedCount / total;
  return `Grounded ${groundedCount} of ${total} candidates. Score: ${score}`;
}

export function getQualityAnalysis(candidates: Candidate[]) {
  let validCount = 0;

  for (const c of candidates) {
    if (
      typeof c.summary === "string" &&
      c.summary.trim().length > 20 &&
      c.incidentCount > 0 &&
      c.fatalityCount >= 0 &&
      Array.isArray(c.commonInjuries)
    ) {
      validCount++;
    }
  }

  return {
    validCount,
    total: candidates.length,
  };
}

export function getQualityScore(candidates: Candidate[]): number {
  const { validCount, total } = getQualityAnalysis(candidates);
  if (total === 0) return 0;
  return validCount / total;
}

export function getQualityReason(candidates: Candidate[]): string {
  const { validCount, total } = getQualityAnalysis(candidates);
  const score = total === 0 ? 0 : validCount / total;
  return `Structurally valid ${validCount} of ${total} candidates. Score: ${score}`;
}