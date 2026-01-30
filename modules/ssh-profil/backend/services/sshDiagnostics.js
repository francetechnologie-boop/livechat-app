import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

async function loadSsh2Client() {
  try {
    const mod = await import('ssh2');
    return mod?.Client || mod?.default?.Client || mod?.default || null;
  } catch {}

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const req = createRequire(path.resolve(__dirname, '../../../../backend/index.js'));
    const mod = req('ssh2');
    return mod?.Client || mod?.default?.Client || mod?.default || null;
  } catch {
    return null;
  }
}

function execCommand(conn, cmd, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    try {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        let code = null;
        stream.on('close', (c) => resolve({ stdout, stderr, code: Number.isFinite(c) ? c : null }));
        stream.on('data', (d) => { stdout += d.toString('utf8'); });
        stream.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
        if (stdin != null) {
          try { stream.write(String(stdin)); } catch {}
          try { stream.end(); } catch {}
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function parseGroups(stdout) {
  const s = String(stdout || '').trim();
  if (!s) return [];
  return s.split(/\s+/g).filter(Boolean);
}

function parseOsRelease(text) {
  const out = {};
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2] || '';
    v = v.replace(/^"/, '').replace(/"$/, '');
    out[m[1]] = v;
  }
  return out;
}

export async function runSshProfileDiagnostics(cfg, opts = {}) {
  const chatLog = opts?.chatLog || (() => {});
  const profileId = opts?.profileId ?? null;
  const profileName = opts?.profileName ?? null;

  const Client = await loadSsh2Client();
  if (!Client) {
    return {
      ok: false,
      error: 'missing_dependency',
      message: 'Missing ssh2 dependency in backend. Install it with: cd backend && npm i ssh2 --omit=dev',
    };
  }

  const host = String(cfg?.host || '').trim();
  const port = Number(cfg?.port || 22) || 22;
  const username = String(cfg?.username || '').trim();
  const keyPath = cfg?.keyPath ? String(cfg.keyPath).trim() : null;
  const password = cfg?.password != null ? String(cfg.password) : null;

  if (!host || !username) return { ok: false, error: 'bad_request', message: 'host and username required' };
  if (!keyPath && !password) return { ok: false, error: 'bad_request', message: 'Provide key_path or password' };
  if (keyPath && !fs.existsSync(keyPath)) return { ok: false, error: 'bad_request', message: 'key_path not found on server' };

  const conn = new Client();
  const startedAt = Date.now();

  const connectConfig = {
    host,
    port,
    username,
    readyTimeout: 8000,
  };
  if (keyPath) {
    const privateKey = fs.readFileSync(keyPath, 'utf8');
    connectConfig.privateKey = privateKey;
  } else if (password) {
    connectConfig.password = password;
  }

  try {
    await new Promise((resolve, reject) => {
      const onReady = () => resolve();
      const onError = (e) => reject(e);
      conn.once('ready', onReady);
      conn.once('error', onError);
      conn.connect(connectConfig);
    });

    try { chatLog('ssh_profil_test_connected', { profileId, profileName, host, port, username }); } catch {}

    const who = await execCommand(conn, 'whoami');
    const uid = await execCommand(conn, 'id -u');
    const groups = await execCommand(conn, 'id -Gn');
    const hostname = await execCommand(conn, 'hostname');
    const uname = await execCommand(conn, 'uname -a');
    const shell = await execCommand(conn, 'sh -lc "printf %s \\"$SHELL\\""');
    const home = await execCommand(conn, 'sh -lc "printf %s \\"$HOME\\""');
    const osRelease = await execCommand(conn, 'sh -lc "cat /etc/os-release 2>/dev/null | head -n 50 || true"');

    const groupList = parseGroups(groups.stdout);
    const knownGroups = ['admin', 'adm', 'users', 'francetechnologie'];
    const groupFlags = Object.fromEntries(knownGroups.map((g) => [g, groupList.includes(g)]));

    const sudoNoPass = await execCommand(conn, 'sudo -n true', {});
    const passwordlessSudo = sudoNoPass.code === 0;

    let sudoWithPassword = null;
    if (!passwordlessSudo && password) {
      try {
        const r = await execCommand(conn, 'sudo -S -p "" -k true', { stdin: `${password}\n` });
        sudoWithPassword = r.code === 0;
      } catch {
        sudoWithPassword = false;
      }
    }

    const os = parseOsRelease(osRelease.stdout);

    return {
      ok: true,
      connected: true,
      duration_ms: Date.now() - startedAt,
      access: {
        is_root: String(uid.stdout || '').trim() === '0',
        groups: groupList,
        group_flags: groupFlags,
        sudo: {
          passwordless: passwordlessSudo,
          with_password: sudoWithPassword,
        },
      },
      info: {
        whoami: String(who.stdout || '').trim() || null,
        uid: Number(String(uid.stdout || '').trim()) || null,
        hostname: String(hostname.stdout || '').trim() || null,
        uname: String(uname.stdout || '').trim() || null,
        shell: String(shell.stdout || '').trim() || null,
        home: String(home.stdout || '').trim() || null,
        os: {
          id: os.ID || null,
          name: os.NAME || null,
          pretty_name: os.PRETTY_NAME || null,
          version: os.VERSION || null,
          version_id: os.VERSION_ID || null,
        },
      },
    };
  } catch (e) {
    try { chatLog('ssh_profil_test_failed', { profileId, profileName, host, port, username, error: String(e?.message || e) }); } catch {}
    return { ok: false, connected: false, error: 'connect_failed', message: e?.message || String(e) };
  } finally {
    try { conn.end(); } catch {}
  }
}
