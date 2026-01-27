#!/usr/bin/env node
/*
  Fix Vite build hanging at "transforming..." for the frontend.

  What it does:
  - Detect Node + npm versions for sanity
  - Optionally disable duplicate Vite config (renames vite.config.mjs -> .bak if both .js and .mjs exist)
  - Clean dist, node_modules and Vite caches
  - Reinstall via npm ci
  - Run a debug build with DEBUG=vite:* and --debug/--force, teeing output to build-debug.log

  Usage:
    node ../scripts/fix-frontend-build.cjs     (from frontend)
    node ./scripts/fix-frontend-build.cjs      (from livechat-app/livechat-app)
*/

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');

function log(msg = '') { process.stdout.write(`[fix] ${msg}\n`); }
function warn(msg = '') { process.stderr.write(`[fix:warn] ${msg}\n`); }
function fail(msg, code = 1) { process.stderr.write(`[fix:error] ${msg}\n`); process.exit(code); }

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

function ensureFrontendDir() {
  if (!exists(FRONTEND)) fail(`Frontend not found at ${FRONTEND}`);
  if (!exists(path.join(FRONTEND, 'package.json'))) fail('Frontend package.json not found');
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function checkNodeAndNpm() {
  const nodeV = process.version;
  // npm version
  const npmV = spawnSync('npm', ['--version'], { cwd: FRONTEND, encoding: 'utf8' });
  const npmVersion = (npmV.stdout || '').trim();
  log(`Node: ${nodeV} | npm: ${npmVersion}`);
  const major = Number((nodeV.match(/v(\d+)/) || [])[1] || 0);
  if (major && major < 18) warn('Node < 18 detected. Consider upgrading to Node 18 or 20.');
}

function maybeDisableDuplicateViteConfig() {
  const js = path.join(FRONTEND, 'vite.config.js');
  const mjs = path.join(FRONTEND, 'vite.config.mjs');
  if (exists(js) && exists(mjs)) {
    try {
      const bak = `${mjs}.bak`;
      fs.renameSync(mjs, bak);
      log(`Renamed duplicate config: ${path.basename(mjs)} -> ${path.basename(bak)}`);
    } catch (e) {
      warn(`Could not rename ${path.basename(mjs)}: ${e && e.message}`);
    }
  }
}

function cleanCaches() {
  log('Cleaning dist, node_modules, and caches...');
  rmrf(path.join(FRONTEND, 'dist'));
  rmrf(path.join(FRONTEND, 'node_modules'));
  rmrf(path.join(FRONTEND, '.vite'));
  rmrf(path.join(FRONTEND, '.cache'));
}

function reinstall() {
  const hasLock = exists(path.join(FRONTEND, 'package-lock.json'));
  const cmd = 'npm';
  const args = hasLock ? ['ci'] : ['install'];
  log(`Installing deps with: ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: FRONTEND, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail('Dependency install failed');
}

function runDebugBuild() {
  log('Running debug build (logs -> build-debug.log)...');
  const logFile = path.join(FRONTEND, 'build-debug.log');
  try { fs.unlinkSync(logFile); } catch {}
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  const env = { ...process.env, DEBUG: 'vite:*' };
  const child = spawn('npm', ['run', 'build', '--', '--debug', '--force', '--clearScreen', 'false'], {
    cwd: FRONTEND,
    env,
    shell: process.platform === 'win32',
  });
  child.stdout.on('data', (d) => { process.stdout.write(d); out.write(d); });
  child.stderr.on('data', (d) => { process.stderr.write(d); out.write(d); });

  const MAX_MS = 10 * 60 * 1000; // 10 minutes
  const timer = setTimeout(() => {
    warn('Build taking unusually long; terminating for safety. See build-debug.log');
    try { child.kill('SIGTERM'); } catch {}
  }, MAX_MS);

  child.on('close', (code) => {
    clearTimeout(timer);
    out.end();
    if (code === 0) {
      log('Build completed successfully.');
      process.exit(0);
    } else {
      fail(`Build exited with code ${code}. See build-debug.log`);
    }
  });
}

function main() {
  log('Vite build fixer starting...');
  ensureFrontendDir();
  checkNodeAndNpm();
  maybeDisableDuplicateViteConfig();
  cleanCaches();
  reinstall();
  runDebugBuild();
}

main();

