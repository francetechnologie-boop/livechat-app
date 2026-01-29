#!/usr/bin/env node
/*
  Lightweight migration lint to catch the most common Postgres syntax pitfalls
  we hit in this project (before running installers/deploy).

  Usage (from repo root):
    node backend/scripts/check-migrations.cjs
*/

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

// Avoid noisy crashes when piping output to `head`, etc.
try {
  process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });
  process.stderr.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });
} catch {}

function listSqlFiles(dir) {
  const out = [];
  const walk = (p) => {
    let ents = [];
    try { ents = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.sql')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function rel(p) {
  try { return path.relative(repoRoot, p) || p; } catch { return p; }
}

const roots = [
  path.join(repoRoot, 'migrations'),
  path.join(repoRoot, 'modules'),
];

const sqlFiles = [];
// Root migrations/*.sql
sqlFiles.push(...listSqlFiles(roots[0]));
// Module migrations: modules/*/db/migrations/*.sql
try {
  const moduleIds = fs.readdirSync(roots[1], { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const id of moduleIds) {
    const migDir = path.join(roots[1], id, 'db', 'migrations');
    if (fs.existsSync(migDir)) sqlFiles.push(...listSqlFiles(migDir));
  }
} catch {}

const errors = [];
const warnings = [];

for (const file of sqlFiles.sort()) {
  let sql = '';
  try { sql = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const s = sql;
  const sNoComments = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');

  // 1) Nested dollar quoting: DO $$ ... EXECUTE $$ ... $$; ... $$; is a hard parser error.
  if (/\bDO\s+\$\$\b/i.test(sNoComments) && /\bEXECUTE\s+\$\$\b/i.test(sNoComments)) {
    errors.push({
      file,
      code: 'nested_dollar_quote',
      msg: 'Found DO $$ ... EXECUTE $$ ... $$ (use distinct tags: DO $do$ ... EXECUTE $sql$ ... $sql$).',
    });
  }

  // 2) Unsupported syntax in Postgres.
  if (/ADD\s+CONSTRAINT\s+IF\s+NOT\s+EXISTS/i.test(sNoComments)) {
    errors.push({
      file,
      code: 'add_constraint_if_not_exists',
      msg: 'Postgres does not support "ADD CONSTRAINT IF NOT EXISTS" (use guarded DO/EXCEPTION block).',
    });
  }

  // 3) Common footgun: embedding rollback SQL in the same file when installers run the file verbatim.
  if (/^--\s*down\b/im.test(s)) {
    warnings.push({
      file,
      code: 'contains_down_section',
      msg: 'Contains a "-- down" section; ensure it is not executable SQL if your installer runs the whole file.',
    });
  }

  // 4) DO $$ blocks can be accidentally terminated if someone writes "$$" in a comment inside the block.
  // We warn on "$$" inside comments to reduce "syntax error at or near dollar" incidents.
  if (/(^|\n)\s*--[^\n]*\$\$/m.test(s) || /\/\*[\s\S]*\$\$[\s\S]*\*\//m.test(s)) {
    warnings.push({
      file,
      code: 'comment_contains_dollar_delim',
      msg: 'Comment contains "$$" which can break DO $$ ... $$ blocks; prefer tagged delimiters like DO $do$ ... END $do$;',
    });
  }

  // 5) Another common pitfall: defining a plpgsql function with AS $$ ... $$ inside a DO $$ ... $$ block.
  // The inner $$ terminates the DO string. Use DO $do$ ... END $do$ instead.
  try {
    const doRe = /\bDO\s+\$\$\b/ig;
    while (true) {
      const m = doRe.exec(sNoComments);
      if (!m) break;
      const start = m.index;
      const endRe = /\bEND\s*\$\$\s*;/ig;
      endRe.lastIndex = doRe.lastIndex;
      const endM = endRe.exec(sNoComments);
      if (!endM) break;
      const block = sNoComments.slice(start, endM.index + endM[0].length);
      if (/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(block) && /\bAS\s+\$\$/i.test(block)) {
        errors.push({
          file,
          code: 'do_contains_function_dollar_body',
          msg: 'Found DO $$ containing CREATE FUNCTION ... AS $$ ... $$ (use a tagged DO delimiter like DO $do$ ... END $do$).',
        });
        break;
      }
      doRe.lastIndex = endM.index + endM[0].length;
    }
  } catch {}
}

if (errors.length) {
  process.stderr.write(`Migration lint: ${errors.length} error(s)\n`);
  for (const e of errors) {
    process.stderr.write(`- ${rel(e.file)}: ${e.msg}\n`);
  }
  if (warnings.length) {
    process.stderr.write(`\nWarnings: ${warnings.length}\n`);
    for (const w of warnings) process.stderr.write(`- ${rel(w.file)}: ${w.msg}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Migration lint: OK (${sqlFiles.length} files checked)\n`);
  if (warnings.length) {
    process.stdout.write(`Warnings: ${warnings.length}\n`);
    for (const w of warnings) process.stdout.write(`- ${rel(w.file)}: ${w.msg}\n`);
  }
}
