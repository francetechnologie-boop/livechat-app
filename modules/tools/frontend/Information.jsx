import React, { useEffect, useMemo, useState } from 'react';
import { attachAdminHeaders } from './utils/adminHeaders.js';

async function readJson(resp) {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: 'invalid_json', raw: text };
  }
}

async function adminFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const merged = attachAdminHeaders(Object.fromEntries(headers.entries()));
  return fetch(path, { credentials: 'include', ...options, headers: merged });
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
        active ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white hover:bg-gray-50 border-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function FilePicker({ onText, disabled }) {
  return (
    <label className={`inline-flex items-center gap-2 text-xs px-2 py-1 rounded border bg-white ${disabled ? 'opacity-60' : 'hover:bg-gray-50'}`}>
      <input
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0] || null;
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onText?.(String(reader.result || ''));
          reader.readAsText(file);
          e.target.value = '';
        }}
      />
      Charger un fichier .txt
    </label>
  );
}

function EditorPanel({
  title,
  content,
  setContent,
  updatedAt,
  busy,
  error,
  onReload,
  onSave,
}) {
  return (
    <div className="panel">
      <div className="panel__header flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          {updatedAt && <div className="text-[11px] text-gray-500">Dernière sauvegarde: {new Date(updatedAt).toLocaleString()}</div>}
        </div>
        <div className="flex items-center gap-2">
          <FilePicker disabled={busy} onText={(t) => setContent(String(t || ''))} />
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
            onClick={onReload}
            disabled={busy}
          >
            Recharger
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-blue-600 text-white hover:bg-blue-700"
            onClick={onSave}
            disabled={busy}
          >
            Enregistrer
          </button>
        </div>
      </div>
      <div className="panel__body">
        {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
        <textarea
          className="w-full min-h-[520px] font-mono text-[12px] rounded border px-3 py-2 bg-white"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Collez ici le contenu du fichier .txt (ou chargez un fichier)…"
        />
      </div>
    </div>
  );
}

export default function Information() {
  const [tab, setTab] = useState(() => {
    try {
      return String(localStorage.getItem('tools_information_tab') || 'my-text').trim() || 'my-text';
    } catch {
      return 'my-text';
    }
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  const [myText, setMyText] = useState('');
  const [mailcow, setMailcow] = useState('');
  const [meta, setMeta] = useState({ my_text_updated_at: null, mailcow_updated_at: null });

  useEffect(() => {
    try { localStorage.setItem('tools_information_tab', tab); } catch {}
  }, [tab]);

  const busy = loading || saving;

  const normalizedTab = useMemo(() => {
    const t = String(tab || '').toLowerCase();
    return t === 'mailcow' ? 'mailcow' : 'my-text';
  }, [tab]);

  const loadSettings = async () => {
    setLoading(true);
    setError('');
    setSaveMsg('');
    try {
      const resp = await adminFetch('/api/tools/information/settings');
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setMyText(String(data?.settings?.my_text_content || ''));
      setMailcow(String(data?.settings?.mailcow_content || ''));
      setMeta({
        my_text_updated_at: data?.meta?.my_text_updated_at ?? null,
        mailcow_updated_at: data?.meta?.mailcow_updated_at ?? null,
      });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (which) => {
    setSaving(true);
    setError('');
    setSaveMsg('');
    try {
      const payload = {};
      if (which === 'my-text') payload.my_text_content = String(myText || '');
      if (which === 'mailcow') payload.mailcow_content = String(mailcow || '');
      const resp = await adminFetch('/api/tools/information/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setMyText(String(data?.settings?.my_text_content || ''));
      setMailcow(String(data?.settings?.mailcow_content || ''));
      setMeta({
        my_text_updated_at: data?.meta?.my_text_updated_at ?? null,
        mailcow_updated_at: data?.meta?.mailcow_updated_at ?? null,
      });
      setSaveMsg('Enregistré.');
      setTimeout(() => setSaveMsg(''), 1200);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <TabButton active={normalizedTab === 'my-text'} onClick={() => setTab('my-text')}>My_Text</TabButton>
          <TabButton active={normalizedTab === 'mailcow'} onClick={() => setTab('mailcow')}>Mailcow</TabButton>
        </div>
        <div className="text-xs text-gray-500">{busy ? 'Chargement…' : (saveMsg || '')}</div>
      </div>

      {normalizedTab === 'my-text' && (
        <EditorPanel
          title="My_Text"
          content={myText}
          setContent={setMyText}
          updatedAt={meta.my_text_updated_at}
          busy={busy}
          error={error}
          onReload={loadSettings}
          onSave={() => saveSettings('my-text')}
        />
      )}

      {normalizedTab === 'mailcow' && (
        <EditorPanel
          title="Mailcow"
          content={mailcow}
          setContent={setMailcow}
          updatedAt={meta.mailcow_updated_at}
          busy={busy}
          error={error}
          onReload={loadSettings}
          onSave={() => saveSettings('mailcow')}
        />
      )}
    </div>
  );
}

