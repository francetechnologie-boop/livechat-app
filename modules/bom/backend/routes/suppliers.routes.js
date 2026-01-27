function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

export function registerBomSuppliersRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;
  const chatLog = utils.chatLog || ((e)=>e);

  // List suppliers
  app.get('/api/bom/suppliers', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const orgId = pickOrgId(req);
      const q = String(req.query?.q || req.query?.search || '').trim();
      const limit = Math.max(0, Math.min(200, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const args = [];
      let where = 'WHERE 1=1';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      if (q) { args.push(`%${q}%`); where += ` AND (name ILIKE $${args.length} OR COALESCE(contact,'') ILIKE $${args.length})`; }
      args.push(limit); args.push(offset);
      const r = await pool.query(`SELECT id, org_id, name, contact, meta,
                                         street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code,
                                         created_at, updated_at
                                    FROM mod_bom_suppliers ${where}
                                   ORDER BY name ASC
                                   LIMIT $${args.length-1} OFFSET $${args.length}`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Create supplier
  app.post('/api/bom/suppliers', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const orgId = req.body?.org_id ?? pickOrgId(req);
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ ok:false, error:'name_required' });
      const contact = req.body?.contact != null ? String(req.body.contact) : null;
      const meta = (req.body?.meta && typeof req.body.meta === 'object') ? req.body.meta : {};
      const street = req.body?.street_address != null ? String(req.body.street_address) : null;
      const city = req.body?.city != null ? String(req.body.city) : null;
      const country = req.body?.country != null ? String(req.body.country) : null;
      const zip = req.body?.zip != null ? String(req.body.zip) : null;
      const phone = req.body?.phone != null ? String(req.body.phone) : null;
      const email = req.body?.email != null ? String(req.body.email) : null;
      const taxRate = req.body?.tax_rate != null ? Number(req.body.tax_rate) : null;
      const currency = req.body?.currency != null ? String(req.body.currency) : null;
      const vendorCode = req.body?.vendor_code != null ? String(req.body.vendor_code) : null;
      const r = await pool.query(
        `INSERT INTO mod_bom_suppliers(org_id, name, contact, meta, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()) RETURNING id`,
        [orgId ?? null, name, contact, meta, street, city, country, zip, phone, email, taxRate, currency, vendorCode]
      );
      chatLog('supplier_create', { id: r.rows[0]?.id || null, name, org_id: orgId ?? null });
      const supplierId = r.rows[0]?.id || null;
      // Optional: create contacts array
      try {
        const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
        for (const c of contacts) {
          const cname = c?.name != null ? String(c.name) : null;
          const cemail = c?.email != null ? String(c.email) : null;
          const cphone = c?.phone != null ? String(c.phone) : null;
          const crole = c?.role != null ? String(c.role) : null;
          const cprimary = !!c?.is_primary;
          const cmeta = (c?.meta && typeof c.meta === 'object') ? c.meta : {};
          if (supplierId) {
            await pool.query(`INSERT INTO mod_bom_supplier_contacts(org_id, supplier_id, name, email, phone, role, is_primary, meta)
                              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                              [orgId ?? null, supplierId, cname, cemail, cphone, crole, cprimary, cmeta]);
          }
        }
      } catch {}
      return res.json({ ok:true, id: supplierId });
    } catch (e) { return res.status(500).json({ ok:false, error:'create_failed', message: e?.message || String(e) }); }
  });

  // Update supplier
  app.put('/api/bom/suppliers/:id', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = req.body?.org_id ?? pickOrgId(req);
      const fields = [];
      const args = [];
      if (req.body?.name != null) { args.push(String(req.body.name)); fields.push(`name=$${args.length}`); }
      if (req.body?.contact !== undefined) { args.push(req.body.contact == null ? null : String(req.body.contact)); fields.push(`contact=$${args.length}`); }
      if (req.body?.meta && typeof req.body.meta === 'object') { args.push(req.body.meta); fields.push(`meta=$${args.length}`); }
      if (req.body?.street_address !== undefined) { args.push(req.body.street_address == null ? null : String(req.body.street_address)); fields.push(`street_address=$${args.length}`); }
      if (req.body?.city !== undefined) { args.push(req.body.city == null ? null : String(req.body.city)); fields.push(`city=$${args.length}`); }
      if (req.body?.country !== undefined) { args.push(req.body.country == null ? null : String(req.body.country)); fields.push(`country=$${args.length}`); }
      if (req.body?.zip !== undefined) { args.push(req.body.zip == null ? null : String(req.body.zip)); fields.push(`zip=$${args.length}`); }
      if (req.body?.phone !== undefined) { args.push(req.body.phone == null ? null : String(req.body.phone)); fields.push(`phone=$${args.length}`); }
      if (req.body?.email !== undefined) { args.push(req.body.email == null ? null : String(req.body.email)); fields.push(`email=$${args.length}`); }
      if (req.body?.tax_rate !== undefined) { args.push(req.body.tax_rate == null ? null : Number(req.body.tax_rate)); fields.push(`tax_rate=$${args.length}`); }
      if (req.body?.currency !== undefined) { args.push(req.body.currency == null ? null : String(req.body.currency)); fields.push(`currency=$${args.length}`); }
      if (req.body?.vendor_code !== undefined) { args.push(req.body.vendor_code == null ? null : String(req.body.vendor_code)); fields.push(`vendor_code=$${args.length}`); }
      if (!fields.length) return res.status(400).json({ ok:false, error:'no_fields' });
      args.push(id);
      let where = `id=$${args.length}`;
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      const r = await pool.query(`UPDATE mod_bom_suppliers SET ${fields.join(', ')}, updated_at=NOW() WHERE ${where}`, args);
      return res.json({ ok:true, updated: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'update_failed', message: e?.message || String(e) }); }
  });

  // Delete supplier
  app.delete('/api/bom/suppliers/:id', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [id];
      let where = 'id=$1';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $2)`; }
      const r = await pool.query(`DELETE FROM mod_bom_suppliers WHERE ${where}`, args);
      return res.json({ ok:true, deleted: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // Import suppliers (CSV/TSV/JSON)
  app.post('/api/bom/suppliers/import', async (req, res) => {
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
          const header = lines[0].split(new RegExp(delim)).map(h => h.trim());
          rows = lines.slice(1).map(line => {
            const cols = line.split(new RegExp(delim));
            const obj = {}; header.forEach((h,i)=> obj[h] = (cols[i] || '').trim());
            return obj;
          });
        }
      }
      let created = 0, updated = 0, contacts = 0;
      for (const r of rows) {
        // Map input columns (flexible headers)
        const name = String(r['COMPANY NAME'] || r['company'] || r['name'] || '').trim();
        if (!name) continue;
        const contactName = String(r['NAME'] || r['CONTACT NAME'] || r['contact_name'] || '').trim() || null;
        const street = String(r['STREET ADDRESS'] || r['street'] || '').trim() || null;
        const city = String(r['CITY'] || '').trim() || null;
        const country = String(r['COUNTRY'] || '').trim() || null;
        const zip = String(r['ZIP'] || r['POSTCODE'] || '').trim() || null;
        const phone = String(r['PHONE NUMBER'] || r['PHONE'] || '').trim() || null;
        const email = String(r['EMAIL'] || '').trim() || null;
        const taxRateRaw = String(r['TAX RATE'] || '').trim();
        const taxRate = taxRateRaw.endsWith('%') ? Number(taxRateRaw.replace('%','')) : (taxRateRaw ? Number(taxRateRaw) : null);
        const currency = String(r['CURRENCY'] || '').trim() || null;
        const vendorCode = String(r['id_vendor'] || r['VENDOR'] || '').trim() || null;

        // Upsert by name within org
        let supplierId = null;
        const argsSel = [name];
        let where = 'name = $1';
        if (orgId) { argsSel.push(orgId); where += ` AND (org_id IS NULL OR org_id = $2)`; }
        const existing = await pool.query(`SELECT id FROM mod_bom_suppliers WHERE ${where} LIMIT 1`, argsSel);
        if (existing.rowCount) {
          supplierId = existing.rows[0].id;
          // Optional: update details if provided
          const updFields = [];
          const updArgs = [];
          const setField = (col, val) => { updArgs.push(val); updFields.push(`${col}=$${updArgs.length}`); };
          if (street !== null) setField('street_address', street);
          if (city !== null) setField('city', city);
          if (country !== null) setField('country', country);
          if (zip !== null) setField('zip', zip);
          if (phone !== null) setField('phone', phone);
          if (email !== null) setField('email', email);
          if (taxRate !== null) setField('tax_rate', taxRate);
          if (currency !== null) setField('currency', currency);
          if (vendorCode !== null) setField('vendor_code', vendorCode);
          if (updFields.length) {
            updArgs.push(supplierId);
            await pool.query(`UPDATE mod_bom_suppliers SET ${updFields.join(', ')}, updated_at=NOW() WHERE id=$${updArgs.length}`, updArgs);
          }
          updated++;
        } else {
          const ins = await pool.query(`INSERT INTO mod_bom_suppliers(org_id, name, contact, meta, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, created_at, updated_at)
                                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()) RETURNING id`,
                                        [orgId ?? null, name, contactName, {}, street, city, country, zip, phone, email, taxRate, currency, vendorCode]);
          supplierId = ins.rows[0].id; created++;
        }
        // Insert a contact if we have email/phone/name
        if (supplierId && (email || phone || contactName)) {
          await pool.query(`INSERT INTO mod_bom_supplier_contacts(org_id, supplier_id, name, email, phone, role, is_primary)
                            VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                            [orgId ?? null, supplierId, contactName, email, phone, null, true]);
          contacts++;
        }
      }
      return res.json({ ok:true, created, updated, contacts });
    } catch (e) { return res.status(400).json({ ok:false, error:'import_failed', message: e?.message || String(e) }); }
  });
}
