import { useState } from "react";
import type { MUEItem, Severity } from "../types";

type Props = {
  item: MUEItem;
  onUseForControls: (mueName: string) => void;
};

function getSeverityStyles(severity: Severity) {
  switch (severity) {
    case "Critical":
      return { backgroundColor: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" };
    case "High":
      return { backgroundColor: "#ffedd5", color: "#9a3412", border: "1px solid #fed7aa" };
    case "Medium":
      return { backgroundColor: "#fef3c7", color: "#b45309", border: "1px solid #fde68a" };
    default:
      return { backgroundColor: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0" };
  }
}

function getMaterialityStyles(materiality: MUEItem["materiality"]) {
  if (materiality === "Material") {
    return { backgroundColor: "#d1fae5", color: "#065f46", border: "1px solid #a7f3d0" };
  }

  return { backgroundColor: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" };
}

export default function MUECard({ item, onUseForControls }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="msi-mue-card">
      <div className="msi-mue-head">
        <div>
          <h3>{item.name}</h3>

          <div className="msi-badge-row">
            <span
              style={{
                ...getSeverityStyles(item.severity),
                padding: "6px 12px",
                borderRadius: "999px",
                fontSize: "12px",
                fontWeight: 700,
              }}
            >
              {item.severity} Severity
            </span>

            <span
              style={{
                ...getMaterialityStyles(item.materiality),
                padding: "6px 12px",
                borderRadius: "999px",
                fontSize: "12px",
                fontWeight: 700,
              }}
            >
              {item.materiality}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="msi-btn-secondary"
          onClick={() => onUseForControls(item.name)}
        >
          Use in Control Gap Finder
        </button>
      </div>

      <div className="msi-stat-grid">
        <div className="msi-stat">
          <div className="msi-stat-label">Incident Count</div>
          <div className="msi-stat-value">{item.incidentCount}</div>
        </div>

        <div className="msi-stat">
          <div className="msi-stat-label">Fatality Count</div>
          <div className="msi-stat-value">{item.fatalityCount}</div>
        </div>

        <div className="msi-stat">
          <div className="msi-stat-label">Common Injuries</div>
          <div className="msi-stat-value msi-stat-value--text">{item.commonInjuries.join(", ")}</div>
        </div>
      </div>

      <div style={{ marginTop: "18px" }}>
        <button type="button" className="msi-link-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide Narrative Summary" : "Show Narrative Summary"}
        </button>

        {expanded && <p className="msi-narrative">{item.summary}</p>}
      </div>
    </div>
  );
}
