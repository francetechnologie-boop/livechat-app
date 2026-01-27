import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const frontendRoot = path.resolve(__dirname, '..');
  const srcRoot = path.resolve(frontendRoot, 'node_modules', 'tinymce');
  const destRoot = path.resolve(frontendRoot, 'public', 'tinymce');

  if (!(await exists(srcRoot))) {
    console.warn(`[tinymce] Not installed at ${srcRoot} (skipping assets sync)`);
    return;
  }

  await fs.mkdir(path.dirname(destRoot), { recursive: true });
  await fs.rm(destRoot, { recursive: true, force: true });
  await fs.mkdir(destRoot, { recursive: true });

  const entries = ['icons', 'models', 'plugins', 'skins', 'themes', 'langs'];
  for (const name of entries) {
    const src = path.resolve(srcRoot, name);
    if (await exists(src)) {
      await fs.cp(src, path.resolve(destRoot, name), { recursive: true });
    }
  }

  console.log(`[tinymce] Synced assets → ${destRoot}`);
}

main().catch((err) => {
  console.error('[tinymce] Failed to sync assets:', err);
  process.exit(1);
});
