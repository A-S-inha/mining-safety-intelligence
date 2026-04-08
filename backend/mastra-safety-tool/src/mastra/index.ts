import { join } from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { FileTransport } from '@mastra/loggers/file';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { ensureLogFileExists, ensureLogsDirectory } from './lib/log-paths';
import { JsonlTracingExporter } from './observability/jsonl-tracing-exporter';
import { weatherWorkflow } from './workflows/weather-workflow';
import { mueFinderWorkflow } from './workflows/mue-finder-workflow';
import { weatherAgent } from './agents/weather-agent';
import { mueQueryPlannerAgent } from './agents/mue-query-planner-agent';
import { mueResearchAgent } from './agents/mue-research-agent';
import { mueSynthesisAgent } from './agents/mue-synthesis-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { miningIntelligenceApiRoutes } from './api/mining-routes';

const logsDir = ensureLogsDirectory();
const mastraLogPath = join(logsDir, 'mastra.log');
ensureLogFileExists(mastraLogPath);

const logLevelEnv = process.env.MASTRA_LOG_LEVEL?.toLowerCase();
const logLevel =
  logLevelEnv === 'debug' || logLevelEnv === 'warn' || logLevelEnv === 'error' || logLevelEnv === 'info'
    ? logLevelEnv
    : 'info';

/** POST /find-mues runs 3 LLM steps + large payloads; default server timeouts are too short. */
const serverTimeoutRaw = process.env.MASTRA_SERVER_TIMEOUT_MS?.trim();
const serverTimeoutMsParsed = serverTimeoutRaw ? Number(serverTimeoutRaw) : 600_000;
const serverTimeoutMs =
  Number.isFinite(serverTimeoutMsParsed) && serverTimeoutMsParsed > 0
    ? serverTimeoutMsParsed
    : 600_000;

/** Windows: `mastra dev` reload can start a new Node before the old one closes DuckDB, which locks `mastra.duckdb`. Override with MASTRA_DUCKDB_PATH (e.g. `./mastra.duckdb` if you need persisted Studio traces). */
const observabilityDuckDbPath = (() => {
  const fromEnv = process.env.MASTRA_DUCKDB_PATH?.trim();
  if (fromEnv) return fromEnv;
  const prod = process.env.NODE_ENV === 'production';
  if (process.platform === 'win32' && !prod) return ':memory:';
  return './mastra.duckdb';
})();

export const mastra = new Mastra({
  server: {
    apiRoutes: miningIntelligenceApiRoutes,
    timeout: serverTimeoutMs,
  },
  workflows: { weatherWorkflow, mueFinderWorkflow },
  agents: {
    weatherAgent,
    mueQueryPlannerAgent,
    mueResearchAgent,
    mueSynthesisAgent,
  },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: {
      observability: await new DuckDBStore({ path: observabilityDuckDbPath }).getStore('observability'),
    }
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: logLevel,
    prettyPrint: process.env.MASTRA_LOG_PRETTY !== 'false',
    transports: {
      file: new FileTransport({ path: mastraLogPath }),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(), // Persists traces to storage for Mastra Studio
          new CloudExporter(), // Sends traces to Mastra Cloud (if MASTRA_CLOUD_ACCESS_TOKEN is set)
          new JsonlTracingExporter({ logDirectory: logsDir, fileName: 'traces.jsonl' }),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
