import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  buildBm25Index,
  getMshaRetrievalMode,
  rankByBm25,
  tokenizeQuery,
  type Bm25Index,
} from './msha-bm25';
import { getAccidentsFilePath } from './msha-accidents-path';

export type MshaAccidentRow = {
  documentNo: string;
  subunit: string;
  accidentType: string;
  /** MSHA `DEGREE_INJURY_CD` (e.g. 01=fatality, 02=permanent disability, …). */
  degreeInjuryCd: string;
  degreeInjury: string;
  classification: string;
  narrative: string;
  coalMetalInd: string;
  ugLocation: string;
  miningEquip: string;
  calYr: string;
};

function parsePipeLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === '|' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
}

/** CCM-oriented filter: fatality or more-than-first-aid style outcomes. */
export function isSeriousOrFatal(degreeInjury: string): boolean {
  const d = degreeInjury.toUpperCase();
  if (d.includes('FATALITY')) return true;
  if (d.includes('NO DYS AWY FRM WRK,NO RSTR ACT')) return false;
  return true;
}

export function isFatalityInjury(degreeInjury: string): boolean {
  return degreeInjury.toUpperCase().includes('FATALITY');
}

function countFatalities(rows: MshaAccidentRow[]): number {
  return rows.reduce((n, r) => n + (isFatalityInjury(r.degreeInjury) ? 1 : 0), 0);
}

/**
 * Normalize CD for lookup (MSHA uses 01–07; file may use "1" or "01").
 */
function normalizeDegreeInjuryCd(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const n = parseInt(t, 10);
  if (!Number.isNaN(n) && n >= 0 && n <= 99) return n.toString().padStart(2, '0');
  return t.length <= 2 ? t.padStart(2, '0') : t.slice(0, 2);
}

/**
 * Lower = more severe (for sorting sample: most serious first).
 * 01 fatality, 02 permanent disability, 03 days away, 04 days away+restricted, 05 restricted only,
 * 07 occupational illness, 06 no lost/restricted (usually filtered out), unknown falls between 05 and 07.
 */
const INJURY_CD_SEVERITY_RANK: Record<string, number> = {
  '01': 0,
  '02': 1,
  '03': 2,
  '04': 3,
  '05': 4,
  '07': 5,
  '06': 90,
};

export function injurySeverityRank(row: MshaAccidentRow): number {
  const cd = normalizeDegreeInjuryCd(row.degreeInjuryCd);
  if (cd && cd in INJURY_CD_SEVERITY_RANK) {
    return INJURY_CD_SEVERITY_RANK[cd]!;
  }
  if (isFatalityInjury(row.degreeInjury)) return 0;
  if (!cd) return 6;
  return 7;
}

/** When true (default), token-mode sample is sorted by injury severity (CD-based, then stable tie-break). */
function sampleSeverityOrderEnabled(): boolean {
  const v = process.env.MSHA_SAMPLE_FATALITY_FIRST?.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'off') return false;
  return true;
}

function buildSampleFromMatches(
  matched: MshaAccidentRow[],
  maxRecords: number,
  filePath: string,
  retrievalMode: 'token' | 'bm25' = 'token',
): QueryMshaResult {
  const totalMatched = matched.length;
  const matchedFatalityCount = countFatalities(matched);
  const ordered =
    retrievalMode === 'bm25'
      ? matched
      : sampleSeverityOrderEnabled()
        ? [...matched].sort((a, b) => {
            const ra = injurySeverityRank(a);
            const rb = injurySeverityRank(b);
            if (ra !== rb) return ra - rb;
            return a.documentNo.localeCompare(b.documentNo);
          })
        : matched;
  const records = ordered.slice(0, maxRecords);
  const sampleFatalityCount = countFatalities(records);
  return {
    records,
    totalMatched,
    truncated: totalMatched > records.length,
    filePath,
    matchedFatalityCount,
    sampleFatalityCount,
    retrievalMode,
  };
}

function matchesMineContext(row: MshaAccidentRow, mineTypeHint: string): boolean {
  const hint = mineTypeHint.trim().toLowerCase();
  if (!hint) return true;

  const sub = row.subunit.toUpperCase();
  const ug = row.ugLocation.toUpperCase();
  const cm = row.coalMetalInd.toUpperCase();

  const wantsUnderground =
    /\b(underground|ug\b|under\s*ground)\b/i.test(hint) || hint.includes('underground');
  const wantsSurface = /\bsurface\b/i.test(hint) && !wantsUnderground;
  const wantsCoal = /\bcoal\b/i.test(hint);
  const wantsMetal = /\b(metal|nonmetal|non-metal|m\/n)\b/i.test(hint);

  if (wantsUnderground) {
    const ugOk =
      sub.includes('UNDERGROUND') ||
      sub.includes('SURFACE AT UNDERGROUND') ||
      (!ug.includes('NO VALUE') && ug.length > 2);
    if (!ugOk) return false;
  }

  if (wantsSurface) {
    if (sub === 'UNDERGROUND' && !sub.includes('SURFACE AT')) return false;
  }

  if (wantsCoal && cm !== 'C') return false;
  if (wantsMetal && cm !== 'M') return false;

  return true;
}

function matchesKeyword(row: MshaAccidentRow, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  const tokens = k.split(/\s+/).filter(Boolean);
  const hay = [
    row.narrative,
    row.accidentType,
    row.classification,
    row.miningEquip,
    row.subunit,
    row.ugLocation,
  ]
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function rowFromFields(header: string[], fields: string[]): MshaAccidentRow | null {
  const idx = (name: string) => header.indexOf(name);
  if (fields.length < header.length) return null;
  const degCdI = idx('DEGREE_INJURY_CD');
  return {
    documentNo: fields[idx('DOCUMENT_NO')] ?? '',
    subunit: fields[idx('SUBUNIT')] ?? '',
    accidentType: fields[idx('ACCIDENT_TYPE')] ?? '',
    degreeInjuryCd: degCdI >= 0 ? (fields[degCdI] ?? '') : '',
    degreeInjury: fields[idx('DEGREE_INJURY')] ?? '',
    classification: fields[idx('CLASSIFICATION')] ?? '',
    narrative: fields[idx('NARRATIVE')] ?? '',
    coalMetalInd: fields[idx('COAL_METAL_IND')] ?? '',
    ugLocation: fields[idx('UG_LOCATION')] ?? '',
    miningEquip: fields[idx('MINING_EQUIP')] ?? '',
    calYr: fields[idx('CAL_YR')] ?? '',
  };
}

export type QueryMshaParams = {
  keyword: string;
  mineTypeHint: string;
  maxRecords: number;
  /** If true, skip mine-context filter (broader search). */
  ignoreMineContext?: boolean;
  /** If true, include all injury severities (not only serious/fatal). */
  includeAllSeverities?: boolean;
};

export type QueryMshaResult = {
  records: MshaAccidentRow[];
  totalMatched: number;
  truncated: boolean;
  filePath: string;
  /** Fatalities among all rows matching keyword + filters (not just the sample). */
  matchedFatalityCount: number;
  /** Fatalities among `records` (the sample passed to the LLM). */
  sampleFatalityCount: number;
  /** `token` = all query tokens must appear as substrings; `bm25` = lexical relevance ranking (requires in-memory cache). */
  retrievalMode: 'token' | 'bm25';
};

/**
 * In-memory cache (not a search-engine index): read Accidents.txt once, then filter in RAM.
 * - `serious` (default): only serious/fatal rows — smaller RAM, matches normal MUE tool use.
 * - `full`: every parsed row — faster when using includeAllSeverities or you want one load for any filter.
 * - `off`: stream from disk every query — lowest RAM.
 *
 * Substring + token matching still scans the cached array each query; the win is avoiding repeated disk I/O.
 */
type MemoryCacheMode = 'off' | 'serious' | 'full';

function getMemoryCacheMode(): MemoryCacheMode {
  if (process.env.MSHA_MEMORY_INDEX === 'false' || process.env.MSHA_MEMORY_INDEX === '0') return 'off';
  const mode = process.env.MSHA_MEMORY_CACHE?.trim().toLowerCase();
  if (mode === 'off' || mode === 'false' || mode === '0') return 'off';
  if (mode === 'full' || mode === 'all') return 'full';
  return 'serious';
}

let seriousRowsCache: MshaAccidentRow[] | null = null;
let loadSeriousPromise: Promise<MshaAccidentRow[]> | null = null;

let fullRowsCache: MshaAccidentRow[] | null = null;
let loadFullPromise: Promise<MshaAccidentRow[]> | null = null;

let bm25SeriousRowsRef: MshaAccidentRow[] | null = null;
let bm25SeriousIndex: Bm25Index | null = null;
let bm25FullRowsRef: MshaAccidentRow[] | null = null;
let bm25FullIndex: Bm25Index | null = null;

function getBm25Index(rows: MshaAccidentRow[], kind: 'serious' | 'full'): Bm25Index {
  if (kind === 'serious') {
    if (bm25SeriousIndex && bm25SeriousRowsRef === rows) return bm25SeriousIndex;
    bm25SeriousRowsRef = rows;
    bm25SeriousIndex = buildBm25Index(rows);
    return bm25SeriousIndex;
  }
  if (bm25FullIndex && bm25FullRowsRef === rows) return bm25FullIndex;
  bm25FullRowsRef = rows;
  bm25FullIndex = buildBm25Index(rows);
  return bm25FullIndex;
}

export function clearMshaAccidentsCache(): void {
  seriousRowsCache = null;
  loadSeriousPromise = null;
  fullRowsCache = null;
  loadFullPromise = null;
  bm25SeriousRowsRef = null;
  bm25SeriousIndex = null;
  bm25FullRowsRef = null;
  bm25FullIndex = null;
}

async function loadSeriousAccidentsOnce(): Promise<MshaAccidentRow[]> {
  if (seriousRowsCache) return seriousRowsCache;
  if (!loadSeriousPromise) {
    loadSeriousPromise = (async () => {
      const filePath = getAccidentsFilePath();
      const out: MshaAccidentRow[] = [];
      let header: string[] | null = null;

      const stream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!header) {
          header = parsePipeLine(line);
          continue;
        }
        if (!line.trim()) continue;

        const fields = parsePipeLine(line);
        const row = rowFromFields(header, fields);
        if (!row) continue;
        if (!isSeriousOrFatal(row.degreeInjury)) continue;
        out.push(row);
      }

      seriousRowsCache = out;
      return out;
    })();
  }
  return loadSeriousPromise;
}

async function loadFullAccidentsOnce(): Promise<MshaAccidentRow[]> {
  if (fullRowsCache) return fullRowsCache;
  if (!loadFullPromise) {
    loadFullPromise = (async () => {
      const filePath = getAccidentsFilePath();
      const out: MshaAccidentRow[] = [];
      let header: string[] | null = null;

      const stream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!header) {
          header = parsePipeLine(line);
          continue;
        }
        if (!line.trim()) continue;

        const fields = parsePipeLine(line);
        const row = rowFromFields(header, fields);
        if (!row) continue;
        out.push(row);
      }

      fullRowsCache = out;
      return out;
    })();
  }
  return loadFullPromise;
}

function filterRowsInMemoryBm25(
  rows: MshaAccidentRow[],
  params: QueryMshaParams,
  opts: { applySeverityFilter: boolean },
): QueryMshaResult {
  const filePath = getAccidentsFilePath();
  const maxRecords = Math.min(Math.max(params.maxRecords, 1), 500);
  const cacheKind: 'serious' | 'full' = opts.applySeverityFilter ? 'full' : 'serious';
  const index = getBm25Index(rows, cacheKind);

  const candidates: MshaAccidentRow[] = [];
  for (const row of rows) {
    if (opts.applySeverityFilter && !params.includeAllSeverities && !isSeriousOrFatal(row.degreeInjury)) {
      continue;
    }
    if (!params.ignoreMineContext && !matchesMineContext(row, params.mineTypeHint)) continue;
    candidates.push(row);
  }

  const qTokens = tokenizeQuery(params.keyword);
  if (qTokens.length === 0) {
    return buildSampleFromMatches(candidates, maxRecords, filePath, 'bm25');
  }

  const scored = rankByBm25(candidates, params.keyword, index);
  const matched: MshaAccidentRow[] = scored.map((s) => s.row as MshaAccidentRow);
  return buildSampleFromMatches(matched, maxRecords, filePath, 'bm25');
}

function filterRowsInMemory(
  rows: MshaAccidentRow[],
  params: QueryMshaParams,
  opts: { applySeverityFilter: boolean },
): QueryMshaResult {
  if (getMshaRetrievalMode() === 'bm25') {
    return filterRowsInMemoryBm25(rows, params, opts);
  }

  const filePath = getAccidentsFilePath();
  const maxRecords = Math.min(Math.max(params.maxRecords, 1), 500);
  const matched: MshaAccidentRow[] = [];

  for (const row of rows) {
    if (opts.applySeverityFilter && !params.includeAllSeverities && !isSeriousOrFatal(row.degreeInjury)) {
      continue;
    }
    if (!params.ignoreMineContext && !matchesMineContext(row, params.mineTypeHint)) continue;
    if (!matchesKeyword(row, params.keyword)) continue;

    matched.push(row);
  }

  return buildSampleFromMatches(matched, maxRecords, filePath, 'token');
}

async function queryMshaAccidentsStreaming(params: QueryMshaParams): Promise<QueryMshaResult> {
  if (getMshaRetrievalMode() === 'bm25') {
    const rows = params.includeAllSeverities
      ? await loadFullAccidentsOnce()
      : await loadSeriousAccidentsOnce();
    return filterRowsInMemoryBm25(rows, params, {
      applySeverityFilter: !!params.includeAllSeverities,
    });
  }

  const filePath = getAccidentsFilePath();
  const maxRecords = Math.min(Math.max(params.maxRecords, 1), 500);
  let header: string[] | null = null;
  const matched: MshaAccidentRow[] = [];

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!header) {
      header = parsePipeLine(line);
      continue;
    }
    if (!line.trim()) continue;

    const fields = parsePipeLine(line);
    const row = rowFromFields(header, fields);
    if (!row) continue;

    if (!params.includeAllSeverities && !isSeriousOrFatal(row.degreeInjury)) continue;
    if (!params.ignoreMineContext && !matchesMineContext(row, params.mineTypeHint)) continue;
    if (!matchesKeyword(row, params.keyword)) continue;

    matched.push(row);
  }

  return buildSampleFromMatches(matched, maxRecords, filePath, 'token');
}

export async function queryMshaAccidents(params: QueryMshaParams): Promise<QueryMshaResult> {
  const mode = getMemoryCacheMode();

  if (mode === 'off') {
    return queryMshaAccidentsStreaming(params);
  }

  if (mode === 'full') {
    const rows = await loadFullAccidentsOnce();
    return filterRowsInMemory(rows, params, { applySeverityFilter: true });
  }

  const rows = await loadSeriousAccidentsOnce();
  return filterRowsInMemory(rows, params, { applySeverityFilter: false });
}
