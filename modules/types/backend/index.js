export function register(app, ctx) {
  try {
    const key = '/api/types';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson || null;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  app.get('/api/types/ping', (_req, res) => res.json({ ok: true, module: 'types' }));
}

export default register;
