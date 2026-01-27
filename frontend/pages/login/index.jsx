import React, { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doLogin = async (e) => {
    e?.preventDefault?.();
    setError(''); setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      if (!r.ok) {
        const j = await r.json().catch(()=>({ error: 'login_failed' }));
        throw new Error(j.error || 'login_failed');
      }
      // Verify session and navigate to Module Manager
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (meRes.ok) {
          try {
            if (window.location.hash !== '#/module-manager') {
              window.history.replaceState(null, '', '#/module-manager');
            }
          } catch {}
          try { window.location.reload(); } catch {}
          return;
        }
      } catch {}
      try { window.location.reload(); } catch {}
    } catch (e) {
      setError(String(e?.message || e));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <form onSubmit={doLogin} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow">
        <div className="login-panel__logo mb-3">LC</div>
        <div className="text-lg font-semibold mb-4">Se connecter</div>
        <label className="block text-sm text-gray-700 mb-1">Email</label>
        <input type="email" className="border rounded px-3 py-2 w-full mb-3" value={email} onChange={(e)=>setEmail(e.target.value)} />
        <label className="block text-sm text-gray-700 mb-1">Mot de passe</label>
        <input type="password" className="border rounded px-3 py-2 w-full mb-4" value={password} onChange={(e)=>setPassword(e.target.value)} />
        {error && <div className="text-xs text-red-600 mb-3">{error}</div>}
        <button type="submit" disabled={loading} className="w-full rounded bg-[color:var(--brand-600)] px-3 py-2 text-white hover:bg-[color:var(--brand-700)]">
          {loading ? '...' : 'Connexion'}
        </button>
      </form>
    </div>
  );
}
