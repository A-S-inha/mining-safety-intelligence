import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Default layout (sibling of `mastra-safety-tool`): `backend/data/accidents` — either a pipe-delimited
 * file at that path, or a directory containing `Accidents.txt` / `accidents.txt`.
 * Falls back to `backend/data/Accidents.txt` if the accidents layout is missing.
 *
 * Bundled code lives under `.mastra/output/*.mjs`; we locate the package via `package.json` name.
 *
 * Override: `MSHA_ACCIDENTS_FILE` — absolute path, or relative to the **mastra-safety-tool**
 * package root (folder that contains `package.json`), not `process.cwd()` (which varies when code runs from `.mastra/output` or `src/mastra`).
 *
 * Example: `../data/accidents/Accidents.sample.txt`
 */
function findMastraSafetyToolRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 24; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name === 'mastra-safety-tool') return dir;
      } catch {
        // ignore invalid package.json
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not find mastra-safety-tool/package.json to resolve MSHA data. Set MSHA_ACCIDENTS_FILE to an absolute file path.',
  );
}

function resolveDefaultAccidentsFile(mastraPkgRoot: string): string {
  const dataRoot = join(mastraPkgRoot, '..', 'data');
  const accidentsPath = join(dataRoot, 'accidents');
  const legacyFile = join(dataRoot, 'Accidents.txt');

  if (existsSync(accidentsPath)) {
    try {
      const st = statSync(accidentsPath);
      if (st.isFile()) return accidentsPath;
      if (st.isDirectory()) {
        for (const name of ['Accidents.txt', 'accidents.txt'] as const) {
          const p = join(accidentsPath, name);
          if (existsSync(p)) return p;
        }
      }
    } catch {
      // fall through
    }
  }

  if (existsSync(legacyFile)) return legacyFile;

  return join(accidentsPath, 'Accidents.txt');
}

export function getAccidentsFilePath(): string {
  const override = process.env.MSHA_ACCIDENTS_FILE?.trim();
  const root = findMastraSafetyToolRoot();
  if (override) {
    return isAbsolute(override) ? override : join(root, override);
  }
  return resolveDefaultAccidentsFile(root);
}
