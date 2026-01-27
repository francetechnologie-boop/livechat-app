import React, { useEffect, useMemo, useState } from 'react';

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function nowIso() {
  try { return new Date().toISOString(); } catch { return ''; }
}

function maskToken(token) {
  try {
    const s = String(token || '');
    if (!s) return '';
    if (s.length <= 8) return '••••';
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  } catch { return ''; }
}

function normalizeServers(servers) {
  return (Array.isArray(servers) ? servers : [])
    .map((s) => ({
      id: String(s?.id || '').trim(),
      name: String(s?.name || '').trim(),
      token: String(s?.token || '').trim(),
    }))
    .filter((s) => s.id && s.name);
}

function normalizeSchema(schema) {
  const s = (schema && typeof schema === 'object' && !Array.isArray(schema)) ? schema : {};
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  return { ...s, type: type || 'object' };
}

function getToolSchema(tool) {
  const s = tool?.inputSchema || tool?.input_schema || {};
  return normalizeSchema(s);
}

function ToolField({ name, spec, value, required, onChange }) {
  const t = Array.isArray(spec?.type) ? spec.type[0] : spec?.type;
  const type = String(t || 'string');
  const desc = String(spec?.description || '');
  const hasEnum = Array.isArray(spec?.enum) && spec.enum.length > 0;
  const looksMultiline = type === 'string' && (name.toLowerCase().includes('sql') || name.toLowerCase().includes('text') || (desc && desc.length > 80));

  const wrap = (inner) => (
    <label className="block">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-gray-700">
          <span className="font-mono">{name}</span>
          {required ? <span className="text-red-600 ml-1">*</span> : null}
        </div>
        {type ? <div className="text-[11px] text-gray-400">{type}</div> : null}
      </div>
      {desc ? <div className="text-[11px] text-gray-500 mb-1">{desc}</div> : null}
      {inner}
    </label>
  );

  if (hasEnum) {
    return wrap(
      <select className="w-full border rounded px-2 py-1 text-sm bg-white" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {spec.enum.map((v) => (
          <option key={String(v)} value={String(v)}>{String(v)}</option>
        ))}
      </select>
    );
  }

  if (type === 'boolean') {
    return wrap(
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(!!e.target.checked)} />
        <span className="text-sm text-gray-700">{!!value ? 'true' : 'false'}</span>
      </div>
    );
  }

  if (type === 'integer' || type === 'number') {
    return wrap(
      <input
        className="w-full border rounded px-2 py-1 text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={Object.prototype.hasOwnProperty.call(spec || {}, 'default') ? String(spec.default) : ''}
        type="number"
      />
    );
  }

  if (type === 'array' || type === 'object') {
    const placeholder = type === 'array' ? '[\n  \n]' : '{\n  \n}';
    return wrap(
      <textarea
        className="w-full border rounded px-2 py-1 text-xs font-mono"
        rows={type === 'array' ? 5 : 6}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  if (looksMultiline) {
    return wrap(
      <textarea className="w-full border rounded px-2 py-1 text-sm" rows={4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    );
  }

  return wrap(
    <input className="w-full border rounded px-2 py-1 text-sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  );
}

function buildArgsFromSchema(schema, values) {
  const s = normalizeSchema(schema);
  const props = (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) ? s.properties : {};
  const required = Array.isArray(s.required) ? s.required.map(String) : [];
  const out = {};
  const errors = {};
  const missing = (v) => v === undefined || v === null || v === '';

  for (const [key, specRaw] of Object.entries(props)) {
    const spec = (specRaw && typeof specRaw === 'object') ? specRaw : {};
    const t = Array.isArray(spec.type) ? spec.type[0] : spec.type;
    const type = String(t || 'string');
    const v = values ? values[key] : undefined;

    if (missing(v)) {
      if (required.includes(key)) errors[key] = 'required';
      continue;
    }

    if (type === 'boolean') {
      out[key] = !!v;
      continue;
    }

    if (type === 'integer') {
      const n = Number(v);
      if (!Number.isFinite(n)) { errors[key] = 'invalid_number'; continue; }
      out[key] = Math.trunc(n);
      continue;
    }

    if (type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) { errors[key] = 'invalid_number'; continue; }
      out[key] = n;
      continue;
    }

    if (type === 'array' || type === 'object') {
      if (typeof v === 'string') {
        const parsed = safeJsonParse(v);
        if (parsed == null) { errors[key] = 'invalid_json'; continue; }
        out[key] = parsed;
      } else {
        out[key] = v;
      }
      continue;
    }

    out[key] = v;
  }

  return { args: out, errors };
}

export default function McpInspectorPanel({ servers, defaultServerId }) {
  const list = useMemo(() => normalizeServers(servers), [servers]);
  const [serverId, setServerId] = useState(defaultServerId || (list[0]?.id || ''));

  useEffect(() => {
    if (defaultServerId) setServerId(defaultServerId);
  }, [defaultServerId]);

  useEffect(() => {
    if (!serverId && list[0]?.id) setServerId(list[0].id);
  }, [serverId, list]);

  const server = useMemo(() => list.find((s) => s.id === serverId) || null, [list, serverId]);
  const basePath = useMemo(() => (server?.name ? `/api/mcp2/${encodeURIComponent(server.name)}` : ''), [server?.name]);
  const postUrl = useMemo(() => (basePath ? `${basePath}/stream` : ''), [basePath]);

  const [tab, setTab] = useState('tools'); // tools | resources | templates | log
  const [rpcBusy, setRpcBusy] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const appendLog = (kind, payload) => {
    setLogLines((prev) => [...prev, { ts: nowIso(), kind: String(kind || 'info'), payload }].slice(-300));
  };

  const rpcCall = async (method, params) => {
    if (!postUrl) throw new Error('Select a server');
    setRpcBusy(true);
    try {
      const id = `ins_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
      const body = { jsonrpc: '2.0', id, method, params: params || {} };
      appendLog('rpc_request', body);
      const headers = { 'Content-Type': 'application/json' };
      const tok = String(server?.token || '').trim();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const r = await fetch(postUrl, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      appendLog('rpc_response', j);
      if (!r.ok) throw new Error(j?.error?.message || j?.message || j?.error || `http_${r.status}`);
      if (j?.error) throw new Error(j.error?.message || 'rpc_error');
      return j?.result;
    } finally {
      setRpcBusy(false);
    }
  };

  const [tools, setTools] = useState([]);
  const [toolQuery, setToolQuery] = useState('');
  const [selectedToolName, setSelectedToolName] = useState('');
  const [toolDef, setToolDef] = useState(null); // { title, json }
  const [toolDefLoading, setToolDefLoading] = useState(false);

  const refreshTools = async () => {
    try {
      const result = await rpcCall('tools/list', {});
      const arr = Array.isArray(result?.tools) ? result.tools : [];
      setTools(arr);
      if (!selectedToolName && arr[0]?.name) setSelectedToolName(String(arr[0].name));
    } catch (e) {
      appendLog('error', String(e?.message || e));
      setTools([]);
    }
  };

  const openToolDefinition = async () => {
    const name = String(selectedToolName || '').trim();
    if (!name) return;
    if (!serverId) { appendLog('error', 'Select a server'); return; }
    setToolDefLoading(true);
    try {
      const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(serverId)}/tools`, { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      const items = Array.isArray(j?.items) ? j.items : [];
      const found = items.find((t) => String(t?.name || '').trim() === name)
        || items.find((t) => String(t?.name || '').trim().toLowerCase() === name.toLowerCase())
        || null;
      if (!found) throw new Error(`Tool not found: ${name}`);
      setToolDef({
        title: `Tool definition: ${name}`,
        json: JSON.stringify({ input_schema: found.inputSchema || {}, code: found.code || {} }, null, 2),
      });
    } catch (e) {
      appendLog('error', String(e?.message || e));
    } finally {
      setToolDefLoading(false);
    }
  };

  useEffect(() => {
    setTools([]);
    setSelectedToolName('');
  }, [serverId]);

  useEffect(() => {
    if (serverId) refreshTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const filteredTools = useMemo(() => {
    const q = String(toolQuery || '').trim().toLowerCase();
    const arr = Array.isArray(tools) ? tools : [];
    const items = arr
      .map((t) => ({
        name: String(t?.name || '').trim(),
        description: String(t?.description || ''),
        inputSchema: t?.inputSchema || t?.input_schema || null,
      }))
      .filter((t) => t.name);
    if (!q) return items;
    return items.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }, [toolQuery, tools]);

  const selectedTool = useMemo(() => {
    const key = String(selectedToolName || '').trim();
    if (!key) return null;
    return (Array.isArray(tools) ? tools : []).find((t) => String(t?.name || '').trim() === key) || null;
  }, [tools, selectedToolName]);

  const schema = useMemo(() => getToolSchema(selectedTool), [selectedTool]);
  const properties = useMemo(() => (schema.properties && typeof schema.properties === 'object' ? schema.properties : {}), [schema]);
  const required = useMemo(() => new Set((Array.isArray(schema.required) ? schema.required : []).map(String)), [schema]);

  const [argValues, setArgValues] = useState({});
  const [argErrors, setArgErrors] = useState({});
  const [toolResult, setToolResult] = useState(null);
  const [toolResultMeta, setToolResultMeta] = useState(null); // { ok, ms }

  useEffect(() => {
    setArgErrors({});
    setToolResult(null);
    setToolResultMeta(null);
    const next = {};
    try {
      for (const [k, spec] of Object.entries(properties || {})) {
        if (spec && typeof spec === 'object' && Object.prototype.hasOwnProperty.call(spec, 'default')) next[k] = spec.default;
      }
    } catch {}
    setArgValues(next);
  }, [selectedToolName, properties]);

  const runTool = async () => {
    if (!selectedToolName) return;
    const { args, errors } = buildArgsFromSchema(schema, argValues);
    setArgErrors(errors);
    if (Object.keys(errors).length) return;
    try {
      const t0 = Date.now();
      const result = await rpcCall('tools/call', { name: selectedToolName, arguments: args });
      const ms = Date.now() - t0;
      setToolResult(result);
      const ok = !(result && typeof result === 'object' && (result.ok === false || result.error));
      setToolResultMeta({ ok, ms });
    } catch (e) {
      setToolResult({ ok: false, error: String(e?.message || e) });
      setToolResultMeta({ ok: false, ms: null });
    }
  };

  const [resources, setResources] = useState([]);
  const [templates, setTemplates] = useState([]);
  const refreshResources = async () => {
    try {
      const result = await rpcCall('resources/list', {});
      setResources(Array.isArray(result?.resources) ? result.resources : []);
    } catch (e) {
      appendLog('error', String(e?.message || e));
      setResources([]);
    }
  };
  const refreshTemplates = async () => {
    try {
      const result = await rpcCall('resources/templates/list', {});
      const arr = Array.isArray(result?.resourceTemplates) ? result.resourceTemplates : (Array.isArray(result?.resource_templates) ? result.resource_templates : []);
      setTemplates(arr);
    } catch (e) {
      appendLog('error', String(e?.message || e));
      setTemplates([]);
    }
  };

  useEffect(() => {
    if (!serverId) return;
    if (tab === 'resources') refreshResources();
    if (tab === 'templates') refreshTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, serverId]);

  const SmallTab = ({ id, children }) => (
    <button
      className={`text-xs px-2 py-1 rounded border ${tab === id ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-700 border-gray-300 hover:bg-gray-50'}`}
      onClick={() => setTab(id)}
      disabled={!server || rpcBusy}
    >
      {children}
    </button>
  );

  return (
    <div className="border rounded bg-white">
      <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">MCP Inspector</div>
        <div className="flex items-center gap-2">
          <select className="border rounded px-2 py-1 text-xs bg-white" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {list.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {server?.token ? <div className="text-[11px] text-gray-600">token: <span className="font-mono">{maskToken(server.token)}</span></div> : null}
          <button
            className="text-xs px-2 py-1 rounded border text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-60"
            onClick={async () => { try { await rpcCall('initialize', {}); } catch (e) { appendLog('error', String(e?.message || e)); } }}
            disabled={!server || rpcBusy}
          >
            Initialize
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <SmallTab id="tools">Tools</SmallTab>
          <SmallTab id="resources">Resources</SmallTab>
          <SmallTab id="templates">Templates</SmallTab>
          <SmallTab id="log">Log</SmallTab>
          <div className="text-[11px] text-gray-500 self-center">{rpcBusy ? 'Working…' : ''}</div>
        </div>

        {tab === 'tools' && (
          <div className="grid md:grid-cols-2 gap-3">
            <div className="border rounded">
              <div className="px-2 py-1 border-b bg-gray-50 text-[11px] text-gray-600 flex items-center justify-between gap-2">
                <div>Tools ({filteredTools.length})</div>
                <div className="flex items-center gap-2">
                  <button className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60" onClick={() => setToolQuery('')} disabled={!toolQuery}>
                    Clear
                  </button>
                  <button className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60" onClick={refreshTools} disabled={!server || rpcBusy}>
                    List Tools
                  </button>
                </div>
              </div>
              <div className="p-2 border-b">
                <input className="w-full border rounded px-2 py-1 text-sm" placeholder="Search tools…" value={toolQuery} onChange={(e) => setToolQuery(e.target.value)} />
              </div>
              <div className="max-h-[520px] overflow-auto">
                {filteredTools.map((t) => (
                  <button
                    key={t.name}
                    className={`w-full text-left px-2 py-2 border-b last:border-b-0 hover:bg-gray-50 ${selectedToolName === t.name ? 'bg-blue-50' : ''}`}
                    onClick={() => setSelectedToolName(t.name)}
                  >
                    <div className="text-xs font-mono truncate">{t.name}</div>
                    <div className="text-[11px] text-gray-600 truncate">{t.description || ''}</div>
                  </button>
                ))}
                {!filteredTools.length && (
                  <div className="px-2 py-3 text-xs text-gray-500">No tools found.</div>
                )}
              </div>
            </div>

            <div className="border rounded">
              {!selectedTool ? (
                <div className="p-3 text-sm text-gray-600">Select a tool to run.</div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b">
                    <div className="font-mono text-sm">{selectedToolName}</div>
                    {selectedTool?.description ? <div className="text-xs text-gray-600 mt-1">{String(selectedTool.description)}</div> : null}
                  </div>

                  <div className="p-3 space-y-3">
                    <div className="space-y-3">
                      {Object.keys(properties).length === 0 ? (
                        <div className="text-xs text-gray-500">No input parameters.</div>
                      ) : (
                        Object.entries(properties).map(([k, spec]) => (
                          <div key={k}>
                            <ToolField
                              name={k}
                              spec={spec}
                              value={argValues[k]}
                              required={required.has(k)}
                              onChange={(next) => setArgValues((prev) => ({ ...(prev || {}), [k]: next }))}
                            />
                            {argErrors[k] ? <div className="text-[11px] text-red-700 mt-1">Invalid: {argErrors[k]}</div> : null}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button className="text-sm px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60" onClick={runTool} disabled={!server || rpcBusy}>
                        Run Tool
                      </button>
                      <button
                        className="text-sm px-3 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        onClick={openToolDefinition}
                        disabled={!server || rpcBusy || toolDefLoading}
                        title="Show input_schema + code"
                      >
                        {toolDefLoading ? 'Loading…' : 'Definition'}
                      </button>
                      {toolResultMeta ? (
                        <div className={`text-xs ${toolResultMeta.ok ? 'text-green-700' : 'text-red-700'}`}>
                          Result: {toolResultMeta.ok ? 'Success' : 'Error'}{toolResultMeta.ms != null ? ` (${toolResultMeta.ms}ms)` : ''}
                        </div>
                      ) : null}
                    </div>

                    {toolResult != null && (
                      <div className="border rounded bg-gray-50">
                        <div className="px-2 py-1 border-b text-[11px] text-gray-600">Tool Result</div>
                        <pre className="p-2 text-[11px] whitespace-pre-wrap font-mono overflow-auto max-h-64">
                          {typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'resources' && (
          <div className="border rounded">
            <div className="px-2 py-1 border-b bg-gray-50 text-[11px] text-gray-600 flex items-center justify-between">
              <div>Resources ({resources.length})</div>
              <button className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60" onClick={refreshResources} disabled={!server || rpcBusy}>
                Refresh
              </button>
            </div>
            <div className="max-h-96 overflow-auto">
              {resources.map((r, idx) => (
                <div key={`${r?.uri || ''}_${idx}`} className="px-2 py-2 border-b last:border-b-0">
                  <div className="text-xs font-mono truncate" title={r?.uri || ''}>{r?.uri || ''}</div>
                  <div className="text-[11px] text-gray-600 truncate">{r?.name || ''}{r?.mimeType ? ` • ${r.mimeType}` : ''}</div>
                  {r?.description ? <div className="text-[11px] text-gray-500 mt-1">{r.description}</div> : null}
                </div>
              ))}
              {!resources.length && <div className="px-2 py-3 text-xs text-gray-500">No resources.</div>}
            </div>
          </div>
        )}

        {tab === 'templates' && (
          <div className="border rounded">
            <div className="px-2 py-1 border-b bg-gray-50 text-[11px] text-gray-600 flex items-center justify-between">
              <div>Templates ({templates.length})</div>
              <button className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60" onClick={refreshTemplates} disabled={!server || rpcBusy}>
                Refresh
              </button>
            </div>
            <div className="max-h-96 overflow-auto">
              {templates.map((t, idx) => (
                <div key={`${t?.name || ''}_${idx}`} className="px-2 py-2 border-b last:border-b-0">
                  <div className="text-xs font-mono truncate" title={t?.name || ''}>{t?.name || ''}</div>
                  <div className="text-[11px] text-gray-600 truncate" title={t?.uriTemplate || t?.uri_template || ''}>{t?.uriTemplate || t?.uri_template || ''}</div>
                  {t?.description ? <div className="text-[11px] text-gray-500 mt-1">{t.description}</div> : null}
                </div>
              ))}
              {!templates.length && <div className="px-2 py-3 text-xs text-gray-500">No templates.</div>}
            </div>
          </div>
        )}

        {tab === 'log' && (
          <div className="border rounded bg-gray-50 max-h-[520px] overflow-auto">
            <div className="px-2 py-1 border-b text-[11px] text-gray-600 flex items-center justify-between">
              <div>Log</div>
              <div className="flex items-center gap-2">
                <div className="text-gray-500">{logLines.length} lines</div>
                <button className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" onClick={() => setLogLines([])}>
                  Clear
                </button>
              </div>
            </div>
            <pre className="text-[11px] leading-5 p-2 whitespace-pre-wrap">
              {logLines.map((l, idx) => (
                <div key={idx}>
                  <span className="text-gray-500">[{l.ts}]</span>{' '}
                  <span className="text-gray-700">{l.kind}:</span>{' '}
                  <span className="font-mono">{typeof l.payload === 'string' ? l.payload : JSON.stringify(l.payload)}</span>
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>

      {toolDef ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setToolDef(null)}>
          <div className="bg-white rounded shadow-lg max-w-3xl w-full m-4" onClick={(e)=>e.stopPropagation()}>
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <div className="text-sm font-medium">{toolDef.title}</div>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  onClick={async () => { try { await navigator.clipboard.writeText(toolDef.json || ''); } catch {} }}
                >
                  Copy JSON
                </button>
                <button className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" onClick={() => setToolDef(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="p-3">
              <pre className="text-[11px] whitespace-pre-wrap font-mono max-h-[65vh] overflow-auto">{toolDef.json}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
