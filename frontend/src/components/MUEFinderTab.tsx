import type { Dispatch, SetStateAction } from "react";
import MUECard from "./MUECard";
import type { FindMuesPayload, MUEItem, MueSubmitFlow } from "../types";

type Props = {
  form: FindMuesPayload;
  setForm: Dispatch<SetStateAction<FindMuesPayload>>;
  loading: boolean;
  error: string;
  /** Shown when the search succeeded but no MSHA rows matched (backend skips the LLM). */
  info: string;
  results: MUEItem[];
  flow: MueSubmitFlow;
  onFlowChange: (flow: MueSubmitFlow) => void;
  onSubmit: () => void;
  onUseForControls: (mueName: string) => void;
};

export default function MUEFinderTab({
  form,
  setForm,
  loading,
  error,
  info,
  results,
  flow,
  onFlowChange,
  onSubmit,
  onUseForControls,
}: Props) {
  return (
    <div className="msi-grid">
      <div className="msi-card">
        <h2 className="msi-section-title">MUE Finder</h2>
        <p className="msi-subtitle">Enter a mine type, a hazard keyword, or both.</p>

        <div className="msi-flow-field">
          <span className="msi-flow-label" id="mue-flow-label">
            Backend flow
          </span>
          <div
            className="msi-segmented"
            role="group"
            aria-labelledby="mue-flow-label"
          >
            <button
              type="button"
              className={
                flow === "agentic"
                  ? "msi-segment msi-segment--active"
                  : "msi-segment"
              }
              onClick={() => onFlowChange("agentic")}
              disabled={loading}
            >
              Orchestrated retrieval
            </button>
            <button
              type="button"
              className={
                flow === "toolAgent"
                  ? "msi-segment msi-segment--active"
                  : "msi-segment"
              }
              onClick={() => onFlowChange("toolAgent")}
              disabled={loading}
            >
              MUE tool agent
            </button>
          </div>
          <p className="msi-flow-hint">
            Orchestrated: server retrieves records, then calls the MUE agent. Tool agent: the model
            calls <code>mshaSearch</code> before proposing MUEs.
          </p>
        </div>

        <div className="msi-field-stack">
          <input
            type="text"
            className="msi-input"
            placeholder="Mine Type, for example underground coal"
            value={form.mineType}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                mineType: e.target.value,
              }))
            }
          />

          <input
            type="text"
            className="msi-input"
            placeholder="Hazard Keyword, for example conveyor"
            value={form.keyword}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                keyword: e.target.value,
              }))
            }
          />

          <button type="button" className="msi-btn-primary" onClick={onSubmit} disabled={loading}>
            {loading ? "Loading..." : "Submit"}
          </button>
        </div>

        {error && <div className="msi-error">{error}</div>}
      </div>

      <div className="msi-results-block">
        <h3 className="msi-results-heading">Candidate MUE Results</h3>

        {info && !loading && <div className="msi-notice">{info}</div>}

        {!loading && results.length === 0 && !error && !info && (
          <div className="msi-placeholder">Submit inputs to view candidate MUE cards here.</div>
        )}

        <div className="msi-card-list">
          {results.map((item) => (
            <MUECard key={item.id} item={item} onUseForControls={onUseForControls} />
          ))}
        </div>
      </div>
    </div>
  );
}
