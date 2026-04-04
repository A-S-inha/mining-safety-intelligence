import "dotenv/config";

import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from "@mastra/core/storage";
import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from "@mastra/observability";

import { mueAgent } from "./agents/mueAgent";
import {mueToolAgent} from "./agents/mueToolAgent";
import { queryUnderstandingAgent } from "./agents/queryUnderstandingAgent";
import { mueGroundingScore, mueQualityScore } from "./scorers/mueScorers";

const disableObservability =
  process.env.DISABLE_MASTRA_OBSERVABILITY === "true";

const hasCloudToken = Boolean(process.env.MASTRA_CLOUD_ACCESS_TOKEN);

const observabilityDomains = disableObservability
  ? {}
  : {
      observability: await new DuckDBStore().getStore("observability"),
    };

const observabilityConfig = disableObservability
  ? undefined
  : new Observability({
      configs: {
        default: {
          serviceName: "mastra",
          exporters: hasCloudToken
            ? [new DefaultExporter(), new CloudExporter()]
            : [new DefaultExporter()],
          spanOutputProcessors: [new SensitiveDataFilter()],
        },
      },
    });

export const mastra = new Mastra({
  workflows: {},
  agents: {
    mueAgent,
    queryUnderstandingAgent,
    mueToolAgent,
  },
  scorers: {
    mueGroundingScore,
    mueQualityScore,
  },
  storage: new MastraCompositeStore({
    id: "composite-storage",
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: observabilityDomains,
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  observability: observabilityConfig,
});