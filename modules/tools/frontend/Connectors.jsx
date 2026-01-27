import React, { useEffect, useState } from "react";
import { loadModuleState, saveModuleState } from "@app-lib/uiState";

function Section({ title, actions, children }) {
  return (
    <div className="panel max-w-4xl">
      <div className="panel__header flex items-center justify-between">
        <span>{title}</span>
        <div className="flex gap-2">{actions}</div>
      </div>
      <div className="panel__body space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-12 gap-3 items-center">
      <div className="col-span-12 md:col-span-3 text-xs text-gray-600">{label}</div>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}

export default function Connectors() {
  const [msg, setMsg] = useState("");
  // Local state persisted via UI state for non-implemented backends
  const [state, setState] = useState(() => {
    try { return loadModuleState('tools.connectors'); } catch { return {}; }
  });
  const saveLocal = (patch) => {
    const next = { ...(state || {}), ...(patch || {}) };
    setState(next);
    try { saveModuleState('tools.connectors', next); } catch {}
  };

  // ---------------- PrestaShop (server-backed) ----------------
  const [presta, setPresta] = useState({ base: "", api_key: "" });
  const [prestaBusy, setPrestaBusy] = useState(false);
  const [prestaMsg, setPrestaMsg] = useState("");
  const loadPresta = async () => {
    setPrestaBusy(true); setPrestaMsg("");
    try {
      const r = await fetch('/api/company-chat/prestashop/config', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setPresta({ base: j.base || '', api_key: j.api_key || '' });
      else setPrestaMsg(j?.message || j?.error || 'Load failed');
    } catch (e) { setPrestaMsg(String(e?.message || e)); }
    finally { setPrestaBusy(false); }
  };
  useEffect(() => { loadPresta(); }, []);
  const savePresta = async () => {
    setPrestaBusy(true); setPrestaMsg('');
    try {
      const r = await fetch('/api/company-chat/prestashop/config', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include',
        body: JSON.stringify({ base: presta.base, api_key: presta.api_key })
      });
      const j = await r.json();
      if (r.ok && j?.ok) setPrestaMsg('Enregistré.'); else setPrestaMsg(j?.message || j?.error || 'Save failed');
    } catch (e) { setPrestaMsg(String(e?.message || e)); }
    finally { setPrestaBusy(false); }
  };
  const testPresta = async () => {
    setPrestaBusy(true); setPrestaMsg('');
    try {
      const r = await fetch('/api/company-chat/prestashop/test', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include',
        body: JSON.stringify({ base: presta.base, api_key: presta.api_key })
      });
      const j = await r.json().catch(()=>null);
      if (r.ok && j?.ok) setPrestaMsg(`OK (${j.via || 'root'}, ${j.ms || 0}ms)`);
      else setPrestaMsg(j?.message || j?.error || `HTTP ${r.status}`);
    } catch (e) { setPrestaMsg(String(e?.message || e)); }
    finally { setPrestaBusy(false); }
  };

  // ---------------- Other connectors (UI-only placeholders) ----------------
  const [shopify, setShopify] = useState(() => state.shopify || { store_url: '', access_token: '' });
  const [stripe, setStripe] = useState(() => state.stripe || { secret_key: '', api_base_url: 'https://api.stripe.com' });
  const [twilio, setTwilio] = useState(() => state.twilio || { account_sid: '', auth_token: '', from: '' });
  const [smtp, setSmtp] = useState(() => state.smtp || { host: '', port: 587, user: '', pass: '', from: '' });

  useEffect(() => { saveLocal({ shopify, stripe, twilio, smtp }); }, [shopify, stripe, twilio, smtp]);

  return (
    <div className="p-4 space-y-6">
      {msg && <div className="rounded border bg-blue-50 text-blue-800 px-3 py-2 text-sm">{msg}</div>}

      <Section
        title="PrestaShop"
        actions={(
          <>
            <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={loadPresta} disabled={prestaBusy}>Reload</button>
            <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={testPresta} disabled={prestaBusy}>Test</button>
            <button className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" onClick={savePresta} disabled={prestaBusy}>Enregistrer</button>
          </>
        )}
      >
        <Field label="Base URL">
          <input className="w-full border rounded px-3 py-2" placeholder="https://example.com" value={presta.base} onChange={(e)=>setPresta(p=>({ ...p, base:e.target.value }))} />
        </Field>
        <Field label="API Key">
          <input className="w-full border rounded px-3 py-2" type="password" placeholder="********" value={presta.api_key} onChange={(e)=>setPresta(p=>({ ...p, api_key:e.target.value }))} />
        </Field>
        {prestaMsg && <div className="text-xs text-gray-600">{prestaMsg}</div>}
      </Section>

      <Section title="Shopify" actions={null}>
        <div className="text-xs text-gray-500">UI uniquement pour l'instant. Sauvegardé côté UI; backend à brancher.</div>
        <Field label="Store URL">
          <input className="w-full border rounded px-3 py-2" placeholder="myshop.myshopify.com" value={shopify.store_url} onChange={(e)=>setShopify(s=>({ ...s, store_url:e.target.value }))} />
        </Field>
        <Field label="Access token">
          <input className="w-full border rounded px-3 py-2" type="password" placeholder="shpat_..." value={shopify.access_token} onChange={(e)=>setShopify(s=>({ ...s, access_token:e.target.value }))} />
        </Field>
      </Section>

      <Section title="Stripe" actions={null}>
        <div className="text-xs text-gray-500">UI uniquement. Vous pouvez aussi configurer Stripe via MCP Servers.</div>
        <Field label="Secret key">
          <input className="w-full border rounded px-3 py-2" type="password" placeholder="sk_live_..." value={stripe.secret_key} onChange={(e)=>setStripe(s=>({ ...s, secret_key:e.target.value }))} />
        </Field>
        <Field label="API base URL">
          <input className="w-full border rounded px-3 py-2" placeholder="https://api.stripe.com" value={stripe.api_base_url} onChange={(e)=>setStripe(s=>({ ...s, api_base_url:e.target.value }))} />
        </Field>
      </Section>

      <Section title="Twilio" actions={null}>
        <div className="text-xs text-gray-500">UI uniquement pour l'instant (SMS/WhatsApp/Appel).</div>
        <Field label="Account SID">
          <input className="w-full border rounded px-3 py-2" placeholder="ACxxxxxxxx" value={twilio.account_sid} onChange={(e)=>setTwilio(s=>({ ...s, account_sid:e.target.value }))} />
        </Field>
        <Field label="Auth token">
          <input className="w-full border rounded px-3 py-2" type="password" placeholder="********" value={twilio.auth_token} onChange={(e)=>setTwilio(s=>({ ...s, auth_token:e.target.value }))} />
        </Field>
        <Field label="From (numéro)">
          <input className="w-full border rounded px-3 py-2" placeholder="+336...." value={twilio.from} onChange={(e)=>setTwilio(s=>({ ...s, from:e.target.value }))} />
        </Field>
      </Section>

      <Section title="SMTP" actions={null}>
        <div className="text-xs text-gray-500">UI uniquement pour l'instant. Saisissez les paramètres SMTP.</div>
        <Field label="Host">
          <input className="w-full border rounded px-3 py-2" placeholder="smtp.example.com" value={smtp.host} onChange={(e)=>setSmtp(s=>({ ...s, host:e.target.value }))} />
        </Field>
        <Field label="Port">
          <input className="w-full border rounded px-3 py-2" type="number" placeholder="587" value={smtp.port} onChange={(e)=>setSmtp(s=>({ ...s, port:Number(e.target.value||0) }))} />
        </Field>
        <Field label="User">
          <input className="w-full border rounded px-3 py-2" placeholder="user@example.com" value={smtp.user} onChange={(e)=>setSmtp(s=>({ ...s, user:e.target.value }))} />
        </Field>
        <Field label="Password">
          <input className="w-full border rounded px-3 py-2" type="password" placeholder="********" value={smtp.pass} onChange={(e)=>setSmtp(s=>({ ...s, pass:e.target.value }))} />
        </Field>
        <Field label="From">
          <input className="w-full border rounded px-3 py-2" placeholder="Livechat <no-reply@example.com>" value={smtp.from} onChange={(e)=>setSmtp(s=>({ ...s, from:e.target.value }))} />
        </Field>
      </Section>
    </div>
  );
}

