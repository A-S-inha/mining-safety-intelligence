/** Same fields as `MshaAccidentRow` used for search text (avoids circular import). */
export type RowForBm25 = {
  documentNo: string;
  narrative: string;
  accidentType: string;
  classification: string;
  miningEquip: string;
  subunit: string;
  ugLocation: string;
};

export type MshaRetrievalMode = 'token' | 'bm25';

const K1 = 1.2;
const B = 0.75;

/** Min token length (avoids noise); keep 2 for codes like "ug". */
const MIN_TOKEN_LEN = 2;

export function getMshaRetrievalMode(): MshaRetrievalMode {
  const v = process.env.MSHA_RETRIEVAL_MODE?.trim().toLowerCase();
  if (v === 'bm25') return 'bm25';
  return 'token';
}

export function rowSearchText(row: RowForBm25): string {
  return [
    row.narrative,
    row.accidentType,
    row.classification,
    row.miningEquip,
    row.subunit,
    row.ugLocation,
  ]
    .join(' ')
    .toLowerCase();
}

export function tokenizeQuery(keyword: string): string[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return [];
  return k
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LEN);
}

function tokenizeDocument(text: string): { terms: string[]; tf: Map<string, number>; len: number } {
  const terms = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LEN);
  const tf = new Map<string, number>();
  for (const t of terms) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return { terms, tf, len: terms.length };
}

export type Bm25Index = {
  rows: RowForBm25[];
  tf: Map<string, number>[];
  docLens: number[];
  avgdl: number;
  df: Map<string, number>;
  N: number;
};

export function buildBm25Index(rows: RowForBm25[]): Bm25Index {
  const N = rows.length;
  const tf: Map<string, number>[] = [];
  const docLens: number[] = [];
  let sumLen = 0;
  const df = new Map<string, number>();

  for (const row of rows) {
    const { tf: m, len } = tokenizeDocument(rowSearchText(row));
    tf.push(m);
    docLens.push(len);
    sumLen += len;
    const seen = new Set<string>();
    for (const t of m.keys()) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const avgdl = N > 0 ? sumLen / N : 0;
  return { rows, tf, docLens, avgdl, df, N };
}

function idfBm25Plus(df: number, N: number): number {
  return Math.log(1 + (N - df + 0.5) / (df + 0.5));
}

export function scoreDocument(
  docIdx: number,
  queryTerms: string[],
  index: Bm25Index,
): number {
  if (queryTerms.length === 0 || index.N === 0) return 0;
  const tfMap = index.tf[docIdx]!;
  const dl = index.docLens[docIdx] ?? 0;
  const avgdl = index.avgdl || 1;
  let score = 0;
  for (const q of queryTerms) {
    const f = tfMap.get(q) ?? 0;
    if (f === 0) continue;
    const dfi = index.df.get(q) ?? 0;
    const idf = idfBm25Plus(dfi, index.N);
    const denom = f + K1 * (1 - B + (B * dl) / avgdl);
    score += idf * ((f * (K1 + 1)) / denom);
  }
  return score;
}

export type Bm25ScoredRow = { row: RowForBm25; score: number };

/**
 * BM25 over `candidates` (already severity + mine filtered). Ranks by relevance; rows with score 0 are excluded.
 */
export function rankByBm25(candidates: RowForBm25[], keyword: string, index: Bm25Index): Bm25ScoredRow[] {
  const queryTerms = tokenizeQuery(keyword);
  if (queryTerms.length === 0) {
    return candidates.map((row) => ({ row, score: 1 }));
  }

  const rowToIdx = new Map<string, number>();
  for (let i = 0; i < index.rows.length; i++) {
    rowToIdx.set(index.rows[i]!.documentNo, i);
  }

  const out: Bm25ScoredRow[] = [];
  for (const row of candidates) {
    const idx = rowToIdx.get(row.documentNo);
    if (idx === undefined) continue;
    const score = scoreDocument(idx, queryTerms, index);
    if (score > 0) out.push({ row, score });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}
