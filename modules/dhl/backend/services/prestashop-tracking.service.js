import { connectMySql, makeSqlHelpers } from '../utils/mysql.js';

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizePrefix(prefix) {
  const p = String(prefix || 'ps_').trim();
  if (!p) return 'ps_';
  // Safety: avoid SQL injection via prefix; allow only [a-zA-Z0-9_]
  if (!/^[a-zA-Z0-9_]+$/.test(p)) return 'ps_';
  return p;
}

async function resolveMysqlProfile(ctx = {}, { profileId, orgId } = {}) {
  const pool = ctx?.pool;
  if (!pool || typeof pool.query !== 'function') return null;
  try {
    const args = [profileId];
    const whereOrg = orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '';
    if (orgId) args.push(orgId);
    const query = async (table) => (
      pool.query(
        `SELECT id, host, port, "database", db_user AS user, db_password AS password, ssl
           FROM ${table}
          WHERE id = $1${whereOrg}
          LIMIT 1`,
        args
      )
    );
    let r = null;
    try { r = await query('mod_db_mysql_profiles'); }
    catch {
      // Best-effort fallback for environments where schema qualification is required
      r = await query('public.mod_db_mysql_profiles');
    }
    if (!r.rowCount) return null;
    return r.rows[0];
  } catch { return null; }
}

export async function resolvePrestaOrderTrackingNumber(ctx = {}, { idOrder, profileId, prefix = 'ps_', orgId = null } = {}) {
  const id_order = clampInt(idOrder, 1, 2_000_000_000, 0);
  const profile_id = clampInt(profileId, 1, 2_000_000_000, 0);
  if (!id_order || !profile_id) return { ok: false, error: 'bad_request', message: 'id_order and profile_id required', http_status: 400 };

  const prof = await resolveMysqlProfile(ctx, { profileId: profile_id, orgId });
  if (!prof) return { ok: false, error: 'profile_not_found', http_status: 404 };

  const px = normalizePrefix(prefix);
  const cfg = {
    host: String(prof.host || 'localhost'),
    port: Number(prof.port || 3306),
    user: String(prof.user || ''),
    password: String(prof.password || ''),
    database: String(prof.database || ''),
    ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
  };

  let conn = null;
  try {
    conn = await connectMySql(ctx, cfg);
    const { q, qi, hasTable, hasColumn } = makeSqlHelpers(conn);
    const dbName = cfg.database;

    const T_OC = px + 'order_carrier';
    const T_O = px + 'orders';
    const T_C = px + 'customer';
    const T_A = px + 'address';

    let tracking = null;
    let source = null;
    let order_reference = null;
    let customer = null;

    if (await hasTable(T_OC, dbName) && await hasColumn(T_OC, 'tracking_number', dbName)) {
      const rows = await q(
        `SELECT ${qi('tracking_number')} AS tracking_number
           FROM ${qi(T_OC)}
          WHERE ${qi('id_order')} = ?
          ORDER BY ${qi('id_order_carrier')} DESC
          LIMIT 1`,
        [id_order]
      );
      tracking = String(rows?.[0]?.tracking_number || '').trim() || null;
      if (tracking) source = 'order_carrier.tracking_number';
    }

    if (!tracking && await hasTable(T_O, dbName)) {
      if (await hasColumn(T_O, 'reference', dbName)) {
        try {
          const rr = await q(
            `SELECT ${qi('reference')} AS reference
               FROM ${qi(T_O)}
              WHERE ${qi('id_order')} = ?
              LIMIT 1`,
            [id_order]
          );
          order_reference = String(rr?.[0]?.reference || '').trim() || null;
        } catch {}
      }
      if (await hasColumn(T_O, 'shipping_number', dbName)) {
        const rows = await q(
          `SELECT ${qi('shipping_number')} AS shipping_number
             FROM ${qi(T_O)}
            WHERE ${qi('id_order')} = ?
            LIMIT 1`,
          [id_order]
        );
        tracking = String(rows?.[0]?.shipping_number || '').trim() || null;
        if (tracking) source = 'orders.shipping_number';
      }
    }

    // Customer + company (best-effort)
    try {
      if (await hasTable(T_O, dbName) && await hasTable(T_C, dbName)) {
        const hasEmail = await hasColumn(T_C, 'email', dbName);
        const hasFirst = await hasColumn(T_C, 'firstname', dbName);
        const hasLast = await hasColumn(T_C, 'lastname', dbName);
        const hasIdCust = await hasColumn(T_O, 'id_customer', dbName);
        const hasInvAddr = await hasColumn(T_O, 'id_address_invoice', dbName);
        const hasDelAddr = await hasColumn(T_O, 'id_address_delivery', dbName);
        const hasAddr = await hasTable(T_A, dbName);
        const hasCompany = hasAddr ? await hasColumn(T_A, 'company', dbName) : false;
        if (hasIdCust && (hasEmail || hasFirst || hasLast)) {
          const sel = [];
          if (hasEmail) sel.push(`c.${qi('email')} AS email`);
          if (hasFirst) sel.push(`c.${qi('firstname')} AS firstname`);
          if (hasLast) sel.push(`c.${qi('lastname')} AS lastname`);
          if (hasCompany && hasInvAddr) sel.push(`ai.${qi('company')} AS company_invoice`);
          if (hasCompany && hasDelAddr) sel.push(`ad.${qi('company')} AS company_delivery`);
          const joins = [];
          if (hasCompany && hasInvAddr) joins.push(`LEFT JOIN ${qi(T_A)} ai ON ai.${qi('id_address')} = o.${qi('id_address_invoice')}`);
          if (hasCompany && hasDelAddr) joins.push(`LEFT JOIN ${qi(T_A)} ad ON ad.${qi('id_address')} = o.${qi('id_address_delivery')}`);
          const rows = await q(
            `SELECT ${sel.join(', ')}
               FROM ${qi(T_O)} o
               JOIN ${qi(T_C)} c ON c.${qi('id_customer')} = o.${qi('id_customer')}
               ${joins.join('\n')}
              WHERE o.${qi('id_order')} = ?
              LIMIT 1`,
            [id_order]
          );
          const r0 = rows?.[0] || {};
          const company = String(r0.company_invoice || r0.company_delivery || '').trim() || null;
          customer = {
            email: (r0.email != null ? String(r0.email).trim() : null) || null,
            firstname: (r0.firstname != null ? String(r0.firstname).trim() : null) || null,
            lastname: (r0.lastname != null ? String(r0.lastname).trim() : null) || null,
            company,
          };
        }
      }
    } catch {}

    // Basic cleanup: strip spaces
    if (tracking) {
      // Keep the first token if the field contains multiple references.
      try {
        const parts = String(tracking).split(/[\s,;|]+/g).filter(Boolean);
        if (parts.length) tracking = parts[0];
      } catch {}
      tracking = String(tracking).replace(/\s+/g, '').trim();
      // Some back-offices store a trailing slash/backslash; strip it to keep DHL links valid.
      tracking = tracking.replace(/[\\\/]/g, '').trim() || null;
    }

    return {
      ok: true,
      http_status: 200,
      id_order,
      profile_id,
      prefix: px,
      order_reference,
      customer,
      tracking_number: tracking,
      source,
    };
  } catch (e) {
    try { ctx?.chatLog?.('prestashop_tracking_resolve_error', { message: e?.message || String(e), id_order, profile_id }); } catch {}
    return { ok: false, error: 'resolve_failed', message: e?.message || String(e), http_status: 500 };
  } finally {
    try { await conn?.end?.(); } catch {}
  }
}
