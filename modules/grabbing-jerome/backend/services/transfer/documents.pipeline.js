// Documents pipeline: creates ps_attachment(+_lang/+_shop) and ps_product_attachment
// Downloads files to Presta download dir and links them to the product.
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { sanitizeFilename, getStagingRoot, downloadToFileWithHash } from '../../utils/image.utils.js';

function chooseDownloadRoot(TSET_DOC = {}) {
  try {
    const fromSetting = String(TSET_DOC.download_dir || '').trim();
    if (fromSetting) return fromSetting;
    const cand1 = '/var/www/html/3dtisk5/download';
    const cand2 = '/var/www/prestashop/download';
    if (fs.existsSync(cand1)) return cand1;
    if (fs.existsSync(cand2)) return cand2;
    const prestaRoot = String(process.env.PRESTA_ROOT || '').trim();
    if (prestaRoot) return path.join(prestaRoot, 'download');
  } catch {}
  return '';
}

function guessMime(fileName = '') {
  const s = String(fileName||'').toLowerCase();
  if (s.endsWith('.pdf')) return 'application/pdf';
  if (s.endsWith('.doc') || s.endsWith('.docx')) return 'application/msword';
  if (s.endsWith('.xls') || s.endsWith('.xlsx')) return 'application/vnd.ms-excel';
  if (s.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

export async function runDocumentsPipeline(ctx = {}) {
  const {
    q, qi, hasTable, hasColumn,
    chatLog, pool, run, result = {},
    productId, PREFIX,
    TSET_ANY = {}, TABLES = {},
    SHOPS = [], ID_LANG = 1,
    fmtDateTime,
    domain,
  } = ctx;

  try {
    if (!productId) return;
    const docs = Array.isArray(result.documents) ? result.documents.map(u=>String(u||'').trim()).filter(Boolean) : [];
    if (!docs.length) return;

    const T_ATTACHMENT = PREFIX + 'attachment';
    const T_ATTACHMENT_LANG = PREFIX + 'attachment_lang';
    const T_ATTACHMENT_SHOP = PREFIX + 'attachment_shop';
    const T_PRODUCT_ATTACHMENT = PREFIX + 'product_attachment';
    if (!(await hasTable(T_ATTACHMENT))) return;

    const TSET_DOC = (TSET_ANY && TSET_ANY['document']) || (TABLES?.document?.settings) || {};
    const downloadRoot = chooseDownloadRoot(TSET_DOC);
    if (!downloadRoot) { try { chatLog?.('docs_skip_no_dir', { run_id: run?.id, count: docs.length }); } catch {} return; }

    const nowFmt = fmtDateTime ? fmtDateTime(new Date()) : new Date().toISOString().replace('T',' ').slice(0,19);
    const stagingRoot = getStagingRoot(String(TSET_DOC.staging_root||''));
    const productStagingDir = path.join(stagingRoot, 'product_attachments', String(productId||'0'));
    try { fs.mkdirSync(productStagingDir, { recursive: true }); } catch {}

    // Collect active languages for attachment_lang (mirror images pipeline)
    let LANGS_DOC = [ID_LANG];
    try {
      const T_LANG = PREFIX + 'lang';
      const [exists] = await q('SELECT 1 as ok FROM information_schema.TABLES WHERE TABLE_NAME=? LIMIT 1', [T_LANG]);
      if (exists) {
        const rowsL = await q(`SELECT ${'`id_lang`'} as id_lang FROM ${qi(T_LANG)} WHERE ${qi('active')}=1`);
        const ids = Array.isArray(rowsL) ? rowsL.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
        if (ids.length) LANGS_DOC = ids;
      }
    } catch {}

    for (const url of docs) {
      try {
        const urlHash = createHash('sha1').update(String(url)).digest('hex');
        // Prefer a human-readable file name in the per-product folder; ensure .pdf extension
        let nameFromUrl = '';
        try { nameFromUrl = decodeURIComponent(new URL(url).pathname.split('/').pop()||''); } catch {}
        let baseSafe = sanitizeFilename(nameFromUrl, `doc-${urlHash}.pdf`, 180);
        if (!/\.pdf$/i.test(baseSafe)) baseSafe = `${baseSafe}.pdf`;
        const tmpPath = path.join(productStagingDir, baseSafe);
        const ref = (run && run.url) ? String(run.url) : (domain ? `https://${domain}` : undefined);
        const headers = {
          ...(ref ? { Referer: ref } : {}),
          'Accept': 'application/pdf, */*;q=0.8',
          'Accept-Language': 'fr,fr-FR;q=0.9,en;q=0.8',
          ...(TSET_DOC && typeof TSET_DOC.headers==='object' ? TSET_DOC.headers : {}),
        };
        const { sha1, bytes } = await downloadToFileWithHash(url, tmpPath, Number(TSET_DOC.timeout_ms||20000), headers);
        try { chatLog?.('docs_download_ok', { run_id: run?.id, url, sha1, bytes, staging: tmpPath }); } catch {}
        const fileToken = sha1; // ps_attachment.file
        let baseName = sanitizeFilename(decodeURIComponent(new URL(url).pathname.split('/').pop()||'document.pdf'), `doc-${sha1}.pdf`, 180);
        let mime = guessMime(baseName);
        // Quick sanity check for PDF responses accidentally returning HTML
        try {
          const fd = fs.openSync(tmpPath, 'r');
          const buf = Buffer.allocUnsafe(8192);
          const nread = fs.readSync(fd, buf, 0, 8192, 0);
          fs.closeSync(fd);
          const head = buf.slice(0, Math.max(0, nread)).toString('utf8');
          const sig8 = head.slice(0,8);
          if (/\.pdf$/i.test(baseName) && !sig8.startsWith('%PDF')) {
            // Try to extract a real PDF URL from HTML (meta refresh / JS redirect / anchor)
            let foundPdf = null;
            try {
              const m1 = head.match(/https?:[^'"<>\s]+?\.pdf/gi);
              if (m1 && m1.length) foundPdf = m1[0];
              if (!foundPdf) {
                const m2 = head.match(/url=([^'"<>\s]+?\.pdf)/i);
                if (m2 && m2[1]) foundPdf = m2[1];
              }
            } catch {}
            if (foundPdf) {
              try { chatLog?.('docs_fallback_pdf_url', { run_id: run?.id, from: url, to: foundPdf }); } catch {}
              try {
                const tmp2 = path.join(productStagingDir, `fallback-${urlHash}.pdf`);
                const ref2 = (run && run.url) ? String(run.url) : (domain ? `https://${domain}` : undefined);
                const headers2 = { ...(ref2 ? { Referer: ref2 } : {}), 'Accept': 'application/pdf, */*;q=0.8', 'Accept-Language': 'fr,fr-FR;q=0.9,en;q=0.8', ...(TSET_DOC && typeof TSET_DOC.headers==='object' ? TSET_DOC.headers : {}) };
                const d2 = await downloadToFileWithHash(foundPdf, tmp2, Number(TSET_DOC.timeout_ms||20000), headers2);
                const fd2 = fs.openSync(tmp2, 'r');
                const b2 = Buffer.allocUnsafe(8); fs.readSync(fd2, b2, 0, 8, 0); fs.closeSync(fd2);
                if (b2.toString('ascii').startsWith('%PDF')) {
                  // adopt fallback result
                  try { fs.copyFileSync(tmp2, tmpPath); } catch {}
                  try { chatLog?.('docs_fallback_ok', { run_id: run?.id, url: foundPdf, sha1: d2.sha1, bytes: d2.bytes, staging: tmpPath }); } catch {}
                } else {
                  try { chatLog?.('docs_fallback_failed', { run_id: run?.id, url: foundPdf }); } catch {}
                }
              } catch {}
            }
            // Re-read after fallback attempt
            try {
              const fd3 = fs.openSync(tmpPath, 'r');
              const b3 = Buffer.allocUnsafe(8); fs.readSync(fd3, b3, 0, 8, 0); fs.closeSync(fd3);
              if (!b3.toString('ascii').startsWith('%PDF')) {
                try { chatLog?.('docs_error', { run_id: run?.id, url, error: 'not_pdf_signature', first_bytes: sig8 }); } catch {}
                try {
                  await pool?.query(
                    `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
                    [run?.id||null, ctx?.domain||null, run?.page_type||null, PREFIX+'attachment', 'download', productId||null, 'not_pdf_signature', JSON.stringify({ url })]
                  );
                } catch {}
                continue; // still not a PDF → skip
              }
            } catch {}
          }
        } catch {}
        const finalPath = path.join(downloadRoot, fileToken);
        try { fs.mkdirSync(path.dirname(finalPath), { recursive: true }); } catch {}
        try { fs.copyFileSync(tmpPath, finalPath); } catch {}
        let idAttachment = 0;
        try {
          const r0 = await q(`SELECT ${qi('id_attachment')} AS id FROM ${qi(T_ATTACHMENT)} WHERE ${qi('file')}=? LIMIT 1`, [fileToken]);
          if (Array.isArray(r0) && r0.length) idAttachment = Number(r0[0].id||0)||0;
        } catch {}
        if (!idAttachment) {
          // Build column list dynamically based on existing schema (compat across Presta versions)
          const cols = ['file'];
          const vals = [fileToken];
          const pushCol = async (name, value) => {
            try { if (await hasColumn(T_ATTACHMENT, name)) { cols.push(name); vals.push(value); } } catch {}
          };
          // Enforce schema lengths before pushing values
          try {
            const r1 = await q('SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [T_ATTACHMENT, 'file_name']);
            const max1 = Array.isArray(r1)&&r1.length ? (Number(r1[0].max_len||0)||0) : 128;
            if (max1 && baseName.length>max1) {
              const before = baseName; baseName = before.slice(0, max1);
              try { await pool?.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run?.id||null, ctx?.domain||null, run?.page_type||null, T_ATTACHMENT, 'truncate', productId||null, 'truncated', JSON.stringify({ column:'file_name', max_len: max1, before_len: before.length, after_len: baseName.length })]); } catch {}
            }
          } catch {}
          try {
            const r2 = await q('SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [T_ATTACHMENT, 'mime']);
            const max2 = Array.isArray(r2)&&r2.length ? (Number(r2[0].max_len||0)||0) : 128;
            if (max2 && String(mime).length>max2) mime = String(mime).slice(0, max2);
          } catch {}

          await pushCol('file_name', baseName);
          await pushCol('file_size', Number(bytes||0));
          await pushCol('mime', mime);
          await pushCol('date_add', nowFmt);
          // Optional newer columns
          await pushCol('date_upd', nowFmt);
          await pushCol('checksum', fileToken);

          try {
            await q(`INSERT INTO ${qi(T_ATTACHMENT)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, vals);
          } catch (e) {
            try { chatLog?.('docs_attach_insert_error', { run_id: run?.id, url, table: T_ATTACHMENT, error: String(e?.message||e) }); } catch {}
          }
          try {
            const rId = await q(`SELECT ${qi('id_attachment')} AS id FROM ${qi(T_ATTACHMENT)} WHERE ${qi('file')}=? LIMIT 1`, [fileToken]);
            if (Array.isArray(rId) && rId.length) idAttachment = Number(rId[0].id||0)||0;
          } catch {}
        }
        if (!idAttachment) { try { chatLog?.('docs_attach_insert_failed', { run_id: run?.id, url }); } catch {} continue; }

        // attachment_lang for active languages
        if (await hasTable(T_ATTACHMENT_LANG)) {
          for (const L of LANGS_DOC) {
            try {
              let name = baseName; const desc = '';
              try {
                const r3 = await q('SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [T_ATTACHMENT_LANG, 'name']);
                const max3 = Array.isArray(r3)&&r3.length ? (Number(r3[0].max_len||0)||0) : 32;
                if (max3 && name.length>max3) {
                  const before = name; name = before.slice(0,max3);
                  try { await pool?.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [run?.id||null, ctx?.domain||null, run?.page_type||null, T_ATTACHMENT_LANG, 'truncate', productId||null, L, 'truncated', JSON.stringify({ column:'name', max_len: max3, before_len: before.length, after_len: name.length })]); } catch {}
                }
              } catch {}
              const cols = ['id_attachment','id_lang','name','description'];
              const args = [idAttachment, L, name, desc];
              await q(`INSERT IGNORE INTO ${qi(T_ATTACHMENT_LANG)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, args);
            } catch {}
          }
        }
        // attachment_shop
        if (await hasTable(T_ATTACHMENT_SHOP)) {
          for (const SID of SHOPS) {
            try { await q(`INSERT IGNORE INTO ${qi(T_ATTACHMENT_SHOP)} (${qi('id_attachment')},${qi('id_shop')}) VALUES (?,?)`, [idAttachment, SID]); } catch {}
          }
        }
        // product_attachment
        if (await hasTable(T_PRODUCT_ATTACHMENT)) {
          try { await q(`INSERT IGNORE INTO ${qi(T_PRODUCT_ATTACHMENT)} (${qi('id_product')},${qi('id_attachment')}) VALUES (?,?)`, [productId, idAttachment]); } catch {}
        }
        try { chatLog?.('docs_attached', { run_id: run?.id, product_id: productId, url, id_attachment: idAttachment, file: fileToken, bytes }); } catch {}
      } catch (e) {
        try { chatLog?.('docs_error', { run_id: run?.id, url, error: String(e?.message||e) }); } catch {}
        try {
          await pool?.query(
            `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
            [run?.id||null, ctx?.domain||null, run?.page_type||null, PREFIX+'attachment', 'download', productId||null, String(e?.message||e), JSON.stringify({ url })]
          );
        } catch {}
      }
    }
  } catch (e) {
    try { ctx?.chatLog?.('docs_pipeline_failed', { run_id: ctx?.run?.id, error: String(e?.message||e) }); } catch {}
    try {
      await pool?.query(
        `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [ctx?.run?.id||null, ctx?.domain||null, ctx?.run?.page_type||null, (ctx?.PREFIX||'ps_')+'attachment', 'pipeline', ctx?.productId||null, String(e?.message||e), JSON.stringify({})]
      );
    } catch {}
  }
}

export default runDocumentsPipeline;
