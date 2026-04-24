# Mining Safety Intelligence Tool

**An AI-assisted research assistant for mine safety teams.** It connects public US government data to the kind of questions asked in **critical control management** (CCM)—so teams spend less time digging through spreadsheets and more time deciding what actually matters. (ICMM publishes guidance on critical control management if you want the full framework in depth.)

---

## At a glance

**The problem:** Serious incidents in mining are rare but catastrophic. Safety programs often use a structured method (CCM) to list “things that must not happen” (*Material Unwanted Events*, or **MUEs**) and the **controls** that prevent or limit them. Two of the slowest parts of that work are: figuring out **which** unwanted events deserve top-level attention from history and industry patterns, and later, listing **which** controls should exist from standards and real-world evidence.

**What this tool does today:** It uses **retrieval from open datasets** plus **large language models (LLMs)** to turn raw records into **structured JSON** you can review in a UI—grounded in the rows retrieved, not generic safety slogans.

**Why it exists:** That discovery work is still often done by hand—exporting data, filtering, reading narratives, and workshop facilitation. This repository is a **proof of concept** that automates the heavy lifting for the **MUE discovery** side: query, filter, summarize, and rank—so workshops start from a defensible shortlist instead of a blank whiteboard.

---

## MUE Finder — what ships today

**Who it is for:** Anyone supporting an MUE identification workshop—engineers, safety leads, consultants—who needs a **starting list backed by public incident history**.

**What you do:** You enter a **hazard or equipment keyword** (e.g. `conveyor`, `diesel exhaust`) and optional **mine context** (e.g. `underground coal`).

**What happens under the hood:**

1. The backend searches **MSHA accident / injury** records (pipe-delimited public data) for serious and fatal events that match your text and context.
2. A **Mastra** workflow runs multiple stages (planning how to search, retrieving rows, synthesizing).
3. An LLM clusters and explains the results into a **ranked list of candidate MUEs** with supporting statistics and short narratives.

**What you get back:**

- Ranked **candidate MUEs** with short descriptions  
- For each: **incident counts**, **fatality counts**, common injury patterns, and a **plain-English summary**  
- A **materiality-style signal** for whether the pattern looks serious enough to treat as a top-tier MUE candidate (severe, credible scenarios)

**Why historical data matters:** CCM-style practice expects teams to review **historical incident information** from comparable operations before they finalize what counts as an MUE. This workflow automates the “review and cluster thousands of narratives” part so the team can focus on judgment, boundaries, and site-specific factors.

---

## Future scope — Control Finder

**Control Finder** (working name) is **not implemented** in this repo yet. The idea is: after you have an MUE (from the finder above or typed in), a second pipeline would query **OSHA enforcement** data, treat **violated standards** as evidence of **missing or failed controls**, and return a **bowtie-friendly** list—**preventative** vs **mitigating**—with standard citations and how often similar violations show up, plus hints on engineering vs administrative balance where the data supports it. That would mirror today’s MSHA → Mastra workflow pattern for OSHA rows and structured JSON.

Planned HTTP surface: `POST /find-controls` (currently returns `501` / placeholder). Other likely follow-ons: richer retrieval (e.g. DuckDB), optional cloud-hosted datasets, org-specific data governance, and stronger human-in-the-loop review before anything is treated as a decision record.

---

## Data sources

| Source | What it is | Role in this repo |
|--------|------------|-------------------|
| **MSHA** — accident / injury open data | Public mining accident and injury reports with narratives, classifications, severity | **In use** — retrieve and summarize patterns into candidate MUEs |
| **OSHA** — enforcement open data | Inspections, violations, standards cited, penalties | **Future** — Control Finder |

Local development typically uses **downloaded pipe-delimited files** for MSHA (see `backend/mastra-safety-tool/.env.example` for `MSHA_ACCIDENTS_FILE` and related options).

---

## What is implemented vs future scope

| Area | Status |
|------|--------|
| React UI — **MUE Finder** | **Implemented** (primary tab) |
| React UI — **Control Finder** tab | **Stub / reserved** for future API |
| `POST /find-mues` — Mastra `mueFinderWorkflow` | **Implemented** |
| `POST /find-controls` — OSHA workflow | **Not implemented** (placeholder) |
| Grounding logs, eval helpers, benchmarks (MUE path) | **Present** in `backend/mastra-safety-tool` (see package scripts) |

---

## Architecture (this monorepo)

| Part | Stack | Location |
|------|--------|----------|
| Frontend | React 19, Vite, TypeScript | `frontend/` |
| Agent / API server | Mastra (TypeScript), Node ≥ 22.13, Zod schemas, custom routes | `backend/mastra-safety-tool/` |

The frontend dev server **proxies** `/find-mues` (and the reserved `/find-controls` route) to the Mastra dev URL (default `http://localhost:4111`). See `frontend/.env.example`.

**Note on models:** The MUE workflow is configured for **NVIDIA NIM** (OpenAI-compatible API); see `backend/mastra-safety-tool/.env.example`. The design centers on **structured outputs** from schemas and prompts—you can point the same code path at another OpenAI-compatible endpoint if your environment requires it.

---

## Quick start (from scratch)

### Prerequisites

- **Node.js** ≥ 22.13  
- **NVIDIA API key** (or compatible NIM deployment) for the MUE agents  
- **MSHA accident file** on disk (full public file or a generated sample—see `.env.example`)

### 1. Backend (Mastra)

```bash
cd backend/mastra-safety-tool
cp .env.example .env
# Edit .env: set NVIDIA_API_KEY and MSHA_ACCIDENTS_FILE (or rely on defaults documented in .env.example)
npm install
npm run dev
```

Open [Mastra Studio](http://localhost:4111) to inspect agents/workflows, or call `POST http://localhost:4111/find-mues` with JSON body `{ "keyword": "conveyor", "mineType": "underground" }`.

### 2. Frontend

```bash
cd frontend
cp .env.example .env
# Optional: adjust VITE_MASTRA_PROXY_TARGET if Mastra is not on 4111
npm install
npm run dev
```

Use the **MUE Finder** tab with the Mastra server running.

### 3. Production-style run

```bash
cd backend/mastra-safety-tool
npm run build
npm run start
```

Point `VITE_API_BASE` at your deployed Mastra base URL when not using the Vite proxy.

---

## Disclaimer

This software is a **research and facilitation aid**. It does not replace qualified safety professionals, site-specific risk assessments, legal compliance work, or official interpretations of MSHA/OSHA rules. Always verify outputs against source records and your own management system.

---

## Development status

- [x] Working **MUE Finder** UI wired to live API  
- [x] Backend `POST /find-mues` returning structured JSON  
- [ ] **Control Finder** — UI stub and `POST /find-controls` placeholder only  
- [x] System prompts / schemas versioned in-repo (see `src/mastra` workflows and `schemas/`)  
- [x] README with setup (this file)  
- [ ] Short screen recording or live walkthrough — optional artifact outside the repo  

For Mastra-specific tips, see `backend/mastra-safety-tool/AGENTS.md`.
