import { registerZasilkovnaRoutes } from './routes/zasilkovna.routes.js';
import { onModuleLoaded } from './hooks.js';
import { installModule } from './installer.js';

export function register(app, ctx) {
  try {
    const key = '/api/grabbing-zasilkovna';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) {
      app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false }));
      mounted.add(key);
    }
  } catch {}

  const registerCron = (action) => {
    try { ctx?.registerCronAction?.(action); } catch {}
  };
  registerCron({
    id: 'packeta_download',
    module_id: 'grabbing-zasilkovna',
    name: 'Zásilkovna download',
    description: 'Download Zásilkovna CSV and import it (steps 1‑4)',
    method: 'POST',
    path: '/api/grabbing-zasilkovna/download-and-import/:config_id',
    payload_template: { debug: false },
    metadata: { path_params: { config_id: 'options.grabbing_id' } },
  });
  registerCron({
    id: 'packeta_download_step1',
    module_id: 'grabbing-zasilkovna',
    name: 'Zásilkovna download (Step 1)',
    description: 'Download the latest Packeta CSV only.',
    method: 'POST',
    path: '/api/grabbing-zasilkovna/download/using-config/:config_id',
    payload_template: { debug: false },
    metadata: { path_params: { config_id: 'options.grabbing_id' } },
  });

  installModule().catch(() => {});
  onModuleLoaded(ctx).catch(() => {});
  registerZasilkovnaRoutes(app, ctx);
}

try { app.get('/api/grabbing-zasilkovna/ping', (_req, res) => res.json({ ok: true, module: 'grabbing-zasilkovna' })); } catch {}
