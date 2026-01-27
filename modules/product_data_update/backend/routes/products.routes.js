export function registerProductDataUpdateProductsRoutes(app, ctx = {}, utils = {}) {
  const chatLog = utils.chatLog || (()=>{});
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });

  // Stub: fill missing fields for products (will use MySQL profile + prefix)
  app.post('/api/product_data_update/products/fill-missing', async (req, res) => {
    const b = req.body || {};
    try { chatLog('generate_meta_request', { ids: b.product_ids, id_shop: b.id_shop, id_lang: b.id_lang, prompt: b.prompt_config_id, dry_run: b.dry_run !== false }); } catch {}
    const profileId = Number(b.profile_id || 0) || null;
    const prefix = String(b.prefix || '').trim();
    const scope = b.scope || {}; // { product_ids?: number[], where?: string }
    const fields = Array.isArray(b.fields) ? b.fields : [];
    const includeFeatures = !!(b.include_features || (b.fields && (b.fields.features || b.fields.x_features)));
    const includeAttributes = !!(b.include_attributes || (b.fields && (b.fields.attributes || b.fields.x_attributes)));
    const includeAttachments = !!(b.include_attachments || (b.fields && (b.fields.attachments || b.fields.x_attachments)));
    const includeImages = !!(b.include_images || (b.fields && (b.fields.images || b.fields.x_images)));
    
    // Note: related toggles are only used by translate-run
    try {
      chatLog('fill_missing_request', { profileId, prefix, fields, scope });
      // TODO: implement MySQL connection via db-mysql profile and apply updates
      return res.json({ ok: true, message: 'fill-missing stub', profile_id: profileId, prefix, fields, scope });
    } catch (e) {
      chatLog('fill_missing_error', { error: e?.message || String(e) });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Stub: translate product fields
  app.post('/api/product_data_update/products/translate', async (req, res) => {
    const b = req.body || {};
    const profileId = Number(b.profile_id || 0) || null;
    const prefix = String(b.prefix || '').trim();
    const fields = Array.isArray(b.fields) ? b.fields : [];
    const langFrom = String(b.lang_from || '').trim();
    const langTo = String(b.lang_to || '').trim();
    const scope = b.scope || {};
    try {
      chatLog('translate_request', { profileId, prefix, fields, langFrom, langTo, scope });
      // TODO: implement translation and write to *_lang tables via selected profile
      return res.json({ ok: true, message: 'translate stub', profile_id: profileId, prefix, fields, lang_from: langFrom, lang_to: langTo, scope });
    } catch (e) {
      chatLog('translate_error', { error: e?.message || String(e) });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Chunked translator run: calls prompt for translation and writes to MySQL product_lang (update-only)
  app.post('/api/product_data_update/products/translate-run', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const profileId = Number(b.profile_id || 0) || null;
    const prefix = String(b.prefix || '').trim();
    const idShop = Number(b.id_shop || 0) || null;
    const idShopFrom = Number(b.id_shop_from || 0) || null;
    const langFromId = Number(b.lang_from_id || 0) || null;
    const langToId = Number(b.lang_to_id || 0) || null;
    // Support multi-language translation in one request
    const langToIds = Array.isArray(b.lang_to_ids)
      ? b.lang_to_ids.map(n=>Number(n)).filter(n=>Number.isFinite(n) && n>0)
      : (langToId ? [langToId] : []);
    const fields = Array.isArray(b.fields) ? b.fields : [];
    // Optional related translations toggles (features/attributes/attachments/images)
    const includeFeatures = !!(b.include_features || (b.fields && (b.fields.features || b.fields.x_features)));
    const includeAttributes = !!(b.include_attributes || (b.fields && (b.fields.attributes || b.fields.x_attributes)));
    const includeAttachments = !!(b.include_attachments || (b.fields && (b.fields.attachments || b.fields.x_attachments)));
    const includeImages = !!(b.include_images || (b.fields && (b.fields.images || b.fields.x_images)));
    const arr = Array.isArray(b.product_ids) ? b.product_ids : [];
    const productIds = arr.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0);
    const promptId = String(b.prompt_config_id || '').trim();
    const dryRun = b.dry_run !== false; // default preview
    // Enforce per-language sequential processing by default when multiple target languages
    const oneLangPerPrompt = (b.one_lang_per_prompt == null) ? (Array.isArray(b.lang_to_ids) && b.lang_to_ids.length > 1) : !!b.one_lang_per_prompt;
    if (!profileId || !prefix || !idShop || !langFromId || !langToIds.length || !productIds.length || !promptId)
      return res.status(400).json({ ok:false, error:'bad_request' });
    if (!/^[A-Za-z0-9_]+$/.test(prefix)) return res.status(400).json({ ok:false, error:'invalid_prefix' });

    const pool = utils.pool;
    // Best-effort: if run_id not provided, auto-create so items can be recorded
    let runId = Number(b.run_id || 0) || null;
    let runAuto = false;
    try {
      if (!runId && pool && typeof pool.query === 'function') {
        const orgId2 = (req.headers['x-org-id'] || req.query?.org_id) ? String(req.headers['x-org-id'] || req.query.org_id) : null;
        const initialTotals = { requested: productIds.length * langToIds.length, done: 0, updated: 0, skipped: 0, errors: 0 };
        const params = { scope: { id_shop: idShop, lang_from_id: langFromId, lang_to_ids: langToIds }, fields };
        const runLangParam = (langToIds.length === 1 ? langToIds[0] : null);
        const rRun = await pool.query(
          `INSERT INTO mod_product_data_translator_runs (org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params)
           VALUES ($1,'running',$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
           RETURNING id`,
          [orgId2, profileId, prefix, idShop, runLangParam, promptId || null, JSON.stringify(initialTotals), JSON.stringify(params)]
        );
        runId = rRun && rRun.rows && rRun.rows[0] && rRun.rows[0].id ? Number(rRun.rows[0].id) : null;
        if (runId) runAuto = true;
      }
    } catch {}

    try {
      // Resolve MySQL profile from Postgres
      const args = [profileId];
      let whereOrg = '';
      try {
        const orgId = (req.headers['x-org-id'] || req.query?.org_id) ? String(req.headers['x-org-id'] || req.query.org_id) : null;
        if (orgId) { args.push(orgId); whereOrg = ' AND (org_id IS NULL OR org_id = $2)'; }
      } catch {}
      const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r || !r.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const cfg = r.rows[0];

      const mysql = await getMysql2Local();
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      let conn = await mysql.createConnection({ host: cfg.host, port: Number(cfg.port||3306), user: cfg.user, password: cfg.password || '', database: cfg.database, ssl });
      try { await conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci"); } catch {}
      async function reconnectMysql() {
        try { await conn.end(); } catch {}
        conn = await mysql.createConnection({ host: cfg.host, port: Number(cfg.port||3306), user: cfg.user, password: cfg.password || '', database: cfg.database, ssl });
        try { await conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci"); } catch {}
      }
      function isMysqlUnavailable(e) {
        const msg = String(e?.message || e || '').toLowerCase();
        const code = String(e?.code || '').toUpperCase();
        if (/econnrefused|enotfound|etimedout|ehostunreach|econnreset/.test(msg)) return true;
        if (/cannot enqueue|handshake inactivity timeout|protocol_connection_lost|pool is closed/.test(msg)) return true;
        if (/too many connections/.test(msg)) return true;
        if (code && ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','PROTOCOL_CONNECTION_LOST','ER_CON_COUNT_ERROR'].includes(code)) return true;
        return false;
      }
      try {
        // Resolve org id for metrics once (best-effort)
        let orgForRun = null;
        try { if (runId && pool && typeof pool.query === 'function') { const rOrg = await pool.query('SELECT org_id FROM mod_product_data_translator_runs WHERE id=$1 LIMIT 1', [runId]); orgForRun = rOrg.rows && rOrg.rows[0] ? rOrg.rows[0].org_id : null; } } catch {}
        const [rowsFrom] = await conn.query(`SELECT iso_code FROM \`${prefix}lang\` WHERE id_lang = ? LIMIT 1`, [langFromId]);
        const fromIso = (rowsFrom && rowsFrom[0] && rowsFrom[0].iso_code) ? String(rowsFrom[0].iso_code) : '';
        // Map all target languages to their ISO codes
        const placeholders = langToIds.map(()=>'?').join(',');
        const [rowsToMany] = await conn.query(`SELECT id_lang, iso_code FROM \`${prefix}lang\` WHERE id_lang IN (${placeholders})`, langToIds);
        const toLangs = (rowsToMany||[]).map(r => ({ id_lang: Number(r.id_lang), iso: String(r.iso_code||'') })).filter(x=>x.id_lang && x.iso);
        // Backward compat for single target
        const toIsoSingle = (toLangs && toLangs[0]) ? toLangs[0].iso : '';
        const singleLangId = (langToIds.length === 1 ? langToIds[0] : null);

        // Try to persist ISO codes into run params for UI convenience
        try {
          if (runId && pool && typeof pool.query === 'function') {
            await pool.query(
              `UPDATE mod_product_data_translator_runs
                  SET params = jsonb_set(
                    jsonb_set(
                      jsonb_set(COALESCE(params,'{}'::jsonb), '{scope,from_iso}', to_jsonb($1::text), true),
                      '{scope,to_iso}', to_jsonb($2::text), true
                    ),
                    '{scope,to_isos}', to_jsonb($3::jsonb), true
                  )
                WHERE id=$4`,
              [fromIso || '', toIsoSingle || '', JSON.stringify(toLangs.map(x=>x.iso||'')), runId]
            );
          }
        } catch {}

        const tablePL = `\`${prefix}product_lang\``;
        const tableFP = `\`${prefix}feature_product\``;
        const tableFL = `\`${prefix}feature_lang\``;
        const tableFVL = `\`${prefix}feature_value_lang\``;
        const tablePA = `\`${prefix}product_attribute\``;
        const tablePAC = `\`${prefix}product_attribute_combination\``;
        const tableA = `\`${prefix}attribute\``;
        const tableAL = `\`${prefix}attribute_lang\``;
        const tableAG = `\`${prefix}attribute_group\``;
        const tableAGL = `\`${prefix}attribute_group_lang\``;
        const tablePATT = `\`${prefix}product_attachment\``;
        const tableALANG = `\`${prefix}attachment_lang\``;
        const tableIM = `\`${prefix}image\``;
        const tableIL = `\`${prefix}image_lang\``;
        // DB hard limits per ps_product_lang schema
        const DB_MAX = { name: 128, meta_title: 128, meta_description: 512, link_rewrite: 128 };
        const out = [];

        // Build Automation Suite call setup
        const port = Number(process.env.APP_PORT || 3010);
        const base = `http://127.0.0.1:${port}`;
        const headers = { 'Content-Type': 'application/json' };
        try {
          const tReq = (req.headers['x-admin-token'] || req.headers['x-admin'] || '').toString().trim();
          const tEnv = String(process.env.ADMIN_TOKEN || '').trim();
          const tok = tReq || tEnv; if (tok) headers['X-Admin-Token'] = tok;
          const cookie = req.headers['cookie']; if (cookie) headers['Cookie'] = String(cookie);
        } catch {}

        function s(v) { try { return String(v ?? ''); } catch { return ''; } }
        function toLinkRewrite(src, pid) {
          try {
            let x = String(src || '').toLowerCase();
            // Drop HTML tags if any snuck in
            x = x.replace(/<[^>]*>/g, ' ');
            // Normalize + strip diacritics
            try { x = x.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}
            // Replace anything not a-z0-9 with hyphen
            x = x.replace(/[^a-z0-9]+/g, '-');
            // Collapse/trim hyphens
            x = x.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
            if (!x) x = `product-${pid||''}`.trim();
            if (x.length > DB_MAX.link_rewrite) x = x.slice(0, DB_MAX.link_rewrite);
            return x || 'product';
          } catch { return `product-${pid||''}`; }
        }

        const idShopSrc = Number(idShopFrom || idShop);
        // Aggregate stats across languages for this chunk
        let statsDone = 0, statsUpdated = 0, statsSkipped = 0, statsErrors = 0;
        try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'chunk_start', { product_ids: productIds }); } catch {}
        try { utils.chatLog && utils.chatLog('chunk_start', { run_id: runId, product_ids: productIds }); } catch {}
        for (const pid of productIds) {
          try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'product_start', { id_product: pid, ...(singleLangId ? { id_lang: singleLangId } : {}) }); } catch {}
          try { utils.chatLog && utils.chatLog('product_start', { run_id: runId, id_product: pid }); } catch {}
          // Only process active products in destination shop; fallback to global product.active
          try {
            const tablePSH = `\`${prefix}product_shop\``;
            const tablePMain = `\`${prefix}product\``;
            let isActive = true;
            try {
              const [psRows] = await conn.query(`SELECT active FROM ${tablePSH} WHERE id_product = ? AND id_shop = ? LIMIT 1`, [pid, idShop]);
              if (psRows && psRows[0] && (psRows[0].active != null)) isActive = !!Number(psRows[0].active);
              else {
                const [pRows] = await conn.query(`SELECT active FROM ${tablePMain} WHERE id_product = ? LIMIT 1`, [pid]);
                if (pRows && pRows[0] && (pRows[0].active != null)) isActive = !!Number(pRows[0].active);
              }
            } catch {}
            if (!isActive) {
              out.push({ id_product: pid, skipped: true, status: 'skipped', message: 'inactive' });
              statsSkipped += langToIds.length; // treat each target language as skipped
              statsDone += langToIds.length;
              continue;
            }
          } catch {}
          // Read source row (from language) for selected shop
          const [srcRows] = await conn.query(
            `SELECT name, description_short, description, meta_title, meta_description
               FROM ${tablePL}
              WHERE id_product = ? AND id_shop = ? AND id_lang = ?
              LIMIT 1`,
            [pid, idShopSrc, langFromId]
          );
          const src = srcRows && srcRows[0];
          if (!src) { const it = { id_product: pid, skipped: true, status: 'skipped', message: 'source_missing' }; out.push(it); try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'product_done', it); } catch {}; statsSkipped += langToIds.length; statsDone += langToIds.length; continue; }

          // Build prompt input
          // Heuristic: detect HTML presence to guide the prompt
          const isHtmlText = (v) => /<\/?[a-z][\s\S]*>/i.test(String(v||''));
          const htmlFields = [];
          try { if (isHtmlText(src.description_short)) htmlFields.push('description_short'); } catch {}
          try { if (isHtmlText(src.description)) htmlFields.push('description'); } catch {}
          const context = {
            from_iso: fromIso,
            fields: fields,
            html_fields: htmlFields,
            source: {
              name: s(src.name),
              description_short: s(src.description_short),
              description: s(src.description),
              meta_title: s(src.meta_title),
              meta_description: s(src.meta_description),
            },
          };
          // Prompt spec: single or multi-language
          let promptInput;
          if (langToIds.length > 1) {
            const toCtx = { to_langs: toLangs.map(t => ({ id_lang: t.id_lang, iso: t.iso })) };
            const ctxMulti = { ...context, ...toCtx };
            promptInput = [
              'Translate the given ecommerce product fields from the source language to EACH target language listed in "to_langs".',
              'Return a single JSON object only (no code fences, no comments, no trailing commas).',
              'Top-level keys must be ISO codes from "to_langs" (e.g., "en", "fr").',
              'Each value must be an object with only requested keys from "fields". Valid keys:',
              'You MUST include every requested key, even if unchanged (copy source as-is when needed).',
              'For keys listed in html_fields that you cannot safely translate, return the original HTML unchanged instead of omitting.',
              '{ "name": string, "description_short": string, "description": string, "meta_title": string, "meta_description": string }',
              '',
              'Database limits (hard bounds): name <= 128 chars, meta_title <= 128 chars, meta_description <= 512 chars. Shorten gracefully if needed.',
              '',
              'HTML handling requirements:',
              '- If a field is listed in html_fields, preserve the original HTML structure, tag order, and nesting exactly.',
              '- Translate only human-visible text nodes; do NOT add/remove/reorder tags; keep attributes and links unchanged.',
              '- Preserve whitespace and paragraph breaks exactly (keep existing <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <a> etc.).',
              '- Do not escape HTML; return raw HTML for those fields; do not wrap in extra tags.',
              '- For name and meta_* fields, return plain text without any HTML.',
              '',
              'Context JSON:',
              JSON.stringify(ctxMulti),
            ].join('\n');
          } else {
            promptInput = [
              'Translate the given ecommerce product fields from the source language to the target language.',
              'Return a single JSON object only (no code fences, no comments, no trailing commas).',
              'Only include keys that are requested via "fields". Valid keys:',
              '{ "name": string, "description_short": string, "description": string, "meta_title": string, "meta_description": string }',
              '',
              'Database limits (hard bounds): name <= 128 chars, meta_title <= 128 chars, meta_description <= 512 chars. Shorten gracefully if needed.',
              '',
              'HTML handling requirements:',
              '- If a field is listed in html_fields, preserve the original HTML structure, tag order, and nesting exactly.',
              '- Translate only human-visible text nodes; do NOT add/remove/reorder tags; keep attributes and links unchanged.',
              '- Preserve whitespace and paragraph breaks exactly (keep existing <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <a> etc.).',
              '- Do not escape HTML; return raw HTML for those fields; do not wrap in extra tags.',
              '- For name and meta_* fields, return plain text without any HTML.',
              '',
              'Context JSON:',
              JSON.stringify({ ...context, to_iso: toIsoSingle }),
            ].join('\n');
          }

          // Pre-insert metrics start rows per (product, lang) so DB shows progress even if request dies
          try {
            if (runId && pool && typeof pool.query === 'function') {
              if (toLangs && toLangs.length) {
                const cols = ['org_id','run_id','id_product','id_lang','started_at'];
                const now = new Date();
                const values = [];
                const params = [];
                let i = 1;
                for (const t of toLangs) {
                  values.push(`($${i++},$${i++},$${i++},$${i++},$${i++})`);
                  params.push(orgForRun, runId, pid, t.id_lang, now);
                }
                await pool.query(`INSERT INTO mod_product_data_translator_prompt_metrics (${cols.join(',')}) VALUES ${values.join(',')}` , params);
              }
            }
          } catch {}

          // Helper: persist a trouble row for later retry
          async function recordTrouble(code, pid, langId, msg) {
            try {
              if (!runId || !pool || typeof pool.query !== 'function') return;
              const safeMsg = String(msg||'').slice(0, 1000);
              await pool.query(
                `INSERT INTO mod_product_data_translator_troubles (org_id, run_id, id_product, id_lang, id_shop, code, message)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [orgForRun || null, runId, Number(pid)||0, Number(langId)||0, Number(idShop)||0, String(code||''), safeMsg]
              );
            } catch {}
          }

          // Execute prompt(s)
          // Keep message aggregator near the prompt execution so split-mode can push into it
          let updatedAny = false; let msgs = [];
          let outParsed = null; // multi-language or single-target JSON
          let outMap = null;    // split-mode: iso -> JSON
          let promptMs = 0;
          const perLangPromptMs = new Map();
          const pStart = Date.now();
          let pEnd = pStart;
          // Track whether we apply DB updates immediately per language
          let appliedInline = false;

          // Build a safe, truncated preview of model output for SSE
          function buildPreview(obj, requestedFields = []) {
            try {
              const allow = new Set(Array.isArray(requestedFields) ? requestedFields : []);
              const pick = (k, max) => {
                if (!allow.size || allow.has(k)) {
                  let v = obj && obj[k];
                  if (v == null) return undefined;
                  v = String(v);
                  if (typeof max === 'number' && max > 0 && v.length > max) return v.slice(0, max) + '…';
                  return v;
                }
                return undefined;
              };
              const out = {};
              const put = (k,v)=>{ if (v !== undefined) out[k]=v; };
              put('name', pick('name', 160));
              put('description_short', pick('description_short', 400));
              put('description', pick('description', 1200));
              put('meta_title', pick('meta_title', 160));
              put('meta_description', pick('meta_description', 600));
              put('link_rewrite', pick('link_rewrite', 180));
              return out;
            } catch { return {}; }
          }

          // Pre-compute existence of destination rows once per product for all target languages
          const [existsRowsPre] = await conn.query(`SELECT id_lang FROM ${tablePL} WHERE id_product = ? AND id_shop = ? AND id_lang IN (${placeholders})`, [pid, idShop, ...langToIds]);
          const haveInline = new Set((existsRowsPre||[]).map(r=>Number(r.id_lang)).filter(Boolean));

          // Use per-language prompt path when explicitly requested OR when multiple target languages.
          // This keeps behavior consistent even for a single selected language.
          if (oneLangPerPrompt || toLangs.length > 1) {
            outMap = {};
            const failSet = new Set();
            appliedInline = true;

            // Helper used in inline-apply path (split-mode): apply current language immediately after prompt
            const allowInline = new Set(fields);
            const applyInlineNow = async (sourceObj, tIso, tLangId) => {
              if (!sourceObj || typeof sourceObj !== 'object') return { updated:false, message:'no_output_for_lang' };
              const setCols = []; const setVals = []; const appliedKeys = [];
              let newNameValue = null; let linkRewriteExplicit = null;
              const maybePush = (key) => {
                if (!allowInline.has(key)) return;
                const val = sourceObj[key]; if (val == null) return;
                let v = String(val);
                if (key === 'name') { if (v.length > DB_MAX.name) v = v.slice(0, DB_MAX.name); v = v.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); newNameValue = v; }
                if (key === 'meta_title') { if (v.length > DB_MAX.meta_title) v = v.slice(0, DB_MAX.meta_title); v = v.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); }
                if (key === 'meta_description') { if (v.length > DB_MAX.meta_description) v = v.slice(0, DB_MAX.meta_description); v = v.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); }
                if (key === 'link_rewrite') { linkRewriteExplicit = String(v); return; }
                setCols.push(`${key} = ?`); setVals.push(v);
                appliedKeys.push(key);
              };
              maybePush('name');
              maybePush('description_short');
              maybePush('description');
              maybePush('meta_title');
              maybePush('meta_description');
              if (allowInline.has('link_rewrite')) {
                let slug = linkRewriteExplicit != null ? String(linkRewriteExplicit) : null;
                if (!slug) slug = newNameValue != null ? toLinkRewrite(newNameValue, pid) : toLinkRewrite(src.name || '', pid);
                setCols.push('link_rewrite = ?'); setVals.push(slug);
                appliedKeys.push('link_rewrite');
              } else if (newNameValue !== null) {
                const slug = toLinkRewrite(newNameValue, pid);
                setCols.push('link_rewrite = ?'); setVals.push(slug);
                appliedKeys.push('link_rewrite');
              }
              if (!setCols.length) return { updated:false, message:'no_fields_to_update' };
              if (dryRun) {
                try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_done', { id_product: pid, id_lang: tLangId, message: 'preview', updated: false }); } catch {}
                try { utils.chatLog && utils.chatLog('db_update_done', { run_id: runId, id_product: pid, id_lang: tLangId, message: 'preview', updated: false }); } catch {}
                return { updated:false, message:'preview' };
              }
              const sql = `UPDATE ${tablePL} SET ${setCols.join(', ')} WHERE id_product = ? AND id_shop = ? AND id_lang = ?`;
              try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_start', { id_product: pid, id_lang: tLangId }); } catch {}
              try { utils.chatLog && utils.chatLog('db_update_start', { run_id: runId, id_product: pid, id_lang: tLangId }); } catch {}
              let ok = false;
              try {
                const [uRes] = await conn.execute(sql, [...setVals, pid, idShop, tLangId]);
                ok = !!(uRes && typeof uRes.affectedRows === 'number' && uRes.affectedRows > 0);
              } catch (e) {
                if (isMysqlUnavailable(e)) {
                  try { await reconnectMysql(); } catch {}
                  try {
                    const [uRes2] = await conn.execute(sql, [...setVals, pid, idShop, tLangId]);
                    ok = !!(uRes2 && typeof uRes2.affectedRows === 'number' && uRes2.affectedRows > 0);
                } catch (e2) {
                  try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_error', { id_product: pid, id_lang: tLangId, message: 'db_unavailable' }); } catch {}
                  try { utils.chatLog && utils.chatLog('db_update_error', { run_id: runId, id_product: pid, id_lang: tLangId, message: 'db_unavailable', error: String(e2?.message||e2) }); } catch {}
                  try { await recordTrouble('db_unavailable', pid, tLangId, e2?.message||e2); } catch {}
                  return { updated:false, message:'db_unavailable' };
                }
              } else {
                try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_error', { id_product: pid, id_lang: tLangId, message: 'db_error' }); } catch {}
                try { utils.chatLog && utils.chatLog('db_update_error', { run_id: runId, id_product: pid, id_lang: tLangId, message: 'db_error', error: String(e?.message||e) }); } catch {}
                try { await recordTrouble('db_error', pid, tLangId, e?.message||e); } catch {}
                return { updated:false, message:'db_error' };
              }
              }
              const note = ok ? 'applied' : 'unchanged';
              try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_done', { id_product: pid, id_lang: tLangId, updated: ok, message: note, fields: appliedKeys }); } catch {}
              try { utils.chatLog && utils.chatLog('db_update_done', { run_id: runId, id_product: pid, id_lang: tLangId, updated: ok, message: note, fields: appliedKeys }); } catch {}
              return { updated: ok, message: note };
            };
            for (const t of toLangs) {
              const singleInput = [
                'Translate the given ecommerce product fields from the source language to the target language.',
                'Return a single JSON object only (no code fences, no comments, no trailing commas).',
                'Only include keys that are requested via "fields". Valid keys:',
                'You MUST include every requested key, even if unchanged (copy source as-is when needed).',
                'For keys listed in html_fields that you cannot safely translate, return the original HTML unchanged instead of omitting.',
                '{ "name": string, "description_short": string, "description": string, "meta_title": string, "meta_description": string }',
                '',
                'Database limits (hard bounds): name <= 128 chars, meta_title <= 128 chars, meta_description <= 512 chars. Shorten gracefully if needed.',
                '',
                'HTML handling requirements:',
                '- If a field is listed in html_fields, preserve the original HTML structure, tag order, and nesting exactly.',
                '- Translate only human-visible text nodes; do NOT add/remove/reorder tags; keep attributes and links unchanged.',
                '- Preserve whitespace and paragraph breaks exactly (keep existing <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <a> etc.).',
                '- Do not escape HTML; return raw HTML for those fields; do not wrap in extra tags.',
                '- For name and meta_* fields, return plain text without any HTML.',
                '',
                'Context JSON:',
                JSON.stringify({ ...context, to_iso: t.iso })
              ].join('\n');
              try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_request', { id_product: pid, id_lang: t.id_lang, prompt_id: promptId, input: String(singleInput||'') }); } catch {}
              try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_start', { id_product: pid, id_lang: t.id_lang }); } catch {}
              try { utils.chatLog && utils.chatLog('prompt_request', { run_id: runId, id_product: pid, id_lang: t.id_lang, prompt_id: promptId, input_len: (singleInput ? String(singleInput).length : 0) }); } catch {}
              const t0 = Date.now();
              const r = await fetch(`${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`, { method:'POST', headers, body: JSON.stringify({ input: singleInput }) });
              const tx = await r.text();
              const t1 = Date.now();
              perLangPromptMs.set(t.id_lang, Math.max(0, t1 - t0));
              promptMs += Math.max(0, t1 - t0);
              pEnd = t1;
              try { chatLog('translate_prompt_timing', { id_product: pid, id_lang: t.id_lang, ms: Math.max(0, t1 - t0) }); } catch {}
              try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_received', { id_product: pid, id_lang: t.id_lang, ms: Math.max(0, t1 - t0) }); } catch {}
              try { utils.chatLog && utils.chatLog('prompt_received', { run_id: runId, id_product: pid, id_lang: t.id_lang, ms: Math.max(0, t1 - t0) }); } catch {}
              let jj = null; try { jj = tx ? JSON.parse(tx) : null; } catch {}
              const ok = !!(jj && (jj.ok !== false));
              if (!r.ok || !ok) {
                let msg = (jj && (jj.message || jj.error)) || tx || 'prompt_test_failed';
                try { if (msg && typeof msg === 'object') msg = JSON.stringify(msg); } catch {}
                try { chatLog('translate_prompt_failed', { id_product: pid, id_lang: t.id_lang, status: r.status, message: String(msg) }); } catch {}
                try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_error', { id_product: pid, id_lang: t.id_lang, status: r.status, message: String(msg) }); } catch {}
                try { utils.chatLog && utils.chatLog('prompt_error', { run_id: runId, id_product: pid, id_lang: t.id_lang, status: r.status, message: String(msg) }); } catch {}
                try { await recordTrouble('prompt_failed', pid, t.id_lang, msg); } catch {}
                failSet.add(t.id_lang);
                continue;
              }
              let obj = null; try { obj = jj && jj.text ? JSON.parse(jj.text) : (typeof jj === 'object' ? jj : null); } catch {}
              // Validate all requested fields exist and are non-empty strings
              const required = Array.isArray(fields) ? fields.filter(k => k !== 'link_rewrite') : [];
              // Fallback-fill missing requested keys from source when possible (especially HTML description)
              try {
                const reqSet = new Set(required);
                if (reqSet.has('description') && !Object.prototype.hasOwnProperty.call(obj||{}, 'description')) { obj = obj || {}; obj.description = String(src.description || ''); }
                if (reqSet.has('description_short') && !Object.prototype.hasOwnProperty.call(obj||{}, 'description_short')) { obj = obj || {}; obj.description_short = String(src.description_short || ''); }
                if (reqSet.has('name') && !Object.prototype.hasOwnProperty.call(obj||{}, 'name')) { obj = obj || {}; obj.name = String(src.name || ''); }
                if (reqSet.has('meta_title') && !Object.prototype.hasOwnProperty.call(obj||{}, 'meta_title')) { obj = obj || {}; obj.meta_title = String(src.meta_title || ''); }
                if (reqSet.has('meta_description') && !Object.prototype.hasOwnProperty.call(obj||{}, 'meta_description')) { obj = obj || {}; obj.meta_description = String(src.meta_description || ''); }
              } catch {}
              // Emit prompt output preview for this language
              try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_output', { id_product: pid, id_lang: t.id_lang, out: buildPreview(obj, fields) }); } catch {}
              const missing = []; const empty = [];
              if (!obj || typeof obj !== 'object') {
                try { chatLog('translate_prompt_failed', { id_product: pid, id_lang: t.id_lang, status: 'invalid', message: 'invalid_output' }); } catch {}
                try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_error', { id_product: pid, id_lang: t.id_lang, status: 'invalid', message: 'invalid_output' }); } catch {}
                try { await recordTrouble('invalid_output', pid, t.id_lang, 'invalid_output'); } catch {}
                failSet.add(t.id_lang);
                continue;
              }
              try {
                for (const key of required) {
                  if (!Object.prototype.hasOwnProperty.call(obj, key)) { missing.push(key); continue; }
                  const v = obj[key];
                  if (v == null || (typeof v === 'string' && v.trim() === '')) empty.push(key);
                }
              } catch {}
              if (missing.length) {
                const msg = `invalid_fields: missing=[${missing.join(',')}]`;
                try { chatLog('translate_prompt_failed', { id_product: pid, id_lang: t.id_lang, status: 'invalid', message: msg }); } catch {}
                try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_error', { id_product: pid, id_lang: t.id_lang, status: 'invalid', message: msg }); } catch {}
                try { await recordTrouble('invalid_fields', pid, t.id_lang, msg); } catch {}
                failSet.add(t.id_lang);
                continue;
              }
              // Keep result and apply immediately for this language
              { const k = String(t.iso||'').toLowerCase(); outMap[k] = obj; }
              if (!haveInline.has(t.id_lang)) {
                statsSkipped += 1; msgs.push(`${t.iso}:target_missing`);
                try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_error', { id_product: pid, id_lang: t.id_lang, message: 'target_missing' }); } catch {}
                try { utils.chatLog && utils.chatLog('db_update_error', { run_id: runId, id_product: pid, id_lang: t.id_lang, message: 'target_missing' }); } catch {}
                try { await recordTrouble('target_missing', pid, t.id_lang, 'target_missing'); } catch {}
                continue;
              }
              const rApply = await applyInlineNow(obj, t.iso, t.id_lang);
              statsDone += 1;
              if (rApply.updated) { updatedAny = true; statsUpdated += 1; }
              else if (!(rApply.message === 'no_fields_to_update' || rApply.message === 'preview' || rApply.message === 'applied')) { statsSkipped += 1; }
              msgs.push(`${t.iso}:${rApply.message}`);
            }
            // After split calls, we will account errors in the apply loop
            // and per-language prompt_ms via perLangPromptMs map.
          } else {
            // Single multi-language call (or single target)
            // Emit prompt request preview for Live Steps (do not log full input to file)
            try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_request', { id_product: pid, prompt_id: promptId, input: String(promptInput||''), ...(singleLangId ? { id_lang: singleLangId } : {}) }); } catch {}
            try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_start', { id_product: pid, ...(singleLangId ? { id_lang: singleLangId } : {}) }); } catch {}
            try { utils.chatLog && utils.chatLog('prompt_request', { run_id: runId, id_product: pid, prompt_id: promptId, input_len: (promptInput ? String(promptInput).length : 0) }); } catch {}
            try { utils.chatLog && utils.chatLog('prompt_start', { run_id: runId, id_product: pid }); } catch {}
            const rTest = await fetch(`${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`, { method:'POST', headers, body: JSON.stringify({ input: promptInput }) });
            const txt = await rTest.text();
            pEnd = Date.now();
            promptMs = Math.max(0, pEnd - pStart);
            try { chatLog('translate_prompt_timing', { id_product: pid, ms: promptMs }); } catch {}
            try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_received', { id_product: pid, ms: promptMs, ...(singleLangId ? { id_lang: singleLangId } : {}) }); } catch {}
            try { utils.chatLog && utils.chatLog('prompt_received', { run_id: runId, id_product: pid, ms: promptMs }); } catch {}
            let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
            const jOk = !!(j && (j.ok !== false));
            if (!rTest.ok || !jOk) {
            let msg = (j && (j.message || j.error)) || txt || 'prompt_test_failed';
            try { if (msg && typeof msg === 'object') msg = JSON.stringify(msg); } catch {}
            const msgStr = String(msg||'');
            const isHtml = /<\s*!DOCTYPE|<html/i.test(msgStr);
            const safeMsg = isHtml ? `prompt_test_failed (HTTP ${rTest.status||''})` : msgStr.slice(0, 1000);
            try { chatLog('translate_prompt_failed', { id_product: pid, status: rTest.status, message: String(msg) }); } catch {}
            try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_error', { id_product: pid, status: rTest.status, message: safeMsg, ...(singleLangId ? { id_lang: singleLangId } : {}) }); } catch {}
            try { utils.chatLog && utils.chatLog('prompt_error', { run_id: runId, id_product: pid, status: rTest.status, message: safeMsg }); } catch {}
            out.push({ id_product: pid, error: 'prompt_test_failed', status: rTest.status, message: safeMsg, prompt_ms: promptMs });
            try { if (singleLangId) await recordTrouble('prompt_failed', pid, singleLangId, safeMsg); } catch {}
            continue;
            }
            try { outParsed = j && j.text ? JSON.parse(j.text) : (typeof j === 'object' ? j : null); } catch { outParsed = null; }
            if (!outParsed || typeof outParsed !== 'object') { out.push({ id_product: pid, error: 'invalid_output', prompt_ms: promptMs }); statsErrors += langToIds.length; continue; }
            // Emit per-language previews after a single multi-language call
            try {
              for (const t of toLangs) {
                const isoKey = String(t.iso||'').toLowerCase();
                const per = (langToIds.length===1) ? outParsed : (outParsed[isoKey] || outParsed[String(t.iso||'').toUpperCase()] || null);
                if (per && typeof per === 'object') {
                  try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'prompt_output', { id_product: pid, id_lang: t.id_lang, out: buildPreview(per, fields) }); } catch {}
                }
              }
            } catch {}
          }

          // Helper for per-language field application
          const allow = new Set(fields);
          const applyForLanguage = async (tIso, tLangId) => {
            const isoKey = String(tIso||'').toLowerCase();
            const sourceObj = (oneLangPerPrompt
              ? ((outMap && (outMap[isoKey] || outMap[String(tIso||'').toUpperCase()])) || null)
              : ( (langToIds.length===1)
                    ? outParsed
                    : (outParsed && (outParsed[isoKey] || outParsed[String(tIso||'').toUpperCase()] || null))
                )
            );
            if (!sourceObj || typeof sourceObj !== 'object') return { updated:false, message:'no_output_for_lang' };
            const setCols = []; const setVals = []; const appliedKeys = [];
            let newNameValue = null; let linkRewriteExplicit = null;
            const maybePush = (key) => {
              if (!allow.has(key)) return;
              const val = sourceObj[key]; if (val == null) return;
              let v = String(val);
              if (key === 'name') { if (v.length > DB_MAX.name) v = v.slice(0, DB_MAX.name); v = v.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); newNameValue = v; }
              if (key === 'meta_title') { if (v.length > DB_MAX.meta_title) v = v.slice(0, DB_MAX.meta_title); v = v.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); }
              if (key === 'meta_description') { if (v.length > DB_MAX.meta_description) v = v.slice(0, DB_MAX.meta_description); v = v.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); }
              if (key === 'link_rewrite') { linkRewriteExplicit = String(v); return; }
              setCols.push(`${key} = ?`); setVals.push(v);
              appliedKeys.push(key);
            };
            maybePush('name');
            maybePush('description_short');
            maybePush('description');
            maybePush('meta_title');
            maybePush('meta_description');
            // Link rewrite: update if name updated OR explicitly requested in fields
            if (allow.has('link_rewrite')) {
              let slug = linkRewriteExplicit != null ? String(linkRewriteExplicit) : null;
              if (!slug) slug = newNameValue != null ? toLinkRewrite(newNameValue, pid) : toLinkRewrite(src.name || '', pid);
              setCols.push('link_rewrite = ?'); setVals.push(slug);
              appliedKeys.push('link_rewrite');
            } else if (newNameValue !== null) {
              const slug = toLinkRewrite(newNameValue, pid);
              setCols.push('link_rewrite = ?'); setVals.push(slug);
              appliedKeys.push('link_rewrite');
            }
            if (!setCols.length) return { updated:false, message:'no_fields_to_update' };
            if (dryRun) {
              try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_done', { id_product: pid, id_lang: tLangId, message: 'preview', updated: false, fields: appliedKeys }); } catch {}
              try { utils.chatLog && utils.chatLog('db_update_done', { run_id: runId, id_product: pid, id_lang: tLangId, message: 'preview', updated: false, fields: appliedKeys }); } catch {}
              return { updated:false, message:'preview' };
            }
            const sql = `UPDATE ${tablePL} SET ${setCols.join(', ')} WHERE id_product = ? AND id_shop = ? AND id_lang = ?`;
            try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_start', { id_product: pid, id_lang: tLangId }); } catch {}
            try { utils.chatLog && utils.chatLog('db_update_start', { run_id: runId, id_product: pid, id_lang: tLangId }); } catch {}
            let ok = false;
            try {
              const [uRes] = await conn.execute(sql, [...setVals, pid, idShop, tLangId]);
              ok = !!(uRes && typeof uRes.affectedRows === 'number' && uRes.affectedRows > 0);
            } catch (e) {
              if (isMysqlUnavailable(e)) {
                try { await reconnectMysql(); } catch {}
                try {
                  const [uRes2] = await conn.execute(sql, [...setVals, pid, idShop, tLangId]);
                  ok = !!(uRes2 && typeof uRes2.affectedRows === 'number' && uRes2.affectedRows > 0);
                } catch (e2) {
                  try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_error', { id_product: pid, id_lang: tLangId, message: 'db_unavailable' }); } catch {}
                  try { utils.chatLog && utils.chatLog('db_update_error', { run_id: runId, id_product: pid, id_lang: tLangId, message: 'db_unavailable', error: String(e2?.message||e2) }); } catch {}
                  try { await recordTrouble('db_unavailable', pid, tLangId, e2?.message||e2); } catch {}
                  return { updated:false, message:'db_unavailable' };
                }
              } else {
                try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_error', { id_product: pid, id_lang: tLangId, message: 'db_error' }); } catch {}
                try { utils.chatLog && utils.chatLog('db_update_error', { run_id: runId, id_product: pid, id_lang: tLangId, message: 'db_error', error: String(e?.message||e) }); } catch {}
                try { await recordTrouble('db_error', pid, tLangId, e?.message||e); } catch {}
                return { updated:false, message:'db_error' };
              }
            }
            const note = ok ? 'applied' : 'unchanged';
            try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_done', { id_product: pid, id_lang: tLangId, updated: ok, message: note, fields: appliedKeys }); } catch {}
            try { utils.chatLog && utils.chatLog('db_update_done', { run_id: runId, id_product: pid, id_lang: tLangId, updated: ok, message: note, fields: appliedKeys }); } catch {}
            return { updated: ok, message: note };
          };

          // Ensure target rows exist (skip when we already applied inline)
          let have = null;
          if (!appliedInline) {
            const [existsRows] = await conn.query(`SELECT id_lang FROM ${tablePL} WHERE id_product = ? AND id_shop = ? AND id_lang IN (${placeholders})`, [pid, idShop, ...langToIds]);
            have = new Set((existsRows||[]).map(r=>Number(r.id_lang)).filter(Boolean));
          }

          // Apply for each target language (sequential in split-mode)
          if (!appliedInline) for (const t of toLangs) {
            // If split mode failed for this language, count error and continue
            if (perLangPromptMs.size && !(outMap && outMap[String(t.iso).toLowerCase()])) {
              statsDone += 1; statsErrors += 1; msgs.push(`${t.iso}:prompt_failed`);
              continue;
            }
            if (!have.has(t.id_lang)) { statsSkipped += 1; msgs.push(`${t.iso}:target_missing`); try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_update_error', { id_product: pid, id_lang: t.id_lang, message: 'target_missing' }); } catch {}; try { utils.chatLog && utils.chatLog('db_update_error', { run_id: runId, id_product: pid, id_lang: t.id_lang, message: 'target_missing' }); } catch {}; try { await recordTrouble('target_missing', pid, t.id_lang, 'target_missing'); } catch {}; continue; }
            const r = await applyForLanguage(t.iso, t.id_lang);
            // Count this language as processed
            statsDone += 1;
            if (r.updated) { updatedAny = true; statsUpdated += 1; } else if (!(r.message === 'no_fields_to_update' || r.message === 'preview' || r.message === 'applied')) { statsSkipped += 1; }
            msgs.push(`${t.iso}:${r.message}`);
          }

          const status = updatedAny ? 'updated' : (dryRun ? 'ok' : 'skipped');
          const message = msgs.join(', ');

          // Related translations (features, attributes, attachments, images)
          let relPromptMsTotal = 0;
          let updFeatures = 0, updFValues = 0, updAttrs = 0, updAttrGroups = 0, updAtt = 0, updImages = 0;
          const DB2_MAX = { name: 128, value: 255, attachment_name: 128, image_legend: 128 };
          const clamp = (val, max) => { try { let x = String(val||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); if (max && x.length>max) x=x.slice(0,max); return x; } catch { return ''; } };
          const isHtmlText2 = (v) => /<\/?[a-z][\s\S]*>/i.test(String(v||''));
          async function translateTextSingle(kind, text, html, targetIso) {
            try {
              if (!text) return '';
              const ctx = { from_iso: fromIso, to_iso: targetIso, kind, html: !!html, text: String(text) };
              const input = [
                'Translate the provided text between languages.',
                'Return JSON only: { "text": string } (no code fences).',
                html ? 'Preserve HTML tags/attributes and structure; translate only visible text.' : 'Output plain text; no HTML.',
                'Context JSON:',
                JSON.stringify(ctx)
              ].join('\n');
              const t0 = Date.now();
              const rTest = await fetch(`${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`, { method:'POST', headers, body: JSON.stringify({ input }) });
              const txt = await rTest.text(); let j=null; try { j = txt ? JSON.parse(txt) : null; } catch {}
              const t1 = Date.now(); relPromptMsTotal += Math.max(0, t1 - t0);
              if (!rTest.ok || !j || j.ok === false) return '';
              const obj = j && j.text ? JSON.parse(j.text) : (typeof j === 'object' ? j : null);
              return (obj && typeof obj.text === 'string') ? obj.text : '';
            } catch { return ''; }
          }
          async function translateTextMulti(kind, text, html) {
            if (langToIds.length === 1) {
              const iso = toIsoSingle || (toLangs[0] && toLangs[0].iso) || '';
              const v = dryRun ? String(text||'') : await translateTextSingle(kind, text, html, iso);
              return { [iso]: v };
            }
            try {
              if (!text) return {};
              const ctx = { from_iso: fromIso, to_langs: toLangs.map(t=>({ id_lang: t.id_lang, iso: t.iso })), kind, html: !!html, text: String(text) };
              const input = [
                'Translate the provided text from the source language to EACH target language listed in "to_langs".',
                'Return a single JSON object only (no code fences, no comments, no trailing commas).',
                'Top-level keys must be ISO codes from "to_langs" with values as the translated text string.',
                html ? 'Preserve HTML tags/attributes and structure; translate only visible text.' : 'Output plain text; no HTML.',
                'Context JSON:',
                JSON.stringify(ctx)
              ].join('\n');
              const t0 = Date.now();
              const rTest = await fetch(`${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`, { method:'POST', headers, body: JSON.stringify({ input }) });
              const txt = await rTest.text(); let j=null; try { j = txt ? JSON.parse(txt) : null; } catch {}
              const t1 = Date.now(); relPromptMsTotal += Math.max(0, t1 - t0);
              if (!rTest.ok || !j || j.ok === false) return {};
              let obj = null; try { obj = j && j.text ? JSON.parse(j.text) : (typeof j === 'object' ? j : null); } catch {}
              return (obj && typeof obj === 'object') ? obj : {};
            } catch { return {}; }
          }

          // Images (legend) linked to this product
          if (includeImages) {
            try {
              const [imgRows] = await conn.query(`SELECT DISTINCT id_image FROM ${tableIM} WHERE id_product = ?`, [pid]);
              const imgIds = Array.from(new Set((imgRows||[]).map(r=>Number(r.id_image)).filter(Boolean)));
              for (const iid of imgIds) {
                const [srcIL] = await conn.query(`SELECT legend FROM ${tableIL} WHERE id_image = ? AND id_lang = ? LIMIT 1`, [iid, langFromId]);
                const legendSrc = srcIL && srcIL[0] && srcIL[0].legend ? String(srcIL[0].legend) : '';
                if (!legendSrc) continue;
                let map = {};
                if (!dryRun) map = await translateTextMulti('image_legend', legendSrc, false);
                for (const t of toLangs) {
                  const legendTr0 = dryRun ? legendSrc : (map && (map[t.iso] || map[t.iso?.toUpperCase?.() || '']) || legendSrc);
                  const legendTr = clamp(legendTr0 || legendSrc, DB2_MAX.image_legend);
                  if (!dryRun) {
                    await conn.execute(
                      `INSERT INTO ${tableIL} (id_image, id_lang, legend) VALUES (?,?,?) ON DUPLICATE KEY UPDATE legend=VALUES(legend)`,
                      [iid, t.id_lang, legendTr]
                    );
                  }
                }
                updImages++;
              }
            } catch {}
          }

          // Features (names & values) for this product
          if (includeFeatures) {
            try {
              const [fRows] = await conn.query(`SELECT DISTINCT fp.id_feature, fp.id_feature_value FROM ${tableFP} fp WHERE fp.id_product = ?`, [pid]);
              const featureIds = Array.from(new Set((fRows||[]).map(r=>Number(r.id_feature)).filter(Boolean)));
              const fvalIds = Array.from(new Set((fRows||[]).map(r=>Number(r.id_feature_value)).filter(Boolean)));
              // Feature names
              for (const fid of featureIds) {
                const [srcF] = await conn.query(`SELECT name FROM ${tableFL} WHERE id_feature = ? AND id_lang = ? LIMIT 1`, [fid, langFromId]);
                const nameSrc = srcF && srcF[0] && srcF[0].name ? String(srcF[0].name) : '';
                if (!nameSrc) continue;
                let map = {};
                if (!dryRun) map = await translateTextMulti('feature_name', nameSrc, false);
                for (const t of toLangs) {
                  const nameTr0 = dryRun ? nameSrc : (map && (map[t.iso] || map[t.iso?.toUpperCase?.() || '']) || nameSrc);
                  const nameTr = clamp(nameTr0||nameSrc, DB2_MAX.name);
                  if (!dryRun) await conn.execute(`INSERT INTO ${tableFL} (id_feature, id_lang, name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)`, [fid, t.id_lang, nameTr]);
                }
                updFeatures++;
              }
              // Feature values
              for (const fvid of fvalIds) {
                const [srcFV] = await conn.query(`SELECT value FROM ${tableFVL} WHERE id_feature_value = ? AND id_lang = ? LIMIT 1`, [fvid, langFromId]);
                const valSrc = srcFV && srcFV[0] && srcFV[0].value ? String(srcFV[0].value) : '';
                if (!valSrc) continue;
                let map = {};
                if (!dryRun) map = await translateTextMulti('feature_value', valSrc, isHtmlText2(valSrc));
                for (const t of toLangs) {
                  let valTr0 = dryRun ? valSrc : (map && (map[t.iso] || map[t.iso?.toUpperCase?.() || '']) || valSrc);
                  let valTr = isHtmlText2(valSrc) ? (valTr0||valSrc) : clamp(valTr0||valSrc, DB2_MAX.value);
                  if (!dryRun) await conn.execute(`INSERT INTO ${tableFVL} (id_feature_value, id_lang, value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)`, [fvid, t.id_lang, valTr]);
                }
                updFValues++;
              }
            } catch {}
          }

          // Attributes (names & groups) used by this product
          if (includeAttributes) {
            try {
              const [aRows] = await conn.query(
                `SELECT DISTINCT a.id_attribute, a.id_attribute_group
                   FROM ${tablePA} pa
                   JOIN ${tablePAC} pac ON pac.id_product_attribute = pa.id_product_attribute
                   JOIN ${tableA} a ON a.id_attribute = pac.id_attribute
                  WHERE pa.id_product = ?`, [pid]
              );
              const attrIds = Array.from(new Set((aRows||[]).map(r=>Number(r.id_attribute)).filter(Boolean)));
              const grpIds = Array.from(new Set((aRows||[]).map(r=>Number(r.id_attribute_group)).filter(Boolean)));
              for (const aid of attrIds) {
                const [srcA] = await conn.query(`SELECT name FROM ${tableAL} WHERE id_attribute = ? AND id_lang = ? LIMIT 1`, [aid, langFromId]);
                const nameSrc = srcA && srcA[0] && srcA[0].name ? String(srcA[0].name) : '';
                if (!nameSrc) continue;
                let map = {};
                if (!dryRun) map = await translateTextMulti('attribute_name', nameSrc, false);
                for (const t of toLangs) {
                  const nameTr0 = dryRun ? nameSrc : (map && (map[t.iso] || map[t.iso?.toUpperCase?.() || '']) || nameSrc);
                  const nameTr = clamp(nameTr0||nameSrc, DB2_MAX.name);
                  if (!dryRun) await conn.execute(`INSERT INTO ${tableAL} (id_attribute, id_lang, name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)`, [aid, t.id_lang, nameTr]);
                }
                updAttrs++;
              }
              for (const gid of grpIds) {
                const [srcG] = await conn.query(`SELECT name FROM ${tableAGL} WHERE id_attribute_group = ? AND id_lang = ? LIMIT 1`, [gid, langFromId]);
                const nameSrc = srcG && srcG[0] && srcG[0].name ? String(srcG[0].name) : '';
                if (!nameSrc) continue;
                let map = {};
                if (!dryRun) map = await translateTextMulti('attribute_group_name', nameSrc, false);
                for (const t of toLangs) {
                  const nameTr0 = dryRun ? nameSrc : (map && (map[t.iso] || map[t.iso?.toUpperCase?.() || '']) || nameSrc);
                  const nameTr = clamp(nameTr0||nameSrc, DB2_MAX.name);
                  if (!dryRun) await conn.execute(`INSERT INTO ${tableAGL} (id_attribute_group, id_lang, name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)`, [gid, t.id_lang, nameTr]);
                }
                updAttrGroups++;
              }
            } catch {}
          }

          // Attachments linked to this product
          if (includeAttachments) {
            try {
              const [attRows] = await conn.query(`SELECT DISTINCT id_attachment FROM ${tablePATT} WHERE id_product = ?`, [pid]);
              const attIds = Array.from(new Set((attRows||[]).map(r=>Number(r.id_attachment)).filter(Boolean)));
              for (const att of attIds) {
                const [srcL] = await conn.query(`SELECT name, description FROM ${tableALANG} WHERE id_attachment = ? AND id_lang = ? LIMIT 1`, [att, langFromId]);
                const nameSrc = srcL && srcL[0] && srcL[0].name ? String(srcL[0].name) : '';
                const descSrc = srcL && srcL[0] && srcL[0].description ? String(srcL[0].description) : '';
                let mapName = {}, mapDesc = {};
                if (!dryRun) {
                  mapName = await translateTextMulti('attachment_name', nameSrc, false);
                  mapDesc = await translateTextMulti('attachment_description', descSrc, isHtmlText2(descSrc));
                }
                for (const t of toLangs) {
                  let nameTr0 = dryRun ? nameSrc : (mapName && (mapName[t.iso] || mapName[t.iso?.toUpperCase?.() || '']) || nameSrc);
                  let descTr0 = dryRun ? descSrc : (mapDesc && (mapDesc[t.iso] || mapDesc[t.iso?.toUpperCase?.() || '']) || descSrc);
                  const nameTr = clamp(nameTr0, DB2_MAX.attachment_name);
                  const descTr = descTr0;
                  if (!dryRun) {
                    await conn.execute(
                      `INSERT INTO ${tableALANG} (id_attachment, id_lang, name, description) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description)`,
                      [att, t.id_lang, nameTr, descTr]
                    );
                  }
                }
                updAtt++;
              }
            } catch {}
          }

          const relMsg = [];
          if (langToIds.length === 1) {
            if (includeFeatures) relMsg.push(`features:${updFeatures}/${updFValues}`);
            if (includeAttributes) relMsg.push(`attrs:${updAttrs}/${updAttrGroups}`);
            if (includeAttachments) relMsg.push(`attach:${updAtt}`);
            if (includeImages) relMsg.push(`images:${updImages}`);
          }

          const it2 = { id_product: pid, updated: updatedAny, status, message: (message || (dryRun ? 'preview' : 'applied')) + (relMsg.length? `; ${relMsg.join(' ')}` : ''), prompt_ms: promptMs, rel_prompt_ms: relPromptMsTotal, prompt_started_at: new Date(pStart).toISOString(), prompt_finished_at: new Date(pEnd).toISOString() };
          out.push(it2);
          try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'product_done', it2); } catch {}
          try { utils.chatLog && utils.chatLog('product_done', { run_id: runId, ...it2 }); } catch {}
          try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'db_related_update', { id_product: pid, features: updFeatures, feature_values: updFValues, attributes: updAttrs, attr_groups: updAttrGroups, attachments: updAtt, images: updImages }); } catch {}
          try { utils.chatLog && utils.chatLog('db_related_update', { run_id: runId, id_product: pid, features: updFeatures, feature_values: updFValues, attributes: updAttrs, attr_groups: updAttrGroups, attachments: updAtt, images: updImages }); } catch {}

          // Update metrics rows with finish + timings (per language)
          try {
            if (runId && pool && typeof pool.query === 'function') {
              const perLangRel = Math.round((relPromptMsTotal || 0) / Math.max(1, langToIds.length));
              for (const t of toLangs) {
                const msVal = perLangPromptMs.size ? (perLangPromptMs.get(t.id_lang) || null) : Math.round(promptMs / Math.max(1, langToIds.length)) || null;
                await pool.query(
                  `UPDATE mod_product_data_translator_prompt_metrics
                      SET prompt_ms = COALESCE($4, prompt_ms),
                          rel_prompt_ms = COALESCE($5, rel_prompt_ms),
                          finished_at = COALESCE($6, finished_at)
                    WHERE run_id=$1 AND id_product=$2 AND id_lang=$3 AND finished_at IS NULL`,
                  [runId, pid, t.id_lang, msVal, perLangRel || null, new Date(pEnd)]
                );
              }
            }
          } catch {}
        }

        // Persist run items and totals if a run id is known
        try {
          if (runId && pool && typeof pool.query === 'function') {
            const cli = await pool.connect();
            try {
              await cli.query('BEGIN');
              for (const it of out) {
                const idp = Number(it.id_product || 0); if (!idp) continue;
                const updatedFlag = !!it.updated;
                const st = it.error ? 'error' : (it.skipped ? 'skipped' : (updatedFlag ? 'updated' : 'ok'));
                const msg = String(it.message || it.error || '') || null;
                await cli.query(
                  `INSERT INTO mod_product_data_translator_run_items (run_id, id_product, updated, status, message)
                   VALUES ($1,$2,$3,$4,$5)`,
                  [runId, idp, updatedFlag, st, msg ? msg.slice(0, 1000) : null]
                );
              }
              // Metrics insertion moved earlier; updates done per product above
              const upd = statsUpdated;
              const sk = statsSkipped;
              const er = statsErrors;
              const dn = statsDone || (out.length * langToIds.length);
              await cli.query(
                `UPDATE mod_product_data_translator_runs SET totals = COALESCE(totals,'{}'::jsonb) ||
                  jsonb_build_object(
                    'requested', COALESCE((totals->>'requested')::int,0) + $1,
                    'done', COALESCE((totals->>'done')::int,0) + $2,
                    'updated', COALESCE((totals->>'updated')::int,0) + $3,
                    'skipped', COALESCE((totals->>'skipped')::int,0) + $4,
                    'errors', COALESCE((totals->>'errors')::int,0) + $5
                  )
                 WHERE id=$6`,
                [0, dn, upd, sk, er, runId]
              );
              // Update progress cursor for resume capability
              const lastPid = out.length ? Math.max(...out.map(x=>Number(x.id_product||0)).filter(Boolean)) : null;
              if (lastPid) {
                await cli.query(
                  `UPDATE mod_product_data_translator_runs
                      SET params = jsonb_set(
                        jsonb_set(COALESCE(params,'{}'::jsonb), '{progress,last_product_id}', to_jsonb($1::int), true),
                        '{progress,last_chunk}', to_jsonb($2::jsonb), true
                      )
                    WHERE id=$3`,
                  [lastPid, { done: dn, updated: upd, skipped: sk, errors: er }, runId]
                );
              }
              await cli.query('COMMIT');
              try {
                const rTotals = await pool.query(`SELECT totals FROM mod_product_data_translator_runs WHERE id=$1 LIMIT 1`, [runId]);
                const totalsObj = rTotals.rows && rTotals.rows[0] ? rTotals.rows[0].totals : null;
                try { if (runId) (utils.sseEmit||(()=>{}))(runId, 'totals_update', { totals: totalsObj }); } catch {}
              } catch {}
            } catch (e) { try { await cli.query('ROLLBACK'); } catch {}; try { chatLog('translator_run_append_failed', { run_id: runId, error: e?.message || String(e) }); } catch {} }
            finally { cli.release(); }
          }
        } catch {}

        // If we auto-created the run, close it
        try { if (runAuto && runId) await pool.query(`UPDATE mod_product_data_translator_runs SET status='done', finished_at=NOW() WHERE id=$1`, [runId]); } catch {}

        return res.json({ ok:true, items: out, stats: { done: (statsDone || out.length*langToIds.length), updated: statsUpdated, skipped: statsSkipped, errors: statsErrors }, dry_run: !!dryRun });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Helper: lightweight mysql2 resolver local to this route file
  async function getMysql2Local() {
    try { const mod = await import('mysql2/promise'); return mod && (mod.default || mod); } catch {}
    try {
      const { createRequire } = await import('module');
      const path = (await import('path')).default;
      const backendDir = (ctx && ctx.backendDir) || path.resolve(process.cwd(), 'backend');
      const req = createRequire(path.join(backendDir, 'package.json'));
      const mod = req('mysql2/promise');
      return mod && (mod.default || mod);
    } catch {}
    const err = new Error('mysql2_missing'); err.code = 'MYSQL2_MISSING'; throw err;
  }

  // Generate meta (title + description) via Automation Suite prompt and (optionally) write to MySQL
  // Body: { profile_id:number, prefix:string, id_shop:number, id_lang:number, product_ids:number[]|number, prompt_config_id:string, limits?:{title:number, description_min:number, description_max:number}, overwrite?:boolean, dry_run?:boolean }
  app.post('/api/product_data_update/products/generate-meta', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const profileId = Number(b.profile_id || 0) || null;
    const prefix = String(b.prefix || '').trim();
    const idShop = Number(b.id_shop || 0) || null;
    const idLang = Number(b.id_lang || 0) || null;
    const promptId = String(b.prompt_config_id || '').trim();
    const overwrite = !!b.overwrite;
    const dryRun = b.dry_run !== false; // default true

    const limits = {
      title: Math.max(10, Number(b?.limits?.title || 60)),
      description_min: Math.max(60, Number(b?.limits?.description_min || 150)),
      description_max: Math.max(80, Number(b?.limits?.description_max || 160)),
    };

    const arr = Array.isArray(b.product_ids) ? b.product_ids : (b.id_product != null ? [b.id_product] : []);
    const productIds = arr.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0);
    if (!profileId || !prefix || !idShop || !idLang || !productIds.length || !promptId)
      return res.status(400).json({ ok:false, error:'bad_request' });
    if (!/^[A-Za-z0-9_]+$/.test(prefix)) return res.status(400).json({ ok:false, error:'invalid_prefix' });

    try {
      // Resolve profile connection from Postgres
      const pool = utils.pool;
      // Best-effort: if client didn't start a run, create one so items can be recorded
      let runId = Number(b.run_id || 0) || null;
      let runAutoCreated = false;
      try {
        if (!runId && pool && typeof pool.query === 'function') {
          const orgId2 = (req.headers['x-org-id'] || req.query?.org_id) ? String(req.headers['x-org-id'] || req.query.org_id) : null;
          const initialTotals = { requested: productIds.length, done: 0, updated: 0, skipped: 0, errors: 0 };
          const params = { limits };
          const rRun = await pool.query(
            `INSERT INTO mod_product_data_update_runs (org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params)
             VALUES ($1,'running',$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
             RETURNING id`,
            [orgId2, profileId, prefix, idShop, idLang, promptId, JSON.stringify(initialTotals), JSON.stringify(params)]
          );
          runId = rRun && rRun.rows && rRun.rows[0] && rRun.rows[0].id ? Number(rRun.rows[0].id) : null;
          if (runId) runAutoCreated = true;
        }
      } catch (e) { try { chatLog('run_autocreate_failed', { error: e?.message || String(e) }); } catch {} }
      const args = [profileId];
      // org scoping if header present
      try {
        const orgId = (req.headers['x-org-id'] || req.query?.org_id) ? String(req.headers['x-org-id'] || req.query.org_id) : null;
        if (orgId) { args.push(orgId); }
        var whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      } catch { var whereOrg = ''; }
      const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r || !r.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const cfg = r.rows[0];

      const mysql = await getMysql2Local();
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      const conn = await mysql.createConnection({ host: cfg.host, port: Number(cfg.port||3306), user: cfg.user, password: cfg.password || '', database: cfg.database, ssl });
      try {
        // Fetch language ISO
        const [langRows] = await conn.query(`SELECT iso_code FROM \`${prefix}lang\` WHERE id_lang = ? LIMIT 1`, [idLang]);
        const langIso = (langRows && langRows[0] && langRows[0].iso_code) ? String(langRows[0].iso_code) : '';

        const tablePL = `\`${prefix}product_lang\``;
        const tablePSH = `\`${prefix}product_shop\``;
        const tablePM = `\`${prefix}product\``;
        const tableP = `\`${prefix}product\``;
        const tableM = `\`${prefix}manufacturer\``;
        const tableCL = `\`${prefix}category_lang\``;

        const out = [];
        const port = Number(process.env.APP_PORT || 3010);
        const base = `http://127.0.0.1:${port}`;
        const headers = { 'Content-Type': 'application/json' };
        try {
          // Prefer inbound admin token when present; fallback to env
          const tReq = (req.headers['x-admin-token'] || req.headers['x-admin'] || '').toString().trim();
          const tEnv = String(process.env.ADMIN_TOKEN || '').trim();
          const tok = tReq || tEnv;
          if (tok) headers['X-Admin-Token'] = tok;
          // Also forward session cookies so requireAdmin(req,res) can succeed without token
          const cookie = req.headers['cookie'];
          if (cookie) headers['Cookie'] = String(cookie);
        } catch {}

        // DB limits from ps_product_lang (MariaDB schema):
        const DB_MAX = { meta_title: 128, meta_description: 512 };
        function sanitizeLen(s, max) {
          try {
            let x = String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (typeof max === 'number' && max > 0 && x.length > max) x = x.slice(0, max);
            return x;
          } catch { return ''; }
        }

        for (const pid of productIds) {
          // Only update active products (destination shop). Fallback to global product.active
          try {
            let isActive = true;
            try {
              const [psRows] = await conn.query(`SELECT active FROM ${tablePSH} WHERE id_product = ? AND id_shop = ? LIMIT 1`, [pid, idShop]);
              if (psRows && psRows[0] && (psRows[0].active != null)) isActive = !!Number(psRows[0].active);
              else {
                const [pRows] = await conn.query(`SELECT active FROM ${tablePM} WHERE id_product = ? LIMIT 1`, [pid]);
                if (pRows && pRows[0] && (pRows[0].active != null)) isActive = !!Number(pRows[0].active);
              }
            } catch {}
            if (!isActive) { out.push({ id_product: pid, skipped: true, status: 'skipped', message: 'inactive' }); continue; }
          } catch {}
          // Read product and related context
          const [pRows] = await conn.query(
            `SELECT p.id_product, p.reference, p.id_manufacturer, p.id_category_default,
                    pl.name, pl.description_short, pl.description, pl.meta_title, pl.meta_description
               FROM ${tableP} p
               JOIN ${tablePL} pl ON pl.id_product = p.id_product AND pl.id_shop = ? AND pl.id_lang = ?
              WHERE p.id_product = ?
              LIMIT 1`, [idShop, idLang, pid]
          );
          const row = pRows && pRows[0];
          if (!row) { out.push({ id_product: pid, skipped: true, reason: 'not_found' }); continue; }
          if (!overwrite && row.meta_title && row.meta_description) { out.push({ id_product: pid, skipped: true, reason: 'already_has_meta' }); continue; }

          // Manufacturer
          let brand = '';
          if (row.id_manufacturer) {
            const [mRows] = await conn.query(`SELECT name FROM ${tableM} WHERE id_manufacturer = ? LIMIT 1`, [row.id_manufacturer]);
            brand = (mRows && mRows[0] && mRows[0].name) ? String(mRows[0].name) : '';
          }
          // Category
          let category = '';
          if (row.id_category_default) {
            const [cRows] = await conn.query(`SELECT name FROM ${tableCL} WHERE id_category = ? AND id_lang = ? AND id_shop = ? LIMIT 1`, [row.id_category_default, idLang, idShop]);
            category = (cRows && cRows[0] && cRows[0].name) ? String(cRows[0].name) : '';
          }

          const context = {
            product: {
              id: pid,
              name: String(row.name || ''),
              description_short: String(row.description_short || ''),
              description: String(row.description || ''),
              reference: String(row.reference || ''),
              brand,
              category,
            },
            shop: { id_shop: idShop },
            language: { id_lang: idLang, iso_code: langIso },
            limits,
          };

          const promptInput = [
            'You are an SEO assistant generating page metadata for ecommerce product pages.',
            '',
            'Return a single JSON object only (no code fences, no trailing commas):',
            '{',
            '  "meta_title": string,',
            '  "meta_description": string',
            '}',
            '',
            `Rules:`,
            `- Language: ${langIso || 'unknown'}.`,
            `- Keep meta_title <= ${limits.title} characters.`,
            `- Keep meta_description between ${limits.description_min} and ${limits.description_max} characters.`,
            '- Hard DB caps: meta_title <= 128 chars, meta_description <= 512 chars; do not exceed.',
            '- Use the product name; include brand once if it adds clarity; avoid duplicating name and brand.',
            '- Be compelling and natural; avoid keyword stuffing; no HTML; no emojis; no newlines.',
            '- If description_short exists, use it for key benefits; fall back to description.',
            '- Optionally add a subtle CTA in meta_description that fits locale.',
            '',
            'Context JSON:',
            JSON.stringify(context),
          ].join('\n');

          const rTest = await fetch(`${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`, { method:'POST', headers, body: JSON.stringify({ input: promptInput }) });
          const txt = await rTest.text();
          let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
          const jOk = !!(j && (j.ok !== false));
          if (!rTest.ok || !jOk) {
            let msg = (j && (j.message || j.error)) || txt || 'prompt_test_failed';
            try { if (msg && typeof msg === 'object') msg = JSON.stringify(msg); } catch {}
            const msgStr = String(msg||'');
            const isHtml = /<\s*!DOCTYPE|<html/i.test(msgStr);
            const safeMsg = isHtml ? `prompt_test_failed (HTTP ${rTest.status||''})` : msgStr.slice(0, 1000);
            try { chatLog('generate_meta_prompt_failed', { id_product: pid, status: rTest.status, message: String(msg) }); } catch {}
            out.push({ id_product: pid, error: 'prompt_test_failed', status: rTest.status, message: safeMsg });
            continue;
          }
          let outObj = null;
          try { outObj = j && j.text ? JSON.parse(j.text) : (typeof j === 'object' ? j : null); } catch { outObj = null; }
          let metaTitle = outObj && typeof outObj === 'object' ? String(outObj.meta_title || '') : '';
          let metaDesc = outObj && typeof outObj === 'object' ? String(outObj.meta_description || '') : '';
          // Apply DB hard limits
          metaTitle = sanitizeLen(metaTitle, DB_MAX.meta_title);
          metaDesc = sanitizeLen(metaDesc, DB_MAX.meta_description);

          if (!metaTitle && !metaDesc) {
            try { chatLog('generate_meta_empty_output', { id_product: pid }); } catch {}
            out.push({ id_product: pid, error: 'empty_output', message: 'Prompt returned no meta fields' });
            continue;
          }

          let updated = false;
          let warning = '';
          if (!dryRun) {
            // Update only; avoid INSERT to prevent NOT NULL constraints like link_rewrite
            const sqlUpd = `UPDATE ${tablePL}
                              SET meta_title = ?, meta_description = ?
                            WHERE id_product = ? AND id_shop = ? AND id_lang = ?`;
            const [uRes] = await conn.execute(sqlUpd, [metaTitle, metaDesc, pid, idShop, idLang]);
            updated = !!(uRes && typeof uRes.affectedRows === 'number' && uRes.affectedRows > 0);
            if (!updated) warning = 'row_missing_for_shop_lang';
          }
          try { chatLog('generate_meta_done', { id_product: pid, updated, dry_run: !!dryRun, warning }); } catch {}
          const payload = { id_product: pid, lang: idLang, shop: idShop, meta_title: metaTitle, meta_description: metaDesc, updated, dry_run: !!dryRun };
          if (warning) payload.warning = warning;
          out.push(payload);
        }

        // If a run_id is provided, persist this chunk into run items and totals
        try {
          const runIdEff = Number((b && b.run_id != null) ? b.run_id : runId || 0) || null;
          if (runIdEff && pool && typeof pool.query === 'function') {
            const cli = await pool.connect();
            try {
              await cli.query('BEGIN');
              for (const it of out) {
                const idp = Number(it.id_product || 0);
                if (!idp) continue;
                const updatedFlag = !!it.updated;
                const status = it.error ? 'error' : (it.skipped ? 'skipped' : (updatedFlag ? 'updated' : 'ok'));
                const message = String(it.message || it.warning || it.error || '').slice(0, 1000) || null;
                const mt = it.meta_title ? String(it.meta_title).slice(0, 255) : null;
                const md = it.meta_description ? String(it.meta_description).slice(0, 255) : null;
                await cli.query(
                  `INSERT INTO mod_product_data_update_run_items (run_id, id_product, updated, status, message, meta_title, meta_description)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                  [runIdEff, idp, updatedFlag, status, message, mt, md]
                );
              }
              const upd = out.filter(x=>x.updated).length;
              const sk = out.filter(x=>x.skipped).length;
              const er = out.filter(x=>x.error).length;
              const dn = out.length;
              await cli.query(
                `UPDATE mod_product_data_update_runs SET totals = COALESCE(totals,'{}'::jsonb) ||
                  jsonb_build_object(
                    'requested', COALESCE((totals->>'requested')::int,0) + $1,
                    'done', COALESCE((totals->>'done')::int,0) + $2,
                    'updated', COALESCE((totals->>'updated')::int,0) + $3,
                    'skipped', COALESCE((totals->>'skipped')::int,0) + $4,
                    'errors', COALESCE((totals->>'errors')::int,0) + $5
                  )
                 WHERE id=$6`,
                [0, dn, upd, sk, er, runIdEff]
              );
              await cli.query('COMMIT');
            } catch (e) { try { await cli.query('ROLLBACK'); } catch {}; try { chatLog('run_append_failed', { run_id: runId, error: e?.message || String(e) }); } catch {} }
            finally { cli.release(); }
          }
        } catch {}

        // If we auto-created a run for this request, mark it as finished
        try { if (runAutoCreated && runId) await pool.query(`UPDATE mod_product_data_update_runs SET status='done', finished_at=NOW() WHERE id=$1`, [runId]); } catch {}

        return res.json({ ok:true, items: out, dry_run: !!dryRun });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}
