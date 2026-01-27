// Standalone client loader without bundling socket.io-client
// Dynamically loads ESM client from CDN to avoid build-time resolution issues.
let real = null;
const queued = [];

export const socket = {
  get connected() { return !!(real && real.connected); },
  on(...args) { if (real) return real.on(...args); queued.push({ t: 'on', args }); },
  off(...args) { if (real) return real.off(...args); /* noop until ready */ },
  emit(...args) { if (real) return real.emit(...args); queued.push({ t: 'emit', args }); },
};

(async () => {
  try {
    const { io } = await import('https://cdn.socket.io/4.8.1/socket.io.esm.min.js');
    real = io('/', { path: '/socket' });

    // Reapply queued listeners and emits
    for (const q of queued.splice(0)) {
      try { if (q.t === 'on') real.on(...q.args); else if (q.t === 'emit') real.emit(...q.args); } catch {}
    }

    const joinAgents = () => { try { real.emit('agent_hello'); } catch {} };
    if (real.connected) joinAgents();
    real.on('connect', joinAgents);
    real.on('connect_error', (e) => { try { console.warn('[socket] connect_error', e?.message || e); } catch {} });
  } catch (e) {
    try { console.warn('[socket] failed to load client:', e?.message || e); } catch {}
  }
})();
