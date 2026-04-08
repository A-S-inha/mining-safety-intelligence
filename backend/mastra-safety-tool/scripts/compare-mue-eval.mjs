#!/usr/bin/env node
/**
 * Compare a completed MUE run (mue-runs.jsonl) against a label manifest from extract-msha-sample.mjs.
 *
 * Usage (from backend/mastra-safety-tool):
 *   node scripts/compare-mue-eval.mjs --labels ../data/accidents/Accidents.sample.labels.json
 *   node scripts/compare-mue-eval.mjs --labels ./labels.json --run-log ./logs/mue-runs.jsonl --workflow-run-id <uuid>
 *
 * Writes human-readable reports under <log-dir>/eval-reports/ (JSON + Markdown) unless --no-save-report.
 * Aggregate JSONL line still appended to mue-eval.jsonl by default.
 */
import { readFileSync, appendFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(__dirname);

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return def;
  return process.argv[i + 1];
}

function readAllJsonl(path) {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').map((line) => JSON.parse(line));
}

function defaultRunLog() {
  const env = process.env.MASTRA_LOG_DIR?.trim();
  if (env) {
    const base = isAbsolute(env) ? env : join(process.cwd(), env);
    return join(base, 'mue-runs.jsonl');
  }
  const candidates = [join(PKG_ROOT, 'logs', 'mue-runs.jsonl'), join(PKG_ROOT, '..', 'logs', 'mue-runs.jsonl')];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

const defaultLabels = join(PKG_ROOT, '../data/accidents/Accidents.sample.labels.json');
const labelsPath = arg('--labels', defaultLabels);
const runLogArg = process.argv.includes('--run-log') ? arg('--run-log', '') : '';
const runLogPath = runLogArg
  ? isAbsolute(runLogArg)
    ? runLogArg
    : join(process.cwd(), runLogArg)
  : defaultRunLog();
const workflowRunIdFilter = arg('--workflow-run-id', '').trim();
const appendEvalPath = process.argv.includes('--append-eval-log')
  ? isAbsolute(arg('--append-eval-log', ''))
    ? arg('--append-eval-log', '')
    : join(process.cwd(), arg('--append-eval-log', ''))
  : join(dirname(runLogPath), 'mue-eval.jsonl');

const noSaveReport = process.argv.includes('--no-save-report');
const reportDirArg = process.argv.includes('--report-dir') ? arg('--report-dir', '') : '';
const reportDir = noSaveReport
  ? ''
  : reportDirArg
    ? isAbsolute(reportDirArg)
      ? reportDirArg
      : join(process.cwd(), reportDirArg)
    : join(dirname(runLogPath), 'eval-reports');

function fileSafeIso(ts) {
  return ts.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function buildMarkdown(r) {
  const mv = r.manualVerification ?? {};
  const lines = [
    `# MUE eval report`,
    ``,
    `- **Time:** ${r.ts}`,
    `- **Run log:** \`${r.runLog}\``,
    `- **Labels:** \`${r.labelsFile}\``,
    `- **Manifest sample file:** \`${r.manifestSamplePath ?? '(unknown)'}\``,
    `- **Workflow run id:** ${r.workflowRunId ?? '_not logged (older run)_'}`,
    `- **Grounding run id:** ${r.groundingRunId}`,
    ``,
    `## Query under test`,
    ``,
    `- **Keyword:** ${r.input?.keyword ?? ''}`,
    `- **Mine type:** ${r.input?.mineType ?? ''}`,
    ``,
    `## Automated checks`,
    ``,
    `- **sampleFatalCountMatches:** ${r.pass?.sampleFatalCountMatches ? 'PASS' : 'FAIL'}`,
    `- **allSampleDocsInManifest:** ${r.pass?.allSampleDocsInManifest ? 'PASS' : 'FAIL'}`,
    ``,
    `## Retrieval vs labels (sample rows)`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Documents in retrieval sample | ${r.sample?.documentCount ?? 0} |`,
    `| Labeled fatal / serious / minor (in manifest) | ${r.sample?.labeledFatalInSample} / ${r.sample?.labeledSeriousInSample} / ${r.sample?.labeledMinorInSample} |`,
    `| Reported sampleFatalityCount (from server) | ${r.sample?.reportedSampleFatalityCount ?? 'n/a'} |`,
    `| Δ reported − labeled fatal | ${r.sample?.deltaReportedVsLabeledFatal ?? 'n/a'} |`,
    `| Doc nos not in manifest | ${r.sample?.extraDocumentNosNotInManifestCount ?? 0} |`,
    `| totalMatched | ${r.retrieval?.totalMatched ?? 'n/a'} |`,
    `| matchedFatalityCount | ${r.retrieval?.matchedFatalityCount ?? 'n/a'} |`,
    `| retrievalMode | ${r.retrieval?.retrievalMode ?? 'n/a'} |`,
    ``,
    `## Grounding summary`,
    ``,
    `- **overallCitationQuality:** ${r.grounding?.overallCitationQuality ?? 'n/a'}`,
    `- **supportingCitationRate:** ${r.grounding?.supportingCitationRate ?? 'n/a'}`,
    ``,
    ...(r.grounding?.perMue?.length
      ? [
          `| MUE title | model fatal | fatal in cited | Δ |`,
          `| --- | --- | --- | --- |`,
          ...r.grounding.perMue.map(
            (m) => `| ${m.title.replace(/\|/g, '/')} | ${m.modelFatalityCount} | ${m.fatalitiesInCitedRecords} | ${m.fatalityCountDelta} |`,
          ),
          ``,
        ]
      : []),
    `## Warnings (from run)`,
    ``,
    ...(r.groundingWarnings?.length ? r.groundingWarnings.map((w) => `- ${w}`) : ['_None._']),
    ``,
    `## DOCUMENT_NO in retrieval sample`,
    ``,
    mv.documentNosInSample?.length
      ? mv.documentNosInSample.length > 120
        ? `_(${mv.documentNosInSample.length} total — see JSON file for full list)_`
        : mv.documentNosInSample.map((id) => `- ${id}`).join('\n')
      : '_None in run record._',
    ``,
    `## Crosswalk: sample docs → label manifest`,
    ``,
    mv.labeledRows?.length
      ? mv.labeledRows
          .map(
            (row) =>
              `- **${row.documentNo}** — severity \`${row.severity}\`, fatality \`${row.isFatality}\`, \`${(row.degreeInjury || '').slice(0, 60)}\``,
          )
          .join('\n')
      : '_No rows in manifest for this sample (use MSHA_ACCIDENTS_FILE = sample when testing)._',
    ``,
  ];
  if (r.sample?.extraDocumentNosNotInManifestCount > 0 && r.sample?.extraDocumentNosNotInManifest?.length) {
    lines.push(`## First doc nos missing from manifest`, ``);
    lines.push(...r.sample.extraDocumentNosNotInManifest.map((id) => `- ${id}`));
    lines.push(``);
  }
  lines.push(`---`, `Full machine-readable copy: sibling \`.json\` with same timestamp.`);
  return lines.join('\n');
}

function main() {
  const labelsFile = isAbsolute(labelsPath) ? labelsPath : join(process.cwd(), labelsPath);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(labelsFile, 'utf8'));
  } catch (e) {
    console.error(
      `Cannot read labels file: ${labelsFile}\nRun: npm run extract:msha-sample -- --max-lines 4000\nOr pass --labels <path>`,
    );
    process.exit(1);
  }
  const byDoc = manifest.byDocumentNo ?? {};

  let records = readAllJsonl(runLogPath).filter((r) => r.kind === 'mue-finder');
  if (workflowRunIdFilter) {
    records = records.filter((r) => r.workflowRunId === workflowRunIdFilter);
  }
  const run = records.length ? records[records.length - 1] : null;

  if (!run) {
    console.error(
      workflowRunIdFilter
        ? `No mue-finder record with workflowRunId=${workflowRunIdFilter} in ${runLogPath}`
        : `No mue-finder record in ${runLogPath}`,
    );
    process.exit(1);
  }

  const sampleIds = run.search?.documentNosInSample ?? [];
  let labeledFatalInSample = 0;
  let labeledSeriousInSample = 0;
  let labeledMinorInSample = 0;
  const extraInRunNotInLabels = [];

  for (const id of sampleIds) {
    const row = byDoc[id];
    if (!row) {
      extraInRunNotInLabels.push(id);
      continue;
    }
    if (row.severity === 'fatal') labeledFatalInSample++;
    else if (row.severity === 'serious_nonfatal') labeledSeriousInSample++;
    else labeledMinorInSample++;
  }

  const reportedSampleFatal = run.search?.sampleFatalityCount ?? null;
  const deltaSampleFatal = reportedSampleFatal !== null ? reportedSampleFatal - labeledFatalInSample : null;

  const perMue = [];
  for (const m of run.groundingReport?.perMue ?? []) {
    perMue.push({
      title: m.title,
      modelFatalityCount: m.modelFatalityCount,
      fatalitiesInCitedRecords: m.fatalitiesInCitedRecords,
      fatalityCountDelta: m.fatalityCountDelta,
    });
  }

  const report = {
    kind: 'mue-eval',
    ts: new Date().toISOString(),
    labelsFile: labelsFile,
    manifestSamplePath: manifest.sampleOutPath,
    runLog: runLogPath,
    workflowRunId: run.workflowRunId ?? null,
    groundingRunId: run.runId,
    input: run.input,
    sample: {
      documentCount: sampleIds.length,
      labeledFatalInSample,
      labeledSeriousInSample,
      labeledMinorInSample,
      reportedSampleFatalityCount: reportedSampleFatal,
      deltaReportedVsLabeledFatal: deltaSampleFatal,
      extraDocumentNosNotInManifest: extraInRunNotInLabels.slice(0, 50),
      extraDocumentNosNotInManifestCount: extraInRunNotInLabels.length,
    },
    retrieval: {
      totalMatched: run.search?.totalMatched,
      matchedFatalityCount: run.search?.matchedFatalityCount,
      retrievalMode: run.search?.retrievalMode,
    },
    grounding: {
      overallCitationQuality: run.groundingReport?.overallCitationQuality,
      supportingCitationRate: run.groundingReport?.supportingCitationRate,
      perMue,
    },
    pass: {
      sampleFatalCountMatches: deltaSampleFatal === 0,
      allSampleDocsInManifest: extraInRunNotInLabels.length === 0,
    },
    groundingWarnings: run.groundingReport?.warnings ?? [],
    manualVerification: {
      documentNosInSample: sampleIds,
      labeledRows: sampleIds
        .filter((id) => byDoc[id])
        .map((id) => ({
          documentNo: id,
          ...byDoc[id],
        })),
    },
  };

  const summaryForJsonl = { ...report };
  delete summaryForJsonl.manualVerification;

  console.log(JSON.stringify(report, null, 2));

  mkdirSync(dirname(appendEvalPath), { recursive: true });
  appendFileSync(appendEvalPath, `${JSON.stringify(summaryForJsonl)}\n`, 'utf8');

  if (!noSaveReport && reportDir) {
    mkdirSync(reportDir, { recursive: true });
    const stamp = fileSafeIso(report.ts);
    const jsonReportPath = join(reportDir, `eval-${stamp}.json`);
    const mdReportPath = join(reportDir, `eval-${stamp}.md`);
    writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(mdReportPath, buildMarkdown(report), 'utf8');
    console.log(`\nSaved eval reports:\n  ${jsonReportPath}\n  ${mdReportPath}\n`);
  }
}

main();
