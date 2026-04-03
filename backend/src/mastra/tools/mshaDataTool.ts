import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

/**
 * MSHA Accident/Injury file — key fields (assignment alignment)
 *
 * Present as columns in `Accidents.txt`: SUBUNIT, ACCIDENT_TYPE, DEGREE_INJURY,
 * NARRATIVE, NO_INJURIES, COAL_METAL_IND.
 *
 * Not present as standalone columns in this extract:
 * - MINE_TYPE — derived with `deriveMineTypeFromMshaRow()` from SUBUNIT, UG_LOCATION,
 *   and COAL_METAL_IND (see MSHA data dictionary / Open Government layouts).
 * - FATALITIES — derived with `deriveFatalities()` from DEGREE_INJURY (e.g. "FATALITY").
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

/** File in repo is `Accidents.txt` (case-sensitive on Linux/macOS). */
const DATA_PATH = path.join(process.cwd(), "data", "Accidents.txt");

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Match a user phrase against combined record text.
 * - First tries the full phrase (substring).
 * - Otherwise requires each whitespace-separated token to appear (so "underground coal"
 *   matches rows that mention both "underground" and "coal" / coal operations).
 */
function textMatchesQuery(parts: string[], query: string | undefined): boolean {
  if (!query?.trim()) return true;

  const q = normalize(query);
  const haystack = normalize(parts.filter(Boolean).join("\n"));

  if (haystack.includes(q)) return true;

  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length <= 1) return haystack.includes(tokens[0] ?? "");

  return tokens.every((t) => haystack.includes(t));
}

/** Maps to the MINE_TYPE concept for search: commodity + location + subunit text. */
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

/** Maps to FATALITIES: this file encodes fatality in DEGREE_INJURY, not a separate count column. */
export function deriveFatalities(row: MSHARow): 0 | 1 {
  const injury = normalize(row.DEGREE_INJURY);
  return injury.includes("fatal") ? 1 : 0;
}

function mineTypeHaystack(row: MSHARow): string[] {
  const coalMetalHint =
    row.COAL_METAL_IND === "C"
      ? "coal mining coal operation "
      : row.COAL_METAL_IND === "M"
        ? "metal nonmetal "
        : "";

  return [
    deriveMineTypeFromMshaRow(row),
    row.SUBUNIT,
    row.UG_LOCATION,
    row.CLASSIFICATION,
    row.NARRATIVE,
    row.COAL_METAL_IND,
    row.MINING_EQUIP,
    coalMetalHint,
  ];
}

function keywordHaystack(row: MSHARow): string[] {
  return [
    row.NARRATIVE,
    row.ACCIDENT_TYPE,
    row.DEGREE_INJURY,
    row.ACTIVITY,
    row.INJURY_SOURCE,
    row.CLASSIFICATION,
    row.MINING_EQUIP,
  ];
}

export function loadAccidentData(): MSHARow[] {
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

  return records.map((row: Record<string, string>) => ({
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
}

function rowMatchesMineType(row: MSHARow, mineType?: string): boolean {
  return textMatchesQuery(mineTypeHaystack(row), mineType);
}

function rowMatchesKeyword(row: MSHARow, keyword?: string): boolean {
  return textMatchesQuery(keywordHaystack(row), keyword);
}

/** MSHA uses many abbreviated degree labels; keep injury-related rows without requiring perfect English phrases. */
function rowIsSerious(row: MSHARow): boolean {
  if (deriveFatalities(row) === 1) return true;

  const injury = normalize(row.DEGREE_INJURY);
  const injuries = Number(row.NO_INJURIES || "0");

  return (
    injury.includes("permanent") ||
    injury.includes("restricted") ||
    injury.includes("rstr") ||
    injury.includes("days away") ||
    injury.includes("dys awy") ||
    injury.includes("away from work") ||
    injury.includes("disab") ||
    injuries >= 1
  );
}

export function findRelevantAccidents(input: FindMuesInput): MSHARow[] {
  const rows = loadAccidentData();

  return rows
    .filter((row) => rowMatchesMineType(row, input.mineType))
    .filter((row) => rowMatchesKeyword(row, input.keyword))
    .filter(rowIsSerious)
    .slice(0, 50);
}

/** Records sent to the MUE agent — aligned to MSHA key fields (mineType/fatalities derived; see file header comment). */
export function summarizeForAgent(rows: MSHARow[]) {
  return rows.map((row) => ({
    mineType: deriveMineTypeFromMshaRow(row),
    subunit: row.SUBUNIT,
    accidentType: row.ACCIDENT_TYPE,
    degreeInjury: row.DEGREE_INJURY,
    narrative: row.NARRATIVE,
    noInjuries: row.NO_INJURIES,
    fatalities: String(deriveFatalities(row)),
    coalMetalInd: row.COAL_METAL_IND,
  }));
}