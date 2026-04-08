#!/usr/bin/env node
/**
 * Run fixed MUE benchmark cases against a live Mastra server and log scored results.
 *
 * Prerequisites:
 *   - `mastra dev` (or `mastra start`) running with API reachable.
 *   - For meaningful Metrics A/B vs labels: MSHA_ACCIDENTS_FILE=Accidents.sample.txt (restart after change).
 *   - Extra keyword anchors (non-destructive data): `backend/data/accidents/Accidents.sample.anchor-cases.json`.
 *
 * Usage (from backend/mastra-safety-tool):
 *   npm run benchmark:mue
 *   node scripts/run-mue-benchmark.mjs --url http://127.0.0.1:4111/find-mues
 *
 * Env: MUE_BENCHMARK_URL (optional), MASTRA_LOG_DIR not required for this script.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(__dirname);

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return def;
  return process.argv[i + 1];
}

const defaultLabels = join(PKG_ROOT, '../data/accidents/Accidents.sample.labels.json');
const labelsPath = isAbsolute(arg('--labels', defaultLabels))
  ? arg('--labels', defaultLabels)
  : join(process.cwd(), arg('--labels', defaultLabels));

const url =
  arg('--url', process.env.MUE_BENCHMARK_URL?.trim() || '') || 'http://127.0.0.1:4111/find-mues';

const timeoutMs = Math.max(60_000, parseInt(arg('--timeout-ms', '600000'), 10) || 600_000);

const logsDir = (() => {
  const env = process.env.MASTRA_LOG_DIR?.trim();
  if (env) return isAbsolute(env) ? env : join(process.cwd(), env);
  const a = join(PKG_ROOT, '..', 'logs');
  if (existsSync(a)) return a;
  return join(PKG_ROOT, 'logs');
})();

const reportDir = join(logsDir, 'benchmark-reports');
const jsonlPath = join(logsDir, 'mue-benchmark-runs.jsonl');

/** Aligns with your Part 1 checklist; order matters for the report narrative. */
const BENCHMARK_CASES = [
  {
    id: 'checklist-roof-fall-ug-coal',
    name: 'Checklist: roof fall + Underground Coal',
    keyword: 'roof fall',
    mineType: 'underground coal',
    expectations: {
      /**
       * Sample’s only fatality (220120860055) is electrical/shuttle — not a roof-fall event and does not
       * match the "roof fall" token query. Correct behavior: do not cite it as support for this scenario.
       */
      unrelatedFatalityDocMustNotBeCited: '220120860055',
      notes:
        'The sample’s single fatality (220120860055) is shuttle/electrical, not roof fall. Pass = no citation of that doc for this query; retrieval should focus on roof/rock-fall rows.',
    },
  },
  {
    id: 'checklist-slip-volume',
    name: 'Checklist: slip cluster (serious-nonfatal volume)',
    keyword: 'slip',
    mineType: '',
    expectations: {
      expectZeroAgentFatalities: true,
      notes: 'Expect no fabricated fatalities; many serious-nonfatal sprain/strain patterns in sample.',
    },
  },
  {
    id: 'anchor-known-fatal-narrative',
    name: 'Anchor: keyword aligned with fatal row narrative (shuttle / electrical)',
    keyword: 'shuttle car',
    mineType: 'underground coal',
    expectations: {
      knownFatalDocInSample: '220120860055',
      notes: 'Designed to surface DOCUMENT_NO 220120860055 in retrieval for the 120-line sample.',
    },
  },
  {
    id: 'anchor-roof-bolting-ug-coal',
    name: 'Anchor: roof bolting + UG coal (see Accidents.sample.anchor-cases.json)',
    keyword: 'roof bolting',
    mineType: 'underground coal',
    expectations: {
      anchorDocumentMustBeCited: '220042050022',
      notes:
        'DOCUMENT_NO 220042050022 — prevalent roof-bolting / draw-rock theme in the sample’s UG cluster; expect at least one citation in supportingDocumentNos.',
    },
  },
];

function fileSafeIso(ts) {
  return ts.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function scoreOutput(output, byDocumentNo) {
  const mues = output?.candidateMues ?? [];
  let totalCited = 0;
  let totalValid = 0;
  const allCited = new Set();
  const invalidIds = [];

  const rawCitedSet = new Set();
  for (const m of mues) {
    const ids = m.supportingDocumentNos ?? [];
    for (const id of ids) {
      rawCitedSet.add(id);
      totalCited++;
      if (byDocumentNo[id]) {
        totalValid++;
        allCited.add(id);
      } else {
        invalidIds.push(id);
      }
    }
  }

  const groundingScore = totalCited === 0 ? null : totalValid / totalCited;
  const metricA_allCitationsInManifest = totalCited > 0 && invalidIds.length === 0;

  const injuryBlob = mues
    .map((m) => [...(m.commonInjuryTypes ?? []), m.narrativeSummary ?? ''].join(' '))
    .join(' ')
    .toLowerCase();
  const metricC_injuryLanguage =
    /\b(sprain|strain|fracture|lacerat|contusion|bruise)\b/.test(injuryBlob) ||
    injuryBlob.includes('back') ||
    injuryBlob.includes('finger');

  const gr = output?.groundingReport;
  const perMueGrounding = (gr?.perMue ?? []).map((p) => ({
    title: p.title,
    invalidSupportingIds: p.invalidSupportingIds ?? [],
    fatalityCountDelta: p.fatalityCountDelta,
    modelFatalityCount: p.modelFatalityCount,
    fatalitiesInCitedRecords: p.fatalitiesInCitedRecords,
  }));

  return {
    /** IDs that appear in supportingDocumentNos (including invalid / not-in-manifest). */
    allSupportingDocumentNos: [...rawCitedSet],
    /** Subset of supporting IDs that exist in the label manifest. */
    citedDocumentNos: [...allCited],
    metricA: {
      groundingScore,
      totalSupportingCitations: totalCited,
      validInManifest: totalValid,
      invalidDocumentNos: invalidIds,
      passAllCitationsInManifest: metricA_allCitationsInManifest,
    },
    metricB: {
      retrievalSampleFatalityCount: null,
      groundingOverallQuality: gr?.overallCitationQuality ?? null,
      supportingCitationRate: gr?.supportingCitationRate ?? null,
      perMue: perMueGrounding,
    },
    metricC: {
      injuryRelatedLanguagePresent: metricC_injuryLanguage,
    },
    candidateMueTitles: mues.map((m) => m.title),
    materialityFlags: mues.map((m) => ({ title: m.title, flag: m.materialityFlag, fatalityCount: m.fatalityCount })),
  };
}

function applyCaseExpectations(scores, testCase) {
  const exp = testCase.expectations ?? {};
  const checks = [];

  const noCites = scores.metricA.totalSupportingCitations === 0;
  checks.push({
    id: 'metric-a-manifest',
    /** null = inconclusive (no citations to verify) */
    pass: noCites ? null : scores.metricA.passAllCitationsInManifest,
    detail: noCites
      ? 'No supporting DOCUMENT_NOs cited — cannot test hallucination (inconclusive).'
      : scores.metricA.passAllCitationsInManifest
        ? 'All cited IDs exist in labels manifest.'
        : `Invalid / not-in-manifest IDs: ${scores.metricA.invalidDocumentNos.slice(0, 8).join(', ')}${scores.metricA.invalidDocumentNos.length > 8 ? '…' : ''}`,
  });

  function pushMustCiteDocumentNo(doc, checkId) {
    if (!doc) return;
    const cited = new Set(scores.allSupportingDocumentNos ?? scores.citedDocumentNos ?? []);
    const got = cited.has(doc);
    checks.push({
      id: checkId,
      pass: got,
      detail: got ? `Cited ${doc} at least once.` : `Did not cite ${doc} in any supportingDocumentNos.`,
    });
  }
  pushMustCiteDocumentNo(exp.knownFatalDocInSample, 'metric-b-known-fatal-doc-cited');
  pushMustCiteDocumentNo(exp.anchorDocumentMustBeCited, 'metric-b-anchor-doc-cited');

  if (exp.unrelatedFatalityDocMustNotBeCited) {
    const id = exp.unrelatedFatalityDocMustNotBeCited;
    const cited = new Set(scores.allSupportingDocumentNos ?? scores.citedDocumentNos ?? []);
    const wronglyCited = cited.has(id);
    checks.push({
      id: 'metric-b-unrelated-fatality-not-cited',
      pass: !wronglyCited,
      detail: wronglyCited
        ? `Incorrectly cited unrelated fatality ${id} (wrong scenario for this query).`
        : `Did not cite unrelated fatality ${id} — correct scope for this keyword.`,
    });
  }

  if (exp.expectZeroAgentFatalities) {
    const sumFatal = (testCase._output?.candidateMues ?? []).reduce((n, m) => n + (m.fatalityCount ?? 0), 0);
    checks.push({
      id: 'metric-b-sum-agent-fatality-counts',
      pass: sumFatal === 0,
      detail: `Sum of candidateMues[].fatalityCount = ${sumFatal} (expect 0 for this case).`,
    });
  }

  checks.push({
    id: 'metric-c-injury-language',
    pass: scores.metricC.injuryRelatedLanguagePresent,
    detail: scores.metricC.injuryRelatedLanguagePresent
      ? 'Output mentions injury-related terms (sprain/fracture/etc. or similar).'
      : 'Little or no injury vocabulary detected in commonInjuryTypes/narrativeSummary.',
  });

  const definite = checks.filter((c) => c.pass !== null);
  const passCount = definite.filter((c) => c.pass === true).length;
  return {
    checks,
    overallPass: definite.length > 0 && definite.every((c) => c.pass === true),
    passCount,
    checkCount: definite.length,
    inconclusiveCount: checks.filter((c) => c.pass === null).length,
  };
}

async function runCase(testCase, byDocumentNo) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: testCase.keyword, mineType: testCase.mineType }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _parseError: true, raw: text.slice(0, 2000) };
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        error: json?.error ?? text.slice(0, 500),
        output: null,
      };
    }
    if (json?.error) {
      return { ok: false, httpStatus: res.status, error: json.error, output: null };
    }
    testCase._output = json;
    const scores = scoreOutput(json, byDocumentNo);
    const verdict = applyCaseExpectations(scores, testCase);
    return { ok: true, httpStatus: res.status, output: json, scores, verdict };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, httpStatus: null, error: msg, output: null };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  let labels;
  try {
    labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
  } catch (e) {
    console.error(`Missing or invalid labels: ${labelsPath}\nRun: npm run extract:msha-sample`);
    process.exit(1);
  }
  const byDocumentNo = labels.byDocumentNo ?? {};

  console.log(`Benchmark URL: ${url}`);
  console.log(`Labels: ${labelsPath}`);
  console.log(`Cases: ${BENCHMARK_CASES.length}\n`);

  const ts = new Date().toISOString();
  const results = [];

  for (const c of BENCHMARK_CASES) {
    process.stdout.write(`→ ${c.id} … `);
    const r = await runCase(c, byDocumentNo);
    if (r.ok) {
      const v = r.verdict;
      const label =
        v.inconclusiveCount > 0 && !v.overallPass
          ? 'DONE (some failures; inconclusive checks)'
          : v.inconclusiveCount > 0
            ? 'PASS* (inconclusive checks skipped)'
            : v.overallPass
              ? 'PASS'
              : 'DONE (failures)';
      console.log(label);
    } else {
      console.log(`FAIL: ${r.error ?? r.httpStatus}`);
    }
    results.push({
      caseId: c.id,
      caseName: c.name,
      keyword: c.keyword,
      mineType: c.mineType,
      expectations: c.expectations,
      httpStatus: r.httpStatus,
      ok: r.ok,
      error: r.error ?? null,
      scores: r.scores ?? null,
      verdict: r.verdict ?? null,
      /** Full /find-mues JSON (for manual verification of supportingDocumentNos, materiality, etc.) */
      apiResult: r.ok ? r.output : null,
      groundingReportSummary: r.output?.groundingReport
        ? {
            overallCitationQuality: r.output.groundingReport.overallCitationQuality,
            supportingCitationRate: r.output.groundingReport.supportingCitationRate,
            warnings: r.output.groundingReport.warnings,
            retrievalSampleSize: r.output.groundingReport.retrievalSampleSize,
            totalMatchedInQuery: r.output.groundingReport.totalMatchedInQuery,
          }
        : null,
    });
  }

  const bundle = {
    kind: 'mue-benchmark-run',
    ts,
    url,
    labelsFile: labelsPath,
    manifestSamplePath: labels.sampleOutPath ?? null,
    cases: results,
  };

  mkdirSync(reportDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const stamp = fileSafeIso(ts);
  const jsonPath = join(reportDir, `benchmark-${stamp}.json`);
  const mdPath = join(reportDir, `benchmark-${stamp}.md`);

  writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  const mdLines = [
    `# MUE benchmark run`,
    ``,
    `- **Time:** ${ts}`,
    `- **Endpoint:** \`${url}\``,
    `- **Labels:** \`${labelsPath}\``,
    ``,
    `## Summary`,
    ``,
    ...results.map((r) => {
      const v = r.verdict;
      const icon = !r.ok ? '❌' : v?.overallPass ? '✅' : '⚠️';
      return `- ${icon} **${r.caseId}** — \`${r.keyword}\` / \`${r.mineType || '(none)'}\`${!r.ok ? ` — _${r.error}_` : v ? ` — definite checks ${v.passCount}/${v.checkCount}${v.inconclusiveCount ? `, inconclusive ${v.inconclusiveCount}` : ''}` : ''}`;
    }),
    ``,
  ];

  for (const r of results) {
    mdLines.push(`## ${r.caseId}`, ``);
    mdLines.push(`**Keyword:** ${r.keyword}  `);
    mdLines.push(`**Mine type:** ${r.mineType || '(empty)'}  `);
    if (r.expectations?.notes) mdLines.push(`**Note:** ${r.expectations.notes}  `);
    mdLines.push(``);
    if (!r.ok) {
      mdLines.push(`**Error:** ${r.error}`, ``);
      continue;
    }
    if (r.verdict?.checks) {
      mdLines.push(`| Check | Pass | Detail |`, `| --- | --- | --- |`);
      for (const ch of r.verdict.checks) {
        mdLines.push(
          `| ${ch.id} | ${ch.pass === null ? 'n/a' : ch.pass ? 'yes' : 'no'} | ${ch.detail.replace(/\|/g, '/')} |`,
        );
      }
      mdLines.push(``);
    }
    if (r.scores) {
      mdLines.push(`**Metric A — groundingScore:** ${r.scores.metricA.groundingScore ?? 'n/a (no citations)'}  `);
      mdLines.push(
        `**Cited DOCUMENT_NOs (unique):** ${r.scores.citedDocumentNos?.length ?? 0} (see JSON for list)  `,
      );
      mdLines.push(`**Metric C — injury language:** ${r.scores.metricC.injuryRelatedLanguagePresent ? 'yes' : 'no'}  `);
      mdLines.push(`**MUE titles:** ${r.scores.candidateMueTitles.join('; ') || '(none)'}  `);
      mdLines.push(``);
    }
    if (r.groundingReportSummary?.warnings?.length) {
      mdLines.push(`**Grounding warnings:**`, ...r.groundingReportSummary.warnings.map((w) => `- ${w}`), ``);
    }
  }

  mdLines.push(`---`, `Full JSON: \`${jsonPath}\``);
  writeFileSync(mdPath, mdLines.join('\n'), 'utf8');

  const slimForJsonl = {
    ...bundle,
    cases: bundle.cases.map(({ apiResult, ...rest }) => rest),
  };
  appendFileSync(jsonlPath, `${JSON.stringify(slimForJsonl)}\n`, 'utf8');

  console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}\n  ${jsonlPath} (append, no full api payloads)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
