#!/usr/bin/env node
/*
 Module compliance check
 - Scans modules/<id>/* and validates against MODULE_CHECKLIST.md rules
 - Emits JSON to stdout and writes modules/module_compliance_report.json
 - Exits non‑zero when errors are found (unless --no-fail)

 Usage:
   node scripts/check-modules.cjs [--no-fail] [--pretty]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODS_DIR = path.join(ROOT, 'modules');
const args = new Set(process.argv.slice(2));
const NO_FAIL = args.has('--no-fail');
const PRETTY = args.has('--pretty');

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function list(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } }

function scanFrontendIndex(dir) {
  const files = list(dir).filter(d => d.isFile() && /^index\.(jsx?|tsx?)$/.test(d.name));
  if (!files.length) return { present: false, hasMain: false, hasDefault: false, file: null };
  const file = path.join(dir, files[0].name);
  const src = read(file);
  const hasMain = /export\s*\{\s*default\s+as\s+Main\s*\}/.test(src)
    || /export\s*\{\s*[^}]*\bMain\b/.test(src)
    || /export\s+const\s+Main\b/.test(src)
    || /export\s+default\s+.*Main/.test(src);
  const hasDefault = /export\s+default\s+/.test(src) || /export\s*\{\s*default\b[\s,]/.test(src);
  return { present: true, hasMain, hasDefault, file };
}

function searchRecursive(dir, re) {
  let count = 0;
  for (const ent of list(dir)) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) count += searchRecursive(p, re);
    else if (ent.isFile()) {
      try { const txt = read(p); if (re.test(txt)) count++; } catch {}
    }
  }
  return count;
}

function hasPing(modDir, modId) {
  const backendDir = path.join(modDir, 'backend');
  const re = new RegExp(`/api/${modId.replace(/[-/\\^$*+?.()|[\]{}]/g, m => `\\${m}`)}/ping`);
  return searchRecursive(backendDir, re) > 0;
}

function countLegacyPrefix(modDir, modId) {
  const backendDir = path.join(modDir, 'backend');
  const re = new RegExp(`/api/modules/${modId.replace(/[-/\\^$*+?.()|[\]{}]/g, m => `\\${m}`)}\b`);
  return searchRecursive(backendDir, re);
}

const skipRouterSurface = new Set(['shared']); // libraries that are not routed

const items = [];
for (const ent of list(MODS_DIR)) {
  if (!ent.isDirectory()) continue;
  const id = ent.name;
  const modDir = path.join(MODS_DIR, id);
  const feDir = path.join(modDir, 'frontend');
  const beDir = path.join(modDir, 'backend');
  const migDir = path.join(modDir, 'db', 'migrations');
  const fe = exists(feDir);
  const be = exists(beDir);
  const mig = exists(migDir);
  const beIndex = exists(path.join(beDir, 'index.js'));
  const feScan = fe ? scanFrontendIndex(feDir) : { present:false, hasMain:false, hasDefault:false };
  const modCfg = exists(path.join(modDir, 'module.config.json'));
  const manifest = exists(path.join(modDir, 'config.json'));
  const ping = be ? hasPing(modDir, id) : false;
  const legacyPrefixRefs = be ? countLegacyPrefix(modDir, id) : 0;

  const errors = [];
  if (!fe) errors.push('missing_frontend');
  if (!be) errors.push('missing_backend');
  if (!mig) errors.push('missing_migrations_dir');
  if (!beIndex) errors.push('missing_backend_index');
  if (!modCfg) errors.push('missing_module_config');
  if (!manifest) errors.push('missing_manifest');
  if (!ping) errors.push('missing_ping');
  if (fe && !skipRouterSurface.has(id)) {
    if (!feScan.present) errors.push('missing_frontend_index');
    if (!feScan.hasMain) errors.push('missing_export_Main');
    if (!feScan.hasDefault) errors.push('missing_export_default');
  }

  const warnings = [];
  if (legacyPrefixRefs > 0) warnings.push('legacy_prefix_refs');

  items.push({ id, frontend: fe, backend: be, migrations: mig, backendIndex: beIndex, frontendIndex: feScan.present, exportMain: feScan.hasMain, exportDefault: feScan.hasDefault, moduleConfig: modCfg, manifest, ping, legacyPrefixRefs, errors, warnings });
}

const report = { ok: items.every(x => x.errors.length === 0), modules: items, generatedAt: new Date().toISOString() };
const outPath = path.join(MODS_DIR, 'module_compliance_report.json');
try { fs.writeFileSync(outPath, JSON.stringify(report, null, PRETTY ? 2 : 0)); } catch {}
const stdout = PRETTY ? JSON.stringify(report, null, 2) : JSON.stringify(report);
process.stdout.write(stdout + '\n');
if (!NO_FAIL && !report.ok) process.exit(1);
process.exit(0);
