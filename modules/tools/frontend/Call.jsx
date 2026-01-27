import React, { useEffect, useMemo, useState } from "react";

function getAdminToken() {
  try {
    return String(localStorage.getItem("ADMIN_TOKEN") || "").trim();
  } catch {
    return "";
  }
}

async function adminFetch(path, options = {}) {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has("x-admin-token")) headers.set("x-admin-token", token);
  return fetch(path, { credentials: "include", ...options, headers });
}

async function readJsonResponse(resp) {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

function formatWhen(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  } catch {
    return String(value);
  }
}

export default function Call() {
  const [cfg, setCfg] = useState({ base_url: "", endpoints: null, token: "", has_token: false });
  const [calls, setCalls] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [placeTo, setPlaceTo] = useState("");
  const [lastPlace, setLastPlace] = useState(null);
  const [lines, setLines] = useState([]);
  const [defaultSub, setDefaultSub] = useState(null);
  const [fromLineSub, setFromLineSub] = useState("");

  const [status, setStatus] = useState({
    socket_connected: false,
    socket_count: 0,
    device_socket_connected: false,
    device_socket_count: 0,
    temp_socket_count: 0,
    socket_since: null,
    last_activity_at: null,
  });
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [configRevealed, setConfigRevealed] = useState(false);

  async function loadConfig(reveal = false) {
    try {
      const r = await adminFetch(`/api/admin/gateway/config${reveal ? "?reveal=1" : ""}`);
      const j = await readJsonResponse(r);
      if (!r.ok || !j.ok) throw new Error(j.error || `http_${r.status}`);
      setCfg({ base_url: j.base_url || "", endpoints: j.endpoints || null, token: j.token || "", has_token: !!j.has_token });
      setConfigRevealed(reveal);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }
  useEffect(() => {
    loadConfig(false);
  }, []);

  async function loadStatus() {
    try {
      const r = await adminFetch("/api/admin/gateway/status");
      const j = await readJsonResponse(r);
      if (r.ok && j && j.ok) {
        setStatus({
          socket_connected: !!j.socket_connected,
          socket_count: j.socket_count || 0,
          device_socket_connected: !!(j.device_socket_connected ?? j.socket_connected),
          device_socket_count: j.device_socket_count || 0,
          temp_socket_count: j.temp_socket_count || 0,
          socket_since: j.socket_since || null,
          last_activity_at: j.last_activity_at || null,
        });
      }
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const r = await adminFetch("/api/admin/gateway/logs");
      const j = await readJsonResponse(r);
      if (!r.ok || !j.ok) throw new Error(j.error || `http_${r.status}`);
      setLogs(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLogsLoading(false);
    }
  }

  async function fetchCalls() {
    setBusy(true);
    setError("");
    try {
      const r = await adminFetch("/api/admin/gateway/calls?limit=200");
      const j = await readJsonResponse(r);
      if (!r.ok || !j.ok) throw new Error(j.error || `http_${r.status}`);
      setCalls(Array.isArray(j.items) ? j.items : []);
    } catch (e) { setError(String(e?.message || e)); } finally { setBusy(false); }
  }
  useEffect(() => {
    fetchCalls();
    loadStatus();
    loadLines();
    const t = window.setInterval(() => {
      loadStatus();
    }, 3000);
    return () => window.clearInterval(t);
  }, []);

  const androidSnippet = useMemo(() => {
    const base = (cfg.base_url || window.location.origin || "").replace(/\/$/, "");
    return `object Config {\n    const val BASE_URL = "${base || "https://example.com"}"\n    const val SOCKET_URL = BASE_URL\n    const val SOCKET_PATH = "/socket"\n    const val SOCKET_NAMESPACE = "/gateway"\n\n    // Gateway HTTP endpoints (namespaced)\n    const val API_SMS_INCOMING = "$BASE_URL/api/gateway/sms/incoming"\n    const val API_SMS_STATUS   = "$BASE_URL/api/gateway/sms/status"\n    const val API_CALL_LOG     = "$BASE_URL/api/gateway/calls"\n\n    // For testing only — prefer loading from secure storage at runtime\n    const val GATEWAY_TOKEN = "REPLACE_WITH_SECURE_TOKEN"\n    const val NOTIF_CHANNEL_ID = "gateway"\n}`;
  }, [cfg.base_url, cfg.token]);

  function copy(text) { try { navigator.clipboard.writeText(text); } catch {} }

  function openSmsTo(phone) {
    const p = String(phone || "").trim();
    if (!p) return;
    try { localStorage.setItem("tools_sms_prefill_to", p); } catch {}
    try { window.location.hash = "#/tools/SMS"; } catch {}
  }

  function peerNumberForCall(c) {
    const dir = String(c?.direction || "").toLowerCase();
    const from = String(c?.from_number || "").trim();
    const to = String(c?.to_number || "").trim();
    if (dir === "out") return to || from;
    if (dir === "in") return from || to;
    return to || from;
  }

  async function loadLines() {
    try {
      const r = await adminFetch("/api/admin/gateway/lines");
      const j = await readJsonResponse(r);
      if (!r.ok || !j.ok) throw new Error(j.error || `http_${r.status}`);
      setLines(Array.isArray(j.items) ? j.items : []);
      setDefaultSub(j.default_subscription_id ?? null);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  useEffect(() => {
    if (!fromLineSub && defaultSub != null && Array.isArray(lines) && lines.length) {
      const li = lines.find((x) => String(x.subscription_id) === String(defaultSub));
      if (li) setFromLineSub(String(li.subscription_id));
    }
  }, [lines, defaultSub]);

  async function placeCall(toOverride) {
    setBusy(true);
    setError("");
    try {
      setLastPlace(null);
      const to = String(toOverride || placeTo || "").trim();
      if (!to) throw new Error("missing_to");
      const subscription_id = fromLineSub ? Number(fromLineSub) : null;
      const payload = { to };
      if (subscription_id != null && Number.isFinite(subscription_id)) payload.subscription_id = subscription_id;
      const r = await adminFetch("/api/admin/gateway/call/make", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await readJsonResponse(r);
      setLastPlace({ status: r.status, body: j });
      if (!r.ok || !j.ok) throw new Error(j.error || `http_${r.status}`);
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg === "no_device" || msg === "no_client") {
        setError('Gateway Android non connecté (no_device). Aller sur "#/gateway" et vérifier la connexion (token + Socket.IO).');
      } else if (msg === "loopback_client") {
        setError('ACK loopback (client navigateur). Le Gateway Android n’a pas reçu la commande. Fermer le client temp et connecter l’app Android.');
      } else {
        setError(msg);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="panel max-w-5xl">
        <div className="panel__header">Call Logs</div>
        <div className="panel__body">
          {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
          <div className="flex items-center gap-3 mb-2 text-xs text-gray-600">
            <div>
              Gateway device:{" "}
              <span className={status.device_socket_connected ? "text-green-700" : "text-red-700"}>
                {status.device_socket_connected ? "connected" : "disconnected"}
              </span>{" "}
              ({status.device_socket_count || 0})
            </div>
            {status.temp_socket_count ? <div>temp: {status.temp_socket_count}</div> : null}
            <div>Last activity: {formatWhen(status.last_activity_at) || "—"}</div>
            <button className="text-xs px-2 py-0.5 border rounded" onClick={() => { setLogsOpen((v) => !v); if (!logsOpen) loadLogs(); }}>
              {logsOpen ? "Hide gateway logs" : "Show gateway logs"}
            </button>
          </div>
          {logsOpen && (
            <div className="mb-3 border rounded bg-gray-50 p-2">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-xs px-2 py-0.5 border rounded" onClick={loadLogs} disabled={logsLoading}>
                  {logsLoading ? "Loading…" : "Refresh logs"}
                </button>
                <div className="text-xs text-gray-500">Look for <code>unauthorized_calls</code> or <code>call_log_bad_request</code>.</div>
              </div>
              <div className="max-h-64 overflow-auto">
                <pre className="text-xs whitespace-pre-wrap"><code>{logs.map((x) => JSON.stringify(x)).join("\n")}</code></pre>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 mb-2">
            <button className="btn" onClick={fetchCalls} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
            <div className="text-xs text-gray-500">Phone should POST to <code>/api/gateway/calls</code> with <code>x-gateway-token</code>.</div>
          </div>
          <div className="overflow-auto">
            <table className="table-auto text-sm min-w-[600px]">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">When</th>
                  <th className="px-2 py-1">From</th>
                  <th className="px-2 py-1">To</th>
                  <th className="px-2 py-1">Direction</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Duration</th>
                  <th className="px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-2 py-1 whitespace-nowrap">{formatWhen(c.started_at || c.created_at || "")}</td>
                    <td className="px-2 py-1">{c.from_number || ''}</td>
                    <td className="px-2 py-1">{c.to_number || ''}</td>
                    <td className="px-2 py-1">{c.direction || ''}</td>
                    <td className="px-2 py-1">{c.status || ''}</td>
                    <td className="px-2 py-1">{c.duration_sec != null ? `${c.duration_sec}s` : ''}</td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 mr-2"
                        onClick={() => placeCall(peerNumberForCall(c))}
                        disabled={busy || !peerNumberForCall(c)}
                        title={peerNumberForCall(c) ? `Call ${peerNumberForCall(c)}` : "Missing number"}
                      >
                        Call
                      </button>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        onClick={() => openSmsTo(peerNumberForCall(c))}
                        disabled={!peerNumberForCall(c)}
                        title={peerNumberForCall(c) ? `Send SMS to ${peerNumberForCall(c)}` : "Missing number"}
                      >
                        Send SMS
                      </button>
                    </td>
                  </tr>
                ))}
                {!calls.length && (
                  <tr>
                    <td className="px-2 py-2 text-gray-500" colSpan={7}>
                      No calls yet. If your Android logs show <code>ok=false</code>, open gateway logs above to see why.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">Android config</div>
            <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto"><code>{androidSnippet}</code></pre>
            <button className="text-xs px-2 py-0.5 border rounded" onClick={() => copy(androidSnippet)}>Copy snippet</button>
            <div className="mt-2 text-xs text-gray-500">
              Gateway token:{" "}
              {cfg.has_token ? (
                <>
                  {configRevealed ? <code>(revealed)</code> : <code>(hidden)</code>}{" "}
                  {!configRevealed && (
                    <button className="text-xs px-2 py-0.5 border rounded ml-2" onClick={() => loadConfig(true)} disabled={busy}>
                      Reveal token
                    </button>
                  )}
                </>
              ) : (
                <span className="text-red-700">not set</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="panel max-w-5xl">
        <div className="panel__header">Place Call (server → phone)</div>
        <div className="panel__body">
          {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
          <div className="flex items-center gap-2 mb-2">
            <select className="input" value={fromLineSub} onChange={(e) => setFromLineSub(e.target.value)} title="SIM/line">
              <option value="">Default / auto</option>
              {lines.map((li) => {
                const label = [
                  li.msisdn || "(no number)",
                  `sub:${li.subscription_id}`,
                  li.carrier || "",
                  li.display_name || "",
                  li.sim_slot != null ? `SIM${li.sim_slot}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <option key={li.id} value={String(li.subscription_id)}>
                    {label}
                  </option>
                );
              })}
            </select>
            <input className="input flex-1" placeholder="+33..." value={placeTo} onChange={e=>setPlaceTo(e.target.value)} />
            <button className="btn" onClick={placeCall} disabled={busy || !placeTo.trim()}>{busy ? "Sending…" : "Place call"}</button>
            <button className="btn" onClick={() => openSmsTo(placeTo)} disabled={!placeTo.trim()}>
              Send SMS
            </button>
          </div>
          <div className="text-xs text-gray-500">Emits <code>call:make</code> to connected gateway phones. The phone should handle placing the call.</div>
          {lastPlace && (
            <pre className="text-xs whitespace-pre-wrap break-words bg-black/5 rounded p-3 mt-2">
              {JSON.stringify(lastPlace, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
