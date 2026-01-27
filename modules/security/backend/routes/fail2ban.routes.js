import { getFail2banJailStatus, getFail2banOverview } from '../services/fail2ban.service.js';
import { analyzeRemoteAccessUnifiedLog } from '../services/fail2banAdvisor.service.js';
import { parseOrgIdFromRequest } from '../utils/parseOrgId.js';

function pickBool(v) {
  try {
    if (v === true) return true;
    if (v === false) return false;
    const s = String(v || '').trim().toLowerCase();
    return s === '1' || s === 't' || s === 'true' || s === 'yes' || s === 'y';
  } catch {
    return false;
  }
}

export function registerSecurityFail2banRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin;
  const logToFile = ctx.logToFile;
  const chatLog = ctx.chatLog;

  const normalizeError = (e) => {
    const code = e?.code || e?.errno || null;
    if (code === 'ENOENT') return { status: 404, message: 'fail2ban-client not found (is Fail2ban installed?)' };
    if (code === 'not_configured') return { status: 400, message: e?.message || 'Remote SSH is not configured.' };
    if (code === 'fail2ban_permission') return { status: 403, message: e?.message || 'Permission denied reading Fail2ban status.' };
    if (code === 'invalid_log_path') return { status: 400, message: e?.message || 'Invalid log path.' };
    if (code === 'log_missing') return { status: 404, message: e?.message || 'Log file not found.', hint: e?.hint };
    return { status: 500, message: e?.message || String(e) };
  };

  app.get('/api/security/fail2ban/jails', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const includeIps = pickBool(req.query?.include_ips);
      const items = await getFail2banOverview({ pool, orgId, includeIps, maxIps: 50 });
      res.json({ ok: true, items });
    } catch (e) {
      const norm = normalizeError(e);
      try { chatLog?.('security.fail2ban.list.error', { message: e?.message || String(e) }); } catch {}
      try { logToFile?.(`[security] fail2ban:list error: ${e?.message || e}`); } catch {}
      res.status(norm.status).json({ ok: false, error: 'server_error', message: norm.message });
    }
  });

  app.get('/api/security/fail2ban/jails/:jail', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const includeIps = pickBool(req.query?.include_ips);
      const item = await getFail2banJailStatus(req.params.jail, { pool, orgId, includeIps });
      res.json({ ok: true, item });
    } catch (e) {
      const norm = normalizeError(e);
      const status = e?.code === 'invalid_jail' ? 400 : norm.status;
      try { chatLog?.('security.fail2ban.jail.error', { jail: req.params.jail, message: e?.message || String(e) }); } catch {}
      try { logToFile?.(`[security] fail2ban:jail error: ${req.params.jail}: ${e?.message || e}`); } catch {}
      res.status(status).json({ ok: false, error: 'server_error', message: status === 400 ? (e?.message || String(e)) : norm.message });
    }
  });

  app.get('/api/security/fail2ban/analyze', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const lines = Number(req.query?.lines);
      const fromMinutes = Number(req.query?.fromMinutes);
      const analysis = await analyzeRemoteAccessUnifiedLog({ pool, orgId, lines, fromMinutes });
      res.json({ ok: true, ...analysis });
    } catch (e) {
      const norm = normalizeError(e);
      try { chatLog?.('security.fail2ban.analyze.error', { message: e?.message || String(e) }); } catch {}
      try { logToFile?.(`[security] fail2ban:analyze error: ${e?.message || e}`); } catch {}
      res.status(norm.status).json({ ok: false, error: 'server_error', message: norm.message, hint: norm.hint });
    }
  });
}
