function formatTimestamp(ts) {
  if (!ts) return null;
  try {
    return new Date(ts).toISOString();
  } catch {
    return null;
  }
}

export function registerToolsTicketRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const logToFile = typeof ctx.logToFile === "function" ? ctx.logToFile : () => {};

  app.get("/api/tools/tickets", async (req, res) => {
    if (!pool) {
      return res.status(503).json({ ok: false, error: "db_unavailable", message: "Database connection unavailable" });
    }
    const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 25));
    const statusFilter = Array.isArray(req.query.status)
      ? req.query.status
      : String(req.query.status || "").split(",").map((v) => v.trim()).filter(Boolean);
    const params = [limit];
    let where = "";
    if (statusFilter.length) {
      const placeholders = statusFilter.map((_, idx) => `$${idx + 2}`);
      where = `WHERE status = ANY(ARRAY[${placeholders.join(",")}]::text[])`;
      params.push(...statusFilter);
    }
    try {
      const query = `
        SELECT id, org_id, subject, customer_email, queue, status, priority, created_at
          FROM mod_tools_tickets
        ${where}
        ORDER BY created_at DESC NULLS LAST
        LIMIT $1
      `;
      const { rows } = await pool.query(query, params);
      return res.json({
        ok: true,
        items: rows.map((row) => ({
          id: row.id,
          org_id: row.org_id,
          subject: row.subject,
          status: row.status,
          queue: row.queue,
          priority: row.priority,
          customer_email: row.customer_email,
          created_at: formatTimestamp(row.created_at),
        })),
      });
    } catch (error) {
      logToFile?.(`[tools] fetch tickets failed: ${error?.message || error}`);
      return res.status(500).json({ ok: false, error: "fetch_failed", message: "Unable to load tickets." });
    }
  });

  app.get("/api/tools/tickets/:id", async (req, res) => {
    if (!pool) {
      return res.status(503).json({ ok: false, error: "db_unavailable", message: "Database connection unavailable" });
    }
    const ticketId = Number(req.params.id);
    if (!Number.isFinite(ticketId)) {
      return res.status(400).json({ ok: false, error: "invalid_ticket_id", message: "Ticket id must be numeric" });
    }
    try {
      const ticketQuery = `
        SELECT id, org_id, subject, customer_email, queue, status, priority, source, type, body_text, body_html, channel_meta, created_at, received_at
          FROM mod_tools_tickets
         WHERE id = $1
         LIMIT 1
      `;
      const ticketRes = await pool.query(ticketQuery, [ticketId]);
      if (!ticketRes.rowCount) {
        return res.status(404).json({ ok: false, error: "not_found", message: "Ticket introuvable" });
      }
      const ticket = ticketRes.rows[0];
      const msgRes = await pool.query(
        `
          SELECT body_text, body_html, sender, channel_meta, created_at
            FROM mod_tools_ticket_messages
           WHERE ticket_id = $1
           ORDER BY created_at DESC NULLS LAST
           LIMIT 1
        `,
        [ticketId],
      );
      const message = msgRes.rows[0] || null;
      return res.json({
        ok: true,
        ticket: {
          ...ticket,
          channel_meta: ticket.channel_meta || {},
          last_message: message,
        },
      });
    } catch (error) {
      logToFile?.(`[tools] ticket detail fetch failed: ${error?.message || error}`);
      return res.status(500).json({ ok: false, error: "detail_failed", message: "Impossible de charger le ticket." });
    }
  });
}
