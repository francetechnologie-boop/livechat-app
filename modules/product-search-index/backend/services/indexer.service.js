// Service: PrestaShop search indexer (words + index).
// Adapts to schema by probing presence of columns (id_shop/id_lang) on ps_search_word and ps_search_index.

import { connectMySql, makeSqlHelpers, getMysql2FromCtx } from '../../../grabbing-jerome/backend/services/transfer/mysql.js';

function tokenize(text = '') {
  try {
    const s = String(text || '').toLowerCase();
    return s.split(/[^a-z0-9]+/i).map(w => w.trim()).filter(w => w.length >= 2);
  } catch { return []; }
}

function truncateWord30(s = '') {
  try {
    const w = String(s || '').toLowerCase();
    return w.length > 30 ? w.slice(0, 30) : w;
  } catch { return ''; }
}

export async function loadProfileConfig(pool, orgId, profileId) {
  if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
  const args = [Number(profileId)];
  const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
  if (orgId) args.push(orgId);
  const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
  if (!r || !r.rowCount) throw new Error('profile_not_found');
  const row = r.rows[0];
  return {
    host: row.host,
    port: Number(row.port || 3306),
    database: row.database,
    user: row.user,
    password: row.password || '',
    ssl: row.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 15000),
  };
}

async function detectColumns(q, database, table) {
  try {
    const rows = await q(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
      [database, table]
    );
    const cols = new Set((rows || []).map(r => String(r.COLUMN_NAME || r.column_name || '').toLowerCase()));
    return cols;
  } catch { return new Set(); }
}

export async function runSearchIndex(ctx, { pool, chatLog }, params, helpers = {}) {
  const emit = (typeof helpers.emit === 'function') ? helpers.emit : (()=>{});
  const orgId = (()=>{ try { return (params.org_id != null) ? String(params.org_id) : null; } catch { return null; } })();
  const profileId = Number(params.profile_id || 0);
  const idShop = Number(params.id_shop || 0);
  const fromId = Number(params.id_product_from || params.from || 0);
  const toId = Number(params.id_product_to || params.to || 0);
  const prefix = String(params.prefix || 'ps_');
  const clearBefore = !!params.clear_before || params.clear === true;
  const includeName = params.include_name !== false;
  const includeReference = params.include_reference !== false;
  const includeAttributes = params.include_attributes !== false;
  const includeSupplierReference = params.include_supplier_reference !== false;
  const includeIdProduct = params.include_id_product !== false;
  const idLangs = Array.isArray(params.id_langs) && params.id_langs.length ? params.id_langs.map(n=>Number(n)).filter(n=>n>0) : [1];

  if (!profileId) throw new Error('bad_request:profile_id');
  if (!idShop) throw new Error('bad_request:id_shop');
  if (!fromId || !toId || fromId > toId) throw new Error('bad_request:id_product_range');

  chatLog('psi.start', { profileId, idShop, fromId, toId, idLangs, prefix });

  const cfg = await loadProfileConfig(pool, orgId, profileId);
  let conn;
  try {
    // Prefer mysql2 from context (backend/node_modules) via helper
    try { await getMysql2FromCtx(ctx); } catch {}
    conn = await connectMySql(ctx, cfg);
    const { q, hasTable, hasColumn } = makeSqlHelpers(conn);
    const dbName = String(cfg.database);

    const tWord = prefix + 'search_word';
    const tIndex = prefix + 'search_index';
    const tProd = prefix + 'product';
    const tProdLang = prefix + 'product_lang';
    const tProdAttr = prefix + 'product_attribute';

    // Basic table presence checks
    if (!(await hasTable(tWord, dbName))) throw new Error('missing_table:search_word');
    if (!(await hasTable(tIndex, dbName))) throw new Error('missing_table:search_index');
    if (!(await hasTable(tProd, dbName))) throw new Error('missing_table:product');
    if (!(await hasTable(tProdLang, dbName))) chatLog('psi.warn', { message: `${tProdLang} not found; names may be unavailable` });
    if (includeAttributes && !(await hasTable(tProdAttr, dbName))) chatLog('psi.info', { message: `${tProdAttr} not found; skipping attribute references` });

    const colsWord = await detectColumns(q, dbName, tWord);
    const colsIndex = await detectColumns(q, dbName, tIndex);
    const wordHasShop = colsWord.has('id_shop');
    const wordHasLang = colsWord.has('id_lang');
    const indexHasShop = colsIndex.has('id_shop');
    const indexHasLang = colsIndex.has('id_lang');

    // Optionally clear existing index rows scoped to the selected shop (and language when provided)
    if (clearBefore) {
      if (indexHasShop) {
        // Native shop column on index → simple scoped delete
        let delSql = `DELETE i FROM \`${tIndex}\` i WHERE i.id_product BETWEEN ? AND ? AND i.id_shop = ?`;
        const delArgs = [fromId, toId, idShop];
        if (indexHasLang && idLangs.length === 1) { delSql += ' AND i.id_lang = ?'; delArgs.push(idLangs[0]); }
        await q(delSql, delArgs);
        chatLog('psi.clear', { table: tIndex, fromId, toId, idShop });
      } else if (wordHasShop) {
        // Common schema: index has no id_shop, but words do → join to scope by shop
        let delSql = `DELETE i FROM \`${tIndex}\` i JOIN \`${tWord}\` w ON w.id_word = i.id_word WHERE i.id_product BETWEEN ? AND ? AND w.id_shop = ?`;
        const delArgs = [fromId, toId, idShop];
        if (wordHasLang && idLangs.length === 1) { delSql += ' AND w.id_lang = ?'; delArgs.push(idLangs[0]); }
        else if (wordHasLang && idLangs.length > 1) { delSql += ` AND w.id_lang IN (${idLangs.map(()=>'?').join(',')})`; delArgs.push(...idLangs); }
        await q(delSql, delArgs);
        chatLog('psi.clear', { table: tIndex, fromId, toId, idShop, by: 'join_word' });
      } else {
        // Fallback: cannot scope by shop → delete only by product range and warn
        await q(`DELETE FROM \`${tIndex}\` WHERE id_product BETWEEN ? AND ?`, [fromId, toId]);
        chatLog('psi.clear', { table: tIndex, fromId, toId, warn: 'no_shop_dimension' });
      }
    }

    // Fetch references for products in range
    const prodRows = await q(`SELECT id_product, reference, supplier_reference FROM \`${tProd}\` WHERE id_product BETWEEN ? AND ?`, [fromId, toId]);
    const refsByProd = new Map();
    for (const r of (prodRows||[])) {
      const idp = Number(r.id_product);
      const ref = String(r.reference || '').trim();
      const sref = String(r.supplier_reference || '').trim();
      if (!refsByProd.has(idp)) refsByProd.set(idp, new Set());
      if (includeReference && ref) refsByProd.get(idp).add(ref);
      if (includeSupplierReference && sref) refsByProd.get(idp).add(sref);
      if (includeIdProduct && idp > 0) refsByProd.get(idp).add(String(idp));
    }
    if ((includeAttributes || includeSupplierReference) && await hasTable(tProdAttr, dbName)) {
      const attrRows = await q(`SELECT id_product, reference, supplier_reference FROM \`${tProdAttr}\` WHERE id_product BETWEEN ? AND ?`, [fromId, toId]);
      for (const r of (attrRows||[])) {
        const idp = Number(r.id_product);
        const ref = String(r.reference || '').trim();
        const sref = String(r.supplier_reference || '').trim();
        if (!refsByProd.has(idp)) refsByProd.set(idp, new Set());
        if (includeReference && ref) refsByProd.get(idp).add(ref);
        if (includeSupplierReference && sref) refsByProd.get(idp).add(sref);
      }
    }

    // Fetch product names per language
    const namesByProdLang = new Map(); // key `${idp}:${id_lang}` -> Set(words)
    if (await hasTable(tProdLang, dbName) && includeName) {
      const langList = idLangs.length ? idLangs : [1];
      for (const idLang of langList) {
        // id_shop may or may not exist on product_lang; probe
        const plHasShop = await hasColumn(tProdLang, 'id_shop', dbName);
        const where = plHasShop ? 'WHERE id_product BETWEEN ? AND ? AND id_lang = ? AND id_shop = ?' : 'WHERE id_product BETWEEN ? AND ? AND id_lang = ?';
        const args = plHasShop ? [fromId, toId, idLang, idShop] : [fromId, toId, idLang];
        const rows = await q(`SELECT id_product, name FROM \`${tProdLang}\` ${where}`, args);
        for (const r of (rows||[])) {
          const idp = Number(r.id_product);
          const words = tokenize(r.name || '');
          const key = `${idp}:${idLang}`;
          const set = (namesByProdLang.get(key) || new Set());
          words.forEach(w => set.add(truncateWord30(w)));
          namesByProdLang.set(key, set);
        }
      }
    }

    // Helper: ensure word in ps_search_word, return id_word
    async function ensureWord(word, idLang) {
      const w = truncateWord30(String(word || '').trim().toLowerCase());
      if (!w) return null;
      let selSql = `SELECT id_word FROM \`${tWord}\` WHERE word = ?`;
      const selArgs = [w];
      if (wordHasLang) { selSql += ' AND id_lang = ?'; selArgs.push(idLang); }
      if (wordHasShop) { selSql += ' AND id_shop = ?'; selArgs.push(idShop); }
      const exist = await q(selSql, selArgs);
      if (exist && exist.length) return Number(exist[0].id_word);
      let insCols = ['word'];
      let insVals = ['?'];
      const insArgs = [w];
      if (wordHasLang) { insCols.push('id_lang'); insVals.push('?'); insArgs.push(idLang); }
      if (wordHasShop) { insCols.push('id_shop'); insVals.push('?'); insArgs.push(idShop); }
      const insSql = `INSERT INTO \`${tWord}\` (${insCols.join(',')}) VALUES (${insVals.join(',')})`;
      const r = await q(insSql, insArgs);
      const id = Number(r.insertId || 0);
      if (id) return id;
      // Race: re-select
      const exist2 = await q(selSql, selArgs);
      return exist2 && exist2.length ? Number(exist2[0].id_word) : null;
    }

    // Build index for each product in range
    let processed = 0;
    const total = toId - fromId + 1;
    const results = [];
    for (let idp = fromId; idp <= toId; idp++) {
      const wordsByLang = new Map(); // id_lang -> Map(word->weight)
      for (const idLang of idLangs) {
        const map = new Map();
        // Name words → weight always 1
        const key = `${idp}:${idLang}`;
        const nameSet = namesByProdLang.get(key) || new Set();
        for (const w of nameSet) { const t = truncateWord30(w); if (t) map.set(t, 1); }
        // Reference and supplier reference words (also id_product if requested) → weight always 1
        const refSet = refsByProd.get(idp) || new Set();
        for (const ref of refSet) {
          const raw = String(ref || '').trim().toLowerCase();
          const rawT = truncateWord30(raw);
          if (rawT) map.set(rawT, 1); // keep full reference like "sg1041cd/bnc"
          for (const w of tokenize(ref)) { const t = truncateWord30(w); if (t) map.set(t, 1); }
        }
        if (includeIdProduct) {
          const pid = truncateWord30(String(idp));
          // push raw numeric id as word even if tokenize() would filter short ids
          map.set(pid, 1);
        }
        if (map.size) wordsByLang.set(idLang, map);
      }

      // Persist words and index
      for (const [idLang, wmap] of wordsByLang.entries()) {
        // Resolve id_word for each word
        const pairs = [];
        for (const [w, weight] of wmap.entries()) {
          const idWord = await ensureWord(w, idLang);
          if (!idWord) continue;
          pairs.push({ idWord, weight: Number(weight) || 1 });
        }
        if (!pairs.length) continue;
        // Insert into search_index, adapting to schema
        // Prefer UPSERT; fallback to INSERT IGNORE when unique key exists
        const cols = ['id_product', 'id_word', 'weight'];
        const extraCols = [];
        if (indexHasLang) extraCols.push({ name: 'id_lang', value: idLang });
        if (indexHasShop) extraCols.push({ name: 'id_shop', value: idShop });
        const colNames = [...cols, ...extraCols.map(c=>c.name)];
        const rowsSql = pairs.map(_ => `(${['?','?','?'].concat(extraCols.map(()=>'?')).join(',')})`).join(',');
        const args = [];
        for (const p of pairs) {
          args.push(idp, p.idWord, p.weight);
          for (const c of extraCols) args.push(c.value);
        }
        const up = 'ON DUPLICATE KEY UPDATE weight = 1';
        const ins = `INSERT INTO \`${tIndex}\` (${colNames.join(',')}) VALUES ${rowsSql} ${up}`;
        await q(ins, args);
      }

      processed++;
      const step = { id_product: idp, processed, total };
      results.push({ id_product: idp, ok: true });
      chatLog('psi.step', step);
      try { emit({ type: 'step', ...step }); } catch {}
    }

    // After (re)indexing and when clearing was requested, prune orphan words for the selected shop/languages
    if (clearBefore) {
      try {
        // Only attempt a scoped prune when ps_search_word has id_shop so we don't affect other shops
        if (wordHasShop) {
          // Build multi-table DELETE that removes words not referenced by search_index
          // LEFT JOIN keeps rows with no matching index; we delete only those
          const langFilter = Array.isArray(idLangs) && idLangs.length ? idLangs.map(n=>Number(n)).filter(n=>n>0) : [];
          const joinConds = [ 'i.id_word = w.id_word' ];
          if (indexHasShop) joinConds.push('i.id_shop = w.id_shop');
          if (indexHasLang && wordHasLang) joinConds.push('i.id_lang = w.id_lang');
          let sql = `DELETE w FROM \`${tWord}\` w LEFT JOIN \`${tIndex}\` i ON ${joinConds.join(' AND ')} WHERE w.id_shop = ?`;
          const args = [ idShop ];
          if (wordHasLang && langFilter.length) {
            sql += ` AND w.id_lang IN (${langFilter.map(()=>'?').join(',')})`;
            args.push(...langFilter);
          }
          sql += ' AND i.id_word IS NULL';
          await q(sql, args);
          chatLog('psi.prune_words', { table: tWord, idShop, idLangs: langFilter });
        } else {
          // No id_shop on ps_search_word → skip prune to avoid cross-shop effects
          chatLog('psi.prune_words.skip', { reason: 'no_id_shop_column' });
        }
      } catch (e) {
        // Keep portable; log and continue
        chatLog('psi.prune_words.error', { message: e?.message || String(e) });
      }
    }

    chatLog('psi.done', { processed, total });
    try { emit({ type: 'summary', processed, total }); } catch {}
    return { ok: true, processed, total };
  } finally {
    try { if (conn) await conn.end(); } catch {}
  }
}
