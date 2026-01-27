import React, { useEffect, useState } from 'react';
import { loadUIState, saveUIState } from '@app-lib/uiState';

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
];

export default function AgentSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [preferred_lang, setLang] = useState('en');
  const [theme_color, setTheme1] = useState('#2563eb');
  const [theme_color2, setTheme2] = useState('#0d9488');
  const [notifications, setNotifications] = useState({ email: true, desktop: true, sound: false, soundType: 'beep_high', duration: 0.9, volume: 0.25 });
  const [previewTheme, setPreviewTheme] = useState(false);
  // UI / Navigation
  const [restore_on_login, setRestoreOnLogin] = useState(true);
  const [per_device_ui, setPerDeviceUi] = useState(false);
  const [restore_scroll, setRestoreScroll] = useState(true);
  const [persist_drafts, setPersistDrafts] = useState(true);
  const [compact_sidebar, setCompactSidebar] = useState(false);
  const [open_submenus_on_hover, setOpenHover] = useState(false);
  const [default_module, setDefaultModule] = useState('module-manager');
  const [keyboard_shortcuts, setKbShortcuts] = useState(true);
  // Display
  const [time_format, setTimeFormat] = useState('24h');
  const [date_format, setDateFormat] = useState('YYYY-MM-DD');
  // Security override (optional)
  const [ip_allowlist_text, setIpAllowlistText] = useState('');
  // Debug
  const [debug_panels, setDebugPanels] = useState(false);

  // Per-user sidebar visibility
  const [meLite, setMeLite] = useState(null);
  const [sidebarList, setSidebarList] = useState([]); // [{entry_id,label}]
  const [sidebarVisibleIds, setSidebarVisibleIds] = useState([]);
  useEffect(() => {
    // Load current user + current visible set (from server ui_state or local UI state)
    (async () => {
      try { const r = await fetch('/api/auth/me', { credentials: 'include' }); if (r.ok) setMeLite(await r.json()); } catch {}
      try {
        const st = loadUIState((meLite && meLite.id) || undefined) || {};
        const vis = Array.isArray(st?.sidebar?.visible_ids) ? st.sidebar.visible_ids.map(String) : [];
        setSidebarVisibleIds(vis);
      } catch {}
      try {
        const r = await fetch('/api/sidebar/tree?level=0', { credentials: 'include' });
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items.map(x => ({ entry_id: String(x.entry_id||''), label: String(x.label||'') })) : [];
        setSidebarList(items);
        if (!sidebarVisibleIds?.length && items.length) setSidebarVisibleIds(items.map(i => i.entry_id));
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveSidebarVisibility = async () => {
    try {
      // Merge into existing ui_state on the server for persistence
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      const u = r.ok ? await r.json() : null;
      const cur = (u && typeof u.ui_state === 'object') ? u.ui_state : (loadUIState(u?.id) || {});
      const next = { ...cur, sidebar: { ...(cur?.sidebar||{}), visible_ids: [...sidebarVisibleIds] } };
      await fetch('/api/me', { method:'PATCH', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ ui_state: next }) });
      try { if (u && u.id != null) saveUIState(u.id, next); else saveUIState(undefined, next); } catch {}
      try { window.dispatchEvent(new CustomEvent('app-sidebar-visibility', { detail: { visible_ids: [...sidebarVisibleIds] } })); } catch {}
      setOkMsg('Sidebar visibility saved');
    } catch { setError('Unable to save sidebar visibility'); }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true); setError(''); setOkMsg('');
      try {
        const r = await fetch('/api/agents/preferences', { credentials: 'include' });
        if (!r.ok) throw new Error('load_failed');
        const j = await r.json();
        const p = j.preferences || {};
        if (!mounted) return;
        if (p.preferred_lang) setLang(p.preferred_lang);
        if (p.theme_color) setTheme1(p.theme_color);
        if (p.theme_color2) setTheme2(p.theme_color2);
        if (p.notifications) setNotifications({ ...{ email: true, desktop: true, sound:false, soundType:'beep_high', duration:0.9, volume:0.25 }, ...p.notifications });
        if (p.restore_on_login !== undefined) setRestoreOnLogin(!!p.restore_on_login);
        if (p.per_device_ui !== undefined) setPerDeviceUi(!!p.per_device_ui);
        if (p.restore_scroll !== undefined) setRestoreScroll(!!p.restore_scroll);
        if (p.persist_drafts !== undefined) setPersistDrafts(!!p.persist_drafts);
        if (p.compact_sidebar !== undefined) setCompactSidebar(!!p.compact_sidebar);
        if (p.open_submenus_on_hover !== undefined) setOpenHover(!!p.open_submenus_on_hover);
        if (p.default_module) setDefaultModule(p.default_module);
        if (p.keyboard_shortcuts !== undefined) setKbShortcuts(!!p.keyboard_shortcuts);
        if (p.time_format) setTimeFormat(p.time_format);
        if (p.date_format) setDateFormat(p.date_format);
        if (Array.isArray(p.ip_allowlist)) setIpAllowlistText(p.ip_allowlist.join(', '));
        if (p.debug_panels !== undefined) setDebugPanels(!!p.debug_panels);
      } catch (e) {
        if (mounted) setError('Unable to load preferences');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false };
  }, []);

  const onSave = async (e) => {
    e?.preventDefault?.();
    setSaving(true); setError(''); setOkMsg('');
    try {
      const r = await fetch('/api/agents/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preferred_lang, theme_color, theme_color2,
          notifications,
          restore_on_login, per_device_ui, restore_scroll, persist_drafts,
          compact_sidebar, open_submenus_on_hover, default_module,
          keyboard_shortcuts,
          time_format, date_format,
          ip_allowlist: ip_allowlist_text.split(',').map(s => s.trim()).filter(Boolean),
          debug_panels
        })
      });
      if (!r.ok) throw new Error('save_failed');
      setOkMsg('Preferences saved');
      try { applyTheme(theme_color); applyTheme2(theme_color2); } catch {}
      try { localStorage.setItem('agentTheme', JSON.stringify({ theme_color, theme_color2 })); } catch {}
    } catch (e) {
      setError('Unable to save preferences');
    } finally { setSaving(false); }
  };

  const requestWebNotif = async () => {
    try {
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') return true;
      if (Notification.permission !== 'denied') {
        const p = await Notification.requestPermission();
        return p === 'granted';
      }
      return false;
    } catch { return false; }
  };

  const sendTestNotification = async () => {
    try { await fetch('/api/agents/notifications/test', { method:'POST', credentials:'include' }); } catch {}
    const ok = await requestWebNotif();
    if (ok) { try { new Notification('Test notification', { body: 'Hello! This is a test.' }); } catch {} }
    else { setOkMsg('Test sent (enable browser notifications to see a popup)'); }
    try {
      if (notifications.sound) {
        const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=');
        a.play().catch(()=>{});
      }
    } catch {}
  };

  // Simple sound test using WebAudio with multiple tones
  const testBeep = (cfg = {}) => {
    try {
      if (!cfg.sound) return; // respect toggle
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      const ctx = new Ctx();
      const g = ctx.createGain();
      const vol = Math.max(0.05, Math.min(1, Number(cfg.volume ?? 0.25)));
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.02);
      g.connect(ctx.destination);
      const dur = Math.max(0.15, Math.min(3, Number(cfg.duration ?? 0.9)));
      const makeOsc = (type, freq, start, stop) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.connect(g);
        o.start(ctx.currentTime + start); o.stop(ctx.currentTime + stop);
      };
      const type = cfg.soundType || 'beep_high';
      if (type === 'double_beep') { makeOsc('sine', 1400, 0, 0.18); makeOsc('sine', 1600, 0.22, 0.22 + Math.min(0.6, dur)); }
      else if (type === 'square_chime') { makeOsc('square', 900, 0, Math.min(0.6, dur * 0.5)); makeOsc('square', 600, Math.min(0.35, dur * 0.4), Math.min(1.2, dur)); }
      else if (type === 'ping_up') { makeOsc('sine', 900, 0, Math.min(0.5, dur * 0.45)); makeOsc('sine', 1500, Math.min(0.35, dur * 0.5), dur); }
      else if (type === 'ping_down') { makeOsc('sine', 1600, 0, Math.min(0.5, dur * 0.45)); makeOsc('sine', 900, Math.min(0.35, dur * 0.5), dur); }
      else if (type === 'triangle_bell') { makeOsc('triangle', 1200, 0, Math.min(0.6, dur * 0.6)); makeOsc('triangle', 800, Math.min(0.4, dur * 0.5), dur); }
      else { makeOsc('sine', 1600, 0, dur); }
    } catch {}
  };

  // Optional live preview for theme colors
  const applyTheme = (hex = '#2563eb') => {
    try {
      const el = document.documentElement;
      const toRgb = (h) => { const s = h.replace('#',''); const n = parseInt(s.length===3 ? s.split('').map(c=>c+c).join('') : s, 16); return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 }; };
      const clamp = (x,a,b)=>Math.max(a,Math.min(b,x)); const shade = (rgb,f)=>({ r: clamp(Math.round(rgb.r*f),0,255), g: clamp(Math.round(rgb.g*f),0,255), b: clamp(Math.round(rgb.b*f),0,255) });
      const rgb = toRgb(hex); const rgb700 = shade(rgb,0.8); const toCss=(c)=>`rgb(${c.r} ${c.g} ${c.b})`;
      el.style.setProperty('--brand-600', toCss(rgb)); el.style.setProperty('--brand-700', toCss(rgb700));
    } catch {}
  };
  const applyTheme2 = (hex = '#0d9488') => {
    try {
      const el = document.documentElement;
      const toRgb = (h) => { const s = h.replace('#',''); const n = parseInt(s.length===3 ? s.split('').map(c=>c+c).join('') : s, 16); return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 }; };
      const clamp = (x,a,b)=>Math.max(a,Math.min(b,x)); const shade = (rgb,f)=>({ r: clamp(Math.round(rgb.r*f),0,255), g: clamp(Math.round(rgb.g*f),0,255), b: clamp(Math.round(rgb.b*f),0,255) });
      const rgb = toRgb(hex); const rgb700 = shade(rgb,0.8); const toCss=(c)=>`rgb(${c.r} ${c.g} ${c.b})`;
      el.style.setProperty('--brand2-600', toCss(rgb)); el.style.setProperty('--brand2-700', toCss(rgb700));
      el.style.setProperty('--brand2-50', `color-mix(in srgb, ${toCss(rgb)} 10%, white)`);
      el.style.setProperty('--brand2-100', `color-mix(in srgb, ${toCss(rgb)} 18%, white)`);
    } catch {}
  };
  useEffect(() => { if (previewTheme) { try { applyTheme(theme_color); } catch {} } }, [previewTheme, theme_color]);
  useEffect(() => { if (previewTheme) { try { applyTheme2(theme_color2); } catch {} } }, [previewTheme, theme_color2]);

  return (
    <div className="p-4 space-y-4">
      <div className="panel">
        <div className="panel__header">Preferences</div>
        <div className="panel__body space-y-4">
          {loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : (
            <form onSubmit={onSave} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Language</label>
                <select className="border rounded px-3 py-2 w-full" value={preferred_lang} onChange={(e)=>setLang(e.target.value)}>
                  {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!previewTheme} onChange={(e)=>setPreviewTheme(e.target.checked)} /> Preview theme colors
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Theme color</label>
                  <input type="color" className="border rounded w-16 h-10" value={theme_color} onChange={(e)=>{ const v = e.target.value; setTheme1(v); try { /* live apply */ applyTheme(v); } catch {} }} />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Accent color</label>
                  <input type="color" className="border rounded w-16 h-10" value={theme_color2} onChange={(e)=>{ const v = e.target.value; setTheme2(v); try { /* live apply */ applyTheme2(v); } catch {} }} />
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-700 mb-1">Notifications</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!notifications.email} onChange={(e)=>setNotifications(v=>({ ...v, email: e.target.checked }))} /> Email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!notifications.desktop} onChange={(e)=>setNotifications(v=>({ ...v, desktop: e.target.checked }))} /> Desktop
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!notifications.sound} onChange={(e)=>setNotifications(v=>({ ...v, sound: e.target.checked }))} /> Sound
                </label>
                {notifications.sound && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                    <label className="block text-xs text-gray-600">
                      <span className="mb-1 block">Sound type</span>
                      <select className="border rounded px-2 py-1 w-full" value={String(notifications.soundType||'beep_high')} onChange={(e)=>setNotifications(v=>({ ...v, soundType: e.target.value }))}>
                        <option value="beep_high">Beep (high)</option>
                        <option value="double_beep">Double beep</option>
                        <option value="square_chime">Chime (square)</option>
                        <option value="ping_up">Ping up</option>
                        <option value="ping_down">Ping down</option>
                        <option value="triangle_bell">Triangle bell</option>
                      </select>
                    </label>
                    <label className="block text-xs text-gray-600">
                      <span className="mb-1 block">Duration (s)</span>
                      <input type="number" min="0.15" max="3" step="0.05" className="border rounded px-2 py-1 w-full" value={Number(notifications.duration ?? 0.9)} onChange={(e)=>setNotifications(v=>({ ...v, duration: Math.max(0.15, Math.min(3, Number(e.target.value)||0)) }))} />
                    </label>
                    <label className="block text-xs text-gray-600">
                      <span className="mb-1 block">Volume</span>
                      <input type="number" min="0.05" max="1" step="0.05" className="border rounded px-2 py-1 w-full" value={Number(notifications.volume ?? 0.25)} onChange={(e)=>setNotifications(v=>({ ...v, volume: Math.max(0.05, Math.min(1, Number(e.target.value)||0)) }))} />
                    </label>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" className="rounded border px-2 py-1 text-xs" onClick={()=>testBeep(notifications)}>Test sound</button>
                  <button type="button" className="rounded border px-2 py-1 text-xs" onClick={sendTestNotification}>Send test notification</button>
                  <button type="button" className="rounded border px-2 py-1 text-xs" onClick={requestWebNotif}>Enable browser notifications</button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Time format</label>
                  <select className="border rounded px-3 py-2 w-full" value={time_format} onChange={(e)=>setTimeFormat(e.target.value)}>
                    <option value="24h">24h</option>
                    <option value="12h">12h</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Date format</label>
                  <input className="border rounded px-3 py-2 w-full" value={date_format} onChange={(e)=>setDateFormat(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Default module</label>
                  <input className="border rounded px-3 py-2 w-full" value={default_module} onChange={(e)=>setDefaultModule(e.target.value)} placeholder="e.g. agents" />
                </div>
                <div className="flex items-end gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={restore_on_login} onChange={(e)=>setRestoreOnLogin(e.target.checked)} /> Restore on login</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={per_device_ui} onChange={(e)=>setPerDeviceUi(e.target.checked)} /> Per-device UI</label>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={restore_scroll} onChange={(e)=>setRestoreScroll(e.target.checked)} /> Restore scroll</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={persist_drafts} onChange={(e)=>setPersistDrafts(e.target.checked)} /> Persist drafts</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={compact_sidebar} onChange={(e)=>setCompactSidebar(e.target.checked)} /> Compact sidebar</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={open_submenus_on_hover} onChange={(e)=>setOpenHover(e.target.checked)} /> Open submenus on hover</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={keyboard_shortcuts} onChange={(e)=>setKbShortcuts(e.target.checked)} /> Keyboard shortcuts</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={debug_panels} onChange={(e)=>setDebugPanels(e.target.checked)} /> Debug panels</label>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">IP allowlist (CSV)</label>
                <input className="border rounded px-3 py-2 w-full" value={ip_allowlist_text} onChange={(e)=>setIpAllowlistText(e.target.value)} placeholder="203.0.113.0/24, 198.51.100.10" />
              </div>
              {error && <div className="text-xs text-red-600">{error}</div>}
              {okMsg && <div className="text-xs text-green-600">{okMsg}</div>}
              <div>
                <button type="submit" disabled={saving} className="rounded bg-[color:var(--brand-600)] text-white px-4 py-2 hover:bg-[color:var(--brand-700)]">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      <div className="panel">
        <div className="panel__header">Sidebar visibility</div>
        <div className="panel__body space-y-3 text-sm">
          <div className="text-gray-600">Select which root items are visible in your sidebar. This preference is per‑user.</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sidebarList.map(it => (
              <label key={it.entry_id} className="flex items-center gap-2">
                <input type="checkbox" checked={sidebarVisibleIds.includes(it.entry_id)} onChange={(e)=>{
                  const id = it.entry_id; setSidebarVisibleIds(v => e.target.checked ? Array.from(new Set([...(v||[]), id])) : (v||[]).filter(x => x !== id));
                }} />
                <span className="truncate" title={it.entry_id}>{it.label || it.entry_id}</span>
              </label>
            ))}
            {!sidebarList.length && (<div className="text-xs text-gray-500">Aucun élément.</div>)}
          </div>
          <div>
            <button type="button" className="rounded border px-3 py-1.5" onClick={saveSidebarVisibility}>Save visibility</button>
          </div>
        </div>
      </div>
    </div>
  );
}

