import path from 'path';
import { pathToFileURL } from 'url';
let googleApi = null;
async function loadGoogleApis(ctx) {
  if (googleApi) return googleApi;
  // 1) Try normal node resolution from this module location
  try {
    const mod = await import('googleapis');
    googleApi = mod.google || mod.default || mod;
    return googleApi;
  } catch {}
  // 2) Fallback: import directly from backend/node_modules (passed via ctx)
  try {
    const backendDir = ctx?.backendDir || '';
    if (backendDir) {
      const candidate = path.join(backendDir, 'node_modules', 'googleapis', 'build', 'src', 'index.js');
      googleApi = (await import(pathToFileURL(candidate).href)).google;
      return googleApi;
    }
  } catch {}
  // Give up: return null to signal missing dependency
  googleApi = null;
  return null;
}

export function registerGoogleRoutes(app, ctx = {}) {
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return null; });
  const pool = ctx.pool;
  const log = (m) => { try { ctx.logToFile?.(`[google-api] ${m}`); } catch {} };

  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_google_api_settings (
        id SERIAL PRIMARY KEY,
        org_id TEXT DEFAULT 'org_default',
        client_id TEXT,
        client_secret TEXT,
        redirect_uri TEXT,
        scopes TEXT[],
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_mod_google_api_settings_org UNIQUE(org_id)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_google_api_tokens (
        id SERIAL PRIMARY KEY,
        org_id TEXT DEFAULT 'org_default',
        access_token TEXT,
        refresh_token TEXT,
        token_type TEXT,
        expiry_date BIGINT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
  }

  // Health/status endpoint to reflect dependency readiness
  app.get('/api/google-api/status', async (_req, res) => {
    const google = await loadGoogleApis(ctx);
    res.json({ ok: true, dependency: { googleapis: Boolean(google) } });
  });

  // OAuth status (read-only; no admin required)
  app.get('/api/google-api/oauth/debug', async (_req, res) => {
    await ensureTables();
    try {
      const r = await pool.query(`SELECT access_token, refresh_token, token_type, expiry_date, updated_at FROM mod_google_api_tokens WHERE org_id='org_default' ORDER BY updated_at DESC LIMIT 1`);
      if (!r.rowCount) return res.json({ ok:true, connected:false, last_error:null });
      const row = r.rows[0];
      const exp = row.expiry_date ? Number(row.expiry_date) : 0;
      const connected = !!(row.refresh_token || (row.access_token && exp && Date.now() < exp));
      res.json({ ok:true, connected, token: { has_refresh: !!row.refresh_token, expires_at: exp||null } });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Gmail profile (email address of the connected account)
  app.get('/api/google-api/oauth/profile', async (_req, res) => {
    try {
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      const r = await gmail.users.getProfile({ userId: 'me' });
      const emailAddress = r?.data?.emailAddress || null;
      res.json({ ok: true, email: emailAddress });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_profile_error', message:String(e?.message||e) }); }
  });

  app.get('/api/google-api/config', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    try { const r = await pool.query(`SELECT org_id, client_id, redirect_uri, scopes FROM mod_google_api_settings WHERE org_id='org_default' LIMIT 1`); res.json({ ok:true, config: r.rows[0] || null }); }
    catch (e) { res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  app.post('/api/google-api/config', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    try {
      const b = req.body || {};
      const client_id = String(b.client_id||'').trim();
      const client_secret = String(b.client_secret||'').trim();
      const redirect_uri = String(b.redirect_uri||'').trim();
      const scopes = Array.isArray(b.scopes) ? b.scopes.map(String) : ['https://www.googleapis.com/auth/userinfo.email'];
      await pool.query(`
        INSERT INTO mod_google_api_settings (org_id, client_id, client_secret, redirect_uri, scopes, updated_at)
        VALUES ('org_default',$1,$2,$3,$4::text[],NOW())
        ON CONFLICT (org_id)
        DO UPDATE SET client_id=EXCLUDED.client_id, client_secret=EXCLUDED.client_secret, redirect_uri=EXCLUDED.redirect_uri, scopes=EXCLUDED.scopes, updated_at=NOW()
      `, [client_id, client_secret, redirect_uri, scopes]);
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  app.get('/api/google-api/auth-url', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    try {
      const google = await loadGoogleApis(ctx);
      if (!google) return res.status(503).json({ ok:false, error:'missing_dependency', message: "Install 'googleapis' on the server to enable Google auth." });
      const r = await pool.query(`SELECT client_id, client_secret, redirect_uri, scopes FROM mod_google_api_settings WHERE org_id='org_default' LIMIT 1`);
      if (!r.rowCount) return res.status(400).json({ ok:false, error:'missing_config' });
      const cfg = r.rows[0];
      const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uri);
      // Allow optional extra scopes via query (?scopes=scope1%20scope2)
      const extra = String(req.query?.scopes || '').trim();
      const extraScopes = extra ? extra.split(/[\s,]+/).filter(Boolean) : [];
      const baseScopes = (cfg.scopes && cfg.scopes.length) ? cfg.scopes : ['openid','email','https://www.googleapis.com/auth/userinfo.email'];
      const scopeSet = Array.from(new Set([...(baseScopes||[]), ...extraScopes]));
      const url = oauth2.generateAuthUrl({
        access_type: 'offline',
        include_granted_scopes: true,
        prompt: 'consent',
        scope: scopeSet
      });
      res.json({ ok:true, url });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Revoke tokens and clear
  app.post('/api/google-api/oauth/revoke', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    try {
      const google = await loadGoogleApis(ctx);
      const t = await pool.query(`SELECT access_token, refresh_token FROM mod_google_api_tokens WHERE org_id='org_default' ORDER BY updated_at DESC LIMIT 1`);
      const tok = t.rowCount ? t.rows[0] : {};
      if (google) {
        try {
          const r = await pool.query(`SELECT client_id, client_secret, redirect_uri FROM mod_google_api_settings WHERE org_id='org_default' LIMIT 1`);
          if (r.rowCount) {
            const cfg = r.rows[0];
            const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uri);
            if (tok.access_token) await oauth2.revokeToken(tok.access_token).catch(()=>{});
            if (tok.refresh_token) await oauth2.revokeToken(tok.refresh_token).catch(()=>{});
          }
        } catch {}
      }
      await pool.query(`UPDATE mod_google_api_tokens SET access_token=NULL, refresh_token=NULL, token_type=NULL, expiry_date=NULL, updated_at=NOW() WHERE org_id='org_default'`);
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  async function handleOauthCallback(req, res) {
    try {
      await ensureTables();
      const google = await loadGoogleApis(ctx);
      if (!google) return res.status(503).json({ ok:false, error:'missing_dependency', message: "Install 'googleapis' on the server to enable Google OAuth callback." });
      const code = String(req.query?.code || '').trim();
      if (!code) return res.status(400).json({ ok:false, error:'missing_code' });
      const r = await pool.query(`SELECT client_id, client_secret, redirect_uri FROM mod_google_api_settings WHERE org_id='org_default' LIMIT 1`);
      if (!r.rowCount) return res.status(400).json({ ok:false, error:'missing_config' });
      const cfg = r.rows[0];
      const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uri);
      const tokenResp = await oauth2.getToken(code);
      const tok = tokenResp.tokens || {};
      // Idempotent write using UPDATE-then-INSERT to avoid needing pool.connect()
      const upd = await pool.query(`
        UPDATE mod_google_api_tokens
           SET access_token=$1, refresh_token=$2, token_type=$3, expiry_date=$4, updated_at=NOW()
         WHERE org_id='org_default'
      `, [tok.access_token||null, tok.refresh_token||null, tok.token_type||null, tok.expiry_date||null]);
      if (!upd.rowCount) {
        await pool.query(`
          INSERT INTO mod_google_api_tokens (org_id, access_token, refresh_token, token_type, expiry_date, updated_at)
          VALUES ('org_default',$1,$2,$3,$4,NOW())
        `, [tok.access_token||null, tok.refresh_token||null, tok.token_type||null, tok.expiry_date||null]);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><body><script>try{window.opener&&window.opener.postMessage({kind:'oauth_ok'},'*');}catch(e){};window.close();</script><div>OAuth ok. You can close this window.</div></body></html>`);
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  }

  // Primary (namespaced) callback
  app.get('/api/google-api/oauth2/callback', handleOauthCallback);
  // Legacy compatibility callback used by older UIs or env values
  app.get('/api/oauth2/google/callback', handleOauthCallback);

  // Helper to get OAuth2 client with stored tokens
  async function getOauth2() {
    const google = await loadGoogleApis(ctx);
    if (!google) throw new Error('missing_dependency');
    const r = await pool.query(`SELECT client_id, client_secret, redirect_uri FROM mod_google_api_settings WHERE org_id='org_default' LIMIT 1`);
    if (!r.rowCount) throw new Error('missing_config');
    const cfg = r.rows[0];
    const t = await pool.query(`SELECT access_token, refresh_token, token_type, expiry_date FROM mod_google_api_tokens WHERE org_id='org_default' ORDER BY updated_at DESC LIMIT 1`);
    const tok = t.rowCount ? t.rows[0] : {};
    const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uri);
    const creds = {};
    if (tok.access_token) creds.access_token = tok.access_token;
    if (tok.refresh_token) creds.refresh_token = tok.refresh_token;
    if (tok.token_type) creds.token_type = tok.token_type;
    if (tok.expiry_date) creds.expiry_date = Number(tok.expiry_date);
    oauth2.setCredentials(creds);
    return { google, oauth2 };
  }

  // OAuth Gmail labels
  app.get('/api/google-api/oauth/gmail', async (_req, res) => {
    try {
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      const r = await gmail.users.labels.list({ userId: 'me' });
      const labels = (r.data && Array.isArray(r.data.labels)) ? r.data.labels : [];
      res.json({ ok:true, labels });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_error', message:String(e?.message||e) }); }
  });

  // Helpers for Gmail
  function headerValue(payload, name) {
    try {
      const h = (payload?.headers || []).find(h => String(h.name||'').toLowerCase() === String(name||'').toLowerCase());
      return h ? String(h.value || '') : '';
    } catch { return ''; }
  }
  function decodeB64Url(b) {
    try { return Buffer.from(String(b||'').replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'); } catch { return ''; }
  }
  function decodeB64UrlToBuffer(b) {
    try { return Buffer.from(String(b || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch { return Buffer.from([]); }
  }
  function walkBody(payload) {
    const out = { text: '', html: '' };
    try {
      const stack = [payload];
      while (stack.length) {
        const p = stack.pop(); if (!p) continue;
        const mime = String(p.mimeType || '').toLowerCase();
        if (p.parts && Array.isArray(p.parts)) { for (const sp of p.parts) stack.push(sp); }
        if (p.body && p.body.data) {
          const data = decodeB64Url(p.body.data);
          if (mime.includes('text/plain')) out.text += data;
          else if (mime.includes('text/html')) out.html += data;
        }
      }
    } catch {}
    return out;
  }

  function safeFilename(input) {
    const raw = String(input || '').trim();
    if (!raw) return 'attachment';
    // Remove path separators and control chars
    const cleaned = raw
      .replace(/[\\\/\u0000-\u001f\u007f]+/g, '_')
      .replace(/["']/g, '_')
      .slice(0, 180)
      .trim();
    return cleaned || 'attachment';
  }

  function headerValueByName(headers, name) {
    try {
      const n = String(name || '').toLowerCase();
      const h = Array.isArray(headers) ? headers.find((x) => String(x?.name || '').toLowerCase() === n) : null;
      return h?.value || '';
    } catch {
      return '';
    }
  }

  function collectAttachments(payload) {
    const out = [];
    try {
      const stack = [payload];
      while (stack.length) {
        const p = stack.pop(); if (!p) continue;
        const parts = Array.isArray(p.parts) ? p.parts : [];
        for (const sp of parts) stack.push(sp);

        const attachmentId = String(p?.body?.attachmentId || '').trim();
        const filename = String(p?.filename || '').trim();
        if (!attachmentId && !filename) continue;

        const headers = Array.isArray(p.headers) ? p.headers : [];
        const disp = headerValueByName(headers, 'Content-Disposition');
        const cid = headerValueByName(headers, 'Content-ID');
        const isInline = /inline/i.test(disp) || !!cid;

        out.push({
          attachmentId: attachmentId || null,
          partId: p.partId || null,
          filename: filename || null,
          mimeType: p.mimeType || null,
          size: p?.body?.size != null ? Number(p.body.size) : null,
          isInline,
          contentId: cid ? String(cid).trim() : null,
        });
      }
    } catch {}
    // De-dupe by attachmentId/filename
    const seen = new Set();
    return out.filter((x) => {
      const key = `${x.attachmentId || ''}::${x.filename || ''}::${x.partId || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Gmail: list messages
  app.get('/api/google-api/oauth/gmail/messages', async (req, res) => {
    try {
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      let labelIds = [];
      const raw = (req.query.labelIds ?? req.query.labels ?? req.query.labelId ?? req.query.label);
      if (Array.isArray(raw)) labelIds = raw.map(String).filter(Boolean);
      else if (typeof raw === 'string' && raw.trim()) labelIds = raw.split(',').map(s=>s.trim()).filter(Boolean);
      if (!labelIds.length) labelIds = ['INBOX'];
      const maxResults = Math.min(50, Math.max(1, Number(req.query.max || req.query.maxResults || 20)));
      let q = String(req.query.q || '').trim();
      // Convenience: if caller passes only an email address, treat it as `from:<email>`
      try {
        const isEmailOnly = q && !q.includes(':') && !/\s/.test(q) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);
        if (isEmailOnly) q = `from:${q}`;
      } catch {}
      q = q || undefined;
      const list = await gmail.users.messages.list({ userId: 'me', labelIds, maxResults, q });
      const msgs = Array.isArray(list.data.messages) ? list.data.messages : [];
      const out = [];
      for (const m of msgs) {
        try {
          const g = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From','Subject','Date'] });
          const payload = g.data.payload || {};
          const subject = headerValue(payload, 'Subject');
          const from = headerValue(payload, 'From');
          const date = headerValue(payload, 'Date');
          out.push({ id: m.id, threadId: g.data.threadId, labelIds: g.data.labelIds || [], snippet: g.data.snippet || '', subject, from, date });
        } catch {}
      }
      res.json({ ok:true, items: out });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_list_error', message:String(e?.message||e) }); }
  });

  // Gmail: get message detail
  app.get('/api/google-api/oauth/gmail/messages/:id', async (req, res) => {
    try {
      const id = String(req.params.id||'').trim(); if (!id) return res.status(400).json({ ok:false, error:'bad_id' });
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      const g = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = g.data.payload || {};
      const subject = headerValue(payload, 'Subject');
      const from = headerValue(payload, 'From');
      const to = headerValue(payload, 'To');
      const date = headerValue(payload, 'Date');
      const body = walkBody(payload);
      const attachments = collectAttachments(payload);
      res.json({ ok:true, id, threadId: g.data.threadId, labelIds: g.data.labelIds || [], snippet: g.data.snippet || '', subject, from, to, date, body_text: body.text, body_html: body.html, attachments });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_get_error', message:String(e?.message||e) }); }
  });

  // Gmail: download attachment
  app.get('/api/google-api/oauth/gmail/messages/:id/attachments/:attachmentId', async (req, res) => {
    try {
      const messageId = String(req.params.id || '').trim();
      const attachmentId = String(req.params.attachmentId || '').trim();
      if (!messageId || !attachmentId) return res.status(400).json({ ok:false, error:'bad_request' });

      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });

      // Best-effort lookup for filename/mimeType by scanning message payload
      let filename = safeFilename(req.query?.filename || '');
      let mimeType = String(req.query?.mimeType || '').trim() || 'application/octet-stream';
      const wantInline = String(req.query?.inline || '').trim() === '1';
      try {
        const g = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
        const payload = g.data.payload || {};
        const atts = collectAttachments(payload);
        const found = atts.find((a) => a.attachmentId === attachmentId) || null;
        if (found) {
          if (found.filename) filename = safeFilename(found.filename);
          if (found.mimeType) mimeType = String(found.mimeType);
        }
      } catch {}

      const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
      const buf = a?.data?.data ? decodeB64UrlToBuffer(a.data.data) : Buffer.from([]);

      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      // Allow inline previews for images/PDFs when explicitly requested.
      const isPreviewable = /^image\//i.test(mimeType || '') || String(mimeType || '').toLowerCase() === 'application/pdf';
      const disposition = wantInline && isPreviewable ? 'inline' : 'attachment';
      res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    } catch (e) {
      res.status(500).json({ ok:false, error:'gmail_attachment_error', message:String(e?.message||e) });
    }
  });

  // Gmail: label modifications (read/unread/star)
  app.post('/api/google-api/oauth/gmail/messages/:id/mark-read', async (req, res) => {
    try {
      const id = String(req.params.id||'').trim(); if (!id) return res.status(400).json({ ok:false });
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      await gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['UNREAD'] } });
      // Also mark the whole thread read for consistency with Gmail UI
      try {
        const g = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata' });
        const threadId = g?.data?.threadId;
        if (threadId) await gmail.users.threads.modify({ userId: 'me', id: threadId, requestBody: { removeLabelIds: ['UNREAD'] } });
      } catch {}
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_mark_read_error', message:String(e?.message||e) }); }
  });
  app.post('/api/google-api/oauth/gmail/messages/:id/mark-unread', async (req, res) => {
    try {
      const id = String(req.params.id||'').trim(); if (!id) return res.status(400).json({ ok:false });
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      await gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: ['UNREAD'] } });
      // Also mark the whole thread unread (adds UNREAD back on the thread)
      try {
        const g = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata' });
        const threadId = g?.data?.threadId;
        if (threadId) await gmail.users.threads.modify({ userId: 'me', id: threadId, requestBody: { addLabelIds: ['UNREAD'] } });
      } catch {}
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_mark_unread_error', message:String(e?.message||e) }); }
  });
  app.post('/api/google-api/oauth/gmail/messages/:id/star', async (req, res) => {
    try {
      const id = String(req.params.id||'').trim(); if (!id) return res.status(400).json({ ok:false });
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      await gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: ['STARRED'] } });
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_star_error', message:String(e?.message||e) }); }
  });
  app.post('/api/google-api/oauth/gmail/messages/:id/unstar', async (req, res) => {
    try {
      const id = String(req.params.id||'').trim(); if (!id) return res.status(400).json({ ok:false });
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      await gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['STARRED'] } });
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_unstar_error', message:String(e?.message||e) }); }
  });

  // Gmail: delete (move to Trash)
  app.post('/api/google-api/oauth/gmail/messages/:id/delete', async (req, res) => {
    try {
      const id = String(req.params.id||'').trim(); if (!id) return res.status(400).json({ ok:false });
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      await gmail.users.messages.trash({ userId: 'me', id });
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_delete_error', message:String(e?.message||e) }); }
  });

  // Gmail: reply and forward (simple text-only)
  function toBase64Url(str) {
    return Buffer.from(str).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  async function getThreadMeta(google, oauth2, id) {
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const g = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject','From','To','Message-ID','References'] });
    return { threadId: g.data.threadId, headers: g.data.payload?.headers || [] };
  }
  app.post('/api/google-api/oauth/gmail/messages/:id/reply', async (req, res) => {
    try {
      const id = String(req.params.id||'').trim(); if (!id) return res.status(400).json({ ok:false });
      const body = (req.body && typeof req.body==='object') ? req.body : {};
      const text = String(body.text || '').trim();
      const { google, oauth2 } = await getOauth2();
      const { threadId, headers } = await getThreadMeta(google, oauth2, id);
      const from = (headers.find(h=>/from/i.test(h.name))||{}).value || '';
      const subj = (headers.find(h=>/subject/i.test(h.name))||{}).value || '';
      const mid = (headers.find(h=>/message-id/i.test(h.name))||{}).value || '';
      const extra = mid ? `\nIn-Reply-To: ${mid}\nReferences: ${mid}` : '';
      const msg = `To: ${from}\nSubject: Re: ${subj}${extra}\n\n${text}`;
      const raw = toBase64Url(msg);
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId } });
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_reply_error', message:String(e?.message||e) }); }
  });
  app.post('/api/google-api/oauth/gmail/messages/:id/forward', async (req, res) => {
    try {
      const id = String(req.params.id||'').trim(); if (!id) return res.status(400).json({ ok:false });
      const body = (req.body && typeof req.body==='object') ? req.body : {};
      const to = String(body.to || '').trim();
      const text = String(body.text || '').trim();
      const { google, oauth2 } = await getOauth2();
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      const g = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject','From','Date','Message-ID','References'] });
      const payload = g.data.payload || {};
      const subj = headerValue(payload, 'Subject');
      const from = headerValue(payload, 'From');
      const date = headerValue(payload, 'Date');
      const refs = headerValue(payload, 'Message-ID');
      const fwd = `To: ${to}\nSubject: Fwd: ${subj}${refs?`\nReferences: ${refs}`:''}\n\n---------- Forwarded message ----------\nFrom: ${from}\nDate: ${date}\nSubject: ${subj}\n\n${text}`;
      const raw = toBase64Url(fwd);
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'gmail_forward_error', message:String(e?.message||e) }); }
  });

  // People API: list contacts (basic fields)
  app.get('/api/google-api/oauth/people', async (req, res) => {
    try {
      const { google, oauth2 } = await getOauth2();
      const people = google.people({ version: 'v1', auth: oauth2 });
      const pageSize = Math.min(1000, Math.max(1, Number(req.query.max || 500)));
      const personFields = String(req.query.fields || 'names,emailAddresses,phoneNumbers,organizations').replace(/\s+/g, ',');
      const pageToken = String(req.query.pageToken || '').trim() || undefined;
      const r = await people.people.connections.list({ resourceName: 'people/me', pageSize, personFields, pageToken });
      const contacts = (r.data.connections || []).map(c => ({
        resourceName: c.resourceName || null,
        name: (c.names && c.names[0] && (c.names[0].displayName || (c.names[0].givenName || '') + (c.names[0].familyName ? (' ' + c.names[0].familyName) : ''))) || '',
        email: (c.emailAddresses && c.emailAddresses[0] && c.emailAddresses[0].value) || '',
        phone: (c.phoneNumbers && c.phoneNumbers[0] && c.phoneNumbers[0].value) || '',
        organization: (c.organizations && c.organizations[0] && c.organizations[0].name) || '',
        jobTitle: (c.organizations && c.organizations[0] && c.organizations[0].title) || '',
      }));
      res.json({ ok:true, contacts, nextPageToken: r.data.nextPageToken || null });
    } catch (e) { res.status(500).json({ ok:false, error:'people_error', message:String(e?.message||e) }); }
  });

  // People API: create contact (requires contacts scope)
  app.post('/api/google-api/oauth/people', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const { google, oauth2 } = await getOauth2();
      const people = google.people({ version: 'v1', auth: oauth2 });
      const fullName = String(body.name || '').trim();
      let givenName = String(body.givenName || '').trim();
      let familyName = String(body.familyName || '').trim();
      if (!givenName && !familyName && fullName) {
        const parts = fullName.split(/\s+/);
        givenName = parts.shift() || '';
        familyName = parts.join(' ');
      }
      const person = {
        names: (givenName || familyName || fullName) ? [{ givenName: givenName || undefined, familyName: familyName || undefined, unstructuredName: fullName || undefined }] : undefined,
        emailAddresses: body.email ? [{ value: String(body.email) }] : undefined,
        phoneNumbers: body.phone ? [{ value: String(body.phone) }] : undefined,
        organizations: (body.organization || body.jobTitle) ? [{ name: String(body.organization||''), title: String(body.jobTitle||'') }] : undefined,
      };
      const r = await people.people.createContact({ requestBody: person });
      return res.json({ ok: true, resourceName: r?.data?.resourceName || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'people_create_error', message:String(e?.message||e) }); }
  });

  // People API: update contact (requires contacts scope)
  // Support resourceName with slashes (e.g., "people/c123...") via wildcard
  app.patch('/api/google-api/oauth/people/*', async (req, res) => {
    try {
      const resourceName = decodeURIComponent(String(req.params[0] || '')).trim();
      if (!resourceName) return res.status(400).json({ ok:false, error:'bad_resourceName' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const { google, oauth2 } = await getOauth2();
      const people = google.people({ version: 'v1', auth: oauth2 });
      const g = await people.people.get({ resourceName, personFields: 'names,emailAddresses,phoneNumbers,organizations' });
      const etag = g?.data?.etag;
      if (!etag) return res.status(409).json({ ok:false, error:'missing_etag' });
      const person = { resourceName, etag };
      if (body.name || body.givenName || body.familyName) {
        let givenName = String(body.givenName||'').trim();
        let familyName = String(body.familyName||'').trim();
        if (!givenName && !familyName && body.name) {
          const parts = String(body.name).trim().split(/\s+/); givenName = parts.shift()||''; familyName = parts.join(' ');
        }
        person.names = [{ givenName: givenName||undefined, familyName: familyName||undefined, unstructuredName: String(body.name||'').trim()||undefined }];
      }
      if (body.email !== undefined) person.emailAddresses = body.email ? [{ value: String(body.email) }] : [];
      if (body.phone !== undefined) person.phoneNumbers = body.phone ? [{ value: String(body.phone) }] : [];
      if (body.organization !== undefined || body.jobTitle !== undefined) person.organizations = (body.organization||body.jobTitle) ? [{ name: String(body.organization||''), title: String(body.jobTitle||'') }] : [];
      const mask = [];
      if (person.names) mask.push('names');
      if (person.emailAddresses) mask.push('emailAddresses');
      if (person.phoneNumbers) mask.push('phoneNumbers');
      if (person.organizations) mask.push('organizations');
      const r = await people.people.updateContact({ resourceName, updatePersonFields: mask.join(','), requestBody: person });
      return res.json({ ok:true, resourceName: r?.data?.resourceName || resourceName });
    } catch (e) { return res.status(500).json({ ok:false, error:'people_update_error', message:String(e?.message||e) }); }
  });

  // People API: delete contact (requires contacts scope)
  app.delete('/api/google-api/oauth/people/*', async (req, res) => {
    try {
      const resourceName = decodeURIComponent(String(req.params[0] || '')).trim();
      if (!resourceName) return res.status(400).json({ ok:false, error:'bad_resourceName' });
      const { google, oauth2 } = await getOauth2();
      const people = google.people({ version: 'v1', auth: oauth2 });
      await people.people.deleteContact({ resourceName });
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'people_delete_error', message:String(e?.message||e) }); }
  });

  // OAuth Calendar events
  app.get('/api/google-api/oauth/calendar', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const { google, oauth2 } = await getOauth2();
      const calendar = google.calendar({ version: 'v3', auth: oauth2 });
      const now = new Date().toISOString();
      const r = await calendar.events.list({ calendarId: 'primary', timeMin: now, singleEvents: true, orderBy: 'startTime', maxResults: 10 });
      const items = (r.data && Array.isArray(r.data.items)) ? r.data.items : [];
      res.json({ ok:true, count: items.length, items });
    } catch (e) { res.status(500).json({ ok:false, error:'calendar_error', message:String(e?.message||e) }); }
  });

  // OAuth Drive files
  app.get('/api/google-api/oauth/drive', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const { google, oauth2 } = await getOauth2();
      const drive = google.drive({ version: 'v3', auth: oauth2 });
      const r = await drive.files.list({ pageSize: 10, fields: 'files(id,name,mimeType,modifiedTime)' });
      const files = (r.data && Array.isArray(r.data.files)) ? r.data.files : [];
      res.json({ ok:true, count: files.length, files });
    } catch (e) { res.status(500).json({ ok:false, error:'drive_error', message:String(e?.message||e) }); }
  });

  // Sheets values → JSON (simple wrapper)
  app.get('/api/google-api/sheets/values', async (req, res) => {
    try {
      const { google, oauth2 } = await getOauth2();
      const sheets = google.sheets({ version: 'v4', auth: oauth2 });
      let spreadsheetId = (req.query.spreadsheetId || req.query.id || '').toString().trim();
      const url = (req.query.url || '').toString().trim();
      if (!spreadsheetId && url) {
        const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (m) spreadsheetId = m[1];
      }
      if (!spreadsheetId) return res.status(400).json({ ok:false, error:'missing_spreadsheetId' });
      // Optional: infer sheet title from gid
      let gid = null;
      const urlGid = (url.match(/[?&]gid=(\d+)/) || [])[1];
      if (urlGid) gid = Number(urlGid);
      let range = (req.query.range || '').toString().trim();
      let sheetTitle = (req.query.sheet || '').toString().trim();
      if (!sheetTitle && gid != null) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
        const sh = (meta.data.sheets || []).find(s => (s.properties?.sheetId) === gid);
        if (sh) sheetTitle = sh.properties.title;
      }
      if (!range) {
        range = sheetTitle ? `${sheetTitle}!A:Z` : 'A:Z';
      } else if (sheetTitle && !range.includes('!')) {
        range = `${sheetTitle}!${range}`;
      }
      const valueRenderOption = (req.query.valueRenderOption || 'UNFORMATTED_VALUE').toString();
      const dateTimeRenderOption = (req.query.dateTimeRenderOption || 'FORMATTED_STRING').toString();
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption, dateTimeRenderOption });
      const values = Array.isArray(r.data.values) ? r.data.values : [];
      return res.json({ ok:true, spreadsheetId, range, values });
    } catch (e) { res.status(500).json({ ok:false, error:'sheets_values_error', message:String(e?.message||e) }); }
  });

  // Sheets values → CSV/TSV text (for piping into other importers)
  app.get('/api/google-api/sheets/values.csv', async (req, res) => {
    try {
      // Proxy to JSON endpoint logic by calling getOauth2 again
      const { google, oauth2 } = await getOauth2();
      const sheets = google.sheets({ version: 'v4', auth: oauth2 });
      let spreadsheetId = (req.query.spreadsheetId || req.query.id || '').toString().trim();
      const url = (req.query.url || '').toString().trim();
      if (!spreadsheetId && url) {
        const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (m) spreadsheetId = m[1];
      }
      if (!spreadsheetId) return res.status(400).send('');
      let gid = null;
      const urlGid = (url.match(/[?&]gid=(\d+)/) || [])[1];
      if (urlGid) gid = Number(urlGid);
      let range = (req.query.range || '').toString().trim();
      let sheetTitle = (req.query.sheet || '').toString().trim();
      if (!sheetTitle && gid != null) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
        const sh = (meta.data.sheets || []).find(s => (s.properties?.sheetId) === gid);
        if (sh) sheetTitle = sh.properties.title;
      }
      if (!range) range = sheetTitle ? `${sheetTitle}!A:Z` : 'A:Z';
      else if (sheetTitle && !range.includes('!')) range = `${sheetTitle}!${range}`;
      const valueRenderOption = (req.query.valueRenderOption || 'UNFORMATTED_VALUE').toString();
      const dateTimeRenderOption = (req.query.dateTimeRenderOption || 'FORMATTED_STRING').toString();
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption, dateTimeRenderOption });
      const values = Array.isArray(r.data.values) ? r.data.values : [];
      const delim = (req.query.delimiter || ',').toString() === 'tab' ? '\t' : (req.query.delimiter || ',');
      const csv = values.map(row => row.map(cell => {
        const s = cell == null ? '' : String(cell);
        const needsQuote = s.includes('\n') || s.includes('\r') || s.includes('"') || s.includes(delim);
        const esc = s.replace(/"/g, '""');
        return needsQuote ? `"${esc}"` : esc;
      }).join(delim)).join('\n');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(csv);
    } catch (e) { res.status(500).send(''); }
  });
}
