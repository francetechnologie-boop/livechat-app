#!/usr/bin/env node
// Strip all /* ... */ block comments from a JS file while preserving strings and templates.
const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: strip-block-comments.cjs <file>'); process.exit(2); }
const src = fs.readFileSync(path, 'utf8');
let out = '';
let i = 0;
const n = src.length;
let state = 'normal'; // normal | sstring | dstring | template | block_comment
let tmplDepth = 0; // nested ${ } depth in template
while (i < n) {
  const ch = src[i];
  const nxt = i+1 < n ? src[i+1] : '';
  if (state === 'block_comment') {
    if (ch === '*' && nxt === '/') { i += 2; state = 'normal'; continue; }
    i++; // skip
    continue;
  }
  if (state === 'normal') {
    if (ch === '/' && nxt === '*') { state = 'block_comment'; i += 2; continue; }
    if (ch === '\'' ) { state = 'sstring'; out += ch; i++; continue; }
    if (ch === '"') { state = 'dstring'; out += ch; i++; continue; }
    if (ch === '`') { state = 'template'; tmplDepth = 0; out += ch; i++; continue; }
    out += ch; i++; continue;
  }
  if (state === 'sstring') {
    out += ch; i++;
    if (ch === '\\') { if (i < n) { out += src[i]; i++; } continue; }
    if (ch === '\'') { state = 'normal'; }
    continue;
  }
  if (state === 'dstring') {
    out += ch; i++;
    if (ch === '\\') { if (i < n) { out += src[i]; i++; } continue; }
    if (ch === '"') { state = 'normal'; }
    continue;
  }
  if (state === 'template') {
    out += ch; i++;
    if (ch === '\\') { if (i < n) { out += src[i]; i++; } continue; }
    if (ch === '`' && tmplDepth === 0) { state = 'normal'; continue; }
    if (ch === '$' && nxt === '{') { tmplDepth++; out += '{'; i++; continue; }
    if (ch === '}' && tmplDepth > 0) { tmplDepth--; continue; }
    continue;
  }
}
fs.writeFileSync(path, out, 'utf8');