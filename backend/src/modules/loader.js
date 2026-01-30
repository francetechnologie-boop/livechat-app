import fs from 'fs';
import path from 'path';
import express from 'express';
import { spawn } from 'child_process';
import { registerCronAction, getCronActions, dispatchCronHttpAction } from './cronRegistry.js';

// Simple module hook loader: scans modules/*/module.config.json
// and runs backend/hooks.(js|ts) exported callbacks if present.
const __loadedModules = [];
export function getLoadedModules() {
  try {
    // Return a shallow copy to avoid accidental mutation by callers
    return __loadedModules.map((m) => ({ ...m }));
  } catch { return []; }
}

async function getActiveModuleSetFromDb(pool) {
  try {
    if (!pool) return null;
    const r = await pool.query("SELECT module_name, active FROM mod_module_manager_modules");
    if (!r || !r.rows) return null;
    const set = new Set(['module-manager']);
    for (const row of r.rows) {
      const id = String(row.module_name || '').trim();
      const active = row.active === true || row.active === 1 || String(row.active) === '1';
      if (id && active) set.add(id);
    }
    return set;
  } catch { return null; }
}

async function maybeAutoActivateMissingModule({ pool, modId, modDir, activeSet, log }) {
  try {
    if (!pool || !modId || !modDir || !activeSet || activeSet.has(modId)) return false;
    // If a DB row exists, respect it (do not override a deliberate deactivate).
    try {
      const r = await pool.query("SELECT active FROM mod_module_manager_modules WHERE module_name = $1 LIMIT 1", [modId]);
      if (r?.rows?.length) return false;
    } catch {
      return false;
    }

    // Only auto-seed if the manifest explicitly opts in via defaultActive/defaultInstalled.
    let manifest = null;
    try {
      const cfgPath = path.join(modDir, 'config.json');
      if (fs.existsSync(cfgPath)) manifest = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch { manifest = null; }

    const defaultActive = !!(manifest && manifest.defaultActive);
    const defaultInstalled = !!(manifest && manifest.defaultInstalled);
    if (!defaultActive && !defaultInstalled) return false;

    const version = (manifest && manifest.version) ? String(manifest.version) : '1.0.0';
    const a = defaultActive ? 1 : 0;
    const i = defaultInstalled ? 1 : 0;
    try {
      await pool.query(
        `INSERT INTO mod_module_manager_modules (module_name, active, install, version, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (module_name) DO NOTHING`,
        [modId, a, i, version]
      );
      if (defaultActive) activeSet.add(modId);
      try { log?.(`${modId}: auto-seeded DB state (active=${a}, install=${i})`); } catch {}
      return defaultActive;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

export async function loadModuleHooks(ctx = {}) {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../');
  const backendDir = path.join(repoRoot, 'backend');
  const modulesRoot = path.join(repoRoot, 'modules');
  let entries = [];
  try { entries = fs.readdirSync(modulesRoot, { withFileTypes: true }); } catch { return; }
  const log = (msg) => { try { ctx.logToFile?.(`[modules] ${msg}`); } catch {} };

  // Determine which modules are active according to Module Manager DB state (if present).
  // If the table is absent or empty, do not gate loading (backward compatible behavior).
  let activeSet = null;
  try {
    const pool = ctx.pool;
    if (pool) {
      const r = await pool.query("SELECT COUNT(1) AS c FROM mod_module_manager_modules").catch(() => null);
      const hasRows = !!(r && r.rows && Number(r.rows[0]?.c) > 0);
      if (hasRows) {
        try { activeSet = await getActiveModuleSetFromDb(pool); } catch {}
      }
    }
  } catch {}

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const modId = ent.name;
    const modDir = path.join(modulesRoot, modId);
    const cfgPath = path.join(modDir, 'module.config.json');
    if (!fs.existsSync(cfgPath)) continue;
    // Respect Module Manager state when available
    if (activeSet && !activeSet.has(modId)) {
      await maybeAutoActivateMissingModule({ pool: ctx.pool, modId, modDir, activeSet, log });
      if (!activeSet.has(modId)) continue;
    }
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      // If config explicitly disables, skip
      if (cfg && cfg.enabled === false) continue;
      const hooksRel = cfg?.hooks || {};
      if (!hooksRel || typeof hooksRel !== 'object') continue;
      const hooksFileJs = path.join(modDir, 'backend', 'hooks.js');
      const hooksFileTs = path.join(modDir, 'backend', 'hooks.ts');
      let hooksMod = null;
      try {
        if (fs.existsSync(hooksFileJs)) hooksMod = await import(pathToFileUrl(hooksFileJs));
        else if (fs.existsSync(hooksFileTs)) hooksMod = await import(pathToFileUrl(hooksFileTs));
      } catch {}
      if (!hooksMod) continue;
      // onModuleLoaded
      const cbName = String(hooksRel.onModuleLoaded || '').trim();
      if (cbName && typeof hooksMod[cbName] === 'function') {
        try {
          await hooksMod[cbName]({
            ...ctx,
            module: { name: modId, config: cfg },
            getLoadedModules,
            repoRoot,
            backendDir,
            registerCronAction,
            getCronActions,
            dispatchCronHttpAction,
          });
        } catch (e) {
          try { ctx.logToFile?.(`[hooks] ${modId}.onModuleLoaded error: ${e?.message || e}`); } catch {}
        }
      }
    } catch (e) {
      try { ctx.logToFile?.(`[hooks] ${modId} load failed: ${e?.message || e}`); } catch {}
    }
  }
}

function pathToFileUrl(p) {
  let full = path.resolve(p).replace(/\\/g, '/');
  if (!full.startsWith('/')) full = '/' + full;
  return `file://${full}`;
}

// Auto-register module backend routes when an Express `app` is provided in ctx.
// Order of preference per module:
// 1) backend/index.js|ts exporting `register(app)` or `registerRoutes(app)`
// 2) any backend/routes/* file exporting functions matching /^register.*Routes$/
export async function loadModuleRoutes(ctx = {}) {
  const app = ctx.app;
  if (!app) return; // Nothing to do without an Express app
  const log = (msg) => { try { ctx.logToFile?.(`[modules] ${msg}`); } catch {} };

  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../');
  const backendDir = path.join(repoRoot, 'backend');
  const modulesRoot = path.join(repoRoot, 'modules');
  let entries = [];
  try { entries = fs.readdirSync(modulesRoot, { withFileTypes: true }); } catch { return; }

  // Determine active modules (from Module Manager DB) when table has rows.
  let activeSet = null;
  try {
    const pool = ctx.pool;
    if (pool) {
      const r = await pool.query("SELECT COUNT(1) AS c FROM mod_module_manager_modules").catch(() => null);
      const hasRows = !!(r && r.rows && Number(r.rows[0]?.c) > 0);
      if (hasRows) {
        try { activeSet = await getActiveModuleSetFromDb(pool); } catch {}
      }
    }
  } catch {}

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const modId = ent.name;
    const modDir = path.join(modulesRoot, modId);
    const cfgPath = path.join(modDir, 'module.config.json');
    if (!fs.existsSync(cfgPath)) continue;
    // Respect Module Manager state when available
    if (activeSet && !activeSet.has(modId)) {
      await maybeAutoActivateMissingModule({ pool: ctx.pool, modId, modDir, activeSet, log });
      if (!activeSet.has(modId)) { log(`${modId}: skipped (inactive by DB state)`); continue; }
    }
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { cfg = {}; }
    if (cfg && cfg.enabled === false) continue;

    // Modules are responsible for mounting their own JSON body parsers.

    // 1) backend/index.* entrypoint
    const idxJs = path.join(modDir, 'backend', 'index.js');
    const idxTs = path.join(modDir, 'backend', 'index.ts');
    let entryLoaded = false;
    try {
      if (fs.existsSync(idxJs)) {
        const m = await import(pathToFileUrl(idxJs));
        if (typeof m.register === 'function') { m.register(app, { ...ctx, getLoadedModules, repoRoot, backendDir, expressJson: express.json, registerCronAction, getCronActions, dispatchCronHttpAction }); entryLoaded = true; log(`${modId}: registered via backend/index.js`); __loadedModules.push({ id: modId, method: 'backend/index.js', when: Date.now() }); }
        else if (typeof m.registerRoutes === 'function') { m.registerRoutes(app, { ...ctx, getLoadedModules, repoRoot, backendDir, expressJson: express.json, registerCronAction, getCronActions, dispatchCronHttpAction }); entryLoaded = true; log(`${modId}: registered via backend/index.js registerRoutes`); __loadedModules.push({ id: modId, method: 'backend/index.js#registerRoutes', when: Date.now() }); }
      } else if (fs.existsSync(idxTs)) {
        // Prefer a compiled JS fallback when index.ts is present
        const idxTsJs = idxTs.replace(/\.ts$/, '.js');
        if (fs.existsSync(idxTsJs)) {
          try {
            const m = await import(pathToFileUrl(idxTsJs));
            if (typeof m.register === 'function') { m.register(app, { ...ctx, getLoadedModules, repoRoot, backendDir, expressJson: express.json, registerCronAction, getCronActions, dispatchCronHttpAction }); entryLoaded = true; log(`${modId}: registered via backend/index.ts (js fallback)`); __loadedModules.push({ id: modId, method: 'backend/index.ts[js]', when: Date.now() }); }
            else if (typeof m.registerRoutes === 'function') { m.registerRoutes(app, { ...ctx, getLoadedModules, repoRoot, backendDir, expressJson: express.json, registerCronAction, getCronActions, dispatchCronHttpAction }); entryLoaded = true; log(`${modId}: registered via backend/index.ts registerRoutes (js fallback)`); __loadedModules.push({ id: modId, method: 'backend/index.ts[js]#registerRoutes', when: Date.now() }); }
          } catch (e) {
            log(`${modId}: backend/index.ts fallback load error: ${e?.message || e}`);
          }
        } else {
          log(`${modId}: backend/index.ts present but no JS fallback; skipping`);
        }
      }
    } catch (e) {
      log(`${modId}: backend/index load error: ${e?.message || e}`);
    }
    if (entryLoaded) {
      try {
        if (/^(1|true|yes)$/i.test(String(process.env.MODULE_SCHEMA_AUTOCHECK || ''))) {
          await autoSelfReport(modId, { ...ctx, repoRoot, backendDir });
        }
      } catch {}
      continue;
    }

    // 2) backend/routes/* exports named like register*Routes
    try {
      const routesDir = path.join(modDir, 'backend', 'routes');
      if (!fs.existsSync(routesDir)) continue;
      const files = fs.readdirSync(routesDir).filter(f => /\.(js|ts)$/.test(f));
      for (const f of files) {
        try {
          const full = path.join(routesDir, f);
          let target = full;
          if (/\.ts$/.test(full)) {
            const jsFallback = full.replace(/\.ts$/, '.js');
            if (fs.existsSync(jsFallback)) target = jsFallback; // Prefer compiled JS fallback
            else { log(`${modId}: route '${path.basename(full)}' is TS without JS fallback; skipping`); continue; }
          }
          const m = await import(pathToFileUrl(target));
          const keys = Object.keys(m || {});
          for (const k of keys) {
            if (/^register.*Routes$/.test(k) && typeof m[k] === 'function') {
              try { m[k](app, { ...ctx, getLoadedModules, repoRoot, backendDir, expressJson: express.json, registerCronAction, getCronActions, dispatchCronHttpAction }); log(`${modId}: ${path.basename(target)} -> ${k}() mounted`); __loadedModules.push({ id: modId, method: `routes/${path.basename(target)}#${k}`, when: Date.now() }); } catch (e) { log(`${modId}: ${path.basename(target)} ${k} error: ${e?.message || e}`); }
            }
          }
        } catch (e) { log(`${modId}: route file '${f}' error: ${e?.message || e}`); }
      }
    } catch (e) { log(`${modId}: routes scan failed: ${e?.message || e}`); }

    // Status reporting is opt-in to keep startup fast
    try {
      if (/^(1|true|yes)$/i.test(String(process.env.MODULE_SCHEMA_AUTOCHECK || ''))) {
        await autoSelfReport(modId, { ...ctx, repoRoot, backendDir });
      }
    } catch {}
  }
}

async function autoSelfReport(modId, ctx) {
  const pool = ctx.pool;
  if (!pool) return;
  // 1) Attempt to run module installer if present (idempotent migrations)
  try {
    const installer = path.join(ctx.repoRoot, 'modules', modId, 'backend', 'installer.js');
    if (fs.existsSync(installer)) {
      await new Promise((resolve) => {
        const child = spawn(process.execPath, [installer], { stdio: 'ignore' });
        child.on('exit', () => resolve());
        child.on('error', () => resolve());
      });
    }
  } catch {}

  // 2) Compute derived schema presence from migrations
  let derivedOk = null; let errText = null;
  try {
    const migDir = path.join(ctx.repoRoot, 'modules', modId, 'db', 'migrations');
    const expects = { tables: new Set(), indexes: [] };
    if (fs.existsSync(migDir)) {
      const files = (fs.readdirSync(migDir) || []).filter(f => f.endsWith('.sql'));
      const norm = (n) => String(n||'').replace(/^"|"$/g,'');
      for (const f of files) {
        let sql = '';
        try { sql = fs.readFileSync(path.join(migDir, f), 'utf8'); } catch {}
        if (!sql) continue;
        const reTab = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_\.\"-]+)/ig;
        let m;
        while ((m = reTab.exec(sql))) { expects.tables.add(norm(m[1])); }
        const reIdx = /CREATE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_\.\"-]+)\s+ON\s+([A-Za-z0-9_\.\"-]+)/ig;
        let k;
        while ((k = reIdx.exec(sql))) { expects.indexes.push({ name: norm(k[1]), table: norm(k[2]) }); }
      }
    }
    const tables = Array.from(expects.tables);
    const missing = [];
    for (const t of tables) {
      try {
        const name = t.includes('.') ? t : `public.${t}`;
        const r = await pool.query('SELECT to_regclass($1) AS oid', [name]);
        const exists = !!(r.rows && r.rows[0] && r.rows[0].oid);
        if (!exists) missing.push(t);
      } catch {}
    }
    // Indexes check (best effort)
    const missingIdx = [];
    for (const x of expects.indexes) {
      try {
        const parts = x.table.split('.'); const tn = parts.pop();
        const r = await pool.query('SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2', [tn, x.name]);
        if (!r.rowCount) missingIdx.push(`${x.name} ON ${x.table}`);
      } catch {}
    }
    derivedOk = (missing.length === 0 && missingIdx.length === 0);
    if (!derivedOk && (!tables.length && !expects.indexes.length)) {
      // No migrations found; leave as null (n/a)
      derivedOk = null;
    }
  } catch (e) {
    errText = e?.message || String(e);
  }

  // 3) Upsert status into module manager table
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_module_manager_modules (
      id_module SERIAL PRIMARY KEY,
      module_name TEXT UNIQUE,
      version VARCHAR(16),
      active SMALLINT NOT NULL DEFAULT 1,
      install SMALLINT NOT NULL DEFAULT 1,
      installed_at TIMESTAMP NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      has_mcp_tool SMALLINT NOT NULL DEFAULT 0,
      has_profil SMALLINT NOT NULL DEFAULT 0,
      mcp_tools JSONB NULL,
      schema_ok BOOLEAN NULL,
      install_error TEXT NULL
    )`);
  } catch {}
  try { await pool.query('ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS schema_ok BOOLEAN NULL'); } catch {}
  try { await pool.query('ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS install_error TEXT NULL'); } catch {}
  try {
    await pool.query(
      `INSERT INTO mod_module_manager_modules (module_name, version, active, install, installed_at, updated_at)
       VALUES ($1,$2,1,1,NOW(),NOW())
       ON CONFLICT (module_name) DO UPDATE SET updated_at=NOW()`,
      [modId, '1.0.0']
    );
  } catch {}
  try {
    const okVal = derivedOk === null ? null : !!derivedOk;
    const errVal = errText ? String(errText).slice(0, 2000) : null;
    await pool.query('UPDATE mod_module_manager_modules SET schema_ok=$1, install_error=$2, updated_at=NOW() WHERE module_name=$3', [okVal, errVal, modId]);
  } catch {}
}
