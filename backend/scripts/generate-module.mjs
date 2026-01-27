#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

function toSlug(s = '') {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'custom-module';
}

function parseArgs(argv) {
  const out = { name: '', id: '', category: 'custom', place: 'after', target: 'modules', index: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i+1];
    if (a === '--name') { out.name = next; i++; }
    else if (a === '--id') { out.id = next; i++; }
    else if (a === '--category') { out.category = next; i++; }
    else if (a === '--place') { out.place = next; i++; }
    else if (a === '--target') { out.target = next; i++; }
    else if (a === '--index') { out.index = Number(next||0); i++; }
  }
  if (!out.id) out.id = toSlug(out.name);
  return out;
}

function copyRecursive(src, dest) {
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
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.name || !opts.id) {
    console.error('Usage: node scripts/generate-module.mjs --name "My Module" --id my-module [--category custom] [--place after|before|index] [--target modules] [--index 0]');
    process.exit(1);
  }

  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const modulesRoot = path.resolve(repoRoot, '../modules');
  const templateDir = path.join(modulesRoot, 'module-template');
  const targetDir = path.join(modulesRoot, opts.id);
  if (!fs.existsSync(templateDir)) throw new Error('module-template not found');
  if (fs.existsSync(targetDir)) throw new Error('target folder already exists');

  copyRecursive(templateDir, targetDir);

  // Patch config.json
  const cfgPath = path.join(targetDir, 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.id = opts.id;
    cfg.name = opts.name;
    cfg.category = cfg.category || opts.category;
    cfg.database = cfg.database || { table: 'modules', record: {} };
    cfg.database.record = cfg.database.record || {};
    cfg.database.record.name = opts.id;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  } catch {}

  // Patch module.config.json
  const mcfgPath = path.join(targetDir, 'module.config.json');
  try {
    const mcfg = JSON.parse(fs.readFileSync(mcfgPath, 'utf8'));
    mcfg.name = opts.id;
    fs.writeFileSync(mcfgPath, JSON.stringify(mcfg, null, 2));
  } catch {}

  // Ensure frontend index exists
  try {
    const feDir = path.join(targetDir, 'frontend');
    const idxJs = path.join(feDir, 'index.js');
    const idxTsx = path.join(feDir, 'index.tsx');
    if (!fs.existsSync(idxJs) && !fs.existsSync(idxTsx)) {
      const pageTsx = path.join(feDir, 'pages', 'ExamplePage.tsx');
      if (fs.existsSync(pageTsx)) {
        fs.writeFileSync(idxTsx, `export { default as Main } from "./pages/ExamplePage";\nexport { default as Settings } from "./pages/Settings";\n`);
      }
    }
  } catch {}

  // Sidebar extension entry
  try {
    const extPath = path.join(modulesRoot, 'shared', 'frontend', 'sidebar.extensions.json');
    const ext = fs.existsSync(extPath) ? JSON.parse(fs.readFileSync(extPath, 'utf8')) : [];
    const entry = { id: `mod-${opts.id}`, label: opts.name, hash: `#/modules/${opts.id}` };
    if (opts.place === 'before' && opts.target) entry.beforeId = opts.target;
    else if (opts.place === 'after' && opts.target) entry.afterId = opts.target;
    else if (opts.place === 'index' && Number.isFinite(opts.index)) entry.index = Math.max(0, Math.min(50, Number(opts.index)||0));
    const exists = Array.isArray(ext) && ext.some((e) => e && e.id === entry.id);
    const next = exists ? ext.map((e) => (e.id === entry.id ? { ...e, ...entry } : e)) : [...(Array.isArray(ext) ? ext : []), entry];
    fs.writeFileSync(extPath, JSON.stringify(next, null, 2));
  } catch {}

  // Auto-run installer
  try {
    const installer = path.join(targetDir, 'backend', 'installer.js');
    if (fs.existsSync(installer)) {
      await new Promise((resolve) => {
        const child = spawn(process.execPath, [installer], { stdio: 'inherit' });
        child.on('exit', () => resolve());
        child.on('error', () => resolve());
      });
    }
  } catch {}

  console.log(`[generator] Created module '${opts.id}' at ${targetDir}`);
}

main().catch((e) => { console.error('[generator] failed:', e?.message || e); process.exit(1); });
