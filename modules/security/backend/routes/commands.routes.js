import { ensureCommandsTable, listCommands, createCommand, updateCommand, deleteCommand, findCommand } from '../services/commands.service.js';
import { runRemoteCommand } from '../services/commandRunner.service.js';
import { parseOrgIdFromRequest } from '../utils/parseOrgId.js';

export function registerSecurityCommandsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin;
  const logToFile = ctx.logToFile;

  app.get('/api/security/commands', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      await ensureCommandsTable(pool);
      const commands = await listCommands(pool, { orgId });
      res.json({ ok: true, org_id: orgId, commands });
    } catch (e) {
      try { logToFile?.(`[security] commands:get error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/security/commands', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const command = String(body.command || '').trim();
      if (!name || !command) return res.status(400).json({ ok: false, error: 'invalid_payload' });
      await ensureCommandsTable(pool);
      const row = await createCommand(pool, { orgId, name, command });
      res.json({ ok: true, command: row });
    } catch (e) {
      try { logToFile?.(`[security] commands:post error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.put('/api/security/commands/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const id = Number(req.params.id || 0);
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const body = req.body || {};
      const name = body.name !== undefined ? String(body.name || '').trim() : undefined;
      const command = body.command !== undefined ? String(body.command || '').trim() : undefined;
      if (name === '' || command === '') {
        return res.status(400).json({ ok: false, error: 'invalid_payload' });
      }
      const row = await updateCommand(pool, { id, orgId, name, command });
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, command: row });
    } catch (e) {
      try { logToFile?.(`[security] commands:put error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.delete('/api/security/commands/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const id = Number(req.params.id || 0);
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
      await deleteCommand(pool, { id, orgId });
      res.json({ ok: true });
    } catch (e) {
      try { logToFile?.(`[security] commands:delete error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/security/commands/:id/run', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const id = Number(req.params.id || 0);
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });

      await ensureCommandsTable(pool);
      const row = await findCommand(pool, { orgId, id });
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

      const timeoutMs = Number(req.body?.timeoutMs);
      const result = await runRemoteCommand({ pool, orgId, command: row.command, timeoutMs });
      res.json({ ok: true, id: row.id, name: row.name, result });
    } catch (e) {
      const code = e?.code || null;
      if (code === 'not_configured') return res.status(400).json({ ok: false, error: 'not_configured', message: e?.message || 'Remote SSH is not configured.' });
      if (code === 'invalid_command') return res.status(400).json({ ok: false, error: 'invalid_command', message: e?.message || 'Invalid command.' });
      try { logToFile?.(`[security] commands:run error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || 'Server error' });
    }
  });
}
