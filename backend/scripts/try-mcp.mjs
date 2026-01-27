// Simple MCP-DEV tester
//
// Modes (controlled by MCP_TRANSPORT):
//   - stream (default): Direct JSON-RPC over HTTP to /mcp-dev/stream
//   - sse: Use OpenAI Responses MCP tool with SSE server_url (/mcp-dev/events)
//
// Streamable HTTP examples:
//   MCP_TRANSPORT=stream \
//   MCP_SERVER_URL=https://chat.piscinesondespro.fr/mcp-dev/stream \
//   MCP_DEV_TOKEN=... \
//   node scripts/try-mcp.mjs
//
// SSE + OpenAI Responses examples:
//   OPENAI_API_KEY=sk-... \
//   MCP_TRANSPORT=sse \
//   MCP_SERVER_URL=https://chat.piscinesondespro.fr/mcp-dev/events \
//   MCP_DEV_TOKEN=... \
//   node scripts/try-mcp.mjs
//
// Optional envs (both modes):
//   LIMIT=1               # for list_recent_visitors
//   VISITOR_ID=...        # if set, calls get_visitor directly

import 'dotenv/config';
import OpenAI from 'openai';

const TRANSPORT = (process.env.MCP_TRANSPORT || 'stream').toLowerCase(); // 'stream' | 'sse'
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || (TRANSPORT === 'sse'
  ? 'https://chat.piscinesondespro.fr/mcp-dev/events'
  : 'https://chat.piscinesondespro.fr/mcp-dev/stream');
const MCP_DEV_TOKEN = process.env.MCP_DEV_TOKEN || process.env.MCP_TOKEN || '';
if (!MCP_DEV_TOKEN) {
  console.error('WARN: MCP_DEV_TOKEN missing - if your dev server requires a token, set MCP_DEV_TOKEN.');
}

// OpenAI client only needed in SSE mode
let client = null;
let OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
if (TRANSPORT === 'sse') {
  if (!OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY missing for SSE mode. Set it in env or use MCP_TRANSPORT=stream.');
    process.exit(1);
  }
  client = new OpenAI({ apiKey: OPENAI_API_KEY });
}

const visitorId = process.env.VISITOR_ID || '';
const limit = Math.max(1, Number(process.env.LIMIT || 1));

function buildInput() {
  if (visitorId) {
    return `Call get_visitor with {"visitorId":"${visitorId}"} and return only JSON.`;
  }
  return `Call list_recent_visitors with {"limit":${limit}}, then call get_visitor on that visitor_id and return only JSON.`;
}

async function callStream(method, params = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (MCP_DEV_TOKEN) headers.Authorization = `Bearer ${MCP_DEV_TOKEN}`;
  const r = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: String(Date.now()), method, params }),
  });
  if (!r.ok) {
    const text = await r.text().catch(()=> '');
    throw new Error(`HTTP ${r.status}: ${text || r.statusText}`);
  }
  const j = await r.json();
  if (j?.error) throw new Error(`${j.error?.code || ''} ${j.error?.message || 'jsonrpc_error'}`);
  return j?.result ?? null;
}

async function runStream() {
  // Initialize and list tools
  await callStream('initialize', {});
  const tools = await callStream('tools/list', {});
  const names = Array.isArray(tools?.tools) ? tools.tools.map(t => t.name) : [];
  console.log('Tools:', names.join(', ') || '(none)');

  async function extractText(result) {
    // Our server returns { content: [{ type:'text', text: JSON.stringify(obj) }] }
    const c = result?.content; if (!Array.isArray(c) || !c.length) return '';
    const t = c[0]?.text || '';
    return t;
  }

  if (visitorId) {
    const r = await callStream('tools/call', { name: 'get_visitor', arguments: { visitorId } });
    const txt = await extractText(r);
    try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); } catch { console.log(txt); }
    return;
  }

  // list_recent_visitors then get_visitor on the first visitor
  const r1 = await callStream('tools/call', { name: 'list_recent_visitors', arguments: { limit } });
  const txt1 = await extractText(r1);
  let list = [];
  try { list = JSON.parse(txt1); } catch {}
  const vid = list?.[0]?.visitor_id || list?.[0]?.visitorId || null;
  if (!vid) {
    console.log(txt1 || 'No visitor found');
    return;
  }
  const r2 = await callStream('tools/call', { name: 'get_visitor', arguments: { visitorId: vid } });
  const txt2 = await extractText(r2);
  try { console.log(JSON.stringify(JSON.parse(txt2), null, 2)); } catch { console.log(txt2); }
}

async function runSseWithOpenAI() {
  const resp = await client.responses.create({
    model,
    input: buildInput(),
    text: { format: { type: 'json' } },
    tools: [
      {
        type: 'mcp',
        server_url: MCP_SERVER_URL,
        headers: MCP_DEV_TOKEN ? { Authorization: `Bearer ${MCP_DEV_TOKEN}` } : undefined,
        allowed_tools: visitorId
          ? ['get_visitor']
          : ['list_recent_visitors', 'get_visitor'],
        require_approval: 'auto',
      },
    ],
    store: false,
  });
  const out = resp.output_text || '';
  console.log(out || '<no text>');
}

async function main() {
  if (TRANSPORT === 'sse') return runSseWithOpenAI();
  return runStream();
}

main().catch((e) => {
  const msg = e?.response?.data || e?.message || e;
  console.error('ERROR:', msg);
  process.exit(1);
});
