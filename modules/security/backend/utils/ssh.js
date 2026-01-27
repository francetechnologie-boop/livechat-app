import { execFile } from 'child_process';

export function execFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}

export function shQuote(v) {
  const s = String(v || '');
  if (!s) return "''";
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

export function safeAbsoluteRemotePath(p) {
  const s = String(p || '').trim();
  if (!s) return null;
  if (!s.startsWith('/')) return null;
  if (s.includes('\0') || s.includes('\n') || s.includes('\r')) return null;
  if (s.includes('..')) return null;
  if (s.length > 600) return null;
  return s;
}

export function getSshArgs(cfg) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'LogLevel=ERROR',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-p', String(cfg.port),
  ];
  if (cfg.keyPath) args.push('-i', cfg.keyPath);
  return args;
}

export function normalizeRemoteFileName(file) {
  const name = String(file || '').trim();
  if (!name) return '';
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return '';
  if (name.includes('..')) return '';
  if (name.endsWith('.gz') || name.endsWith('.xz') || name.endsWith('.bz2')) return '';
  return name;
}
