import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch (e) { return null; } }

async function getSharp(ctx) {
  try { const mod = await import('sharp'); return mod && (mod.default || mod); } catch (e) {}
  try {
    const backendDir = (ctx && ctx.backendDir) || path.resolve(process.cwd(), 'backend');
    const { createRequire } = await import('module');
    const req = createRequire(path.join(backendDir, 'package.json'));
    const mod = req('sharp');
    return mod && (mod.default || mod);
  } catch (e) {}
  const err = new Error('sharp_missing'); err.code = 'SHARP_MISSING'; throw err;
}

async function getFtp(ctx) {
  try { const mod = await import('basic-ftp'); return mod && (mod.default || mod); } catch (e) {}
  try {
    const backendDir = (ctx && ctx.backendDir) || path.resolve(process.cwd(), 'backend');
    const { createRequire } = await import('module');
    const req = createRequire(path.join(backendDir, 'package.json'));
    const mod = req('basic-ftp');
    return mod && (mod.default || mod);
  } catch (e) {}
  const err = new Error('ftp_missing'); err.code = 'FTP_MISSING'; throw err;
}

function normalizeConn(raw = {}) {
  const host = String(raw.host || '').trim();
  const port = Number(raw.port || 3306);
  const database = String(raw.database || '').trim();
  const user = String(raw.user || raw.db_user || '').trim();
  const password = raw.password != null ? String(raw.password) : String(raw.db_password || '');
  const ssl = !!raw.ssl;
  return { host, port, database, user, password, ssl };
}
async function getMysql2(ctx) {
  try { const mod = await import('mysql2/promise'); return mod && (mod.default || mod); } catch (e) {}
  try {
    const backendDir = (ctx && ctx.backendDir) || path.resolve(process.cwd(), 'backend');
    const req = createRequire(path.join(backendDir, 'package.json'));
    const mod = req('mysql2/promise');
    return mod && (mod.default || mod);
  } catch (e) {}
  const err = new Error('mysql2_missing'); err.code = 'MYSQL2_MISSING'; throw err;
}

async function ensureDir(p) { await fs.promises.mkdir(p, { recursive: true }).catch(()=>{}); }

async function fetchImageAsBuffer(urlOrData) {
  try {
    if (!urlOrData) return null;
    let s = String(urlOrData);
    if (s.startsWith('data:image/')) {
      const m = s.match(/^data:image\/[^;]+;base64,(.*)$/);
      if (m) return Buffer.from(m[1], 'base64');
    }
    if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length > 64) {
      try { return Buffer.from(s, 'base64'); } catch (e) {}
    }
    const r = await fetch(s);
    const buf = Buffer.from(await r.arrayBuffer());
    return buf;
  } catch (e) { return null; }
}

export function registerCategoryDataUpdateImageMakeRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const chatLog = utils.chatLog || (()=>{});
  const sseEmit = (utils && typeof utils.sseEmit === 'function') ? utils.sseEmit : (()=>{});
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  app.post('/api/category_data_update/categories/image-make', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? b.ids.map(x=>Number(x)).filter(n=>Number.isFinite(n) && n>0) : String(b.category_ids||'').split(',').map(s=>Number(String(s).trim())).filter(n=>Number.isFinite(n) && n>0);
    const dryRun = !!b.dry_run;
    const runId = (b.run_id != null) ? String(b.run_id) : null;
    const orgId = (b.org_id != null) ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const profileId = Number(b.profile_id || 0) || null;
    const dbProfileId = Number(b.db_profile_id || b.profile_id_db || 0) || null;
    const prefix = String(b.prefix || b.db_prefix || '').trim();
    if (!profileId || !ids.length) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const args = [profileId];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      // Determine available columns
      async function imageProfileCols() {
        try {
          const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_category_data_update_image_profiles'`);
          return new Set((r.rows||[]).map(x=>String(x.column_name)));
    } catch (e) { return new Set(); }
      }
      const have = await imageProfileCols();
      const cols = ['id','"name"', ...(have.has('ftp_profile_id')? ['ftp_profile_id'] : []), ...(have.has('db_profile_id')? ['db_profile_id'] : []), ...(have.has('id_shop')? ['id_shop'] : []), ...(have.has('id_lang')? ['id_lang'] : []), 'base_path','prompt_config_id'];
      const pr = await pool.query(`SELECT ${cols.join(', ')} FROM mod_category_data_update_image_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      let ftpPid = have.has('ftp_profile_id') ? Number(prof.ftp_profile_id || 0) : 0;
      let profDbPid = have.has('db_profile_id') ? Number(prof.db_profile_id || 0) : 0;
      let f = null;
      if (ftpPid) {
        const fr = await pool.query(`SELECT * FROM public.mod_ftp_connection_profiles WHERE id=$1 LIMIT 1`, [ftpPid]);
        if (!fr.rowCount) return res.status(404).json({ ok:false, error:'ftp_profile_not_found' });
        f = fr.rows[0];
      }

      const sharp = await getSharp(ctx);
      const FTP = await getFtp(ctx);
      const tmpRoot = path.join(os.tmpdir(), 'cdu-images');
      await ensureDir(tmpRoot);

      async function callPrompt(inputObject, promptId) {
        if (!promptId) return null;
        const base = String(process.env.INTERNAL_SERVER_URL || '').trim() || `http://127.0.0.1:${Number(process.env.PORT || process.env.APP_PORT || 3010)}`;
        const url = `${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`;
        const payload = { input: JSON.stringify(inputObject) };
        const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const j = await r.json().catch(()=>({}));
        if (!r.ok) throw new Error(j?.message || `prompt_http_${r.status}`);
        return j;
      }

      const promptId = String(b.prompt_config_id || prof.prompt_config_id || '').trim();
      // Optional DB context for prompt
      let mysql = null, conn = null, tblCL = null;
      try {
        const effDbPid = dbProfileId || profDbPid || 0;
        if (effDbPid && prefix) {
          const argsDb = [dbProfileId];
          const whereOrgDb = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
          if (orgId) argsDb.push(orgId);
          argsDb[0] = effDbPid;
          const pDb = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrgDb} LIMIT 1`, argsDb);
          if (pDb.rowCount) {
            mysql = await getMysql2(ctx);
            const cfg = normalizeConn(pDb.rows[0]);
            const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
            conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl });
            tblCL = `${prefix}category_lang`;
          }
        }
      } catch (e) {}
      const out = [];
      // Connect FTP unless dryRun
      let ftp = null;
      let sftp = null;
      try {
        if (!dryRun) {
          const proto = f ? (String(f.protocol || 'ftp').toLowerCase() === 'sftp' ? 'sftp' : 'ftp') : 'ftp';
          if (proto === 'ftp') {
            ftp = new FTP.Client(15000);
            const host = f ? f.host : '';
            const port = f ? Number(f.port||21) : 21;
            const user = f ? (f.username || undefined) : undefined;
            const pass = f ? (f.password || undefined) : undefined;
            await ftp.access({ host, port, user, password: pass, secure: false, passive: f ? (f.passive !== false) : true });
          } else {
            let SFTPClient;
            try { ({ default: SFTPClient } = await import('ssh2-sftp-client')); }
            catch (e) {
              // fallback via backend node_modules
              try {
                const { createRequire } = await import('module');
                const req = createRequire(path.resolve(process.cwd(), 'backend/package.json'));
                SFTPClient = req('ssh2-sftp-client');
              } catch (e) { throw Object.assign(new Error('sftp_missing'), { code:'SFTP_MISSING' }); }
            }
            sftp = new SFTPClient();
            await sftp.connect({ host: f.host, port: Number(f.port||22), username: f.username, password: f.password });
          }
        }
      } catch (e) {
        return res.status(500).json({ ok:false, error:'ftp_connect_failed', message: e?.message || String(e) });
      }

      for (const id of ids) {
        try {
          try { if (runId) sseEmit(runId, 'image_start', { id_category: id }); } catch (e) {}
          // Load category text for prompt context
          let cat = null; const idShop = Number(prof.id_shop || 0) || null; const idLang = Number(prof.id_lang || 0) || null;
          try {
            if (conn && idShop && idLang) {
              const [rows] = await conn.query(`SELECT id_category, name, description, meta_title, meta_description FROM \`${tblCL}\` WHERE id_category=? AND id_shop=? AND id_lang=? LIMIT 1`, [id, idShop, idLang]);
              if (Array.isArray(rows) && rows.length) cat = rows[0];
            }
          } catch (e) {}
          let srcBuf = null;
          if (b.image_base64) srcBuf = await fetchImageAsBuffer(b.image_base64);
          if (!srcBuf && promptId) {
            const input = { kind: 'category_image', id_category: id, id_shop: idShop, id_lang: idLang, source: cat ? { name: cat.name || '', description: cat.description || '', meta_title: cat.meta_title || '', meta_description: cat.meta_description || '' } : null, notes: b.notes || null };
            try { if (runId) sseEmit(runId, 'prompt_request', { id_category: id, id_shop: idShop, id_lang: idLang, input_len: JSON.stringify(input).length, prompt: input }); } catch (e) {}
            const r = await callPrompt(input, promptId);
            try { if (runId) sseEmit(runId, 'prompt_received', { id_category: id, id_shop: idShop, id_lang: idLang }); } catch (e) {}
            const cand = r?.image || r?.image_base64 || r?.url || r?.data || r?.text || null;
            try { if (runId) sseEmit(runId, 'prompt_output', { id_category: id, id_shop: idShop, id_lang: idLang, have: !!cand, keys: Object.keys(r||{}).slice(0,10) }); } catch (e) {}
            srcBuf = await fetchImageAsBuffer(cand);
          }
          if (!srcBuf) throw new Error('no_image_from_prompt');

          // Build outputs
          const workDir = path.join(tmpRoot, String(id)); await ensureDir(workDir);
          const fn = {
            main: `${id}.jpg`,
            def_jpg: `${id}-category_default.jpg`,
            def_webp: `${id}-category_default.webp`,
            sm_jpg: `${id}-small_default.jpg`,
            sm_webp: `${id}-small_default.webp`
          };

          // Create sizes using 'contain' so entire content fits, with white background
          async function saveSharp(buf, outPath, w, h, toWebp = false) {
            let im = sharp(buf).resize(w, h, { fit: 'contain', background: { r:255, g:255, b:255, alpha:1 } }).flatten({ background: '#ffffff' });
            const p = path.join(workDir, outPath);
            if (toWebp) await im.webp({ quality: 82, effort: 4 }).toFile(p); else await im.jpeg({ quality: 88 }).toFile(p);
            return p;
          }
          // Main and category_default images at 210x110 per requirement
          const pMain = await saveSharp(srcBuf, fn.main, 210, 110, false);
          const pDefJ = await saveSharp(srcBuf, fn.def_jpg, 210, 110, false);
          const pDefW = await saveSharp(srcBuf, fn.def_webp, 210, 110, true);
          const pSmJ = await saveSharp(srcBuf, fn.sm_jpg, 80, 80, false);
          const pSmW = await saveSharp(srcBuf, fn.sm_webp, 80, 80, true);
          try { if (runId) sseEmit(runId, 'resize_done', { id_category: id, files: Object.values(fn) }); } catch (e) {}

          if (!dryRun) {
            const remoteBase = String(prof.base_path || (f && f.base_path) || '').replace(/\\/g, '/').replace(/\/$/, '');
            if (!remoteBase || (!ftp && !sftp)) throw new Error('ftp_profile_required');
            const files = [pMain, pDefJ, pDefW, pSmJ, pSmW];
            for (const pth of files) {
              const name = path.basename(pth);
              const remote = `${remoteBase}/${name}`;
              if (ftp) await ftp.uploadFrom(pth, remote); else if (sftp) { await sftp.fastPut(pth, remote); }
              try { if (runId) sseEmit(runId, 'ftp_upload', { id_category: id, file: name }); } catch (e) {}
            }
          }
          let thumb = null;
          try {
            // Read a small preview (jpg) and send as data URL (for both preview and apply)
            const buf = await fs.promises.readFile(pDefJ).catch(()=>null);
            if (buf) thumb = `data:image/jpeg;base64,${buf.toString('base64')}`;
          } catch (e) {}
          out.push({ id_category: id, ok: true, ...(thumb ? { thumb } : {}) });
          try { if (runId && thumb) sseEmit(runId, 'image_thumb', { id_category: id, thumb }); } catch (e) {}
          try { if (runId) sseEmit(runId, 'image_done', { id_category: id, preview: !!dryRun }); } catch (e) {}
          try { chatLog('cat_image_make_done', { id_category: id, uploaded: !dryRun }); } catch (e) {}
        } catch (e) {
          out.push({ id_category: id, ok: false, error: String(e?.message||e) });
          try { if (runId) sseEmit(runId, 'image_error', { id_category: id, error: String(e?.message||e) }); } catch (e2) {}
          try { chatLog('cat_image_make_error', { id_category: id, error: String(e?.message||e) }); } catch (e2) {}
        }
      }
      try { if (ftp) await ftp.close(); } catch (e) {}
      try { if (conn) await conn.end(); } catch (e) {}
      try { if (sftp) await sftp.end(); } catch (e) {}
      return res.json({ ok:true, items: out });
    } catch (e) {
      if (e?.code === 'SHARP_MISSING') return res.status(500).json({ ok:false, error:'sharp_missing', message: 'Install sharp in backend: cd backend && npm i sharp --omit=dev' });
      if (e?.code === 'FTP_MISSING') return res.status(500).json({ ok:false, error:'ftp_missing', message: 'Install basic-ftp in backend: cd backend && npm i basic-ftp --omit=dev' });
      if (e?.code === 'SFTP_MISSING') return res.status(500).json({ ok:false, error:'sftp_missing', message: 'Install ssh2-sftp-client in backend: cd backend && npm i ssh2-sftp-client --omit=dev' });
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}
