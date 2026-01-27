import fs from 'node:fs';
import nodePath from 'node:path';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

function simpleCsvParse(text) {
  try {
    const lines = String(text || '').split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(',').map(s => s.trim());
    return lines.slice(1).map(line => {
      const cols = line.split(',');
      const obj = {};
      header.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
      return obj;
    });
  } catch { return []; }
}

export function registerBomItemsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;
  const chatLog = utils.chatLog || (()=>{});

  function resolveModuleDir() {
    try { return nodePath.resolve(nodePath.dirname(new URL(import.meta.url).pathname), '..', '..'); }
    catch { return process.cwd(); }
  }
  function getImagesDir() {
    try {
      const base = resolveModuleDir();
      // Folder relative to the module root (do not hardcode absolute paths)
      return nodePath.resolve(base, 'ITEM_Images');
    } catch { return nodePath.resolve(process.cwd(), 'ITEM_Images'); }
  }
  function fileExists(p) { try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; } }
  function escapeRegExp(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function tryFindImageByCode(code) {
    const dir = getImagesDir();
    const base = String(code || '').trim();
    if (!base) return null;
    // Check common exact names first
    const candidates = [
      nodePath.join(dir, `${base}.jpg`),
      nodePath.join(dir, `${base}.jpeg`),
      nodePath.join(dir, `${base}.png`),
      nodePath.join(dir, `${base}.gif`)
    ];
    for (const p of candidates) { if (fileExists(p)) return p; }
    // Pattern: IT-XXXXXX.Picture.XXXX.jpg (user's provided format)
    try {
      const re = new RegExp(`^${escapeRegExp(base)}\\.Picture\\..+\\.(jpg|jpeg|png|gif)$`, 'i');
      const files = fs.readdirSync(dir);
      const match = files.find(f => re.test(f)) || files.find(f => f.toLowerCase().startsWith(base.toLowerCase()) && /\.(jpg|jpeg|png|gif)$/i.test(f));
      if (match) {
        const p = nodePath.join(dir, match);
        if (fileExists(p)) return p;
      }
    } catch {}
    return null;
  }
  function guessMime(p) {
    const ext = nodePath.extname(String(p || '')).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    return 'application/octet-stream';
  }

  // Extract items from provided data (CSV or JSON array)
  app.post('/api/bom/extract/items', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const mode = String(body.mode || body.format || '').toLowerCase();
      const text = body.text != null ? String(body.text) : '';
      let items = [];
      if (Array.isArray(body.items)) items = body.items;
      else if (mode === 'csv') items = simpleCsvParse(text);
      else if (text) { try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) items = parsed; } catch {} }
      chatLog('extract_items', { count: items.length });
      return res.json({ ok:true, items });
    } catch (e) { return res.status(400).json({ ok:false, error:'extract_failed', message: e?.message || String(e) }); }
  });

  async function getOrCreateSupplierIdByName(name, orgId) {
    try {
      const vendorName = String(name || '').trim();
      if (!vendorName || !pool) return null;
      const selArgs = [vendorName];
      let where = 'name=$1';
      if (orgId) { selArgs.push(orgId); where += ` AND (org_id IS NULL OR org_id = $2)`; }
      const r = await pool.query(`SELECT id FROM mod_bom_suppliers WHERE ${where} LIMIT 1`, selArgs);
      if (r.rowCount) return r.rows[0].id;
      const ins = await pool.query(`INSERT INTO mod_bom_suppliers(org_id, name, created_at, updated_at) VALUES($1,$2,NOW(),NOW()) RETURNING id`, [orgId ?? null, vendorName]);
      return ins.rows[0]?.id || null;
    } catch { return null; }
  }

  // List items
  app.get('/api/bom/items', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const orgId = pickOrgId(req);
      const q = String(req.query?.q || req.query?.search || '').trim();
      const limit = Math.max(0, Math.min(200, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const supplierFilter = req.query?.supplier_id ? Number(req.query.supplier_id) : null;
      const procurementFilter = (req.query?.procurement_type ?? req.query?.procurement) ? String(req.query?.procurement_type ?? req.query?.procurement) : null;
      const hasPictureFilter = (req.query?.has_picture ?? req.query?.hasImage ?? '').toString().trim(); // '1' | '0' | ''
      // Column-specific filters
      const skuFilter = String(req.query?.sku || '').trim();
      const nameFilter = String(req.query?.name || '').trim();
      const descriptionShortFilter = String(req.query?.description_short || '').trim();
      const descriptionFilter = String(req.query?.description || '').trim();
      const unitFilter = String(req.query?.unit || '').trim();
      const supplierNameFilter = String(req.query?.supplier || req.query?.supplier_name || '').trim();

      const sortRaw = String(req.query?.sort || 'name').toLowerCase();
      const dirRaw = String(req.query?.dir || req.query?.order || 'asc').toLowerCase();
      const ALLOWED_SORTS = { name:'i.name', code:'i.code', sku:'i.sku', unit:'i.unit', supplier:'s.name', created_at:'i.created_at', updated_at:'i.updated_at' };
      const sortCol = ALLOWED_SORTS[sortRaw] || ALLOWED_SORTS.name;
      const sortDir = dirRaw === 'desc' ? 'DESC' : 'ASC';
      const includePrice = String(req.query?.with_price || '').toLowerCase() === '1';
      const args = [];
      let where = 'WHERE 1=1';
      let orgIdArgIndex = null;
      if (orgId) { args.push(orgId); orgIdArgIndex = args.length; where += ` AND (i.org_id IS NULL OR i.org_id = $${orgIdArgIndex})`; }
      if (q) { args.push(`%${q}%`); where += ` AND (i.sku ILIKE $${args.length} OR i.name ILIKE $${args.length} OR i.code ILIKE $${args.length} OR i.reference ILIKE $${args.length} OR i.description ILIKE $${args.length} OR i.description_short ILIKE $${args.length})`; }
      if (skuFilter) { args.push(`%${skuFilter}%`); where += ` AND (i.sku ILIKE $${args.length} OR i.code ILIKE $${args.length})`; }
      if (nameFilter) { args.push(`%${nameFilter}%`); where += ` AND i.name ILIKE $${args.length}`; }
      if (descriptionShortFilter) { args.push(`%${descriptionShortFilter}%`); where += ` AND COALESCE(i.description_short,'') ILIKE $${args.length}`; }
      if (descriptionFilter) { args.push(`%${descriptionFilter}%`); where += ` AND COALESCE(i.description,'') ILIKE $${args.length}`; }
      if (unitFilter) { args.push(`%${unitFilter}%`); where += ` AND COALESCE(i.unit,i.uom,'') ILIKE $${args.length}`; }
      let supplierArgIndex = null;
      if (supplierFilter) {
        args.push(supplierFilter);
        supplierArgIndex = args.length;
        // Match either direct item.supplier_id or via the item-vendors link table
        if (orgIdArgIndex) {
          where += ` AND (i.supplier_id = $${supplierArgIndex} OR EXISTS (SELECT 1 FROM mod_bom_item_vendors v WHERE v.item_id = i.id AND v.supplier_id = $${supplierArgIndex} AND (v.org_id IS NULL OR v.org_id = $${orgIdArgIndex})))`;
        } else {
          where += ` AND (i.supplier_id = $${supplierArgIndex} OR EXISTS (SELECT 1 FROM mod_bom_item_vendors v WHERE v.item_id = i.id AND v.supplier_id = $${supplierArgIndex}))`;
        }
      }
      if (procurementFilter) { args.push(procurementFilter); where += ` AND i.procurement_type = $${args.length}`; }
      if (supplierNameFilter) { args.push(`%${supplierNameFilter}%`); where += ` AND COALESCE(s.name,'') ILIKE $${args.length}`; }
      args.push(limit); args.push(offset);
      const priceCols = (includePrice && supplierArgIndex) ? ', price.price AS vendor_price, price.currency AS vendor_price_currency' : '';
      const priceJoin = (includePrice && supplierArgIndex)
        ? `LEFT JOIN LATERAL (
             SELECT p.price, p.currency, p.effective_at
               FROM mod_bom_item_vendor_prices p
              WHERE p.item_id = i.id
                AND (p.supplier_id = $${supplierArgIndex} OR p.supplier_id IS NULL)
                ${orgIdArgIndex ? `AND (p.org_id IS NULL OR p.org_id = $${orgIdArgIndex})` : ''}
              ORDER BY p.effective_at DESC NULLS LAST, p.id DESC
              LIMIT 1
           ) price ON TRUE`
        : '';
      const r = await pool.query(`SELECT i.id, i.org_id, i.supplier_id, i.sku, i.name, i.uom, i.attributes,
                                         i.code, i.reference, i.description, i.description_short, i.picture, i.unit, i.procurement_type,
                                         i.created_at, i.updated_at, s.name AS supplier_name${priceCols}
                                     FROM mod_bom_items i
                                     LEFT JOIN mod_bom_suppliers s ON s.id = i.supplier_id
                                     ${priceJoin}
                                    ${where}
                                     ORDER BY ${sortCol} ${sortDir}
                                     LIMIT $${args.length-1} OFFSET $${args.length}`, args);
      // Attach a computed image flag/path hint (client uses the dedicated picture endpoint)
      const itemsRaw = (r.rows || []).map(row => {
        try {
          const code = row.code || row.sku;
          const img = tryFindImageByCode(code);
          return { ...row, has_picture: Boolean(img), picture_hint: img ? true : false };
        } catch { return row; }
      });
      let items = itemsRaw;
      if (hasPictureFilter === '1') items = itemsRaw.filter(x => x.has_picture);
      else if (hasPictureFilter === '0') items = itemsRaw.filter(x => !x.has_picture);
      return res.json({ ok:true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Create item
  app.post('/api/bom/items', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const code = String(body.code || body.item_code || '').trim();
      const sku = String(body.sku || code).trim();
      const name = String(body.name || body.reference || body.description_short || body.description || sku).trim();
      if (!sku || !name) return res.status(400).json({ ok:false, error:'missing_fields' });
      let supplierId = body.supplier_id ? Number(body.supplier_id) : null;
      if (!supplierId) {
        const vendorName = body.vendor || body.VENDORS || body.supplier_name || body.supplier;
        if (vendorName) supplierId = await getOrCreateSupplierIdByName(vendorName, orgId);
      }
      const uom = String(body.uom || body.unit || 'pcs');
      const attributes = (body.attributes && typeof body.attributes === 'object') ? body.attributes : {};
      const reference = body.reference != null ? String(body.reference) : null;
      const description = body.description != null ? String(body.description) : null;
      const description_short = body.description_short != null ? String(body.description_short) : null;
      const picture = body.picture != null ? String(body.picture) : null;
      const unit = body.unit != null ? String(body.unit) : null;
      const procurement_type = body.procurement_type != null ? String(body.procurement_type) : null;
      const r = await pool.query(`INSERT INTO mod_bom_items(org_id, supplier_id, sku, name, uom, attributes, code, reference, description, description_short, picture, unit, procurement_type, created_at, updated_at)
                                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()) RETURNING id`,
                                  [orgId ?? null, supplierId, sku, name, uom, attributes, code || null, reference, description, description_short, picture, unit, procurement_type]);
      chatLog('item_create', { id: r.rows[0]?.id || null, sku, org_id: orgId ?? null });
      return res.json({ ok:true, id: r.rows[0]?.id || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'create_failed', message: e?.message || String(e) }); }
  });

  // Update item
  app.put('/api/bom/items/:id', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'invalid_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const fields = [];
      const args = [];
      if (body.supplier_id !== undefined) { args.push(body.supplier_id == null ? null : Number(body.supplier_id)); fields.push(`supplier_id=$${args.length}`); }
      if (body.sku != null) { args.push(String(body.sku)); fields.push(`sku=$${args.length}`); }
      if (body.name != null) { args.push(String(body.name)); fields.push(`name=$${args.length}`); }
      if (body.uom != null) { args.push(String(body.uom)); fields.push(`uom=$${args.length}`); }
      if (body.attributes && typeof body.attributes === 'object') { args.push(body.attributes); fields.push(`attributes=$${args.length}`); }
      if (body.code !== undefined) { args.push(body.code == null ? null : String(body.code)); fields.push(`code=$${args.length}`); }
      if (body.reference !== undefined) { args.push(body.reference == null ? null : String(body.reference)); fields.push(`reference=$${args.length}`); }
      if (body.description !== undefined) { args.push(body.description == null ? null : String(body.description)); fields.push(`description=$${args.length}`); }
      if (body.description_short !== undefined) { args.push(body.description_short == null ? null : String(body.description_short)); fields.push(`description_short=$${args.length}`); }
      if (body.picture !== undefined) { args.push(body.picture == null ? null : String(body.picture)); fields.push(`picture=$${args.length}`); }
      if (body.unit !== undefined) { args.push(body.unit == null ? null : String(body.unit)); fields.push(`unit=$${args.length}`); }
      if (body.procurement_type !== undefined) { args.push(body.procurement_type == null ? null : String(body.procurement_type)); fields.push(`procurement_type=$${args.length}`); }
      
      if (!fields.length) return res.status(400).json({ ok:false, error:'no_fields' });
      args.push(id);
      let where = `id=$${args.length}`;
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      const r = await pool.query(`UPDATE mod_bom_items SET ${fields.join(', ')}, updated_at=NOW() WHERE ${where}`, args);
      return res.json({ ok:true, updated: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'update_failed', message: e?.message || String(e) }); }
  });

  // Bulk import items (CSV/TSV/JSON)
  app.post('/api/bom/items/import', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const mode = String(body.mode || body.format || '').toLowerCase();
      const text = body.text != null ? String(body.text) : '';
      let rows = [];
      if (Array.isArray(body.rows)) rows = body.rows;
      else if (text) {
        const delim = mode === 'csv' ? ',' : (mode === 'tsv' ? '\t' : (text.includes('\t') ? '\t' : ','));
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length) {
          const header = lines[0].split(delim).map(h => h.trim());
          rows = lines.slice(1).map(line => {
            const cols = line.split(delim);
            const obj = {}; header.forEach((h,i)=> obj[h] = (cols[i] || '').trim());
            return obj;
          });
        }
      }
      let created = 0, updated = 0, linked = 0;
      for (const r of rows) {
        const code = String(r['item_code'] || r['code'] || r['SKU'] || '').trim();
        const reference = String(r['Reference'] || r['reference'] || '').trim();
        const name = reference || String(r['name'] || r['Description'] || r['description'] || code).trim();
        const description = String(r['Description'] || r['description'] || '').trim() || null;
        const description_short = String(r['description_short'] || '').trim() || null;
        const picture = String(r['Picture'] || r['picture'] || '').trim() || null;
        const unit = String(r['Unit'] || r['unit'] || '').trim() || null;
        const procurement_type = String(r['Procurement_type'] || r['procurement_type'] || '').trim() || null;
        const uom = unit || 'pcs';
        const vendorName = String(r['VENDORS'] || r['vendor'] || r['supplier'] || '').trim();
        if (!code && !reference && !name) continue;

        let id = null;
        // Upsert by sku (=code) when available, otherwise by (name)
        if (code) {
          const sel = await pool.query(`SELECT id FROM mod_bom_items WHERE sku=$1 ${orgId ? 'AND (org_id IS NULL OR org_id = $2)' : ''} LIMIT 1`, orgId ? [code, orgId] : [code]);
          if (sel.rowCount) id = sel.rows[0].id;
        }
        if (!id && name) {
          const sel2 = await pool.query(`SELECT id FROM mod_bom_items WHERE name=$1 ${orgId ? 'AND (org_id IS NULL OR org_id = $2)' : ''} LIMIT 1`, orgId ? [name, orgId] : [name]);
          if (sel2.rowCount) id = sel2.rows[0].id;
        }
        if (!id && reference) {
          const sel3 = await pool.query(`SELECT id FROM mod_bom_items WHERE reference=$1 ${orgId ? 'AND (org_id IS NULL OR org_id = $2)' : ''} LIMIT 1`, orgId ? [reference, orgId] : [reference]);
          if (sel3.rowCount) id = sel3.rows[0].id;
        }

        // Optional supplier link
        let supplierId = null;
        if (vendorName) supplierId = await getOrCreateSupplierIdByName(vendorName, orgId);

        if (id) {
          const args = [];
          const sets = [];
          const set = (col,val) => { args.push(val); sets.push(`${col}=$${args.length}`); };
          if (code) set('sku', code);
          if (name) set('name', name);
          if (uom) set('uom', uom);
          if (reference != null) set('reference', reference);
          if (description != null) set('description', description);
          if (description_short != null) set('description_short', description_short);
          if (picture != null) set('picture', picture);
          if (unit != null) set('unit', unit);
          if (procurement_type != null) set('procurement_type', procurement_type);
          
          if (supplierId != null) { set('supplier_id', supplierId); linked++; }
          args.push(id);
          await pool.query(`UPDATE mod_bom_items SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${args.length}`, args);
          updated++;
        } else {
          await pool.query(`INSERT INTO mod_bom_items(org_id, supplier_id, sku, name, uom, code, reference, description, description_short, picture, unit, procurement_type, attributes, created_at, updated_at)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'{}',NOW(),NOW())`,
                            [orgId ?? null, supplierId, code || name, name, uom, code || null, reference || null, description, description_short, picture, unit, procurement_type]);
          created++;
        }
      }
      chatLog('items_import', { created, updated, linked });
      return res.json({ ok:true, created, updated, linked });
    } catch (e) { return res.status(400).json({ ok:false, error:'import_failed', message: e?.message || String(e) }); }
  });

  // Map existing items to suppliers via (item_code, vendor) TSV/CSV/JSON
  app.post('/api/bom/items/map-suppliers', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const mode = String(body.mode || body.format || '').toLowerCase();
      const text = body.text != null ? String(body.text) : '';
      let rows = [];
      if (Array.isArray(body.rows)) rows = body.rows;
      else if (text) {
        const delim = mode === 'csv' ? ',' : (mode === 'tsv' ? '\t' : (text.includes('\t') ? '\t' : ','));
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length) {
          const header = lines[0].split(delim).map(h => h.trim());
          rows = lines.slice(1).map(line => {
            const cols = line.split(delim);
            const obj = {}; header.forEach((h,i)=> obj[h] = (cols[i] || '').trim());
            return obj;
          });
        }
      }
      let linked = 0, missing = 0, updated = 0;
      for (const r of rows) {
        const code = String(r['item_code'] || r['code'] || '').trim();
        const vendorName = String(r['VENDORS'] || r['vendor'] || r['supplier'] || '').trim();
        if (!code || !vendorName) { missing++; continue; }
        const sel = await pool.query(`SELECT id FROM mod_bom_items WHERE sku=$1 ${orgId ? 'AND (org_id IS NULL OR org_id = $2)' : ''} LIMIT 1`, orgId ? [code, orgId] : [code]);
        if (!sel.rowCount) { missing++; continue; }
        const itemId = sel.rows[0].id;
        const supplierId = await getOrCreateSupplierIdByName(vendorName, orgId);
        if (supplierId) {
          await pool.query(`UPDATE mod_bom_items SET supplier_id=$1, updated_at=NOW() WHERE id=$2`, [supplierId, itemId]);
          linked++;
        } else {
          missing++;
        }
      }
      return res.json({ ok:true, linked, updated, missing });
    } catch (e) { return res.status(400).json({ ok:false, error:'map_failed', message: e?.message || String(e) }); }
  });

  // Delete item
  app.delete('/api/bom/items/:id', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [id];
      let where = 'id=$1';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $2)`; }
      const r = await pool.query(`DELETE FROM mod_bom_items WHERE ${where}`, args);
      return res.json({ ok:true, deleted: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // Serve item picture from module-local ITEM_Images folder by code/SKU pattern
  app.get('/api/bom/items/:id/picture', async (req, res) => {
    try {
      if (!pool) return res.status(503).end();
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).end();
      const r = await pool.query(`SELECT code, sku, picture FROM mod_bom_items WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).end();
      const rec = r.rows[0] || {};
      const code = rec.code || rec.sku;
      const debug = String(req.query?.debug || '').toLowerCase() === '1' || String(req.query?.debug || '').toLowerCase() === 'true';
      const debugInfo = { id, code, picture: rec.picture || null, moduleDir: resolveModuleDir(), imagesDir: getImagesDir(), candidates: [] };
      // If DB already holds a web URL, redirect to it
      if (rec.picture && /^(https?:)?\/\//i.test(rec.picture)) {
        if (debug) return res.json({ ok:true, mode:'redirect', url: rec.picture });
        return res.redirect(302, rec.picture);
      }
      // If DB holds a relative file, attempt to serve it
      if (rec.picture && typeof rec.picture === 'string' && !rec.picture.includes('://')) {
        const rel = rec.picture.startsWith('/') ? rec.picture.slice(1) : rec.picture;
        const candidates = [];
        if (nodePath.isAbsolute(rel)) candidates.push(rel);
        else {
          // If value already includes 'ITEM_Images/...', treat it as relative to module root
          candidates.push(nodePath.join(resolveModuleDir(), rel));
          // Also try relative to the images dir (for bare filenames)
          candidates.push(nodePath.join(getImagesDir(), rel));
          // If prefixed with ITEM_Images/, also try joining only the tail with images dir
          if (rel.toLowerCase().startsWith('item_images/')) {
            candidates.push(nodePath.join(getImagesDir(), rel.substring('item_images/'.length)));
          }
        }
        for (const abs of candidates) {
          if (debug) debugInfo.candidates.push({ path: abs, exists: fileExists(abs) });
          if (fileExists(abs)) {
            if (debug) return res.json({ ok:true, mode:'file', path: abs });
            res.setHeader('Content-Type', guessMime(abs));
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(abs);
          }
        }
      }
      // Probe ITEM_Images by naming conventions
      const found = tryFindImageByCode(code);
      if (found) {
        if (debug) return res.json({ ok:true, mode:'auto', path: found });
        res.setHeader('Content-Type', guessMime(found));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(found);
      }
      if (debug) return res.status(404).json({ ok:false, error:'not_found', ...debugInfo });
      return res.status(404).end();
    } catch (e) {
      try { chatLog('item_picture_error', { id: req.params?.id, error: e?.message || String(e) }); } catch {}
      return res.status(404).end();
    }
  });
}
