import { resolveSecurityRemoteLogConfig } from './remoteConnections.service.js';
import { execFileAsync, getSshArgs, normalizeRemoteFileName, safeAbsoluteRemotePath, shQuote } from '../utils/ssh.js';

const APACHE_LOG_DIR = '/var/log/apache2';

export async function tailRemoteApacheAccessLog({ pool, orgId, connectionId = null, lines = 300 } = {}) {
  const resolved = await resolveSecurityRemoteLogConfig(pool, { orgId, connectionId });
  const cfg = resolved.config;
  if (!cfg?.configured) {
    return {
      configured: false,
      content: '',
      hint: 'Set SECURITY_LOG_SSH_HOST (or use the Settings tab) before loading the remote log.',
      config: cfg || null,
      src: resolved.src,
    };
  }

  const n = Math.max(10, Math.min(2000, Number(lines) || 300));
  const safePath = safeAbsoluteRemotePath(cfg.logPath);
  if (!safePath) {
    return {
      configured: false,
      content: '',
      hint: 'Invalid log_path. Use an absolute path like /var/log/apache2/access_unified_website.log.',
      config: cfg,
      src: resolved.src,
    };
  }
  const remoteCmd = `tail -n ${n} -- ${shQuote(safePath)}`;

  const args = [...getSshArgs(cfg), `${cfg.user}@${cfg.host}`, remoteCmd];

  const { stdout, stderr } = await execFileAsync('ssh', args, { timeout: 12000 });
  const content = String(stdout || '').trimEnd();
  const err = String(stderr || '').trim();
  return {
    configured: true,
    content,
    stderr: err || undefined,
    config: cfg,
    src: resolved.src,
  };
}

export async function listRemoteApacheLogFiles({ pool, orgId, connectionId = null } = {}) {
  const resolved = await resolveSecurityRemoteLogConfig(pool, { orgId, connectionId });
  const cfg = resolved.config;
  if (!cfg?.configured) {
    return {
      configured: false,
      directory: APACHE_LOG_DIR,
      files: [],
      hint: 'Set SECURITY_LOG_SSH_HOST (or use the Settings tab) before loading the remote log.',
      config: cfg || null,
      src: resolved.src,
    };
  }

  const remoteCmd = `ls -1 -- ${APACHE_LOG_DIR}`;
  const args = [...getSshArgs(cfg), `${cfg.user}@${cfg.host}`, remoteCmd];
  const { stdout, stderr } = await execFileAsync('ssh', args, { timeout: 12000 });
  const content = String(stdout || '');
  const files = content
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeRemoteFileName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return {
    configured: true,
    directory: APACHE_LOG_DIR,
    files,
    stderr: String(stderr || '').trim() || undefined,
    config: cfg,
    src: resolved.src,
  };
}

export async function tailRemoteApacheLogFile({ pool, orgId, connectionId = null, file, lines = 300, mode = 'tail', offset = 0 } = {}) {
  const resolved = await resolveSecurityRemoteLogConfig(pool, { orgId, connectionId });
  const cfg = resolved.config;
  if (!cfg?.configured) {
    return {
      configured: false,
      content: '',
      hint: 'Set SECURITY_LOG_SSH_HOST (or use the Settings tab) before loading the remote log.',
      config: cfg || null,
      src: resolved.src,
    };
  }

  const safeFile = normalizeRemoteFileName(file);
  if (!safeFile) {
    const e = new Error('Invalid file. Choose a filename from /var/log/apache2.');
    e.statusCode = 400;
    throw e;
  }

  const n = Math.max(10, Math.min(2000, Number(lines) || 300));
  const modeNorm = String(mode || 'tail');
  const offsetNorm = Math.max(0, Math.min(5000000, Number(offset) || 0));
  if (modeNorm !== 'tail' && modeNorm !== 'head') {
    const e = new Error('Invalid mode. Use mode=tail or mode=head.');
    e.statusCode = 400;
    throw e;
  }
  const remotePath = `${APACHE_LOG_DIR}/${safeFile}`;
  let remoteCmd = '';
  if (modeNorm === 'tail') {
    if (offsetNorm > 0) remoteCmd = `tail -n ${n + offsetNorm} -- ${shQuote(remotePath)} | head -n ${n}`;
    else remoteCmd = `tail -n ${n} -- ${shQuote(remotePath)}`;
  } else {
    if (offsetNorm > 0) remoteCmd = `head -n ${n + offsetNorm} -- ${shQuote(remotePath)} | tail -n ${n}`;
    else remoteCmd = `head -n ${n} -- ${shQuote(remotePath)}`;
  }
  const args = [...getSshArgs(cfg), `${cfg.user}@${cfg.host}`, remoteCmd];

  const { stdout, stderr } = await execFileAsync('ssh', args, { timeout: 12000 });
  const content = String(stdout || '').trimEnd();
  const err = String(stderr || '').trim();
  return {
    configured: true,
    file: safeFile,
    path: remotePath,
    mode: modeNorm,
    offset: offsetNorm,
    content,
    stderr: err || undefined,
    config: cfg,
    src: resolved.src,
  };
}

export const SECURITY_APACHE_LOG_DIR = APACHE_LOG_DIR;
