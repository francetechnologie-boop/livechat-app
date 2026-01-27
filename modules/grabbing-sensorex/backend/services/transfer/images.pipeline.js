// Images pipeline (extracted): writes ps_image, ps_image_shop, ps_image_lang
// This implementation is a direct transplant of the legacy images block,
// parameterized via ctx to avoid capturing outer scope.
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { sanitizeFilename, chooseImageRoot, getStagingRoot, getRawDownloadDir, ensureSharp, convertAndWriteVariants, prestashopImageFolder, downloadToFileWithHash } from '../../utils/image.utils.js';
import { pathToFileURL } from 'url';
import { exec as _exec } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(_exec);

// Normalize chmod-style modes from config (accept 644/755 strings or numbers)
function normalizeMode(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^[0-7]{3,4}$/.test(s)) return parseInt(s, 8);
      const n = Number(s);
      if (Number.isFinite(n)) {
        if (n <= 0o777) return n; // likely already decimal bits (e.g., 420)
        if (n >= 111 && n <= 7777) return parseInt(String(n), 8); // treat as octal digits
        return n;
      }
      return fallback;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return fallback;
      if (v <= 0o777) return v; // decimal bits
      if (v >= 111 && v <= 7777) return parseInt(String(v), 8); // typed octal
      return v;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export async function runImagesPipeline(ctx = {}) {
  const {
    q, qi, hasTable, hasColumn, pool,
    chatLog, run, result = {}, domain,
    productId, PREFIX,
    TSET_LANG = {}, TSET_ANY = {}, TABLES = {},
    SHOPS = [], ID_LANG = 1,
    fmtDateTime,
    ensureImageMapTable,
  } = ctx;

  // Resolve remote image server profile when requested
  const resolveFtpProfile = async (id) => {
    try {
      if (!id) return null;
      const r = await pool.query(`SELECT id, name, host, port, protocol, username, password, base_path FROM public.mod_ftp_connection_profiles WHERE id=$1`, [Number(id)||0]);
      if (!r.rowCount) return null;
      return r.rows[0];
    } catch { return null; }
  };

  // Upload helper that supports SFTP/FTP with dynamic import + backend fallback
  const uploadRemoteFiles = async (profile, localDir, remoteDir, files = []) => {
    const proto = String(profile?.protocol||'sftp').toLowerCase();
    if (proto === 'sftp') {
      let SFTPClient = null;
      try { ({ default: SFTPClient } = await import('ssh2-sftp-client')); } catch {
        try {
          const path = (await import('path')).default;
          const { createRequire } = await import('module');
          const req = createRequire(path.resolve(process.cwd(), 'backend', 'index.js'));
          SFTPClient = req('ssh2-sftp-client');
        } catch { chatLog?.('image_remote_missing_dep', { dep: 'ssh2-sftp-client' }); return { ok:false, error:'missing_dep_sftp' }; }
      }
      const client = new SFTPClient();
      try {
        await client.connect({ host: profile.host, port: Number(profile.port||22)||22, username: profile.username||undefined, password: profile.password||undefined });
        // Ensure directory exists
        try { await client.mkdir(remoteDir, true); } catch {}
        for (const f of files) {
          const lp = path.join(localDir, f);
          const rp = path.posix.join(remoteDir.replace(/\\/g,'/'), f);
          await client.fastPut(lp, rp).catch(async () => { await client.put(lp, rp); });
        }
        await client.end();
        return { ok:true, protocol:'sftp' };
      } catch (e) { try { await client.end(); } catch {} chatLog?.('image_remote_upload_error', { protocol:'sftp', error: String(e?.message||e) }); return { ok:false, error:String(e?.message||e) }; }
    } else {
      // FTP
      let FtpClient = null;
      try { ({ default: FtpClient } = await import('basic-ftp')); } catch {
        try {
          const path = (await import('path')).default;
          const { createRequire } = await import('module');
          const req = createRequire(path.resolve(process.cwd(), 'backend', 'index.js'));
          FtpClient = req('basic-ftp');
        } catch { chatLog?.('image_remote_missing_dep', { dep: 'basic-ftp' }); return { ok:false, error:'missing_dep_ftp' }; }
      }
      const client = new FtpClient.Client();
      try {
        await client.access({ host: profile.host, port: Number(profile.port||21)||21, user: profile.username||undefined, password: profile.password||undefined, secure: false });
        await client.ensureDir(remoteDir.replace(/\\/g,'/'));
        for (const f of files) {
          const lp = path.join(localDir, f);
          const rp = path.posix.join(remoteDir.replace(/\\/g,'/'), f);
          await client.uploadFrom(lp, rp);
        }
        await client.close();
        return { ok:true, protocol:'ftp' };
      } catch (e) { try { await client.close(); } catch {} chatLog?.('image_remote_upload_error', { protocol:'ftp', error: String(e?.message||e) }); return { ok:false, error:String(e?.message||e) }; }
    }
  };

  // Apply remote permissions and ownership after upload (best-effort)
  // Supports:
  // - SFTP: chmod for files/dirs; optional chown via ssh2 exec when available
  // - FTP: SITE CHMOD when server supports it; chown unsupported
  const applyRemotePerms = async (profile, remoteDir, files = [], opts = {}) => {
    const proto = String(profile?.protocol||'sftp').toLowerCase();
    const fileMode = normalizeMode(opts.file_mode, null);
    const dirMode = normalizeMode(opts.dir_mode, null);
    const owner = (opts.owner != null) ? String(opts.owner) : '';
    const group = (opts.group != null) ? String(opts.group) : '';
    const recursive = !!opts.recursive;
    const result = { ok: true, proto, chmod: false, chown: false };
    try {
      if (proto === 'sftp') {
        let SFTPClient;
        try { ({ default: SFTPClient } = await import('ssh2-sftp-client')); } catch {
          try {
            const path = (await import('path')).default; const { createRequire } = await import('module');
            const req = createRequire(path.resolve(process.cwd(), 'backend', 'index.js'));
            SFTPClient = req('ssh2-sftp-client');
          } catch { chatLog?.('image_remote_missing_dep', { dep: 'ssh2-sftp-client' }); return { ok:false, error:'missing_dep_sftp' }; }
        }
        const cli = new SFTPClient();
        try {
          await cli.connect({ host: profile.host, port: Number(profile.port||22)||22, username: profile.username||undefined, password: profile.password||undefined });
          const filesPosix = files.map(f => path.posix.join(remoteDir.replace(/\\/g,'/'), f));
          // chmod directory
          if (dirMode != null) {
            try { await cli.chmod(remoteDir.replace(/\\/g,'/'), dirMode); result.chmod = true; } catch (e) { chatLog?.('image_remote_chmod_error', { protocol:'sftp', target: remoteDir, error: String(e?.message||e) }); result.ok = false; }
          }
          // chmod files
          if (fileMode != null) {
            for (const rp of filesPosix) {
              try { await cli.chmod(rp, fileMode); result.chmod = true; } catch (e) { chatLog?.('image_remote_chmod_error', { protocol:'sftp', target: rp, error: String(e?.message||e) }); result.ok = false; }
            }
          }
          await cli.end();
        } catch (e) { try { await cli.end(); } catch {} chatLog?.('image_remote_perms_error', { protocol:'sftp', error: String(e?.message||e) }); result.ok = false; }

        // chown via ssh2 (exec), optional
        if ((owner || group) && (profile.username || profile.password)) {
          try {
            let SSHClient;
            try { ({ Client: SSHClient } = await import('ssh2')); } catch {
              try {
                const path = (await import('path')).default; const { createRequire } = await import('module');
                const req = createRequire(path.resolve(process.cwd(), 'backend', 'index.js'));
                SSHClient = req('ssh2').Client;
              } catch { chatLog?.('image_remote_missing_dep', { dep: 'ssh2' }); SSHClient = null; }
            }
            if (SSHClient) {
              await new Promise((resolve) => {
                try {
                  const conn = new SSHClient();
                  conn.on('ready', () => {
                    const target = remoteDir.replace(/\\/g,'/');
                    const spec = `${owner || ''}${(owner && group) ? ':' : ''}${group || ''}`;
                    const cmd = `chown ${recursive? '-R ' : ''}${spec} ${target}`;
                    conn.exec(cmd, (err, stream) => {
                      if (err) { chatLog?.('image_remote_chown_error', { error: String(err?.message||err) }); try { conn.end(); } catch {}; return resolve(); }
                      stream.on('close', () => { try { conn.end(); } catch {}; result.chown = true; resolve(); });
                      stream.stderr.on('data', (d)=>{ chatLog?.('image_remote_chown_stderr', { data: String(d||'') }); });
                    });
                  }).on('error', (e) => { chatLog?.('image_remote_chown_error', { error: String(e?.message||e) }); resolve(); })
                  .connect({ host: profile.host, port: Number(profile.port||22)||22, username: profile.username, password: profile.password });
                } catch (e) { chatLog?.('image_remote_chown_error', { error: String(e?.message||e) }); resolve(); }
              });
            } else {
              chatLog?.('image_remote_chown_skipped', { reason: 'ssh2_missing' });
            }
          } catch (e) { chatLog?.('image_remote_chown_error', { error: String(e?.message||e) }); result.ok = false; }
        }
        return result;
      }

      // FTP branch
      let FtpClient;
      try { ({ default: FtpClient } = await import('basic-ftp')); } catch {
        try {
          const path = (await import('path')).default; const { createRequire } = await import('module');
          const req = createRequire(path.resolve(process.cwd(), 'backend', 'index.js'));
          FtpClient = req('basic-ftp');
        } catch { chatLog?.('image_remote_missing_dep', { dep: 'basic-ftp' }); return { ok:false, error:'missing_dep_ftp' }; }
      }
      const cli = new FtpClient.Client();
      try {
        await cli.access({ host: profile.host, port: Number(profile.port||21)||21, user: profile.username||undefined, password: profile.password||undefined, secure: false });
        // CHMOD via SITE CHMOD when supported
        if (dirMode != null) {
          try { await cli.send(`SITE CHMOD ${dirMode.toString(8)} ${remoteDir.replace(/\\/g,'/')}`); result.chmod = true; } catch (e) { chatLog?.('image_remote_chmod_error', { protocol:'ftp', target: remoteDir, error: String(e?.message||e) }); result.ok = false; }
        }
        if (fileMode != null) {
          for (const f of files) {
            const rp = path.posix.join(remoteDir.replace(/\\/g,'/'), f);
            try { await cli.send(`SITE CHMOD ${fileMode.toString(8)} ${rp}`); result.chmod = true; } catch (e) { chatLog?.('image_remote_chmod_error', { protocol:'ftp', target: rp, error: String(e?.message||e) }); result.ok = false; }
          }
        }
        // Owner/group not supported on plain FTP
        if (owner || group) chatLog?.('image_remote_chown_skipped', { protocol:'ftp', reason: 'unsupported' });
        await cli.close();
      } catch (e) { try { await cli.close(); } catch {}; chatLog?.('image_remote_perms_error', { protocol:'ftp', error: String(e?.message||e) }); result.ok = false; }
      return result;
    } catch (e) { return { ok:false, error:String(e?.message||e) }; }
  };

  if (!productId) return {};
  const IMAGE_SUMMARY = { remote: { used: false, protocol: null, ftp_profile_id: null, remote_dir: null, files_sent: 0 } };
  try {
    try { chatLog?.('image_pipeline_start', { run_id: run?.id, product_id: productId }); } catch {}
    // Simple counters for end-of-run summary
    let __urlsCount = 0;
    let __downloadsOk = 0;
    let __uploadedRemote = 0;
    let __copiedLocal = 0;
    // Early sharp status probe for quick diagnosis
    try {
      const probe = await ensureSharp();
      const versions = probe ? (probe.versions || probe.version || null) : null;
      chatLog?.('image_sharp_status', { run_id: run?.id, loaded: !!probe, versions });
    } catch { try { chatLog?.('image_sharp_status', { run_id: run?.id, loaded: false }); } catch {} }
    const T_IMAGE = PREFIX + 'image';
    const T_IMAGE_SHOP = PREFIX + 'image_shop';
    const T_IMAGE_LANG = PREFIX + 'image_lang';
    const hasImage = await hasTable(T_IMAGE);
    if (!hasImage) return;

    try { await ensureImageMapTable?.(); } catch {}

    const urls = [];
    try { if (Array.isArray(result.images)) for (const u of result.images) { const s=String(u||'').trim(); if (s) urls.push(s); } } catch {}
    try { const s = String(result.image||'').trim(); if (s) urls.unshift(s); } catch {}
    try { const jl = result?.json_ld?.raw?.image; if (Array.isArray(jl)) for (const it of jl) { const s = typeof it==='string'? it: (it&&it.url? it.url: ''); if (s) urls.push(String(s)); } } catch {}

    const uniq = Array.from(new Set(urls));
    try { __urlsCount = uniq.length; } catch {}
    try { chatLog?.('image_urls_collected', { run_id: run.id, count: uniq.length, sample: uniq.slice(0,5) }); } catch {}
    if (!uniq.length) return;

    // Image settings come from per-table special setting_image (preferred),
    // falling back to generic table settings if needed. Top-level mapping.image_setting
    // is merged upstream into TSET_ANY.image by the service.
    const TSET_IMAGE = (TSET_ANY && TSET_ANY['image']) || (TABLES.image && TABLES.image.settings) || {};
    // Allow disabling downloads entirely from UI
    if (TSET_IMAGE.download === false) {
      try { chatLog?.('image_download_disabled', { run_id: run.id, reason: 'setting_image.download=false' }); } catch {}
      return;
    }
    const coverStrategy = String(TSET_IMAGE.cover_strategy || 'first');
    // Shop fan-out for image_shop: enforce global SHOPS to match Mapping result
    const SHOPS_IMAGE = SHOPS;

    let basePos = 0;
    try { const r = await q(`SELECT MAX(${qi('position')}) AS m FROM ${qi(T_IMAGE)} WHERE ${qi('id_product')}=?`, [productId]); basePos = Number(r && r[0] && r[0].m || 0) || 0; } catch {}
    const keptImageIds = new Set();

    // Optional pre-prune: delete all existing images before processing when configured
    try {
      const prePrune = (String(TSET_IMAGE.sync_images || '').toLowerCase() === 'force') || (TSET_IMAGE.prune_before === true);
      if (prePrune) {
        const rowsAll = await q(`SELECT ${qi('id_image')} FROM ${qi(T_IMAGE)} WHERE ${qi('id_product')}=?`, [productId]);
        if (Array.isArray(rowsAll) && rowsAll.length) {
          chatLog?.('image_prune_before_start', { run_id: run.id, product_id: productId, count: rowsAll.length });
          let imgRoot = chooseImageRoot(TSET_IMAGE);
          for (const r of rowsAll) {
            const rmId = Number(r.id_image||0)||0; if (!rmId) continue;
            try {
              if (await hasTable(T_IMAGE_SHOP)) { try { await q(`DELETE FROM ${qi(T_IMAGE_SHOP)} WHERE ${qi('id_image')}=?`, [rmId]); } catch {} }
              if (await hasTable(T_IMAGE_LANG)) { try { await q(`DELETE FROM ${qi(T_IMAGE_LANG)} WHERE ${qi('id_image')}=?`, [rmId]); } catch {} }
              await q(`DELETE FROM ${qi(T_IMAGE)} WHERE ${qi('id_image')}=?`, [rmId]);
              chatLog?.('image_prune_before_db', { run_id: run.id, id_image: rmId });
              if (imgRoot) {
                try {
                  const folder = prestashopImageFolder(rmId);
                  const base = path.join(imgRoot, folder, String(rmId));
                  for (const ext of ['jpg','webp']) { try { fs.unlinkSync(`${base}.${ext}`); } catch {} }
                  try { const dir = path.dirname(base); const files = fs.readdirSync(dir); for (const f of files) { if (f.startsWith(`${rmId}-`) && (f.endsWith('.jpg')||f.endsWith('.webp'))) { try { fs.unlinkSync(path.join(dir, f)); } catch {} } } } catch {}
                  chatLog?.('image_prune_before_files', { run_id: run.id, id_image: rmId, base });
                } catch (e) { chatLog?.('image_prune_before_files_error', { run_id: run.id, id_image: rmId, error: String(e?.message||e) }); }
              }
            } catch (e) { chatLog?.('image_prune_before_error', { run_id: run.id, id_image: rmId, error: String(e?.message||e) }); }
          }
        }
      }
    } catch {}

    // Load product image types
    let imageTypes = [];
    try {
      const T_IT = PREFIX + 'image_type';
      if (await hasTable(T_IT)) {
        const rowsT = await q(`SELECT ${qi('name')} as name, ${qi('width')} as width, ${qi('height')} as height, ${qi('products')} as products FROM ${qi(T_IT)}`);
        try { chatLog?.('image_types_db', { table: T_IT, count: Array.isArray(rowsT)? rowsT.length : 0, sample: (Array.isArray(rowsT)? rowsT.slice(0,10) : []).map(r=>({ name: r.name, width: Number(r.width||0), height: Number(r.height||0), products: Number(r.products||0) })) }); } catch {}
        imageTypes = Array.isArray(rowsT) ? rowsT.filter(r => (Number(r.products||0) ? true : false)).map(r => ({ name: r.name, width: Number(r.width||0), height: Number(r.height||0) })) : [];
      }
    } catch {}
    try {
      const override = Array.isArray(TSET_IMAGE?.types_override) ? TSET_IMAGE.types_override : null;
      if ((!imageTypes || !imageTypes.length) && override && override.length) {
        imageTypes = override.map(t => ({ name: String(t.name||'').trim(), width: Number(t.width||0), height: Number(t.height||0) }))
                             .filter(t => t.name && (t.width>0 || t.height>0));
        chatLog?.('image_types_override_used', { run_id: run.id, items: imageTypes.map(t=>t.name) });
      }
    } catch {}
    try {
      if (imageTypes && imageTypes.length) chatLog?.('image_types_loaded', { run_id: run.id, items: imageTypes.map(t=>({ name: t.name, width: t.width, height: t.height })) });
      else chatLog?.('image_types_empty', { run_id: run.id });
    } catch {}

    // Determine languages for legend: always active ps_lang (no per-table overrides)
    let LANGS_IMG = [];
    try {
      const T_LANG = PREFIX + 'lang';
      if (await hasTable(T_LANG)) {
        const rowsL = await q(`SELECT ${'`id_lang`'} as id_lang FROM ${qi(T_LANG)} WHERE ${qi('active')}=1`);
        const ids = Array.isArray(rowsL) ? rowsL.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
        if (ids.length) LANGS_IMG = ids;
      }
    } catch {}
    if (!LANGS_IMG.length) LANGS_IMG = [ID_LANG];
    try { chatLog?.('image_config', { run_id: run.id, shops: SHOPS, langs: LANGS_IMG, settings: TSET_IMAGE }); } catch {}

    const seenContent = new Set();
    // Mapping for image_lang (legend) if provided
    const F_IMAGE_LANG = (TABLES && TABLES.image_lang && typeof TABLES.image_lang.fields==='object') ? TABLES.image_lang.fields : null;
    // Helpers to resolve mapping specs similar to product pipeline
    const src = (result && (result.product || result.item)) || result || {};
    const pickPath = (obj, pathStr) => {
      try {
        if (!pathStr) return undefined;
        const parts = String(pathStr).replace(/^\$\.?/, '').split('.');
        let cur = obj;
        for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
        return cur;
      } catch { return undefined; }
    };
    const pickFlex = (pathStr) => {
      if (!pathStr) return undefined;
      const s = String(pathStr).trim();
      if (s.startsWith('$.')) return pickPath(result, s.slice(2));
      if (s.startsWith('product.')) return pickPath(src, s.slice('product.'.length));
      if (s.startsWith('item.')) return pickPath(src, s.slice('item.'.length));
      if (s.startsWith('meta.')) return pickPath(result, s);
      let v = pickPath(src, s); if (v === undefined || v === null || v === '') v = pickPath(result, s); return v;
    };
    const applyTransforms = (val, transforms=[]) => {
      try {
        let out = val;
        for (const t of (Array.isArray(transforms)? transforms: [])) {
          const op = String(t?.op||'').toLowerCase();
          if (op === 'trim') { out = (out==null? '': String(out)).trim(); continue; }
          if (op === 'replace') {
            const find = String(t?.find||''); const rep = String(t?.replace||'');
            out = String(out==null? '': out).split(find).join(rep);
            continue;
          }
          if (op === 'strip_html') {
            try { const s = String(out==null? '': out); out = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); } catch {}
            continue;
          }
          if (op === 'truncate') {
            const n = Number(t?.len||t?.n||t?.max||0) || 0;
            if (n > 0) { try { const s = String(out==null? '': out); out = s.length>n ? s.slice(0,n) : s; } catch {} }
            continue;
          }
        }
        return out;
      } catch { return val; }
    };
    const resolveSpec = (spec) => {
      if (spec == null) return undefined;
      if (Array.isArray(spec)) { for (const s of spec) { const v = resolveSpec(s); if (v !== undefined && v !== null && v !== '') return v; } return undefined; }
      if (typeof spec === 'object') {
        const paths = Array.isArray(spec.paths) ? spec.paths : (spec.path ? [spec.path] : []);
        let v;
        for (const p of paths) { const tmp = pickFlex(p); if (tmp !== undefined && tmp !== null && tmp !== '') { v = tmp; break; } }
        if (v === undefined) v = pickFlex(spec.path || spec.p || '');
        return applyTransforms(v, spec.transforms || spec.ops || []);
      }
      if (typeof spec === 'string') return pickFlex(spec);
      return spec;
    };
    for (let i=0;i<uniq.length;i++) {
      const position = basePos + i + 1;
      let isCover = (coverStrategy === 'first' && i === 0) ? 1 : 0;
      const url = uniq[i];
      try {
        try { chatLog?.('image_process_start', { run_id: run.id, product_id: productId, index: i, position, url, cover: isCover }); } catch {}
        const stagingRoot = getStagingRoot(String(TSET_IMAGE.staging_root||''));
        const rawRoot = getRawDownloadDir(String(TSET_IMAGE.staging_root||''));
        const rawDir = path.join(rawRoot, String(productId));
        const urlHash = createHash('sha1').update(String(url)).digest('hex');
        const tmpNaming = (TSET_IMAGE && TSET_IMAGE.tmp_naming) ? String(TSET_IMAGE.tmp_naming) : 'json';
        let tmpSrc = path.join(rawDir, `${urlHash}.jpg`);
        try { fs.mkdirSync(path.dirname(tmpSrc), { recursive: true }); } catch{}
        if (tmpNaming === 'json') {
          try {
            const u = new URL(String(url));
            const base = decodeURIComponent(u.pathname || '').split('/').pop() || '';
            let safe = sanitizeFilename(base, `${urlHash}.jpg`);
            if (!/\.(jpe?g|png|webp)$/i.test(safe)) safe = `${safe}.jpg`;
            tmpSrc = path.join(rawDir, safe);
          } catch {}
        }
        const ref = (run && run.url) ? String(run.url) : (domain ? `https://${domain}` : undefined);
        const headers = ref ? { Referer: ref } : {};
        const dl = await downloadToFileWithHash(url, tmpSrc, Number(TSET_IMAGE.timeout_ms||20000), headers);
        const contentSha1 = String(dl && dl.sha1 || '');
        try { chatLog?.('image_download_ok', { run_id: run.id, raw: tmpSrc, raw_dir: rawDir, id_product: productId, sha1: contentSha1, bytes: dl?.bytes || null }); } catch {}
        try { __downloadsOk++; } catch {}
        if (!contentSha1) throw new Error('empty_sha1');
        if (seenContent.has(contentSha1)) { chatLog?.('image_skip_dupcontent', { run_id: run.id, position, url }); continue; }
        seenContent.add(contentSha1);

        // Resolve reuse vs insert
        const overwriteExisting = !!TSET_IMAGE.overwrite_existing;
        let id_image = 0;
        let reused = false;
        try {
          // Try reuse by content or URL hash from previous runs for this product/domain
          let idFromMap = 0;
          try {
            const rmap = await pool.query(`SELECT id_image FROM public.mod_grabbing_sensorex_image_map WHERE domain=$1 AND product_id=$2 AND (content_sha1=$3 OR url_hash=$4) ORDER BY created_at DESC LIMIT 1`, [domain, productId, contentSha1, urlHash]);
            idFromMap = (rmap.rowCount && rmap.rows[0]?.id_image) ? Number(rmap.rows[0].id_image||0) : 0;
          } catch {}
          if (idFromMap > 0) {
            id_image = idFromMap;
            reused = true;
            keptImageIds.add(id_image);
            // Update position if column exists to reflect latest order
            try {
              if (await hasColumn(T_IMAGE, 'position')) {
                await q(`UPDATE ${qi(T_IMAGE)} SET ${qi('position')}=? WHERE ${qi('id_image')}=?`, [position, id_image]);
                try { await pool.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [run.id||null, domain||null, run?.page_type||null, T_IMAGE, productId||null, null, null, null, 'position', String(position)]); } catch {}
              }
            } catch {}
            chatLog?.('image_reuse', { run_id: run.id, id_image, position, overwrite: overwriteExisting });
          } else {
            // Insert new ps_image row
            const colsI = ['id_product','position']; const argsI = [productId, position];
            if (isCover === 1 && await hasColumn(T_IMAGE, 'cover')) {
              const existsCover = await q(`SELECT ${qi('id_image')} FROM ${qi(T_IMAGE)} WHERE ${qi('id_product')}=? AND ${qi('cover')}=1 LIMIT 1`, [productId]);
              if (!Array.isArray(existsCover) || !existsCover.length) { colsI.push('cover'); argsI.push(1); }
            }
            const sqlI = `INSERT INTO ${qi(T_IMAGE)} (${colsI.map(c=>qi(c)).join(',')}) VALUES (${colsI.map(()=>'?').join(',')})`;
            await q(sqlI, argsI);
            const ir = await q('SELECT LAST_INSERT_ID() AS id');
            id_image = Number((ir && ir[0] && ir[0].id) || 0) || 0;
            if (!id_image) throw new Error('no_id_image');
            try {
              await pool.query(`INSERT INTO public.mod_grabbing_sensorex_image_map(domain,product_id,source_url,url_hash,content_sha1,id_image) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (domain,product_id,content_sha1) DO UPDATE SET id_image=EXCLUDED.id_image`, [domain, productId, url, urlHash, contentSha1, id_image]);
              chatLog?.('image_dedupe_map', { run_id: run.id, id_image, sha1: contentSha1, url_hash: urlHash });
            } catch {}
            // Mark newly inserted image as kept so sync can prune old ones
            try { keptImageIds.add(id_image); } catch {}
            // Aggregate success counter for ps_image insert
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                 on conflict (run_id, table_name, op, id_shop, id_lang)
                 do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                [ run.id||null, domain||null, run?.page_type||null, T_IMAGE, 'insert', productId||null, null, null, JSON.stringify({}) ]
              );
            } catch {}
            // Per-field upsert logs for ps_image insert
            try {
              const rmap = Object.fromEntries(colsI.map((c,i)=>[c, argsI[i]]));
              for (const [k,v] of Object.entries(rmap)) {
                try { await pool.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [run.id||null, domain||null, run?.page_type||null, T_IMAGE, productId||null, null, null, null, String(k), (v==null? null : String(v))]); } catch {}
              }
            } catch {}
          }
        } catch (e) {
          chatLog?.('image_insert_error', { run_id: run.id, error: String(e?.message||e) });
          try {
            await pool.query(
              `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
              [run.id||null, domain||null, run?.page_type||null, T_IMAGE, 'insert', productId||null, String(e?.message||e), JSON.stringify({ url, position })]
            );
          } catch {}
          continue;
        }

        // Stage and write variants (always to staging folder)
        try {
          const stageDir = path.join(getStagingRoot(String(TSET_IMAGE.staging_root||'')), prestashopImageFolder(id_image));
          try { fs.mkdirSync(stageDir, { recursive: true }); } catch {}
          const stageBase = path.join(stageDir, `${id_image}`);
          const stageCanon = `${stageBase}.jpg`;
          const sharp = await ensureSharp();
          if (sharp) { try { await (sharp(tmpSrc)).jpeg({ quality: 90 }).toFile(stageCanon); } catch (e) { chatLog?.('image_stage_canon_error', { run_id: run.id, error: String(e?.message||e) }); } } else { try { fs.copyFileSync(tmpSrc, stageCanon); } catch (e) { chatLog?.('image_stage_copy_error', { run_id: run.id, error: String(e?.message||e) }); } }
          const conv = await convertAndWriteVariants(tmpSrc, stageBase, imageTypes || [], chatLog);
          if (!conv?.ok) { try { chatLog?.('image_stage_variants_error', { run_id: run.id, error: conv?.error || 'unknown' }); } catch {} }
          try {
            const files = (()=>{ try { return fs.readdirSync(stageDir).filter(f => f.startsWith(`${id_image}`)); } catch { return []; } })();
            chatLog?.('image_stage_done', { run_id: run.id, id_image, stage_dir: stageDir, types_count: (conv?.items||[]).length, files: files.slice(0, 30) });
          } catch {}
        } catch (e) { chatLog?.('image_stage_error', { run_id: run.id, error: String(e?.message||e) }); }

        // Copy files to img_root (only when newly inserted or overwrite enabled)
        try {
          const shouldCopy = !reused || overwriteExisting;
          if (!shouldCopy) {
            try {
              let imgRoot = String(TSET_IMAGE.img_root || '').trim();
              const folder = prestashopImageFolder(id_image);
              const destDir = imgRoot ? path.join(imgRoot, folder) : null;
              let existing = [];
              try { if (destDir) existing = (fs.readdirSync(destDir)||[]).filter(f => f.startsWith(`${id_image}`)); } catch {}
              chatLog?.('image_skip_copy', { run_id: run.id, id_image, dest_dir_hint: destDir || null, existing_files: existing.slice(0, 10) });
            } catch {}
          }
          if (shouldCopy) {
            let imgRoot = String(TSET_IMAGE.img_root || '').trim();
            if (!imgRoot) {
              chatLog?.('image_root_missing', { run_id: run.id, note: 'mapping.image_setting.img_root required; no fallback to domain' });
              try { await pool.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run.id, domain, run.page_type, T_IMAGE, 'copy', productId, 'image_root_missing', JSON.stringify({ hint: 'set mapping.image_setting.img_root' })]); } catch {}
              return; // stop copy when no root configured
            }
            const folder = prestashopImageFolder(id_image);
            const stagingRoot = getStagingRoot(String(TSET_IMAGE.staging_root||''));
            const destDir = imgRoot ? path.join(imgRoot, folder) : '';
            const destBase = destDir ? path.join(destDir, String(id_image)) : '';
            try { chatLog?.('image_paths_resolved', { run_id: run.id, id_image, img_root: imgRoot||null, folder, staging_root: stagingRoot, dest_dir: destDir||null, dest_base: destBase||null }); } catch {}
            if (imgRoot) {
              const stageDir = path.join(stagingRoot, folder);
              const stageFiles = (function(){ try { return fs.readdirSync(stageDir).filter(f => f===`${id_image}.jpg` || (f.startsWith(`${id_image}-`) && (f.endsWith('.jpg')||f.endsWith('.webp')))); } catch { return []; } })();
              // Remote upload when ftp_profile_id is provided; else local copy
              const ftpProfileId = TSET_IMAGE?.ftp_profile_id ? Number(TSET_IMAGE.ftp_profile_id)||0 : 0;
              if (ftpProfileId > 0) {
                const prof = await resolveFtpProfile(ftpProfileId);
                if (prof && prof.host) {
                  const remoteDir = path.posix.join(String(imgRoot).replace(/\\/g,'/'), folder.replace(/\\/g,'/'));
                  const up = await uploadRemoteFiles(prof, stageDir, remoteDir, stageFiles);
                  try {
                    // Mark attempt and surface result
                    IMAGE_SUMMARY.remote.used = true;
                    IMAGE_SUMMARY.remote.protocol = (up?.protocol||prof?.protocol||'').toLowerCase() || null;
                    IMAGE_SUMMARY.remote.ftp_profile_id = Number(ftpProfileId)||null;
                    IMAGE_SUMMARY.remote.remote_dir = remoteDir;
                  if (up && up.ok) {
                    chatLog?.('image_remote_upload_done', { run_id: run.id, id_image, remote_dir: remoteDir, protocol: up?.protocol||prof?.protocol||null, files: stageFiles.slice(0,30) });
                    IMAGE_SUMMARY.remote.files_sent += Array.isArray(stageFiles)? stageFiles.length : 0;
                    try { __uploadedRemote++; } catch {}
                    // Remote perms/ownership (optional)
                    try {
                      const wantPerms = (TSET_IMAGE.remote_set_perms === true);
                      if (wantPerms) {
                        const timeoutMs = Number(TSET_IMAGE.remote_perms_timeout_ms || 8000);
                        const permsPromise = applyRemotePerms(prof, remoteDir, stageFiles, {
                          file_mode: (TSET_IMAGE.remote_file_mode != null ? TSET_IMAGE.remote_file_mode : TSET_IMAGE.file_mode),
                          dir_mode: (TSET_IMAGE.remote_dir_mode != null ? TSET_IMAGE.remote_dir_mode : TSET_IMAGE.dir_mode),
                          owner: (TSET_IMAGE.remote_owner != null ? TSET_IMAGE.remote_owner : TSET_IMAGE.owner),
                          group: (TSET_IMAGE.remote_group != null ? TSET_IMAGE.remote_group : TSET_IMAGE.group),
                          recursive: !!TSET_IMAGE.remote_recursive,
                        });
                        const permsRes = await Promise.race([
                          permsPromise,
                          new Promise((resolve) => setTimeout(() => resolve({ ok:false, error:'timeout' }), timeoutMs))
                        ]);
                        if (permsRes && permsRes.ok) {
                          chatLog?.('image_remote_perms_applied', { run_id: run.id, id_image, proto: permsRes.proto, chmod: permsRes.chmod, chown: permsRes.chown });
                          try { IMAGE_SUMMARY.remote.perms = { ok:true, chmod: !!permsRes.chmod, chown: !!permsRes.chown }; } catch {}
                        } else {
                          chatLog?.('image_remote_perms_failed', { run_id: run.id, id_image, error: String(permsRes?.error||'failed'), timeout_ms: timeoutMs });
                          try { IMAGE_SUMMARY.remote.perms = { ok:false, error: String(permsRes?.error||'failed') }; } catch {}
                        }
                      }
                    } catch (e) { chatLog?.('image_remote_perms_error', { run_id: run.id, id_image, error: String(e?.message||e) }); }
                  } else {
                    const err = String(up?.error || 'upload_failed');
                    chatLog?.('image_remote_upload_error', { run_id: run.id, id_image, remote_dir: remoteDir, protocol: up?.protocol||prof?.protocol||null, error: err });
                    IMAGE_SUMMARY.remote.error = err;
                  }
                  } catch {}
                } else {
                  chatLog?.('image_remote_profile_missing', { run_id: run.id, id_image, ftp_profile_id: ftpProfileId });
                }
              } else {
                try { fs.mkdirSync(destDir, { recursive: true }); } catch {}
                const base = destBase;
                try { fs.copyFileSync(path.join(stageDir, `${id_image}.jpg`), `${base}.jpg`); } catch {}
                try {
                  for (const f of stageFiles) { try { fs.copyFileSync(path.join(stageDir, f), path.join(imgRoot, folder, f)); } catch {} }
                } catch {}
                try { chatLog?.('image_copy_done', { run_id: run.id, id_image, dest_dir: destDir, dest_base: destBase, files: (function(){ try { return fs.readdirSync(destDir).filter(f => f===`${id_image}.jpg` || (f.startsWith(`${id_image}-`) && (f.endsWith('.jpg')||f.endsWith('.webp')))).slice(0, 30); } catch { return []; } })() }); } catch {}
                try { __copiedLocal++; } catch {}
              }

              // Permissions and ownership (optional; configurable)
              try {
                const wantPerms = (TSET_IMAGE.set_perms === undefined) ? true : !!TSET_IMAGE.set_perms;
                if (wantPerms) {
                  if (TSET_IMAGE?.ftp_profile_id) {
                    // Remote perms handled after upload via applyRemotePerms
                    chatLog?.('image_perms_skipped', { reason: 'remote_target' });
                  } else {
                    const fileMode = normalizeMode(TSET_IMAGE.file_mode, 0o644);
                    const dirMode = normalizeMode(TSET_IMAGE.dir_mode, 0o755);
                    // Default to www-data owner/group if not provided, allow env overrides
                    const owner = String(TSET_IMAGE.owner || process.env.PRESTA_IMG_OWNER || 'www-data').trim();
                    const group = String(TSET_IMAGE.group || process.env.PRESTA_IMG_GROUP || 'www-data').trim();
                    const dirPath = destDir;
                    try { fs.chmodSync(dirPath, dirMode); } catch {}
                    // Also chown the directory so it matches expected ownership (e.g., www-data:www-data)
                    try {
                      if (owner || group) {
                        // Skip on Windows where chown is unavailable
                        if (process.platform !== 'win32') {
                          await exec(`chown ${owner || ''}${owner && group ? ':' : ''}${group || ''} ${dirPath}`);
                        }
                      }
                    } catch {}
                    const writtenFiles = fs.readdirSync(dirPath).filter(f => f === `${id_image}.jpg` || (f.startsWith(`${id_image}-`) && (f.endsWith('.jpg') || f.endsWith('.webp'))));
                    for (const f of writtenFiles) {
                      const p = path.join(dirPath, f);
                      try { fs.chmodSync(p, fileMode); } catch {}
                      if (owner || group) {
                        try {
                          if (process.platform !== 'win32') {
                            await exec(`chown ${owner || ''}${owner && group ? ':' : ''}${group || ''} ${p}`);
                          }
                        } catch {}
                      }
                    }
                    chatLog?.('image_perms_set', { run_id: run.id, id_image, owner: owner||null, group: group||null, file_mode: fileMode, dir_mode: dirMode, dest_dir: dirPath, files: writtenFiles.slice(0, 20) });
                  }
                }
              } catch (e) { chatLog?.('image_perms_error', { run_id: run.id, id_image, error: String(e?.message||e) }); }
            }
          }
        } catch (e) { chatLog?.('image_copy_error', { run_id: run.id, error: String(e?.message||e) }); }

        // Shop/lang rows
        try {
          if (await hasTable(T_IMAGE_SHOP)) {
            for (const SID of SHOPS_IMAGE) {
              try {
                const colsS = ['id_image','id_shop']; const argsS = [id_image, SID]; const updS = [];
                const coverShop = (isCover === 1) ? 1 : 0;
                if (coverShop && await hasColumn(T_IMAGE_SHOP, 'cover')) {
                  const hasCoverShop = await q(
                    `SELECT 1 FROM ${qi(T_IMAGE_SHOP)} s JOIN ${qi(T_IMAGE)} i ON i.${qi('id_image')}=s.${qi('id_image')} WHERE s.${qi('id_shop')}=? AND s.${qi('cover')}=1 AND i.${qi('id_product')}=? LIMIT 1`,
                    [SID, productId]
                  );
                  if (!Array.isArray(hasCoverShop) || !hasCoverShop.length) { colsS.push('cover'); argsS.push(1); updS.push(`${qi('cover')}=VALUES(${qi('cover')})`); }
                }
                if (await hasColumn(T_IMAGE_SHOP, 'id_product')) { colsS.push('id_product'); argsS.push(productId); }
                if (await hasColumn(T_IMAGE_SHOP, 'position')) { colsS.push('position'); argsS.push(position); }
                const updClause = updS.length ? updS.join(', ') : `${qi('id_shop')}=${qi('id_shop')}`;
                const sqlS = `INSERT INTO ${qi(T_IMAGE_SHOP)} (${colsS.map(c=>qi(c)).join(',')}) VALUES (${colsS.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${updClause}`;
                await q(sqlS, argsS);
                chatLog?.('image_shop_upsert', { run_id: run.id, id_image, id_shop: SID, cover: coverShop });
                try {
                  await pool?.query(
                    `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                     on conflict (run_id, table_name, op, id_shop, id_lang)
                     do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                    [ run.id||null, domain||null, run?.page_type||null, T_IMAGE_SHOP, 'upsert', productId||null, SID||null, null, JSON.stringify({}) ]
                  );
                } catch {}
                // Per-field logs for ps_image_shop
                try {
                  const rmapS = Object.fromEntries(colsS.map((c,i)=>[c, argsS[i]]));
                  for (const [k,v] of Object.entries(rmapS)) {
                    try { await pool.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [run.id||null, domain||null, run?.page_type||null, T_IMAGE_SHOP, productId||null, SID||null, null, null, String(k), (v==null? null : String(v))]); } catch {}
                  }
                } catch {}
              } catch (e) { try { await pool.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [run.id, domain, run.page_type, T_IMAGE_SHOP, 'upsert', productId, SID, String(e?.message||e), JSON.stringify({ id_image, cover:coverShop, position })]); } catch {} }
            }
          }
          if (await hasTable(T_IMAGE_LANG)) {
            for (const L of LANGS_IMG) {
              try {
                const colsL = ['id_image','id_lang']; let argsL = [id_image, L]; const updL = [];
                if (await hasColumn(T_IMAGE_LANG, 'legend')) {
                  // Resolve legend from mapping when provided; fallback to product/name/title
                  let legend = '';
                  try {
                    if (F_IMAGE_LANG && Object.prototype.hasOwnProperty.call(F_IMAGE_LANG,'legend')) {
                      const v = resolveSpec(F_IMAGE_LANG.legend);
                      legend = (v == null) ? '' : String(v);
                    } else {
                      legend = String((src?.name) || (result?.title) || (result?.name) || '');
                    }
                  } catch { legend = String((src?.name) || (result?.title) || (result?.name) || ''); }
                  // Determine max length via MySQL metadata and truncate legend if needed
                  try {
                    const rows = await q('SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [T_IMAGE_LANG, 'legend']);
                    const max = Array.isArray(rows)&&rows.length ? (Number(rows[0].max_len||0)||0) : 0;
                    if (max && legend.length>max) {
                      const before = legend; legend = before.slice(0,max);
                      try { await pool.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [run.id, domain, run.page_type, T_IMAGE_LANG, 'truncate', productId, L, 'truncated', JSON.stringify({ column:'legend', max_len: max, before_len: before.length, after_len: legend.length })]); } catch {}
                      try { chatLog?.('truncate', { table: T_IMAGE_LANG, col: 'legend', max, before_len: before.length, after_len: legend.length }); } catch {}
                    }
                  } catch {}
                  colsL.push('legend'); argsL.push(legend); updL.push(`${qi('legend')}=VALUES(${qi('legend')})`);
                }
                const sqlL = `INSERT INTO ${qi(T_IMAGE_LANG)} (${colsL.map(c=>qi(c)).join(',')}) VALUES (${colsL.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${updL.join(', ')}`;
                await q(sqlL, argsL);
                chatLog?.('image_lang_upsert', { run_id: run.id, id_image, id_lang: L });
                try {
                  await pool?.query(
                    `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                     on conflict (run_id, table_name, op, id_shop, id_lang)
                     do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                    [ run.id||null, domain||null, run?.page_type||null, T_IMAGE_LANG, 'upsert', productId||null, null, L||null, JSON.stringify({}) ]
                  );
                } catch {}
                // Per-field logs for ps_image_lang
                try {
                  const rmapL = Object.fromEntries(colsL.map((c,i)=>[c, argsL[i]]));
                  for (const [k,v] of Object.entries(rmapL)) {
                    try { await pool.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [run.id||null, domain||null, run?.page_type||null, T_IMAGE_LANG, productId||null, null, L||null, null, String(k), (v==null? null : String(v))]); } catch {}
                  }
                } catch {}
              } catch (e) { try { await pool.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [run.id, domain, run.page_type, T_IMAGE_LANG, 'upsert', productId, L, String(e?.message||e), JSON.stringify({ id_image, legend: String((result?.name)||'') })]); } catch {} }
            }
          }
        } catch {}
      } catch (e) {
        chatLog?.('image_download_error', { run_id: run.id, url, error: String(e?.message||e) });
        try { await pool.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run.id, domain, run.page_type, T_IMAGE, 'download', productId, String(e?.message||e), JSON.stringify({ url })]); } catch {}
      }
    }

    // Optional: regenerate thumbnails via Presta console for this product
    try {
      const regenThumbs = (TSET_IMAGE.generate_thumbs === undefined) ? true : !!TSET_IMAGE.generate_thumbs;
      if (regenThumbs) {
        let php = String(TSET_IMAGE.php_bin || 'php');
        let binConsole = String(TSET_IMAGE.bin_console || '') || '';
        // Normalize accidental "php bin/console" entered into bin_console field
        try {
          const m = binConsole.match(/^\s*(php(?:\.exe)?|\/[\w\/.\-]+php(?:\.exe)?)\s+(.+)$/i);
          if (m && m[1] && m[2]) { php = m[1]; binConsole = m[2]; }
        } catch {}
        let prestaRoot = String(process.env.PRESTA_ROOT || '').trim();
        // Fallback: derive Presta root from img_root when available (…/img/p -> …/)
        if (!binConsole && !prestaRoot) {
          try {
            const imgRootGuess = chooseImageRoot(TSET_IMAGE);
            if (imgRootGuess) {
              const tail = path.join('img','p');
              if (imgRootGuess.endsWith(tail)) prestaRoot = path.resolve(imgRootGuess, '..', '..');
            }
          } catch {}
        }

        const timeoutMs = Number(TSET_IMAGE.console_timeout_ms||60000);
        const runCmd = async (cmd, opts) => {
          try {
            const { stdout, stderr } = await exec(cmd, { timeout: timeoutMs, ...opts });
            chatLog?.('image_regen', { cmd, stdout: (stdout||'').slice(0,200), stderr: (stderr||'').slice(0,200) });
          } catch (e) {
            const msg = (e && e.stderr) ? String(e.stderr) : String(e?.message||e);
            chatLog?.('image_regen', { cmd, stdout: '', stderr: (msg||'').slice(0,200) });
          }
          return true;
        };

        // Detect available console commands and auto-skip when missing
        const detectAndRun = async (mode) => {
          let listCmd = '';
          let runOpts = {};
          if (mode === 'bin_console' && binConsole) {
            listCmd = `${php} ${binConsole} list --raw`;
          } else if (mode === 'cwd' && prestaRoot) {
            listCmd = `${php} bin/console list --raw`;
            runOpts = { cwd: prestaRoot };
          }
          if (!listCmd) return { ok: false, reason: 'no_console_path' };
          let out = '';
          try {
            const res = await exec(listCmd, { timeout: timeoutMs, ...runOpts });
            out = String(res?.stdout||'');
          } catch (e) {
            chatLog?.('image_regen_skipped', { reason: 'console_list_failed', message: String(e?.message||e) });
            return { ok: false, reason: 'console_list_failed' };
          }
          const cmds = new Set(out.split(/\r?\n/).map(l => l.trim().split(/[ \t]/)[0]).filter(Boolean));
          chatLog?.('image_regen_detect', { mode, sample: Array.from(cmds).slice(0, 10) });
          const choices = [ 'prestashop:image:regenerate', 'prestashop:images:regenerate' ];
          const found = choices.find(c => cmds.has(c));
          if (!found) {
            chatLog?.('image_regen_skipped', { reason: 'command_not_found', mode, hint: 'no prestashop:image[:s]:regenerate in console list' });
            return { ok: false, reason: 'command_not_found' };
          }
          chatLog?.('image_regen_start', mode === 'bin_console' ? { mode, php, bin_console: binConsole, product_id: productId } : { mode, php, cwd: prestaRoot, product_id: productId });
          const full = `${mode==='bin_console' ? `${php} ${binConsole}` : `${php} bin/console`} ${found} --type=products --products=${productId}`;
          await runCmd(full, runOpts);
          return { ok: true };
        };

        if (binConsole) {
          const r = await detectAndRun('bin_console');
          if (!r.ok && prestaRoot) await detectAndRun('cwd');
          if (!r.ok && !prestaRoot) chatLog?.('image_regen_skipped', { reason: 'no_bin_console_and_no_presta_root' });
        } else if (prestaRoot) {
          await detectAndRun('cwd');
        } else {
          chatLog?.('image_regen_skipped', { reason: 'no_bin_console_and_no_presta_root', note: 'set setting_image.bin_console or PRESTA_ROOT env or ensure img_root is set' });
        }
      } else {
        chatLog?.('image_regen_skipped', { reason: 'generate_thumbs_disabled' });
      }
    } catch (e) { chatLog?.('image_regen_error', { run_id: run.id, error: String(e?.message||e) }); }

    // Optional: sync images (remove DB/files not present in this run)
    try {
      const wantSync = !!TSET_IMAGE.sync_images;
      if (wantSync && keptImageIds.size) {
        const rowsAll = await q(`SELECT ${qi('id_image')} FROM ${qi(T_IMAGE)} WHERE ${qi('id_product')}=?`, [productId]);
        const toDelete = [];
        for (const r of (rowsAll||[])) { const id = Number(r.id_image||0)||0; if (id && !keptImageIds.has(id)) toDelete.push(id); }
        if (toDelete.length) {
          chatLog?.('image_sync_start', { run_id: run.id, product_id: productId, delete_count: toDelete.length });
          let imgRoot = String(TSET_IMAGE.img_root || '').trim();
          for (const rmId of toDelete) {
            try {
              if (await hasTable(T_IMAGE_SHOP)) { try { await q(`DELETE FROM ${qi(T_IMAGE_SHOP)} WHERE ${qi('id_image')}=?`, [rmId]); } catch {} }
              if (await hasTable(T_IMAGE_LANG)) { try { await q(`DELETE FROM ${qi(T_IMAGE_LANG)} WHERE ${qi('id_image')}=?`, [rmId]); } catch {} }
              await q(`DELETE FROM ${qi(T_IMAGE)} WHERE ${qi('id_image')}=?`, [rmId]);
              chatLog?.('image_delete_db', { run_id: run.id, id_image: rmId });
              if (imgRoot) {
                try {
                  const folder = prestashopImageFolder(rmId);
                  const base = path.join(imgRoot, folder, String(rmId));
                  for (const ext of ['jpg','webp']) { try { fs.unlinkSync(`${base}.${ext}`); } catch {} }
                  try { const dir = path.dirname(base); const files = fs.readdirSync(dir); for (const f of files) { if (f.startsWith(`${rmId}-`) && (f.endsWith('.jpg')||f.endsWith('.webp'))) { try { fs.unlinkSync(path.join(dir, f)); } catch {} } } } catch {}
                  chatLog?.('image_delete_files', { run_id: run.id, id_image: rmId, base });
                } catch (e) { chatLog?.('image_delete_files_error', { run_id: run.id, id_image: rmId, error: String(e?.message||e) }); }
              }
            } catch (e) { chatLog?.('image_delete_error', { run_id: run.id, id_image: rmId, error: String(e?.message||e) }); }
          }
        }
      }
    } catch (e) { chatLog?.('image_sync_error', { run_id: run.id, error: String(e?.message||e) }); }
    try {
      chatLog?.('image_pipeline_end', { run_id: run?.id, product_id: productId });
      const uniqueCount = (function(){ try { return seenContent ? seenContent.size : 0; } catch { return 0; } })();
      chatLog?.('image_processed_count', {
        run_id: run?.id,
        product_id: productId,
        urls: __urlsCount,
        downloads_ok: __downloadsOk,
        unique: uniqueCount,
        upload_remote_sets: __uploadedRemote,
        copy_local_sets: __copiedLocal
      });
    } catch {}
    return IMAGE_SUMMARY;
  } catch (e) {
    throw e;
  }
}

export default runImagesPipeline;
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                 on conflict (run_id, table_name, op, id_shop, id_lang)
                 do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                [ run.id||null, domain||null, run?.page_type||null, T_IMAGE, 'insert', productId||null, null, null, JSON.stringify({}) ]
              );
            } catch {}
