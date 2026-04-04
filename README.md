# Mining Safety Intelligence

Prototype system for mining safety workflows: **Material Unwanted Event (MUE) discovery** over MSHA-style accident records, implemented with [Mastra](https://mastra.ai/) agents (structured generation), deterministic retrieval, and a **React + Vite** client.

## Repository layout

| Path | Role |
|------|------|
| `backend/` | Express API, Mastra agents, MSHA ingest, retrieval evaluation |
| `frontend/` | Web UI (MUE Finder; Control Gap tab has no live backend integration) |

## Prerequisites

- **Node.js** ≥ 22.13 (`backend/package.json` `engines`)
- Local copy of the MSHA accident extract (see Data)

## Data (`Accidents.txt`)

The full MSHA accident extract is large (on the order of **~226MB** in typical downloads) and is **gitignored**. Expected path:

`backend/data/Accidents.txt`

Obtain the file from [MSHA Open Data](https://www.msha.gov/data-research/open-data) or another approved source. If the file is missing, the indexer returns no rows.

## Environment variables

Create `backend/.env` and do not commit secrets. Default agent configurations use **NVIDIA NIM**-style model ids; set:

- **`NVIDIA_API_KEY`** — required for `nvidia/meta/llama-3.3-70b-instruct` on the MUE and query-understanding agents.

To use **Anthropic Claude**, change the `model` fields in `backend/src/mastra/agents/mueAgent.ts` and `queryUnderstandingAgent.ts` and set:

- **`ANTHROPIC_API_KEY`**

Optional:

- **`MASTRA_CLOUD_ACCESS_TOKEN`** — when Mastra Cloud observability is enabled in `backend/src/mastra/index.ts`
- **`DISABLE_MASTRA_OBSERVABILITY=true`** — disables Mastra observability locally

`backend/.env.example` is minimal; align variables with the providers you enable.

## Run the app

**1. Backend API** (`backend/`):

```shell
cd backend
npm install
npm run dev:api
```

Listens on **http://localhost:4000** with CORS for **http://localhost:5173**.

**2. Frontend** (`frontend/`):

```shell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The client uses **http://localhost:4000** (`frontend/src/api.ts`).

### API routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness |
| `POST` | `/find-mues` | Retrieval, then **mue-agent** with structured output |
| `POST` | `/find-mues-agentic` | Query interpretation, retrieval, then **mue-agent** (default in the UI) |

Request body (both POST routes): `{ "mineType": string, "keyword": string }` — at least one field must be non-empty after trimming.

Responses include **`meta.recordsSentToModel`** and related fields so clients can audit how many records were passed to the model.

## Observed runtime behavior

The following matches the implementation in this repository:

1. **Single load and index per process** — On first access, `Accidents.txt` is read, parsed, and indexed with **MiniSearch**. Structures are held in module-level caches for the lifetime of the Node process (`mshaDataTool.ts`).
2. **Large candidate sets before truncation** — Search returns a ranked list whose length depends on the query and the rows present in the local file. In the **committed evaluation artifacts**, matched row counts for sample queries fall roughly in the **300–1,200** range on extracts of roughly **1–2k** total rows; different files will yield different numbers.
3. **Fixed cap on records sent to the LLM** — After summarization, **`summarized.slice(0, 15)`** is applied before calling the MUE agent (`findMuesAgenticService.ts`; the same limit appears in `findMuesService.ts`).
4. **Upper bound of three MUE candidates** — Instructions and the response schema cap the list at **three** items (`mueAgent.ts`, `findMuesResponseSchema`).

The model therefore sees at most **15** structured records per request, not the full retrieved set.

## Mitigations for outputs inconsistent with evidence

These mechanisms **reduce** the chance of counts or text that violate stated evidence; they do **not** formally verify semantic correctness of every phrase.

- **Closed-world inputs** — The generator receives only summarized rows from the local extract, not external documents.
- **Schema validation** — **Zod** parses model output (`findMuesResponseSchema`).
- **Post-generation arithmetic checks** — `groundedValidateMues` requires **`incidentCount` ≤ number of evidence rows**, **`fatalityCount` ≤ sum of derived fatality flags** over those rows, and **summary length ≥ 20** after trim.  
  - **Baseline** (`findMuesService.ts`): returns a non-null **`validationError`** string when a rule fails.  
  - **Agentic** (`findMuesAgenticService.ts`): the same logic **throws** inside a **try** block; the catch stores the message in **`validationError`** and still returns the parsed model object for inspection.

The methodology section uses **grounded** in the operational sense: tied to supplied rows and to the checks above, not as a formal proof of absence of model error.

## Data preparation (MSHA row → agent record)

The tabular extract does not expose every field the agents consume in final form. `mshaDataTool.ts` **derives**:

- **`mineType`** — From **SUBUNIT**, **UG_LOCATION**, and **COAL_METAL_IND** (this file has no separate `MINE_TYPE` column).
- **`fatalities`** — **0 or 1**, from **DEGREE_INJURY** using rule-based mapping.
- **Injury seriousness** — Used in filters and scoring via normalized **DEGREE_INJURY** handling (exact label sets and substring patterns).

Derived values feed both search text and the payload sent to the language model.

## Logging: retrieval and model-input stages

Structured **console** logs support replication and debugging:

| Concern | Baseline (`runMuePreparation`) | Agentic (`findMuesAgenticService`) |
|--------|--------------------------------|-------------------------------------|
| Scale of data and matches | `totalDatasetSize`, `matchedRows`, `summarizedRows` | `retrievedRows`, `summarizedRows` |
| Rows passed to the model | (implicit via preparation) | `recordsSentToModel`, row identifiers, prompt size, narrative statistics |
| Log prefixes | `[find-mues] preparation` | `[agentic] retrieval funnel`, `records sent to model`, `final output` |

JSON **`meta`** echoes selected quantities to HTTP clients.

## Output constraints (language model)

- At most **three** MUE objects per response.
- System text asks for use of **only** the listed records and consistency of counts with that list (`mueAgent.ts`).
- The MUE JSON schema is not used for OSHA control recommendations; scope here is **candidate identification** from evidence.
- **Zod** validates structured outputs and relevant intermediate shapes.

## Mastra Studio (optional)

From `backend/`:

```shell
npm run dev
```

Opens [Mastra Studio](https://mastra.ai/docs/studio/overview) (default **http://localhost:4111**) for local agent experimentation outside Express.

## Retrieval evaluation

From `backend/`:

```shell
npm run eval:retrieval
```

Writes artifacts under `backend/evaluation/results/`; case definitions live in `backend/evaluation/cases/`. Scoring rules and pass criteria are summarized under [Methodology and Evaluation Strategy](#methodology-and-evaluation-strategy).

## Committed retrieval-suite summary

`npm run eval:retrieval` runs three cases from `mue_eval_cases.json`. The **snapshot checked into this repository** reports:

```json
{
  "totalCases": 3,
  "passedCases": 1,
  "failedCases": 2
}
```

**Source:** `backend/evaluation/results/summary.json`. Re-running the script after code or data changes will change these counts; they should be cited as **time-stamped** or **commit-specific** results.

**Outcome in that snapshot:** `belt-broad-01` **passed**. `conveyor-medium-01` and `lime-narrow-01` **failed** under the suite’s **grounding** criterion (see below), while **evidence volume** and **term coverage** often met their thresholds in the same runs.

### Documented failure: `lime-narrow-01`

With `keyword: "lime"`, the run retained **15** evidence rows and matched several expected terms (e.g. lime, burn, eye). One candidate label was **“Equipment-Related Injuries.”** Under the evaluator’s rule (name tokens with length **> 3** must appear as substrings in at least one narrative), **no** narrative contained a matching token for that name, so the candidate is marked **not grounded**. Details: `backend/evaluation/results/lime-narrow-01.retrieval.json`, path `evaluation.grounding.candidateChecks`.

### Documented failure: `conveyor-medium-01`

Expected evidence terms achieved **hit rate 1.0** in that artifact. Grounding still failed for names such as **“Falling Objects”** and **“Slips, Trips, and Falls”** because the **literal substring** test did not match those tokens in the narratives. That outcome is consistent with (a) the **string-matching** definition of grounding in code, and (b) **generic** labels that may not repeat verbatim in short narratives even when the underlying incidents are related to conveyors.

### Interpretation (qualitative)

In these logged runs, **retrieval-side thresholds** were frequently satisfied where **name-level grounding** was not. A reasonable reading is that **labeling and aggregation** (how the model names and groups events) currently stress the pipeline more than **fetching relevant rows**, under the **stated** grounding metric. **Semantic** grounding (e.g. embeddings) is not implemented here.

A separate baseline–versus–agentic comparison is summarized in `backend/evaluation/results/comparison.summary.json` (match counts, overlap, grounding scores for `/find-mues` and `/find-mues-agentic`).

## Methodology and Evaluation Strategy

### Overview

The system proposes **Material Unwanted Events (MUEs)** from MSHA accident records through a **retrieval-then-generation** pipeline with Mastra agents.

Design goals include:

- **Evidence-bound generation** — inputs are retrieved rows, not open corpora
- **Traceability** — evidence lists accompany outputs for inspection
- **Deterministic checks** — schema validation and numeric bounds after generation
- **Repeatable tests** — fixed cases and scripted scoring

### System methodology

#### 1. Query interpretation (first agent)

**Input:**

```json
{ "mineType": "...", "keyword": "..." }
```

The **query-understanding** agent emits structured fields:

```json
{
  "normalizedMineType": "...",
  "expandedKeywords": ["..."],
  "interpretation": "..."
}
```

The intent is to **broaden lexical coverage** for search; whether unrelated terms appear is an **empirical** question and should be checked per run.

#### 2. Retrieval (non–language-model)

Retrieval uses **BM25-style** ranking via [MiniSearch](https://github.com/lucaong/minisearch) over text built from narrative, accident type, injury fields, activity, equipment, and related columns.

**Pipeline:** parse → index → query → filter/rank → `summarizeForAgent` → structured records.

Summaries include `accidentType`, `degreeInjury`, `narrative`, derived fatality flag, and derived `mineType`.

#### 3. Evidence selection

```ts
const limitedRecords = summarized.slice(0, 15);
```

These rows are passed to the MUE agent and exported as **`evidenceForEvaluation`**. **`evidenceSample`** exposes **five** rows for the UI.

#### 4. MUE generation (second agent)

The **mue-agent** returns up to **three** structured candidates, for example:

```json
[
  {
    "name": "...",
    "incidentCount": 0,
    "fatalityCount": 0,
    "commonInjuries": [],
    "severity": "...",
    "materiality": "...",
    "summary": "..."
  }
]
```

Prompts request use of **only** supplied records and consistency of counts with that set.

#### 5. Deterministic validation (post-generation)

Rules include: **`incidentCount`** not above the evidence row count; **`fatalityCount`** not above the sum of derived fatalities; **minimum summary length**. Failure handling differs by route, as described in [Mitigations for outputs inconsistent with evidence](#mitigations-for-outputs-inconsistent-with-evidence).

### Definition of scores in implementation

`backend/evaluation/mueMetrics.ts` and `backend/src/mastra/scorers/mueScorers.ts` implement:

- **Grounding (name–narrative overlap)** — Lowercase the candidate **name**, split on non-alphanumeric boundaries, keep tokens with **length > 3**, and test whether **any** token occurs as a **substring** of **any** evidence **narrative**. A candidate is **grounded** under this rule if at least one token matches. The retrieval suite requires **all** candidates to pass for the case to pass. The Mastra **mue-grounding-score** is the fraction of candidates that pass the same test.
- **Quality** — The evaluation script counts candidates with **summary** length **> 20**, **`incidentCount` > 0**, **`fatalityCount` ≥ 0**, and **`commonInjuries`** an array; the registered scorer uses a closely related rule set. The reported score is **validCount / total**.

These metrics are **explicit and reproducible**; they are **not** equivalent to human judgment of semantic adequacy.

### Evaluation strategy

The suite measures retrieval adequacy, lexical overlap with expected terms, the string-based grounding rule above, structural quality, and presence of **`validationError`**.

#### 1. Dataset

Cases: `backend/evaluation/cases/mue_eval_cases.json`.

Example shape:

```json
{
  "id": "belt-broad-01",
  "queryType": "broad",
  "input": { "keyword": "belt" },
  "expectedEvidenceTerms": ["belt", "conveyor", "roller"]
}
```

Query types include **broad**, **medium**, and **narrow**.

#### 2. Pipeline

For each case: **input** → agentic service → **outputs** and evidence → automated scoring → JSON under `backend/evaluation/results/`.

#### 3. Metrics (summary)

**A. Evidence volume** — `evidenceCount` compared to a minimum by `queryType` (broad ≥ 5, medium ≥ 4, narrow ≥ 3).

**B. Evidence terms** — `hitRate = matchedTerms / expectedTerms` (example: two of three expected terms present yields **0.67**).

**C. Grounding** — As defined in [Definition of scores in implementation](#definition-of-scores-in-implementation); per-candidate narrative substring test.

**D. Candidate quality** — Structure and non-degenerate fields (see script and metrics module).

**E. Validation** — Surface of **`validationError`** from post-generation rules.

#### 4. Pass rule

A case **passes** only if all of the above components pass in that run.

#### 5. Design emphasis

The architecture treats model output as a **summary of a fixed evidence set**, then checks **simple necessary conditions** (counts, lengths, string overlap). It does **not** remove all forms of model error.

#### 6. Limitations

- Grounding is **token substring overlap**, not semantic entailment.
- The evaluation set is **small** and **manually specified**.
- Metrics are **not** full MSHA recall or population-level statistics.
- Grouping behavior depends on the **language model** and prompt.

#### 7. Possible extensions

- Embedding-based or entailment-based grounding
- Larger, versioned evaluation sets
- Automated regression tracking and reporting dashboards
- Tighter coupling to Mastra-native eval workflows

## Learn more

- [Mastra documentation](https://mastra.ai/docs/)
- [Mastra agents](https://mastra.ai/docs/agents/overview), [evals / scorers](https://mastra.ai/docs/evals/overview)
