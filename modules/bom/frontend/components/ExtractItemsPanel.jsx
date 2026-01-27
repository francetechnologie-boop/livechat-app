import React from 'react';

export default function ExtractItemsPanel() {
  const [mode, setMode] = React.useState('csv');
  const [text, setText] = React.useState('sku,name\nABC-001,Widget A\nABC-002,Widget B');
  const [items, setItems] = React.useState([]);

  async function runExtract() {
    const res = await fetch('/api/bom/extract/items', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ mode, text }) });
    const j = await res.json(); if (j.ok) setItems(j.items || []);
  }

  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-3">Extract Items Data</h2>
      <div className="flex items-center gap-2 mb-2 text-sm">
        <label>Mode</label>
        <select className="border rounded px-2 py-1" value={mode} onChange={(e)=>setMode(e.target.value)}>
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
        <button onClick={runExtract} className="border rounded px-3 py-1 ml-auto">Extract</button>
      </div>
      <textarea className="border rounded w-full p-2 text-sm h-28" value={text} onChange={(e)=>setText(e.target.value)} />
      <div className="mt-3 text-sm">Found: {items.length}</div>
      {items.length > 0 && (
        <div className="mt-2 max-h-40 overflow-auto border rounded">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50"><th className="text-left p-2">#</th><th className="text-left p-2">Preview</th></tr></thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-t"><td className="p-2">{idx+1}</td><td className="p-2"><code>{JSON.stringify(it)}</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

