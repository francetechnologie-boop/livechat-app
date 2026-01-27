import path from 'path';
import { pathToFileURL } from 'url';

let googleApiInstance = null;

export async function loadGoogleApis(ctx = {}) {
  if (googleApiInstance) return googleApiInstance;
  try {
    const mod = await import('googleapis');
    googleApiInstance = mod.google || (mod.default && mod.default.google) || mod;
    return googleApiInstance;
  } catch {}
  try {
    const backendDir = ctx?.backendDir || '';
    if (backendDir) {
      const candidate = path.join(backendDir, 'node_modules', 'googleapis', 'build', 'src', 'index.js');
      const mod = await import(pathToFileURL(candidate).href);
      googleApiInstance = mod.google || (mod.default && mod.default.google) || mod;
      return googleApiInstance;
    }
  } catch {}
  googleApiInstance = null;
  return null;
}

export async function ensureGmailTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mod_google_api_settings (
      id SERIAL PRIMARY KEY,
      org_id TEXT DEFAULT 'org_default',
      client_id TEXT,
      client_secret TEXT,
      redirect_uri TEXT,
      scopes TEXT[],
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_mod_google_api_settings_org UNIQUE(org_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mod_google_api_tokens (
      id SERIAL PRIMARY KEY,
      org_id TEXT DEFAULT 'org_default',
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT,
      expiry_date BIGINT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

export async function getGmailOauth(ctx = {}) {
  const pool = ctx.pool;
  if (!pool) throw new Error('missing_pg_pool');
  await ensureGmailTables(pool);
  const google = await loadGoogleApis(ctx);
  if (!google) throw new Error('missing_dependency');
  const settings = await pool.query(
    `SELECT client_id, client_secret, redirect_uri FROM mod_google_api_settings WHERE org_id='org_default' LIMIT 1`
  );
  if (!settings.rowCount) throw new Error('missing_config');
  const cfg = settings.rows[0];
  const tokens = await pool.query(
    `SELECT access_token, refresh_token, token_type, expiry_date FROM mod_google_api_tokens WHERE org_id='org_default' ORDER BY updated_at DESC LIMIT 1`
  );
  const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uri);
  const tok = tokens.rowCount ? tokens.rows[0] : {};
  const creds = {};
  if (tok.access_token) creds.access_token = tok.access_token;
  if (tok.refresh_token) creds.refresh_token = tok.refresh_token;
  if (tok.token_type) creds.token_type = tok.token_type;
  if (tok.expiry_date) creds.expiry_date = Number(tok.expiry_date);
  oauth2.setCredentials(creds);
  return { google, oauth2 };
}

function toBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wrapBase64Lines(base64, width = 76) {
  const text = String(base64 || '');
  if (!text) return '';
  const chunks = [];
  for (let i = 0; i < text.length; i += width) chunks.push(text.slice(i, i + width));
  return chunks.join('\r\n');
}

function encodeHeaderUtf8(value = '') {
  const raw = String(value || '');
  // RFC 2047 "encoded-word" for non-ASCII headers
  return /[^\x00-\x7F]/.test(raw) ? `=?UTF-8?B?${Buffer.from(raw, 'utf8').toString('base64')}?=` : raw;
}

export async function createDraft({ ctx = {}, to, subject = '', html = '', text = '', attachments = [], from }) {
  if (!to) throw new Error('missing_recipient');
  const { google, oauth2 } = await getGmailOauth(ctx);
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const mixedBoundary = `mixed-${Date.now()}`;
  const altBoundary = `alt-${Date.now()}`;
  const lines = [];
  const fromAddress = String(from || '').trim();
  if (fromAddress) lines.push(`From: ${fromAddress}`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${encodeHeaderUtf8(subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  lines.push('');
  lines.push(`--${mixedBoundary}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  lines.push('');

  // text/plain part (always present for deliverability)
  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(wrapBase64Lines(Buffer.from(String(text || ''), 'utf8').toString('base64')));
  lines.push('');

  // text/html part (if provided, else fallback to plain)
  lines.push(`--${altBoundary}`);
  if (html) {
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrapBase64Lines(Buffer.from(String(html || ''), 'utf8').toString('base64')));
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrapBase64Lines(Buffer.from(String(text || ''), 'utf8').toString('base64')));
  }
  lines.push('');
  lines.push(`--${altBoundary}--`);

  for (const attachment of attachments) {
    const dataBuffer = Buffer.isBuffer(attachment.data)
      ? attachment.data
      : Buffer.from(String(attachment.data || ''), 'base64');
    const filename = attachment.filename || 'attachment';
    lines.push('');
    lines.push(`--${mixedBoundary}`);
    lines.push(`Content-Type: ${attachment.mimeType || 'application/octet-stream'}; name="${filename}"`);
    lines.push(`Content-Disposition: attachment; filename="${filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrapBase64Lines(dataBuffer.toString('base64')));
  }
  lines.push('');
  lines.push(`--${mixedBoundary}--`);
  const raw = toBase64Url(lines.join('\r\n'));
  const draft = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw },
    },
  });
  return draft.data;
}

export async function sendEmail({ ctx = {}, to, subject = '', html = '', text = '', attachments = [], from }) {
  if (!to) throw new Error('missing_recipient');
  const { google, oauth2 } = await getGmailOauth(ctx);
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const mixedBoundary = `mixed-${Date.now()}`;
  const altBoundary = `alt-${Date.now()}`;
  const lines = [];
  const fromAddress = String(from || '').trim();
  if (fromAddress) lines.push(`From: ${fromAddress}`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${encodeHeaderUtf8(subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  lines.push('');
  lines.push(`--${mixedBoundary}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  lines.push('');

  // text/plain part (always present for deliverability)
  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(wrapBase64Lines(Buffer.from(String(text || ''), 'utf8').toString('base64')));
  lines.push('');

  // text/html part (if provided, else fallback to plain)
  lines.push(`--${altBoundary}`);
  if (html) {
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrapBase64Lines(Buffer.from(String(html || ''), 'utf8').toString('base64')));
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrapBase64Lines(Buffer.from(String(text || ''), 'utf8').toString('base64')));
  }
  lines.push('');
  lines.push(`--${altBoundary}--`);

  for (const attachment of attachments) {
    const dataBuffer = Buffer.isBuffer(attachment.data)
      ? attachment.data
      : Buffer.from(String(attachment.data || ''), 'base64');
    const filename = attachment.filename || 'attachment';
    lines.push('');
    lines.push(`--${mixedBoundary}`);
    lines.push(`Content-Type: ${attachment.mimeType || 'application/octet-stream'}; name="${filename}"`);
    lines.push(`Content-Disposition: attachment; filename="${filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrapBase64Lines(dataBuffer.toString('base64')));
  }
  lines.push('');
  lines.push(`--${mixedBoundary}--`);
  const raw = toBase64Url(lines.join('\r\n'));
  const msg = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
    },
  });
  return msg.data;
}
