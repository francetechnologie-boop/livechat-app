import React, { useEffect, useMemo, useState } from 'react';
import { loadModuleState, saveModuleState } from '@app-lib/uiState';
import ConversationHubAndroidAgentPanel from './ConversationHubAndroidAgentPanel.jsx';

function SmallButton({ kind = 'secondary', disabled, onClick, children, title }) {
  const isPrimary = kind === 'primary';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={[
        'text-xs px-2 py-1 rounded border',
        isPrimary ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700' : 'bg-white hover:bg-gray-50',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export default function ConversationHubSettingsPanel({ soundOnAnswer = true, onSoundOnAnswerChange = () => {} }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingLinks, setSavingLinks] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bots, setBots] = useState([]);
  const [selectedBotIds, setSelectedBotIds] = useState([]);
  const [welcomeMessages, setWelcomeMessages] = useState([]);
  const [botWelcomeMap, setBotWelcomeMap] = useState({});
  const [botWelcomeOrig, setBotWelcomeOrig] = useState({});
  const [cleanupVisitorId, setCleanupVisitorId] = useState(() => {
    try {
      const st = loadModuleState('conversation-hub');
      return st.lastVisitorId ? String(st.lastVisitorId) : '';
    } catch {
      return '';
    }
  });
  const [cleanupScope, setCleanupScope] = useState('email'); // 'email' | 'visitor'
  const [dangerText, setDangerText] = useState('');
  const [purgeDays, setPurgeDays] = useState(30);
  const dangerOk = String(dangerText || '').trim().toUpperCase() === 'DELETE ALL';

  const [rememberLastChat, setRememberLastChat] = useState(() => {
    const st = loadModuleState('conversation-hub');
    return st.rememberLastChat !== false;
  });

  useEffect(() => {
    try {
      saveModuleState('conversation-hub', { rememberLastChat: !!rememberLastChat });
    } catch {}
  }, [rememberLastChat]);

  const selectedSet = useMemo(() => new Set(selectedBotIds.map(String)), [selectedBotIds]);

  const welcomeById = useMemo(() => {
    const map = new Map();
    for (const w of welcomeMessages || []) map.set(String(w.id || ''), w);
    return map;
  }, [welcomeMessages]);

  const fetchChatbots = async () => {
    try {
      const r1 = await fetch('/api/automation-suite/chatbots', { credentials: 'include' });
      if (r1.ok) return await r1.json();
    } catch {}
    try {
      const r2 = await fetch('/api/automations/chatbots', { credentials: 'include' });
      if (r2.ok) return await r2.json();
    } catch {}
    return [];
  };

  const load = async () => {
    setNotice('');
    setError('');
    setLoading(true);
    try {
      const [botsData, selRes, welcomeRes] = await Promise.all([
        fetchChatbots(),
        fetch('/api/conversation-hub/bots', { credentials: 'include' }),
        fetch('/api/automation-suite/welcome-messages', { credentials: 'include' }),
      ]);
      const [selData, welcomeData] = await Promise.all([
        selRes.ok ? selRes.json() : { ok: false, ids: [] },
        welcomeRes.ok ? welcomeRes.json().catch(() => ({})) : {},
      ]);

      const list = Array.isArray(botsData) ? botsData : [];
      const botsList = list
        .map((b) => ({
          id_bot: String(b.id_bot || '').trim(),
          name: b.name || b.id_bot || '',
          welcome_message_id: b.welcome_message_id != null ? String(b.welcome_message_id) : '',
        }))
        .filter((b) => b.id_bot);
      setBots(botsList);

      const welcomeItems = Array.isArray(welcomeData?.items) ? welcomeData.items : [];
      setWelcomeMessages(
        welcomeItems
          .map((w) => ({
            id: String(w?.id || '').trim(),
            title: String(w?.title || '').trim(),
          }))
          .filter((w) => w.id)
      );

      const initialMap = {};
      for (const b of botsList) initialMap[b.id_bot] = b.welcome_message_id || '';
      setBotWelcomeMap(initialMap);
      setBotWelcomeOrig(initialMap);

      const ids = Array.isArray(selData?.ids) ? selData.ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
      setSelectedBotIds(ids);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleBot = (id) => {
    const key = String(id || '').trim();
    if (!key) return;
    setSelectedBotIds((prev) => {
      const s = new Set(prev.map(String));
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return Array.from(s);
    });
  };

  const save = async () => {
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const ids = selectedBotIds.map((x) => String(x || '').trim()).filter(Boolean);
      const r = await fetch('/api/conversation-hub/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.ok === false) throw new Error(data?.error || 'save_failed');
      setSelectedBotIds(Array.isArray(data?.ids) ? data.ids : ids);
      setNotice('Saved.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveLinks = async () => {
    setError('');
    setNotice('');
    setSavingLinks(true);
    try {
      const ids = selectedBotIds.map((x) => String(x || '').trim()).filter(Boolean);
      for (const id of ids) {
        const next = String(botWelcomeMap?.[id] || '').trim();
        const prev = String(botWelcomeOrig?.[id] || '').trim();
        if (next === prev) continue;
        const r = await fetch(`/api/automation-suite/chatbots/${encodeURIComponent(id)}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ welcome_message_id: next || null }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.ok === false) throw new Error(j?.error || `save_link_failed:${id}`);
      }
      setBotWelcomeOrig((prev) => ({ ...prev, ...botWelcomeMap }));
      setNotice('Saved welcome-message links.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSavingLinks(false);
    }
  };

  const clearRemembered = () => {
    try { saveModuleState('conversation-hub', { lastVisitorId: null }); } catch {}
    setNotice('Cleared remembered conversation.');
  };

  const adminDelete = async ({ visitorId, scope, what }) => {
    const vid = String(visitorId || '').trim();
    if (!vid) throw new Error('visitorId required');
    const r = await fetch('/api/conversation-hub/admin/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ visitorId: vid, scope, what }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'delete_failed');
    return j;
  };

  const adminTruncate = async (whatArr) => {
    const r = await fetch('/api/conversation-hub/admin/truncate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ what: whatArr }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'truncate_failed');
    return j;
  };

  const adminPurge = async ({ what, olderThanDays }) => {
    const r = await fetch('/api/conversation-hub/admin/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ what, olderThanDays }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'purge_failed');
    return j;
  };
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">Settings</div>
        <div className="flex items-center gap-2">
          <SmallButton onClick={load} disabled={loading || saving} title="Reload settings">
            Reload
          </SmallButton>
          <SmallButton kind="primary" onClick={save} disabled={loading || saving} title="Save selected bots">
            {saving ? 'Saving…' : 'Save'}
          </SmallButton>
        </div>
      </div>

      <div className="rounded border bg-white">
        <div className="px-3 py-2 border-b font-medium">Chatbots used in Conversation Hub</div>
        <div className="p-3">
          {loading && <div className="text-sm text-gray-600">Loading…</div>}
          {!loading && bots.length === 0 && <div className="text-sm text-gray-600">No chatbots found.</div>}
          {!loading && bots.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {bots.map((b) => (
                <label key={b.id_bot} className="flex items-center gap-2 text-sm border rounded px-2 py-1 bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(String(b.id_bot))}
                    onChange={() => toggleBot(b.id_bot)}
                  />
                  <span className="font-medium">{b.name || b.id_bot}</span>
                  <span className="text-xs text-gray-500">{b.id_bot}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded border bg-white">
        <div className="px-3 py-2 border-b font-medium flex items-center justify-between gap-2">
          <div>Welcome message per chatbot</div>
          <SmallButton kind="primary" onClick={saveLinks} disabled={loading || saving || savingLinks} title="Save chatbot → welcome message links">
            {savingLinks ? 'Saving…' : 'Save links'}
          </SmallButton>
        </div>
        <div className="p-3 space-y-3">
          {loading && <div className="text-sm text-gray-600">Loading…</div>}
          {!loading && selectedBotIds.length === 0 && (
            <div className="text-sm text-gray-600">Select at least one chatbot above.</div>
          )}
          {!loading && selectedBotIds.length > 0 && (
            <div className="space-y-2">
              {selectedBotIds.map((id) => {
                const bot = (bots || []).find((b) => String(b.id_bot) === String(id)) || { id_bot: String(id), name: String(id) };
                const current = String(botWelcomeMap?.[bot.id_bot] || '');
                const w = current ? welcomeById.get(current) : null;
                return (
                  <div key={bot.id_bot} className="border rounded p-2 bg-white">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{bot.name || bot.id_bot}</div>
                        <div className="text-xs text-gray-500 truncate">{bot.id_bot}</div>
                      </div>
                      <div className="w-80 max-w-full">
                        <select
                          className="w-full border rounded px-2 py-1 text-sm"
                          value={current}
                          onChange={(e) => {
                            const next = String(e.target.value || '');
                            setBotWelcomeMap((prev) => ({ ...prev, [bot.id_bot]: next }));
                          }}
                        >
                          <option value="">(none)</option>
                          {(welcomeMessages || []).map((msg) => (
                            <option key={msg.id} value={msg.id}>
                              {msg.title ? `${msg.title} — ${msg.id}` : msg.id}
                            </option>
                          ))}
                        </select>
                        <div className="text-[11px] text-gray-500 mt-1 truncate">
                          {w ? `Selected: ${w.title || ''} (${w.id})` : 'No welcome message selected.'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded border bg-white">
        <div className="px-3 py-2 border-b font-medium">Conversation selection</div>
        <div className="p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rememberLastChat} onChange={(e) => setRememberLastChat(!!e.target.checked)} />
            Remember last opened chat
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!soundOnAnswer}
              onChange={(e) => onSoundOnAnswerChange(!!e.target.checked)}
            />
            Play a sound when a visitor receives an answer
          </label>
          <div className="text-[11px] text-gray-600">
            Note: browsers require one user interaction (click / keypress) before audio can play.
          </div>
          <div className="flex items-center gap-2">
            <SmallButton onClick={clearRemembered} disabled={!rememberLastChat} title="Clear stored last opened chat">
              Clear remembered chat
            </SmallButton>
          </div>
        </div>
      </div>

      <ConversationHubAndroidAgentPanel />

      <div className="rounded border bg-white">
        <div className="px-3 py-2 border-b font-medium">Danger zone (irreversible)</div>
        <div className="p-3 space-y-3">
          <div className="text-sm text-gray-700">
            Supprimer des données (visites/messages/visiteur). Ces actions sont irréversibles.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Visitor ID</label>
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                value={cleanupVisitorId}
                onChange={(e) => setCleanupVisitorId(e.target.value)}
                placeholder="visitor_id (ex: dbc5138b-a464-4f46-9e13-6aa95ce7f128)"
              />
              <div className="text-[11px] text-gray-500 mt-1">
                Astuce: si scope = “email”, on supprime aussi tous les autres visitor_id du même client (même customer_email).
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Scope</label>
              <select
                className="w-full border rounded px-2 py-1 text-sm"
                value={cleanupScope}
                onChange={(e) => setCleanupScope(String(e.target.value || 'visitor'))}
              >
                <option value="visitor">Only this visitor_id</option>
                <option value="email">All by customer_email (recommended)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <SmallButton
              disabled={cleanupBusy || !String(cleanupVisitorId || '').trim()}
              onClick={async () => {
                const vid = String(cleanupVisitorId || '').trim();
                if (!vid) return;
                if (!window.confirm(`Delete ALL messages for ${vid} (scope=${cleanupScope}) ?`)) return;
                setError(''); setNotice(''); setCleanupBusy(true);
                try {
                  const r = await adminDelete({ visitorId: vid, scope: cleanupScope, what: { messages: true } });
                  setNotice(`Deleted messages: ${r?.deleted?.messages ?? 0}`);
                } catch (e) { setError(e?.message || String(e)); }
                finally { setCleanupBusy(false); }
              }}
              title="Delete messages for this visitor (or by email scope)"
            >
              Delete messages
            </SmallButton>
            <SmallButton
              disabled={cleanupBusy || !String(cleanupVisitorId || '').trim()}
              onClick={async () => {
                const vid = String(cleanupVisitorId || '').trim();
                if (!vid) return;
                if (!window.confirm(`Delete ALL visits for ${vid} (scope=${cleanupScope}) ?`)) return;
                setError(''); setNotice(''); setCleanupBusy(true);
                try {
                  const r = await adminDelete({ visitorId: vid, scope: cleanupScope, what: { visits: true } });
                  setNotice(`Deleted visits: ${r?.deleted?.visits ?? 0}`);
                } catch (e) { setError(e?.message || String(e)); }
                finally { setCleanupBusy(false); }
              }}
              title="Delete visits for this visitor (or by email scope)"
            >
              Delete visits
            </SmallButton>
            <SmallButton
              disabled={cleanupBusy || !String(cleanupVisitorId || '').trim()}
              onClick={async () => {
                const vid = String(cleanupVisitorId || '').trim();
                if (!vid) return;
                if (!window.confirm(`Delete visitor + ALL data for ${vid} (scope=${cleanupScope}) ?`)) return;
                if (!window.confirm(`Last check: this is irreversible. Continue?`)) return;
                setError(''); setNotice(''); setCleanupBusy(true);
                try {
                  const r = await adminDelete({ visitorId: vid, scope: cleanupScope, what: { messages: true, visits: true, visitor: true } });
                  setNotice(`Deleted — messages: ${r?.deleted?.messages ?? 0}, visits: ${r?.deleted?.visits ?? 0}, visitors: ${r?.deleted?.visitors ?? 0}`);
                } catch (e) { setError(e?.message || String(e)); }
                finally { setCleanupBusy(false); }
              }}
              title="Delete visitor row + all messages + all visits"
            >
              Delete visitor + all
            </SmallButton>
          </div>

          <div className="border-t pt-3">
            <div className="text-sm font-medium">Purge older data</div>
            <div className="text-[11px] text-gray-600">
              Supprime les lignes plus anciennes que N jours (visits.occurred_at / messages.created_at).
            </div>
            <div className="flex flex-wrap gap-2 items-end mt-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Older than (days)</label>
                <input
                  className="border rounded px-2 py-1 text-sm w-32"
                  type="number"
                  min={1}
                  max={3650}
                  value={purgeDays}
                  onChange={(e) => setPurgeDays(Number(e.target.value || 0))}
                />
              </div>
              <SmallButton
                disabled={cleanupBusy || !(Number(purgeDays) > 0)}
                onClick={async () => {
                  const d = Number(purgeDays);
                  if (!Number.isFinite(d) || d <= 0) return;
                  if (!window.confirm(`Purge messages older than ${d} days?`)) return;
                  setError(''); setNotice(''); setCleanupBusy(true);
                  try {
                    const r = await adminPurge({ what: ['messages'], olderThanDays: d });
                    setNotice(`Purged messages: ${r?.deleted?.messages ?? 0}`);
                  } catch (e) { setError(e?.message || String(e)); }
                  finally { setCleanupBusy(false); }
                }}
              >
                Purge messages
              </SmallButton>
              <SmallButton
                disabled={cleanupBusy || !(Number(purgeDays) > 0)}
                onClick={async () => {
                  const d = Number(purgeDays);
                  if (!Number.isFinite(d) || d <= 0) return;
                  if (!window.confirm(`Purge visits older than ${d} days?`)) return;
                  setError(''); setNotice(''); setCleanupBusy(true);
                  try {
                    const r = await adminPurge({ what: ['visits'], olderThanDays: d });
                    setNotice(`Purged visits: ${r?.deleted?.visits ?? 0}`);
                  } catch (e) { setError(e?.message || String(e)); }
                  finally { setCleanupBusy(false); }
                }}
              >
                Purge visits
              </SmallButton>
              <SmallButton
                disabled={cleanupBusy || !(Number(purgeDays) > 0)}
                onClick={async () => {
                  const d = Number(purgeDays);
                  if (!Number.isFinite(d) || d <= 0) return;
                  if (!window.confirm(`Purge visits + messages older than ${d} days?`)) return;
                  if (!window.confirm('Last check: irreversible. Continue?')) return;
                  setError(''); setNotice(''); setCleanupBusy(true);
                  try {
                    const r = await adminPurge({ what: ['messages', 'visits'], olderThanDays: d });
                    setNotice(`Purged — messages: ${r?.deleted?.messages ?? 0}, visits: ${r?.deleted?.visits ?? 0}`);
                  } catch (e) { setError(e?.message || String(e)); }
                  finally { setCleanupBusy(false); }
                }}
              >
                Purge both
              </SmallButton>
            </div>

            <div className="text-sm font-medium text-red-700 mt-4">Delete ALL data</div>
            <div className="text-[11px] text-gray-600">
              Tapez <span className="font-mono">DELETE ALL</span> pour activer les boutons.
            </div>
            <div className="flex flex-wrap gap-2 items-end mt-2">
              <input
                className="border rounded px-2 py-1 text-sm w-48"
                value={dangerText}
                onChange={(e) => setDangerText(e.target.value)}
                placeholder="DELETE ALL"
              />
              <SmallButton
                disabled={cleanupBusy || !dangerOk}
                onClick={async () => {
                  if (!window.confirm('TRUNCATE ALL messages?')) return;
                  setError(''); setNotice(''); setCleanupBusy(true);
                  try { await adminTruncate(['messages']); setNotice('Truncated messages table.'); }
                  catch (e) { setError(e?.message || String(e)); }
                  finally { setCleanupBusy(false); }
                }}
              >
                Truncate messages
              </SmallButton>
              <SmallButton
                disabled={cleanupBusy || !dangerOk}
                onClick={async () => {
                  if (!window.confirm('TRUNCATE ALL visits?')) return;
                  setError(''); setNotice(''); setCleanupBusy(true);
                  try { await adminTruncate(['visits']); setNotice('Truncated visits table.'); }
                  catch (e) { setError(e?.message || String(e)); }
                  finally { setCleanupBusy(false); }
                }}
              >
                Truncate visits
              </SmallButton>
              <SmallButton
                disabled={cleanupBusy || !dangerOk}
                onClick={async () => {
                  if (!window.confirm('TRUNCATE ALL visitors?')) return;
                  if (!window.confirm('Last check: this removes all visitor identities. Continue?')) return;
                  setError(''); setNotice(''); setCleanupBusy(true);
                  try { await adminTruncate(['visitors']); setNotice('Truncated visitors table.'); }
                  catch (e) { setError(e?.message || String(e)); }
                  finally { setCleanupBusy(false); }
                }}
              >
                Truncate visitors
              </SmallButton>
              <SmallButton
                disabled={cleanupBusy || !dangerOk}
                onClick={async () => {
                  if (!window.confirm('TRUNCATE ALL (messages + visits + visitors)?')) return;
                  if (!window.confirm('Last check: irreversible. Continue?')) return;
                  setError(''); setNotice(''); setCleanupBusy(true);
                  try { await adminTruncate(['messages','visits','visitors']); setNotice('Truncated all Conversation Hub tables.'); }
                  catch (e) { setError(e?.message || String(e)); }
                  finally { setCleanupBusy(false); }
                }}
              >
                Truncate ALL
              </SmallButton>
            </div>
          </div>
        </div>
      </div>

      {!!error && <div className="text-sm text-red-600">{error}</div>}
      {!!notice && <div className="text-sm text-green-700">{notice}</div>}
    </div>
  );
}
