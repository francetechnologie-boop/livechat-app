import { respondWithPrompt } from '../../../../backend/lib/openaiResponses.js';
import { recordPromptConfigHistory } from '../../../../backend/lib/promptConfigHistory.js';
import { appendMessage, getChatbotsByIds, getPromptConfig, getTab, listPromptMcp2Servers, makeSessionId, normalizeTools, pickOrgId } from '../services/companyChatDb.js';

function joinInstructions(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (left && right) return `${left}\n\n${right}`;
  return left || right || '';
}

function safeJsonParse(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === 'object') return v;
    const s = String(v || '').trim();
    if (!s) return fallback;
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function sanitizeServerLabel(raw, fallback = 'mcp') {
  try {
    let s = String(raw || '').trim();
    s = s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) s = fallback;
    if (!/^[A-Za-z]/.test(s)) s = `mcp_${s}`;
    return s.slice(0, 64);
  } catch {
    return 'mcp';
  }
}

function uniqueServerLabel(raw, used) {
  const base = sanitizeServerLabel(raw || 'mcp');
  if (!used.has(base)) { used.add(base); return base; }
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base}_${i}`;
    if (!used.has(next)) { used.add(next); return next; }
  }
  return `${base}_${Date.now().toString(36)}`;
}

function redactMcpToolsInRequestBody(body) {
  try {
    const clone = body ? JSON.parse(JSON.stringify(body)) : {};
    const tools = Array.isArray(clone?.tools) ? clone.tools : [];
    for (const t of tools) {
      if (!t || t.type !== 'mcp') continue;
      if (t.authorization) t.authorization = '****';
      if (typeof t.server_url === 'string' && t.server_url) {
        try {
          const u = new URL(t.server_url);
          if (u.searchParams.get('token')) u.searchParams.set('token', '****');
          t.server_url = u.toString();
        } catch {}
      }
    }
    return clone;
  } catch {
    return {};
  }
}

function normalizeMessages(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const m of arr) {
    const role = String(m?.role || '').trim() || 'user';
    const content = String(m?.content || '');
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

export function registerCompanyChatRespondRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const chatLog = typeof ctx?.chatLog === 'function' ? ctx.chatLog : null;

  app.post('/api/company-chat/respond', async (req, res) => {
    const t0 = Date.now();
    try {
      const orgId = await pickOrgId(pool, req);
      const b = req.body || {};

      const tabId = String(b.tab_id || b.tabId || '').trim() || null;
      const tab = tabId ? await getTab(pool, orgId, tabId) : null;
      const bodyChatbotIds = Array.isArray(b.chatbot_ids) ? b.chatbot_ids.map(String).filter(Boolean) : [];
      const tabChatbotIds = Array.isArray(tab?.chatbot_ids) ? tab.chatbot_ids.map(String).filter(Boolean) : [];
      const chatbotIds = bodyChatbotIds.length ? bodyChatbotIds : tabChatbotIds;

      let primaryBot = null;
      let bots = [];
      if (chatbotIds.length) {
        bots = await getChatbotsByIds(pool, orgId, chatbotIds);
        const byId = new Map((bots || []).map((x) => [String(x.id_bot), x]));
        primaryBot = byId.get(String(chatbotIds[0])) || (bots && bots[0]) || null;
      }

      // Prefer chatbot-assigned prompt config (Company Chat tabs can be driven by Automation Suite chatbots).
      const botPromptCfgId = String(primaryBot?.prompt_config_id || primaryBot?.local_prompt_id || '').trim();
      const promptCfgId = botPromptCfgId || String(b.prompt_cfg_id || b.prompt_config_id || tab?.prompt_config_id || '').trim();
      if (!promptCfgId) return res.status(400).json({ ok: false, error: 'prompt_missing', message: 'Select a prompt profile (or attach a chatbot with a prompt).' });

      const promptCfg = await getPromptConfig(pool, orgId, promptCfgId);
      if (!promptCfg) return res.status(404).json({ ok: false, error: 'prompt_not_found', message: 'Prompt profile not found.' });

      const tools = normalizeTools(promptCfg.tools);
      const toolsFileSearch = !!tools.file_search;
      const toolsCodeInterpreter = !!tools.code_interpreter;
      const webSearchEnabled = !!tools.web_search;
      const webSearchAllowedDomains = Array.isArray(tools.web_search_allowed_domains) ? tools.web_search_allowed_domains.map(String).filter(Boolean) : undefined;
      const webSearchContextSize = tools.web_search_context_size != null ? String(tools.web_search_context_size) : undefined;

      const promptSeed = normalizeMessages(promptCfg.messages);
      const convo = normalizeMessages(b.messages);
      const lastUser = (() => {
        for (let i = convo.length - 1; i >= 0; i -= 1) {
          if (convo[i].role === 'user') return convo[i].content;
        }
        return '';
      })();
      if (!String(lastUser).trim()) return res.status(400).json({ ok: false, error: 'bad_request', message: 'No user message provided.' });

      const history = (() => {
        const trimmed = [];
        for (const m of convo) trimmed.push(m);
        // Drop the last user message from seed/history; it becomes `input`
        for (let i = trimmed.length - 1; i >= 0; i -= 1) {
          if (trimmed[i].role === 'user') { trimmed.splice(i, 1); break; }
        }
        return trimmed;
      })();

      const instructions = joinInstructions(promptCfg.dev_message, b.instructions);
      const model = String(b.model || tab?.model || promptCfg.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
      // Key precedence: request override > chatbot > prompt > server
      const apiKey = String(
        b.api_key ||
        primaryBot?.openai_api_key ||
        promptCfg.openai_api_key ||
        ctx?.extras?.getOpenaiApiKey?.() ||
        process.env.OPENAI_API_KEY ||
        ''
      ).trim();
      if (!apiKey) return res.status(400).json({ ok: false, error: 'openai_key_missing', message: 'OpenAI API key is missing for this prompt profile.' });

      const vectorStoreId = promptCfg.vector_store_id ? String(promptCfg.vector_store_id) : undefined;
      const vectorStoreIds = Array.isArray(promptCfg.vector_store_ids) ? promptCfg.vector_store_ids.map(String).filter(Boolean) : undefined;
      const promptId = promptCfg.prompt_id ? String(promptCfg.prompt_id) : undefined;
      const promptVersion = promptCfg.prompt_version ? String(promptCfg.prompt_version) : undefined;

      const seedMessages = [...promptSeed, ...history];

      const sessionId = String(b.sessionId || b.session_id || '').trim() || makeSessionId({ tabId });

      // Union MCP2 servers across selected chatbots' prompt configs (matches Company Chat UI expectation)
      const extraTools = [];
      try {
        const promptIds = [];
        const addPromptId = (id) => { const s = String(id || '').trim(); if (s) promptIds.push(s); };
        if (promptCfgId) addPromptId(promptCfgId);
        for (const bot of bots || []) addPromptId(bot?.prompt_config_id || bot?.local_prompt_id);
        const uniqPromptIds = Array.from(new Set(promptIds));
        const rows = await listPromptMcp2Servers(pool, uniqPromptIds);
        const seenServers = new Set();
        const seenLabels = new Set();
        for (const srow of rows || []) {
          const sid = String(srow?.id || '').trim();
          if (!sid || seenServers.has(sid)) continue;
          seenServers.add(sid);

          const opts = safeJsonParse(srow.options, {});
          const pref = (opts && opts.server_url_pref === 'stream') ? 'stream' : 'sse';
          let url = pref === 'stream' ? (srow.stream_url || srow.sse_url || '') : (srow.sse_url || srow.stream_url || '');
          url = String(url || '').trim();
          if (!url) continue;
          try {
            const token = String(srow.token || '').trim();
            if (token) {
              const u = new URL(url);
              if (!u.searchParams.get('token')) u.searchParams.set('token', token);
              url = u.toString();
            }
          } catch {}
          const allowed = Array.isArray(opts?.allowed_tools) ? opts.allowed_tools.map(String).filter(Boolean) : undefined;
          const serverLabel = uniqueServerLabel(String(srow.name || sid), seenLabels);
          extraTools.push({ type: 'mcp', server_url: url, server_label: serverLabel, allowed_tools: allowed, require_approval: 'never' });
        }
      } catch {}

      const result = await respondWithPrompt({
        apiKey,
        model,
        promptId,
        promptVersion,
        input: lastUser,
        seedMessages,
        instructions,
        toolsFileSearch,
        toolsCodeInterpreter,
        vectorStoreId,
        vectorStoreIds,
        webSearchEnabled,
        webSearchAllowedDomains,
        webSearchContextSize,
        extraTools,
      });

      // Persist messages (best-effort)
      try { await appendMessage(pool, orgId, { tabId, sessionId, role: 'user', content: lastUser }); } catch {}
      try { await appendMessage(pool, orgId, { tabId, sessionId, role: 'assistant', content: result.text || '', responseId: result.response_id || null }); } catch {}

      const ms = Date.now() - t0;
      try {
        if (chatLog) chatLog('company-chat.respond', {
          ok: true,
          tab_id: tabId,
          prompt_config_id: promptCfgId,
          chatbot_ids: chatbotIds.length ? chatbotIds : undefined,
          mcp_tools_count: Array.isArray(extraTools) ? extraTools.length : 0,
          ms,
        });
      } catch {}

      const safeReqBody = redactMcpToolsInRequestBody(result.request_body || {});
      try {
        await recordPromptConfigHistory(pool, {
          promptConfigId: promptCfgId,
          input: lastUser,
          output: result.text || '',
          requestBody: safeReqBody,
          response: result.raw || null,
          ms,
        });
      } catch {}
      res.json({ ok: true, sessionId, tab_id: tabId, text: result.text || '', ...result, request_body: safeReqBody, ms });
    } catch (e) {
      const msg = e?.message || String(e);
      const ms = Date.now() - t0;
      try { if (chatLog) chatLog('company-chat.respond', { ok: false, error: msg, ms }); } catch {}
      res.status(500).json({ ok: false, error: 'server_error', message: msg });
    }
  });
}
