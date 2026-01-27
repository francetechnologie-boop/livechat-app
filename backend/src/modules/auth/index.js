import crypto from "crypto";
import bcrypt from "bcrypt";

export function createAuthModule({ app, pool, logToFile }) {
  const AUTH_SECRET = process.env.AUTH_SECRET || "change-me-dev";
  const COOKIE_SECURE = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || "");

  // Determine agents table name at runtime (prefer mod_agents_agents; fallback to agents)
  let AGENTS_TABLE = null;
  async function getAgentsTable() {
    if (AGENTS_TABLE) return AGENTS_TABLE;
    try {
      const r = await pool.query("SELECT to_regclass('public.mod_agents_agents') AS t1, to_regclass('public.agents') AS t2");
      const row = (r && r.rows && r.rows[0]) || {};
      if (row.t1) AGENTS_TABLE = 'mod_agents_agents';
      else if (row.t2) AGENTS_TABLE = 'agents';
      else AGENTS_TABLE = 'mod_agents_agents';
    } catch {
      AGENTS_TABLE = 'mod_agents_agents';
    }
    return AGENTS_TABLE;
  }

  function signToken(claims = {}, ttlSeconds = 60 * 60 * 24 * 7) {
    const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds);
    const payload = { ...claims, exp };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
    return `${body}.${sig}`;
  }

  function verifyToken(t) {
    try {
      if (!t || typeof t !== "string") return null;
      const [body, sig] = t.split(".");
      if (!body || !sig) return null;
      const expSig = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
      if (sig !== expSig) return null;
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function parseCookie(header = "") {
    const out = {};
    String(header || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((kv) => {
        const [k, ...rest] = kv.split("=");
        if (!k) return;
        out[k.trim()] = decodeURIComponent(rest.join("=") || "");
      });
    return out;
  }

  function authFromRequest(req) {
    try {
      const cookie = parseCookie(req.headers?.cookie || "");
      const token = cookie.auth || req.headers?.authorization?.replace(/^Bearer\s+/i, "").trim();
      if (!token) return null;
      return verifyToken(token);
    } catch {
      return null;
    }
  }

  function setAuthCookie(res, token) {
    const parts = [
      `auth=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${7 * 24 * 60 * 60}`,
    ];
    if (COOKIE_SECURE) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  function clearAuthCookie(res) {
    const parts = [
      "auth=",
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
    ];
    if (COOKIE_SECURE) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  function requireAuth(req, res) {
    const user = authFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
    return user;
  }

  function requireAdmin(req, res) {
    const user = requireAuth(req, res);
    if (!user) return null;
    if (String(user.role || "") !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return null;
    }
    return user;
  }

  async function handleLogin(req, res) {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const pwd = String(req.body?.password || '').trim();
      if (!email || !pwd) return res.status(400).json({ error: 'bad_request' });
      const T = await getAgentsTable();
      const r = await pool.query(
        `SELECT id, name, email, password, is_active, role, preferred_lang, notifications, theme_color, theme_color2, is_superadmin, org_id, ui_state
         FROM ${T} WHERE lower(email) = $1 LIMIT 1`,
        [email]
      );
      if (!r.rowCount) return res.status(401).json({ error: 'invalid_credentials' });
      const a = r.rows[0];
      if (a.is_active === false) return res.status(403).json({ error: 'inactive' });
      const b = await getBcrypt();
      const ok = await b.compare(pwd, a.password || '');
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
      const token = signToken({
        id: a.id,
        email: a.email,
        role: a.role || 'agent',
        is_superadmin: !!a.is_superadmin,
        org_id: a.org_id || null,
      });
      setAuthCookie(res, token);
      // Prefer per-agent preferences for theme over columns (agent-level overrides)
      let theme_color = a.theme_color || null;
      let theme_color2 = a.theme_color2 || null;
      try {
        const pr = await pool.query(`SELECT preferences FROM public.mod_agents_preferences WHERE agent_id = $1 LIMIT 1`, [a.id]);
        if (pr.rowCount) {
          const prefs = pr.rows[0].preferences || {};
          if (prefs.theme_color) theme_color = String(prefs.theme_color);
          if (prefs.theme_color2) theme_color2 = String(prefs.theme_color2);
        }
      } catch {}
      res.json({
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        is_superadmin: !!a.is_superadmin,
        org_id: a.org_id || null,
        preferred_lang: a.preferred_lang,
        notifications: a.notifications,
        theme_color,
        theme_color2,
        ui_state: a.ui_state || null,
      });
    } catch (e) {
      logToFile(`❌ POST /api/auth/login: ${e.message}`);
      { const msg = String(e?.message || ''); if (/timeout exceeded|ECONNREFUSED|ENOTFOUND|no pg_hba|password authentication failed/i.test(msg)) { return res.status(503).json({ error: 'db_unavailable' }); } return res.status(500).json({ error: 'server_error' }); }
    }
  }

  function registerRoutes() {
    app.post('/api/auth/login', handleLogin);

    app.post('/api/auth/logout', async (_req, res) => {
      clearAuthCookie(res);
      res.json({ ok: true });
    });

    app.get('/api/auth/me', async (req, res) => {
      try {
        const u = authFromRequest(req);
        if (!u) return res.status(401).json({ error: 'unauthorized' });
        const T = await getAgentsTable();
        const r = await pool.query(
          `SELECT id, name, email, is_active, role, preferred_lang, notifications, theme_color, theme_color2, ui_state, last_login, is_superadmin, org_id
           FROM ${T} WHERE id = $1`,
          [u.id]
        );
        if (!r.rowCount) return res.status(401).json({ error: 'unauthorized' });
        const a = r.rows[0];
        // Prefer per-agent preferences for theme over columns
        try {
          const pr = await pool.query(`SELECT preferences FROM public.mod_agents_preferences WHERE agent_id = $1 LIMIT 1`, [a.id]);
          if (pr.rowCount) {
            const prefs = pr.rows[0].preferences || {};
            if (prefs.theme_color) a.theme_color = String(prefs.theme_color);
            if (prefs.theme_color2) a.theme_color2 = String(prefs.theme_color2);
          }
        } catch {}
        res.json(a);
      } catch (e) {
        { const msg = String(e?.message || ''); if (/timeout exceeded|ECONNREFUSED|ENOTFOUND|no pg_hba|password authentication failed/i.test(msg)) { return res.status(503).json({ error: 'db_unavailable' }); } return res.status(500).json({ error: 'server_error' }); }
      }
    });

    app.patch('/api/me', async (req, res) => {
      try {
        const u = requireAuth(req, res); if (!u) return;
        const b = req.body || {};
        const sets = [];
        const vals = [];
        let idx = 1;
        const pick = (key, column) => {
          if (b[key] === undefined) return;
          sets.push(`${column} = $${idx}`);
          vals.push(b[key]);
          idx += 1;
        };
        pick('name', 'name');
        pick('preferred_lang', 'preferred_lang');
        pick('notifications', 'notifications');
        pick('theme_color', 'theme_color');
        pick('theme_color2', 'theme_color2');
        pick('ui_state', 'ui_state');
        if (b.password) {
          const bc = await getBcrypt();
          const hash = await bc.hash(String(b.password), 10);
          sets.push(`password = $${idx}`);
          vals.push(hash);
          idx += 1;
        }
        // Log saved parameters to chat.log (exclude password); truncate long JSON
        try {
          const keys = ['name','preferred_lang','notifications','theme_color','theme_color2','ui_state'];
          for (const k of keys) {
            if (b[k] !== undefined) {
              let v = b[k];
              let out;
              if (v == null) out = 'null';
              else if (typeof v === 'object') {
                try { out = JSON.stringify(v); } catch { out = String(v); }
                if (out.length > 400) out = out.slice(0, 400) + `…(${out.length})`;
              } else out = String(v);
              logToFile?.(`[profile_saved] agent=${u.id} ${k}=${out}`);
            }
          }
          if (b.password) {
            logToFile?.(`[profile_saved] agent=${u.id} password=***masked***`);
          }
        } catch {}
        if (!sets.length) return res.json({ ok: true });
        vals.push(u.id);
        const T = await getAgentsTable();
        await pool.query(`UPDATE ${T} SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
        res.json({ ok: true });
      } catch (e) {
        { const msg = String(e?.message || ''); if (/timeout exceeded|ECONNREFUSED|ENOTFOUND|no pg_hba|password authentication failed/i.test(msg)) { return res.status(503).json({ error: 'db_unavailable' }); } return res.status(500).json({ error: 'server_error' }); }
      }
    });

    // Admin: purge UI state for an agent or an org
    app.post('/api/admin/ui-state/purge', async (req, res) => {
      const u = requireAdmin(req, res); if (!u) return;
      try {
        const agentId = req.body && (req.body.agent_id ?? req.body.agentId);
        const orgId = req.body && (req.body.org_id ?? req.body.orgId);
        if (!agentId && !orgId) return res.status(400).json({ ok:false, error: 'missing_target' });
        if (agentId) {
          const T = await getAgentsTable();
          await pool.query(`UPDATE ${T} SET ui_state = NULL WHERE id = $1`, [agentId]);
          return res.json({ ok: true, scope: 'agent', agent_id: agentId });
        }
        if (orgId) {
          const T = await getAgentsTable();
          await pool.query(`UPDATE ${T} SET ui_state = NULL WHERE org_id = $1`, [orgId]);
          return res.json({ ok: true, scope: 'org', org_id: orgId });
        }
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ ok:false, error: 'server_error' });
      }
    });
  }

  registerRoutes();

  return {
    signToken,
    verifyToken,
    parseCookie,
    authFromRequest,
    setAuthCookie,
    clearAuthCookie,
    requireAuth,
    requireAdmin,
  };
}
  // Runtime bcrypt fallback (uses bcryptjs when native bcrypt is unavailable)
  async function getBcrypt() {
    try {
      if (bcrypt && typeof bcrypt.compare === 'function' && typeof bcrypt.hash === 'function') return bcrypt;
    } catch {}
    try {
      const m = await import('bcryptjs');
      const b = m?.default || m;
      if (b && typeof b.compare === 'function' && typeof b.hash === 'function') {
        try { logToFile?.('[auth] using bcryptjs fallback'); } catch {}
        return b;
      }
    } catch (e) { try { logToFile?.(`[auth] bcryptjs fallback load failed: ${e?.message || e}`); } catch {} }
    // Last resort: shim (never matches) to avoid throwing; login will return invalid_credentials
    return {
      async compare(_plain, _hash) { return false; },
      async hash(plain, _rounds) { return crypto.createHash('sha256').update(String(plain)).digest('hex'); }
    };
  }






