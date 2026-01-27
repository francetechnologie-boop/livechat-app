// NoHash module backend entry (ESM)
// Exposes a simple endpoint to list allowed module and page hashes.

import { registerNohashRoutes } from './routes/nohash.routes.js';
import { installModule } from './installer.js';

export function register(app, ctx) {
  // Mount JSON parser for this module's API namespace
  try {
    const key = '/api/nohash';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  // Run DB migrations for this module (non-blocking)
  installModule().catch(() => {});
  registerNohashRoutes(app, ctx);
}

// Auto-added ping for compliance
try { app.get('/api/nohash/ping', (_req, res) => res.json({ ok: true, module: 'nohash' })); } catch {}
