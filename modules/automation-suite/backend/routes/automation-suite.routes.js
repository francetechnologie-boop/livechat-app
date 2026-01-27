import { respondWithPrompt } from '../../../../backend/lib/openaiResponses.js';
import { recordPromptConfigHistory } from '../../../../backend/lib/promptConfigHistory.js';

export function registerAutomationSuiteRoutes(app, ctx = {}) {
  const pool = ctx?.pool;
  const chatLog = typeof ctx?.chatLog === 'function' ? ctx.chatLog : null;

  function toNullableInt(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (!/^-?\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
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

  function normalizeMessages(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const m of arr) {
      const role = String(m?.role || '').trim() || 'user';
      const content = String(m?.content ?? m?.text ?? '');
      if (!content.trim()) continue;
      out.push({ role, content });
    }
    return out;
  }

  function joinInstructions(a, b) {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    if (left && right) return `${left}\n\n${right}`;
    return left || right || '';
  }

  function normalizeTools(raw) {
    const obj = safeJsonParse(raw, {});
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
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

  const resolveDefaultOrgId = async () => {
    if (!pool) return null;
    try {
      // Prefer first existing organization; create a 'Default' if none.
      let r = await pool.query('SELECT id FROM organizations ORDER BY id ASC LIMIT 1');
      if (!r.rowCount) {
        try { r = await pool.query("INSERT INTO organizations(name) VALUES('Default') RETURNING id"); } catch {}
      }
      if (r && r.rowCount) return toNullableInt(r.rows[0].id);
    } catch {}
    return null;
  };

  const pickOrgId = async (req) => {
    try {
      const raw = req?.headers?.['x-org-id'] ?? req?.org_id ?? null;
      const parsed = toNullableInt(raw);
      if (parsed != null) return parsed;
      return await resolveDefaultOrgId();
    } catch {
      return await resolveDefaultOrgId();
    }
  };

  const ensureTables = async () => {
    if (!pool) return;
    // Config table (legacy JSON store, kept for compatibility)
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_automation_suite_config (
      id SERIAL PRIMARY KEY,
      org_id INT NULL,
      key TEXT NOT NULL,
      value JSONB NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );`);
    // Expected index (older installs may miss it)
    try { await pool.query(`CREATE INDEX IF NOT EXISTS mod_as_config_org_idx ON mod_automation_suite_config(org_id)`); } catch {}
    // Chatbots (table-backed)
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_automation_suite_chatbots (
      id_bot TEXT PRIMARY KEY,
      org_id INT NULL,
      id_shop INT NULL,
      id_lang INT NULL,
      shop_name TEXT NULL,
      lang_iso TEXT NULL,
      name TEXT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      bot_behavior TEXT NULL,
      instructions TEXT NULL,
      openai_api_key TEXT NULL,
      prompt_id TEXT NULL,
      prompt_version TEXT NULL,
      mcp_enabled BOOLEAN NULL,
      mcp_tools JSONB NULL,
      local_prompt_id TEXT NULL,
      prompt_config_id TEXT NULL,
      mcp_server_name TEXT NULL,
      web_search_enabled BOOLEAN NULL
    );`);
    // Ensure newer columns exist on older installs
    try { await pool.query(`ALTER TABLE mod_automation_suite_chatbots ADD COLUMN IF NOT EXISTS id_shop INT NULL`); } catch {}
    try { await pool.query(`ALTER TABLE mod_automation_suite_chatbots ADD COLUMN IF NOT EXISTS id_lang INT NULL`); } catch {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS mod_as_chatbots_shop_lang_idx ON mod_automation_suite_chatbots(id_shop, id_lang)`); } catch {}
    try { await pool.query(`ALTER TABLE mod_automation_suite_chatbots
      ADD CONSTRAINT fk_mod_as_chatbots_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED`);
    } catch {}
    // Welcome messages (table-backed)
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_automation_suite_welcome_messages (
      id TEXT PRIMARY KEY,
      org_id INT NULL,
      id_shop INT NULL,
      id_lang INT NULL,
      title TEXT NULL,
      content TEXT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );`);
    // Ensure newer columns exist on older installs
    try { await pool.query(`ALTER TABLE mod_automation_suite_welcome_messages ADD COLUMN IF NOT EXISTS id_shop INT NULL`); } catch {}
    try { await pool.query(`ALTER TABLE mod_automation_suite_welcome_messages ADD COLUMN IF NOT EXISTS id_lang INT NULL`); } catch {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS mod_as_wm_shop_lang_idx ON mod_automation_suite_welcome_messages(id_shop, id_lang)`); } catch {}
    try { await pool.query(`ALTER TABLE mod_automation_suite_welcome_messages
      ADD CONSTRAINT fk_mod_as_wm_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED`);
    } catch {}
    // Link chatbot -> welcome message (optional association)
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_automation_suite_chatbot_welcome_link (
      id_bot TEXT PRIMARY KEY REFERENCES mod_automation_suite_chatbots(id_bot) ON DELETE CASCADE,
      welcome_message_id TEXT NOT NULL REFERENCES mod_automation_suite_welcome_messages(id) ON DELETE CASCADE
    );`);
    // Conversation hub selections (selected chatbots for org)
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_automation_suite_hub_selection (
      org_id INT NULL,
      id_bot TEXT NOT NULL REFERENCES mod_automation_suite_chatbots(id_bot) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (org_id, id_bot)
    );`);
    try { await pool.query(`ALTER TABLE mod_automation_suite_hub_selection
      ADD CONSTRAINT fk_mod_as_hub_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED`);
    } catch {}
  };

  // Ensure core schema eagerly on module load (best-effort) so the Module Manager schema check converges without manual navigation.
  try { ensureTables(); } catch {}

  // Legacy JSON config helpers (kept as fallback if needed)
  const getConfig = async (org_id, key, defVal) => {
    if (!pool) return defVal;
    await ensureTables();
    const r = await pool.query(`SELECT value FROM mod_automation_suite_config WHERE (
      ($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id::text = $1::text)
    ) AND key = $2`, [org_id ?? null, String(key)]);
    if (r.rows && r.rows[0] && r.rows[0].value != null) return r.rows[0].value;
    return defVal;
  };
  const setConfig = async (org_id, key, value) => {
    if (!pool) return false;
    await ensureTables();
    await pool.query(`INSERT INTO mod_automation_suite_config(org_id, key, value, created_at, updated_at)
                      VALUES ($1,$2,$3,NOW(),NOW())
                      ON CONFLICT (org_id, key)
                      DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [org_id ?? null, String(key), value]);
    return true;
  };

  app.get('/api/automation-suite/ping', (_req, res) => res.json({ ok: true, module: 'automation-suite' }));

  // ----- Chatbots (JSON-config backed) -----
  app.get('/api/automation-suite/chatbots', async (req, res) => {
    try {
      await ensureTables();
      const rawOrg = (req.headers && (req.headers['x-org-id'] ?? req.headers['X-Org-Id'])) ?? null;
      const hasOrg = rawOrg != null && String(rawOrg).trim() !== '' && /^\d+$/.test(String(rawOrg));
      const base = `SELECT c.id_bot, c.id_shop, c.id_lang, c.shop_name, c.lang_iso, c.name, COALESCE(c.enabled, TRUE) AS enabled,
                           c.bot_behavior, c.instructions, c.openai_api_key, c.prompt_id, c.prompt_version,
                           c.mcp_enabled, c.mcp_tools, c.local_prompt_id, c.prompt_config_id, c.mcp_server_name, c.web_search_enabled,
                           l.welcome_message_id,
                           (COALESCE(c.openai_api_key,'') <> '') AS has_api_key
                      FROM mod_automation_suite_chatbots c
                 LEFT JOIN mod_automation_suite_chatbot_welcome_link l ON l.id_bot = c.id_bot`;
      const order = ' ORDER BY c.updated_at DESC, c.created_at DESC';
      let r;
      if (hasOrg) {
        const org = Number(rawOrg);
        r = await pool.query(base + ' WHERE c.org_id = $1::int' + order, [org]);
      } else {
        // No org filter provided → return all (transitional compatibility while legacy rows have NULL org_id)
        r = await pool.query(base + order);
      }
      return res.json(r.rows || []);
    } catch (e) { return res.status(500).json([]); }
  });
  app.post('/api/automation-suite/chatbots', async (req, res) => {
    try {
      const org = await pickOrgId(req);
      await ensureTables();
      const b = req.body || {};
      const id_bot = String(b.id_bot || Date.now());
      const id_shop = toNullableInt(b.id_shop ?? b.idShop ?? null);
      const id_lang = toNullableInt(b.id_lang ?? b.id_Lang ?? b.idLang ?? null);
      const shop = String(b.shop_name || '');
      const lang = String(b.lang_iso || '');
      const name = b.name ? String(b.name) : null;
      await pool.query(
        `INSERT INTO mod_automation_suite_chatbots (id_bot, org_id, id_shop, id_lang, shop_name, lang_iso, name, enabled, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW(),NOW())
         ON CONFLICT (id_bot) DO UPDATE SET id_shop=EXCLUDED.id_shop, id_lang=EXCLUDED.id_lang, shop_name=EXCLUDED.shop_name, lang_iso=EXCLUDED.lang_iso, name=EXCLUDED.name, updated_at=NOW()`,
        [id_bot, org ?? null, id_shop, id_lang, shop, lang, name]
      );
      res.json({ ok: true, id_bot });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });
  app.post('/api/automation-suite/chatbots/:id/update', async (req, res) => {
    try {
      await ensureTables();
      const id = String(req.params.id);
      const b = req.body || {};
      const fields = ['id_shop', 'id_lang', 'shop_name', 'lang_iso', 'name', 'enabled', 'bot_behavior', 'instructions', 'openai_api_key', 'prompt_id', 'prompt_version', 'mcp_enabled', 'mcp_tools', 'local_prompt_id', 'prompt_config_id', 'mcp_server_name', 'web_search_enabled'];
      const sets = [];
      const vals = [];
      for (const f of fields) {
        if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
        const nextVal = (f === 'id_shop' || f === 'id_lang') ? toNullableInt(b[f]) : b[f];
        sets.push(`${f} = $${sets.length + 1}`);
        vals.push(nextVal);
      }
      // Backward compatible aliases (some UIs send id_Lang / idShop / idLang)
      if (Object.prototype.hasOwnProperty.call(b, 'id_Lang') && !Object.prototype.hasOwnProperty.call(b, 'id_lang')) {
        sets.push(`id_lang = $${sets.length + 1}`);
        vals.push(toNullableInt(b.id_Lang));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'idShop') && !Object.prototype.hasOwnProperty.call(b, 'id_shop')) {
        sets.push(`id_shop = $${sets.length + 1}`);
        vals.push(toNullableInt(b.idShop));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'idLang') && !Object.prototype.hasOwnProperty.call(b, 'id_lang')) {
        sets.push(`id_lang = $${sets.length + 1}`);
        vals.push(toNullableInt(b.idLang));
      }
      // Manage welcome link separately
      if (Object.prototype.hasOwnProperty.call(b, 'welcome_message_id')) {
        const wm = b.welcome_message_id ? String(b.welcome_message_id) : '';
        if (wm) {
          try { await pool.query(`INSERT INTO mod_automation_suite_chatbot_welcome_link (id_bot, welcome_message_id) VALUES ($1,$2) ON CONFLICT (id_bot) DO UPDATE SET welcome_message_id=EXCLUDED.welcome_message_id`, [id, wm]); } catch {}
        } else {
          try { await pool.query(`DELETE FROM mod_automation_suite_chatbot_welcome_link WHERE id_bot=$1`, [id]); } catch {}
        }
      }
      if (sets.length) {
        vals.push(id);
        await pool.query(`UPDATE mod_automation_suite_chatbots SET ${sets.join(', ')}, updated_at = NOW() WHERE id_bot = $${vals.length}`, vals);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok:false }); }
  });
  app.post('/api/automation-suite/chatbots/:id/rename', async (req, res) => {
    try {
      const idOld = String(req.params.id);
      const newId = String(req?.body?.new_id_bot || '').trim();
      await ensureTables();
      if (!newId) return res.status(400).json({ ok:false, error:'bad_request' });
      // Transactionally rename across dependent tables
      await pool.query('BEGIN');
      // Update primary table
      await pool.query(`UPDATE mod_automation_suite_chatbots SET id_bot=$1, updated_at=NOW() WHERE id_bot=$2`, [newId, idOld]);
      // Update link and hub tables
      try { await pool.query(`UPDATE mod_automation_suite_chatbot_welcome_link SET id_bot=$1 WHERE id_bot=$2`, [newId, idOld]); } catch {}
      try { await pool.query(`UPDATE mod_automation_suite_hub_selection SET id_bot=$1 WHERE id_bot=$2`, [newId, idOld]); } catch {}
      await pool.query('COMMIT');
      res.json({ ok: true, id_bot: newId });
    } catch (e) { res.status(500).json({ ok:false }); }
  });
  app.post('/api/automation-suite/chatbots/sync', async (_req, res) => {
    res.json({ ok: true, synced: 0 });
  });
  app.post('/api/automation-suite/chatbots/:id/respond', async (req, res) => {
    const t0 = Date.now();
    try {
      if (!pool) return res.status(500).json({ ok: false, error: 'db_missing' });
      await ensureTables();

      const idBot = String(req.params.id || '').trim();
      const b = req.body || {};
      const input = String(b?.input || '').trim();
      const history = normalizeMessages(b?.history);
      const overrideApiKey = String(b?.api_key || b?.apiKey || '').trim();
      const overrideModel = String(b?.model || '').trim();
      const ctxShop = toNullableInt(b?.id_shop ?? b?.idShop ?? null);
      const ctxLang = toNullableInt(b?.id_lang ?? b?.id_Lang ?? b?.idLang ?? null);
      const extraContext = (typeof b?.extraContext === 'string') ? b.extraContext.trim() : '';
      const visitorCtx = (b?.visitor && typeof b.visitor === 'object') ? b.visitor : null;
      const visitsCtx = Array.isArray(b?.visits) ? b.visits : null;

      if (!idBot) return res.status(400).json({ ok: false, error: 'bad_request' });
      if (!input) return res.status(400).json({ ok: false, error: 'bad_request', message: 'Missing input.' });

      const botRes = await pool.query(`SELECT * FROM mod_automation_suite_chatbots WHERE id_bot=$1 LIMIT 1`, [idBot]);
      const bot = botRes.rowCount ? botRes.rows[0] : null;
      if (!bot) return res.status(404).json({ ok: false, error: 'not_found' });

      // Prompt config (optional; chatbots can be configured to point at a prompt profile)
      let promptCfg = null;
      const promptCfgId = String(bot.prompt_config_id || bot.local_prompt_id || '').trim();
      if (promptCfgId) {
        try {
          const r = await pool.query(`SELECT * FROM mod_automation_suite_prompt_config WHERE id=$1 LIMIT 1`, [promptCfgId]);
          if (r.rowCount) promptCfg = r.rows[0];
        } catch {}
      }
      const usePromptCfg = !!promptCfg;
      if (promptCfgId && !usePromptCfg) return res.status(404).json({ ok: false, error: 'prompt_not_found', prompt_config_id: promptCfgId });

      const promptTools = normalizeTools(promptCfg?.tools);
      const toolsFileSearch = !!(promptTools.file_search || promptTools.fileSearch);
      const toolsCodeInterpreter = !!(promptTools.code_interpreter || promptTools.codeInterpreter);
      // If a chatbot is assigned to a prompt config, that prompt config is the source of truth for tool enablement.
      const webSearchEnabled = usePromptCfg
        ? !!(promptTools.web_search || promptTools.webSearch)
        : !!bot.web_search_enabled;
      const webSearchAllowedDomains = Array.isArray(promptTools.web_search_allowed_domains)
        ? promptTools.web_search_allowed_domains.map(String).filter(Boolean)
        : undefined;
      const webSearchContextSize = promptTools.web_search_context_size != null ? String(promptTools.web_search_context_size) : undefined;

      const model = overrideModel || String(promptCfg?.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
      const apiKey = String(
        overrideApiKey ||
        promptCfg?.openai_api_key ||
        bot.openai_api_key ||
        ctx?.extras?.getOpenaiApiKey?.() ||
        process.env.OPENAI_API_KEY ||
        ''
      ).trim();
      if (!apiKey) return res.status(400).json({ ok: false, error: 'openai_key_missing' });

      const promptId = String(promptCfg?.prompt_id || bot.prompt_id || '').trim() || undefined;
      const promptVersion = String(promptCfg?.prompt_version || bot.prompt_version || '').trim() || undefined;
      // When a chatbot is assigned to a prompt config, treat the prompt config as the source of truth.
      let instructions = promptCfg ? String(promptCfg?.dev_message || '') : String(bot.instructions || '');
      const visitorShop = toNullableInt(visitorCtx?.id_shop ?? visitorCtx?.shop_id ?? null);
      const visitorLang = toNullableInt(visitorCtx?.id_lang ?? visitorCtx?.id_Lang ?? visitorCtx?.lang_id ?? null);
      const idShopFinal = ctxShop != null ? ctxShop : (visitorShop != null ? visitorShop : toNullableInt(bot.id_shop ?? null));
      const idLangFinal = ctxLang != null ? ctxLang : (visitorLang != null ? visitorLang : toNullableInt(bot.id_lang ?? null));
      let promptMetadata = promptCfg?.metadata;
      try { if (typeof promptMetadata === 'string') promptMetadata = JSON.parse(promptMetadata); } catch {}
      if (!promptMetadata || typeof promptMetadata !== 'object' || Array.isArray(promptMetadata)) promptMetadata = {};
      const metaOpenai = (promptMetadata && promptMetadata.openai && typeof promptMetadata.openai === 'object') ? promptMetadata.openai : promptMetadata;
      const textVerbosity = metaOpenai?.text_verbosity || 'medium';
      const reasoningEffort = metaOpenai?.reasoning_effort || 'medium';
      const maxOutputTokens = metaOpenai?.max_output_tokens || 250;
      try {
        const safeJson = (v, maxChars) => {
          try {
            const s = JSON.stringify(v);
            const max = Number(maxChars) > 0 ? Number(maxChars) : 2500;
            return s.length <= max ? s : (s.slice(0, max) + '…');
          } catch {
            return '';
          }
        };
        const sanitizeObj = (obj, allowedKeys) => {
          const o = (obj && typeof obj === 'object') ? obj : null;
          if (!o) return null;
          const out = {};
          for (const k of allowedKeys) {
            if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
            const val = o[k];
            if (val == null) continue;
            if (typeof val === 'string' && !val.trim()) continue;
            out[k] = (typeof val === 'string' && val.length > 800) ? (val.slice(0, 800) + '…') : val;
          }
          return Object.keys(out).length ? out : null;
        };
        const lines = [];
        if (idShopFinal != null) lines.push(`- id_shop: ${idShopFinal}`);
        if (idLangFinal != null) lines.push(`- id_lang: ${idLangFinal}`);
        if (extraContext) lines.push(`- extraContext: ${extraContext}`);
        const vSafe = sanitizeObj(visitorCtx, [
          'visitor_id', 'id_shop', 'id_lang', 'shop_name', 'lang_iso',
          'customer_firstname', 'customer_lastname', 'customer_email',
          'ip', 'country_code', 'city', 'postcode',
          'time_zone', 'lang', 'language',
          'origin', 'referrer', 'page_url', 'page_url_last', 'title',
          'first_seen', 'last_seen', 'last_action', 'last_action_at',
          'user_agent',
          'currency', 'id_currency',
          'id_customer', 'id_cart',
          'assistant_id', 'chatbot_id',
        ]);
        if (vSafe) lines.push(`- visitor: ${safeJson(vSafe, 2500)}`);
        if (visitsCtx && visitsCtx.length) {
          const slim = [];
          for (const it of visitsCtx.slice(0, 12)) {
            const s = sanitizeObj(it, ['occurred_at', 'page_url', 'title', 'origin', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
            if (s) slim.push(s);
          }
          if (slim.length) lines.push(`- visits: ${safeJson(slim, 2500)}`);
        }
        if (lines.length) {
          const block = `Conversation context (use for tool calls; do not mention unless asked):\n${lines.join('\n')}`;
          instructions = String((instructions || '') ? `${instructions}\n\n${block}` : block);
        }
      } catch {}

      // Formatting guardrails (helps prevent broken <a href="<a href=..."> links in UIs that autolink).
      try {
        const shouldAdd = (idShopFinal != null || idLangFinal != null || visitorCtx != null);
        if (shouldAdd && !/Formatting rules:/i.test(instructions || '')) {
          const wantsHtml =
            /uniquement\s+du\s+html/i.test(instructions || '') ||
            /tags?\s+autoris[ée]s?/i.test(instructions || '') ||
            /<\s*(div|p|ul|li|a|br|strong|em)\b/i.test(instructions || '');
          const rules = wantsHtml
            ? (
              `Formatting rules:\n` +
              `- Output valid HTML only (respect the allowed tags).\n` +
              `- For links, use <a href=\"https://...\">...</a> and avoid adding raw attribute fragments in text (no stray target=...).\n` +
              `- Avoid nested links and malformed href values.\n`
            )
            : (
              `Formatting rules:\n` +
              `- Do NOT output raw HTML tags (no <a>, <p>, etc.).\n` +
              `- Provide product links as plain URLs starting with https:// (no HTML attributes).\n` +
              `- Prefer one URL per line.`
            );
          instructions = String((instructions || '') ? `${instructions}\n\n${rules}` : rules);
        }
      } catch {}
      const seedMessages = [...normalizeMessages(promptCfg?.messages), ...history];

      const vectorStoreId = promptCfg?.vector_store_id ? String(promptCfg.vector_store_id) : undefined;
      const vectorStoreIds = Array.isArray(promptCfg?.vector_store_ids) ? promptCfg.vector_store_ids.map(String).filter(Boolean) : undefined;

      // MCP2 tools (optional): prefer servers linked to the prompt config, plus optional bot-selected server.
      const extraTools = [];
      try {
        // Chatbots should use the assigned prompt config exactly as configured (MCP, file_search, web_search, ...).
        // Therefore prompt-linked MCP servers are always included (even if the chatbot UI stored mcp_enabled=false).
        const seen = new Set();
        const seenLabels = new Set();
        const botAllow = Array.isArray(bot.mcp_tools) ? bot.mcp_tools.map(String).filter(Boolean) : [];

        const pushServer = (srow) => {
          if (!srow) return;
          const id = String(srow.id || '').trim();
          if (id && seen.has(id)) return;
          if (id) seen.add(id);

          let opts = safeJsonParse(srow.options, {});
          const pref = (opts && opts.server_url_pref === 'stream') ? 'stream' : 'sse';
          let url = pref === 'stream' ? (srow.stream_url || srow.sse_url || '') : (srow.sse_url || srow.stream_url || '');
          url = String(url || '').trim();
          if (!url) return;

          try {
            const token = String(srow.token || '').trim();
            if (token) {
              const u = new URL(url);
              if (!u.searchParams.get('token')) u.searchParams.set('token', token);
              url = u.toString();
            }
          } catch {}

          const allowedFromServer = Array.isArray(opts?.allowed_tools) ? opts.allowed_tools.map(String).filter(Boolean) : undefined;
          // If a prompt config is set, do not let chatbot-level allowlists override it.
          const allowed = usePromptCfg ? allowedFromServer : (botAllow.length ? botAllow : allowedFromServer);
          extraTools.push({
            type: 'mcp',
            server_url: url,
            server_label: uniqueServerLabel(String(srow.name || id || 'mcp'), seenLabels),
            allowed_tools: allowed,
            require_approval: 'never',
          });
        };

        // 1) Prompt-linked MCP2 servers (matches Prompt Tester behavior)
        if (promptCfgId) {
          try {
            const rr = await pool.query(
              `SELECT s.id, s.name, s.stream_url, s.sse_url, s.token, s.options, COALESCE(s.enabled,false) AS enabled
                 FROM mod_automation_suite_prompt_mcp2 x
                 JOIN mod_mcp2_server s ON s.id = x.mcp2_server_id
                WHERE x.prompt_config_id = $1
                ORDER BY s.updated_at DESC NULLS LAST`,
              [promptCfgId]
            );
            for (const srow of rr.rows || []) pushServer(srow);
          } catch {}
        }

        // 2) Bot-selected MCP2 server (optional fallback/override)
        const serverName = usePromptCfg ? '' : String(bot.mcp_server_name || '').trim();
        if (serverName) {
          try {
            const rr = await pool.query(
              `SELECT id, name, token, stream_url, sse_url, options, COALESCE(enabled,false) AS enabled
                 FROM mod_mcp2_server
                WHERE id = $1 OR name = $1 OR lower(name) = lower($1)
                ORDER BY updated_at DESC NULLS LAST
                LIMIT 1`,
              [serverName]
            );
            if (rr.rowCount) pushServer(rr.rows[0]);
          } catch {}
        }
      } catch {}

      const result = await respondWithPrompt({
        apiKey,
        model,
        promptId,
        promptVersion,
        input,
        seedMessages,
        instructions,
        toolsFileSearch,
        toolsCodeInterpreter,
        vectorStoreId,
        vectorStoreIds,
        webSearchEnabled,
        webSearchAllowedDomains,
        webSearchContextSize,
        textVerbosity,
        reasoningEffort,
        maxOutputTokens,
        metadata: { id_shop: idShopFinal, id_lang: idLangFinal },
        extraTools,
      });

      const ms = Date.now() - t0;
      try {
        if (chatLog) chatLog('automation-suite.chatbots.respond', {
          ok: true,
          id_bot: idBot,
          prompt_config_id: promptCfgId || null,
          model,
          mcp_tools_count: Array.isArray(extraTools) ? extraTools.length : 0,
          ms,
        });
      } catch {}

      const safeReqBody = redactMcpToolsInRequestBody(result.request_body || {});
      if (promptCfgId) {
        try {
          await recordPromptConfigHistory(pool, {
            promptConfigId: promptCfgId,
            input,
            output: result.text || '',
            requestBody: safeReqBody,
            response: result.raw || null,
            ms,
          });
        } catch {}
      }
      return res.json({
        ok: true,
        text: result.text || '',
        request_body: safeReqBody,
        request: result.request || {},
        conversation: Array.isArray(result.conversation) ? result.conversation : [],
        response_id: result.response_id || null,
        openai_request_id: result.openai_request_id || null,
        ms,
      });
    } catch (e) {
      const ms = Date.now() - t0;
      const msg = String(e?.message || e || 'server_error');
      try {
        if (chatLog) chatLog('automation-suite.chatbots.respond', { ok: false, error: msg, ms });
      } catch {}
      return res.status(500).json({ ok: false, error: 'server_error', message: msg });
    }
  });
  app.delete('/api/automation-suite/chatbots/:id', async (req, res) => {
    try {
      const id = String(req.params.id);
      await ensureTables();
      await pool.query(`DELETE FROM mod_automation_suite_chatbots WHERE id_bot=$1`, [id]);
      res.json({ ok: true, deleted: id });
    } catch (e) { res.status(500).json({ ok:false }); }
  });

  // ----- Welcome messages -----
  app.get('/api/automation-suite/welcome-messages', async (req, res) => {
    try {
      await ensureTables();
      const rawOrg = (req.headers && (req.headers['x-org-id'] ?? req.headers['X-Org-Id'])) ?? null;
      const hasOrg = rawOrg != null && String(rawOrg).trim() !== '' && /^\d+$/.test(String(rawOrg));
      let r;
      if (hasOrg) {
        r = await pool.query(
          `SELECT id, id_shop, id_lang, title, content, COALESCE(enabled, TRUE) AS enabled
             FROM mod_automation_suite_welcome_messages
            WHERE org_id = $1::int
            ORDER BY updated_at DESC, created_at DESC`,
          [Number(rawOrg)]
        );
      } else {
        // No org filter provided → show all (transitional compatibility for NULL org_id rows from legacy)
        r = await pool.query(
          `SELECT id, id_shop, id_lang, title, content, COALESCE(enabled, TRUE) AS enabled
             FROM mod_automation_suite_welcome_messages
            ORDER BY updated_at DESC, created_at DESC`
        );
      }
      res.json({ ok: true, items: r.rows || [] });
    } catch { res.json({ ok:true, items: [] }); }
  });
  app.patch('/api/automation-suite/welcome/:id', async (req, res) => {
    try {
      const org = await pickOrgId(req);
      const id = String(req.params.id);
      const id_shop = toNullableInt(req?.body?.id_shop ?? req?.body?.idShop ?? null);
      const id_lang = toNullableInt(req?.body?.id_lang ?? req?.body?.id_Lang ?? req?.body?.idLang ?? null);
      const title = req?.body?.title || null;
      const content = req?.body?.content || null;
      const enabled = req?.body?.enabled !== false;
      await ensureTables();
      await pool.query(
        `INSERT INTO mod_automation_suite_welcome_messages (id, org_id, id_shop, id_lang, title, content, enabled, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET id_shop=EXCLUDED.id_shop, id_lang=EXCLUDED.id_lang, title=EXCLUDED.title, content=EXCLUDED.content, enabled=EXCLUDED.enabled, updated_at=NOW()`,
        [id, org ?? null, id_shop, id_lang, title, content, enabled]
      );
      res.json({ ok: true });
    } catch { res.status(500).json({ ok:false }); }
  });
  app.delete('/api/automation-suite/welcome/:id', async (req, res) => {
    try {
      const id = String(req.params.id);
      await ensureTables();
      await pool.query(`DELETE FROM mod_automation_suite_welcome_messages WHERE id=$1`, [id]);
      // Remove link rows if any
      try { await pool.query(`DELETE FROM mod_automation_suite_chatbot_welcome_link WHERE welcome_message_id=$1`, [id]); } catch {}
      res.json({ ok: true });
    } catch { res.status(500).json({ ok:false }); }
  });

  // ----- Conversation hub -----
  app.get('/api/automation-suite/conversation-hub', async (req, res) => {
    try {
      const org = await pickOrgId(req);
      await ensureTables();
      const r = await pool.query(`SELECT id_bot FROM mod_automation_suite_hub_selection WHERE ($1::int IS NULL AND org_id IS NULL) OR ($1::int IS NOT NULL AND org_id = $1::int)`, [org ?? null]);
      const ids = (r.rows || []).map(x => String(x.id_bot));
      res.json({ ids });
    } catch { res.json({ ids: [] }); }
  });
  app.post('/api/automation-suite/conversation-hub', async (req, res) => {
    try {
      const org = await pickOrgId(req);
      const ids = Array.isArray(req?.body?.ids) ? req.body.ids.map(String) : [];
      await ensureTables();
      // Replace selection for this org
      await pool.query(`DELETE FROM mod_automation_suite_hub_selection WHERE ($1::int IS NULL AND org_id IS NULL) OR ($1::int IS NOT NULL AND org_id = $1::int)`, [org ?? null]);
      for (const id of ids) {
        try { await pool.query(`INSERT INTO mod_automation_suite_hub_selection (org_id, id_bot, created_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING`, [org ?? null, id]); } catch {}
      }
      res.json({ ok: true });
    }
    catch { res.status(500).json({ ok:false }); }
  });
  app.get('/api/automation-suite/conversation-hub/stats', async (req, res) => {
    try {
      const org = await pickOrgId(req);
      await ensureTables();
      const r = await pool.query(`SELECT id_bot FROM mod_automation_suite_hub_selection WHERE ($1::int IS NULL AND org_id IS NULL) OR ($1::int IS NOT NULL AND org_id = $1::int)`, [org ?? null]);
      const items = (r.rows || []).map(row => ({ id: String(row.id_bot), count: 0 }));
      res.json({ ok: true, items });
    }
    catch { res.json({ ok:true, items: [] }); }
  });
}
