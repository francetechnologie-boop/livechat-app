import React from 'react';

export default function FxRatesPanel({ orgId }) {
  const [base, setBase] = React.useState('EUR');
  const [quote, setQuote] = React.useState('CZK');
  const [rate, setRate] = React.useState('25');
  const [items, setItems] = React.useState([]);
  const [msg, setMsg] = React.useState('');
  const headers = orgId ? { 'x-org-id': orgId } : {};

  async function load() {
    setMsg('');
    try {
      const q = new URLSearchParams(); q.set('base', base);
      const res = await fetch(`/api/bom/fx/latest?${q.toString()}`, { headers });
      const j = await res.json(); if (j.ok) setItems(j.items || []); else setMsg(j.message || j.error || 'load_failed');
    } catch (e) { setMsg(String(e?.message || e)); }
  }
  React.useEffect(()=>{ load(); }, [orgId, base]);

  async function save(e) {
    e.preventDefault(); setMsg('');
    try {
      const body = { base_currency: base, quote_currency: quote, rate: Number(rate) };
      const res = await fetch('/api/bom/fx', { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
      const j = await res.json(); if (j.ok) { setMsg('Saved'); load(); } else setMsg(j.message || j.error || 'save_failed');
    } catch (e) { setMsg(String(e?.message || e)); }
  }

  return (
    <div className="border rounded p-3">
      <div className="font-medium mb-2">Exchange rates</div>
      <form onSubmit={save} className="flex flex-wrap items-center gap-2 mb-3">
        <input className="border rounded px-2 py-1 w-24" value={base} onChange={(e)=>setBase(e.target.value.toUpperCase())} placeholder="Base (e.g. EUR)" />
        <span>=</span>
        <input className="border rounded px-2 py-1 w-24" value={rate} onChange={(e)=>setRate(e.target.value)} placeholder="Rate" />
        <input className="border rounded px-2 py-1 w-24" value={quote} onChange={(e)=>setQuote(e.target.value.toUpperCase())} placeholder="Quote (e.g. CZK)" />
        <button className="border rounded px-3 py-1" type="submit">Add</button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </form>
      <div className="max-h-40 overflow-auto border rounded">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50"><th className="text-left p-2">Quote</th><th className="text-left p-2">Rate (1 {base} = ?)</th><th className="text-left p-2">Effective</th></tr></thead>
          <tbody>
            {items.map((r)=> (
              <tr key={`${r.quote_currency}`} className="border-t">
                <td className="p-2">{r.quote_currency}</td>
                <td className="p-2">{r.rate}</td>
                <td className="p-2">{new Date(r.effective_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

