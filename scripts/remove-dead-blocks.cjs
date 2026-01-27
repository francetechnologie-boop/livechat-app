#!/usr/bin/env node
const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: remove-dead-blocks.cjs <file>'); process.exit(2); }
const src = fs.readFileSync(path,'utf8');
const n = src.length;
let i = 0;
let state = 'normal';
let tmplDepth = 0;
const blocks = [];
while (i < n) {
  const ch = src[i];
  const nx = i+1 < n ? src[i+1] : '';
  if (state === 'normal') {
    if (ch === '/' && nx === '*') {
      const start = i;
      i += 2;
      // collect until */ (no nested comments in JS)
      while (i < n) {
        if (src[i] === '*' && (i+1 < n && src[i+1] === '/')) { i += 2; break; }
        i++;
      }
      const end = i; // index after */
      const content = src.slice(start, end);
      blocks.push({ start, end, content });
      continue;
    }
    if (ch === '\'' ) { state = 'sstring'; i++; continue; }
    if (ch === '"') { state = 'dstring'; i++; continue; }
    if (ch === '`') { state = 'template'; tmplDepth = 0; i++; continue; }
    i++; continue;
  }
  if (state === 'sstring') { if (ch === '\\') { i += 2; } else { if (ch === '\'') state='normal'; i++; } continue; }
  if (state === 'dstring') { if (ch === '\\') { i += 2; } else { if (ch === '"') state='normal'; i++; } continue; }
  if (state === 'template') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`' && tmplDepth === 0) { state='normal'; i++; continue; }
    if (ch === '$' && nx === '{') { tmplDepth++; i += 2; continue; }
    if (ch === '}' && tmplDepth > 0) { tmplDepth--; i++; continue; }
    i++; continue;
  }
}
// Decide which to remove
const deadRe = /moved to module|moved to modules|moved to module hook/i;
const toSkip = blocks.filter(b => deadRe.test(b.content));
if (!toSkip.length) {
  console.error('No dead blocks matched');
  process.exit(0);
}
// Rebuild skipping matched blocks
let out = '';
let pos = 0;
for (const b of toSkip.sort((a,b)=>a.start-b.start)) {
  out += src.slice(pos, b.start);
  pos = b.end;
}
out += src.slice(pos);
fs.writeFileSync(path, out, 'utf8');