import React, { useEffect, useMemo, useRef, useState } from "react";
import SmsProductLinkModal from "./components/SmsProductLinkModal.jsx";

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

export default function Sms() {
  const [status, setStatus] = useState({
    socket_connected: false,
    socket_count: 0,
    device_socket_connected: false,
    device_socket_count: 0,
    temp_socket_count: 0,
    socket_since: null,
    last_activity_at: null,
  });
  const [lines, setLines] = useState([]);
  const [defaultSub, setDefaultSub] = useState(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logs, setLogs] = useState([]);

  const [conversationFilter, setConversationFilter] = useState("");
  const [activePeer, setActivePeer] = useState("");
  const [inboxAll, setInboxAll] = useState([]);
  const [inboxThread, setInboxThread] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);

  const [sendTo, setSendTo] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [fromLineSub, setFromLineSub] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSend, setLastSend] = useState(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerInitialMessage, setProductPickerInitialMessage] = useState("");
  const threadRef = useRef(null);
  const messageRef = useRef(null);
  const pollRef = useRef({ inboxAll: 0, inboxThread: 0 });
  const activePeerRef = useRef("");
  const busyRef = useRef(false);
  const loadingListRef = useRef(false);
  const loadingThreadRef = useRef(false);
  const wasAtBottomRef = useRef(true);

  function insertIntoMessage(text) {
    const insertText = String(text || "").trim();
    if (!insertText) return;
    const ta = messageRef.current;
    const current = String(sendBody || "");
    if (!ta || typeof ta.selectionStart !== "number" || typeof ta.selectionEnd !== "number") {
      const sep = current && !/\s$/.test(current) ? "\n" : "";
      setSendBody(`${current}${sep}${insertText}`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const sep = before && !/\s$/.test(before) ? "\n" : "";
    const next = `${before}${sep}${insertText}${after}`;
    setSendBody(next);
    const caret = before.length + sep.length + insertText.length;
    try {
      requestAnimationFrame(() => {
        try {
          ta.focus();
          ta.setSelectionRange(caret, caret);
        } catch {}
      });
    } catch {}
  }

  // Allow other Tools pages (e.g. Call) to initiate a conversation by setting a one-shot value in localStorage.
  useEffect(() => {
    try {
      const raw = String(localStorage.getItem("tools_sms_prefill_to") || "").trim();
      if (raw) {
        localStorage.removeItem("tools_sms_prefill_to");
        setActivePeer(raw);
        setSendTo(raw);
      }
    } catch {}
    // one-shot on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteConversation(phone) {
    const p = String(phone || "").trim();
    if (!p) return;
    if (!window.confirm(`Delete conversation with ${p}?\n\nThis will permanently remove all messages to/from this number from the server.`)) return;
    setBusy(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      qs.set("phone", p);
      const r = await adminFetch(`/api/admin/gateway/sms/conversation?${qs.toString()}`, { method: "DELETE" });
      const j = await readJsonResponse(r);
      if (!r.ok || !j.ok) throw new Error(j?.error || `http_${r.status}`);
      if (String(activePeerRef.current || "").trim() === p) {
        setActivePeer("");
        setInboxThread([]);
      }
      await loadInboxAll();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function loadStatus() {
    try {
      const r = await adminFetch("/api/admin/gateway/status");
      if (!r.ok) throw new Error(`http_${r.status}`);
      const j = await readJsonResponse(r);
      if (j && j.ok) {
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

  async function loadLines() {
    try {
      const r = await adminFetch("/api/admin/gateway/lines");
      if (!r.ok) throw new Error(`http_${r.status}`);
      const j = await readJsonResponse(r);
      if (j && j.ok) {
        setLines(j.items || []);
        setDefaultSub(j.default_subscription_id ?? null);
      }
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const r = await adminFetch("/api/admin/gateway/logs");
      if (!r.ok) throw new Error(`http_${r.status}`);
      const j = await readJsonResponse(r);
      if (j && j.ok && Array.isArray(j.items)) setLogs(j.items);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLogsLoading(false);
    }
  }

  async function loadInboxAll() {
    setLoadingList(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "600");
      const r = await adminFetch(`/api/admin/gateway/sms/inbox?${qs.toString()}`);
      if (!r.ok) throw new Error(`http_${r.status}`);
      const j = await readJsonResponse(r);
      if (j && j.ok && Array.isArray(j.items)) setInboxAll(j.items);
      else throw new Error(j?.error || "fetch_failed");
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoadingList(false);
    }
  }

  async function loadInboxThread(peer) {
    const p = String(peer || "").trim();
    if (!p) {
      setInboxThread([]);
      return;
    }
    setLoadingThread(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "800");
      qs.set("phone", p);
      const r = await adminFetch(`/api/admin/gateway/sms/inbox?${qs.toString()}`);
      if (!r.ok) throw new Error(`http_${r.status}`);
      const j = await readJsonResponse(r);
      if (j && j.ok && Array.isArray(j.items)) setInboxThread(j.items);
      else throw new Error(j?.error || "fetch_failed");
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoadingThread(false);
    }
  }

  useEffect(() => {
    loadStatus();
    loadLines();
    loadInboxAll();
    loadLogs();
    const t = setInterval(loadStatus, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!fromLineSub && defaultSub != null && Array.isArray(lines) && lines.length) {
      const li = lines.find((x) => String(x.subscription_id) === String(defaultSub));
      if (li) setFromLineSub(String(li.subscription_id));
    }
  }, [lines, defaultSub]);

  useEffect(() => {
    const peer = String(activePeer || "").trim();
    activePeerRef.current = peer;
    loadInboxThread(peer);
    if (peer) setSendTo(peer);
  }, [activePeer]);

  useEffect(() => {
    busyRef.current = !!busy;
  }, [busy]);
  useEffect(() => {
    loadingListRef.current = !!loadingList;
  }, [loadingList]);
  useEffect(() => {
    loadingThreadRef.current = !!loadingThread;
  }, [loadingThread]);

  // Lightweight polling to keep inbox/thread up-to-date without requiring a live socket in the browser.
  useEffect(() => {
    const intervalMs = 6000;
    const t = setInterval(() => {
      const now = Date.now();
      if (!busyRef.current && !loadingListRef.current && now - (pollRef.current.inboxAll || 0) > intervalMs - 500) {
        pollRef.current.inboxAll = now;
        loadInboxAll();
      }
      const peer = activePeerRef.current;
      if (peer && !busyRef.current && !loadingThreadRef.current && now - (pollRef.current.inboxThread || 0) > intervalMs - 500) {
        pollRef.current.inboxThread = now;
        loadInboxThread(peer);
      }
    }, intervalMs);
    return () => clearInterval(t);
  }, []);

  // Track if user is scrolled at bottom; used to keep "chat" feeling during polling.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const onScroll = () => {
      try {
        const slack = 16;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - slack;
        wasAtBottomRef.current = atBottom;
      } catch {}
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [activePeer]);

  const conversations = useMemo(() => {
    const map = new Map();
    for (const m of inboxAll || []) {
      const dir = m.direction;
      const peer = dir === "in" ? m.from_msisdn : m.to_msisdn;
      if (!peer) continue;
      const prev = map.get(peer);
      if (!prev || Number(m.id) > Number(prev.id)) map.set(peer, m);
    }
    return Array.from(map.entries())
      .map(([peer, last]) => ({ peer, last }))
      .sort((a, b) => Number(b.last?.id || 0) - Number(a.last?.id || 0));
  }, [inboxAll]);

  const filteredConversations = useMemo(() => {
    const q = String(conversationFilter || "").trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const peer = String(c.peer || "").toLowerCase();
      const lastText = String(c.last?.body || "").toLowerCase();
      return peer.includes(q) || lastText.includes(q);
    });
  }, [conversations, conversationFilter]);

  const activeConversation = useMemo(() => {
    const peer = String(activePeer || "").trim();
    if (!peer) return [];
    return (inboxThread || [])
      .filter((m) => m.from_msisdn === peer || m.to_msisdn === peer)
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id));
  }, [inboxThread, activePeer]);

  // Auto-scroll to bottom after updates if the user didn't scroll up.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (!wasAtBottomRef.current) return;
    try {
      el.scrollTop = el.scrollHeight;
    } catch {}
  }, [activeConversation.length, activePeer]);

  async function sendSms() {
    setBusy(true);
    setError("");
    setLastSend(null);
    try {
      const to = (sendTo || "").trim() || String(activePeer || "").trim();
      const message = (sendBody || "").trim();
      if (!to) throw new Error("missing_to");
      if (!message) throw new Error("missing_message");
      const subscription_id = fromLineSub ? Number(fromLineSub) : null;
      const payload = { to, message };
      if (subscription_id != null && Number.isFinite(subscription_id)) payload.subscription_id = subscription_id;

      const r = await adminFetch("/api/admin/gateway/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await readJsonResponse(r);
      setLastSend({ status: r.status, body: j });
      if (!r.ok || !j.ok) throw new Error(j.error || `http_${r.status}`);
      setSendBody("");
      await loadInboxAll();
      await loadInboxThread(to);
      try { threadRef.current?.scrollTo?.({ top: threadRef.current.scrollHeight, behavior: "smooth" }); } catch {}
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg === "no_device" || msg === "no_client") {
        setError('Gateway Android non connecté (no_device). Aller sur "#/gateway" et vérifier la connexion (token + Socket.IO).');
      } else if (msg === "loopback_client") {
        setError('ACK loopback (client navigateur). Le Gateway Android n’a pas reçu la commande. Fermer le client temp et connecter l’app Android.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-3">
      <SmsProductLinkModal
        open={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        initialMessage={productPickerInitialMessage}
        onApply={(nextMessage) => {
          setSendBody(String(nextMessage || ""));
        }}
      />
      <div className="panel">
        <div className="panel__header flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>SMS</span>
            <span className={`text-xs ${status.device_socket_connected ? "text-emerald-700" : "text-gray-500"}`}>
              {status.device_socket_connected ? `Device connected (${status.device_socket_count || 0})` : "Device disconnected"}
            </span>
            {status.temp_socket_count ? <span className="text-xs text-gray-500">temp: {status.temp_socket_count}</span> : null}
            {status.last_activity_at ? <span className="text-xs text-gray-500">last: {formatWhen(status.last_activity_at)}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={loadInboxAll} disabled={busy || loadingList}>
              {loadingList ? "Refreshing…" : "Refresh"}
            </button>
            <button
              className="btn"
              onClick={async () => {
                const next = !logsOpen;
                setLogsOpen(next);
                if (next) await loadLogs();
              }}
              disabled={logsLoading}
              title="Shows recent gateway events: incoming SMS, status updates, and unauthorized attempts"
            >
              {logsOpen ? "Hide logs" : "Logs"}
            </button>
            <a className="btn" href="#/gateway" title="Gateway settings (token, phone status)">
              Gateway settings
            </a>
          </div>
        </div>
        <div className="panel__body space-y-2">
          {!!error && <div className="text-sm text-red-600">{error}</div>}
          {logsOpen && (
            <div className="border rounded bg-black/5 p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-gray-600">Recent gateway logs</div>
                <button className="text-xs px-2 py-0.5 rounded border bg-white hover:bg-gray-50" onClick={loadLogs} disabled={logsLoading}>
                  {logsLoading ? "Loading…" : "Refresh logs"}
                </button>
              </div>
              <div className="text-[11px] text-gray-600 mb-2">
                If SMS arrives on the phone but not here, look for <span className="font-mono">unauthorized_sms_incoming</span> or missing <span className="font-mono">incoming_sms</span>.
              </div>
              <div className="max-h-48 overflow-auto text-[11px] font-mono whitespace-pre-wrap break-words">
                {logs.slice(0, 60).map((l) => (
                  <div key={l.id} className="border-t first:border-t-0 py-1">
                    <span className="text-gray-500">{formatWhen(l.when)}</span>{" "}
                    <span className="text-gray-800">{String(l.kind || l.event || "event")}</span>{" "}
                    <span className="text-gray-600">{l.path ? String(l.path) : ""}</span>
                  </div>
                ))}
                {!logs.length && <div className="text-gray-500">No logs yet.</div>}
              </div>
            </div>
          )}
          {!status.socket_connected && (
            <div className="text-xs text-gray-600">
              Phone not connected. Receiving SMS requires your Android gateway app to POST to <span className="font-mono">/api/gateway/sms/incoming</span>. Sending from UI requires the phone to stay connected to Socket.IO (<span className="font-mono">/socket</span>, namespace <span className="font-mono">/gateway</span>).
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr] gap-3">
        <div className="panel min-h-0 flex flex-col">
          <div className="panel__header flex items-center justify-between">
            <span>Conversations</span>
            <span className="text-xs text-gray-500">{filteredConversations.length}</span>
          </div>
          <div className="panel__body min-h-0 flex flex-col gap-2">
            <input
              className="input"
              placeholder="Search number or text…"
              value={conversationFilter}
              onChange={(e) => setConversationFilter(e.target.value)}
            />
            <div className="min-h-0 overflow-auto border rounded">
              {filteredConversations.length === 0 && (
                <div className="p-3 text-xs text-gray-500">{loadingList ? "Loading…" : "No conversations yet."}</div>
              )}
              {filteredConversations.map((c) => {
                const m = c.last || {};
                const when = formatWhen(m.created_at);
                const active = String(activePeer) === String(c.peer);
                const preview = String(m.body || "").replace(/\s+/g, " ").trim().slice(0, 90);
                return (
                  <div
                    key={c.peer}
                    onClick={() => setActivePeer(c.peer)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActivePeer(c.peer);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`w-full text-left px-3 py-2 border-b hover:bg-gray-50 outline-none ${active ? "bg-blue-50" : "bg-white"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono text-xs text-gray-900">{c.peer}</div>
                      <div className="flex items-center gap-2">
                        <div className="text-[11px] text-gray-500 whitespace-nowrap">{when}</div>
                        <button
                          type="button"
                          className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteConversation(c.peer);
                          }}
                          disabled={busy}
                          title="Delete conversation"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 truncate">{preview || "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="panel min-h-0 flex flex-col">
          <div className="panel__header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Messages</span>
              {activePeer ? <span className="font-mono text-xs text-gray-600">{activePeer}</span> : null}
            </div>
            <div className="text-xs text-gray-500">
              {activePeer ? (loadingThread ? "Loading…" : `${activeConversation.length} messages`) : ""}
            </div>
          </div>

          {!activePeer ? (
            <div className="panel__body min-h-0 flex flex-col gap-3">
              <div className="text-sm text-gray-600">Select a conversation on the left, or start a new one.</div>
              <div className="grid gap-2 max-w-2xl">
                <div className="flex gap-2 items-center">
                  <label className="w-24 text-sm text-gray-600">From</label>
                  <select className="input flex-1" value={fromLineSub} onChange={(e) => setFromLineSub(e.target.value)}>
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
                </div>

                <div className="flex gap-2 items-center">
                  <label className="w-24 text-sm text-gray-600">To</label>
                  <input className="flex-1 input font-mono" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="+420…" />
                </div>

                <div className="flex gap-2 items-center">
                  <label className="w-24 text-sm text-gray-600">Message</label>
                  <textarea
                    className="flex-1 input min-h-[44px]"
                    value={sendBody}
                    onChange={(e) => setSendBody(e.target.value)}
                    ref={messageRef}
                    placeholder="Type your SMS…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!busy && (sendBody || "").trim()) sendSms();
                      }
                    }}
                  />
                </div>

                <div className="flex gap-2 items-center">
                  <button
                    className="btn"
                    onClick={() => {
                      setProductPickerInitialMessage(String(sendBody || ""));
                      setProductPickerOpen(true);
                    }}
                    disabled={busy}
                  >
                    Add product link
                  </button>
                  <button
                    className="btn"
                    onClick={async () => {
                      const to = String(sendTo || "").trim();
                      if (to) setActivePeer(to);
                      await sendSms();
                    }}
                    disabled={busy || !(sendTo || "").trim() || !(sendBody || "").trim()}
                  >
                    {busy ? "Sending…" : "Send"}
                  </button>
                  {!status.device_socket_connected && <span className="text-xs text-gray-500">Phone not connected</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="panel__body min-h-0 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-600">
                  {activePeer ? `Conversation with ${activePeer}` : ""}
                </div>
                <button className="btn" onClick={() => deleteConversation(activePeer)} disabled={busy || !activePeer}>
                  Delete conversation
                </button>
              </div>
              <div ref={threadRef} className="min-h-0 flex-1 overflow-auto space-y-2">
                {activeConversation.map((m) => {
                  const mine = m.direction === "out";
                  const when = formatWhen(m.created_at);
                  const text = m.body || "";
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`px-3 py-2 rounded-lg border max-w-[70%] ${mine ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"}`}>
                        <div className="text-[11px] text-gray-500 mb-1">{when}</div>
                        <div className="whitespace-pre-wrap break-words text-sm">{text}</div>
                        {(m.status || m.error) && (
                          <div className="text-[11px] text-gray-500 mt-1">
                            {m.status || ""} {m.error ? `· ${m.error}` : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!activeConversation.length && !loadingThread && (
                  <div className="text-xs text-gray-500">No messages for this conversation yet.</div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="flex gap-2 items-center">
                  <label className="w-24 text-sm text-gray-600">From</label>
                  <select className="input flex-1" value={fromLineSub} onChange={(e) => setFromLineSub(e.target.value)}>
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
                </div>

                <div className="flex gap-2 items-center">
                  <label className="w-24 text-sm text-gray-600">To</label>
                  <input className="flex-1 input font-mono" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={activePeer} />
                </div>
                <div className="flex gap-2 items-center">
                  <label className="w-24 text-sm text-gray-600">Message</label>
                  <textarea
                    className="flex-1 input min-h-[44px]"
                    value={sendBody}
                    onChange={(e) => setSendBody(e.target.value)}
                    ref={messageRef}
                    placeholder="Type your SMS…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!busy && (sendBody || "").trim()) sendSms();
                      }
                    }}
                  />
                </div>

                <div className="flex gap-2 items-center">
                  <button
                    className="btn"
                    onClick={() => {
                      setProductPickerInitialMessage(String(sendBody || ""));
                      setProductPickerOpen(true);
                    }}
                    disabled={busy}
                  >
                    Add product link
                  </button>
                  <button className="btn" onClick={sendSms} disabled={busy || !(sendBody || "").trim()}>
                    {busy ? "Sending…" : "Send"}
                  </button>
                  <button className="btn" onClick={() => loadInboxThread(activePeer)} disabled={loadingThread || busy}>
                    Refresh thread
                  </button>
                  <button className="btn" onClick={() => setActivePeer("")} disabled={busy}>
                    Close
                  </button>
                  {!status.socket_connected && <span className="text-xs text-gray-500">Phone not connected</span>}
                </div>

                {lastSend && (
                  <pre className="text-xs whitespace-pre-wrap break-words bg-black/5 rounded p-3">
                    {JSON.stringify(lastSend, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
