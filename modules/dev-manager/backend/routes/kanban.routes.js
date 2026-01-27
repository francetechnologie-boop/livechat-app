// Dev Manager Kanban routes: persist boards/cards and file metadata in module tables
// Tables created by migrations:
// - mod_dev_manager_kanban_boards, _columns, _cards, _attachments, and mod_dev_manager_files

import fs from 'fs';
import path from 'path';

export function registerDevManagerKanbanRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  // Open access (no auth) as requested: allow anyone to read/write Kanban
  // If you need to restrict later, swap this for ctx.requireAuth or a custom guard.
  const requireUser = (_req, _res) => ({ role: 'any' });
  const base = '/api/dev-manager';
  const uploadDir = (() => {
    try {
      const p = path.join(ctx.backendDir || process.cwd(), 'uploads', 'dev-manager');
      fs.mkdirSync(p, { recursive: true });
      return p;
    } catch {
      return path.join(process.cwd(), 'uploads', 'dev-manager');
    }
  })();
  const MAX_UPLOAD_BYTES = (() => {
    const mb = Number(process.env.API_MAX_UPLOAD_MB || 25);
    return Math.max(1, mb) * 1024 * 1024;
  })();
  const SAFE_MODE = (process.env.DEV_MANAGER_SAFE_MODE || '1') !== '0';

  async function pickOrgId(hint) {
    try {
      if (hint != null && String(hint).trim() !== '') {
        const id = Number(hint);
        if (Number.isFinite(id)) return id;
      }
    } catch {}
    // best-effort: choose first organization if it exists
    try {
      const r = await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
      if (r.rowCount) return r.rows[0].id;
    } catch {}
    return null;
  }

  async function getBoardId(orgId, projectId) {
    const r = await pool.query(
      `SELECT id FROM mod_dev_manager_kanban_boards
       WHERE project_id = $1
         AND (org_id IS NOT DISTINCT FROM $2::text)
       LIMIT 1`,
      [projectId, orgId]
    );
    return r.rowCount ? r.rows[0].id : null;
  }

  // Helper: run a transactional block when pool.connect() is available;
  // otherwise fall back to non-transactional sequential queries via pool.query.
  async function runTx(fn) {
    try {
      if (pool && typeof pool.connect === 'function') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(client);
          await client.query('COMMIT');
          return out;
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
          throw e;
        } finally {
          try { client.release(); } catch {}
        }
      }
    } catch {}
    // Fallback: no transaction (best-effort) using pool.query
    const shim = { query: (...args) => pool.query(...args) };
    return await fn(shim);
  }

  // GET board (columns + cards + attachments)
  app.get(base + '/kanban', async (req, res) => {
    const u = requireUser(req, res); if (!u) return;
    try {
      const project = String(req.query.project || '').trim() || 'default';
      const orgId = await pickOrgId(req.query.org_id);
      let boardId = await getBoardId(orgId, project);

      if (!boardId) {
        // Empty default
        return res.json({ ok: true, board: { columns: [
          { id: 'todo', title: 'À faire', order: 0 },
          { id: 'doing', title: 'En cours', order: 1 },
          { id: 'done', title: 'Fait', order: 2 },
        ], cards: [], updatedAt: Date.now(), project } });
      }

      const colsR = await pool.query(
        `SELECT col_key AS id, title, order_index AS order
         FROM mod_dev_manager_kanban_columns WHERE board_id=$1 ORDER BY order_index ASC`,
        [boardId]
      );
      const cardsR = await pool.query(
        `SELECT c.id, c.original_id, c.title, c.description, c.board_id, c.column_id,
                col.col_key AS column_key
         FROM mod_dev_manager_kanban_cards c
         LEFT JOIN mod_dev_manager_kanban_columns col ON col.id = c.column_id
         WHERE c.board_id=$1
         ORDER BY c.id ASC`,
        [boardId]
      );
      const cardIds = cardsR.rows.map(r => r.id);
      let attsMap = new Map();
      if (cardIds.length) {
        const attsR = await pool.query(
          `SELECT card_id, att_id AS id, type, name, url, content_type, size_bytes
           FROM mod_dev_manager_kanban_attachments WHERE card_id = ANY($1::int[])`,
          [cardIds]
        );
        for (const a of attsR.rows) {
          const list = attsMap.get(a.card_id) || [];
          const url = a.url || (base + '/kanban/file/' + encodeURIComponent(a.id));
          list.push({ id: a.id, type: a.type || 'file', name: a.name || a.id, url, contentType: a.content_type || null, sizeBytes: a.size_bytes || null });
          attsMap.set(a.card_id, list);
        }
      }
      const columns = colsR.rows;
      const cards = cardsR.rows.map(r => ({
        id: r.original_id || String(r.id),
        columnId: r.column_key || 'todo',
        title: r.title || '',
        description: r.description || '',
        attachments: attsMap.get(r.id) || [],
      }));
      return res.json({ ok: true, board: { columns, cards, updatedAt: Date.now(), project } });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // GET board export (pure JSON, optional download)
  app.get(base + '/kanban/export', async (req, res) => {
    const u = requireUser(req, res); if (!u) return;
    try {
      const project = String(req.query.project || '').trim() || 'default';
      const orgId = await pickOrgId(req.query.org_id);
      let boardId = await getBoardId(orgId, project);

      let board;
      if (!boardId) {
        board = { columns: [
          { id: 'todo', title: 'À faire', order: 0 },
          { id: 'doing', title: 'En cours', order: 1 },
          { id: 'done', title: 'Fait', order: 2 },
        ], cards: [], updatedAt: Date.now(), project };
      } else {
        const colsR = await pool.query(
          `SELECT col_key AS id, title, order_index AS order
           FROM mod_dev_manager_kanban_columns WHERE board_id=$1 ORDER BY order_index ASC`,
          [boardId]
        );
        const cardsR = await pool.query(
          `SELECT c.id, c.original_id, c.title, c.description, c.board_id, c.column_id,
                  col.col_key AS column_key
           FROM mod_dev_manager_kanban_cards c
           LEFT JOIN mod_dev_manager_kanban_columns col ON col.id = c.column_id
           WHERE c.board_id=$1
           ORDER BY c.id ASC`,
          [boardId]
        );
        const cardIds = cardsR.rows.map(r => r.id);
        let attsMap = new Map();
        if (cardIds.length) {
          const attsR = await pool.query(
            `SELECT card_id, att_id AS id, type, name, url, content_type, size_bytes
             FROM mod_dev_manager_kanban_attachments WHERE card_id = ANY($1::int[])`,
            [cardIds]
          );
          for (const a of attsR.rows) {
            const list = attsMap.get(a.card_id) || [];
            const url = a.url || (base + '/kanban/file/' + encodeURIComponent(a.id));
            list.push({ id: a.id, type: a.type || 'file', name: a.name || a.id, url, contentType: a.content_type || null, sizeBytes: a.size_bytes || null });
            attsMap.set(a.card_id, list);
          }
        }
        const columns = colsR.rows;
        const cards = cardsR.rows.map(r => ({
          id: r.original_id || String(r.id),
          columnId: r.column_key || 'todo',
          title: r.title || '',
          description: r.description || '',
          attachments: attsMap.get(r.id) || [],
        }));
        board = { columns, cards, updatedAt: Date.now(), project };
      }

      // Optional: force download
      if (String(req.query.download || '').trim() === '1') {
        const fn = `kanban-${project}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
        return res.end(JSON.stringify(board, null, 2));
      }
      return res.json({ ok: true, board });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // GET full export: board + referenced files (maps to legacy DEV_KANBAN_FILES shape)
  app.get(base + '/kanban/export/all', async (req, res) => {
    const u = requireUser(req, res); if (!u) return;
    try {
      const project = String(req.query.project || '').trim() || 'default';
      const orgId = await pickOrgId(req.query.org_id);
      let boardId = await getBoardId(orgId, project);

      // Reuse the board export handler logic by calling the route locally would be nice,
      // but we reconstruct here to keep it simple and side-effect free.
      let board;
      let attIds = new Set();
      if (!boardId) {
        board = { columns: [
          { id: 'todo', title: 'À faire', order: 0 },
          { id: 'doing', title: 'En cours', order: 1 },
          { id: 'done', title: 'Fait', order: 2 },
        ], cards: [], updatedAt: Date.now(), project };
      } else {
        const colsR = await pool.query(
          `SELECT col_key AS id, title, order_index AS order
           FROM mod_dev_manager_kanban_columns WHERE board_id=$1 ORDER BY order_index ASC`,
          [boardId]
        );
        const cardsR = await pool.query(
          `SELECT c.id, c.original_id, c.title, c.description, c.board_id, c.column_id,
                  col.col_key AS column_key
           FROM mod_dev_manager_kanban_cards c
           LEFT JOIN mod_dev_manager_kanban_columns col ON col.id = c.column_id
           WHERE c.board_id=$1
           ORDER BY c.id ASC`,
          [boardId]
        );
        const cardIds = cardsR.rows.map(r => r.id);
        let attsMap = new Map();
        if (cardIds.length) {
          const attsR = await pool.query(
            `SELECT card_id, att_id AS id, type, name, url, content_type, size_bytes
             FROM mod_dev_manager_kanban_attachments WHERE card_id = ANY($1::int[])`,
            [cardIds]
          );
          for (const a of attsR.rows) {
            const list = attsMap.get(a.card_id) || [];
            const url = a.url || (base + '/kanban/file/' + encodeURIComponent(a.id));
            list.push({ id: a.id, type: a.type || 'file', name: a.name || a.id, url, contentType: a.content_type || null, sizeBytes: a.size_bytes || null });
            attsMap.set(a.card_id, list);
            if (a.id && !String(a.id).startsWith('link_')) attIds.add(a.id);
          }
        }
        const columns = colsR.rows;
        const cards = cardsR.rows.map(r => ({
          id: r.original_id || String(r.id),
          columnId: r.column_key || 'todo',
          title: r.title || '',
          description: r.description || '',
          attachments: attsMap.get(r.id) || [],
        }));
        board = { columns, cards, updatedAt: Date.now(), project };
      }

      // Build files map only for referenced att ids (excluding link_)
      let files = {};
      if (attIds.size) {
        const ids = Array.from(attIds);
        const r = await pool.query(
          `SELECT id, file_name, file_path, content_type, size_bytes, created_at
           FROM mod_dev_manager_files WHERE id = ANY($1::text[])`,
          [ids]
        );
        for (const row of r.rows) {
          files[row.id] = {
            id: row.id,
            file_name: row.file_name,
            file_path: row.file_path,
            content_type: row.content_type,
            size_bytes: row.size_bytes,
            created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
          };
        }
      }

      // Optional: force download
      if (String(req.query.download || '').trim() === '1') {
        const fn = `kanban-export-${project}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
        return res.end(JSON.stringify({ board, files }, null, 2));
      }
      return res.json({ ok: true, board, files });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // POST board (replace board state for project)
  app.post(base + '/kanban', async (req, res) => {
    const u = requireUser(req, res); if (!u) return;
    try {
      const b = req.body || {};
      const project = String(b.project || req.query.project || '').trim() || 'default';
      const columns = Array.isArray(b.columns) ? b.columns : [];
      const cards = Array.isArray(b.cards) ? b.cards : [];
      if (!columns.length) return res.status(400).json({ ok:false, error:'invalid_board' });
      const orgId = await pickOrgId(b.org_id || req.query.org_id);
      const replaceRequested = String(b.replace || req.query.replace || '').trim() === '1';
      const destructive = replaceRequested && !SAFE_MODE; // only allow destructive replace when explicitly requested AND safe mode is off

      await runTx(async (db) => {
        // Board
        const br = await db.query(
          `INSERT INTO mod_dev_manager_kanban_boards(org_id, project_id, name)
           VALUES ($1,$2,$3)
           ON CONFLICT (org_id, project_id)
           DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()
           RETURNING id`,
          [orgId, project, 'Kanban Board']
        );
        const boardId = br.rows[0].id;

        // Insert columns
        const colMap = new Map(); // key -> id
        const postedColKeys = [];
        for (let i = 0; i < columns.length; i++) {
          const c = columns[i] || {};
          const key = String(c.id || '').trim();
          if (!key) continue;
          const title = String(c.title || key);
          const order = Number.isFinite(c.order) ? c.order : i;
          const r = await db.query(
            `INSERT INTO mod_dev_manager_kanban_columns(org_id, board_id, col_key, title, order_index)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (board_id, col_key) DO UPDATE SET title=EXCLUDED.title, order_index=EXCLUDED.order_index, updated_at=NOW()
             RETURNING id`,
            [orgId, boardId, key, title, order]
          );
          colMap.set(key, r.rows[0].id);
          postedColKeys.push(key);
        }

        // Insert cards
        const postedOriginalIds = [];
        for (const c of cards) {
          const cid = String(c.id || '').trim() || `c_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
          const colKey = String(c.columnId || '').trim();
          const colId = colMap.get(colKey) || null;
          const title = String(c.title || '').trim();
          const description = String(c.description || '');
          const cr = await db.query(
            `INSERT INTO mod_dev_manager_kanban_cards(org_id, board_id, column_id, original_id, title, description)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (board_id, original_id) DO UPDATE SET column_id=EXCLUDED.column_id, title=EXCLUDED.title, description=EXCLUDED.description, updated_at=NOW()
             RETURNING id`,
            [orgId, boardId, colId, cid, title, description]
          );
          const cardId = cr.rows[0].id;
          postedOriginalIds.push(cid);
          const atts = Array.isArray(c.attachments) ? c.attachments : [];
          for (const a of atts) {
            const attId = String(a.id || '').trim(); if (!attId) continue;
            const type = String(a.type || (String(a.contentType||'').startsWith('image/') ? 'image' : 'file'));
            const name = String(a.name || a.url || attId);
            const url = String(a.url || '').trim() || (base + '/kanban/file/' + encodeURIComponent(attId));
            const contentType = String(a.contentType || '');
            const sizeBytes = Number(a.sizeBytes || 0) || null;
            await db.query(
              `INSERT INTO mod_dev_manager_kanban_attachments(org_id, card_id, att_id, type, name, url, content_type, size_bytes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (card_id, att_id) DO UPDATE SET type=EXCLUDED.type, name=EXCLUDED.name, url=EXCLUDED.url, content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, created_at=COALESCE(mod_dev_manager_kanban_attachments.created_at, NOW())`,
              [orgId, cardId, attId, type, name, url, contentType, sizeBytes]
            );
          }
        }

        // Optional destructive cleanup only when explicitly requested and safe mode disabled
        if (destructive) {
          try {
            if (postedOriginalIds.length) {
              await db.query(
                `DELETE FROM mod_dev_manager_kanban_cards
                 WHERE board_id=$1 AND original_id <> ALL($2::text[])`,
                [boardId, postedOriginalIds]
              );
            } else {
              await db.query(`DELETE FROM mod_dev_manager_kanban_cards WHERE board_id=$1`, [boardId]);
            }
          } catch {}
          try {
            if (postedColKeys.length) {
              await db.query(
                `DELETE FROM mod_dev_manager_kanban_columns
                 WHERE board_id=$1 AND col_key <> ALL($2::text[])`,
                [boardId, postedColKeys]
              );
            } else {
              await db.query(`DELETE FROM mod_dev_manager_kanban_columns WHERE board_id=$1`, [boardId]);
            }
          } catch {}
        }
      });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // Upload attachment (binary stream)
  app.post(base + '/kanban/upload', async (req, res) => {
    const u = requireUser(req, res); if (!u) return;
    try {
      const filename = String(req.query.filename || '').trim();
      if (!filename) return res.status(400).json({ ok:false, error:'bad_request', message:'filename required' });
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const rel = id + '-' + safe;
      const full = path.join(uploadDir, rel);
      const ct = String(req.query.content_type || req.headers['content-type'] || 'application/octet-stream');
      let size = 0; let aborted = false;
      const ws = fs.createWriteStream(full);
      req.on('data', (chunk) => {
        if (aborted) return;
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) {
          aborted = true; try { ws.destroy(); } catch {}; try { req.destroy(); } catch {}; try { fs.unlinkSync(full); } catch {};
          return res.status(413).json({ ok:false, error:'too_large' });
        }
      });
      req.on('error', () => { if (aborted) return; try { ws.destroy(); } catch {}; try { fs.unlinkSync(full); } catch {}; });
      ws.on('error', () => { try { fs.unlinkSync(full); } catch {}; });
      ws.on('finish', async () => {
        try {
          const orgId = await pickOrgId(req.query.org_id);
          await pool.query(
            `INSERT INTO mod_dev_manager_files (id, org_id, file_name, file_path, content_type, size_bytes, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW())
             ON CONFLICT (id) DO UPDATE SET file_name=EXCLUDED.file_name, file_path=EXCLUDED.file_path, content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, created_at=COALESCE(mod_dev_manager_files.created_at, EXCLUDED.created_at)`,
            [id, orgId, filename, rel, ct, size]
          );
          res.json({ ok:true, id, file_name: filename, size_bytes: size, content_type: ct, url: `${base}/kanban/file/${id}` });
        } catch (e) {
          res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
        }
      });
      req.pipe(ws);
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // Upload attachment (base64 JSON fallback)
  app.post(base + '/kanban/upload/base64', async (req, res) => {
    const u = requireUser(req, res); if (!u) return;
    try {
      const body = req.body || {};
      const filename = String(body.filename || '').trim();
      const base64 = String(body.content_base64 || '').trim();
      if (!filename || !base64) return res.status(400).json({ ok:false, error:'bad_request' });
      const buf = Buffer.from(base64, 'base64');
      if (buf.length > MAX_UPLOAD_BYTES) return res.status(413).json({ ok:false, error:'too_large' });
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const rel = id + '-' + safe;
      const full = path.join(uploadDir, rel);
      fs.writeFileSync(full, buf);
      const ct = String(body.content_type || 'application/octet-stream');
      const orgId = await pickOrgId(body.org_id);
      await pool.query(
        `INSERT INTO mod_dev_manager_files (id, org_id, file_name, file_path, content_type, size_bytes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (id) DO UPDATE SET file_name=EXCLUDED.file_name, file_path=EXCLUDED.file_path, content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, created_at=COALESCE(mod_dev_manager_files.created_at, EXCLUDED.created_at)`,
        [id, orgId, filename, rel, ct, buf.length]
      );
      res.json({ ok:true, id, file_name: filename, size_bytes: buf.length, content_type: ct, url: `${base}/kanban/file/${id}` });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // Stream attachment by id
  app.get(base + '/kanban/file/:id', async (req, res) => {
    const u = requireUser(req, res); if (!u) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(404).end();
      const r = await pool.query(`SELECT file_name, file_path, content_type FROM mod_dev_manager_files WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).end();
      const row = r.rows[0];
      let full = path.join(uploadDir, row.file_path);
      if (!fs.existsSync(full)) {
        // Legacy location fallback (server.js pre-dead blocks used 'uploads/devtracker')
        const legacyDir = path.join(ctx.backendDir || process.cwd(), 'uploads', 'devtracker');
        const legacy = path.join(legacyDir, row.file_path);
        if (fs.existsSync(legacy)) full = legacy; else return res.status(404).end();
      }
      res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${row.file_name}"`);
      fs.createReadStream(full).pipe(res);
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // Delete attachment (and unlink from any cards)
  app.delete(base + '/kanban/file/:id', async (req, res) => {
    const u = requireUser(req, res); if (!u) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(404).json({ ok:false, error:'not_found' });
      const r = await pool.query(`SELECT file_path FROM mod_dev_manager_files WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      try {
        const rel = r.rows[0].file_path;
        const full = path.join(uploadDir, rel);
        if (fs.existsSync(full)) fs.unlinkSync(full);
        else {
          const legacyDir = path.join(ctx.backendDir || process.cwd(), 'uploads', 'devtracker');
          const legacy = path.join(legacyDir, rel);
          if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
        }
      } catch {}
      // Remove file record and any references in attachments
      await pool.query(`DELETE FROM mod_dev_manager_files WHERE id=$1`, [id]);
      await pool.query(`DELETE FROM mod_dev_manager_kanban_attachments WHERE att_id=$1`, [id]);
      return res.json({ ok:true });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });
}
