import fs from 'fs';
import path from 'path';

function safeReadJson(p) {
  try { if (!fs.existsSync(p)) return null; const txt = fs.readFileSync(p, 'utf8'); return JSON.parse(txt); } catch { return null; }
}

export function registerSidebarRoutes(app, ctx = {}) {
  const root = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '../../../'));
  const modulesDir = path.join(root, 'modules');

  app.get('/api/sidebar/tree', async (_req, res) => {
    try {
      const items = [];
      const entries = (() => { try { return fs.readdirSync(modulesDir, { withFileTypes: true }); } catch { return []; } })();
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const id = ent.name;
        if (id === 'shared' || id === 'types' || id === 'module-manager') continue;
        const modPath = path.join(modulesDir, id);
        const manifest = safeReadJson(path.join(modPath, 'config.json')) || {};
        const runtimeCfg = safeReadJson(path.join(modPath, 'module.config.json')) || {};
        const enabled = runtimeCfg.enabled !== false && (manifest.defaultActive !== false);
        if (!enabled) continue;
        const name = manifest.name || id;
        const category = (manifest.category || 'custom').toLowerCase();
        const icon = (manifest.icon || null);
        const order = Number(manifest.order || 0) || 0;
        const pathHash = `/#/${id}`;
        items.push({ id, name, category, path: pathHash, icon, order });
      }
      // group mapping and sort
      const groupOrder = ['core','data','automation','dev','custom'];
      const groupNames = {
        core: 'Core',
        data: 'Data',
        automation: 'Automation',
        dev: 'Development',
        custom: 'Custom'
      };
      const groupsMap = new Map();
      for (const it of items) {
        const g = groupOrder.includes(it.category) ? it.category : 'custom';
        if (!groupsMap.has(g)) groupsMap.set(g, []);
        groupsMap.get(g).push(it);
      }
      const groups = [];
      for (const g of groupOrder) {
        const arr = groupsMap.get(g) || [];
        arr.sort((a,b) => (a.order - b.order) || a.name.localeCompare(b.name));
        if (arr.length) groups.push({ id: g, name: groupNames[g] || g, items: arr });
      }
      // flat, sorted for simple clients
      const flat = groups.flatMap(g => g.items);
      res.json({ ok: true, items: flat, groups });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}
