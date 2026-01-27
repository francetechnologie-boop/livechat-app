#!/usr/bin/env node
// Restore full Prompts.jsx from backup into modules path (works for nested or flat layout).
const fs = require('fs');
const path = require('path');

function log(m) { console.log(`[restore] ${m}`); }
function fail(m, c=1) { console.error(`[restore:error] ${m}`); process.exit(c); }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

const ROOT = path.resolve(__dirname, '..'); // e.g. .../livechat-app

// Determine app base (supports both layouts):
// - flat: ROOT/frontend, ROOT/modules
// - nested: ROOT/livechat-app/frontend, ROOT/livechat-app/modules
const CANDIDATES = [
  path.join(ROOT),
  path.join(ROOT, 'livechat-app'),
];
let APP = null;
for (const base of CANDIDATES) {
  if (exists(path.join(base, 'frontend', 'vite.config.js'))) { APP = base; break; }
}
if (!APP) fail('Could not locate app base (frontend/vite.config.js).');

const TARGET = path.join(APP, 'modules', 'automation-suite', 'frontend', 'Prompts.jsx');
const SRC_CANDIDATES = [
  path.join(ROOT, 'tmp_backup_prompts.jsx'),
  path.join(ROOT, 'tmp_prompts_full.jsx'),
  path.join(ROOT, '..', 'tmp_backup_prompts.jsx'),
  path.join(ROOT, '..', 'tmp_prompts_full.jsx'),
];

let SRC = SRC_CANDIDATES.find(exists);
if (!SRC) fail('No backup file found (tmp_backup_prompts.jsx or tmp_prompts_full.jsx).');

let content = fs.readFileSync(SRC, 'utf8');
// Sanitize control characters and map common arrow controls if present
content = content.replace(/[\u0000-\u0007\u000B\u000C\u000E-\u0017\u001A-\u001F]/g, '');
content = content.replace(/\u0018/g, '↑').replace(/\u0019/g, '↓');

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, content, 'utf8');
log(`Restored Prompts.jsx from ${path.basename(SRC)} -> ${path.relative(ROOT, TARGET)}`);

