// List MCP2 data sources relevant to Google API module (e.g., Gmail)
export function registerGoogleApiMcp2SourcesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ ok:false, error:'unauthorized' }); return null; });

  async function listByTypeCodes(codes = [], org = null, kindCodes = []) {
    if (!pool) return [];
    const filterKinds = Array.isArray(kindCodes) && kindCodes.length > 0;
    const q = `
      SELECT s.id, s.name, s.kind_id, s.type_id, s.http_base, s.ws_url, s.stream_url, s.sse_url,
             s.enabled, s.options, s.org_id, s.created_at, s.updated_at,
             t.code AS type_code, k.code AS kind_code
        FROM public.mod_mcp2_server s
        LEFT JOIN public.mod_mcp2_type t ON t.id = s.type_id
        LEFT JOIN public.mod_mcp2_kind k ON k.id = s.kind_id
       WHERE (t.code = ANY($1))
         AND (s.org_id IS NOT DISTINCT FROM $2)
         ${filterKinds ? 'AND (k.code = ANY($3))' : ''}
       ORDER BY lower(s.name), s.updated_at DESC`;
    const params = filterKinds ? [codes, org, kindCodes] : [codes, org];
    const r = await pool.query(q, params);
    return r.rows || [];
  }

  app.get('/api/google-api/mcp2/sources', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const org = (req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null) || null;
      const typeOverride = String(req.query.type_code || '').trim();
      const kindOverride = String(req.query.kind_code || '').trim();
      const typeCodes = typeOverride ? typeOverride.split(/[,\s]+/).filter(Boolean) : [ 'Gmail_MCP_API_api', 'Gmail_API', 'Google_API' ];
      const kindCodes = kindOverride ? kindOverride.split(/[,\s]+/).filter(Boolean) : [];
      const items = await listByTypeCodes(typeCodes, org, kindCodes);
      res.json({ ok:true, items });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
