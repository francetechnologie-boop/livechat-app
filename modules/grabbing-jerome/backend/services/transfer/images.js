// Image staging / variants helpers for the send pipeline
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { chooseImageRoot, getStagingRoot, ensureSharp, convertAndWriteVariants, prestashopImageFolder, downloadToFileWithHash, sanitizeFilename } from '../../utils/image.utils.js';

export async function stageImageFromUrl(url, stagingRoot, TSET_IMAGE = {}, chatLog = () => {}) {
  const urlHash = createHash('sha1').update(String(url)).digest('hex');
  const urlExtMatch = String(url).toLowerCase().match(/\.(jpe?g|png|webp)(?:\?|#|$)/);
  const urlExt = urlExtMatch ? urlExtMatch[1] : 'jpg';
  const tmpDir = path.join(stagingRoot, 'tmp');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  let tmpName = `${urlHash}.${urlExt}`;
  try {
    const tmpNaming = (TSET_IMAGE && TSET_IMAGE.tmp_naming) ? String(TSET_IMAGE.tmp_naming) : 'json';
    if (tmpNaming === 'json') {
      try {
        const u = new URL(String(url));
        const base = decodeURIComponent(u.pathname || '').split('/').pop() || '';
        let safe = sanitizeFilename(base, tmpName);
        if (!/\.(jpe?g|png|webp)$/i.test(safe)) safe = `${safe}.${urlExt}`;
        tmpName = safe;
      } catch {}
    }
  } catch {}
  const tmpSrc = path.join(tmpDir, tmpName);
  const dl = await downloadToFileWithHash(url, tmpSrc, Number(TSET_IMAGE.timeout_ms || 20000));
  return { tmpSrc, sha1: dl.sha1, contentType: dl.contentType || '', urlExt };
}

export async function writeImageVariants(id_image, tmpSrc, imageTypes = [], chatLog = () => {}) {
  const stageDir = path.join(getStagingRoot(''), prestashopImageFolder(id_image));
  try { fs.mkdirSync(stageDir, { recursive: true }); } catch {}
  const stageBase = path.join(stageDir, `${id_image}`);
  const stageCanon = `${stageBase}.jpg`;
  const sharp = await ensureSharp();
  if (sharp) {
    try {
      await (sharp(tmpSrc)).jpeg({ quality: 90 }).toFile(stageCanon);
    } catch {}
  } else {
    try { fs.copyFileSync(tmpSrc, stageCanon); } catch {}
  }
  const conv = await convertAndWriteVariants(tmpSrc, stageBase, imageTypes || [], chatLog);
  return { stageDir, stageCanon, variants: conv?.items || [] };
}

export function resolveImgRoots(TSET_IMAGE = {}) {
  const stagingRoot = getStagingRoot(String(TSET_IMAGE.staging_root || ''));
  let imgRoot = chooseImageRoot(TSET_IMAGE);
  return { stagingRoot, imgRoot };
}

