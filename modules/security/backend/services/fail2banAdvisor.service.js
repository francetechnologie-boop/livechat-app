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

function getSshArgs(cfg) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'PreferredAuthentications=publickey',
    '-p', String(cfg.port),
  ];
  if (cfg.keyPath) args.push('-i', cfg.keyPath);
  return args;
}

function shQuote(v) {
  const s = String(v || '');
  if (!s) return "''";
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

function safeAbsoluteRemotePath(p) {
  const s = String(p || '').trim();
  if (!s) return null;
  if (!s.startsWith('/')) return null;
  if (s.includes('\0') || s.includes('\n') || s.includes('\r')) return null;
  if (s.includes('..')) return null;
  if (s.length > 600) return null;
  return s;
}

function parseApacheTimestamp(ts) {
  const raw = String(ts || '').trim();
  if (!raw) return null;

  // Common: 21/Jan/2026:03:54:39 +0000
  const m = raw.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const mon = String(m[2]).toLowerCase();
    const year = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const ss = Number(m[6]);
    const tz = String(m[7]);
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const monthIdx = Object.prototype.hasOwnProperty.call(months, mon) ? months[mon] : null;
    if (monthIdx == null) return null;
    const sign = tz[0] === '-' ? -1 : 1;
    const tzH = Number(tz.slice(1, 3));
    const tzM = Number(tz.slice(3, 5));
    if (![day, year, hh, mm, ss, tzH, tzM].every(Number.isFinite)) return null;
    const offsetMinutes = sign * (tzH * 60 + tzM);
    const utcMs = Date.UTC(year, monthIdx, day, hh, mm, ss);
    return utcMs - offsetMinutes * 60 * 1000;
  }

  // Fallback: try Date.parse for ISO-like timestamps
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function parseAccessLogLine(line) {
  const s = String(line || '');
  if (!s) return null;

  // Apache/Nginx combined (best-effort):
  // 1.2.3.4 - - [21/Jan/2026:03:54:39 +0000] "GET /path HTTP/1.1" 404 123 "-" "UA"
  const m = s.match(/^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+\S+(?:\s+"[^"]*"\s+"([^"]*)")?/);
  if (!m) return null;
  const ip = String(m[1] || '').trim();
  const ts = String(m[2] || '').trim();
  const req = String(m[3] || '').trim();
  const status = Number(String(m[4] || '').trim());
  const ua = String(m[5] || '').trim();

  const reqParts = req.split(/\s+/g).filter(Boolean);
  const path = reqParts.length >= 2 ? String(reqParts[1] || '').trim() : '';
  if (!ip || !path || !Number.isFinite(status)) return null;

  const tsMs = parseApacheTimestamp(ts);

  return { ip, tsMs, path, status, ua };
}

function normalizePathForStats(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  // Drop query string for grouping
  const q = s.indexOf('?');
  return q >= 0 ? s.slice(0, q) : s;
}

function buildRecommendedFail2ban({ logPath }) {
  const filterFileName = 'unified-website.conf';

  const filterConf =
`# /etc/fail2ban/filter.d/unified-website.conf
[Definition]
# Matches common scanner/bruteforce paths returning 401/403/404 in Apache/Nginx combined logs.
failregex = ^<HOST>\\s+\\S+\\s+\\S+\\s+\\[[^\\]]+\\]\\s+\\"(?:GET|POST|HEAD|PUT|DELETE|OPTIONS)\\s+/(?:wp-login\\.php|xmlrpc\\.php|\\.env|\\.git|phpmyadmin|pma|admin)(?:[/?\\s]|$)[^\\"]*\\"\\s+(?:401|403|404)\\b
            ^<HOST>\\s+\\S+\\s+\\S+\\s+\\[[^\\]]+\\]\\s+\\"(?:GET|POST|HEAD|PUT|DELETE|OPTIONS)\\s+[^\\"]*\\"\\s+(?:401|403)\\b[^\\"]*\\"\\s+\\S+\\s+\\"[^\\"]*\\"\\s+\\"[^\\"]*(?:python-requests|curl|wget|masscan|sqlmap|nikto|nmap)[^\\"]*\\"

ignoreregex =
`;

  const jailLocal =
`# /etc/fail2ban/jail.local
[unified-website]
enabled  = true
port     = http,https
filter   = unified-website
logpath  = ${logPath}
backend  = auto
findtime = 600
maxretry = 15
bantime  = 3600

# On Debian/Ubuntu:
# - If you use nftables: banaction = nftables-multiport
# - If you use iptables : banaction = iptables-multiport
`;

  const commands = [
    'sudo apt update',
    'sudo apt install fail2ban -y',
    'sudo systemctl enable --now fail2ban',
    `sudo nano /etc/fail2ban/filter.d/${filterFileName}`,
    'sudo nano /etc/fail2ban/jail.local',
    'sudo fail2ban-client reload',
    'sudo fail2ban-client status unified-website'
  ];

  const testCommand = `sudo fail2ban-regex ${logPath} /etc/fail2ban/filter.d/${filterFileName}`;

  return { filterFileName, filterConf, jailLocal, commands, testCommand };
}

export async function analyzeRemoteAccessUnifiedLog({ pool, orgId, lines = 20000, fromMinutes = 1440 } = {}) {
  const cfg = await getSecurityConfig(pool, { orgId });
  if (!cfg.configured) {
    const err = new Error('Remote SSH is not configured. Open the Settings tab and set ssh_host / ssh_user / ssh_key_path.');
    err.code = 'not_configured';
    err.config = cfg;
    throw err;
  }

  const safeLogPath = safeAbsoluteRemotePath(cfg.logPath);
  if (!safeLogPath) {
    const err = new Error('Invalid log_path. Use an absolute path like /var/log/apache2/access_unified_website.log.');
    err.code = 'invalid_log_path';
    throw err;
  }

  const maxLines = 100000;
  const n = Math.max(100, Math.min(maxLines, Number(lines) || 20000));
  const mins = Math.max(1, Math.min(60 * 24 * 31, Number(fromMinutes) || 1440)); // cap at 31 days

  const maxBytes = 5 * 1024 * 1024;
  const remoteCmd = `tail -n ${Math.trunc(n)} -- ${shQuote(safeLogPath)} | head -c ${maxBytes}`;
  const args = [...getSshArgs(cfg), `${cfg.user}@${cfg.host}`, remoteCmd];

  let stdout = '';
  let stderr = '';
  try {
    const r = await execFileAsync('ssh', args, { timeout: 15000 });
    stdout = String(r.stdout || '');
    stderr = String(r.stderr || '');
  } catch (e) {
    stdout = String(e?.stdout || '');
    stderr = String(e?.stderr || e?.message || '');
    const combined = `${stderr}\n${stdout}`.toLowerCase();
    if (combined.includes('no such file') || combined.includes('cannot open')) {
      const err = new Error(`Log file not found: ${safeLogPath}`);
      err.code = 'log_missing';
      err.hint = 'Update Security → Settings → Remote log path, or ensure the file exists on the remote host.';
      throw err;
    }
    throw e;
  }

  const cutoffMs = Date.now() - mins * 60 * 1000;
  const linesRaw = stdout.split('\n').map((l) => l.replace(/\r/g, '')).filter(Boolean);

  const offenders = new Map(); // ip -> stats
  const patterns = new Map(); // name -> { count, samplePaths:Set }

  const addPatternHit = (name, path) => {
    const row = patterns.get(name) || { count: 0, samplePaths: new Set() };
    row.count += 1;
    if (row.samplePaths.size < 5) row.samplePaths.add(path);
    patterns.set(name, row);
  };

  const attackPathDefs = [
    { name: 'wp-login probing', re: /^\/wp-login\.php(?:[/?]|$)/i },
    { name: 'xmlrpc probing', re: /^\/xmlrpc\.php(?:[/?]|$)/i },
    { name: '.env probing', re: /^\/\.env(?:[/?]|$)/i },
    { name: 'admin probing', re: /^\/admin(?:[/?]|$)/i },
    { name: 'phpMyAdmin probing', re: /^\/phpmyadmin(?:[/?]|$)/i },
    { name: 'git probing', re: /^\/\.git(?:[/?]|$)/i },
  ];

  const uaAnomalyRe = /\b(python-requests|curl|wget|masscan|sqlmap|nikto|nmap)\b/i;

  let totalRequests = 0;
  for (const line of linesRaw) {
    const parsed = parseAccessLogLine(line);
    if (!parsed) continue;
    if (parsed.tsMs != null && parsed.tsMs < cutoffMs) continue;

    totalRequests += 1;

    const path = normalizePathForStats(parsed.path);
    const ip = parsed.ip;

    const st = offenders.get(ip) || {
      ip,
      count: 0,
      paths: new Map(),
      statusCodes: new Map(),
      perMinute: new Map(),
    };

    st.count += 1;
    st.paths.set(path, (st.paths.get(path) || 0) + 1);
    st.statusCodes.set(String(parsed.status), (st.statusCodes.get(String(parsed.status)) || 0) + 1);
    if (parsed.tsMs != null) {
      const minuteKey = Math.floor(parsed.tsMs / 60000);
      st.perMinute.set(minuteKey, (st.perMinute.get(minuteKey) || 0) + 1);
    }
    offenders.set(ip, st);

    if (parsed.status === 401 || parsed.status === 403) addPatternHit('auth/forbidden spikes (401/403)', path);
    if (parsed.status === 404) addPatternHit('not found spikes (404)', path);

    for (const def of attackPathDefs) {
      if (def.re.test(path)) addPatternHit(def.name, path);
    }
    if (parsed.ua && uaAnomalyRe.test(parsed.ua)) addPatternHit('suspicious user-agents', path);
  }

  const uniqueIPs = offenders.size;
  const topOffenders = Array.from(offenders.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 25)
    .map((st) => {
      const topPaths = Array.from(st.paths.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([p]) => p);
      const statusCodes = {};
      for (const [k, v] of st.statusCodes.entries()) statusCodes[k] = v;
      const burstMaxPerMinute = st.perMinute.size ? Math.max(...Array.from(st.perMinute.values())) : 0;
      return { ip: st.ip, count: st.count, paths: topPaths, statusCodes, burstMaxPerMinute };
    });

  const suspiciousPatterns = Array.from(patterns.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([pattern, row]) => ({ pattern, count: row.count, samplePaths: Array.from(row.samplePaths) }));

  const recommendedFail2ban = buildRecommendedFail2ban({ logPath: safeLogPath });
  const timeRange = mins === 60 ? 'last 1h' : mins === 1440 ? 'last 24h' : mins === 10080 ? 'last 7d' : `last ${mins} minutes`;

  return {
    timeRange,
    totalRequests,
    uniqueIPs,
    topOffenders,
    suspiciousPatterns,
    recommendedFail2ban,
    warnings: stderr && stderr.trim() ? [stderr.trim().split('\n').slice(0, 2).join('\n')] : [],
  };
}
