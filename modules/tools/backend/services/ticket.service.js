let cachedDefaultOrgId = null;

function normalizeOrgCandidate(value) {
  try {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized ? normalized : null;
  } catch {
    return null;
  }
}

async function resolveOrgId(pool, candidateId) {
  const normalized = normalizeOrgCandidate(candidateId);
  if (normalized) return normalized;
  if (cachedDefaultOrgId !== null) return cachedDefaultOrgId;
  if (!pool) return null;
  try {
    const r = await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
    const fallback = r.rows?.[0]?.id ?? null;
    const fallbackStr = fallback == null ? null : String(fallback);
    cachedDefaultOrgId = fallbackStr;
    return fallbackStr;
  } catch {
    return null;
  }
}

function normalizeText(value, maxLen = 255) {
  try {
    const s = String(value || '').trim();
    if (!s) return '';
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch {
    return '';
  }
}

function parseEmailAddress(raw) {
  try {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return { name: '', email: '' };
    const match = trimmed.match(/^"?(.*?)"?\s*<([^>]+)>$/);
    if (match) {
      return {
        name: normalizeText(match[1], 255),
        email: normalizeText(match[2], 255),
      };
    }
    if (trimmed.includes('@')) {
      return { name: '', email: normalizeText(trimmed, 255) };
    }
    return { name: normalizeText(trimmed, 255), email: '' };
  } catch {
    return { name: '', email: '' };
  }
}

function parseDateValue(value) {
  try {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function sanitizeAttachments(value) {
  try {
    if (!Array.isArray(value)) return null;
    return value.map((item) => {
      if (!item || typeof item !== 'object') return null;
      return {
        filename: item.filename || item.name || null,
        mimeType: item.mimeType || item.mime_type || null,
        size: typeof item.size === 'number' ? item.size : null,
        attachmentId: item.attachmentId || item.id || null,
      };
    }).filter(Boolean);
  } catch {
    return null;
  }
}

export async function createTicketFromEmail({ pool, body = {}, orgId, chatLog }) {
  if (!pool) throw new Error('db_unavailable');
  const resolvedOrgId = await resolveOrgId(pool, orgId);
  const messageId = normalizeText(body.messageId || body.id || '', 512);
  if (!messageId) throw new Error('missing_message_id');

  const threadId = normalizeText(body.threadId || '', 512);
  const customer = parseEmailAddress(body.from || '');
  const bodyText = String(body.body_text || body.text || '').trim() || '';
  const bodyHtml = String(body.body_html || body.html || '').trim() || '';
  const receivedAt = parseDateValue(body.date || body.received || '');
  const channelMeta = {
    threadId: threadId || null,
    snippet: body.snippet || null,
    from: body.from || null,
    to: body.to || null,
    attachments: sanitizeAttachments(body.attachments),
    extra: body.extra || null,
  };
  const queue = normalizeText(body.queue || body.destination || 'Support produit', 128) || 'Support produit';
  const priority = normalizeText(body.priority || 'normal', 32) || 'normal';
  const channelSource = normalizeText(body.source || 'email', 64) || 'email';
  const subject = String(body.subject || '').trim();

  const insertTicket = await pool.query(
    `
      INSERT INTO mod_tools_tickets
        (org_id, email_message_id, thread_id, subject, customer_name, customer_email, status, queue, priority, type, source, body_text, body_html, channel_meta, received_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,'NEW',$7,$8,'EMAIL',$9,$10,$11,$12,$13)
      RETURNING *
    `,
    [
      resolvedOrgId,
      messageId,
      threadId || null,
      subject || null,
      customer.name || null,
      customer.email || null,
      queue,
      priority,
      channelSource,
      bodyText || null,
      bodyHtml || null,
      channelMeta,
      receivedAt,
    ]
  );

  const ticketRow = insertTicket.rows?.[0];
  if (!ticketRow) throw new Error('ticket_insert_failed');

  const insertMessage = await pool.query(
    `
      INSERT INTO mod_tools_ticket_messages
        (ticket_id, org_id, sender, body_text, body_html, channel_meta, received_at)
      VALUES
        ($1,$2,'customer',$3,$4,$5,$6)
      RETURNING *
    `,
    [
      ticketRow.id,
      resolvedOrgId,
      bodyText || null,
      bodyHtml || null,
      channelMeta,
      receivedAt,
    ]
  );
  const messageRow = insertMessage.rows?.[0];

  const logPayload = {
    ticket_id: ticketRow.id,
    message_id: messageId,
    org_id: resolvedOrgId,
    queue,
    priority,
    source: channelSource,
  };
  try {
    if (typeof chatLog === 'function') chatLog('tools_ticket_email_created', logPayload);
  } catch {}

  return {
    ticket: ticketRow,
    message: messageRow,
  };
}
