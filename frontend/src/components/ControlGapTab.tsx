import type { ControlsResponse } from "../types";
import ControlsColumn from "./ControlsColumn";

type Props = {
  mueName: string;
  setMueName: (value: string) => void;
  loading: boolean;
  error: string;
  controls: ControlsResponse | null;
  onSubmit: () => void;
};

export default function ControlGapTab({
  mueName,
  setMueName,
  loading,
  error,
  controls,
  onSubmit,
}: Props) {
  return (
    <div className="msi-grid">
      <div className="msi-card">
        <h2 className="msi-section-title">Control Gap Finder</h2>
        <p className="msi-subtitle">
          Enter an MUE name directly, or use one selected from the MUE Finder tab.
        </p>

        <div className="msi-field-stack">
          <input
            type="text"
            className="msi-input"
            placeholder="MUE Name"
            value={mueName}
            onChange={(e) => setMueName(e.target.value)}
          />

          <button type="button" className="msi-btn-primary" onClick={onSubmit} disabled={loading}>
            {loading ? "Loading..." : "Submit"}
          </button>
        </div>

        {error && <div className="msi-error">{error}</div>}
      </div>

      <div className="msi-controls-grid">
        <ControlsColumn
          title="Preventative Controls"
          items={controls?.preventativeControls ?? []}
        />
        <ControlsColumn title="Mitigating Controls" items={controls?.mitigatingControls ?? []} />
      </div>

      {!loading && !controls && !error && (
        <div className="msi-placeholder">Submit an MUE name to view controls here.</div>
      )}
    </div>
  );
}
