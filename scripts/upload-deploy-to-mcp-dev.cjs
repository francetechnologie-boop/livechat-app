#!/usr/bin/env node
// Upload a deploy.sh (or any file) to the MCP-DEV server via base64 endpoint
// Usage:
//   node livechat-app/scripts/upload-deploy-to-mcp-dev.cjs <filePath> [serverBase] [token]
// Defaults:
//   serverBase: http://127.0.0.1:3010
//   token: from env MCP_DEV_TOKEN or empty

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const filePath = process.argv[2];
const serverBase = process.argv[3] || process.env.MCP_DEV_BASE || 'http://127.0.0.1:3010';
const token = process.argv[4] || process.env.MCP_DEV_TOKEN || '';

if (!filePath) {
  console.error('Usage: node livechat-app/scripts/upload-deploy-to-mcp-dev.cjs <filePath> [serverBase] [token]');
  process.exit(1);
}

let buf;
try { buf = fs.readFileSync(filePath); } catch (e) {
  console.error('Cannot read file: ' + filePath + ' -> ' + e.message);
  process.exit(1);
}

const payload = JSON.stringify({
  filename: path.basename(filePath),
  content_base64: buf.toString('base64'),
  content_type: 'text/x-shellscript'
});

function doPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(txt) }); }
        catch { resolve({ status: res.statusCode, body: txt }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const q = token ? ('?token=' + encodeURIComponent(token)) : '';
  const url = serverBase.replace(/\/$/, '') + '/mcp-dev/files/base64' + q;
  const r = await doPost(url, payload, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  if (r.status >= 200 && r.status < 300) {
    console.log('Uploaded to MCP-DEV:', r.body);
  } else {
    console.error('Upload failed:', r.status, r.body);
    process.exit(2);
  }
})().catch((e) => { console.error('Error:', e.message || e); process.exit(2); });

