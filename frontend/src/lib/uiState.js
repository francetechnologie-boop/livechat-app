// Simple per-agent UI state persistence
// Stores state in localStorage under a per-user key

const KEY_PREFIX = 'app_ui_state__';
const CUR_AGENT_KEY = 'app_current_agent_id';
const DEVICE_KEY = 'app_device_id';
let currentAgentId = null;
function hasAuthCookie() {
  try { return /(?:^|;\s*)auth=/.test(document.cookie || ''); } catch { return false; }
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

function getAgentId(agentId) {
  if (agentId != null && String(agentId).trim() !== '') return String(agentId).trim();
  if (currentAgentId != null) return String(currentAgentId);
  try {
    const fromLs = localStorage.getItem(CUR_AGENT_KEY);
    if (fromLs && String(fromLs).trim() !== '') return String(fromLs).trim();
  } catch {}
  return '';
}

function keyFor(agentId) {
  const id = getAgentId(agentId);
  return id ? `${KEY_PREFIX}${id}` : null;
}

export function setCurrentAgentId(agentId) {
  try {
    currentAgentId = agentId != null && String(agentId).trim() !== '' ? String(agentId).trim() : null;
    if (currentAgentId == null) localStorage.removeItem(CUR_AGENT_KEY);
    else localStorage.setItem(CUR_AGENT_KEY, currentAgentId);
  } catch {
    currentAgentId = agentId != null ? String(agentId) : null;
  }
}

export function loadUIState(agentId) {
  try {
    const key = keyFor(agentId);
    if (!key) return {};
    const raw = localStorage.getItem(key);
    const obj = safeParse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export function saveUIState(agentId, patch) {
  try {
    const key = keyFor(agentId);
    if (!key || !patch || typeof patch !== 'object') return;
    const current = loadUIState(agentId);
    const next = { ...current, ...patch };
    // If per-device UI is enabled, also mirror core keys into devices[deviceId]
    const flags = (next && typeof next.flags === 'object') ? next.flags : (current && typeof current.flags === 'object' ? current.flags : {});
    if (flags && flags.per_device_ui) {
      const devId = getDeviceId();
      const core = {
        ...(typeof next.activeTab !== 'undefined' ? { activeTab: next.activeTab } : {}),
        ...(typeof next.selectedVisitor !== 'undefined' ? { selectedVisitor: next.selectedVisitor } : {}),
        ...(typeof next.modules === 'object' ? { modules: next.modules } : {}),
      };
      const devices = { ...(current.devices || {}) };
      devices[devId] = { ...(devices[devId] || {}), ...core };
      next.devices = devices;
    }
    localStorage.setItem(key, JSON.stringify(next));
    scheduleServerSave(agentId, next);
    // Immediate flush (throttled) so state survives if cookies are cleared right after
    try {
      const id = getAgentId(agentId);
      const tKey = `__last_immediate_flush_${id}`;
      const now = Date.now();
      const last = Number(sessionStorage.getItem(tKey) || 0);
      if (!last || now - last > 1200) {
        sessionStorage.setItem(tKey, String(now));
        flushUIStateNow(id);
      }
    } catch {}
  } catch {}
}

export function clearUIState(agentId) {
  try {
    const key = keyFor(agentId);
    if (!key) return;
    localStorage.removeItem(key);
  } catch {}
}

// Shallow module-level state helpers
export function loadModuleState(moduleKey, agentId) {
  try {
    const st = loadUIState(agentId);
    const mods = st && typeof st.modules === 'object' ? st.modules : {};
    const mk = String(moduleKey || '').trim();
    return mk && mods && typeof mods[mk] === 'object' ? mods[mk] : {};
  } catch { return {}; }
}

export function saveModuleState(moduleKey, patch, agentId) {
  try {
    const mk = String(moduleKey || '').trim();
    if (!mk || !patch || typeof patch !== 'object') return;
    const st = loadUIState(agentId);
    const mods = (st && typeof st.modules === 'object') ? { ...st.modules } : {};
    const cur = (mods[mk] && typeof mods[mk] === 'object') ? mods[mk] : {};
    mods[mk] = { ...cur, ...patch };
    const merged = { ...st, modules: mods };
    saveUIState(agentId, merged);
  } catch {}
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (id && String(id).trim()) return id;
    id = `dev_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'dev_default';
  }
}

// -------------------- Server sync (debounced) --------------------
let saveTimer = null;
let queuedByAgent = {};
function scheduleServerSave(agentId, fullState) {
  try {
    const id = getAgentId(agentId);
    if (!id) return;
    if (!hasAuthCookie()) return; // skip server sync when unauthenticated
    queuedByAgent[id] = fullState && typeof fullState === 'object' ? fullState : (queuedByAgent[id] || {});
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      const payload = queuedByAgent;
      queuedByAgent = {};
      saveTimer = null;
      const entries = Object.entries(payload);
      for (const [aid, state] of entries) {
        try {
          const res = await fetch('/api/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            keepalive: true,
            body: JSON.stringify({ ui_state: state }),
          });
          if (!res.ok && res.status === 401) break; // stop trying until next login
        } catch {}
      }
    }, 500);
  } catch {}
}

export async function flushUIStateNow(agentId) {
  try {
    const id = getAgentId(agentId);
    if (!id) return;
    if (!hasAuthCookie()) return;
    const st = loadUIState(id);
    if (!st || typeof st !== 'object') return;
    await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify({ ui_state: st }),
    });
  } catch {}
}

let unloadInstalled = false;
export function installUIStateFlush(agentId) {
  try {
    if (unloadInstalled) return;
    unloadInstalled = true;
    const handler = () => {
      try { flushUIStateNow(agentId); } catch {}
    };
    window.addEventListener('beforeunload', handler);
    document.addEventListener('visibilitychange', () => {
      try { if (document.visibilityState === 'hidden') flushUIStateNow(agentId); } catch {}
    });
  } catch {}
}
