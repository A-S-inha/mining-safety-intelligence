import { useState } from "react";
import { findControls, findMues, findMuesAgentic } from "./api";
import "./App.css";
import ControlGapTab from "./components/ControlGapTab";
import MUEFinderTab from "./components/MUEFinderTab";
import type { ControlsResponse, FindMuesPayload, MUEItem } from "./types";

const USE_AGENTIC_MUE_FLOW = true;

export default function App() {
  const [activeTab, setActiveTab] = useState<"mue" | "controls">("mue");

  const [mueForm, setMueForm] = useState<FindMuesPayload>({
    mineType: "",
    keyword: "",
  });
  const [mueLoading, setMueLoading] = useState(false);
  const [mueError, setMueError] = useState("");
  const [mueInfo, setMueInfo] = useState("");
  const [mueResults, setMueResults] = useState<MUEItem[]>([]);

  const [mueName, setMueName] = useState("");
  const [controlsLoading, setControlsLoading] = useState(false);
  const [controlsError, setControlsError] = useState("");
  const [controls, setControls] = useState<ControlsResponse | null>(null);

  const handleFindMues = async () => {
    setMueError("");
    setMueInfo("");
    setMueLoading(true);

    try {
      const result = USE_AGENTIC_MUE_FLOW
        ? await findMuesAgentic(mueForm)
        : await findMues(mueForm);

      const { mues, noMatchingRecords, message } = result;

      setMueResults(mues);
      setMueInfo(noMatchingRecords && message ? message : "");

      if ("interpretation" in result && result.interpretation) {
        console.log("[agentic interpretation]", result.interpretation);
      }
    } catch (error) {
      setMueResults([]);
      setMueInfo("");
      setMueError(
        error instanceof Error
          ? error.message
          : "Something went wrong while finding candidate MUEs."
      );
    } finally {
      setMueLoading(false);
    }
  };

  const handleFindControls = async () => {
    setControlsError("");
    setControlsLoading(true);

    try {
      const result = await findControls(mueName);
      setControls(result);
    } catch (error) {
      setControls(null);
      setControlsError(
        error instanceof Error
          ? error.message
          : "Something went wrong while finding controls."
      );
    } finally {
      setControlsLoading(false);
    }
  };

  const handleUseForControls = (selectedMueName: string) => {
    setMueName(selectedMueName);
    setActiveTab("controls");
  };

  return (
    <div
      className="msi-app"
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #e2e8f0 0%, #f1f5f9 40%, #f8fafc 100%)",
        padding: "32px 16px",
      }}
    >
      <div className="msi-shell">
        <div className="msi-hero">
          <h1>Mining Safety Intelligence Tool</h1>
          <p className="msi-hero-desc">
            React frontend for MUE identification and control gap identification.
          </p>
        </div>

        <div className="msi-tabs">
          <button
            type="button"
            onClick={() => setActiveTab("mue")}
            className={activeTab === "mue" ? "msi-tab msi-tab--active" : "msi-tab"}
          >
            MUE Finder
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("controls")}
            className={activeTab === "controls" ? "msi-tab msi-tab--active" : "msi-tab"}
          >
            Control Gap Finder
          </button>
        </div>

        {activeTab === "mue" ? (
          <MUEFinderTab
            form={mueForm}
            setForm={setMueForm}
            loading={mueLoading}
            error={mueError}
            info={mueInfo}
            results={mueResults}
            onSubmit={handleFindMues}
            onUseForControls={handleUseForControls}
          />
        ) : (
          <ControlGapTab
            mueName={mueName}
            setMueName={setMueName}
            loading={controlsLoading}
            error={controlsError}
            controls={controls}
            onSubmit={handleFindControls}
          />
        )}
      </div>
    </div>
  );
}