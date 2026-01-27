import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { createHash } from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';

export function sanitizeFilename(name, fallback, maxLen = 180) {
  try {
    let n = String(name || '').trim();
    if (!n) return fallback;
    n = n.replace(/\\/g, '/');
    n = n.split('/').pop();
    n = n.replace(/[^A-Za-z0-9._-]+/g, '-');
    n = n.replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    if (!n) return fallback;
    if (n.length > maxLen) n = n.slice(0, maxLen);
    return n;
  } catch { return fallback; }
}

export function chooseImageRoot(TSET_IMAGE = {}) {
  try {
    const fromSetting = String(TSET_IMAGE.img_root || '').trim();
    if (fromSetting) return fromSetting;
    const cand1 = '/var/www/html/3dtisk5/img/p';
    const cand2 = '/var/www/prestashop/img/p';
    if (fs.existsSync(cand1)) return cand1;
    if (fs.existsSync(cand2)) return cand2;
    const prestaRoot = String(process.env.PRESTA_ROOT || '').trim();
    if (prestaRoot) return path.join(prestaRoot, 'img', 'p');
  } catch {}
  return '';
}

export function chooseBinConsole(TSET_IMAGE = {}) {
  try {
    const fromSetting = String(TSET_IMAGE.bin_console || '').trim();
    if (fromSetting) return fromSetting;
    const cand1 = '/var/www/html/3dtisk5/bin/console';
    const cand2 = '/var/www/prestashop/bin/console';
    if (fs.existsSync(cand1)) return cand1;
    if (fs.existsSync(cand2)) return cand2;
    const prestaRoot = String(process.env.PRESTA_ROOT || '').trim();
    if (prestaRoot) return path.join(prestaRoot, 'bin', 'console');
  } catch {}
  return '';
}

export const resolveModuleRoot = () => {
  try {
    // Move root to the module folder (../..) so staging defaults to
    // /modules/grabbing-jerome/image_folder as before
    return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  } catch { return process.cwd(); }
};

export const getStagingRoot = (override) => {
  if (override && String(override).trim()) return String(override).trim();
  return path.join(resolveModuleRoot(), 'image_folder');
};

export const getRawDownloadDir = (override) => {
  // Raw downloads folder used as cache of original images
  const base = getStagingRoot(override);
  return path.join(base, 'product_images');
};

export async function ensureSharp() {
  // Try regular resolution first
  try {
    const mod = await import('sharp');
    return mod?.default || mod;
  } catch {}
  // Compute likely repo root from this module file
  let repoRoot = null;
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    // modules/grabbing-jerome/backend/utils -> up 4 = repo root
    repoRoot = path.resolve(here, '..', '..', '..', '..');
  } catch {}
  // Fallbacks: attempt to import from backend/node_modules and repo-level node_modules
  const candidates = [
    // If process is at repo root, prefer backend/node_modules first
    path.join(process.cwd(), 'backend', 'node_modules', 'sharp', 'lib', 'index.js'),
    // If process is backend/, try local node_modules
    path.join(process.cwd(), 'node_modules', 'sharp', 'lib', 'index.js'),
    // From derived repo root
    repoRoot ? path.join(repoRoot, 'backend', 'node_modules', 'sharp', 'lib', 'index.js') : null,
    repoRoot ? path.join(repoRoot, 'node_modules', 'sharp', 'lib', 'index.js') : null,
  ].filter(Boolean);
  for (const fp of candidates) {
    try {
      const url = pathToFileURL(fp);
      const mod = await import(url.href);
      if (mod) return mod?.default || mod;
    } catch {}
  }
  return null;
}

export async function convertAndWriteVariants(srcFile, outBaseNoExt, types = [], chatLog = () => {}) {
  const sharp = await ensureSharp();
  if (!sharp) return { ok: false, error: 'sharp_missing' };
  const results = [];
  for (const t of types) {
    const name = String(t.name || '').trim();
    const w = Number(t.width || 0) || null;
    const h = Number(t.height || 0) || null;
    if (!name || (!w && !h)) { results.push({ name, ok: false, error: 'bad_type' }); continue; }
    const outJpg = `${outBaseNoExt}-${name}.jpg`;
    const outWebp = `${outBaseNoExt}-${name}.webp`;
    try {
      await sharp(srcFile).resize(w || null, h || null, { fit: 'cover' }).jpeg({ quality: 85 }).toFile(outJpg);
      await sharp(srcFile).resize(w || null, h || null, { fit: 'cover' }).webp({ quality: 85 }).toFile(outWebp);
      let jpgBytes = null, webpBytes = null;
      try { jpgBytes = fs.statSync(outJpg).size; } catch {}
      try { webpBytes = fs.statSync(outWebp).size; } catch {}
      try {
        const folder = path.dirname(outJpg);
        chatLog('image_stage_variant', { variant: name, width: w, height: h, folder, filename_jpg: path.basename(outJpg), filename_webp: path.basename(outWebp), jpg: outJpg, jpg_bytes: jpgBytes, webp: outWebp, webp_bytes: webpBytes });
        // Additional explicit logs for resized outputs (as requested)
        if (jpgBytes != null) chatLog('image_resized_created', { folder, name: path.basename(outJpg), size_bytes: jpgBytes, format: 'jpg', variant: name, width: w, height: h });
        if (webpBytes != null) chatLog('image_resized_created', { folder, name: path.basename(outWebp), size_bytes: webpBytes, format: 'webp', variant: name, width: w, height: h });
      } catch {}
      results.push({ name, ok: true, jpg: outJpg, webp: outWebp });
    } catch (e) {
      results.push({ name, ok: false, error: String(e?.message || e) });
    }
  }
  return { ok: true, items: results };
}

export const prestashopImageFolder = (id) => {
  const s = String(Number(id || 0));
  return s.split('').join('/');
};

export const fetchToFile = (url, destPath, timeoutMs = 20000) => new Promise((resolve, reject) => {
  try {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'LiveChat-Importer/1.0' } }, (res) => {
      if ((res.statusCode || 0) >= 300 && (res.statusCode || 0) < 400 && res.headers.location) {
        try { req.destroy(); } catch {}
        return resolve(fetchToFile(res.headers.location, destPath, timeoutMs));
      }
      if ((res.statusCode || 0) !== 200) return reject(new Error(`http_${res.statusCode}`));
      const dir = path.dirname(destPath);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const ws = fs.createWriteStream(destPath);
      res.pipe(ws);
      ws.on('finish', () => { try { ws.close(() => resolve(true)); } catch { resolve(true); } });
      ws.on('error', (e) => { try { ws.destroy(); } catch {}; reject(e); });
    });
    req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.on('error', reject);
  } catch (e) { reject(e); }
});

export async function downloadToFileWithHash(url, destPath, timeoutMs = 20000) {
  const ok = await fetchToFile(url, destPath, timeoutMs);
  if (!ok) throw new Error('download_failed');
  const h = createHash('sha1');
  const buf = fs.readFileSync(destPath);
  h.update(buf);
  return { ok: true, sha1: h.digest('hex'), bytes: buf.length };
}
