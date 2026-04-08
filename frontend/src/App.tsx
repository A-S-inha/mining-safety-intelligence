import { useState } from 'react';
import { findControls, findMues, type MueFinderResponse } from './api';

type Tab = 'mue' | 'controls';

export default function App() {
  const [tab, setTab] = useState<Tab>('mue');

  const [keyword, setKeyword] = useState('');
  const [mineType, setMineType] = useState('');
  const [mueLoading, setMueLoading] = useState(false);
  const [mueError, setMueError] = useState<string | null>(null);
  const [mueResult, setMueResult] = useState<MueFinderResponse | null>(null);

  const [mueName, setMueName] = useState('');
  const [ctrlLoading, setCtrlLoading] = useState(false);
  const [ctrlError, setCtrlError] = useState<string | null>(null);
  const [ctrlMessage, setCtrlMessage] = useState<string | null>(null);

  async function onMueSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMueError(null);
    setMueResult(null);
    setMueLoading(true);
    try {
      const data = await findMues(keyword, mineType);
      setMueResult(data);
    } catch (err) {
      setMueError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setMueLoading(false);
    }
  }

  async function onControlsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCtrlError(null);
    setCtrlMessage(null);
    setCtrlLoading(true);
    try {
      await findControls(mueName);
      setCtrlMessage('Unexpected success — endpoint is still a stub.');
    } catch (err) {
      setCtrlError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCtrlLoading(false);
    }
  }

  function useMueForControls(title: string) {
    setMueName(title);
    setTab('controls');
  }

  return (
    <>
      <h1>Mining Safety Intelligence Tool</h1>
      

      <div className="tabs">
        <button type="button" className={tab === 'mue' ? 'active' : ''} onClick={() => setTab('mue')}>
          MUE Finder
        </button>
        <button type="button" className={tab === 'controls' ? 'active' : ''} onClick={() => setTab('controls')}>
          Control Gap Finder
        </button>
      </div>

      {tab === 'mue' && (
        <div className="panel">
          <form onSubmit={onMueSubmit}>
            <div className="row two">
              <div>
                <label htmlFor="keyword">Hazard / keyword</label>
                <input
                  id="keyword"
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. conveyor, diesel, electrical"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="mineType">Mine type (optional)</label>
                <input
                  id="mineType"
                  type="text"
                  value={mineType}
                  onChange={(e) => setMineType(e.target.value)}
                  placeholder="e.g. underground coal"
                  autoComplete="off"
                />
              </div>
            </div>
            <button type="submit" className="primary" disabled={mueLoading || !keyword.trim()}>
              {mueLoading ? 'Searching…' : 'Submit'}
            </button>
          </form>

          {mueError && <div className="error">{mueError}</div>}

          {mueResult && (
            <>
              <p className="muted" style={{ marginTop: '1rem' }}>
                {mueResult.querySummary}
              </p>
              <p className="muted">{mueResult.dataNotes}</p>

              <div className="grounding">
                <h4>Grounding &amp; accuracy checks</h4>
                <div>
                  Citation quality: <strong>{mueResult.groundingReport.overallCitationQuality}</strong> — supporting
                  IDs in sample: {(mueResult.groundingReport.supportingCitationRate * 100).toFixed(0)}% · retrieval{' '}
                  {mueResult.groundingReport.retrievalSampleSize} rows
                  {mueResult.groundingReport.truncated ? ' (truncated)' : ''} / {mueResult.groundingReport.totalMatchedInQuery}{' '}
                  matched
                </div>
                {mueResult.groundingReport.warnings.length > 0 && (
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                    {mueResult.groundingReport.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="cards">
                {mueResult.candidateMues.map((m) => (
                  <article key={m.rank} className="card">
                    <div className="card-head">
                      <h3 className="card-title">
                        #{m.rank} · {m.title}
                      </h3>
                      <span className={`badge ${m.materialityFlag}`}>{m.materialityFlag} materiality</span>
                    </div>
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.9rem' }}>{m.description}</p>
                    <p className="stats">
                      Incidents (model): {m.incidentCount} · Fatalities (model): {m.fatalityCount} · Injury themes:{' '}
                      {m.commonInjuryTypes.slice(0, 4).join(', ')}
                      {m.commonInjuryTypes.length > 4 ? '…' : ''}
                    </p>
                    <details className="narrative">
                      <summary>Narrative summary</summary>
                      <p style={{ marginTop: '0.5rem' }}>{m.narrativeSummary}</p>
                    </details>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                      DOCUMENT_NO: {m.supportingDocumentNos.slice(0, 8).join(', ')}
                      {m.supportingDocumentNos.length > 8 ? '…' : ''}
                    </p>
                    <button
                      type="button"
                      className="primary"
                      style={{ marginTop: '0.65rem', fontSize: '0.85rem' }}
                      onClick={() => useMueForControls(m.title)}
                    >
                      Use in Control Gap Finder
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'controls' && (
        <div className="panel">
          <p className="muted">
            Step 3 will call a Mastra workflow against OSHA data (not built yet). The button below hits the same Mastra
            server route as the final product.
          </p>
          <form onSubmit={onControlsSubmit}>
            <div className="row">
              <div>
                <label htmlFor="mueName">MUE name</label>
                <input
                  id="mueName"
                  type="text"
                  value={mueName}
                  onChange={(e) => setMueName(e.target.value)}
                  placeholder="Select from MUE Finder or type an MUE"
                  autoComplete="off"
                />
              </div>
            </div>
            <button type="submit" className="primary" disabled={ctrlLoading || !mueName.trim()}>
              {ctrlLoading ? 'Working…' : 'Submit'}
            </button>
          </form>
          {ctrlError && <div className="error">{ctrlError}</div>}
          {ctrlMessage && <div className="error" style={{ background: '#ecfdf5', color: '#166534' }}>{ctrlMessage}</div>}
        </div>
      )}
    </>
  );
}
