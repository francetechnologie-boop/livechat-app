// Migrate "Grabing Jerome" data to PostgreSQL
// - Creates tables if missing
// - Imports queue.json, transfers.json
// - Imports extract/discovery metadata from files under uploads/grabbing-jerome/
// Usage: node scripts/migrate-jerome-pg.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

const rootDir = path.resolve(path.join(process.cwd(), '.'));
const backendDir = path.join(rootDir, 'livechat-app', 'backend');
// When running from backend/, fallback to local
const uploadsDir = fs.existsSync(path.join(backendDir, 'uploads'))
  ? path.join(backendDir, 'uploads', 'grabbing-jerome')
  : path.join(process.cwd(), 'uploads', 'grabbing-jerome');

async function getPool() {
  const connectionString = process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER||'postgres'}:${process.env.PGPASSWORD||''}@${process.env.PGHOST||'127.0.0.1'}:${process.env.PGPORT||5432}/${process.env.PGDATABASE||'postgres'}`;
  const ssl = String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString, ssl });
  await pool.query('select 1');
  return pool;
}

async function ensureTables(pool) {
  await pool.query(`create table if not exists grabbing_jerome_queue (
    id text primary key,
    url text not null,
    status text not null default 'pending',
    added_at timestamptz not null default now()
  )`);
  await pool.query(`create table if not exists grabbing_jerome_extracts (
    id bigserial primary key,
    file_name text not null,
    mtime timestamptz not null default now(),
    size bigint default 0,
    download_url text,
    product_url text,
    price numeric,
    currency text,
    image text,
    declinaison text,
    json_data jsonb
  )`);
  await pool.query(`create table if not exists grabbing_jerome_discover (
    id bigserial primary key,
    base_url text not null,
    created_at timestamptz not null default now()
  )`);
  // domain column for quick grouping/filtering by host
  await pool.query(`alter table grabbing_jerome_discover add column if not exists domain text`);
  await pool.query(`create index if not exists grabbing_jerome_discover_domain_idx on grabbing_jerome_discover (domain)`);
  // Per-domain aggregated table
  await pool.query(`create table if not exists grabbing_jerome_discover_domain (
    domain text primary key,
    sitemap_url text,
    sitemaps jsonb,
    sitemap_total_urls integer default 0,
    total_discovered_urls integer default 0,
    types jsonb,
    updated_at timestamptz not null default now()
  )`);
  await pool.query(`create table if not exists grabbing_jerome_discover_item (
    id bigserial primary key,
    discover_id bigint not null references grabbing_jerome_discover(id) on delete cascade,
    url text not null,
    type text,
    title text
  )`);
  // Master domains registry (explicit adds)
  await pool.query(`create table if not exists grabbing_jerome_domains (
    domain text primary key,
    sitemap_url text,
    sitemaps jsonb,
    sitemap_total_urls integer default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  try { await pool.query('alter table grabbing_jerome_domains add column if not exists selected_sitemaps jsonb'); } catch {}
  // Extracted URLs per domain
  await pool.query(`create table if not exists grabbing_jerome_domains_url (
    id bigserial primary key,
    domain text not null,
    url text not null,
    type text,
    title text,
    discovered_at timestamptz not null default now()
  )`);
  try { await pool.query('create index if not exists grabbing_jerome_domains_url_domain_idx on grabbing_jerome_domains_url (domain)'); } catch {}
  try { await pool.query('create unique index if not exists grabbing_jerome_domains_url_uq on grabbing_jerome_domains_url (domain, lower(trim(url)))'); } catch {}
  // Deduplicate existing rows before adding unique constraint on normalized URL
  try { await pool.query("delete from grabbing_jerome_discover_item a using grabbing_jerome_discover_item b where a.id > b.id and lower(trim(a.url)) = lower(trim(b.url))"); } catch {}
  try { await pool.query("delete from grabbing_jerome_discover_item where trim(url) = ''"); } catch {}
  // Unique across all discovered URLs (case/space insensitive), ignore empty URLs
  try { await pool.query(`create unique index if not exists grabbing_jerome_discover_item_url_uq on grabbing_jerome_discover_item ((lower(trim(url)))) where length(trim(url))>0`); } catch {}
  await pool.query(`create table if not exists grabbing_jerome_transfers (
    id bigserial primary key,
    when_at timestamptz not null default now(),
    id_product bigint,
    product_url text,
    image text,
    price numeric,
    currency text,
    declinaison text,
    file text,
    name text
  )`);
}

function readJsonSafe(p) {
  try {
    const txt = fs.readFileSync(p, 'utf8');
    return JSON.parse(txt||'{}');
  } catch { return null; }
}

async function migrateQueue(pool) {
  const p = path.join(uploadsDir, 'queue.json');
  if (!fs.existsSync(p)) return { imported: 0 };
  const arr = readJsonSafe(p);
  if (!Array.isArray(arr) || !arr.length) return { imported: 0 };
  let added = 0;
  for (const it of arr) {
    const id = String(it?.id || '').trim() || `jq_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = String(it?.url || '').trim(); if (!url) continue;
    const status = String(it?.status || 'pending');
    const added_at = it?.added_at ? new Date(it.added_at) : new Date();
    try {
      await pool.query('insert into grabbing_jerome_queue(id,url,status,added_at) values($1,$2,$3,$4) on conflict (id) do nothing', [id, url, status, added_at]);
      added++;
    } catch {}
  }
  return { imported: added };
}

async function migrateTransfers(pool) {
  const p = path.join(uploadsDir, 'transfers.json');
  if (!fs.existsSync(p)) return { imported: 0 };
  const arr = readJsonSafe(p);
  if (!Array.isArray(arr) || !arr.length) return { imported: 0 };
  let added = 0;
  for (const it of arr) {
    const when_at = new Date(it.when || it.added_at || Date.now());
    const vals = [when_at, it.id_product||null, it.product_url||null, it.image||null, it.price||null, it.currency||null, it.declinaison||null, it.file||null, it.name||null];
    try { await pool.query('insert into grabbing_jerome_transfers(when_at,id_product,product_url,image,price,currency,declinaison,file,name) values($1,$2,$3,$4,$5,$6,$7,$8,$9)', vals); added++; } catch {}
  }
  return { imported: added };
}

async function migrateExtracts(pool) {
  if (!fs.existsSync(uploadsDir)) return { imported: 0 };
  const names = fs.readdirSync(uploadsDir).filter(n => /\.json$/i.test(n) && !/^jerome-discover-/i.test(n));
  let added = 0;
  for (const n of names) {
    try {
      const fp = path.join(uploadsDir, n);
      const st = fs.statSync(fp);
      const j = readJsonSafe(fp) || {};
      const product_url = j?.page?.url || j?.meta?.url || null;
      const price = j?.product?.price || null;
      const currency = j?.product?.currency || null;
      const image = Array.isArray(j?.product?.images) && j.product.images.length ? j.product.images[0] : (j?.meta?.image || null);
      const decl = j?.product?.sku ? `SKU: ${j.product.sku}` : null;
      const download_url = `/api/grabbings/jerome/file/${encodeURIComponent(n)}`;
      await pool.query('delete from grabbing_jerome_extracts where file_name=$1', [n]);
      await pool.query('insert into grabbing_jerome_extracts(file_name,mtime,size,download_url,product_url,price,currency,image,declinaison,json_data) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [n, st.mtime, Number(st.size||0), download_url, product_url, price, currency, image, decl, j]);
      added++;
    } catch {}
  }
  return { imported: added };
}

async function migrateDiscovery(pool) {
  if (!fs.existsSync(uploadsDir)) return { imported: 0, items: 0 };
  const names = fs.readdirSync(uploadsDir).filter(n => /^jerome-discover-.*\.json$/i.test(n));
  let sessions = 0, items = 0;
  for (const n of names) {
    const fp = path.join(uploadsDir, n);
    const j = readJsonSafe(fp); if (!j) continue;
    const base = j.base_url || '';
    let urls = [];
    if (Array.isArray(j.urls)) urls = j.urls;
    else if (Array.isArray(j.items)) urls = j.items;
    else if (j.url || j.href) urls = [{ url: j.url || j.href, type: j.type || '', title: j.title || j.text || '' }];
    try {
      let domain = '';
      try { domain = new URL(base).hostname.toLowerCase(); } catch {}
      const ins = await pool.query('insert into grabbing_jerome_discover(base_url, domain) values($1, $2) returning id', [base, domain]);
      const did = ins.rows[0].id;
      let idx = 1; const vals = [];
      let sql = 'insert into grabbing_jerome_discover_item(discover_id,url,type,title) values ';
      for (let i=0;i<urls.length;i++) {
        const raw = urls[i];
        const u = typeof raw === 'string' ? { url: raw, type: '', title: '' } : (raw || {});
        sql += `($${idx++},$${idx++},$${idx++},$${idx++})` + (i<urls.length-1?',':'');
        vals.push(did, u.url||'', u.type||'', u.title||u.text||'');
      }
      if (urls.length) await pool.query(sql + ' on conflict on constraint grabbing_jerome_discover_item_url_uq do nothing', vals);
      sessions++; items += urls.length;
    } catch {}
  }
  return { imported: sessions, items };
}

// Ensure missing domains are backfilled from base_url and
// refresh per-domain aggregates in grabbing_jerome_discover_domain
async function refreshDomainAggregates(pool) {
  // 1) Backfill domain from base_url when missing
  await pool.query(`
    update grabbing_jerome_discover
    set domain = lower(split_part(regexp_replace(base_url, '^[a-z]+://', ''), '/', 1))
    where (domain is null or trim(domain) = '')
      and base_url ~ '^[a-z]+://';
  `);

  // 2) Upsert aggregates per domain
  await pool.query(`
    insert into grabbing_jerome_discover_domain (domain, total_discovered_urls, types, updated_at)
    select d.domain,
           count(i.id)::int,
           coalesce(jsonb_agg(distinct lower(nullif(i.type,''))) filter (where i.type is not null), '[]'::jsonb),
           now()
    from grabbing_jerome_discover d
    left join grabbing_jerome_discover_item i on i.discover_id = d.id
    where trim(coalesce(d.domain,''))<>''
    group by d.domain
    on conflict (domain)
    do update set total_discovered_urls = EXCLUDED.total_discovered_urls,
                  types = EXCLUDED.types,
                  updated_at = now();
  `);
}

async function main() {
  console.log('Jerome PG migration starting...');
  console.log('Uploads dir:', uploadsDir);
  const pool = await getPool();
  await ensureTables(pool);
  const q = await migrateQueue(pool);
  const t = await migrateTransfers(pool);
  const e = await migrateExtracts(pool);
  const d = await migrateDiscovery(pool);
  await refreshDomainAggregates(pool);
  console.log(`Queue imported: ${q.imported}`);
  console.log(`Transfers imported: ${t.imported}`);
  console.log(`Extracts imported: ${e.imported}`);
  console.log(`Discover sessions imported: ${d.imported} (items: ${d.items})`);
  await pool.end();
  console.log('Done.');
}

main().catch(err => { console.error('Migration failed:', err?.message||err); process.exit(1); });
