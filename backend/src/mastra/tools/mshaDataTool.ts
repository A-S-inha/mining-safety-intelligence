import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import MiniSearch from "minisearch";

/**
 * MSHA Accident/Injury file — key fields used in this project.
 */
export type MSHARow = {
  MINE_ID: string;
  SUBUNIT: string;
  UG_LOCATION: string;
  ACCIDENT_DT: string;
  DEGREE_INJURY: string;
  CLASSIFICATION: string;
  ACCIDENT_TYPE: string;
  NO_INJURIES: string;
  MINING_EQUIP: string;
  OCCUPATION: string;
  ACTIVITY: string;
  INJURY_SOURCE: string;
  NATURE_INJURY: string;
  INJ_BODY_PART: string;
  NARRATIVE: string;
  COAL_METAL_IND: string;
};

export type FindMuesInput = {
  mineType?: string;
  keyword?: string;
};

type IndexedMSHARow = MSHARow & {
  _rowId: string;
  _mineTypeText: string;
  _keywordText: string;
};

type SearchDocument = {
  id: string;
  mineTypeText: string;
  keywordText: string;
  degreeInjury: string;
  accidentType: string;
  narrative: string;
};

export type SummarizedMSHARecord = {
  rowId: string;
  mineId: string;
  accidentDate: string;
  mineType: string;
  subunit: string;
  accidentType: string;
  degreeInjury: string;
  narrative: string;
  noInjuries: string;
  fatalities: string;
  coalMetalInd: string;
};

const DATA_PATH = path.join(process.cwd(), "data", "Accidents.txt");

let cachedRows: MSHARow[] | null = null;
let cachedIndexedRows: IndexedMSHARow[] | null = null;
let cachedMiniSearch: MiniSearch<SearchDocument> | null = null;
let cachedRowMap: Map<string, IndexedMSHARow> | null = null;
let hasLoggedDegreeInjuryDistribution = false;

const SERIOUS_DEGREE_INJURY_EXACT = new Set([
  "fatality",
  "days away from work only",
  "days restricted activity only",
  "dys awy frm wrk & restrctd act",
  "perm tot or perm prtl disablty",
]);

const NON_SERIOUS_DEGREE_INJURY_EXACT = new Set([
  "no dys awy frm wrk,no rstr act",
  "accident only",
  "all other cases (incl 1st aid)",
]);

const SERIOUS_DEGREE_INJURY_PATTERNS = [
  "fatal",
  "days away",
  "dys awy",
  "restricted",
  "rstr",
  "perm",
  "permanent",
  "disabl",
];

function log(stage: string, data?: unknown) {
  if (data !== undefined) {
    console.log(`[mshaDataTool] ${stage}`, data);
  } else {
    console.log(`[mshaDataTool] ${stage}`);
  }
}

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function safeNumber(value: string | undefined): number {
  const n = Number(value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  const normalizedValue = normalize(value);
  return patterns.some((pattern) => normalizedValue.includes(pattern));
}

/** Maps to the MINE_TYPE concept for search. */
export function deriveMineTypeFromMshaRow(row: MSHARow): string {
  const commodity =
    row.COAL_METAL_IND === "C"
      ? "Coal"
      : row.COAL_METAL_IND === "M"
        ? "Metal/Nonmetal"
        : "";

  const ug = row.UG_LOCATION?.trim();
  const ugOk = ug && ug !== "?" && ug !== "NO VALUE FOUND";
  const sub = row.SUBUNIT?.trim() ?? "";

  return [commodity, ugOk ? ug : null, sub].filter(Boolean).join(" | ");
}

/** Derive fatalities from DEGREE_INJURY. */
export function deriveFatalities(row: MSHARow): 0 | 1 {
  const injury = normalize(row.DEGREE_INJURY);
  return injury.includes("fatal") ? 1 : 0;
}

function buildMineTypeText(row: MSHARow): string {
  const commodityHints =
    row.COAL_METAL_IND === "C"
      ? "coal mining coal operation"
      : row.COAL_METAL_IND === "M"
        ? "metal nonmetal mining operation"
        : "";

  return normalize(
    [
      deriveMineTypeFromMshaRow(row),
      row.SUBUNIT,
      row.UG_LOCATION,
      row.CLASSIFICATION,
      row.NARRATIVE,
      row.MINING_EQUIP,
      commodityHints,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function buildKeywordText(row: MSHARow): string {
  return normalize(
    [
      row.NARRATIVE,
      row.ACCIDENT_TYPE,
      row.DEGREE_INJURY,
      row.ACTIVITY,
      row.INJURY_SOURCE,
      row.CLASSIFICATION,
      row.MINING_EQUIP,
      row.NATURE_INJURY,
      row.INJ_BODY_PART,
      row.OCCUPATION,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

type DegreeInjuryCategory = "serious" | "non_serious" | "unknown";

function categorizeDegreeInjury(value: string): DegreeInjuryCategory {
  const injury = normalize(value);

  if (!injury || injury === "no value found") return "unknown";
  if (NON_SERIOUS_DEGREE_INJURY_EXACT.has(injury)) return "non_serious";
  if (SERIOUS_DEGREE_INJURY_EXACT.has(injury)) return "serious";
  if (matchesAnyPattern(injury, SERIOUS_DEGREE_INJURY_PATTERNS)) return "serious";

  return "unknown";
}

export function logDegreeInjuryDistribution(rows: MSHARow[]) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = row.DEGREE_INJURY?.trim() || "(blank)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  log("degree injury distribution", {
    uniqueValues: sorted.length,
    topValues: sorted.slice(0, 50).map(([label, count]) => ({
      label,
      count,
      category: categorizeDegreeInjury(label),
    })),
  });
}

export function logUnknownDegreeInjuryLabels(rows: MSHARow[]) {
  const unknownCounts = new Map<string, number>();

  for (const row of rows) {
    if (deriveFatalities(row) === 1) continue;

    const category = categorizeDegreeInjury(row.DEGREE_INJURY);
    if (category === "unknown") {
      const label = row.DEGREE_INJURY?.trim() || "(blank)";
      unknownCounts.set(label, (unknownCounts.get(label) ?? 0) + 1);
    }
  }

  const sorted = Array.from(unknownCounts.entries()).sort((a, b) => b[1] - a[1]);

  log("unknown degree injury labels", {
    uniqueUnknownLabels: sorted.length,
    labels: sorted.slice(0, 30).map(([label, count]) => ({ label, count })),
  });
}

export function loadAccidentData(): MSHARow[] {
  if (cachedRows) {
    log("loadAccidentData: using cached rows", { count: cachedRows.length });
    return cachedRows;
  }

  log("loadAccidentData: reading file", { path: DATA_PATH });

  const startedAt = Date.now();
  const fileContent = fs.readFileSync(DATA_PATH, "utf-8");

  const records: Record<string, string>[] = parse(fileContent, {
    delimiter: "|",
    columns: true,
    skip_empty_lines: true,
    quote: '"',
    escape: '"',
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true,
    trim: true,
    bom: true,
  });

  cachedRows = records.map((row: Record<string, string>) => ({
    MINE_ID: row.MINE_ID ?? "",
    SUBUNIT: row.SUBUNIT ?? "",
    UG_LOCATION: row.UG_LOCATION ?? "",
    ACCIDENT_DT: row.ACCIDENT_DT ?? "",
    DEGREE_INJURY: row.DEGREE_INJURY ?? "",
    CLASSIFICATION: row.CLASSIFICATION ?? "",
    ACCIDENT_TYPE: row.ACCIDENT_TYPE ?? "",
    NO_INJURIES: row.NO_INJURIES ?? "",
    MINING_EQUIP: row.MINING_EQUIP ?? "",
    OCCUPATION: row.OCCUPATION ?? "",
    ACTIVITY: row.ACTIVITY ?? "",
    INJURY_SOURCE: row.INJURY_SOURCE ?? "",
    NATURE_INJURY: row.NATURE_INJURY ?? "",
    INJ_BODY_PART: row.INJ_BODY_PART ?? "",
    NARRATIVE: row.NARRATIVE ?? "",
    COAL_METAL_IND: row.COAL_METAL_IND ?? "",
  }));

  log("loadAccidentData: loaded rows", {
    count: cachedRows.length,
    durationMs: Date.now() - startedAt,
  });

  if (!hasLoggedDegreeInjuryDistribution) {
    logDegreeInjuryDistribution(cachedRows);
    logUnknownDegreeInjuryLabels(cachedRows);
    hasLoggedDegreeInjuryDistribution = true;
  }

  return cachedRows;
}

export function loadIndexedAccidentData(): IndexedMSHARow[] {
  if (cachedIndexedRows) {
    log("loadIndexedAccidentData: using cached index", {
      count: cachedIndexedRows.length,
    });
    return cachedIndexedRows;
  }

  const startedAt = Date.now();
  const rows = loadAccidentData();

  cachedIndexedRows = rows.map((row, idx) => ({
    ...row,
    _rowId: `row-${idx}`,
    _mineTypeText: buildMineTypeText(row),
    _keywordText: buildKeywordText(row),
  }));

  cachedRowMap = new Map(
    cachedIndexedRows.map((row) => [row._rowId, row])
  );

  log("loadIndexedAccidentData: built indexed rows", {
    count: cachedIndexedRows.length,
    durationMs: Date.now() - startedAt,
  });

  return cachedIndexedRows;
}

export function loadMiniSearchIndex(): MiniSearch<SearchDocument> {
  if (cachedMiniSearch) {
    log("loadMiniSearchIndex: using cached BM25 index");
    return cachedMiniSearch;
  }

  const startedAt = Date.now();
  const rows = loadIndexedAccidentData();

  const miniSearch = new MiniSearch<SearchDocument>({
    fields: ["mineTypeText", "keywordText"],
    storeFields: ["id", "degreeInjury", "accidentType", "narrative"],
    searchOptions: {
      boost: {
        keywordText: 2,
        mineTypeText: 1.2,
      },
      prefix: true,
      fuzzy: 0.2,
    },
  });

  const docs: SearchDocument[] = rows.map((row) => ({
    id: row._rowId,
    mineTypeText: row._mineTypeText,
    keywordText: row._keywordText,
    degreeInjury: row.DEGREE_INJURY,
    accidentType: row.ACCIDENT_TYPE,
    narrative: row.NARRATIVE,
  }));

  miniSearch.addAll(docs);
  cachedMiniSearch = miniSearch;

  log("loadMiniSearchIndex: built BM25 index", {
    documentCount: docs.length,
    durationMs: Date.now() - startedAt,
  });

  return cachedMiniSearch;
}

function rowIsSerious(row: MSHARow): boolean {
  if (deriveFatalities(row) === 1) return true;

  return categorizeDegreeInjury(row.DEGREE_INJURY) === "serious";
}

function scoreSeverity(row: IndexedMSHARow): number {
  let score = 0;

  if (deriveFatalities(row) === 1) score += 30;

  const injury = normalize(row.DEGREE_INJURY);

  if (injury.includes("perm")) score += 15;
  if (injury.includes("days away")) score += 8;
  if (injury.includes("dys awy")) score += 8;
  if (injury.includes("restricted")) score += 5;
  if (injury.includes("rstr")) score += 5;

  return score;
}

function buildQuery(input: FindMuesInput): string {
  return [input.mineType ?? "", input.keyword ?? ""]
    .map((v) => normalize(v))
    .filter(Boolean)
    .join(" ");
}

export function findRelevantAccidents(input: FindMuesInput): MSHARow[] {
  const startedAt = Date.now();
  const rows = loadIndexedAccidentData();
  const miniSearch = loadMiniSearchIndex();
  const rowMap = cachedRowMap ?? new Map<string, IndexedMSHARow>();

  log("findRelevantAccidents: input", input);
  log("findRelevantAccidents: total indexed rows", { count: rows.length });

  const seriousRows = rows.filter(rowIsSerious);

  log("findRelevantAccidents: severity breakdown", {
    totalRows: rows.length,
    seriousRows: seriousRows.length,
    fatalRows: rows.filter((r) => deriveFatalities(r) === 1).length,
    seriousByExactLabel: Array.from(
      seriousRows.reduce((acc, row) => {
        const label = row.DEGREE_INJURY?.trim() || "(blank)";
        acc.set(label, (acc.get(label) ?? 0) + 1);
        return acc;
      }, new Map<string, number>())
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([label, count]) => ({ label, count })),
  });

  const seriousIds = new Set(seriousRows.map((row) => row._rowId));
  const query = buildQuery(input);

  if (!query) {
    log(
      "findRelevantAccidents: empty query, returning serious rows ranked by severity"
    );

    const ranked = seriousRows
      .map((row) => ({
        row,
        bm25Score: 0,
        severityScore: scoreSeverity(row),
        totalScore: scoreSeverity(row),
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    log("findRelevantAccidents: ranked serious rows", {
      count: ranked.length,
      top10: ranked.slice(0, 10).map((item) => ({
        rowId: item.row._rowId,
        mineId: item.row.MINE_ID,
        accidentDate: item.row.ACCIDENT_DT,
        subunit: item.row.SUBUNIT,
        accidentType: item.row.ACCIDENT_TYPE,
        degreeInjury: item.row.DEGREE_INJURY,
        severityScore: item.severityScore,
        narrativePreview: item.row.NARRATIVE.slice(0, 160),
      })),
      durationMs: Date.now() - startedAt,
    });

    return ranked.map((item) => item.row);
  }

  const searchResults = miniSearch.search(query, {
    boost: {
      keywordText: 2,
      mineTypeText: 1.2,
    },
    prefix: true,
    fuzzy: 0.2,
  });

  log("findRelevantAccidents: BM25 raw results", {
    query,
    count: searchResults.length,
  });

  const reranked = searchResults
    .map((result) => {
      const row = rowMap.get(String(result.id));
      if (!row) return null;
      if (!seriousIds.has(String(result.id))) return null;

      const severityScore = scoreSeverity(row);
      const totalScore = result.score + severityScore;

      return {
        row,
        bm25Score: result.score,
        severityScore,
        totalScore,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.totalScore - a.totalScore);

  log("findRelevantAccidents: reranked results", {
    query,
    count: reranked.length,
    top10: reranked.slice(0, 10).map((item) => ({
      rowId: item.row._rowId,
      mineId: item.row.MINE_ID,
      accidentDate: item.row.ACCIDENT_DT,
      subunit: item.row.SUBUNIT,
      accidentType: item.row.ACCIDENT_TYPE,
      degreeInjury: item.row.DEGREE_INJURY,
      bm25Score: item.bm25Score,
      severityScore: item.severityScore,
      totalScore: item.totalScore,
      narrativePreview: item.row.NARRATIVE.slice(0, 160),
    })),
    durationMs: Date.now() - startedAt,
  });

  return reranked.map((item) => item.row);
}

/** Records sent to the MUE agent. */
export function summarizeForAgent(rows: MSHARow[]): SummarizedMSHARecord[] {
  log("summarizeForAgent: rows received", { count: rows.length });

  const indexedRows = loadIndexedAccidentData();
  const rowKeyToId = new Map<string, string>();

  for (const row of indexedRows) {
    const key = `${row.MINE_ID}||${row.ACCIDENT_DT}||${row.NARRATIVE}`;
    rowKeyToId.set(key, row._rowId);
  }

  const summarized = rows.map((row) => {
    const key = `${row.MINE_ID}||${row.ACCIDENT_DT}||${row.NARRATIVE}`;

    return {
      rowId: rowKeyToId.get(key) ?? "",
      mineId: row.MINE_ID,
      accidentDate: row.ACCIDENT_DT,
      mineType: deriveMineTypeFromMshaRow(row),
      subunit: row.SUBUNIT,
      accidentType: row.ACCIDENT_TYPE,
      degreeInjury: row.DEGREE_INJURY,
      narrative: row.NARRATIVE,
      noInjuries: row.NO_INJURIES,
      fatalities: String(deriveFatalities(row)),
      coalMetalInd: row.COAL_METAL_IND,
    };
  });

  log("summarizeForAgent: rows summarized", {
    count: summarized.length,
    preview: summarized.slice(0, 5).map((r) => ({
      rowId: r.rowId,
      mineId: r.mineId,
      accidentDate: r.accidentDate,
      accidentType: r.accidentType,
      degreeInjury: r.degreeInjury,
    })),
  });

  return summarized;
}