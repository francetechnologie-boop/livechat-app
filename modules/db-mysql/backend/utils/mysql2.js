import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', '..', '..', '..', 'backend');
  } catch { return process.cwd(); }
}

export async function getMysql2(ctx) {
  try {
    const mod = await import('mysql2/promise');
    return mod && (mod.default || mod);
  } catch (_) {}
  try {
    const backendDir = resolveBackendDir(ctx);
    const pkg = path.join(backendDir, 'package.json');
    if (fs.existsSync(pkg)) {
      const req = createRequire(pkg);
      const mod = req('mysql2/promise');
      if (mod) return mod && (mod.default || mod);
    }
  } catch {}
  try {
    const backendDir = resolveBackendDir(ctx);
    const alt = path.join(backendDir, 'node_modules', 'mysql2', 'promise.js');
    if (fs.existsSync(alt)) {
      const mod = await import(pathToFileURL(alt).href);
      return mod && (mod.default || mod);
    }
  } catch {}
  const err = new Error('mysql2_missing');
  err.code = 'MYSQL2_MISSING';
  throw err;
}
