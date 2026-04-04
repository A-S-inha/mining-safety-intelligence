export type Severity = "Low" | "Medium" | "High" | "Critical";

export type MUEItem = {
  id: string;
  name: string;
  incidentCount: number;
  fatalityCount: number;
  commonInjuries: string[];
  severity: Severity;
  materiality: "Material" | "Review";
  summary: string;
};

export type FindMuesPayload = {
  mineType: string;
  keyword: string;
};

/** Which backend pipeline runs when the user submits the MUE form. */
export type MueSubmitFlow = "agentic" | "toolAgent";

export type ControlItem = {
  id: string;
  controlName: string;
  oshaStandard: string;
  frequencyScore: number;
  description: string;
};

export type ControlsResponse = {
  preventativeControls: ControlItem[];
  mitigatingControls: ControlItem[];
};
export type QueryInterpretation = {
  normalizedMineType: string;
  expandedKeywords: string[];
  interpretation: string;
};
