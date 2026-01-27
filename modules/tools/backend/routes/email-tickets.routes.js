import { createTicketFromEmail } from '../services/ticket.service.js';

function pickOrgId(req) {
  try {
    const raw =
      req.headers?.['x-org-id'] ||
      req.query?.org_id ||
      req.query?.ORG_ID ||
      req.body?.org_id ||
      req.body?.orgId;
    if (!raw && raw !== 0) return null;
    const trimmed = String(raw || '').trim();
    if (!trimmed && raw !== 0) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function registerToolsEmailTicketsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : () => {};
  const logToFile = typeof ctx.logToFile === 'function' ? ctx.logToFile : () => {};

  app.post('/api/tools/email/tickets', async (req, res) => {
    const body = req.body || {};
    const orgId = pickOrgId(req);
    if (!body.messageId && !body.id) {
      return res.status(400).json({
        ok: false,
        error: 'missing_message_id',
        message: 'messageId (or id) is required',
      });
    }
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection is unavailable' });
    }
    try {
      const result = await createTicketFromEmail({ pool, body, orgId, chatLog });
      const ticket = result?.ticket;
      if (!ticket) {
        throw new Error('ticket_insert_failed');
      }
      logToFile?.(`[tools] email ticket created: ${ticket.id}`);
      return res.json({
        ok: true,
        message: 'Ticket créé',
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          queue: ticket.queue,
          customer_email: ticket.customer_email,
          customer_name: ticket.customer_name,
        },
      });
    } catch (error) {
      const msg = String(error?.message || error || 'unknown');
      const status = msg === 'missing_message_id' ? 400 : 500;
      logToFile?.(`[tools] email ticket creation failed: ${msg}`);
      try {
        if (typeof chatLog === 'function') chatLog('tools_ticket_email_error', { message: msg.slice(0, 240) });
      } catch {}
      return res.status(status).json({
        ok: false,
        error: msg || 'ticket_create_failed',
        message: status === 400 ? 'La demande est invalide.' : 'Impossible de créer le ticket.',
      });
    }
  });
}
