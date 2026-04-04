# Mining Safety Intelligence

A small **full-stack prototype**: you type a **mine type** and/or **hazard keyword**, the app reads **MSHA mining accident data** from your machine, and **AI agents** return up to **three candidate Material Unwanted Events (MUEs)** — names, counts, injuries, severity, and short summaries — as **structured JSON** for the UI.

**Stack:** React (Vite) + Node.js (Express) + [Mastra](https://mastra.ai/) agents. **Not** Python/FastAPI.

---

## Quick start (run it locally)

1. **Install** [Node.js](https://nodejs.org/) **≥ 22.13**.
2. **Download** MSHA accident data and save it as **`backend/data/Accidents.txt`** (large file; see [Data file](#data-file-accidentstxt)). Without it, search returns nothing.
3. **Configure** `backend/.env` — at minimum **`NVIDIA_API_KEY`** for the default models (see [Environment variables](#environment-variables)).
4. **Start the API** (terminal 1):

```shell
cd backend
npm install
npm run dev:api
```

5. **Start the UI** (terminal 2):

```shell
cd frontend
npm install
npm run dev
```

6. Open **http://localhost:5173** → **MUE Finder** → enter mine type and/or keyword → **Submit**.

The UI can switch **backend flow** (see [API and UI](#api-and-ui)): **Orchestrated retrieval** (default) or **MUE tool agent** (`mshaSearch` tool inside the agent).

---

## In plain terms

The app searches **serious and fatal** rows in your local MSHA file, ranks matches, sends the **top 15** record summaries to an LLM, and returns up to **three** **MUE** candidates as structured JSON. The **Control Gap** tab is a UI placeholder: there is no **`/find-controls`** endpoint wired up yet.

---

## Repository layout

| Path | Purpose |
|------|---------|
| `backend/` | Express API, Mastra agents, MSHA load/search, evaluation scripts |
| `frontend/` | React app (MUE Finder + Control Gap tab without backend) |

---

## Data file (`Accidents.txt`)

- **Path:** `backend/data/Accidents.txt`
- **Size:** often **~226MB+** for a full extract; file is **gitignored**.
- **Source:** [MSHA Open Data](https://www.msha.gov/data-research/open-data) (or your course file).

**Field note:** Many briefs list **MINE_TYPE** and **FATALITIES**. This pipeline’s extract uses other columns; the code **builds** a mine-type label and a **0/1 fatality flag** from fields like **SUBUNIT**, **UG_LOCATION**, **COAL_METAL_IND**, and **DEGREE_INJURY** (`mshaDataTool.ts`).

---

## Environment variables

Create **`backend/.env`** (never commit secrets).

| Variable | When |
|----------|------|
| **`NVIDIA_API_KEY`** | **Default** — models such as `nvidia/meta/llama-3.3-70b-instruct` on MUE + query-understanding agents |
| **`ANTHROPIC_API_KEY`** | If you switch agents to **Claude** in `mueAgent.ts`, `mueToolAgent.ts`, `queryUnderstandingAgent.ts` |
| **`MASTRA_CLOUD_ACCESS_TOKEN`** | Optional — Mastra Cloud export |
| **`DISABLE_MASTRA_OBSERVABILITY=true`** | Optional — turn off Mastra observability locally |

`backend/.env.example` is a stub; match variables to the providers you actually use.

**Course spec:** assignments often name **Claude** (`claude-sonnet-4-20250514`). This repo defaults to **NVIDIA** until you change `model` and keys.

---

## API and UI

**Base URL (dev):** `http://localhost:4000` — CORS allows `http://localhost:5173`.

| Method | Path | What happens |
|--------|------|----------------|
| `GET` | `/health` | Health check |
| `POST` | `/find-mues` | Search MSHA → **mue-agent** (no separate “query understanding” step) |
| `POST` | `/find-mues-agentic` | **Query-understanding** agent → search → **mue-agent** (**default** UI flow: “Orchestrated retrieval”) |
| `POST` | `/find-mues-tool-agent` | **Query-understanding** → **mue-tool-agent** (must call **`mshaSearch`**; UI: “MUE tool agent”) |

**Body (all three POST routes):** `{ "mineType": string, "keyword": string }` — at least one non-empty after trim.

**Response:** `{ "mues": [...], "meta": { ... } }` — `meta` includes things like **`recordsSentToModel`**, **`totalRecordsAnalyzed`**, **`interpretation`** (agentic/tool flows), **`noMatchingRecords`**, **`message`**.

---

## Optional: Mastra Studio

From `backend/`:

```shell
npm run dev
```

[Mastra Studio](https://mastra.ai/docs/studio/overview) (often **http://localhost:4111**) — try agents outside Express.

---

## Optional: retrieval evaluation

From `backend/`:

```shell
npm run eval:retrieval
```

Writes results under **`backend/evaluation/results/`**; cases in **`backend/evaluation/cases/mue_eval_cases.json`**. Scoring and pass rules are in [Methodology and evaluation](#methodology-and-evaluation) below.

**Last committed summary** (`backend/evaluation/results/summary.json`): **3** cases, **1** passed, **2** failed (re-run changes numbers). Baseline vs agentic comparison: **`backend/evaluation/results/comparison.summary.json`**.

---

## Methodology and evaluation

### Goals

- **Evidence-bound** generation from retrieved rows, not the open web  
- **Traceability** — you can inspect which records fed the model  
- **Checks** — JSON schema (**Zod**) + simple numeric/text rules after generation  
- **Repeatable tests** — scripted cases and scores  

### End-to-end pipeline (technical)

1. **Query interpretation** (routes that use it) — Agent emits `normalizedMineType`, `expandedKeywords`, `interpretation` to widen search terms (`queryUnderstandingAgent`).

2. **Retrieval (no LLM)** — Load and index **`Accidents.txt`** once per process (**MiniSearch** / BM25-style). Keep only **serious or fatal** rows (`DEGREE_INJURY` rules + derived fatality). Rank by search score + severity.  
   **Pipeline:** parse → index → query → filter/rank → `summarizeForAgent`.

3. **Evidence cap** — Only **`summarized.slice(0, 15)`** go to **mue-agent** on orchestrated/baseline paths; **`mshaSearch`** uses its own **maxRecords** (default **15**). Full **`evidenceForEvaluation`** and a **5-row** **`evidenceSample`** are exposed for UI/evals.

4. **MUE generation** — **mue-agent** (or **mue-tool-agent** after tool calls) returns ≤ **3** objects: `name`, `incidentCount`, `fatalityCount`, `commonInjuries`, `severity`, `materiality`, `summary`. Prompts: use **only** provided records; no invented incidents; no control recommendations in that JSON (`mueAgent.ts` / `mueToolAgent.ts`). The model’s wording can differ from run to run on the same evidence.

5. **Post-generation validation** — `groundedValidateMues`: `incidentCount` ≤ evidence rows; `fatalityCount` ≤ sum of fatality flags in evidence; summary length ≥ **20** trimmed.  
   - **`/find-mues`:** failures → **`validationError`** on the response.  
   - **`/find-mues-agentic`:** same checks **throw** internally → caught → **`validationError`**, while parsed model output is still returned for inspection.

**“Grounded”** here means: **closed-world inputs** + **schema** + **those rules** — not a formal proof of correctness.

### Evaluation dataset

File: **`backend/evaluation/cases/mue_eval_cases.json`**. Each case has an id, `queryType` (broad / medium / narrow), `input`, and `expectedEvidenceTerms`, etc.

### Evaluation metrics

| Metric | Idea |
|--------|------|
| **Evidence volume** | Enough rows retrieved (threshold depends on `queryType`: broad ≥ 5, medium ≥ 4, narrow ≥ 3) |
| **Evidence terms** | Share of expected hazard terms appearing in evidence: `hitRate = matched / expected` |
| **Grounding** | Tokenize MUE **name** (tokens length **> 3**); each candidate must have ≥1 token as substring in some **narrative** (`mueMetrics.ts`, scorers) |
| **Quality** | Summary length, `incidentCount` > 0, structure checks (see script / scorer) |
| **Validation** | Any **`validationError`** from post-rules |

**Pass:** a case passes only if **all** of the above pass for that run.

### Example failures (committed artifacts)

- **`lime-narrow-01`:** Evidence often looked fine; candidate **“Equipment-Related Injuries”** failed **substring grounding** (no matching token in narratives). See `lime-narrow-01.retrieval.json` → `evaluation.grounding.candidateChecks`.

- **`conveyor-medium-01`:** Term hit rate **1.0**; labels like **“Falling Objects”** failed the same **literal** grounding test — common when names are **generic** vs. narrative wording.

**Takeaway:** Under this metric, **retrieval** often passes while **MUE naming** is the harder part.

### Limitations and extensions

- Grounding = **string heuristics**, not embeddings or entailment  
- Small, hand-built case set  
- No full-corpus recall statistics  
- Extensions: semantic grounding, larger eval sets, regression dashboards, Mastra-native eval wiring  

---

## Implementation reference (for developers)

**Runtime**

- First use loads **`Accidents.txt`**, builds the search index; cached in memory for the process (`mshaDataTool.ts`).
- Match counts depend on your file size and query; sample eval logs used extracts on the order of **1–2k** rows with **hundreds** of matches per query — your numbers will differ.

**Logging**

- Baseline: `[find-mues] preparation` with dataset/match/summary sizes.  
- Agentic: `[agentic] retrieval funnel`, `records sent to model`, `final output`.  
- Tool flow: `[tool-agent] ...`  

**Output limits**

- ≤ **3** MUEs; ≤ **15** evidence rows to the main synthesis path (or tool default).  
- **Zod** on agent outputs and key inputs.

---

## Learn more

- [Mastra docs](https://mastra.ai/docs/)  
- [Agents](https://mastra.ai/docs/agents/overview) · [Evals / scorers](https://mastra.ai/docs/evals/overview)
