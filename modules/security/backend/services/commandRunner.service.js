import { execFile } from 'child_process';
import { getSecurityConfig } from './settings.service.js';

function execFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 12 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}

function shQuote(v) {
  const s = String(v || '');
  if (!s) return "''";
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

function getSshArgs(cfg) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'LogLevel=ERROR',
    '-o', 'PreferredAuthentications=publickey',
    '-p', String(cfg.port),
  ];
  if (cfg.keyPath) args.push('-i', cfg.keyPath);
  return args;
}

function capText(s, maxChars) {
  const str = String(s || '');
  if (str.length <= maxChars) return { text: str, truncated: false };
  return { text: str.slice(0, maxChars) + '\n[truncated]', truncated: true };
}

function sudoNeedsPasswordHint(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('sudo: a password is required')) return true;
  if (t.includes('sudo: a terminal is required')) return true;
  if (t.includes('no tty present') && t.includes('sudo')) return true;
  return false;
}

export async function runRemoteCommand({ pool, orgId, command, timeoutMs = 15000 } = {}) {
  const cfg = await getSecurityConfig(pool, { orgId });
  if (!cfg.configured) {
    const err = new Error('Remote SSH is not configured. Open the Settings tab and set ssh_host / ssh_user / ssh_key_path.');
    err.code = 'not_configured';
    err.config = cfg;
    throw err;
  }

  const cmd = String(command || '');
  if (!cmd.trim()) {
    const err = new Error('Empty command');
    err.code = 'invalid_command';
    throw err;
  }
  if (cmd.length > 4000 || cmd.includes('\0')) {
    const err = new Error('Command too large or invalid');
    err.code = 'invalid_command';
    throw err;
  }

  const ms = Math.max(1000, Math.min(30000, Number(timeoutMs) || 15000));
  const started = Date.now();

  const remoteCmd = `bash -lc ${shQuote(cmd)}`;
  const args = [...getSshArgs(cfg), `${cfg.user}@${cfg.host}`, remoteCmd];

  try {
    const { stdout, stderr } = await execFileAsync('ssh', args, { timeout: ms });
    const outCap = capText(stdout, 20000);
    const errCap = capText(stderr, 20000);
    return {
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: outCap.text,
      stderr: errCap.text,
      stdoutTruncated: outCap.truncated,
      stderrTruncated: errCap.truncated,
    };
  } catch (e) {
    const outCap = capText(e?.stdout, 20000);
    const errCap = capText(e?.stderr, 20000);
    const combined = `${String(e?.stderr || '')}\n${String(e?.stdout || '')}`;
    return {
      ok: false,
      exitCode: Number.isFinite(Number(e?.code)) ? Number(e.code) : null,
      durationMs: Date.now() - started,
      stdout: outCap.text,
      stderr: errCap.text || String(e?.message || ''),
      stdoutTruncated: outCap.truncated,
      stderrTruncated: errCap.truncated,
      hint: sudoNeedsPasswordHint(combined)
        ? 'This command uses sudo, but the SSH session is non-interactive. Use `sudo -n ...` with a NOPASSWD sudoers rule for this user (recommended), or set `ssh_user=root` and run without sudo.'
        : undefined,
    };
  }
}
