import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return path.resolve(here, '..', '..', '..', '..', 'backend');
  } catch { return process.cwd(); }
}

export async function getPgModule(ctx) {
  try {
    const mod = await import('pg');
    return mod && (mod.default || mod);
  } catch (_) {}
  try {
    const backendDir = resolveBackendDir(ctx);
    const alt = path.join(backendDir, 'node_modules', 'pg', 'esm', 'index.mjs');
    if (fs.existsSync(alt)) {
      const mod = await import(pathToFileURL(alt).href);
      return mod;
    }
  } catch {}
  const err = new Error('pg_missing');
  err.code = 'PG_MISSING';
  throw err;
}

