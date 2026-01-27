import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', '..', '..', 'backend');
  } catch { return process.cwd(); }
}

function getChatLogPath(ctx) {
  try {
    const backendDir = resolveBackendDir(ctx);
    return path.join(backendDir, 'chat.log');
  } catch { return path.join(process.cwd(), 'chat.log'); }
}

function redact(key, value) {
  const k = String(key || '').toLowerCase();
  if (k.includes('password') || k.includes('api_key') || k === 'apikey' || k === 'authorization' || k.includes('token') || k.includes('secret')) return '****';
  return value;
}

function safeChatLog(ctx, event, payload = {}) {
  try {
    const line = `[${new Date().toISOString()}] [dhl] ${event} ${JSON.stringify(payload, redact)}`;
    fs.appendFileSync(getChatLogPath(ctx), line + '\n');
  } catch {}
  try { ctx?.logToFile?.(`[dhl] ${event} ${JSON.stringify(payload, redact)}`); } catch {}
}

export async function onModuleLoaded(ctx = {}) {
  safeChatLog(ctx, 'module_loaded', { ok: true });
}

export async function onModuleDisabled(ctx = {}) {
  safeChatLog(ctx, 'module_disabled', { ok: true });
}

