// OpenAI tools endpoints: list models for configured account
// Usage:
//   GET /api/tools/openai/models
//     Optional query params:
//       - base: override base URL (defaults to process.env.OPENAI_BASE_URL or https://api.openai.com/v1)
//       - apiKey: override API key (defaults to OPENAI_API_KEY or AZURE_OPENAI_API_KEY for Azure)
//       - azure|useAzure: truthy to force Azure OpenAI mode
//       - apiVersion: Azure API version (defaults to AZURE_OPENAI_API_VERSION or 2024-10-21)

export function registerOpenaiRoutes(app, ctx = {}) {
  // GET /api/tools/openai/models → { ok, provider, base, count, models: [] }
  app.get('/api/tools/openai/models', async (req, res) => {
    try {
      const q = req.query || {};
      const getSetting = typeof ctx.getSetting === 'function' ? ctx.getSetting : null;

      // Resolve base URL (supports OpenAI or Azure OpenAI)
      let base = String(q.base || process.env.OPENAI_BASE_URL || '').trim();
      if (!base && typeof getSetting === 'function') {
        try { base = String((await getSetting('OPENAI_BASE_URL')) || ''); } catch {}
      }
      // Allow Azure-specific base override via env or settings
      if (!base) {
        const azureBaseEnv = String(process.env.AZURE_OPENAI_BASE_URL || '').trim();
        let azureBaseSet = '';
        if (!azureBaseEnv && typeof getSetting === 'function') {
          try { azureBaseSet = String((await getSetting('AZURE_OPENAI_BASE_URL')) || ''); } catch {}
        }
        base = azureBaseEnv || azureBaseSet || '';
      }
      if (!base) base = 'https://api.openai.com/v1';
      base = base.replace(/\/+$/g, '');

      const forceAzure = /^(1|true|yes)$/i.test(String(q.azure || q.useAzure || ''));
      const isAzureBase = /\.azure\.com/i.test(base) || /azure/i.test(base);
      const isAzure = forceAzure || isAzureBase;

      // Pick API key based on provider
      const envAzureKey = String(process.env.AZURE_OPENAI_API_KEY || '').trim();
      const envOpenaiKey = String(process.env.OPENAI_API_KEY || '').trim();
      let apiKey = String(q.apiKey || (isAzure ? envAzureKey : envOpenaiKey) || '').trim();
      if (!apiKey && typeof getSetting === 'function') {
        try {
          if (isAzure) apiKey = String((await getSetting('AZURE_OPENAI_API_KEY')) || (await getSetting('OPENAI_API_KEY')) || '').trim();
          else apiKey = String((await getSetting('OPENAI_API_KEY')) || '').trim();
        } catch {}
      }
      if (!apiKey) return res.status(400).json({ ok: false, error: 'missing_api_key' });

      const timeoutMs = Math.min(20000, Math.max(3000, Number(process.env.OPENAI_LIST_TIMEOUT_MS || 10000)));
      const ac = new AbortController();
      const to = setTimeout(() => { try { ac.abort(); } catch {} }, timeoutMs);

      let url = '';
      let headers = {};
      if (isAzure) {
        let apiVersion = String(q.apiVersion || process.env.AZURE_OPENAI_API_VERSION || '').trim();
        if (!apiVersion && typeof getSetting === 'function') {
          try { apiVersion = String((await getSetting('AZURE_OPENAI_API_VERSION')) || ''); } catch {}
        }
        if (!apiVersion) apiVersion = '2024-10-21';
        url = base.replace(/\/+$/,'') + `/openai/deployments?api-version=${encodeURIComponent(apiVersion)}`;
        headers = { 'api-key': apiKey };
      } else {
        url = base + '/models';
        headers = { Authorization: `Bearer ${apiKey}` };
      }

      const resp = await fetch(url, { headers, signal: ac.signal });
      clearTimeout(to);
      let j = {};
      try { j = await resp.json(); } catch {}
      if (!resp.ok) {
        return res.status(resp.status).json({ ok: false, error: 'upstream_error', status: resp.status, message: (j && j.error && j.error.message) || resp.statusText });
      }

      let models = [];
      if (isAzure) {
        const arr = Array.isArray(j.value) ? j.value : [];
        models = arr.map((x) => (x && (x.model || x.id)) || null).filter(Boolean);
      } else {
        const arr = Array.isArray(j.data) ? j.data : [];
        models = arr.map((x) => (x && x.id) || null).filter(Boolean);
      }
      const list = Array.from(new Set(models)).sort();
      return res.json({ ok: true, provider: isAzure ? 'azure-openai' : 'openai', base, count: list.length, models: list });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: String(e?.message || e) });
    }
  });
}
