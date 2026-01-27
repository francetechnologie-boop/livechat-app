import { execFile } from 'child_process';
import { getSecurityConfig } from './settings.service.js';

function execFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}

function shQuote(v) {
  const s = String(v ?? '');
  if (s === '') return "''";
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

function looksLikeFail2banSocketPermissionDenied(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('permission denied to socket') ||
    (t.includes('fail2ban.sock') && t.includes('permission denied')) ||
    t.includes('you must be root')
  );
}

async function execRemoteFail2ban({ pool, orgId, remoteArgs }) {
  const cfg = await getSecurityConfig(pool, { orgId });
  if (!cfg.configured) {
    const err = new Error('Remote SSH is not configured. Open the Settings tab and set ssh_host / ssh_user / ssh_key_path.');
    err.code = 'not_configured';
    err.config = cfg;
    throw err;
  }

  const baseArgs = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-p', String(cfg.port),
  ];
  if (cfg.keyPath) baseArgs.push('-i', cfg.keyPath);

  const buildRemoteCmd = ({ sudo = false } = {}) => {
    const parts = sudo
      ? ['sudo', '-n', '--', 'fail2ban-client', ...remoteArgs]
      : ['fail2ban-client', ...remoteArgs];
    return parts.map(shQuote).join(' ');
  };

  const run = async (remoteCmd) => {
    const args = [...baseArgs, `${cfg.user}@${cfg.host}`, remoteCmd];
    const { stdout, stderr } = await execFileAsync('ssh', args, { timeout: 15000 });
    return { cfg, stdout: String(stdout || ''), stderr: String(stderr || '') };
  };

  try {
    return await run(buildRemoteCmd({ sudo: false }));
  } catch (e) {
    const combined = `${String(e?.stderr || '')}\n${String(e?.stdout || '')}`.trim();
    if (!looksLikeFail2banSocketPermissionDenied(combined)) throw e;
    try {
      return await run(buildRemoteCmd({ sudo: true }));
    } catch (sudoErr) {
      const sudoCombined = `${String(sudoErr?.stderr || '')}\n${String(sudoErr?.stdout || '')}`.trim();
      const err = new Error(
        'Permission denied reading Fail2ban status on the remote host. ' +
          'Set `ssh_user` to root, or allow passwordless sudo for `fail2ban-client` for this SSH user.'
      );
      err.code = 'fail2ban_permission';
      err.details = {
        host: cfg.host,
        user: cfg.user,
        sudoTried: true,
        sudoError: sudoCombined ? sudoCombined.split('\n').slice(0, 3).join('\n') : undefined,
      };
      throw err;
    }
  }
}

function parseJailList(output) {
  const text = String(output || '');
  const line = text.split('\n').find((l) => l.toLowerCase().includes('jail list:'));
  if (!line) return [];
  const parts = line.split(':').slice(1).join(':').trim();
  if (!parts) return [];
  return parts
    .split(',')
    .map((x) => String(x).trim())
    .filter(Boolean);
}

function parseStatusDetails(output) {
  const text = String(output || '');
  const lines = text.split('\n').map((l) => l.replace(/\r/g, ''));

  const take = (label) => {
    const re = new RegExp(`\\b${label}\\b\\s*:\\s*(.*)$`, 'i');
    const hit = lines.find((l) => re.test(l));
    if (!hit) return null;
    const m = hit.match(re);
    const v = (m && m[1]) ? String(m[1]).trim() : '';
    return v || null;
  };

  const toNum = (v) => {
    const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const bannedIps = (() => {
    const raw = take('Banned IP list');
    if (!raw) return [];
    return raw
      .split(/\s+/g)
      .map((x) => String(x).trim())
      .filter(Boolean);
  })();

  return {
    currently_failed: toNum(take('Currently failed')),
    total_failed: toNum(take('Total failed')),
    file_list: (() => {
      const raw = take('File list');
      if (!raw) return [];
      return raw.split(',').map((x) => String(x).trim()).filter(Boolean);
    })(),
    currently_banned: toNum(take('Currently banned')),
    total_banned: toNum(take('Total banned')),
    banned_ips: bannedIps,
  };
}

function safeJailName(name) {
  const s = String(name || '').trim();
  if (!s) return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(s)) return null;
  return s;
}

export async function getFail2banJails({ pool, orgId } = {}) {
  const { stdout, stderr } = await execRemoteFail2ban({ pool, orgId, remoteArgs: ['status'] });
  const raw = String(stdout || stderr || '');
  return parseJailList(raw);
}

export async function getFail2banJailStatus(jailName, { pool, orgId, includeIps = false } = {}) {
  const jail = safeJailName(jailName);
  if (!jail) {
    const err = new Error('Invalid jail name');
    err.code = 'invalid_jail';
    throw err;
  }
  const { stdout, stderr } = await execRemoteFail2ban({ pool, orgId, remoteArgs: ['status', jail] });
  const raw = String(stdout || stderr || '');
  const parsed = parseStatusDetails(raw);
  return {
    jail,
    ...parsed,
    banned_ips: includeIps ? parsed.banned_ips : undefined,
  };
}

export async function getFail2banOverview({ pool, orgId, includeIps = false, maxIps = 50 } = {}) {
  const jails = await getFail2banJails({ pool, orgId });
  const out = [];
  for (const jail of jails) {
    const st = await getFail2banJailStatus(jail, { pool, orgId, includeIps });
    if (includeIps && Array.isArray(st.banned_ips) && st.banned_ips.length > maxIps) {
      st.banned_ips = st.banned_ips.slice(0, maxIps);
      st.banned_ips_truncated = true;
    }
    out.push(st);
  }
  return out;
}
