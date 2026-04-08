const base = import.meta.env.VITE_API_BASE ?? '';

export async function findMues(keyword: string, mineType: string) {
  const res = await fetch(`${base}/find-mues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, mineType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : res.statusText || 'Request failed');
  }
  return data as MueFinderResponse;
}

export async function findControls(mueName: string) {
  const res = await fetch(`${base}/find-controls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mueName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : res.statusText || 'Request failed');
  }
  return data;
}

export type MueCandidate = {
  rank: number;
  title: string;
  description: string;
  incidentCount: number;
  fatalityCount: number;
  commonInjuryTypes: string[];
  narrativeSummary: string;
  materialityFlag: 'high' | 'medium' | 'low';
  supportingDocumentNos: string[];
};

export type GroundingReport = {
  runId: string;
  timestamp: string;
  retrievalSampleSize: number;
  totalMatchedInQuery: number;
  truncated: boolean;
  supportingCitationRate: number;
  overallCitationQuality: 'good' | 'mixed' | 'poor';
  warnings: string[];
  perMue: Array<{
    title: string;
    invalidSupportingIds: string[];
    modelFatalityCount: number;
    fatalitiesInCitedRecords: number;
    fatalityCountDelta: number;
  }>;
};

export type MueFinderResponse = {
  querySummary: string;
  dataNotes: string;
  candidateMues: MueCandidate[];
  groundingReport: GroundingReport;
};
