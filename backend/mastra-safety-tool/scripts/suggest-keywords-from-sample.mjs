#!/usr/bin/env node
/**
 * Analyze Accidents.sample.txt (or any pipe file) to suggest MUE test keywords
 * and show how many rows would match token-style retrieval (all tokens as substrings).
 *
 * Usage (from backend/mastra-safety-tool):
 *   npm run suggest:sample-keywords
 *   node scripts/suggest-keywords-from-sample.mjs --sample ../data/accidents/Accidents.sample.txt
 */
import { createReadStream, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(__dirname);

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return def;
  return process.argv[i + 1];
}

function parsePipeLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === '|' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else cur += c;
  }
  fields.push(cur);
  return fields.map((f) => f.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
}

const STOP = new Set(
  'the and for with that this from were was are but not have has had their they been into than then them its also only about over such other will more when what which while your each under after before between through during being both some same into than then them its can could should would may might must shall'.split(
    ' ',
  ),
);

function haystack(row) {
  return [row.narrative, row.accidentType, row.classification, row.miningEquip, row.subunit, row.ugLocation]
    .join(' ')
    .toLowerCase();
}

function tokenMatchCount(keyword, rows) {
  const k = keyword.trim().toLowerCase();
  if (!k) return 0;
  const tokens = k.split(/\s+/).filter(Boolean);
  return rows.reduce((n, row) => {
    const hay = haystack(row);
    return n + (tokens.every((t) => hay.includes(t)) ? 1 : 0);
  }, 0);
}

function wordsFromText(s) {
  return (s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

async function loadRows(samplePath) {
  const rows = [];
  const rl = createInterface({ input: createReadStream(samplePath, { encoding: 'utf8' }) });
  let header = null;
  let headerFields = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = line;
      headerFields = header.split('|').map((h) => h.replace(/^"|"$/g, '').trim());
      continue;
    }
    const fields = parsePipeLine(line);
    if (fields.length < headerFields.length) continue;
    const idx = (name) => headerFields.indexOf(name);
    rows.push({
      documentNo: fields[idx('DOCUMENT_NO')] ?? '',
      subunit: fields[idx('SUBUNIT')] ?? '',
      accidentType: fields[idx('ACCIDENT_TYPE')] ?? '',
      degreeInjury: fields[idx('DEGREE_INJURY')] ?? '',
      classification: fields[idx('CLASSIFICATION')] ?? '',
      narrative: fields[idx('NARRATIVE')] ?? '',
      miningEquip: fields[idx('MINING_EQUIP')] ?? '',
      ugLocation: fields[idx('UG_LOCATION')] ?? '',
      coalMetalInd: fields[idx('COAL_METAL_IND')] ?? '',
    });
  }
  rl.close();
  return { headerFields, rows };
}

function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const v = (r[key] || '').trim();
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const sampleArg = arg('--sample', join(PKG_ROOT, '../data/accidents/Accidents.sample.txt'));
  const samplePath = isAbsolute(sampleArg) ? sampleArg : join(process.cwd(), sampleArg);
  const outDirArg = arg('--out-dir', dirname(samplePath));
  const outDir = isAbsolute(outDirArg) ? outDirArg : join(process.cwd(), outDirArg);
  const baseName = 'Accidents.sample.keyword-hints';

  if (!existsSync(samplePath)) {
    console.error(`Sample file not found: ${samplePath}\nRun: npm run extract:msha-sample -- --max-lines 4000`);
    process.exit(1);
  }

  const { rows } = await loadRows(samplePath);

  const freq = new Map();
  for (const r of rows) {
    for (const w of wordsFromText(
      `${r.narrative} ${r.accidentType} ${r.classification} ${r.miningEquip}`,
    )) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);

  const fatalityRows = rows.filter((r) => r.degreeInjury.toUpperCase().includes('FATALITY'));
  const undergroundRows = rows.filter((r) => r.subunit.toUpperCase().includes('UNDERGROUND'));
  const coalRows = rows.filter((r) => r.coalMetalInd.toUpperCase() === 'C');

  const candidateKeywords = [
    ...topWords.map(([w]) => w),
    ...fatalityRows.flatMap((r) => wordsFromText(`${r.narrative} ${r.miningEquip}`).slice(0, 8)),
  ];
  const unique = [...new Set(candidateKeywords)];

  const scored = unique
    .map((kw) => ({ keyword: kw, matches: tokenMatchCount(kw, rows) }))
    .filter((x) => x.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 25);

  const phraseCandidates = ['slip fall', 'shuttle car', 'belt conveyor', 'fall person', 'hand tool'];
  const phraseScored = phraseCandidates
    .map((kw) => ({ keyword: kw, matches: tokenMatchCount(kw, rows) }))
    .filter((x) => x.matches > 0)
    .sort((a, b) => b.matches - a.matches);

  const hints = {
      generatedAt: new Date().toISOString(),
      samplePath,
      rowCount: rows.length,
      undergroundCount: undergroundRows.length,
      coalCount: coalRows.length,
      fatalityCount: fatalityRows.length,
      fatalityRows: fatalityRows.map((r) => ({
        documentNo: r.documentNo,
        degreeInjury: r.degreeInjury,
        subunit: r.subunit,
        accidentType: r.accidentType,
        miningEquip: r.miningEquip.slice(0, 120),
        narrativeExcerpt: r.narrative.slice(0, 200),
        suggestedTryKeywords: [...new Set(wordsFromText(`${r.narrative} ${r.miningEquip}`))].slice(0, 12),
      })),
      topAccidentTypes: countBy(rows, 'accidentType').slice(0, 15),
      topClassifications: countBy(rows, 'classification').slice(0, 15),
      topUnigramsByFrequency: topWords.slice(0, 20),
      suggestedKeywordsByMatchCount: scored,
      suggestedPhrasesByMatchCount: phraseScored,
      note:
        'Token mode requires every word in the keyword to appear as a substring in narrative/type/classification/equipment/subunit/UG location. Prefer fewer words for broader matches.',
  };

  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `${baseName}.json`);
  const mdPath = join(outDir, `${baseName}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(hints, null, 2)}\n`, 'utf8');

  const md = [
      `# Keyword hints from sample`,
      ``,
      `- **File:** \`${samplePath}\``,
      `- **Rows:** ${rows.length} | **Underground (subunit):** ${undergroundRows.length} | **Coal (C):** ${coalRows.length} | **Fatalities:** ${fatalityRows.length}`,
      ``,
      `## Fatality rows (test high materiality)`,
      hints.fatalityRows.length
        ? hints.fatalityRows
            .map(
              (f) =>
                `### ${f.documentNo}\n- **Try keywords:** ${f.suggestedTryKeywords.join(', ')}\n- **Equip:** ${f.miningEquip}\n- **Narrative:** ${f.narrativeExcerpt}…\n`,
            )
            .join('\n')
        : '_None in this sample._',
      ``,
      `## Best single-word queries (by rows matched in this file)`,
      scored
        .slice(0, 15)
        .map((s) => `- **${s.keyword}** → ${s.matches} rows`)
        .join('\n'),
      ``,
      `## Phrase smoke tests`,
      phraseScored.map((s) => `- **${s.keyword}** → ${s.matches} rows`).join('\n') || '_No matches._',
      ``,
      `## Top accident types`,
      countBy(rows, 'accidentType')
        .slice(0, 10)
        .map(([t, n]) => `- ${n}× ${t}`)
        .join('\n'),
      ``,
      `## Top classifications`,
      countBy(rows, 'classification')
        .slice(0, 10)
        .map(([t, n]) => `- ${n}× ${t}`)
        .join('\n'),
      ``,
  ].join('\n');

  writeFileSync(mdPath, md, 'utf8');

  console.log(JSON.stringify({ jsonPath, mdPath, rowCount: rows.length, fatalityCount: fatalityRows.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
