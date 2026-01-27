// Direct OpenAI Responses call with function tools, resolving tool calls
// by calling the backend Actions bridge (/mcp-dev/actions/tools/call).
//
// Usage examples:
//   OPENAI_API_KEY=sk-... \
//   BACKEND_BASE=http://localhost:3010 \
//   MCP_DEV_TOKEN=... \
//   MESSAGE="list recent visitors (limit 5)" \
//   node scripts/openai-tools-direct.mjs
//
//   # or specify visitor id
//   VISITOR_ID=... node scripts/openai-tools-direct.mjs
//
// Env vars:
//   OPENAI_API_KEY     Required
//   OPENAI_MODEL       Optional, default gpt-4o-mini
//   BACKEND_BASE       Optional, default http://localhost:3010
//   MCP_DEV_TOKEN      Optional token for /mcp-dev routes
//   LIMIT              Optional default limit for list_recent_visitors
//   VISITOR_ID         If set, the prompt will instruct to get_visitor

import 'dotenv/config';
import OpenAI from 'openai';

const API_KEY = process.env.OPENAI_API_KEY || '';
if (!API_KEY) {
  console.error('OPENAI_API_KEY missing');
  process.exit(1);
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const BACKEND_BASE = (process.env.BACKEND_BASE || 'http://localhost:3010').replace(/\/$/, '');
const TOKEN = process.env.MCP_DEV_TOKEN || '';
const LIMIT = Math.max(1, Number(process.env.LIMIT || 5));
const VISITOR_ID = process.env.VISITOR_ID || '';
const MESSAGE = process.env.MESSAGE || (VISITOR_ID
  ? `Call get_visitor with {"visitorId":"${VISITOR_ID}"} and return only JSON.`
  : `Call list_recent_visitors with {"limit":${LIMIT}} and return only JSON.`);

const client = new OpenAI({ apiKey: API_KEY });

const functionTools = [
  {
    type: 'function',
    function: {
      name: 'list_recent_visitors',
      description: 'List recent visitors',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_visitor',
      description: 'Fetch a visitor by id',
      parameters: {
        type: 'object',
        properties: { visitorId: { type: 'string' } },
        required: ['visitorId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_agent_message',
      description: 'Send an agent message to a visitor',
      parameters: {
        type: 'object',
        properties: { visitorId: { type: 'string' }, message: { type: 'string' } },
        required: ['visitorId', 'message'],
      },
    },
  },
];

async function callBackendTool(name, args) {
  const url = new URL(`${BACKEND_BASE}/mcp-dev/actions/tools/call`);
  if (TOKEN) url.searchParams.set('token', TOKEN);
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args || {} }),
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || j?.ok === false) {
    throw new Error(`tool_call_failed ${name}: ${j?.message || j?.error || resp.status}`);
  }
  return j.output ?? j;
}

function extractToolCalls(resp) {
  const calls = [];
  try {
    const out = Array.isArray(resp?.output) ? resp.output : [];
    for (const item of out) {
      // Newer shape: item.content[] may contain { type:'tool_use', name, input, id }
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const c of content) {
        if (c?.type === 'tool_use' && c?.name) {
          calls.push({ id: c.id, name: c.name, arguments: c.input || {} });
        }
      }
      // Function-tools legacy: item.type === 'function_call'
      if (item?.type === 'function_call' && item?.name) {
        let parsed = {};
        try { parsed = item.arguments ? JSON.parse(item.arguments) : {}; } catch {}
        calls.push({ id: item.call_id || item.id, name: item.name, arguments: parsed });
      }
    }
  } catch {}
  return calls;
}

async function main() {
  let resp = await client.responses.create({
    model: MODEL,
    input: MESSAGE,
    tools: functionTools,
    tool_choice: 'auto',
    text: { format: { type: 'json' } },
    store: false,
  });

  for (let iter = 0; iter < 4; iter++) {
    const calls = extractToolCalls(resp);
    if (!calls.length) break;
    const tool_outputs = [];
    for (const call of calls) {
      const out = await callBackendTool(call.name, call.arguments);
      tool_outputs.push({ tool_call_id: call.id, output: JSON.stringify(out) });
    }
    // Continue response after tool output
    if (typeof client.responses.submitToolOutputs === 'function') {
      resp = await client.responses.submitToolOutputs(resp.id, { tool_outputs });
    } else {
      resp = await client.responses.create({ response_id: resp.id, tool_outputs, model: MODEL });
    }
  }

  const txt = resp?.output_text || '';
  if (!txt) {
    console.log('[no output]');
  } else {
    console.log(txt);
  }
}

main().catch((e) => {
  console.error('ERROR:', e?.response?.data || e?.message || e);
  process.exit(1);
});

