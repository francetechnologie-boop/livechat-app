import crypto from 'crypto';

function getSecret() {
  const direct = String(process.env.SSH_PROFIL_CRED_SECRET || '').trim();
  if (direct) return direct;
  const fallback = String(process.env.AUTH_SECRET || '').trim();
  return fallback || 'change-me-dev';
}

function key32() {
  return crypto.createHash('sha256').update(getSecret(), 'utf8').digest();
}

export function encryptSecret(plaintext) {
  if (plaintext == null) return null;
  const s = String(plaintext);
  if (!s) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key32(), iv);
  const enc = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  const s = String(payload || '');
  if (!s) return null;
  if (!s.startsWith('v1:')) return s; // legacy/plaintext support
  const parts = s.split(':');
  if (parts.length !== 4) return null;
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key32(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

