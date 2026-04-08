#!/usr/bin/env node
/**
 * Build a smaller Accidents pipe file + label manifest for MUE eval.
 * Usage (from backend/mastra-safety-tool):
 *   node scripts/extract-msha-sample.mjs --max-lines 4000
 *   node scripts/extract-msha-sample.mjs --source ../data/accidents/Accidents.txt --out ../data/accidents/Accidents.sample.txt
 *
 * Then set MSHA_ACCIDENTS_FILE to the sample path in .env for faster, reproducible runs.
 */
import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(__dirname);

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

function isFatality(degreeInjury) {
  return degreeInjury.toUpperCase().includes('FATALITY');
}

function isSeriousOrFatal(degreeInjury) {
  const d = degreeInjury.toUpperCase();
  if (d.includes('FATALITY')) return true;
  if (d.includes('NO DYS AWY FRM WRK,NO RSTR ACT')) return false;
  return true;
}

function severityBucket(degreeInjury) {
  if (isFatality(degreeInjury)) return 'fatal';
  if (!isSeriousOrFatal(degreeInjury)) return 'minor';
  return 'serious_nonfatal';
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return def;
  return process.argv[i + 1];
}

const maxLines = Math.max(1, parseInt(arg('--max-lines', '5000'), 10) || 5000);
const sourceRaw = arg('--source', '');
const outRaw = arg('--out', join(PKG_ROOT, '../data/accidents/Accidents.sample.txt'));
const labelsRaw = arg(
  '--labels',
  outRaw.replace(/\.txt$/i, '.labels.json'),
);

function defaultSourcePath() {
  const env = process.env.MSHA_ACCIDENTS_FILE?.trim();
  if (env) return isAbsolute(env) ? env : join(process.cwd(), env);
  return join(PKG_ROOT, '../data/accidents/Accidents.txt');
}

const sourcePath = sourceRaw || defaultSourcePath();
const outPath = isAbsolute(outRaw) ? outRaw : join(process.cwd(), outRaw);
const labelsPath = isAbsolute(labelsRaw) ? labelsRaw : join(process.cwd(), labelsRaw);

async function main() {
  const lines = [];
  const rl = createInterface({ input: createReadStream(sourcePath, { encoding: 'utf8' }) });
  let header = null;
  let dataCount = 0;

  for await (const line of rl) {
    if (header === null) {
      header = line;
      lines.push(line);
      continue;
    }
    if (!line.trim()) continue;
    lines.push(line);
    dataCount++;
    if (dataCount >= maxLines) break;
  }
  rl.close();

  if (!header) {
    console.error('No header read from', sourcePath);
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

  const headerFields = parsePipeLine(header);
  const docIdx = headerFields.indexOf('DOCUMENT_NO');
  const degIdx = headerFields.indexOf('DEGREE_INJURY');
  if (docIdx < 0 || degIdx < 0) {
    console.error('Expected DOCUMENT_NO and DEGREE_INJURY in header');
    process.exit(1);
  }

  const byDocumentNo = {};
  const stats = { fatal: 0, serious_nonfatal: 0, minor: 0, rows: 0 };

  for (let i = 1; i < lines.length; i++) {
    const fields = parsePipeLine(lines[i]);
    if (fields.length < headerFields.length) continue;
    const documentNo = fields[docIdx] ?? '';
    const degreeInjury = fields[degIdx] ?? '';
    if (!documentNo) continue;
    const sev = severityBucket(degreeInjury);
    stats[sev]++;
    stats.rows++;
    byDocumentNo[documentNo] = {
      degreeInjury,
      isFatality: isFatality(degreeInjury),
      severity: sev,
    };
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourcePath,
    sampleOutPath: outPath,
    maxLinesRequested: maxLines,
    dataRowsWritten: dataCount,
    stats,
    byDocumentNo,
  };

  writeFileSync(labelsPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(JSON.stringify({
    ok: true,
    sourcePath,
    sampleOutPath: outPath,
    labelsPath,
    dataRowsWritten: dataCount,
    stats,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
