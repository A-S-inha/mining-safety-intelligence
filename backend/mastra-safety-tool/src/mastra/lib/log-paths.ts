import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Mastra package root (`backend/mastra-safety-tool`). */
function mastraPackageRoot(): string {
  const libDir = dirname(fileURLToPath(import.meta.url));
  return dirname(dirname(dirname(libDir)));
}

/**
 * Writable log directory (default: `<mastra-safety-tool>/logs`).
 * Override with `MASTRA_LOG_DIR` (absolute or cwd-relative).
 */
export function getLogsDirectory(): string {
  const env = process.env.MASTRA_LOG_DIR?.trim();
  if (env) return isAbsolute(env) ? env : join(process.cwd(), env);
  return join(mastraPackageRoot(), 'logs');
}

export function ensureLogsDirectory(): string {
  const dir = getLogsDirectory();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** @mastra/loggers FileTransport throws if the file path does not already exist. */
export function ensureLogFileExists(filePath: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '', 'utf8');
  }
}
