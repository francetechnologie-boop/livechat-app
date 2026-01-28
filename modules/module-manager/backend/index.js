import fs from "fs";
import path from "path";
// Note: JSZip is optional. We lazy-load it inside the ZIP route to avoid
// crashing the server when the package isn't installed on the target host.
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const DEFAULT_MODULE_CATALOG = [
  {
    id: "knowledge-base",
    name: "Knowledge Base",
    description: "Publier des articles d'aide consultables depuis le widget.",
    category: "support",
    version: "1.0.0",
    source: "builtin",
    defaultInstalled: true,
    defaultActive: false,
  },
  {
    id: "automation-suite",
    name: "Automation Suite",
    description: "Déclencher des scénarios automatiques pour qualifier les visiteurs.",
    category: "automation",
    version: "1.0.0",
    source: "builtin",
    defaultInstalled: true,
    defaultActive: false,
  },
  {
    id: "advanced-analytics",
    name: "Analytique avancée",
    description: "Suivre les performances de l'équipe et les conversions.",
    category: "analytics",
    version: "1.0.0",
    source: "builtin",
    defaultInstalled: true,
    defaultActive: false,
  },
];

const MODULES_SETTING_KEY = "MODULE_MANAGER_STATE";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MANIFEST_DIRS = [
  { dir: path.resolve(__dirname, ".."), location: "backend" },
  {
    dir: path.resolve(__dirname, "../../../frontend/src/modules"),
    location: "frontend",
  },
  {
    dir: path.resolve(__dirname, "../../../modules"),
    location: "module-root",
  },
  {
    dir: path.resolve(__dirname, "../../../config/modules"),
    location: "legacy",
  },
];

const EXTRA_MANIFEST_DIRS = (process.env.MODULE_MANIFEST_DIRS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((dir, index) => ({
    dir: path.resolve(dir),
    location: `custom${index ? `_${index + 1}` : ""}`,
  }));

const MANIFEST_DIRS = [...DEFAULT_MANIFEST_DIRS, ...EXTRA_MANIFEST_DIRS];
const MANIFEST_FILE_NAMES = ["config.json", "manifest.json"];

let catalogCache = null;
let modulePool = null;
let modulesTypeCache = null; // { active: 'smallint'|'boolean', install: 'smallint'|'boolean' }
let ensureModulesTablePromise = null;

function filterExpectedSchemaForModule(moduleId, expects) {
  try {
    const id = String(moduleId || '').trim();
    if (!expects || !(expects.tables instanceof Set)) return expects;
    const dropKeywords = new Set(['if', 'do', 'begin', 'end', 'exists']);
    // Treat archive tables and stray keywords as optional — do not require them to exist
    let filtered = Array.from(expects.tables).filter((t) => {
      const name = String(t || '').replace(/^public\./, '').replace(/^"|"$/g, '');
      if (dropKeywords.has(name.toLowerCase())) return false;
      if (!name || name.length <= 2) return false;
      if (name.startsWith('_archive_')) return false;
      if (name === '_archive_mod_grabbing_jerome_table_settings') return false;
      return true;
    });
    // Grabbing-Sensorex: ignore legacy tables not used anymore
    if (id === 'grabbing-sensorex') {
      filtered = filtered.filter((t) => {
        const bare = String(t || '').replace(/^public\./, '').replace(/^"|"$/g, '');
        return bare !== 'mod_grabbing_sensorex_domain_type_config' && bare !== 'mod_grabbing_sensorex_domain_type_config_hist';
      });
      try {
        expects.indexes = (expects.indexes || []).filter((x) => String(x?.name) !== 'mod_gs_dt_cfg_hist_key_idx');
      } catch {}
    }
    // Grabbing-Zasilkovna: skip temporary helper tables created during migrations
    if (id === 'grabbing-zasilkovna') {
      filtered = filtered.filter((t) => {
        const bare = String(t || '').replace(/^public\./, '').replace(/^"|"$/g, '');
        return bare !== 'mod_grabbing_zasilkovna_new' && bare !== 'mod_grabbing_zasilkovna_old';
      });
    }

    // Tools: legacy email-template tables were dropped (replaced by mod_tools_email_template).
    if (id === 'tools') {
      const legacyTables = new Set([
        'mod_tools_email_subject_translations',
        'mod_tools_email_template_sources',
        'mod_tools_email_template_types',
      ]);
      filtered = filtered.filter((t) => {
        const bare = String(t || '').trim().replace(/^public\./, '').replace(/^"|"$/g, '');
        return !legacyTables.has(bare);
      });
      const legacyIndexes = new Set([
        'idx_mod_tools_email_subject_translations_org',
        'idx_mod_tools_email_subject_translations_lang',
        'idx_mod_tools_email_template_sources_org',
        'idx_mod_tools_email_template_sources_profile',
        'idx_mod_tools_email_template_types_org',
      ]);
      try {
        expects.indexes = (expects.indexes || []).filter((x) => !legacyIndexes.has(String(x?.name || '').trim()));
      } catch {}
    }

    expects.tables = new Set(filtered);
  } catch {}
  return expects;
}

// ESM-safe check for a module directory on disk
function moduleDirExists(id) {
  try {
    const base = path.resolve(__dirname, "../../../modules");
    const d = path.join(base, String(id || "").trim());
    return fs.existsSync(d);
  } catch {
    return false;
  }
}

function normaliseCatalogEntry(entry = {}, origin = {}) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  if (!id) return null;
  const locations = new Set(
    Array.isArray(entry.locations) ? entry.locations.map((l) => String(l)) : []
  );
  if (origin.location) locations.add(origin.location);

  const manifestPaths = new Set(
    Array.isArray(entry.manifestPaths)
      ? entry.manifestPaths.map((p) => String(p))
      : []
  );
  if (origin.manifestPath) manifestPaths.add(origin.manifestPath);

  const moduleDirs = new Set(
    Array.isArray(entry.moduleDirs)
      ? entry.moduleDirs.map((p) => String(p))
      : []
  );
  if (origin.moduleDir) moduleDirs.add(origin.moduleDir);

  const tagValues = Array.isArray(entry.tags)
    ? entry.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const tags = tagValues.length ? tagValues : undefined;

  const paths =
    entry.paths && typeof entry.paths === "object"
      ? Object.fromEntries(
          Object.entries(entry.paths).map(([k, v]) => [String(k), String(v)])
        )
      : undefined;

  const locationsArray = Array.from(locations);
  const manifestPathArray = Array.from(manifestPaths);
  const moduleDirArray = Array.from(moduleDirs);

  return {
    id,
    name: String(entry.name || id).trim(),
    description: String(entry.description || "").trim(),
    category: String(entry.category || "custom").trim() || "custom",
    version: entry.version ? String(entry.version) : null,
    source: entry.source || origin.source || "manifest",
    tags,
    defaultInstalled: entry.defaultInstalled === true,
    defaultActive: entry.defaultActive === true,
    locations: locationsArray.length ? locationsArray : undefined,
    hasBackend: entry.hasBackend === true || origin.location === "backend",
    hasFrontend: entry.hasFrontend === true || origin.location === "frontend",
    // Pass-through capability flags from manifest
    hasMcpTool: entry.hasMcpTool === true,
    hasProfil: entry.hasProfil === true,
    mcpTools: Array.isArray(entry.mcpTools) ? entry.mcpTools : undefined,
    manifestPaths: manifestPathArray.length ? manifestPathArray : undefined,
    moduleDirs: moduleDirArray.length ? moduleDirArray : undefined,
    paths,
  };
}

function mergeCatalogEntries(target, incoming) {
  const uniqueMerge = (a = [], b = []) =>
    Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]));

  const mergedLocations = uniqueMerge(target.locations, incoming.locations);
  target.locations = mergedLocations.length ? mergedLocations : undefined;

  const mergedManifestPaths = uniqueMerge(
    target.manifestPaths,
    incoming.manifestPaths
  );
  target.manifestPaths = mergedManifestPaths.length ? mergedManifestPaths : undefined;

  const mergedModuleDirs = uniqueMerge(target.moduleDirs, incoming.moduleDirs);
  target.moduleDirs = mergedModuleDirs.length ? mergedModuleDirs : undefined;
  const mergedTags = uniqueMerge(target.tags, incoming.tags);
  target.tags = mergedTags.length ? mergedTags : undefined;

  target.hasBackend = target.hasBackend || incoming.hasBackend;
  target.hasFrontend = target.hasFrontend || incoming.hasFrontend;
  // Merge capability flags and tool lists
  target.hasMcpTool = !!(target.hasMcpTool || incoming.hasMcpTool);
  target.hasProfil = !!(target.hasProfil || incoming.hasProfil);
  try {
    const a = Array.isArray(target.mcpTools) ? target.mcpTools : [];
    const b = Array.isArray(incoming.mcpTools) ? incoming.mcpTools : [];
    const byName = new Map();
    for (const t of a) { const k = (t && t.name) ? String(t.name) : JSON.stringify(t); byName.set(k, t); }
    for (const t of b) { const k = (t && t.name) ? String(t.name) : JSON.stringify(t); byName.set(k, t); }
    const merged = Array.from(byName.values());
    target.mcpTools = merged.length ? merged : undefined;
  } catch {}

  const fill = (key) => {
    if (!target[key] && incoming[key]) target[key] = incoming[key];
  };
  fill("name");
  fill("description");
  fill("category");
  fill("version");
  fill("source");
  fill("database");

  target.defaultInstalled = target.defaultInstalled || incoming.defaultInstalled;
  target.defaultActive = target.defaultActive || incoming.defaultActive;

  if (incoming.paths) {
    target.paths = { ...(target.paths || {}), ...incoming.paths };
  }
}

function loadCatalogFromManifests(logToFile) {
  const byId = new Map();

  for (const { dir, location } of MANIFEST_DIRS) {
    if (!dir || !fs.existsSync(dir)) continue;

    let filesRead = 0;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logToFile?.(`⚠️ module-manifest directory error (${dir}): ${err.message}`);
      continue;
    }

    for (const entry of entries) {
      const candidates = [];
      if (entry.isDirectory()) {
        const moduleDir = path.join(dir, entry.name);
        for (const fileName of MANIFEST_FILE_NAMES) {
          const candidate = path.join(moduleDir, fileName);
          if (fs.existsSync(candidate)) {
            candidates.push({ manifestPath: candidate, moduleDir });
          }
        }
      } else if (entry.isFile() && MANIFEST_FILE_NAMES.includes(entry.name)) {
        candidates.push({ manifestPath: path.join(dir, entry.name), moduleDir: dir });
      }

      for (const candidate of candidates) {
        try {
          const raw = fs.readFileSync(candidate.manifestPath, "utf8");
          const parsed = JSON.parse(raw);
          const normalized = normaliseCatalogEntry(parsed, {
            location,
            manifestPath: candidate.manifestPath,
            moduleDir: candidate.moduleDir,
            source: parsed?.source,
          });
          if (!normalized) continue;

          try {
            const backendDir = path.join(candidate.moduleDir, "backend");
            const frontendDir = path.join(candidate.moduleDir, "frontend");
            if (!normalized.hasBackend && fs.existsSync(backendDir)) {
              normalized.hasBackend = true;
              normalized.moduleDirs = normalized.moduleDirs || [];
              if (!normalized.moduleDirs.includes(backendDir)) {
                normalized.moduleDirs.push(backendDir);
              }
            }
            if (!normalized.hasFrontend && fs.existsSync(frontendDir)) {
              normalized.hasFrontend = true;
              normalized.moduleDirs = normalized.moduleDirs || [];
              if (!normalized.moduleDirs.includes(frontendDir)) {
                normalized.moduleDirs.push(frontendDir);
              }
            }
            // Also merge capability flags from module.config.json if present
            try {
              const moduleCfgPath = path.join(candidate.moduleDir, 'module.config.json');
              if (fs.existsSync(moduleCfgPath)) {
                const mraw = fs.readFileSync(moduleCfgPath, 'utf8');
                const mcfg = JSON.parse(mraw);
                if (mcfg && typeof mcfg === 'object') {
                  if (mcfg.hasMcpTool === true) normalized.hasMcpTool = true;
                  if (mcfg.hasProfil === true) normalized.hasProfil = true;
                  if (Array.isArray(mcfg.mcpTools)) {
                    const prev = Array.isArray(normalized.mcpTools) ? normalized.mcpTools : [];
                    const byName = new Map();
                    for (const t of prev) { const k = (t && t.name) ? String(t.name) : JSON.stringify(t); byName.set(k, t); }
                    for (const t of mcfg.mcpTools) { const k = (t && t.name) ? String(t.name) : JSON.stringify(t); byName.set(k, t); }
                    normalized.mcpTools = Array.from(byName.values());
                  }
                }
              }
            } catch {}
          } catch {}

          filesRead += 1;
          const existing = byId.get(normalized.id);
          if (existing) mergeCatalogEntries(existing, normalized);
          else byId.set(normalized.id, normalized);
        } catch (err) {
          logToFile?.(
            `⚠️ module-manifest parse failed (${candidate.manifestPath}): ${err.message}`
          );
        }
      }
    }

    if (filesRead) {
      logToFile?.(
        `📚 module-manifests loaded from ${dir} (${filesRead} manifest${filesRead > 1 ? "s" : ""})`
      );
    }
  }

  return Array.from(byId.values());
}

// Extra validation: warn about modules missing a config.json/manifest.json
function warnMissingManifests(logToFile) {
  try {
    const modulesRoot = path.resolve(__dirname, "../../../modules");
    if (!fs.existsSync(modulesRoot)) return;
    const entries = fs.readdirSync(modulesRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const modId = ent.name;
      const modDir = path.join(modulesRoot, modId);
      const hasRuntimeCfg = fs.existsSync(path.join(modDir, 'module.config.json'))
        || fs.existsSync(path.join(modDir, 'backend'))
        || fs.existsSync(path.join(modDir, 'frontend'));
      if (!hasRuntimeCfg) continue;
      const hasManifest = fs.existsSync(path.join(modDir, 'config.json'))
        || fs.existsSync(path.join(modDir, 'manifest.json'));
      if (!hasManifest) {
        logToFile?.(`⚠️ module '${modId}' is missing a manifest (config.json). It will not appear in Module Manager UI.`);
      }
    }
  } catch {}
}

function getCatalog(logToFile) {
  if (catalogCache === null) {
    catalogCache = loadCatalogFromManifests(logToFile);
    // Emit warnings for modules without manifests to aid developers
    warnMissingManifests(logToFile);
  }
  return catalogCache && catalogCache.length
    ? catalogCache
    : DEFAULT_MODULE_CATALOG;
}

function resetCatalogCache() {
  catalogCache = null;
}

const MODULES_TABLE = 'mod_module_manager_modules';
const MODULES_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS ${MODULES_TABLE} (
    id_module    SERIAL PRIMARY KEY,
    module_name  VARCHAR(64) NOT NULL UNIQUE,
    active       SMALLINT NOT NULL DEFAULT 0,
    version      VARCHAR(8) NOT NULL DEFAULT '0.0.0',
    install      SMALLINT NOT NULL DEFAULT 0,
    has_mcp_tool BOOLEAN NOT NULL DEFAULT FALSE,
    has_profil   BOOLEAN NOT NULL DEFAULT FALSE,
    mcp_tools    JSONB NULL,
    installed_at TIMESTAMP NULL DEFAULT NULL,
    updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

function toBool(val) {
  return val === true || val === 1 || val === "1";
}

async function ensureModulesTable() {
  if (!modulePool) return;
  if (!ensureModulesTablePromise) {
    ensureModulesTablePromise = (async () => {
      try {
        await modulePool.query(`DO $$ BEGIN
          IF to_regclass('public.${MODULES_TABLE}') IS NULL AND to_regclass('public.modules') IS NOT NULL THEN
            ALTER TABLE public.modules RENAME TO ${MODULES_TABLE};
          END IF;
        END $$;`);
      } catch {}
      // Column rename: legacy 'name' -> 'module_name'
      try { await modulePool.query(`ALTER TABLE ${MODULES_TABLE} RENAME COLUMN name TO module_name`); } catch {}
      await modulePool.query(MODULES_TABLE_DDL);
      // Non-breaking additions for capability columns
      try { await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS has_mcp_tool BOOLEAN NOT NULL DEFAULT FALSE`); } catch {}
      try { await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS has_profil BOOLEAN NOT NULL DEFAULT FALSE`); } catch {}
      try { await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS mcp_tools JSONB NULL`); } catch {}
      // Schema status columns for module self-checks
      try { await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS schema_ok BOOLEAN NULL`); } catch {}
      try { await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS install_error TEXT NULL`); } catch {}
    })()
      .catch((err) => {
        ensureModulesTablePromise = null;
        throw err;
      });
  }
  return ensureModulesTablePromise;
}

async function detectModulesColumnTypes() {
  if (!modulePool) return { active: 'smallint', install: 'smallint', has_mcp_tool: 'smallint', has_profil: 'smallint', mcp_tools: 'jsonb' };
  if (modulesTypeCache) return modulesTypeCache;
  try {
    const res = await modulePool.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = '${MODULES_TABLE}'
          AND column_name IN ('active','install','has_mcp_tool','has_profil','mcp_tools','schema_ok','install_error')`
    );
    const types = { active: 'smallint', install: 'smallint', has_mcp_tool: 'smallint', has_profil: 'smallint', mcp_tools: 'jsonb', schema_ok: 'smallint', install_error: 'text' };
    for (const r of res.rows || []) {
      const k = String(r.column_name);
      const t = String(r.data_type);
      if (k === 'active' || k === 'install') {
        if (/boolean/i.test(t)) types[k] = 'boolean';
        else if (/smallint|integer|int2|int4/i.test(t)) types[k] = 'smallint';
      } else if (k === 'has_mcp_tool' || k === 'has_profil') {
        if (/boolean/i.test(t)) types[k] = 'boolean';
        else if (/smallint|integer|int2|int4/i.test(t)) types[k] = 'smallint';
      } else if (k === 'mcp_tools') {
        types[k] = /json/i.test(t) ? 'jsonb' : t;
      } else if (k === 'schema_ok') {
        if (/boolean/i.test(t)) types[k] = 'boolean';
        else if (/smallint|integer|int2|int4/i.test(t)) types[k] = 'smallint';
      } else if (k === 'install_error') {
        types[k] = 'text';
      }
    }
    modulesTypeCache = types;
  } catch {
    modulesTypeCache = { active: 'smallint', install: 'smallint', has_mcp_tool: 'smallint', has_profil: 'smallint', mcp_tools: 'jsonb' };
  }
  return modulesTypeCache;
}

async function fetchModulesFromDb() {
  if (!modulePool) return new Map();
  await ensureModulesTable();
  const res = await modulePool.query(
    `SELECT id_module, module_name AS name, version, active, install, has_mcp_tool, has_profil, mcp_tools, schema_ok, install_error FROM ${MODULES_TABLE}`
  );
  const map = new Map();
  for (const row of res.rows) {
    map.set(row.name, {
      ...row,
      active: toBool(row.active),
      install: toBool(row.install),
      has_mcp_tool: toBool(row.has_mcp_tool),
      has_profil: toBool(row.has_profil),
    });
  }
  return map;
}

async function setDbModuleState(name, options = {}) {
  if (!modulePool || !name) return null;
  await ensureModulesTable();
  const types = await detectModulesColumnTypes();
  const res = await modulePool.query(
    `SELECT id_module, version, active, install, has_mcp_tool, has_profil, mcp_tools FROM ${MODULES_TABLE} WHERE module_name = $1`,
    [name]
  );
  const existing = res.rows[0];
  const nextVersion =
    options.version || existing?.version || options.defaultVersion || "1.0.0";
  const nextActive = options.active == null
    ? (existing ? toBool(existing.active) : false)
    : !!options.active;
  const nextInstall = options.install == null
    ? (existing ? toBool(existing.install) : false)
    : !!options.install;
  const nextHasMcpTool = options.hasMcpTool == null
    ? (existing ? toBool(existing.has_mcp_tool) : false)
    : !!options.hasMcpTool;
  const nextHasProfil = options.hasProfil == null
    ? (existing ? toBool(existing.has_profil) : false)
    : !!options.hasProfil;
  const nextMcpTools = Array.isArray(options.mcpTools) ? options.mcpTools : (existing?.mcp_tools || null);

  // Use boolean parameters for consistency, and map to column types in SQL.
  // Place casts in a CTE to ensure each parameter is typed exactly once.
  const params = [name, nextVersion, nextActive, nextInstall, nextHasMcpTool, nextHasProfil, JSON.stringify(nextMcpTools ?? null)];
  const useBoolActive = types.active === 'boolean';
  const useBoolInstall = types.install === 'boolean';
  const useBoolHasMcp = types.has_mcp_tool === 'boolean';
  const useBoolHasProfil = types.has_profil === 'boolean';
  const activeExpr = useBoolActive
    ? '(SELECT active_b FROM __vals)'
    : '(CASE WHEN (SELECT active_b FROM __vals) THEN 1 ELSE 0 END)';
  const installExpr = useBoolInstall
    ? '(SELECT install_b FROM __vals)'
    : '(CASE WHEN (SELECT install_b FROM __vals) THEN 1 ELSE 0 END)';
  const hasMcpExpr = useBoolHasMcp
    ? '(SELECT has_mcp_b FROM __vals)'
    : '(CASE WHEN (SELECT has_mcp_b FROM __vals) THEN 1 ELSE 0 END)';
  const hasProfilExpr = useBoolHasProfil
    ? '(SELECT has_profil_b FROM __vals)'
    : '(CASE WHEN (SELECT has_profil_b FROM __vals) THEN 1 ELSE 0 END)';
  const installedAtInsert = `CASE WHEN (SELECT install_b FROM __vals) THEN NOW() ELSE NULL END`;
  const installedAtUpdate = useBoolInstall
    ? `CASE
         WHEN ${MODULES_TABLE}.install = FALSE AND EXCLUDED.install = TRUE THEN NOW()
         WHEN EXCLUDED.install = FALSE THEN ${MODULES_TABLE}.installed_at
         ELSE COALESCE(${MODULES_TABLE}.installed_at, NOW())
       END`
    : `CASE
         WHEN ${MODULES_TABLE}.install = 0 AND EXCLUDED.install = 1 THEN NOW()
         WHEN EXCLUDED.install = 0 THEN ${MODULES_TABLE}.installed_at
         ELSE COALESCE(${MODULES_TABLE}.installed_at, NOW())
       END`;

  const sql = `
    WITH __vals AS (
      SELECT $3::boolean AS active_b,
             $4::boolean AS install_b,
             $5::boolean AS has_mcp_b,
             $6::boolean AS has_profil_b,
             $7::jsonb    AS mcp_tools_j
    )
    INSERT INTO ${MODULES_TABLE} (module_name, version, active, install, has_mcp_tool, has_profil, mcp_tools, installed_at, updated_at)
    VALUES ($1, $2, ${activeExpr}, ${installExpr}, ${hasMcpExpr}, ${hasProfilExpr}, (SELECT mcp_tools_j FROM __vals),
            ${installedAtInsert}, NOW())
    ON CONFLICT (module_name) DO UPDATE
      SET version = EXCLUDED.version,
          active = EXCLUDED.active,
          install = EXCLUDED.install,
          has_mcp_tool = EXCLUDED.has_mcp_tool,
          has_profil = EXCLUDED.has_profil,
          mcp_tools = EXCLUDED.mcp_tools,
          updated_at = NOW(),
          installed_at = ${installedAtUpdate}
    RETURNING id_module, module_name AS name, version, active, install`;

  const upsert = await modulePool.query(sql, params);
  const row = upsert.rows[0];
  return {
    ...row,
    active: toBool(row?.active),
    install: toBool(row?.install),
  };
}

async function seedModulesAndFetch(catalog, state, logToFile) {
  if (!modulePool) return new Map();
  await ensureModulesTable();
  const existingMap = await fetchModulesFromDb();

  const desired = [];
  for (const item of catalog || []) {
    try {
      // Only keep entries that have a manifest/module folder on disk
      const paths = [];
      if (Array.isArray(item.moduleDirs)) paths.push(...item.moduleDirs);
      if (Array.isArray(item.manifestPaths)) paths.push(...item.manifestPaths);
      const exists = paths.some(p => {
        try { return fs.existsSync(p); } catch { return false; }
      });
      if (!exists) continue;
      desired.push({
        name: item.id,
        version: item.version || "1.0.0",
        active: item.defaultActive || false,
        install: item.defaultInstalled || false,
        hasMcpTool: !!item.hasMcpTool,
        hasProfil: !!item.hasProfil,
        mcpTools: Array.isArray(item.mcpTools) ? item.mcpTools : null,
        defaultVersion: item.version || "1.0.0",
      });
    } catch {}
  }
  // NOTE: We intentionally do NOT seed custom-only entries into the DB.
  // Policy: keep DB rows only for modules that have a current manifest on disk.
  // Custom entries remain visible in UI, but won't get rows in the 'modules' table.

  for (const entry of desired) {
    if (!entry.name || existingMap.has(entry.name)) continue;
    try {
      const row = await setDbModuleState(entry.name, {
        version: entry.version,
        active: entry.active,
        install: entry.install,
        hasMcpTool: !!entry.hasMcpTool,
        hasProfil: !!entry.hasProfil,
        mcpTools: entry.mcpTools || null,
        defaultVersion: entry.defaultVersion,
      });
      if (row) existingMap.set(entry.name, row);
      logToFile?.(`🗃️ module db seeded ${entry.name}`);
    } catch (err) {
      logToFile?.(`⚠️ module db seed failed ${entry.name}: ${err.message}`);
    }
  }
  // Prune DB rows for modules that are no longer present in manifests/custom state
  try {
    const desiredSet = new Set(desired.map(d => d.name));
    const toDelete = [];
    for (const name of existingMap.keys()) {
      if (!desiredSet.has(name)) toDelete.push(name);
    }
    if (toDelete.length) {
      const params = [toDelete];
      await modulePool.query(`DELETE FROM ${MODULES_TABLE} WHERE module_name = ANY($1)`, params);
      for (const name of toDelete) existingMap.delete(name);
      logToFile?.(`🧹 module db pruned ${toDelete.length} row(s): ${JSON.stringify(toDelete)}`);
    }
  } catch (err) {
    logToFile?.(`⚠️ module db prune failed: ${err?.message || err}`);
  }

  try {
    for (const entry of desired) {
      const row = existingMap.get(entry.name);
      if (!row) continue;
      const wantHasMcp = !!entry.hasMcpTool;
      const wantHasProfil = !!entry.hasProfil;
      const wantTools = entry.mcpTools || null;
      const curHasMcp = toBool(row.has_mcp_tool);
      const curHasProfil = toBool(row.has_profil);
      const curTools = row.mcp_tools || null;
      const diffTools = JSON.stringify(wantTools) !== JSON.stringify(curTools);
      if (wantHasMcp !== curHasMcp || wantHasProfil !== curHasProfil || diffTools) {
        await setDbModuleState(entry.name, {
          version: row.version || entry.version,
          active: row.active,
          install: row.install,
          hasMcpTool: wantHasMcp,
          hasProfil: wantHasProfil,
          mcpTools: wantTools,
          defaultVersion: entry.defaultVersion,
        });
        logToFile?.(`??? module db caps refreshed ${entry.name}`);
      }
    }
  } catch (e) {
    logToFile?.(`?? module db caps refresh failed: ${e?.message || e}`);
  }

  return existingMap;
}

function normaliseState(raw) {
  if (!raw) {
    return { overrides: {}, custom: [] };
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      overrides: parsed?.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
      custom: Array.isArray(parsed?.custom) ? parsed.custom.filter((m) => m && m.id) : [],
    };
  } catch {
    return { overrides: {}, custom: [] };
  }
}

function buildResponse(state, logToFile, dbState = new Map()) {
  const catalog = getCatalog(logToFile);
  const { overrides, custom } = state;
  const now = new Date().toISOString();
  const defaults = catalog.map((item) => {
    const override = overrides[item.id] || {};
    const dbRow = dbState.get(item.id);
    const installed = dbRow ? dbRow.install : override.installed ?? item.defaultInstalled ?? false;
    const active = dbRow ? dbRow.active : override.active ?? item.defaultActive ?? false;
    const version = dbRow?.version || override.version || item.version || null;
    const entry = {
      ...item,
      source: item.source || "builtin",
      installed,
      active,
      version,
      hasMcpTool: !!item.hasMcpTool,
      hasProfil: !!item.hasProfil,
      installedAt: override.installedAt || null,
      updatedAt: override.updatedAt || override.installedAt || null,
      lastActionAt: override.lastActionAt || override.updatedAt || override.installedAt || null,
    };
    if (item.paths) entry.paths = item.paths;
    const baseDb = item.database || null;
    if (baseDb || dbRow) {
      const record = {
        ...(baseDb?.record || {}),
        name: dbRow?.name || baseDb?.record?.name || item.id,
        version,
        active,
        install: installed,
      };
      entry.database = {
        ...(baseDb || {}),
        table: baseDb?.table || MODULES_TABLE,
        id_module: dbRow?.id_module ?? baseDb?.id_module ?? null,
        record,
      };
    }
    try {
      if (dbRow && Object.prototype.hasOwnProperty.call(dbRow, 'has_mcp_tool')) entry.hasMcpTool = toBool(dbRow.has_mcp_tool);
      if (dbRow && Object.prototype.hasOwnProperty.call(dbRow, 'has_profil')) entry.hasProfil = toBool(dbRow.has_profil);
      if (dbRow && Object.prototype.hasOwnProperty.call(dbRow, 'schema_ok')) entry.schemaOk = toBool(dbRow.schema_ok);
      if (dbRow && Object.prototype.hasOwnProperty.call(dbRow, 'install_error')) entry.installError = dbRow.install_error || null;
    } catch {}
    return entry;
  });
  // De-duplicate: if a custom entry uses an id that also exists in the catalog,
  // prefer the catalog/default entry and drop the custom duplicate from the list.
  const defaultIds = new Set(defaults.map((m) => m.id));
  const customModules = custom
    .filter((item) => item && item.id && !defaultIds.has(item.id))
    .map((item) => {
      const dbRow = dbState.get(item.id);
      const installed = dbRow?.install ?? item.installed ?? true;
      const active = dbRow?.active ?? item.active ?? false;
      const version = dbRow?.version || item.version || null;
      const baseDb = item.database || null;
    let database = baseDb;
    if (baseDb || dbRow) {
      const record = {
        ...(baseDb?.record || {}),
        name: dbRow?.name || baseDb?.record?.name || item.id,
        version,
        active,
        install: installed,
      };
      database = {
        ...(baseDb || {}),
        table: baseDb?.table || MODULES_TABLE,
        id_module: dbRow?.id_module ?? baseDb?.id_module ?? null,
        record,
      };
    }
      return {
        ...item,
        source: item.source || "custom",
        installed,
        active,
        version,
        installedAt: item.installedAt || item.createdAt || now,
        updatedAt: item.updatedAt || null,
        lastActionAt: item.lastActionAt || item.updatedAt || item.installedAt || null,
        database,
      };
    });
  return [...defaults, ...customModules];
}

export function createModuleManager({ app, requireAdmin, getSetting, setSetting, logToFile, pool }) {
  if (!app) throw new Error("createModuleManager requires an express app");
  if (typeof requireAdmin !== "function") throw new Error("createModuleManager requires requireAdmin");
  modulePool = pool || null;
  if (!modulePool) {
    logToFile?.("⚠️ Module manager running without DB pool; database synchronization disabled");
  }
  // Sidebar tree must be generated strictly from mod_module_manager_sidebar_entries.
  // No server-side cache/fallback (avoid stale menus).
  const getCachedSidebarTree = () => null;
  const setCachedSidebarTree = () => {};
  let cache = null;

  const loadState = async () => {
    if (cache) return cache;
    const raw = await getSetting(MODULES_SETTING_KEY);
    cache = normaliseState(raw);
    return cache;
  };

  const saveState = async (next) => {
    cache = normaliseState(next);
    await setSetting(MODULES_SETTING_KEY, JSON.stringify(cache));
    return cache;
  };

  const upsertOverride = (state, moduleId, updater) => {
    const overrides = { ...state.overrides };
    const current = overrides[moduleId] || {};
    overrides[moduleId] = updater({ ...current });
    return { ...state, overrides };
  };

  const upsertCustom = (state, moduleId, updater) => {
    const list = [...state.custom];
    const idx = list.findIndex((m) => m.id === moduleId);
    const existing = idx >= 0 ? { ...list[idx] } : { id: moduleId };
    const next = updater(existing);
    if (!next || !next.id) {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      list[idx] = next;
    } else {
      list.push(next);
    }
    return { ...state, custom: list };
  };

  const ensureAdmin = (req, res) => {
    try {
      if (typeof requireAdmin === 'function') return !!requireAdmin(req, res);
    } catch {}
    try { res.status(401).json({ error: 'unauthorized' }); } catch {}
    return false;
  };

  async function listIndexFirstColumns(tableName) {
    try {
      if (!modulePool) return [];
      const r = await modulePool.query(
        `
        SELECT
          i.relname AS indexname,
          (array_agg(a.attname ORDER BY x.ordinality))[1] AS first_col
        FROM pg_index idx
        JOIN pg_class t ON t.oid = idx.indrelid
        JOIN pg_namespace ns ON ns.oid = t.relnamespace
        JOIN pg_class i ON i.oid = idx.indexrelid
        JOIN unnest(idx.indkey) WITH ORDINALITY AS x(attnum, ordinality) ON true
        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
        WHERE ns.nspname = current_schema()
          AND t.relname = $1
        GROUP BY i.relname
        `,
        [String(tableName || '')]
      );
      return (r.rows || [])
        .map((row) => ({ indexname: row.indexname, first_col: row.first_col }))
        .filter((x) => x && x.indexname && x.first_col);
    } catch {
      return [];
    }
  }

  function guessFirstColumnFromIndexName(indexName) {
    const n = String(indexName || '').toLowerCase();
    if (/_org(\b|_)/.test(n)) return 'org_id';
    if (/_server(\b|_)/.test(n)) return 'server_id';
    if (/_tool(\b|_)/.test(n)) return 'tool_id';
    if (/_type(\b|_)/.test(n)) return 'type_id';
    if (/_kind(\b|_)/.test(n)) return 'kind_id';
    return null;
  }

  // Helper: toggle module.config.json enabled flag for a module if runtime config exists
  function setModuleConfigEnabled(modId, enabledFlag) {
    try {
      const modulesRoot = path.resolve(__dirname, "../../../modules");
      const modDir = path.join(modulesRoot, modId);
      const cfgPath = path.join(modDir, 'module.config.json');
      if (!fs.existsSync(cfgPath)) return false;
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { cfg = {}; }
      const next = { ...cfg, enabled: !!enabledFlag };
      // Keep ordering stable: name, version, enabled, hooks, then rest
      const ordered = {};
      const keys = ['name','version','enabled','hooks'];
      for (const k of keys) { if (next[k] !== undefined) ordered[k] = next[k]; }
      for (const k of Object.keys(next)) { if (!(k in ordered)) ordered[k] = next[k]; }
      fs.writeFileSync(cfgPath, JSON.stringify(ordered, null, 2));
      return true;
    } catch { return false; }
  }

  app.get("/api/modules", async (req, res) => {
    if (typeof requireAdmin === 'function') { if (!requireAdmin(req, res)) return; }
    try {
      const state = await loadState();
      const catalog = getCatalog(logToFile);
      const dbState = await seedModulesAndFetch(catalog, state, logToFile);
      const modules = buildResponse(state, logToFile, dbState);
      const logSnapshot = modules.map((m) => ({
        id: m.id,
        installed: !!m.installed,
        active: !!m.active,
        source: m.source || "custom",
        version: m.version || null,
        locations: Array.isArray(m.locations) ? m.locations : undefined,
        db: m.database?.record || undefined,
      }));
      logToFile?.(`📦 modules:list ${JSON.stringify(logSnapshot)}`);
      res.json({ ok: true, modules });
    } catch (e) {
      logToFile?.(`❌ modules:list failed: ${e.message}`);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.post("/api/modules/install", async (req, res) => {
    if (typeof requireAdmin === 'function') { if (!requireAdmin(req, res)) return; }
    try {
      const body = req.body || {};
      const moduleId = String(body.id || "").trim();
      if (!moduleId) {
        return res.status(400).json({ ok: false, error: "invalid_module" });
      }
      const now = new Date().toISOString();
      let state = await loadState();
      const catalog = getCatalog(logToFile);
      const manifest = catalog.find((m) => m.id === moduleId) || null;
      const isCatalogModule = !!manifest;
      const overrideCurrent = state.overrides?.[moduleId] || {};
      const customCurrent = (state.custom || []).find((m) => m.id === moduleId) || {};

      let targetActive =
        typeof body.active === "boolean"
          ? body.active
          : isCatalogModule
          ? overrideCurrent.active ?? manifest?.defaultActive ?? false
          : customCurrent.active ?? false;
      let targetVersion = body.version || null;
      if (!targetVersion) {
        targetVersion =
          overrideCurrent.version || customCurrent.version || manifest?.version || null;
      }

      if (isCatalogModule) {
        state = upsertOverride(state, moduleId, (current) => ({
          ...current,
          installed: true,
          active: targetActive,
          version: targetVersion,
          installedAt: current.installedAt || now,
          updatedAt: now,
        }));
      } else {
        state = upsertCustom(state, moduleId, (existing) => ({
          ...existing,
          id: moduleId,
          name: String(body.name || existing.name || moduleId).trim(),
          description: String(body.description || existing.description || "").trim(),
          url: String(body.url || existing.url || "").trim() || null,
          category: String(body.category || existing.category || "custom").trim() || "custom",
          source: "custom",
          version: targetVersion,
          installed: true,
          active: targetActive,
          installedAt: existing.installedAt || now,
          updatedAt: now,
        }));
      }

      const saved = await saveState(state);
      const finalVersion =
        targetVersion || manifest?.version || overrideCurrent.version || customCurrent.version || "1.0.0";
      await setDbModuleState(moduleId, {
        install: true,
        active: targetActive,
        version: finalVersion,
        defaultVersion: manifest?.version || finalVersion,
      });

      // Auto-run installer after install so module SQL migrations apply immediately.
      // This is best-effort and times out to keep the API responsive.
      let installer = { ok: false, skipped: true };
      try {
        const modulesRoot = path.resolve(__dirname, "../../../modules");
        const installerJs = path.join(modulesRoot, moduleId, "backend", "installer.js");
        if (fs.existsSync(installerJs)) {
          installer = await new Promise((resolve) => {
            let output = "";
            try {
              const child = spawn(process.execPath, [installerJs], { cwd: modulesRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
              const timeoutMs = Number(process.env.MODULE_INSTALL_TIMEOUT_MS || 45000);
              const t = setTimeout(() => {
                try { output += `\n[timeout] installer exceeded ${timeoutMs}ms\n`; } catch {}
                try { child.kill("SIGKILL"); } catch {}
                resolve({ ok: false, error: "installer_timeout", output: output.slice(-4000) });
              }, timeoutMs);
              child.stdout.on("data", (d) => { try { output += d.toString(); } catch {} });
              child.stderr.on("data", (d) => { try { output += d.toString(); } catch {} });
              child.on("error", (e) => { clearTimeout(t); resolve({ ok: false, error: "installer_error", message: e?.message || String(e), output: output.slice(-4000) }); });
              child.on("exit", (code) => { clearTimeout(t); resolve({ ok: code === 0, exit_code: code, output: output.slice(-4000) }); });
            } catch (e) {
              resolve({ ok: false, error: "installer_spawn_failed", message: e?.message || String(e), output: output.slice(-4000) });
            }
          });
        }
      } catch {}
      const dbState = await fetchModulesFromDb();
      res.json({ ok: true, installer, modules: buildResponse(saved, logToFile, dbState) });
    } catch (e) {
      logToFile?.(`❌ modules:install failed: ${e.message}`);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // Admin maintenance: normalize sidebar hashes to canonical form
  // - '#modules...'            -> '#/modules...'
  // - '#/modules/<id>[/...]'   -> '#/<id>[/...]'
  // - '#foo'                   -> '#/foo'
  // - '#//foo'                 -> '#/foo'
  // - '/foo'                   -> '#/foo'
  // - 'foo' (no scheme)        -> '#/foo'
  // - trim leading/trailing spaces; remove spaces right after '#/'
  // - set type='module' for hashes that are now internal ('#/...')
  app.post('/api/sidebar/normalize-hashes', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      await ensureSidebarTable();
      const steps = [];
      let total = 0;
      const run = async (description, sql) => {
        const r = await modulePool.query(sql);
        const n = r.rowCount || 0;
        total += n; steps.push({ description, updated: n });
      };
      // 0) trim
      await run('trim_whitespace', `UPDATE mod_module_manager_sidebar_entries SET hash = BTRIM(hash) WHERE hash IS NOT NULL AND hash <> BTRIM(hash)`);
      // 1) '#modules' -> '#/modules'
      await run('prefix_missing_slash_for_modules', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#modules', '#/modules') WHERE hash ~ '^#modules'`);
      // 2) '#/modules/<id>...' -> '#/<id>...'
      await run('demote_modules_prefix', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#/modules/([^/]+)(.*)$', '#/\\1\\2') WHERE hash ~ '^#/?modules/'`);
      // 3) ensure '#/' when hash starts with '#' but not '#/'
      await run('ensure_hash_slash_prefix', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#(?!/)', '#/') WHERE hash ~ '^#(?!/)'`);
      // 4) collapse duplicate slashes after '#/'
      await run('collapse_double_slashes', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#//+', '#/') WHERE hash ~ '^#//+'`);
      // 5) remove spaces right after '#/'
      await run('strip_space_after_hash', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#/\\s+', '#/') WHERE hash ~ '^#/\\s+'`);
      // 6) leading '/' -> '#/<...>'
      await run('leading_slash_to_hash', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^/(.*)$', '#/\\1') WHERE hash ~ '^/'`);
      // 7) plain 'foo' (no scheme, not starting with '#') -> '#/foo'
      await run('bare_word_to_hash', `UPDATE mod_module_manager_sidebar_entries SET hash = '#/' || hash WHERE COALESCE(hash,'') <> '' AND hash !~ '^#' AND hash !~ '^[[:alpha:]][[:alnum:]+.-]*://'`);
      // 8) set type to 'module' for internal hashes
      await run('set_type_module_for_internal', `UPDATE mod_module_manager_sidebar_entries SET type='module' WHERE COALESCE(type,'') <> 'module' AND hash ~ '^#/'`);

      res.json({ ok: true, totalUpdated: total, steps });
    } catch (e) {
      logToFile?.(`[sidebar] normalize-hashes failed: ${e?.message || e}`);
      res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Admin: one-click cleanup for sidebar entries
  // - Optional backup to mod_mm_sidebar_backup (schema-like copy)
  // - Normalize hashes (including '/#/' -> '#/')
  // - Remove junk (non '#/' and not a URL)
  // - Prune duplicates keeping most recent per (org_id,level,parent,entry_id)
  // - Optionally detach all
  // - Optionally attach a minimal baseline at root (e.g., ['module-manager','agents','logs2'])
  app.post('/api/module-manager/sidebar/cleanup', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      await ensureSidebarTable();
      const body = req.body || {};
      const doBackup = body.backup !== false; // default true
      const detachAll = body.detachAll !== false; // default true
      const baseline = Array.isArray(body.baseline) ? body.baseline.map((s) => String(s).trim()).filter(Boolean) : [];

      const steps = [];
      // Use a single connection + transaction to avoid pool reconnection overhead
      const client = await modulePool.connect();
      const run = async (description, sql, params = []) => {
        const r = await client.query(sql, params);
        const n = r && r.rowCount ? r.rowCount : 0;
        steps.push({ description, updated: n });
        return n;
      };

      let backupRows = 0;
      try {
        await client.query('BEGIN');
        // Increase statement timeout locally for this session (20s)
        try { await client.query("SET LOCAL statement_timeout TO '20s'"); } catch {}
        if (doBackup) {
          try {
            await client.query(`CREATE TABLE IF NOT EXISTS mod_mm_sidebar_backup (LIKE mod_module_manager_sidebar_entries INCLUDING ALL)`);
          } catch {}
          const r = await client.query(`INSERT INTO mod_mm_sidebar_backup SELECT * FROM mod_module_manager_sidebar_entries`);
          backupRows = r && r.rowCount ? r.rowCount : 0;
        }

      // Normalizations (superset of /api/sidebar/normalize-hashes)
      await run('trim_whitespace', `UPDATE mod_module_manager_sidebar_entries SET hash = BTRIM(hash) WHERE hash IS NOT NULL AND hash <> BTRIM(hash)`);
      await run('fix_slash_hash_combo', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^/?#/?', '#/') WHERE hash ~ '^/?#/?' AND hash !~ '^#/'`);
      await run('prefix_missing_slash_for_modules', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#modules', '#/modules') WHERE hash ~ '^#modules'`);
      await run('demote_modules_prefix', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#/modules/([^/]+)(.*)$', '#/\\1\\2') WHERE hash ~ '^#/?modules/'`);
      await run('ensure_hash_slash_prefix', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#(?!/)', '#/') WHERE hash ~ '^#(?!/)'`);
      await run('collapse_double_slashes', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#//+', '#/') WHERE hash ~ '^#//+'`);
      await run('strip_space_after_hash', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^#/\\s+', '#/') WHERE hash ~ '^#/\\s+'`);
      await run('leading_slash_to_hash', `UPDATE mod_module_manager_sidebar_entries SET hash = REGEXP_REPLACE(hash, '^/(.*)$', '#/\\1') WHERE hash ~ '^/'`);
      await run('bare_word_to_hash', `UPDATE mod_module_manager_sidebar_entries SET hash = '#/' || hash WHERE COALESCE(hash,'') <> '' AND hash !~ '^#' AND hash !~ '^[[:alpha:]][[:alnum:]+.-]*://'`);
      await run('set_type_module_for_internal', `UPDATE mod_module_manager_sidebar_entries SET type='module' WHERE COALESCE(type,'') <> 'module' AND hash ~ '^#/'`);

      // Remove obvious junk: non-empty, not starting '#/' and not a URL
      const removedJunk = await run('remove_junk_non_internal', `DELETE FROM mod_module_manager_sidebar_entries WHERE COALESCE(hash,'') <> '' AND hash !~ '^#/' AND hash !~ '^[[:alpha:]][[:alnum:]+.-]*://'`);

      // Prune duplicates (keep most recent per composite key)
      await client.query(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(org_id,''), level, COALESCE(parent_entry_id,''), entry_id
                   ORDER BY updated_at DESC, id DESC
                 ) AS rn
          FROM mod_module_manager_sidebar_entries
        )
        DELETE FROM mod_module_manager_sidebar_entries s USING ranked r
        WHERE s.id = r.id AND r.rn > 1
      `);
      steps.push({ description: 'pruned_duplicates', updated: null });

      let detached = 0;
      if (detachAll) {
        const r = await client.query(`UPDATE mod_module_manager_sidebar_entries SET attached=FALSE WHERE attached IS DISTINCT FROM FALSE`);
        detached = r && r.rowCount ? r.rowCount : 0;
      }

      const attachedBaseline = [];
      if (baseline && baseline.length) {
        const catalog = getCatalog(logToFile) || [];
        const byId = new Map(catalog.map((m) => [String(m.id), m]));
        let pos = 0;
        for (const id of baseline) {
          const manifest = byId.get(id) || null;
          const label = manifest?.name || id;
          // Upsert row at root, attached
          try {
            const entry = await upsertSidebarEntry({ entry_id: `mod-${id}`, label, hash: `#/${id}`, icon: null, logo: null, org_id: null, attached: true, type: 'module' });
            if (entry && entry.entry_id) {
              await client.query(`UPDATE mod_module_manager_sidebar_entries SET attached=TRUE, level=0, parent_entry_id=NULL, position=$2, updated_at=NOW() WHERE entry_id=$1`, [entry.entry_id, pos++]);
              attachedBaseline.push(entry.entry_id);
            }
          } catch (e) {
            try { logToFile?.(`[sidebar] baseline attach '${id}' failed: ${e?.message || e}`); } catch {}
          }
        }
      }
        await client.query('COMMIT');
        res.json({ ok: true, backupRows, steps, removedJunk, detached, attachedBaseline });
      } catch (e) {
        try { await (client && client.query('ROLLBACK')); } catch {}
        throw e;
      } finally {
        try { client && client.release(); } catch {}
      }
    } catch (e) {
      logToFile?.(`[sidebar] cleanup error: ${e?.message || e}`);
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.post("/api/modules/uninstall", async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      let moduleId = String(req.body?.id || '').trim();
      if (!moduleId) moduleId = String(req.body?.module_name || req.body?.name || req.body?.module || req.body?.slug || '').trim();
      if (!moduleId) return res.status(400).json({ ok: false, error: "invalid_module" });
      let state = await loadState();
      const now = new Date().toISOString();
      const catalog = getCatalog(logToFile);
      const manifest = catalog.find((m) => m.id === moduleId) || null;
      const isCatalogModule = !!manifest;
      if (isCatalogModule) {
        state = upsertOverride(state, moduleId, (current) => ({
          ...current,
          installed: false,
          active: false,
          updatedAt: now,
        }));
      } else {
        state = upsertCustom(state, moduleId, () => null);
      }
      const saved = await saveState(state);
      await setDbModuleState(moduleId, {
        install: false,
        active: false,
        version: manifest?.version,
        defaultVersion: manifest?.version,
      });
      // Also flip runtime module.config.json to disabled so loader skips it even before DB check
      try { setModuleConfigEnabled(moduleId, false); } catch {}
      const dbState = await fetchModulesFromDb();
      res.json({ ok: true, modules: buildResponse(saved, logToFile, dbState) });
    } catch (e) {
      logToFile?.(`❌ modules:uninstall failed: ${e.message}`);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.post("/api/modules/activate", async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      let moduleId = String(req.body?.id || '').trim();
      if (!moduleId) moduleId = String(req.body?.module_name || req.body?.name || req.body?.module || req.body?.slug || '').trim();
      if (!moduleId) return res.status(400).json({ ok: false, error: "invalid_module" });
      let state = await loadState();
      const now = new Date().toISOString();
      const catalog = getCatalog(logToFile);
      const manifest = catalog.find((m) => m.id === moduleId) || null;
      const isCatalogModule = !!manifest;
      const overrideCurrent = state.overrides?.[moduleId] || {};
      const customCurrent = (state.custom || []).find((m) => m.id === moduleId) || {};
      const targetVersion =
        overrideCurrent.version || customCurrent.version || manifest?.version || null;

      if (isCatalogModule) {
        state = upsertOverride(state, moduleId, (current) => ({
          ...current,
          installed: true,
          active: true,
          installedAt: current.installedAt || now,
          updatedAt: now,
          lastActionAt: now,
        }));
      } else {
        state = upsertCustom(state, moduleId, (existing) => ({
          ...existing,
          installed: true,
          active: true,
          installedAt: existing.installedAt || now,
          updatedAt: now,
          lastActionAt: now,
        }));
      }
      const saved = await saveState(state);
      await setDbModuleState(moduleId, {
        install: true,
        active: true,
        version: targetVersion,
        defaultVersion: manifest?.version || targetVersion,
        hasMcpTool: !!(manifest && manifest.hasMcpTool),
        hasProfil: !!(manifest && manifest.hasProfil),
        mcpTools: Array.isArray(manifest && manifest.mcpTools) ? manifest.mcpTools : null,
      });
      const dbState = await fetchModulesFromDb();
      // Keep runtime config aligned
      try { setModuleConfigEnabled(moduleId, true); } catch {}
      res.json({ ok: true, modules: buildResponse(saved, logToFile, dbState) });
    } catch (e) {
      logToFile?.(`❌ modules:activate failed: ${e.message}`);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.post("/api/modules/deactivate", async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      let moduleId = String(req.body?.id || '').trim();
      if (!moduleId) moduleId = String(req.body?.module_name || req.body?.name || req.body?.module || req.body?.slug || '').trim();
      if (!moduleId) return res.status(400).json({ ok: false, error: "invalid_module" });
      let state = await loadState();
      const now = new Date().toISOString();
      const catalog = getCatalog(logToFile);
      const manifest = catalog.find((m) => m.id === moduleId) || null;
      const isCatalogModule = !!manifest;
      if (isCatalogModule) {
        state = upsertOverride(state, moduleId, (current) => ({
          ...current,
          active: false,
          updatedAt: now,
          lastActionAt: now,
        }));
      } else {
        state = upsertCustom(state, moduleId, (existing) => ({
          ...existing,
          active: false,
          updatedAt: now,
          lastActionAt: now,
        }));
      }
      const saved = await saveState(state);
      await setDbModuleState(moduleId, {
        active: false,
        defaultVersion: manifest?.version,
        hasMcpTool: !!(manifest && manifest.hasMcpTool),
        hasProfil: !!(manifest && manifest.hasProfil),
        mcpTools: Array.isArray(manifest && manifest.mcpTools) ? manifest.mcpTools : null,
      });
      const dbState = await fetchModulesFromDb();
      // Keep runtime config aligned
      try { setModuleConfigEnabled(moduleId, false); } catch {}
      res.json({ ok: true, modules: buildResponse(saved, logToFile, dbState) });
    } catch (e) {
      logToFile?.(`❌ modules:deactivate failed: ${e.message}`);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.post("/api/modules/refresh", async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      cache = null;
      resetCatalogCache();
      const state = await loadState();
      const catalog = getCatalog(logToFile);
      const dbState = await seedModulesAndFetch(catalog, state, logToFile);
      res.json({ ok: true, modules: buildResponse(state, logToFile, dbState) });
    } catch (e) {
      logToFile?.(`❌ modules:refresh failed: ${e.message}`);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // Allow modules to report their schema status (visible in UI)
  app.post('/api/modules/status', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const b = req.body || {};
      const id = String(b.id||'').trim();
      if (!id) return res.status(400).json({ ok:false, error:'invalid_module' });
      await ensureModulesTable();
      try { await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS schema_ok BOOLEAN NULL`); } catch {}
      try { await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS install_error TEXT NULL`); } catch {}
      const okVal = (b.schema_ok == null) ? null : !!b.schema_ok;
      const errText = (b.install_error == null || b.install_error === '') ? null : String(b.install_error).slice(0, 2000);
      await modulePool.query(
        `UPDATE ${MODULES_TABLE} SET schema_ok = $1, install_error = $2, updated_at = NOW() WHERE module_name = $3`,
        [okVal, errText, id]
      );
      return res.json({ ok:true });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message||e) });
    }
  });

  // Schema report: inspect module migrations and verify presence
  app.get('/api/modules/:id/schema-report', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const id = String(req.params.id||'').trim();
      if (!id) return res.status(400).json({ ok:false, error:'invalid_module' });
      await ensureModulesTable();
      const rowRes = await modulePool.query(`SELECT schema_ok, install_error, version, active, install FROM ${MODULES_TABLE} WHERE module_name=$1 LIMIT 1`, [id]);
      const meta = rowRes.rowCount ? rowRes.rows[0] : {};

      // Discover expected objects (tables/indexes) from migrations
      const fsMod = await import('fs');
      const pathMod = await import('path');
      const fs = fsMod.default || fsMod;
      const path = pathMod.default || pathMod;
      const roots = [];
      try { roots.push(path.resolve(__dirname, `../../../modules/${id}/db/migrations`)); } catch {}
      const files = [];
      for (const dir of roots) { try { if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.sql')) files.push(path.join(dir, f)); } catch {} }
      const expects = { tables: new Set(), indexes: [] };
      const readSql = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
      const norm = (n) => String(n||'').replace(/^"|"$/g,'');
      const isEphemeralTable = (t) => {
        const s = String(t || '');
        return /__new\b/i.test(s) || /__tmp\b/i.test(s) || /__temp\b/i.test(s);
      };
      for (const f of files) {
        const sql = readSql(f);
        if (!sql) continue;
        // Tables
        const reTab = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_\.\"-]+)/ig;
        let m;
        while ((m = reTab.exec(sql))) {
          const t = norm(m[1]);
          if (!isEphemeralTable(t)) expects.tables.add(t);
        }
        // Indexes
        const reIdx = /CREATE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_\.\"-]+)\s+ON\s+([A-Za-z0-9_\.\"-]+)/ig;
        let k;
        while ((k = reIdx.exec(sql))) {
          const idxName = norm(k[1]);
          const idxTable = norm(k[2]);
          if (isEphemeralTable(idxTable)) continue;
          expects.indexes.push({ name: idxName, table: idxTable });
        }
      }
      // Treat archive tables as optional — do not require them to exist
      try {
        let filtered = Array.from(expects.tables).filter((t) => {
          const name = String(t || '').replace(/^public\./,'').replace(/^"|"$/g,'');
          if (name.startsWith('_archive_')) return false;
          if (name === '_archive_mod_grabbing_jerome_table_settings') return false;
          return true;
        });
        // Grabbing-Sensorex: drop legacy unified tables from expectations
        if (id === 'grabbing-sensorex') {
          filtered = filtered.filter((t) => {
            const bare = String(t || '').replace(/^public\./,'').replace(/^"|"$/g,'');
            return bare !== 'mod_grabbing_sensorex_domain_type_config' && bare !== 'mod_grabbing_sensorex_domain_type_config_hist';
          });
          // Also drop the history index for the legacy table from expected indexes
          try {
            expects.indexes = (expects.indexes || []).filter((x) => String(x?.name) !== 'mod_gs_dt_cfg_hist_key_idx');
          } catch {}
        }
        // Tools module: legacy email template tables were dropped but migrations still reference them.
        if (id === 'tools') {
          const legacyTables = new Set([
            'mod_tools_email_subject_translations',
            'mod_tools_email_template_sources',
            'mod_tools_email_template_types',
          ]);
          filtered = filtered.filter((t) => {
            const bare = String(t || '').trim().replace(/^public\./,'').replace(/^"|"$/g,'');
            return !legacyTables.has(bare);
          });
          const legacyIndexes = new Set([
            'idx_mod_tools_email_subject_translations_org',
            'idx_mod_tools_email_subject_translations_lang',
            'idx_mod_tools_email_template_sources_org',
            'idx_mod_tools_email_template_sources_profile',
            'idx_mod_tools_email_template_types_org',
          ]);
          try {
            expects.indexes = (expects.indexes || []).filter((x) => !legacyIndexes.has(String(x?.name || '').trim()));
          } catch {}
        }
        expects.tables = new Set(filtered);
      } catch {}
      // De-dupe expected indexes (migrations often repeat CREATE INDEX guards)
      try {
        const seen = new Set();
        expects.indexes = (expects.indexes || []).filter((x) => {
          const key = `${String(x?.name||'')}@@${String(x?.table||'')}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } catch {}
      filterExpectedSchemaForModule(id, expects);
      const tables = Array.from(expects.tables);
      const results = [];
      for (const t of tables) {
        let exists = false; let columns = []; let idx = [];
        try {
          const r = await modulePool.query(`SELECT to_regclass($1) AS oid`, [t.includes('.')? t : `public.${t}`]);
          exists = !!(r.rows[0] && r.rows[0].oid);
        } catch {}
        try { if (exists) {
          const parts = t.split('.'); const name = parts.pop();
          const colRes = await modulePool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, [name]);
          columns = colRes.rows || [];
          const idxRes = await modulePool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1`, [name]);
          idx = (idxRes.rows||[]).map(r=>r.indexname);
        }} catch {}
        results.push({ name: t, exists, columns, indexes: idx });
      }
      const expectedIdx = expects.indexes.map(it => ({ ...it, exists: false }));
      try {
        for (const it of expectedIdx) {
          const parts = it.table.split('.'); const name = parts.pop();
          const r = await modulePool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2`, [name, it.name]);
          it.exists = !!(r.rowCount);
        }
      } catch {}

      const missingTables = results.filter(r => !r.exists).map(r => r.name);
      const missingIdx = expectedIdx.filter(x => !x.exists).map(x => `${x.name} ON ${x.table}`);
      const derivedOk = (missingTables.length===0 && missingIdx.length===0);
      // Auto-heal module DB flags when schema is OK
      try {
        await ensureModulesTable();
        await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS install_error TEXT NULL`);
        await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS schema_ok BOOLEAN NULL`);
        await modulePool.query(
          `UPDATE ${MODULES_TABLE} SET schema_ok=$1, install_error=$2, updated_at=NOW() WHERE module_name=$3`,
          [derivedOk, derivedOk ? null : (meta.install_error || null), id]
        );
      } catch {}

      // Report current computed schema status rather than stale DB meta
      const installErrOut = derivedOk ? null : (meta.install_error || null);
      return res.json({ ok:true, module: id, schema_ok: derivedOk, install_error: installErrOut, derived_ok: derivedOk, expected: { tables, indexes: expects.indexes }, present: { tables: results, missingTables, missingIndexes: missingIdx } });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message||e) });
    }
  });

  // Generate a new module from the module-template and optionally add a sidebar entry
  app.post("/api/modules/generate", async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const body = req.body || {};
    const toSlug = (s = "") => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'custom-module';
    try {
      const name = String(body.name || '').trim();
      const id = toSlug(String(body.id || name || ''));
      if (!name || !id) return res.status(400).json({ ok: false, error: 'invalid_name' });

      const modulesRoot = path.resolve(__dirname, '../../../modules');
      const templateDir = path.join(modulesRoot, 'module-template');
      const targetDir = path.join(modulesRoot, id);
      if (!fs.existsSync(templateDir)) return res.status(500).json({ ok: false, error: 'template_missing' });
      if (fs.existsSync(targetDir)) return res.status(400).json({ ok: false, error: 'already_exists' });

      const copyRecursive = (src, dest) => {
        const st = fs.statSync(src);
        if (st.isDirectory()) {
          fs.mkdirSync(dest, { recursive: true });
          for (const entry of fs.readdirSync(src)) {
            copyRecursive(path.join(src, entry), path.join(dest, entry));
          }
        } else if (st.isFile()) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      };

      copyRecursive(templateDir, targetDir);
      const manifestAdded = true;
      // Patch config files
      const cfgPath = path.join(targetDir, 'config.json');
      try {
        const cfgRaw = fs.readFileSync(cfgPath, 'utf8');
        const cfg = JSON.parse(cfgRaw);
        cfg.id = id;
        cfg.name = name;
        cfg.database = cfg.database || { table: MODULES_TABLE, record: {} };
        cfg.database.record = cfg.database.record || {};
        cfg.database.record.name = id;
        if (!cfg.category) cfg.category = String(body.category || 'custom');
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      } catch (e) {}

      const mcfgPath = path.join(targetDir, 'module.config.json');
      try {
        const mcfg = JSON.parse(fs.readFileSync(mcfgPath, 'utf8'));
        mcfg.name = id; // DB registration name should match slug
        mcfg.version = mcfg.version || '1.0.0';
        fs.writeFileSync(mcfgPath, JSON.stringify(mcfg, null, 2));
      } catch (e) {}

      // Ensure frontend has an index entrypoint for dynamic loader if missing
      try {
        const feDir = path.join(targetDir, 'frontend');
        const idxJs = path.join(feDir, 'index.js');
        const idxTsx = path.join(feDir, 'index.tsx');
        if (!fs.existsSync(idxJs) && !fs.existsSync(idxTsx)) {
          const pageTsx = path.join(feDir, 'pages', 'ExamplePage.tsx');
          const pageJsx = path.join(feDir, 'pages', 'ModuleTemplate.jsx');
          if (fs.existsSync(pageTsx)) {
            fs.writeFileSync(idxTsx, `export { default as Main } from "./pages/ExamplePage";\nexport { default as Settings } from "./pages/Settings";\n`);
          } else if (fs.existsSync(pageJsx)) {
            fs.writeFileSync(idxJs, `export { default as Main } from "./pages/ModuleTemplate.jsx";\nexport { default as Settings } from "./pages/Settings.jsx";\n`);
          }
        }
      } catch {}

      // Optionally add sidebar shortcut pointing to Module Manager deep-link
      try {
        // Prefer DB-managed sidebar entries; add a default icon per category
        await ensureSidebarTable();
        const cat = String(body.category || '').toLowerCase();
        const iconMap = {
          support: 'IconMessage',
          automation: 'IconCog',
          analytics: 'IconActivity',
          utilities: 'IconTools',
          tools: 'IconTools',
          admin: 'IconShield',
          dev: 'IconDev',
          integrations: 'IconLink',
          internal: 'IconStar',
        };
        const icon = iconMap[cat] || 'IconStar';
        await upsertSidebarEntry({ entry_id: `mod-${id}`, label: name, hash: `#/${id}`, icon });
      } catch {}

      // Reset manifest cache to include the new module's manifest
      try { resetCatalogCache(); } catch {}

      // Update backend modules state as installed+active (override for manifest-backed modules)
      let state = await loadState();
      const now = new Date().toISOString();
      if (manifestAdded) {
        state = upsertOverride(state, id, (current) => ({
          ...current,
          installed: true,
          active: true,
          version: '1.0.0',
          installedAt: current.installedAt || now,
          updatedAt: now,
          lastActionAt: now,
        }));
      } else {
        state = upsertCustom(state, id, (existing) => ({
          ...existing,
          id,
          name,
          description: String(body.description || existing.description || '').trim(),
          category: String(body.category || existing.category || 'custom').trim() || 'custom',
          source: 'custom',
          version: '1.0.0',
          installed: true,
          active: true,
          installedAt: existing.installedAt || now,
          updatedAt: now,
        }));
      }
      const saved = await saveState(state);
      await setDbModuleState(id, { install: true, active: true, version: '1.0.0', defaultVersion: '1.0.0' });

      // Auto-run installer to register hooks and run migrations
      const installerPath = path.resolve(__dirname, `../../../modules/${id}/backend/installer.js`);
      let installStatus = 'skipped';
      try {
        if (fs.existsSync(installerPath)) {
          installStatus = await new Promise((resolve) => {
            const child = spawn(process.execPath, [installerPath], { stdio: 'inherit' });
            child.on('exit', (code) => resolve(code === 0 ? 'ok' : `error:${code}`));
            child.on('error', () => resolve('error'));
          });
        } else {
          installStatus = 'missing';
        }
      } catch (e) {
        installStatus = 'error';
        logToFile?.(`❌ modules:generate installer failed ${id}: ${e?.message || e}`);
      }

      const dbState = await fetchModulesFromDb();
      res.json({ ok: true, id, installer: installStatus, modules: buildResponse(saved, logToFile, dbState) });
    } catch (e) {
      logToFile?.(`❌ modules:generate failed: ${e.message}`);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // --- Sidebar management (DB) ---
  async function ensureSidebarTable() {
    if (!modulePool) return;
    await modulePool.query(`
      CREATE TABLE IF NOT EXISTS mod_module_manager_sidebar_entries (
        id SERIAL PRIMARY KEY,
        org_id TEXT NULL,
        entry_id TEXT NOT NULL,
        label TEXT NOT NULL,
        hash TEXT NOT NULL,
        position INT NOT NULL DEFAULT 0,
        icon TEXT NULL,
        logo TEXT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Sequence to generate auto-incrementing entry_id suffixes
    try { await modulePool.query(`CREATE SEQUENCE IF NOT EXISTS sidebar_entry_id_seq START 1 INCREMENT 1`); } catch {}
    // Non-breaking additions for older installs
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS icon TEXT NULL`); } catch {}
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS logo TEXT NULL`); } catch {}
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS attached BOOLEAN NOT NULL DEFAULT TRUE`); } catch {}
    // Ensure 'type' column exists for distinguishing 'module' vs 'sous-menu'
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'module'`); } catch {}
    // Remove overly strict hash prefix constraint if present to allow custom links (external URLs)
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries DROP CONSTRAINT IF EXISTS chk_sidebar_hash_prefix`); } catch {}
    // Drop legacy unique indexes if present; hierarchy uses a composite key
    try { await modulePool.query(`DROP INDEX IF EXISTS uq_sidebar_org_entry`); } catch {}
    try { await modulePool.query(`DROP INDEX IF EXISTS uq_sidebar_hier`); } catch {}
    // seed positions for existing rows with null/zero positions
    try {
      await modulePool.query(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY id ASC) - 1 AS rn FROM mod_module_manager_sidebar_entries
        )
        UPDATE mod_module_manager_sidebar_entries se SET position = r.rn FROM ranked r WHERE se.id = r.id AND (se.position IS NULL OR se.position < 0);
      `);
    } catch {}
    // Hierarchy columns (non-breaking additions)
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS level SMALLINT NOT NULL DEFAULT 0`); } catch {}
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS parent_entry_id TEXT NULL`); } catch {}
    // Remove legacy single-column uniqueness if present to avoid conflicts with composite key
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries DROP CONSTRAINT IF EXISTS mod_mm_sidebar_entries_entry_id_key`); } catch {}
    // Safe duplicate cleanup before creating composite unique constraint
    try {
      await modulePool.query(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(org_id,''), level, COALESCE(parent_entry_id,''), entry_id
                   ORDER BY id
                 ) AS rn
          FROM mod_module_manager_sidebar_entries
        )
        DELETE FROM mod_module_manager_sidebar_entries s USING ranked r
        WHERE s.id = r.id AND r.rn > 1
      `);
    } catch {}
    // Prefer a true UNIQUE constraint on (org_id, level, parent_entry_id, entry_id) so ON CONFLICT can target it
    try { await modulePool.query(`ALTER TABLE mod_module_manager_sidebar_entries ADD CONSTRAINT uq_mod_mm_sidebar_hier_cols UNIQUE (org_id, level, parent_entry_id, entry_id)`); } catch {}
    // Normalize legacy rows: infer type from hash when it still has the default 'module'
    try { await modulePool.query(`UPDATE mod_module_manager_sidebar_entries SET type='sous-menu' WHERE COALESCE(type,'module')='module' AND (hash IS NULL OR hash = '')`); } catch {}
    try { await modulePool.query(`UPDATE mod_module_manager_sidebar_entries SET type='lien' WHERE COALESCE(type,'module')='module' AND hash IS NOT NULL AND hash <> '' AND LEFT(hash,2) <> '#/'`); } catch {}
    // Global sidebar namespace: migrate legacy org_id NULL rows into 'org_default'
    try {
      await modulePool.query(
        `
          DELETE FROM mod_module_manager_sidebar_entries s
          WHERE s.org_id IS NULL
            AND EXISTS (
              SELECT 1
                FROM mod_module_manager_sidebar_entries d
               WHERE d.org_id = 'org_default'
                 AND d.level = s.level
                 AND COALESCE(d.parent_entry_id,'') = COALESCE(s.parent_entry_id,'')
                 AND d.entry_id = s.entry_id
            )
        `
      );
    } catch {}
    try { await modulePool.query(`UPDATE mod_module_manager_sidebar_entries SET org_id='org_default' WHERE org_id IS NULL`); } catch {}
  }

  // Sidebar is now globally managed and identical for all users/orgs.
  // Force all sidebar operations to use the shared 'org_default' namespace.
  function pickOrgId(_req) {
    return 'org_default';
  }

  async function getSidebarEntries(req) {
    await ensureSidebarTable();
    const org = pickOrgId(req);
    const r = await modulePool.query(
      `SELECT entry_id, label, hash, position, icon, logo, active, org_id, attached, level, parent_entry_id, type
       FROM mod_module_manager_sidebar_entries
       WHERE active IS TRUE AND (
         ($1::text IS NULL AND org_id IS NULL)
         OR ($1::text IS NOT NULL AND org_id = $1::text)
       )
       ORDER BY position ASC, label ASC`,
      [org]
    );
    return r.rows || [];
  }

  async function genEntryId(prefix = 'entry') {
    try {
      const r = await modulePool.query(`SELECT nextval('sidebar_entry_id_seq') AS n`);
      const n = (r && r.rows && r.rows[0] && r.rows[0].n) ? String(r.rows[0].n) : String(Date.now());
      return `${prefix}-${n}`;
    } catch {
      return `${prefix}-${Date.now()}`;
    }
  }

  // Hierarchical helpers (level 0 = main sidebar; parent_entry_id null for root)
  async function getSidebarTree(req) {
    const org = pickOrgId(req);
    const lvl = Number(req?.query?.level ?? 0) | 0;
    const parent = req?.query?.parent_entry_id ? String(req.query.parent_entry_id) : null;

    await ensureSidebarTable();
    const r = await modulePool.query(
      `SELECT entry_id, label, hash, position, icon, logo, active, org_id, level, parent_entry_id, type, attached
       FROM mod_module_manager_sidebar_entries
       WHERE active IS TRUE
         AND attached IS TRUE
         AND ( (
               $1::text IS NULL AND org_id IS NULL
              ) OR (
              $1::text IS NOT NULL AND org_id = $1::text
              )
            )
         AND level = $2::smallint
         AND ( ($3::text IS NULL AND parent_entry_id IS NULL) OR ($3::text IS NOT NULL AND parent_entry_id = $3::text) )
       ORDER BY position ASC, label ASC`,
      [org, lvl, parent]
    );
    return r.rows || [];
  }

  async function getActiveModuleSet() {
    try {
      await ensureModulesTable();
      const set = new Set(['module-manager']);
      const r = await modulePool.query(`SELECT module_name, name, active FROM ${MODULES_TABLE}`);
      for (const row of r.rows || []) {
        const id = String(row.module_name || row.name || '').trim();
        const a = toBool(row.active);
        if (id && a) set.add(id);
      }
      return set;
    } catch {
      return new Set(['module-manager']);
    }
  }

  async function upsertSidebarTree({ entry_id, label, hash, icon, logo, org_id, level = 0, parent_entry_id = null, type = "module" }) {
    if (!modulePool) throw new Error('db_disabled');
    await ensureSidebarTable();
    if (!entry_id || String(entry_id).trim() === '') {
      const s = String(hash || '');
      const prefix = (/^#?\/(?:modules\/)?[^/]+/.test(s)) ? 'mod' : 'entry';
      entry_id = await genEntryId(prefix);
    }
    // UPDATE-first (null-safe) to avoid relying solely on ON CONFLICT with nullable columns
    const upd = await modulePool.query(
      `UPDATE mod_module_manager_sidebar_entries
          SET label=$2, hash=$3, icon=$4, logo=$5, type=COALESCE($9, type), attached=TRUE, updated_at=NOW()
        WHERE entry_id=$1
          AND level=$6
          AND org_id IS NOT DISTINCT FROM $7
          AND parent_entry_id IS NOT DISTINCT FROM $8
        RETURNING *`,
      [entry_id, label, hash, icon || null, logo || null, Number(level)||0, org_id || null, parent_entry_id || null, type]
    );
    if (upd && upd.rows && upd.rows[0]) return upd.rows[0];
    const posRes = await modulePool.query(
      `SELECT COALESCE(MAX(position), -1) AS maxp FROM mod_module_manager_sidebar_entries
       WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id = $1::text))
         AND level = $2::smallint
         AND ( ($3::text IS NULL AND parent_entry_id IS NULL) OR parent_entry_id = $3::text )`,
      [org_id || null, Number(level)||0, parent_entry_id || null]
    );
    const pos = Number(posRes.rows?.[0]?.maxp ?? -1) + 1;
    // Fallback: update by entry_id within org regardless of previous level/parent
    const upd2 = await modulePool.query(
      `UPDATE mod_module_manager_sidebar_entries
          SET label=$2, hash=$3, icon=$4, logo=$5, level=$6, parent_entry_id=$8, position=$9, type=COALESCE($10, type), attached=TRUE, updated_at=NOW()
        WHERE entry_id=$1 AND org_id IS NOT DISTINCT FROM $7
        RETURNING *`,
      [entry_id, label, hash, icon || null, logo || null, Number(level)||0, org_id || null, parent_entry_id || null, pos, type]
    );
    if (upd2 && upd2.rows && upd2.rows[0]) return upd2.rows[0];
    const saved = await modulePool.query(
      `INSERT INTO mod_module_manager_sidebar_entries(entry_id, label, hash, icon, logo, position, org_id, level, parent_entry_id, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10,'module'))
       ON CONFLICT ON CONSTRAINT uq_mod_mm_sidebar_hier_cols
       DO UPDATE SET label=EXCLUDED.label, hash=EXCLUDED.hash, icon=EXCLUDED.icon, logo=EXCLUDED.logo, attached=TRUE, updated_at=NOW()
       RETURNING *`,
      [entry_id, label, hash, icon || null, logo || null, pos, org_id || null, Number(level)||0, parent_entry_id || null, type || 'module']
    );
    return saved && saved.rows && saved.rows[0] ? saved.rows[0] : null;
  }

  async function reorderSidebarTree(order = [], org_id = null, level = 0, parent_entry_id = null) {
    if (!modulePool) return;
    await ensureSidebarTable();
    const ids = Array.isArray(order) ? order.map(String) : [];
    for (let i = 0; i < ids.length; i++) {
      await modulePool.query(
        `UPDATE mod_module_manager_sidebar_entries seT position=$2, updated_at=NOW()
         WHERE entry_id=$1 AND (($3::text IS NULL AND org_id IS NULL) OR ($3::text IS NOT NULL AND org_id = $3::text))
           AND level=$4::smallint
           AND (($5::text IS NULL AND parent_entry_id IS NULL) OR parent_entry_id = $5::text)`,
        [ids[i], i, org_id || null, Number(level)||0, parent_entry_id || null]
      );
    }
  }

  async function deleteSidebarTree(entry_id, org_id = null, level = 0, parent_entry_id = null) {
    if (!modulePool) return;
    await ensureSidebarTable();
    await modulePool.query(
      `DELETE FROM mod_module_manager_sidebar_entries
       WHERE entry_id=$1 AND (($2::text IS NULL AND org_id IS NULL) OR ($2::text IS NOT NULL AND org_id = $2::text))
         AND level=$3::smallint
         AND (($4::text IS NULL AND parent_entry_id IS NULL) OR parent_entry_id = $4::text)`,
      [entry_id, org_id || null, Number(level)||0, parent_entry_id || null]
    );
  }

  // ========= Optional static sidebar (no DB) =========
  // Disabled: sidebar must be generated strictly from mod_module_manager_sidebar_entries.
  // (We keep the helpers for backward compatibility, but they are no-ops.)
  // Accepted shapes:
  // - Flat: { items: [ { entry_id,label,hash,level,parent_entry_id,icon,logo,attached,type } ] }
  // - Flat: [ { ...same fields... } ]
  // - Nested: { tree: [ { entry_id,label,hash,icon,logo,children:[...] } ] }
  // The nested form is flattened at load time with level/parent_entry_id derived.
  let staticSidebarCache = { path: null, mtimeMs: 0, rows: [] };
  const isStaticSidebarOnly = () => {
    try { return String(process.env.SIDEBAR_STATIC_ONLY || '').trim() === '1'; } catch { return false; }
  };
  function toAbs(pth) {
    try {
      const rel = String(pth || '').trim();
      if (!rel) return '';
      return path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
    } catch { return String(pth || ''); }
  }
  function flattenTree(nodes = [], parent = null, level = 0, out = []) {
    for (const n of Array.isArray(nodes) ? nodes : []) {
      if (!n || typeof n !== 'object') continue;
      const row = {
        entry_id: String(n.entry_id || '').trim() || null,
        label: String(n.label || n.entry_id || '').trim() || 'Item',
        hash: typeof n.hash === 'string' ? n.hash : '',
        icon: typeof n.icon === 'string' ? n.icon : null,
        logo: typeof n.logo === 'string' ? n.logo : null,
        attached: n.attached !== false,
        type: n.type ? String(n.type) : (n.hash ? (/^#\//.test(String(n.hash)) ? 'module' : 'lien') : 'sous-menu'),
        level,
        parent_entry_id: parent,
      };
      if (!row.entry_id) {
        const slug = row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entry';
        row.entry_id = `${parent ? 'sub' : 'entry'}-${slug}-${out.length + 1}`;
      }
      out.push(row);
      if (Array.isArray(n.children) && n.children.length) flattenTree(n.children, row.entry_id, level + 1, out);
    }
    return out;
  }
  function loadStaticSidebar(log) {
    try {
      void log;
      return null;
    } catch (e) { try { log?.(`[sidebar-static] load failed: ${e?.message || e}`); } catch {}; return null; }
  }

  async function writeStaticSidebar(rows, log) {
    try {
      void rows;
      void log;
      return false;
    } catch (e) { try { log?.(`[sidebar-static] write failed: ${e?.message || e}`); } catch {}; return false; }
  }

  // Admin: static-only auto-attach baseline (top N root items), normalize hashes, and dedupe
  app.post('/api/sidebar/static/auto-attach', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const hasStatic = !!(process.env.SIDEBAR_STATIC_FILE || process.env.MODULE_MANAGER_SIDEBAR_JSON);
      if (!hasStatic) return res.status(400).json({ ok: false, error: 'static_only' });
      let rows = loadStaticSidebar(logToFile);
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ ok: false, error: 'no_static_rows' });

      const b = req.body || {};
      const maxRoot = Number(b.maxRoot || 8);
      const detachOthers = b.detachOthers !== false; // default true
      const doNormalize = b.normalize !== false; // default true
      const doDedupe = b.dedupe !== false; // default true

      const isUrl = (s) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(String(s || ''));
      const norm = (h) => {
        try {
          let x = String(h || '').trim();
          if (!x) return '';
          if (isUrl(x)) return x; // keep absolute URLs
          // '/#...' or '/...' -> '#/...'
          if (/^\/?#\/?/i.test(x)) x = '#/' + x.replace(/^\/?#\/?/i, '');
          if (/^#modules/i.test(x)) x = x.replace(/^#modules/i, '#/modules');
          x = x.replace(/^#\/modules\/([^/]+)(.*)$/i, '#/$1$2');
          if (/^#(?!\/)/.test(x)) x = '#/' + x.replace(/^#/, '');
          x = x.replace(/^#\/\s+/, '#/');
          x = x.replace(/^#\/\/+/, '#/');
          if (/^\//.test(x)) x = '#/' + x.replace(/^\//, '');
          return x;
        } catch { return String(h || ''); }
      };

      // Normalize hashes and coerce fields
      if (doNormalize) {
        rows = rows.map((r) => ({
          ...r,
          entry_id: String(r.entry_id || '').trim() || `entry-${Date.now()}`,
          label: String(r.label || r.entry_id || '').trim() || 'Item',
          hash: norm(r.hash),
          level: Number(r.level || 0),
          parent_entry_id: r.parent_entry_id != null ? String(r.parent_entry_id) : null,
          attached: r.attached !== false,
          type: r.type ? String(r.type) : (r.hash ? (/^#\//.test(String(r.hash)) ? 'module' : 'lien') : 'sous-menu'),
        }));
      }

      // Dedupe exact (entry_id, level, parent) to keep latest
      if (doDedupe) {
        const seen = new Set();
        const out = [];
        for (const r of rows) {
          const key = `L${Number(r.level||0)}|P${r.parent_entry_id || ''}|E${r.entry_id}`;
          if (seen.has(key)) continue;
          seen.add(key); out.push(r);
        }
        rows = out;
      }

      // Compute new root attachment (top N) and sequential positions
      const roots = rows.filter((r) => (Number(r.level) || 0) === 0 && (r.parent_entry_id == null));
      roots.sort((a,b) => {
        const pa = (typeof a.position === 'number') ? a.position : Number.MAX_SAFE_INTEGER;
        const pb = (typeof b.position === 'number') ? b.position : Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        const la = String(a.label || ''); const lb = String(b.label || '');
        return la.localeCompare(lb);
      });
      let pos = 0;
      for (let i = 0; i < roots.length; i++) {
        const r = roots[i];
        if (i < maxRoot) { r.attached = true; r.position = pos++; }
        else if (detachOthers) { r.attached = false; }
      }

      // Write back and return root items
      const ok = await writeStaticSidebar(rows, logToFile);
      if (!ok) return res.status(500).json({ ok: false, error: 'write_failed' });
      const items = rows.filter((r) => r.attached !== false && (Number(r.level)||0) === 0 && (r.parent_entry_id == null));
      try { window?.dispatchEvent?.(new CustomEvent('sidebar:reload')); } catch {}
      res.json({ ok: true, rootAttached: items.length, items, static: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Admin: deep clean the static sidebar JSON file
  // - Normalizes hashes and coerces fields (type, level, parent)
  // - Fixes bad parent references and self-parent loops
  // - Removes obviously broken entries (empty entry_id/label)
  // - Reorders positions sequentially per (level,parent_entry_id)
  // - Optionally attaches a baseline of root items and/or detaches others
  // Payload: {
  //   normalize?: boolean (default true),
  //   dedupe?: boolean (default true),
  //   attachBaseline?: string[] (optional list of module ids to attach as roots),
  //   detachOthers?: boolean (default false),
  // }
  app.post('/api/sidebar/static/clean', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const hasStatic = !!(process.env.SIDEBAR_STATIC_FILE || process.env.MODULE_MANAGER_SIDEBAR_JSON);
      if (!hasStatic) return res.status(400).json({ ok: false, error: 'static_only' });
      let rows = loadStaticSidebar(logToFile);
      if (!Array.isArray(rows)) return res.status(400).json({ ok: false, error: 'no_static_rows' });

      const b = req.body || {};
      const doNormalize = b.normalize !== false; // default true
      const doDedupe = b.dedupe !== false; // default true
      const detachOthers = !!b.detachOthers; // default false
      const attachBaseline = Array.isArray(b.attachBaseline) ? b.attachBaseline.map(s=>String(s).trim()).filter(Boolean) : [];

      const isUrl = (s) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(String(s || ''));
      const normHash = (h) => {
        try {
          let x = String(h || '').trim();
          if (!x) return '';
          if (isUrl(x)) return x; // absolute URL left intact
          if (/^\/?#\/?/i.test(x)) x = '#/' + x.replace(/^\/?#\/?/i, '');
          if (/^#modules/i.test(x)) x = x.replace(/^#modules/i, '#/modules');
          x = x.replace(/^#\/modules\/([^/]+)(.*)$/i, '#/$1$2');
          if (/^#(?!\/)/.test(x)) x = '#/' + x.replace(/^#/, '');
          x = x.replace(/^#\/\s+/, '#/');
          x = x.replace(/^#\/\/+/, '#/');
          if (/^\//.test(x)) x = '#/' + x.replace(/^\//, '');
          return x;
        } catch { return String(h || ''); }
      };

      // 1) Coerce and normalize
      if (doNormalize) {
        rows = rows.map((r, i) => {
          const entry_id = String(r?.entry_id || `entry-${Date.now()}-${i}`);
          const label = String(r?.label || r?.entry_id || `Item ${i+1}`);
          const hash = normHash(r?.hash);
          const level = Number(r?.level || 0);
          const parent_entry_id = r?.parent_entry_id != null ? String(r.parent_entry_id) : null;
          let type = r?.type ? String(r.type) : (hash ? (/^#\//.test(hash) ? 'module' : 'lien') : 'sous-menu');
          if (type === 'update') type = (hash ? (/^#\//.test(hash) ? 'module' : 'lien') : 'sous-menu');
          const attached = r?.attached !== false;
          const icon = (typeof r?.icon === 'string' && r.icon.trim()) ? String(r.icon) : null;
          const logo = (typeof r?.logo === 'string' && r.logo.trim()) ? String(r.logo) : null;
          const pos = (typeof r?.position === 'number') ? r.position : i;
          return { entry_id, label, hash, level, parent_entry_id, icon, logo, attached, type, position: pos };
        });
      }

      // 2) Fix self-parent and missing parents; coerce wrong levels
      const byId = new Map(rows.map(r => [String(r.entry_id), r]));
      rows = rows.map(r => {
        try {
          if (r.parent_entry_id && r.parent_entry_id === r.entry_id) {
            // break self-loop and promote to root
            return { ...r, parent_entry_id: null, level: 0 };
          }
          if (r.level > 0 && (!r.parent_entry_id || !byId.has(String(r.parent_entry_id)))) {
            // parent missing -> promote to root
            return { ...r, parent_entry_id: null, level: 0 };
          }
          if (r.level === 0 && r.parent_entry_id) {
            // level 0 cannot have a parent
            return { ...r, parent_entry_id: null };
          }
          return r;
        } catch { return r; }
      });

      // 3) Dedupe by composite key (level,parent,entry_id); keep earliest occurrence
      if (doDedupe) {
        const seen = new Set();
        const out = [];
        for (const r of rows) {
          const key = `L${Number(r.level||0)}|P${r.parent_entry_id || ''}|E${r.entry_id}`;
          if (seen.has(key)) continue;
          seen.add(key); out.push(r);
        }
        rows = out;
      }

      // 4) Optionally attach a baseline of root modules and optionally detach others
      if (attachBaseline.length) {
        // Attach requested ids at root (derive entry_id=mod-<id> when missing)
        const want = attachBaseline.map(id => ({ id, eid: `mod-${id}` }));
        const bucket = rows.filter(r => (Number(r.level)||0) === 0 && (r.parent_entry_id == null));
        let pos = 0;
        for (const w of want) {
          const idx = rows.findIndex(r => r.entry_id === w.eid);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], attached: true, level: 0, parent_entry_id: null, position: pos++ };
          } else {
            rows.push({ entry_id: w.eid, label: w.id, hash: `#/${w.id}`, icon: null, logo: null, attached: true, type: 'module', level: 0, parent_entry_id: null, position: pos++ });
          }
        }
        if (detachOthers) {
          rows = rows.map(r => {
            if ((Number(r.level)||0) !== 0 || (r.parent_entry_id != null)) return { ...r, attached: false };
            if (!want.some(w => w.eid === r.entry_id)) return { ...r, attached: false };
            return r;
          });
        }
      }

      // 5) Re-index positions per (level,parent)
      const buckets = new Map();
      for (const r of rows) {
        const key = `L${Number(r.level||0)}|P${r.parent_entry_id || ''}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(r);
      }
      for (const list of buckets.values()) {
        list.sort((a,b) => {
          const pa = (typeof a.position === 'number') ? a.position : Number.MAX_SAFE_INTEGER;
          const pb = (typeof b.position === 'number') ? b.position : Number.MAX_SAFE_INTEGER;
          if (pa !== pb) return pa - pb;
          const la = String(a.label || '');
          const lb = String(b.label || '');
          return la.localeCompare(lb);
        });
        for (let i = 0; i < list.length; i++) list[i].position = i;
      }

      const ok = await writeStaticSidebar(rows, logToFile);
      if (!ok) return res.status(500).json({ ok: false, error: 'write_failed' });
      return res.json({ ok: true, items: rows, static: true });
    } catch (e) {
      try { logToFile?.(`[sidebar-static] clean failed: ${e?.message || e}`); } catch {}
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  async function upsertSidebarEntry({ entry_id, label, hash, icon, logo, org_id, attached, type = 'module' }) {
    if (!modulePool) throw new Error('db_disabled');
    await ensureSidebarTable();
    if (!entry_id || String(entry_id).trim() === '') {
      const s2 = String(hash || '');
      const prefix = (/^#?\/(?:modules\/)?[^/]+/.test(s2)) ? 'mod' : 'entry';
      entry_id = await genEntryId(prefix);
    }
    const desiredAttached = (typeof attached === 'boolean') ? attached : true;
    // UPDATE-first (root level), null-safe on org
    const upd = await modulePool.query(
      `UPDATE mod_module_manager_sidebar_entries
         SET label=$2, hash=$3, icon=$4, logo=$5, attached=$6, type=COALESCE($8, type), updated_at=NOW()
       WHERE entry_id=$1 AND level=0 AND parent_entry_id IS NULL
         AND org_id IS NOT DISTINCT FROM $7
       RETURNING *`,
      [entry_id, label, hash, icon || null, logo || null, desiredAttached, org_id || null, type ? String(type) : 'module']
    );
    if (upd && upd.rows && upd.rows[0]) return upd.rows[0];
    const posRes = await modulePool.query(`
      SELECT COALESCE(MAX(position), -1) AS maxp
      FROM mod_module_manager_sidebar_entries
      WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id = $1::text))
        AND level = 0 AND parent_entry_id IS NULL`, [org_id || null]);
    const pos = Number(posRes.rows?.[0]?.maxp ?? -1) + 1;
    const saved = await modulePool.query(
      `INSERT INTO mod_module_manager_sidebar_entries(entry_id, label, hash, icon, logo, position, org_id, level, parent_entry_id, attached, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,NULL,$8,COALESCE($9,'module'))
       ON CONFLICT ON CONSTRAINT uq_mod_mm_sidebar_hier_cols
       DO UPDATE SET label=EXCLUDED.label, hash=EXCLUDED.hash, icon=EXCLUDED.icon, logo=EXCLUDED.logo, attached=EXCLUDED.attached, type=COALESCE(EXCLUDED.type, mod_module_manager_sidebar_entries.type), updated_at=NOW()
       RETURNING *`,
      [entry_id, label, hash, icon || null, logo || null, pos, org_id || null, desiredAttached, type ? String(type) : 'module']
    );
    return saved && saved.rows && saved.rows[0] ? saved.rows[0] : null;
  }

  async function reorderSidebarEntries(order = [], org_id = null) {
    if (!modulePool) return;
    await ensureSidebarTable();
    const ids = Array.isArray(order) ? order.map(String) : [];
    for (let i = 0; i < ids.length; i++) {
      await modulePool.query(`
        UPDATE mod_module_manager_sidebar_entries
        SET position=$2, updated_at=NOW()
        WHERE entry_id=$1 AND (
          ($3::text IS NULL AND org_id IS NULL)
          OR ($3::text IS NOT NULL AND org_id = $3::text)
        )`, [ids[i], i, org_id || null]);
    }
  }

  async function deleteSidebarEntry(entry_id, org_id = null) {
    if (!modulePool) return;
    await ensureSidebarTable();
    await modulePool.query(`
      DELETE FROM mod_module_manager_sidebar_entries
      WHERE entry_id=$1 AND (
        ($2::text IS NULL AND org_id IS NULL)
        OR ($2::text IS NOT NULL AND org_id = $2::text)
      )`, [entry_id, org_id || null]);
  }

  app.get('/api/sidebar', async (req, res) => {
    try {
      try { res.setHeader('Cache-Control', 'no-store'); } catch {}
      const items = await getSidebarEntries(req);
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // Library: list unattached submenus (type='sous-menu') for Menus Builder
  app.get('/api/sidebar/submenus', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      // Static-mode fallback: list unattached submenus from the static JSON
      const staticRows = loadStaticSidebar(logToFile);
      if ((process.env.SIDEBAR_STATIC_FILE || process.env.MODULE_MANAGER_SIDEBAR_JSON) && Array.isArray(staticRows)) {
        try {
          const items = staticRows
            .filter((r) => r && r.attached === false && (
              String(r.type || '').toLowerCase() === 'sous-menu' || !r.hash || String(r.hash).trim() === ''
            ))
            .map((r) => ({
              entry_id: String(r.entry_id),
              label: String(r.label || r.entry_id || 'Item'),
              hash: typeof r.hash === 'string' ? r.hash : '',
              position: typeof r.position === 'number' ? r.position : 0,
              icon: typeof r.icon === 'string' ? r.icon : null,
              logo: typeof r.logo === 'string' ? r.logo : null,
              active: true,
              org_id: null,
              attached: false,
              level: Number(r.level || 0),
              parent_entry_id: r.parent_entry_id != null ? String(r.parent_entry_id) : null,
              type: r.type ? String(r.type) : 'sous-menu',
            }))
            .sort((a, b) => (a.position - b.position) || String(a.label).localeCompare(String(b.label)));
          return res.json({ ok: true, items, static: true });
        } catch (e) {
          // fall through to DB-backed listing
        }
      }
      await ensureSidebarTable();
      const org = pickOrgId(req);
      const r = await modulePool.query(
        `SELECT entry_id, label, hash, position, icon, logo, active, org_id, attached, level, parent_entry_id, type
           FROM mod_module_manager_sidebar_entries
          WHERE active IS TRUE AND attached IS FALSE
            AND (
              lower(coalesce(type,'module')) = 'sous-menu'
              OR (hash IS NULL OR hash = '')
            )
            AND ( ($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND (org_id = $1::text OR org_id IS NULL)) )
          ORDER BY position ASC, label ASC`,
        [org]
      );
      res.json({ ok: true, items: r.rows || [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // Library: list modules for Menus Builder.
  // Prefer DB (mod_module_manager_modules); when DB is unavailable, fall back to catalog/manifests.
  // Read-only and safe; no admin required to view available modules.
  app.get('/api/sidebar/modules', async (req, res) => {
    const getModuleRoutes = (id) => {
      try {
        const map = {
          'agents': ['', 'preferences', 'organization', 'users', 'roles', 'members'],
          'module-manager': ['', 'settings'],
          'logs2': [''],
        };
        return Array.isArray(map[id]) ? map[id] : [''];
      } catch { return ['']; }
    };
    const buildItemsFromCatalog = () => {
      try {
        const cat = getCatalog(logToFile) || [];
        const out = [];
        for (const it of cat) {
          const id = String(it?.id || '').trim();
          if (!id) continue;
          const routes = Array.isArray(it?.routes) ? it.routes.map((s)=>String(s)) : getModuleRoutes(id);
          out.push({
            id,
            entry_id: `mod-${id}`,
            label: id,
            hash: `#/${id}`,
            type: 'module',
            active: !!it.defaultActive,
            install: !!it.defaultInstalled,
            version: it.version || null,
            routes,
          });
        }
        return out;
      } catch { return []; }
    };
    try {
      await ensureModulesTable();
      const r = await modulePool.query(
        `SELECT module_name, active, install, version FROM ${MODULES_TABLE} ORDER BY module_name`
      );
      const items = [];
      for (const row of r.rows || []) {
        const id = String(row.module_name || '').trim();
        if (!id) continue;
        items.push({
          id,
          entry_id: `mod-${id}`,
          label: id,
          hash: `#/${id}`,
          type: 'module',
          active: toBool(row.active),
          install: toBool(row.install),
          version: row.version || null,
          routes: getModuleRoutes(id),
        });
      }
      res.json({ ok: true, items });
    } catch (e) {
      // Graceful fallback when DB is not configured or query fails
      try { logToFile?.(`[module-manager] sidebar/modules fallback: ${e?.message || e}`); } catch {}
      const items = buildItemsFromCatalog();
      res.json({ ok: true, items, fallback: true });
    }
  });

  // Library: list unattached custom links (type='lien') for Menus Builder
  app.get('/api/sidebar/links', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      // Static-mode fallback: list unattached custom links from the static JSON
      const staticRows = loadStaticSidebar(logToFile);
      if ((process.env.SIDEBAR_STATIC_FILE || process.env.MODULE_MANAGER_SIDEBAR_JSON) && Array.isArray(staticRows)) {
        try {
          const isInternal = (h) => /^#\//.test(String(h || ''));
          const items = staticRows
            .filter((r) => r && r.attached === false && (
              String(r.type || '').toLowerCase() === 'lien' || (!!r.hash && !isInternal(r.hash))
            ))
            .map((r) => ({
              entry_id: String(r.entry_id),
              label: String(r.label || r.entry_id || 'Item'),
              hash: typeof r.hash === 'string' ? r.hash : '',
              position: typeof r.position === 'number' ? r.position : 0,
              icon: typeof r.icon === 'string' ? r.icon : null,
              logo: typeof r.logo === 'string' ? r.logo : null,
              active: true,
              org_id: null,
              attached: false,
              level: Number(r.level || 0),
              parent_entry_id: r.parent_entry_id != null ? String(r.parent_entry_id) : null,
              type: r.type ? String(r.type) : 'lien',
            }))
            .sort((a, b) => (a.position - b.position) || String(a.label).localeCompare(String(b.label)));
          return res.json({ ok: true, items, static: true });
        } catch (e) {
          // fall through to DB-backed listing
        }
      }
      await ensureSidebarTable();
      const org = pickOrgId(req);
      const r = await modulePool.query(
        `SELECT entry_id, label, hash, position, icon, logo, active, org_id, attached, level, parent_entry_id, type
           FROM mod_module_manager_sidebar_entries
          WHERE active IS TRUE AND attached IS FALSE
            AND (
              lower(coalesce(type,'module')) = 'lien'
              OR (hash IS NOT NULL AND hash <> '' AND LEFT(hash,2) <> '#/')
            )
            AND ( ($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND (org_id = $1::text OR org_id IS NULL)) )
          ORDER BY position ASC, label ASC`,
        [org]
      );
      res.json({ ok: true, items: r.rows || [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/sidebar/add', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const { entry_id, label, hash, icon, logo, org_id, level, parent_entry_id, attached, type } = req.body || {};
      // Static JSON mode: add to library (detached) when static file is configured
      const staticRows = isStaticSidebarOnly() ? loadStaticSidebar(logToFile) : null;
      if (isStaticSidebarOnly() && Array.isArray(staticRows)) {
        let rows = Array.isArray(staticRows) ? [...staticRows] : [];
        // Generate entry_id if missing
        let eid = entry_id ? String(entry_id) : '';
        if (!eid) {
          const base = (String(type||'').toLowerCase() === 'sous-menu' ? 'entry' : (String(type||'').toLowerCase() === 'module' ? 'mod' : 'entry'));
          eid = `${base}-${Date.now()}`;
        }
        const safeLabel = String(label || '').trim() || (String(hash||'').replace(/^#\/?/, '').split('/')[0] || eid || 'Item');
        const row = {
          entry_id: eid,
          label: safeLabel,
          hash: typeof hash === 'string' ? hash : '',
          icon: typeof icon === 'string' ? icon : null,
          logo: typeof logo === 'string' ? logo : null,
          attached: attached === true ? true : false, // library items default to detached
          type: type ? String(type) : ((hash && /^#\//.test(String(hash))) ? 'module' : (String(hash||'').trim() ? 'lien' : 'sous-menu')),
          level: Number(level)||0,
          parent_entry_id: parent_entry_id ? String(parent_entry_id) : null,
          position: (() => { try { const same = rows.filter(r => (Number(r.level)||0) === (Number(level)||0) && ((r.parent_entry_id||null) === (parent_entry_id?String(parent_entry_id):null))); return same.reduce((m,r)=> (typeof r.position==='number' && r.position>m)?r.position:m, -1) + 1; } catch { return 0; } })(),
        };
        rows.push(row);
        const ok = await writeStaticSidebar(rows, logToFile);
        if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
        return res.json({ ok:true, saved: row, static: true });
      }
      if (!label) return res.status(400).json({ ok: false, error: 'invalid_payload' });
      const safeHash = (typeof hash === 'string') ? hash : '';
      const org = pickOrgId(req);
      const inferredType = type ? String(type) : (String(safeHash).trim() === '' ? 'sous-menu' : (/^#\//.test(String(safeHash)) ? 'module' : 'lien'));
      const saved = await upsertSidebarEntry({ entry_id: entry_id ? String(entry_id) : '', label: String(label), hash: String(safeHash), icon: icon ? String(icon) : null, logo: logo ? String(logo) : null, org_id: org || null, level: Number(level)||0, parent_entry_id: parent_entry_id ? String(parent_entry_id) : null, attached: (typeof attached === 'boolean') ? attached : false, type: inferredType });
      const items = await getSidebarEntries(req);
      res.json({ ok: true, items, saved });
    } catch (e) {
      console.error('sidebar:add failed', e);
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/sidebar/reorder', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const { order, org_id, level, parent_entry_id } = req.body || {};
      if (!Array.isArray(order)) return res.status(400).json({ ok: false, error: 'invalid_payload' });
      const org = pickOrgId(req);
      // Static-only mode: persist to JSON file and return
      if (isStaticSidebarOnly()) {
        const staticRows = loadStaticSidebar(logToFile) || [];
        let rows = Array.isArray(staticRows) ? [...staticRows] : [];
        const ids = order.map(String);
        const levelNum = Number(level) || 0;
        const parent = parent_entry_id != null ? String(parent_entry_id) : null;
        for (let i = 0; i < ids.length; i++) {
          rows = rows.map(r => {
            if ((Number(r.level)||0) === levelNum && (r.parent_entry_id || null) === parent && String(r.entry_id) === ids[i]) {
              return { ...r, position: i };
            }
            return r;
          });
        }
        const ok = await writeStaticSidebar(rows, logToFile);
        if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
        return res.json({ ok: true, items: rows.filter(r => r.attached !== false && (Number(r.level)||0) === 0 && r.parent_entry_id == null), static: true });
      }
      await reorderSidebarEntries(order.map(String), org || null, Number(level)||0, parent_entry_id ? String(parent_entry_id) : null);
      const items = await getSidebarEntries(req);
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/sidebar/delete', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const { entry_id, org_id, level, parent_entry_id } = req.body || {};
      if (!entry_id) return res.status(400).json({ ok: false, error: 'invalid_payload' });
      // Static JSON mode: delete from static file
      const staticRows = isStaticSidebarOnly() ? loadStaticSidebar(logToFile) : null;
      if (isStaticSidebarOnly() && Array.isArray(staticRows)) {
        let rows = Array.isArray(staticRows) ? [...staticRows] : [];
        const target = String(entry_id);
        // Remove target and any descendants (simple cascade by parent_entry_id)
        const toDelete = new Set([target]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const r of rows) {
            if (r && toDelete.has(String(r.parent_entry_id || '')) && !toDelete.has(String(r.entry_id))) { toDelete.add(String(r.entry_id)); changed = true; }
          }
        }
        rows = rows.filter(r => !toDelete.has(String(r.entry_id)));
        const ok = await writeStaticSidebar(rows, logToFile);
        if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
        return res.json({ ok:true, static: true });
      }
      const org = pickOrgId(req);
      await deleteSidebarEntry(String(entry_id), org || null, Number(level)||0, parent_entry_id ? String(parent_entry_id) : null);
      const items = await getSidebarEntries(req);
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // Hierarchical endpoints (explicit)
  app.get('/api/sidebar/tree', async (req, res) => {
    try {
      try { res.setHeader('Cache-Control', 'no-store'); } catch {}
      // DB-backed only (mod_module_manager_sidebar_entries)
      const items = await getSidebarTree(req);
      res.json({ ok: true, items });
    } catch (e) {
      try { logToFile?.(`[module-manager] sidebar/tree error: ${e?.message || e}`); } catch {}
      res.status(503).json({ ok: false, error: 'db_unavailable', message: String(e?.message || e) });
    }
  });
  app.post('/api/sidebar/tree/add', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const b = req.body || {};
      const org = pickOrgId(req);
      // Derive a sane label if missing
      let label = '';
      try { label = String(b.label || '').trim(); } catch { label = ''; }
      if (!label) {
        try {
          const raw = String(b.hash || '').trim();
          if (raw) {
            // Derive from hash root (e.g. '#/automation-suite/prompts' -> 'automation-suite')
            const s = raw.replace(/^#\/?/, '');
            const root = s.split('/').filter(Boolean)[0] || '';
            label = root || '';
          }
        } catch {}
      }
      if (!label) {
        try { label = String(b.entry_id || '').trim(); } catch { /* noop */ }
      }
      if (!label) label = 'Item';
      // Ensure request body uses the derived label downstream
      b.label = label;
      // Keep existing type on edit: UI sends { type: 'update' }
      let t = b.type ? String(b.type) : (String(b.hash||'').trim() === '' ? 'sous-menu' : (/^#\//.test(String(b.hash||'')) ? 'module' : 'lien'));
      if (t === 'update') t = null;

      // Static JSON mode: mutate the JSON file instead of DB
      const staticRows = loadStaticSidebar(logToFile);
      if (Array.isArray(staticRows) && staticRows.length >= 0 && (process.env.SIDEBAR_STATIC_FILE || process.env.MODULE_MANAGER_SIDEBAR_JSON)) {
        const rows = Array.isArray(staticRows) ? [...staticRows] : [];
        // Ensure unique entry_id
        let eid = b.entry_id ? String(b.entry_id) : '';
        if (!eid) {
          const base = (t === 'sous-menu' ? 'entry' : (t === 'module' ? 'mod' : 'entry'));
          eid = `${base}-${Date.now()}`;
        }
        // Compute target level/parent
        const level = Number(b.level) || 0;
        const parent_entry_id = b.parent_entry_id ? String(b.parent_entry_id) : null;
        // Compute next position in this bucket
        const siblings = rows.filter(r => (Number(r.level)||0) === (Number(b.level)||0) && ((b.parent_entry_id?String(b.parent_entry_id):null) === (r.parent_entry_id||null)));
        const maxPos = siblings.reduce((m,r)=> (typeof r.position==='number' && r.position>m) ? r.position : m, -1);
        let row = {
          entry_id: eid,
          label: String(b.label || label),
          hash: b.hash ? String(b.hash) : '',
          icon: b.icon ? String(b.icon) : null,
          logo: b.logo ? String(b.logo) : null,
          attached: true,
          type: t,
          level,
          parent_entry_id,
          position: maxPos + 1,
        };
        // If the same entry_id is already used elsewhere in a different bucket, generate a unique one
        try {
          const elsewhere = rows.some(r => r && String(r.entry_id) === row.entry_id && ((Number(r.level)||0) !== level || ((r.parent_entry_id||null) !== parent_entry_id)));
          if (elsewhere) row.entry_id = `${row.entry_id}-${Date.now()}`;
        } catch {}
        // Special cases: explicit in-place update, and uniqueness for sous-menus
        const isUpdate = (String(b.type || '').toLowerCase() === 'update') || (b.update === true);
        if (isUpdate) {
          // In-place edit: update the matching composite row if present; otherwise update first by entry_id
          let idx = rows.findIndex(r => r && r.entry_id === row.entry_id && (Number(r.level)||0) === level && ((r.parent_entry_id||null) === parent_entry_id));
          if (idx < 0) idx = rows.findIndex(r => r && r.entry_id === row.entry_id);
          if (idx >= 0) {
            const keepPos = typeof rows[idx].position === 'number' ? rows[idx].position : row.position;
            // Preserve type when UI indicates an update without explicit type
            const nextRow = (t == null) ? { ...rows[idx], ...row, position: keepPos, type: rows[idx].type } : { ...rows[idx], ...row, position: keepPos };
            rows[idx] = nextRow;
          } else {
            rows.push(row);
          }
          const ok = await writeStaticSidebar(rows, logToFile);
          if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
          const items = rows.filter(r => r.attached !== false && (Number(r.level)||0) === level && ((parent_entry_id==null && r.parent_entry_id==null) || (parent_entry_id!=null && r.parent_entry_id===parent_entry_id)));
          return res.json({ ok: true, items, saved: row, static: true });
        }
        if (t === 'sous-menu') {
          // Enforce single usage of the same submenu across the tree: move/update instead of duplicating
          const anyIdx = rows.findIndex(r => r && r.entry_id === row.entry_id);
          if (anyIdx >= 0) {
            // If bucket changes, reassign position at the end of the new bucket
            const sameBucket = ((Number(rows[anyIdx].level)||0) === level) && ((rows[anyIdx].parent_entry_id||null) === parent_entry_id);
            const newPos = sameBucket ? (typeof rows[anyIdx].position === 'number' ? rows[anyIdx].position : row.position) : (maxPos + 1);
            const merged = { ...rows[anyIdx], ...row, position: newPos };
            // Preserve type if t is null
            if (t == null) merged.type = rows[anyIdx].type;
            rows[anyIdx] = merged;
            const ok = await writeStaticSidebar(rows, logToFile);
            if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
            const items = rows.filter(r => r.attached !== false && (Number(r.level)||0) === level && ((parent_entry_id==null && r.parent_entry_id==null) || (parent_entry_id!=null && r.parent_entry_id===parent_entry_id)));
            return res.json({ ok: true, items, saved: rows[anyIdx], static: true });
          }
        }
        // Move vs. add logic
        const fromLevel = (typeof b.fromLevel === 'number') ? Number(b.fromLevel) : null;
        const fromParentId = (b.fromParentId != null) ? String(b.fromParentId) : null;
        if (b.type === 'tree-move' && fromLevel !== null) {
          // Find exact source row by (entry_id, fromLevel, fromParentId) and update it
          const srcIdx = rows.findIndex(r => r && r.entry_id === row.entry_id && (Number(r.level)||0) === fromLevel && ((r.parent_entry_id||null) === (fromParentId||null)));
          if (srcIdx >= 0) {
            rows[srcIdx] = (t == null) ? { ...row, type: rows[srcIdx].type } : row;
          } else {
            rows.push(row);
          }
        } else {
          // Upsert by composite key (entry_id + level + parent) so the same link can exist at different levels/parents.
          const existingIdx = rows.findIndex(r => r && r.entry_id === row.entry_id && (Number(r.level)||0) === row.level && ((r.parent_entry_id||null) === (row.parent_entry_id||null)));
          if (existingIdx >= 0) {
            // Allow duplicates in the same bucket by generating a unique entry_id
            row.entry_id = `${row.entry_id}-${Date.now()}`;
            rows.push(row);
          } else {
            rows.push(row);
          }
        }
        const ok = await writeStaticSidebar(rows, logToFile);
        if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
        // Return items under same parent/level
        const items = rows.filter(r => r.attached !== false && (Number(r.level)||0) === level && ((parent_entry_id==null && r.parent_entry_id==null) || (parent_entry_id!=null && r.parent_entry_id===parent_entry_id)));
        return res.json({ ok: true, items, saved: row, static: true });
      }

      // DB-backed mode
      const saved = await upsertSidebarTree({ entry_id: b.entry_id ? String(b.entry_id) : '', label:String(b.label || label), hash:b.hash?String(b.hash):'', icon:b.icon?String(b.icon):null, logo:b.logo?String(b.logo):null, org_id: org || null, level:Number(b.level)||0, parent_entry_id: b.parent_entry_id?String(b.parent_entry_id):null, type: t });
      const items = await getSidebarTree({ query: { level: b.level, parent_entry_id: b.parent_entry_id }, body: {}, headers: req.headers });
      res.json({ ok: true, items, saved });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message||String(e) }); }
  });
  app.post('/api/sidebar/tree/reorder', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const b = req.body || {};
      const org = pickOrgId(req);
      const order = (Array.isArray(b.order)?b.order:[]).map(String);
      const level = Number(b.level)||0;
      const parent_entry_id = b.parent_entry_id?String(b.parent_entry_id):null;
      const staticRows = loadStaticSidebar(logToFile);
      if ((process.env.SIDEBAR_STATIC_FILE || process.env.MODULE_MANAGER_SIDEBAR_JSON) && Array.isArray(staticRows)) {
        const rows = Array.isArray(staticRows) ? [...staticRows] : [];
        // Assign positions for this bucket
        let pos = 0;
        for (const eid of order) {
          const idx = rows.findIndex(r => r && r.entry_id === eid && (Number(r.level)||0) === level && ((r.parent_entry_id||null) === parent_entry_id));
          if (idx >= 0) rows[idx].position = pos++;
        }
        for (const r of rows) {
          if ((Number(r.level)||0) === level && ((r.parent_entry_id||null) === parent_entry_id) && !order.includes(String(r.entry_id))) {
            r.position = typeof r.position === 'number' ? r.position : pos++;
          }
        }
        const ok = await writeStaticSidebar(rows, logToFile);
        if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
        const items = rows.filter(r => r.attached !== false && (Number(r.level)||0) === level && ((parent_entry_id==null && r.parent_entry_id==null) || (parent_entry_id!=null && r.parent_entry_id===parent_entry_id)));
        return res.json({ ok: true, items, static: true });
      }
      await reorderSidebarTree(order, org||null, level, parent_entry_id);
      const items = await getSidebarTree({ query: { level, parent_entry_id }, body: {}, headers: req.headers });
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });
  app.post('/api/sidebar/tree/delete', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const b = req.body || {};
      const org = pickOrgId(req);
      if (!b.entry_id) return res.status(400).json({ ok:false, error:'invalid_payload' });
      const level = Number(b.level)||0;
      const parent_entry_id = b.parent_entry_id?String(b.parent_entry_id):null;
      const staticRows = loadStaticSidebar(logToFile);
      if ((process.env.SIDEBAR_STATIC_FILE || process.env.MODULE_MANAGER_SIDEBAR_JSON) && Array.isArray(staticRows)) {
        let rows = Array.isArray(staticRows) ? [...staticRows] : [];
        const toDelete = new Set([String(b.entry_id)]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const r of rows) {
            if (r && toDelete.has(String(r.parent_entry_id || '')) && !toDelete.has(String(r.entry_id))) { toDelete.add(String(r.entry_id)); changed = true; }
          }
        }
        rows = rows.filter(r => !toDelete.has(String(r.entry_id)));
        const ok = await writeStaticSidebar(rows, logToFile);
        if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
        const items = rows.filter(r => r.attached !== false && (Number(r.level)||0) === level && ((parent_entry_id==null && r.parent_entry_id==null) || (parent_entry_id!=null && r.parent_entry_id===parent_entry_id)));
        return res.json({ ok: true, items, static: true });
      }
      await deleteSidebarTree(String(b.entry_id), org||null, level, parent_entry_id);
      const items = await getSidebarTree({ query: { level, parent_entry_id }, body: {}, headers: req.headers });
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Detach: mark entry as not attached (stays in library lists, hidden from tree)
  app.post('/api/sidebar/tree/detach', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      const b = req.body || {};
      const org = pickOrgId(req);
      if (!b.entry_id) return res.status(400).json({ ok:false, error:'invalid_payload' });

      // Static JSON mode
      const staticRows = loadStaticSidebar(logToFile);
      const level = Number(b.level)||0;
      const parent_entry_id = b.parent_entry_id?String(b.parent_entry_id):null;
      if (Array.isArray(staticRows) && (process.env.SIDEBAR_STATIC_FILE || process.env.MODULE_MANAGER_SIDEBAR_JSON)) {
        const rows = Array.isArray(staticRows) ? [...staticRows] : [];
        // Detach only the exact instance (by composite key: entry_id + level + parent)
        let detachedOne = false;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!r) continue;
          const match = String(r.entry_id) === String(b.entry_id)
            && (Number(r.level)||0) === level
            && ((r.parent_entry_id||null) === (parent_entry_id||null));
          if (match) { rows[i] = { ...r, attached: false, parent_entry_id: null }; detachedOne = true; break; }
        }
        if (!detachedOne) return res.status(404).json({ ok:false, error:'not_found' });
        const ok = await writeStaticSidebar(rows, logToFile);
        if (!ok) return res.status(500).json({ ok:false, error:'write_failed' });
        const items = rows.filter(r => r.attached !== false && (Number(r.level)||0) === level && ((parent_entry_id==null && r.parent_entry_id==null) || (parent_entry_id!=null && r.parent_entry_id===parent_entry_id)));
        return res.json({ ok:true, saved: null, items, static: true });
      }

      await ensureSidebarTable();

      // First try: detach within the same org (null-safe)
      let upd = await modulePool.query(
        `UPDATE mod_module_manager_sidebar_entries
            SET attached=FALSE, parent_entry_id=NULL, updated_at=NOW()
          WHERE entry_id=$1 AND org_id IS NOT DISTINCT FROM $2
          RETURNING *`,
        [ String(b.entry_id), org || null ]
      );
      // Fallback: detach by entry_id regardless of org (in case entry_id is unique in your data)
      if (!upd || !upd.rows || upd.rows.length === 0) {
        upd = await modulePool.query(
          `UPDATE mod_module_manager_sidebar_entries
              SET attached=FALSE, parent_entry_id=NULL, updated_at=NOW()
            WHERE entry_id=$1
            RETURNING *`,
          [ String(b.entry_id) ]
        );
      }
      // Cascade: detach all descendants and clear their parent pointers
      try {
        await modulePool.query(
          `WITH RECURSIVE descendants AS (
             SELECT entry_id FROM mod_module_manager_sidebar_entries WHERE parent_entry_id = $1
             UNION ALL
             SELECT e.entry_id
               FROM mod_module_manager_sidebar_entries e
               JOIN descendants d ON e.parent_entry_id = d.entry_id
           )
           UPDATE mod_module_manager_sidebar_entries
              SET attached = FALSE, parent_entry_id = NULL, updated_at = NOW()
            WHERE entry_id IN (SELECT entry_id FROM descendants)`,
          [ String(b.entry_id) ]
        );
      } catch {}
      const saved = upd && upd.rows && upd.rows[0] ? upd.rows[0] : null;
      const items = await getSidebarTree({ query: { level: b.level, parent_entry_id: b.parent_entry_id }, body: {}, headers: req.headers });
      res.json({ ok:true, saved, items });
    } catch (e) {
      console.error('detach failed', e);
      res.status(500).json({ ok:false, error:'server_error', message: e?.message||String(e) });
    }
  });

  // Admin maintenance: detach sidebar entries for inactive modules and optionally purge agents' ui_state
  app.post('/api/module-manager/purge-inactive', async (req, res) => {
    if (typeof requireAdmin === 'function') { if (!requireAdmin(req, res)) return; }
    try {
      const b = req.body || {};
      const resetAllUi = !!b.reset_all_ui;
      const active = await getActiveModuleSet();
      const rows = await modulePool.query(`SELECT entry_id, hash FROM mod_module_manager_sidebar_entries WHERE attached IS TRUE`);
      let detached = 0;
      for (const it of rows.rows || []) {
        try {
          const s = String(it.hash || '').replace(/^#\/?/, '');
          const parts = s.split('/').filter(Boolean);
          if (!parts.length) continue;
          const root = parts[0] === 'modules' ? (parts[1] || '') : parts[0];
          if (root && !active.has(root)) {
            await modulePool.query(`UPDATE mod_module_manager_sidebar_entries SET attached=FALSE, updated_at=NOW() WHERE entry_id=$1`, [it.entry_id]);
            detached++;
          }
        } catch {}
      }
      let uiPurged = 0;
      if (resetAllUi) {
        try {
          const r = await modulePool.query(`UPDATE mod_agents_agents SET ui_state = NULL WHERE ui_state IS NOT NULL`);
          uiPurged = r.rowCount || 0;
        } catch {}
      }
      res.json({ ok: true, detached, uiPurged });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Generate a templated ZIP for local download (no server-side writes)
  app.post("/api/modules/generate-zip", async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const body = req.body || {};
    const toSlug = (s = "") => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'custom-module';
    try {
      // Lazy import so the server still boots when jszip isn't installed
      let JSZip;
      try {
        ({ default: JSZip } = await import('jszip'));
      } catch (e) {
        // Fallback: try to import from backend/node_modules to support monorepo layout
        try {
          const backendDir = path.resolve(__dirname, '../../../backend');
          const { pathToFileURL } = await import('url');
          const candidates = [
            path.join(backendDir, 'node_modules', 'jszip', 'lib', 'index.js'),
            path.join(backendDir, 'node_modules', 'jszip', 'dist', 'jszip.min.js'),
            path.join(process.cwd(), 'node_modules', 'jszip', 'lib', 'index.js'),
          ];
          let mod = null;
          for (const p of candidates) {
            try {
              if (fs.existsSync(p)) { mod = await import(pathToFileURL(p).href); break; }
            } catch {}
          }
          if (!mod) return res.status(501).json({ ok: false, error: 'jszip_not_installed' });
          JSZip = mod.default || mod.JSZip || mod;
        } catch {
          return res.status(501).json({ ok: false, error: 'jszip_not_installed' });
        }
      }
      const name = String(body.name || '').trim();
      const id = toSlug(String(body.id || name || ''));
      if (!name || !id) return res.status(400).json({ ok: false, error: 'invalid_name' });

      const modulesRoot = path.resolve(__dirname, '../../../modules');
      const templateDir = path.join(modulesRoot, 'module-template');
      if (!fs.existsSync(templateDir)) return res.status(500).json({ ok: false, error: 'template_missing' });

      const zip = new JSZip();
      const root = zip.folder(id);
      const addRecursive = (src, rel = '') => {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          for (const entry of fs.readdirSync(src)) {
            addRecursive(path.join(src, entry), path.join(rel, entry));
          }
        } else if (stat.isFile()) {
          const base = path.basename(src);
          let content = fs.readFileSync(src);
          // Patch some files
          if (base === 'config.json') {
            try {
              const cfg = JSON.parse(String(content));
              cfg.id = id;
              cfg.name = name;
              cfg.category = cfg.category || String(body.category || 'custom');
            cfg.database = cfg.database || { table: MODULES_TABLE, record: {} };
              cfg.database.record = cfg.database.record || {};
              cfg.database.record.name = id;
              content = Buffer.from(JSON.stringify(cfg, null, 2));
            } catch {}
          } else if (base === 'module.config.json') {
            try {
              const mcfg = JSON.parse(String(content));
              mcfg.name = id;
              content = Buffer.from(JSON.stringify(mcfg, null, 2));
            } catch {}
          }
          root.file(rel, content);
        }
      };
      addRecursive(templateDir);

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
      res.end(buffer);
    } catch (e) {
      logToFile?.(`❌ modules:generate-zip failed: ${e.message}`);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  logToFile?.("✅ Module manager routes ready");
}

// Loader-compatible entry for the module system.
// The dynamic module loader will call register(app, ctx).
export function register(app, ctx = {}) {
  try {
    const key = '/api/module-manager';
    const mounted = globalThis.__moduleJsonMounted || (globalThis.__moduleJsonMounted = new Set());
    const json = ctx ? ctx.expressJson : null;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
    // Also mount JSON parser for /api/modules/* endpoints used by this module
    const mm = '/api/modules';
    if (typeof json === 'function' && !mounted.has(mm)) { app.use(mm, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(mm); }
    // Sidebar endpoints live under '/api/sidebar*' (global manager). Mount parser for them too.
    const sb = '/api/sidebar';
    if (typeof json === 'function' && !mounted.has(sb)) { app.use(sb, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(sb); }
  } catch {}
  const { requireAdmin, getSetting, setSetting, logToFile, pool, getLoadedModules } = ctx;
  // Mount the existing module-manager endpoints using the provided ctx
  try {
    createModuleManager({ app, requireAdmin, getSetting, setSetting, logToFile, pool });
  } catch (e) {
    logToFile?.(`[module-manager] register failed: ${e?.message || e}`);
  }
  // Best-effort sync: ensure all runtime-mounted modules exist in DB table
  (async () => {
    try {
      if (typeof getLoadedModules === 'function') {
        const items = getLoadedModules() || [];
        const ids = Array.from(new Set(items.map(x => x && x.id).filter(Boolean)));
        if (ids.length) {
          await ensureModulesTable();
          for (const id of ids) {
            try { await setDbModuleState(id, { install: true, active: true, defaultVersion: '1.0.0' }); } catch {}
          }
        }
      }
    } catch (e) { logToFile?.(`[module-manager] sync mounted modules failed: ${e?.message || e}`); }
  })();
  // Expose runtime-mounted modules for diagnostics/UI
  app.get('/api/module-manager/mounted', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      // Prefer scanning the Express router so we reflect manual mounts and reloads
      const stack = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
      const ids = new Set();
      const extract = (layer) => {
        try {
          if (layer && layer.route && layer.route.path) {
            const path = String(layer.route.path || '');
            if (!path.startsWith('/api/')) return;
            const seg = path.split('/').filter(Boolean); // [ 'api', '<module>', ... ]
            const modId = seg.length >= 2 ? seg[1] : '';
            if (modId) ids.add(modId);
          } else if (layer && layer.name === 'router' && Array.isArray(layer.handle && layer.handle.stack)) {
            for (const sub of layer.handle.stack) extract(sub);
          }
        } catch {}
      };
      for (const l of stack) extract(l);
      // Fallback to loader's list if scan failed unexpectedly
      if (ids.size === 0 && typeof getLoadedModules === 'function') {
        const fromLoader = getLoadedModules() || [];
        for (const it of fromLoader) { if (it && it.id) ids.add(String(it.id)); }
      }
      const items = Array.from(ids).sort().map(id => ({ id }));
      res.json({ ok: true, items });
    } catch (e) {
      logToFile?.(`[module-manager] mounted list error: ${e?.message || e}`);
      res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Admin: list mounted HTTP routes grouped by module id
  // Usage examples:
  //  - All modules:   GET /api/module-manager/routes
  //  - Single module: GET /api/module-manager/routes?id=grabbing-sensorex
  app.get('/api/module-manager/routes', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const onlyId = String(req.query.id || req.query.module || '').trim();
      const stack = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
      const items = [];
      const push = (modId, path, methods) => {
        if (!modId) return;
        if (onlyId && modId !== onlyId) return;
        items.push({ module: modId, path, methods: Array.isArray(methods) ? methods : [] });
      };
      const extract = (layer) => {
        try {
          if (layer && layer.route && layer.route.path) {
            const path = String(layer.route.path || '');
            if (!path.startsWith('/api/')) return;
            const seg = path.split('/').filter(Boolean); // [ 'api', '<module>', ... ]
            const modId = seg.length >= 2 ? seg[1] : '';
            const methods = Object.keys(layer.route.methods || {}).filter(m => layer.route.methods[m]);
            push(modId, path, methods);
          } else if (layer && layer.name === 'router' && Array.isArray(layer.handle && layer.handle.stack)) {
            for (const sub of layer.handle.stack) extract(sub);
          }
        } catch { /* ignore */ }
      };
      for (const l of stack) extract(l);
      // Group by module id for frontend convenience
      const groups = {};
      for (const it of items) {
        const id = it.module || 'unknown';
        if (!groups[id]) groups[id] = [];
        groups[id].push({ path: it.path, methods: it.methods });
      }
      const out = Object.keys(groups).sort().map((id) => ({ id, routes: groups[id] }));
      res.json({ ok: true, items: out });
    } catch (e) {
      logToFile?.(`[module-manager] routes dump failed: ${e?.message || e}`);
      res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Keep last mount error details in-memory for diagnostics
  const lastMountErr = globalThis.__moduleLastMountError || (globalThis.__moduleLastMountError = new Map());

  // Admin: dynamically mount a module's backend routes (best-effort, no restart)
  // Body: { id: '<module_id>', force?: true }
  app.post('/api/module-manager/mount', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const modId = String(req.body?.id || req.body?.module || '').trim();
      const force = !!req.body?.force;
      if (!modId) return res.status(400).json({ ok:false, error:'invalid_module' });
      // Detect if routes for this module already exist
      try {
        const list = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
        const hasAny = list.some((l)=>{
          try {
            if (l && l.route && l.route.path && String(l.route.path).startsWith('/api/')) {
              const seg = String(l.route.path).split('/').filter(Boolean);
              const id = seg.length >= 2 ? seg[1] : '';
              return id === modId;
            }
            return false;
          } catch { return false; }
        });
        if (hasAny && !force) return res.json({ ok:true, mounted:true, duplicate:true });
      } catch {}

      // Attempt dynamic import of the module's backend entry and register its routes
      let mountedOk = false;
      try {
        const modulesRoot = path.resolve(__dirname, '../../../modules');
        const entryFs = path.resolve(modulesRoot, modId, 'backend', 'index.js');
        const { pathToFileURL } = await import('url');
        const url = pathToFileURL(entryFs).href;
        const mod = await import(url);
        if (mod && typeof mod.register === 'function') { await mod.register(app, { ...ctx }); mountedOk = true; }
        else if (mod && typeof mod.registerRoutes === 'function') { await mod.registerRoutes(app, { ...ctx }); mountedOk = true; }
      } catch (e) {
        logToFile?.(`[module-manager] mount '${modId}' failed: ${e?.message || e}`);
        try { lastMountErr.set(modId, { message: String(e?.message || e), stack: String(e?.stack || ''), at: new Date().toISOString() }); } catch {}
      }

      if (!mountedOk) {
        const err = lastMountErr.get(modId) || null;
        return res.status(500).json({ ok:false, error:'mount_failed', reason: err?.message, at: err?.at });
      }
      // Reflect runtime state into DB for consistency
      try { await ensureModulesTable(); await setDbModuleState(modId, { install:true, active:true }); } catch {}
      return res.json({ ok:true, mounted:true, forced: force || undefined });
    } catch (e) {
      logToFile?.(`[module-manager] mount error: ${e?.message || e}`);
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Admin: diagnostics for why a module failed to mount
  // GET /api/module-manager/mount/diagnostics?id=<module_id>
  app.get('/api/module-manager/mount/diagnostics', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const modId = String(req.query?.id || req.query?.module || '').trim();
      if (!modId) return res.status(400).json({ ok:false, error:'invalid_module' });
      // Gather currently mounted routes for this module
      const items = [];
      try {
        const stack = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
        const extract = (layer) => {
          try {
            if (layer && layer.route && layer.route.path) {
              const pathStr = String(layer.route.path || '');
              if (pathStr.startsWith('/api/')) {
                const seg = pathStr.split('/').filter(Boolean);
                const id = seg.length >= 2 ? seg[1] : '';
                if (id === modId) {
                  const methods = Object.keys(layer.route.methods || {}).filter(m => layer.route.methods[m]);
                  items.push({ path: pathStr, methods });
                }
              }
            } else if (layer && layer.name === 'router' && Array.isArray(layer.handle && layer.handle.stack)) {
              for (const sub of layer.handle.stack) extract(sub);
            }
          } catch {}
        };
        for (const l of stack) extract(l);
      } catch {}
      // Try to import module entry to surface ESM export errors
      let importable = false; let exportsList = []; let importError = null;
      try {
        const modulesRoot = path.resolve(__dirname, '../../../modules');
        const entryFs = path.resolve(modulesRoot, modId, 'backend', 'index.js');
        const { pathToFileURL } = await import('url');
        const url = pathToFileURL(entryFs).href;
        const mod = await import(url);
        importable = !!mod;
        try { exportsList = Object.keys(mod || {}); } catch {}
      } catch (e) {
        importError = { message: String(e?.message || e), stack: String(e?.stack || '') };
      }
      const last = lastMountErr.get(modId) || null;
      return res.json({ ok:true, module: modId, routesCount: items.length, routes: items, importable, exports: exportsList, importError, lastError: last });
    } catch (e) {
      logToFile?.(`[module-manager] mount diagnostics error: ${e?.message || e}`);
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Admin: sync currently loaded modules into DB state (install+active=true)
  app.post('/api/module-manager/sync-loaded', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      modulePool = pool || modulePool; // ensure pool set
      await ensureModulesTable();
      const items = typeof getLoadedModules === 'function' ? (getLoadedModules() || []) : [];
      let upserts = 0;
      for (const it of items) {
        const id = it && it.id ? String(it.id).trim() : '';
        if (!id) continue;
        try { await setDbModuleState(id, { install: true, active: true, defaultVersion: '1.0.0' }); upserts++; } catch {}
      }
      res.json({ ok: true, upserts });
    } catch (e) {
      logToFile?.(`[module-manager] sync-loaded failed: ${e?.message || e}`);
      res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Admin maintenance: remove DB module rows that are not mounted and have no folder on disk
  app.post('/api/module-manager/prune-orphans', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      modulePool = pool || modulePool; // ensure pool set
      await ensureModulesTable();
      const runtime = typeof getLoadedModules === 'function' ? getLoadedModules() : [];
      const loaded = new Set((runtime || []).map(x => x && x.id).filter(Boolean));
      const rows = await modulePool.query(`SELECT module_name FROM ${MODULES_TABLE}`);
      let removed = 0;
      for (const r of rows.rows || []) {
        const id = String(r.module_name || '').trim();
        if (!id) continue;
        const existsOnDisk = moduleDirExists(id);
        const isLoaded = loaded.has(id);
        if (!existsOnDisk && !isLoaded) {
          try {
            await modulePool.query(`DELETE FROM ${MODULES_TABLE} WHERE module_name=$1`, [id]);
            // Detach any sidebar links pointing to this module
            await modulePool.query(`UPDATE mod_module_manager_sidebar_entries
                                     SET attached=FALSE, updated_at=NOW()
                                   WHERE (hash ILIKE $1 OR hash ILIKE $2)`, [
              `#/${id}%`, `#/modules/${id}%`
            ]);
            removed++;
          } catch (e) {
            logToFile?.(`[module-manager] prune '${id}' failed: ${e?.message || e}`);
          }
        }
      }
      res.json({ ok:true, removed });
    } catch (e) {
      logToFile?.(`[module-manager] prune-orphans error: ${e?.message || e}`);
      res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Admin: rename tables to the canonical mod_<module_id_snake>_* convention, with optional compatibility views
  // Payload: { renames: [ { from: 'old_table', to: 'mod_xxx_new', createView: true } ] }
  app.post('/api/module-manager/db/rename-tables', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
      modulePool = pool || modulePool;
      const body = req.body || {};
      const renames = Array.isArray(body.renames) ? body.renames : [];
      if (!renames.length) return res.status(400).json({ ok:false, error:'invalid_payload' });

      const results = [];
      const client = await modulePool.connect();
      try {
        await client.query('BEGIN');
        // Tighten statement timeout just in case
        try { await client.query("SET LOCAL statement_timeout TO '20s'"); } catch {}

        for (const r of renames) {
          const from = String(r.from || '').trim();
          const to = String(r.to || '').trim();
          const createView = r.createView !== false; // default true
          if (!from || !to) { results.push({ from, to, ok:false, error:'invalid_entry' }); continue; }
          // Skip if both names equal
          if (from === to) { results.push({ from, to, ok:true, skipped:true, reason:'same_name' }); continue; }
          // Only rename when source exists and target not exists
          const src = await client.query(`SELECT to_regclass($1) AS o`, [from]);
          const dst = await client.query(`SELECT to_regclass($1) AS o`, [to]);
          if (!src.rows[0] || !src.rows[0].o) { results.push({ from, to, ok:true, skipped:true, reason:'source_missing' }); continue; }
          if (dst.rows[0] && dst.rows[0].o) {
            results.push({ from, to, ok:true, skipped:true, reason:'target_exists' });
          } else {
            await client.query(`ALTER TABLE ${from} RENAME TO ${to}`);
            if (createView) {
              // Create a compatibility view with the old name if still available
              const src2 = await client.query(`SELECT to_regclass($1) AS o`, [from]);
              if (!src2.rows[0].o) {
                try { await client.query(`CREATE VIEW ${from} AS SELECT * FROM ${to}`); } catch {}
              }
            }
            results.push({ from, to, ok:true, renamed:true });
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally { client.release(); }

      res.json({ ok:true, results });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Run installer for a module and return fresh schema report
  app.post('/api/modules/:id/run-installer', async (req, res) => {
    // Use the injected admin guard; fall back to 401 if missing
    if (typeof requireAdmin === 'function') { if (!requireAdmin(req, res)) return; }
    try {
      modulePool = pool || modulePool;
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'invalid_module' });
      const modulesRoot = path.resolve(__dirname, '../../../modules');
      const installerJs = path.join(modulesRoot, id, 'backend', 'installer.js');
      if (!fs.existsSync(installerJs)) return res.status(404).json({ ok:false, error:'installer_missing' });

      const { spawn } = await import('child_process');
      // Append diagnostic logs to backend/chat.log to aid debugging installer failures
      const backendDir = path.resolve(__dirname, '../../../backend');
      const logPath = path.join(backendDir, 'chat.log');
      const nowIso = () => new Date().toISOString();
      const safeLog = (m) => { try { fs.appendFileSync(logPath, `[${nowIso()}] [module-manager] ${m}\n`, 'utf8'); } catch {} };

      async function loadMigrationsState(modId) {
        const out = { module: modId, module_name: modId, available: [], applied: [], pending: [] };
        try {
          const cfgPath = path.join(modulesRoot, modId, 'module.config.json');
          if (fs.existsSync(cfgPath)) {
            try {
              const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8') || '{}');
              if (cfg && cfg.name) out.module_name = String(cfg.name).trim() || out.module_name;
            } catch {}
          }
        } catch {}
        try {
          const migDir = path.join(modulesRoot, modId, 'db', 'migrations');
          out.available = fs.existsSync(migDir)
            ? fs.readdirSync(migDir).filter((f) => String(f).toLowerCase().endsWith('.sql')).sort()
            : [];
        } catch {}
        try {
          if (!modulePool) return out;
          const reg = await modulePool.query(`SELECT to_regclass('public.migrations_log') AS reg`);
          if (!(reg && reg.rows && reg.rows[0] && reg.rows[0].reg)) return out;
          const r = await modulePool.query(
            `SELECT filename, applied_at
               FROM public.migrations_log
              WHERE module_name = $1
              ORDER BY applied_at DESC, filename DESC`,
            [out.module_name]
          );
          out.applied = (r.rows || []).map((row) => ({ filename: String(row.filename || ''), applied_at: row.applied_at || null }))
            .filter((x) => x.filename);
        } catch {}
        try {
          const appliedSet = new Set((out.applied || []).map((x) => x.filename));
          out.pending = (out.available || []).filter((f) => !appliedSet.has(f));
        } catch {}
        return out;
      }

      const hasDbEnv = !!(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE);
      safeLog(`run-installer start id=${id} cwd=${modulesRoot} db_env_present=${hasDbEnv}`);
      let output = '';
      await new Promise((resolve, reject) => {
        try {
          const child = spawn(process.execPath, [installerJs], { cwd: modulesRoot, env: process.env, stdio: ['ignore','pipe','pipe'] });
          const timeoutMs = Number(process.env.MODULE_INSTALL_TIMEOUT_MS || 45000);
          const t = setTimeout(() => {
            try { output += `\n[timeout] installer exceeded ${timeoutMs}ms\n`; } catch {}
            try { child.kill('SIGKILL'); } catch {}
            reject(Object.assign(new Error('installer_timeout'), { output }));
          }, timeoutMs);
          child.stdout.on('data', d => { try { const s = d.toString(); output += s; safeLog(`installer[${id}] stdout: ${s.trim().slice(0,2000)}`); } catch {} });
          child.stderr.on('data', d => { try { const s = d.toString(); output += s; safeLog(`installer[${id}] stderr: ${s.trim().slice(0,2000)}`); } catch {} });
          child.on('error', (e)=>{ clearTimeout(t); safeLog(`installer[${id}] error: ${e?.message || e}`); reject(e); });
          child.on('exit', code => { clearTimeout(t); safeLog(`installer[${id}] exit code=${code}`); if (code === 0) resolve(); else reject(Object.assign(new Error('installer_exit_'+code), { output })); });
        } catch (e) { reject(e); }
      });

      // Compute schema report (derived) and persist status
      try { await ensureModulesTable(); } catch {}
      const fsMod = await import('fs');
      const pathMod = await import('path');
      const fsx = fsMod.default || fsMod; const pathx = pathMod.default || pathMod;
      const migDir = pathx.resolve(__dirname, `../../../modules/${id}/db/migrations`);
      const files = (fsx.existsSync(migDir) ? fsx.readdirSync(migDir).filter(f=>f.endsWith('.sql')) : []).map(f=>pathx.join(migDir, f));
      const expects = { tables: new Set(), indexes: [] };
      const norm = (n) => String(n||'').replace(/^"|"$/g,'');
      const isEphemeralTable = (t) => {
        const s = String(t || '');
        return /__new\b/i.test(s) || /__tmp\b/i.test(s) || /__temp\b/i.test(s);
      };
      for (const f of files) {
        let sql=''; try { sql = fsx.readFileSync(f,'utf8'); } catch {}
        if (!sql) continue;
        let m; const reTab=/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_\.\"-]+)/ig;
        while ((m=reTab.exec(sql))) {
          const t = norm(m[1]);
          if (!isEphemeralTable(t)) expects.tables.add(t);
        }
        let k; const reIdx=/CREATE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_\.\"-]+)\s+ON\s+([A-Za-z0-9_\.\"-]+)/ig;
        while ((k=reIdx.exec(sql))) {
          const idxName = norm(k[1]);
          const idxTable = norm(k[2]);
          if (isEphemeralTable(idxTable)) continue;
          expects.indexes.push({ name: idxName, table: idxTable });
        }
      }
      try {
        const seen = new Set();
        expects.indexes = (expects.indexes || []).filter((x) => {
          const key = `${String(x?.name||'')}@@${String(x?.table||'')}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } catch {}
      filterExpectedSchemaForModule(id, expects);
      const tables = Array.from(expects.tables);
      const present = { tables: [], missingTables: [], missingIndexes: [] };
      for (const t of tables) {
        let exists=false, columns=[], idxs=[];
        try { const r = await modulePool.query('SELECT to_regclass($1) AS oid', [t.includes('.')?t:`public.${t}`]); exists = !!(r.rows[0] && r.rows[0].oid); } catch {}
        try { if (exists) { const parts=t.split('.'); const name=parts.pop(); const colRes=await modulePool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position', [name]); columns = colRes.rows||[]; const idxRes = await modulePool.query('SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1', [name]); idxs=(idxRes.rows||[]).map(r=>r.indexname); } } catch {}
        present.tables.push({ name:t, exists, columns, indexes: idxs }); if (!exists) present.missingTables.push(t);
      }
      for (const it of expects.indexes) {
        try {
          const parts=it.table.split('.'); const name=parts.pop();
          const r=await modulePool.query('SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2', [name, it.name]);
          if (r.rowCount) continue;
          const guessed = guessFirstColumnFromIndexName(it.name);
          if (guessed) {
            const firstCols = await listIndexFirstColumns(name);
            if (firstCols.some((x) => String(x.first_col).toLowerCase() === guessed)) continue;
          }
          present.missingIndexes.push(`${it.name} ON ${it.table}`);
        } catch {}
      }
      const derivedOk = (present.missingTables.length===0 && present.missingIndexes.length===0);
      const derivedErr = derivedOk
        ? null
        : `schema_missing: tables=${present.missingTables.join(',') || '-'}; indexes=${present.missingIndexes.join(',') || '-'}`;
      try {
        await modulePool.query(
          `UPDATE ${MODULES_TABLE}
              SET schema_ok=$1,
                  install_error=CASE
                    WHEN $1 THEN NULL
                    WHEN COALESCE(install_error,'') <> '' THEN install_error
                    ELSE $3
                  END,
                  updated_at=NOW()
            WHERE module_name=$2`,
          [derivedOk, id, derivedErr]
        );
      } catch {}

      const migrations = await loadMigrationsState(id);
      safeLog(`run-installer done id=${id} migrations_applied=${(migrations.applied||[]).length} pending=${(migrations.pending||[]).length}`);
      return res.json({
        ok:true,
        output: output.slice(-8000),
        report: { module:id, derived_ok: derivedOk, expected: { tables, indexes: expects.indexes }, present },
        migrations,
      });
    } catch (e) {
      const msg = String(e?.message || e);
      const out = (e && e.output) ? String(e.output).slice(-8000) : '';
      try { fs.appendFileSync(path.join(__dirname, '../../../backend', 'chat.log'), `[${new Date().toISOString()}] [module-manager] installer[${String(req.params.id||'')}] failure tail:\n${(out || '').slice(-6000)}\n`, 'utf8'); } catch {}
      try {
        await ensureModulesTable();
        await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS schema_ok BOOLEAN NULL`);
        await modulePool.query(`ALTER TABLE ${MODULES_TABLE} ADD COLUMN IF NOT EXISTS install_error TEXT NULL`);
        const merged = `${msg}${out ? `\n\n${out}` : ''}`.slice(0, 2000);
        await modulePool.query(
          `UPDATE ${MODULES_TABLE} SET schema_ok=FALSE, install_error=$1, updated_at=NOW() WHERE module_name=$2`,
          [merged, String(req.params.id || '').trim()]
        );
      } catch {}
      return res.status(500).json({ ok:false, error:'server_error', message: msg, output: out });
    }
  });

  // List module migrations: available vs applied (migrations_log)
  app.get('/api/modules/:id/migrations', async (req, res) => {
    if (typeof requireAdmin === 'function') { if (!requireAdmin(req, res)) return; }
    try {
      modulePool = pool || modulePool;
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'invalid_module' });

      const modulesRoot = path.resolve(__dirname, '../../../modules');
      const backendDir = path.resolve(__dirname, '../../../backend');
      const logPath = path.join(backendDir, 'chat.log');
      const nowIso = () => new Date().toISOString();
      const safeLog = (m) => { try { fs.appendFileSync(logPath, `[${nowIso()}] [module-manager] ${m}\n`, 'utf8'); } catch {} };

      let moduleName = id;
      try {
        const cfgPath = path.join(modulesRoot, id, 'module.config.json');
        if (fs.existsSync(cfgPath)) {
          try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8') || '{}');
            if (cfg && cfg.name) moduleName = String(cfg.name).trim() || moduleName;
          } catch {}
        }
      } catch {}

      let available = [];
      try {
        const migDir = path.join(modulesRoot, id, 'db', 'migrations');
        available = fs.existsSync(migDir)
          ? fs.readdirSync(migDir).filter((f) => String(f).toLowerCase().endsWith('.sql')).sort()
          : [];
      } catch {}

      let applied = [];
      try {
        if (modulePool) {
          const reg = await modulePool.query(`SELECT to_regclass('public.migrations_log') AS reg`);
          if (reg && reg.rows && reg.rows[0] && reg.rows[0].reg) {
            const r = await modulePool.query(
              `SELECT filename, applied_at
                 FROM public.migrations_log
                WHERE module_name = $1
                ORDER BY applied_at DESC, filename DESC`,
              [moduleName]
            );
            applied = (r.rows || []).map((row) => ({ filename: String(row.filename || ''), applied_at: row.applied_at || null }))
              .filter((x) => x.filename);
          }
        }
      } catch {}

      const appliedSet = new Set(applied.map((x) => x.filename));
      const pending = available.filter((f) => !appliedSet.has(f));
      safeLog(`migrations list id=${id} module_name=${moduleName} applied=${applied.length} pending=${pending.length}`);
      return res.json({ ok:true, module: id, module_name: moduleName, available, applied, pending });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // On-demand schema scan for all modules (heavy): call on UI refresh only
  app.post('/api/modules/schema-scan', async (req, res) => {
    if (typeof requireAdmin === 'function') { if (!requireAdmin(req, res)) return; }
    try {
      await ensureModulesTable();
      const catalog = getCatalog(logToFile) || [];
      const out = [];
      for (const m of catalog) {
        const id = m.id;
        try {
          const fsMod = await import('fs'); const pathMod = await import('path');
          const fsx = fsMod.default || fsMod; const pathx = pathMod.default || pathMod;
          const migDir = pathx.resolve(__dirname, `../../../modules/${id}/db/migrations`);
          const files = (fsx.existsSync(migDir) ? fsx.readdirSync(migDir).filter(f=>f.endsWith('.sql')) : []).map(f=>pathx.join(migDir, f));
          const expects = { tables: new Set(), indexes: [] };
          const norm = (n) => String(n||'').replace(/^"|"$/g,'');
          const isEphemeralTable = (t) => {
            const s = String(t || '');
            return /__new\b/i.test(s) || /__tmp\b/i.test(s) || /__temp\b/i.test(s);
          };
          for (const f of files) {
            let sql=''; try { sql = fsx.readFileSync(f,'utf8'); } catch {}
            if (!sql) continue;
            let a; const reTab=/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_\.\"-]+)/ig;
            while ((a=reTab.exec(sql))) { const t = norm(a[1]); if (!isEphemeralTable(t)) expects.tables.add(t); }
            let b; const reIdx=/CREATE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_\.\"-]+)\s+ON\s+([A-Za-z0-9_\.\"-]+)/ig;
            while ((b=reIdx.exec(sql))) { const idxName = norm(b[1]); const idxTable = norm(b[2]); if (!isEphemeralTable(idxTable)) expects.indexes.push({ name: idxName, table: idxTable }); }
          }
          try {
            const seen = new Set();
            expects.indexes = (expects.indexes || []).filter((x) => {
              const key = `${String(x?.name||'')}@@${String(x?.table||'')}`.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          } catch {}
          filterExpectedSchemaForModule(id, expects);
          const tables = Array.from(expects.tables);
          const missingTables = [];
          const missingIdx = [];
          for (const t of tables) {
            try { const r = await modulePool.query('SELECT to_regclass($1) AS oid', [t.includes('.')?t:`public.${t}`]); if (!(r.rows && r.rows[0] && r.rows[0].oid)) missingTables.push(t); } catch {}
          }
          for (const it of expects.indexes) {
            try {
              const parts=it.table.split('.'); const name=parts.pop();
              const r=await modulePool.query('SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2', [name, it.name]);
              if (r.rowCount) continue;
              const guessed = guessFirstColumnFromIndexName(it.name);
              if (guessed) {
                const firstCols = await listIndexFirstColumns(name);
                if (firstCols.some((x) => String(x.first_col).toLowerCase() === guessed)) continue;
              }
              missingIdx.push(`${it.name} ON ${it.table}`);
            } catch {}
          }
          const derivedOk = (missingTables.length===0 && missingIdx.length===0);
          try {
            const derivedErr = derivedOk ? null : `schema_missing: tables=${missingTables.join(',') || '-'}; indexes=${missingIdx.join(',') || '-'}`;
            await modulePool.query(
              `UPDATE ${MODULES_TABLE}
                  SET schema_ok=$1,
                      install_error=CASE WHEN $1 THEN NULL ELSE $3 END,
                      updated_at=NOW()
                WHERE module_name=$2`,
              [derivedOk, id, derivedErr]
            );
          } catch {}
          out.push({ id, derived_ok: derivedOk, missingTables, missingIndexes: missingIdx });
        } catch (e) { out.push({ id, error: String(e?.message||e) }); }
      }
      return res.json({ ok:true, items: out });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message||e) }); }
  });

  // Safety net: if sidebar/modules routes are not mounted earlier, avoid hard 404s and
  // return an empty payload so the UI can continue operating.
  app.use('/api/sidebar', (req, res, next) => {
    if (!res.headersSent) return res.json({ ok: true, items: [], fallback: true });
    next();
  });
  app.use('/api/modules', (req, res, next) => {
    if (!res.headersSent) return res.json({ ok: true, items: [], fallback: true });
    next();
  });
}

export default createModuleManager;





// Auto-added ping for compliance
try { app.get('/api/module-manager/ping', (_req, res) => res.json({ ok: true, module: 'module-manager' })); } catch {}

