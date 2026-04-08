import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TracingEvent } from '@mastra/core/observability';
import { BaseExporter, type BaseExporterConfig } from '@mastra/observability';
import { stringifyJsonlLine } from '../lib/json-stringify-safe';

export type JsonlTracingExporterConfig = BaseExporterConfig & {
  /** Directory for `traces.jsonl` (created on first write). */
  logDirectory: string;
  /** File name inside logDirectory */
  fileName?: string;
  /** If set, only these event types are written (default: all). */
  eventTypes?: Array<TracingEvent['type']>;
};

/**
 * Appends Mastra tracing events as JSON lines for offline review / SIEM pipelines.
 * Complements DefaultExporter (Studio/DuckDB) with a plain-text audit trail.
 */
export class JsonlTracingExporter extends BaseExporter {
  name = 'jsonl-tracing';
  private readonly path: string;
  private readonly eventTypes: Set<string> | null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(config: JsonlTracingExporterConfig) {
    super(config);
    const file = config.fileName ?? 'traces.jsonl';
    this.path = join(config.logDirectory, file);
    this.eventTypes = config.eventTypes?.length ? new Set(config.eventTypes) : null;
  }

  protected async _exportTracingEvent(event: TracingEvent): Promise<void> {
    if (this.eventTypes && !this.eventTypes.has(event.type)) return;

    const record = {
      exportedAt: new Date().toISOString(),
      type: event.type,
      exportedSpan: event.exportedSpan,
    };

    const line = stringifyJsonlLine(record);
    this.writeChain = this.writeChain.then(() => appendFile(this.path, line, 'utf8'));
    await this.writeChain;
  }

  override async flush(): Promise<void> {
    await this.writeChain;
  }
}
