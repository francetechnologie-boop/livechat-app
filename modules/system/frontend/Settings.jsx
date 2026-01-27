// components/Settings.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadUIState, saveUIState, clearUIState } from "@app-lib/uiState";

const LS_KEY = "agentNotify";

function loadCfg() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveCfg(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch {}
}

function useNotifyConfig() {
  const [cfg, setCfg] = useState(() => (
    loadCfg() || {
      allowText: true,
      allowSound: true,
      soundType: "beep_high",
      duration: 0.9,
      volume: 0.25,
    }
  ));
  useEffect(() => saveCfg(cfg), [cfg]);
  return [cfg, setCfg];
}

export default function Settings() {
  // Breadcrumb: base only (no subsections here)
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Settings'] })); } catch {}
  }, []);
  const [me, setMe] = useState(null);
  useEffect(() => { fetch('/api/auth/me').then(r=>r.ok?r.json():null).then(setMe).catch(()=>setMe(null)); }, []);
  const [cfg, setCfg] = useNotifyConfig();
  const [perm, setPerm] = useState(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );

  const requestPerm = async () => {
    try {
      if (!("Notification" in window)) return;
      const p = await Notification.requestPermission();
      setPerm(p);
    } catch {}
  };

  const playTest = async () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.05, Math.min(1, cfg.volume || 0.2)), now + 0.02);
      g.connect(ctx.destination);

      const duration = Math.max(0.15, Math.min(3, Number(cfg.duration || 0.9)));

      const makeOsc = (type, freq, start, stop) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, ctx.currentTime);
        o.connect(g);
        o.start(now + start);
        o.stop(now + stop);
      };

      const type = cfg.soundType || "beep_high";
      if (type === "double_beep") {
        makeOsc("sine", 1400, 0, 0.18);
        makeOsc("sine", 1600, 0.22, 0.22 + duration * 0.35);
      } else if (type === "square_chime") {
        makeOsc("square", 900, 0, duration * 0.4);
        makeOsc("square", 600, duration * 0.45, duration * 0.9);
      } else if (type === "beep_low") {
        makeOsc("sine", 700, 0, duration);
      } else if (type === "ping_up") {
        makeOsc("sine", 900, 0, duration * 0.45);
        makeOsc("sine", 1500, duration * 0.5, duration);
      } else if (type === "ping_down") {
        makeOsc("sine", 1600, 0, duration * 0.45);
        makeOsc("sine", 900, duration * 0.5, duration);
      } else if (type === "triangle_bell") {
        makeOsc("triangle", 1200, 0, duration * 0.6);
        makeOsc("triangle", 800, duration * 0.65, duration);
      } else if (type === "chirp_sweep") {
        // simple sweep using rapid short oscillators
        const steps = 6;
        for (let i = 0; i < steps; i++) {
          const f = 900 + i * 150;
          const s = (i * duration) / steps;
          const e = ((i + 1) * duration) / steps;
          makeOsc("sawtooth", f, s, e);
        }
      } else {
        // beep_high (default)
        makeOsc("sine", 1600, 0, duration);
      }
    } catch {}
  };

  // ----- UI State (restore/clear/toggles) -----
  const [uiFlags, setUiFlags] = useState({ restore_on_login: true, per_device_ui: false, restore_scroll: false, persist_drafts: false });
  const saveTimerRef = useRef(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/me');
        const u = await r.json().catch(()=>null);
        if (u && (u.ui_state || u.flags)) {
          const flags = (u.ui_state && u.ui_state.flags) ? u.ui_state.flags : (u.flags || {});
          setUiFlags({
            restore_on_login: flags.restore_on_login !== false,
            per_device_ui: !!flags.per_device_ui,
            restore_scroll: !!flags.restore_scroll,
            persist_drafts: !!flags.persist_drafts,
          });
        }
      } catch {}
    })();
  }, []);
  const saveUiFlags = async () => {
    try {
      const r = await fetch('/api/auth/me');
      const u = await r.json().catch(()=>({}));
      const cur = (u && u.ui_state && typeof u.ui_state === 'object') ? u.ui_state : {};
      const next = { ...cur, flags: { ...(cur.flags || {}), ...uiFlags } };
      await fetch('/api/me', { method:'PATCH', headers:{ 'Content-Type': 'application/json' }, body: JSON.stringify({ ui_state: next }) });
      try { if (u && u.id != null) saveUIState(u.id, next); } catch {}
      alert('Saved');
    } catch {
      alert('Save failed');
    }
  };
  // Auto-save flags after short delay when toggled
  useEffect(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    saveTimerRef.current = setTimeout(() => { saveUiFlags(); }, 600);
    return () => { if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiFlags.restore_on_login, uiFlags.per_device_ui, uiFlags.restore_scroll, uiFlags.persist_drafts]);
  const resetUiState = async () => {
    try {
      await fetch('/api/me', { method:'PATCH', headers:{ 'Content-Type': 'application/json' }, body: JSON.stringify({ ui_state: null }) });
      try { if (me && me.id != null) clearUIState(me.id); } catch {}
      setUiFlags({ restore_on_login: true, per_device_ui: false, restore_scroll: false, persist_drafts: false });
      alert('UI state reset.');
    } catch {
      alert('Reset failed');
    }
  };

  return (
    <div className="h-full w-full flex">
      <aside className="w-64 border-r bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Réglages</div>
        <div className="text-sm text-gray-700">Notifications</div>
      </aside>
      <main className="flex-1 min-h-0 p-4 space-y-4">
        <h2 className="text-lg font-semibold">Notifications</h2>

        <div className="space-y-3 max-w-2xl">
          <div className="flex items-center gap-3">
            <input
              id="allowText"
              type="checkbox"
              checked={!!cfg.allowText}
              onChange={(e) => setCfg({ ...cfg, allowText: e.target.checked })}
            />
            <label htmlFor="allowText" className="select-none">
              Autoriser notifications de bureau (texte)
            </label>
            <span className="text-xs text-gray-500 ml-2">
              État: {perm}
            </span>
            {perm !== "granted" && perm !== "unsupported" && (
              <button
                className="ml-auto px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={requestPerm}
              >
                Autoriser
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              id="allowSound"
              type="checkbox"
              checked={!!cfg.allowSound}
              onChange={(e) => setCfg({ ...cfg, allowSound: e.target.checked })}
            />
            <label htmlFor="allowSound" className="select-none">
              Activer le son de notification
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Son</label>
              <select
                className="border rounded px-2 py-1 w-full"
                value={cfg.soundType}
                onChange={(e) => setCfg({ ...cfg, soundType: e.target.value })}
                disabled={!cfg.allowSound}
              >
                <option value="beep_high">Beep aigu</option>
                <option value="beep_low">Beep grave</option>
                <option value="double_beep">Double beep</option>
                <option value="square_chime">Carillon (carré)</option>
                <option value="ping_up">Ping montant</option>
                <option value="ping_down">Ping descendant</option>
                <option value="triangle_bell">Cloche triangle</option>
                <option value="chirp_sweep">Balayage (chirp)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Durée (s)</label>
              <input
                type="range"
                min={0.2}
                max={2}
                step={0.1}
                value={cfg.duration}
                onChange={(e) => setCfg({ ...cfg, duration: Number(e.target.value) })}
                className="w-full"
                disabled={!cfg.allowSound}
              />
              <div className="text-xs text-gray-600 mt-1">{cfg.duration.toFixed(1)} s</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Volume</label>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={cfg.volume}
                onChange={(e) => setCfg({ ...cfg, volume: Number(e.target.value) })}
                className="w-full"
                disabled={!cfg.allowSound}
              />
              <div className="text-xs text-gray-600 mt-1">{Math.round(cfg.volume * 100)}%</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm"
              onClick={playTest}
              disabled={!cfg.allowSound}
            >
              Tester le son
            </button>
            <button
              className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm"
              onClick={() => {
                if (!cfg.allowText) return;
                if (!("Notification" in window)) return;
                (async () => {
                  const p = await Notification.requestPermission();
                  setPerm(p);
                  if (p === "granted") {
                    try { new Notification("Test notification", { body: "Ceci est un test" }); } catch {}
                  }
                })();
              }}
              disabled={!cfg.allowText}
            >
              Tester la notification
            </button>
            {perm === "denied" && (
              <span className="text-xs text-red-600">Permission bloquée par le navigateur — autorisez les notifications dans les réglages du site.</span>
            )}
          </div>
        </div>

        <h2 className="text-lg font-semibold mt-6">UI State</h2>
        <div className="space-y-3 max-w-2xl">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={uiFlags.restore_on_login} onChange={(e)=>setUiFlags(v=>({ ...v, restore_on_login: e.target.checked }))} />
            <span>Restore last screen on login</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={uiFlags.per_device_ui} onChange={(e)=>setUiFlags(v=>({ ...v, per_device_ui: e.target.checked }))} />
            <span>Use per-device UI state (separate per browser/device)</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={uiFlags.restore_scroll} onChange={(e)=>setUiFlags(v=>({ ...v, restore_scroll: e.target.checked }))} />
            <span>Restore scroll positions</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={uiFlags.persist_drafts} onChange={(e)=>setUiFlags(v=>({ ...v, persist_drafts: e.target.checked }))} />
            <span>Persist chat editor drafts</span>
          </label>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm" onClick={saveUiFlags}>Save UI prefs</button>
            <button className="px-3 py-1.5 rounded border text-sm" onClick={resetUiState}>Reset UI state</button>
          </div>
          {me?.role === 'admin' && (
            <div className="mt-3 border-t pt-3">
              <div className="text-xs text-gray-500 mb-1">Admin tools</div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 rounded border text-sm" onClick={async()=>{ try { await fetch('/api/admin/ui-state/purge', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ org_id: me?.org_id||null }) }); alert('Org UI state purged.'); } catch { alert('Purge failed'); } }}>Purge org UI state</button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
