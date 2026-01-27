import { execFile } from 'child_process';

function execFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}

export async function getUfwStatus() {
  const { stdout, stderr } = await execFileAsync('ufw', ['status', 'verbose'], { timeout: 8000 });
  return String(stdout || stderr || '').trim();
}

