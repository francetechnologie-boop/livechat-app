import React, { useState } from "react";

export default function CreateGrabbingButton({ disabled, onCreated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");

  const create = async () => {
    if (!title.trim()) { setErr("Title required"); return; }
    setBusy(true); setErr("");
    try {
      const id = `grb_${Date.now()}`;
      const it = { id, title: title.trim(), target: target.trim(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      onCreated?.(it);
      setOpen(false); setTitle(""); setTarget("");
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  if (!open) return (
    <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={() => setOpen(true)} disabled={disabled}>+ Add Grabbing</button>
  );

  return (
    <div className="absolute z-50 bg-white border rounded shadow p-3 w-[320px]">
      <div className="font-medium text-sm mb-2">New Grabbing</div>
      <div className="space-y-2 text-sm">
        <div>
          <div className="text-xs text-gray-600">Title</div>
          <input className="w-full border rounded px-2 py-1" value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="My grabbing" />
        </div>
        <div>
          <div className="text-xs text-gray-600">Target (URL or ID)</div>
          <input className="w-full border rounded px-2 py-1" value={target} onChange={(e)=>setTarget(e.target.value)} placeholder="https://... or id_..." />
        </div>
        {!!err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex items-center justify-end gap-2">
          <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setOpen(false)} disabled={busy}>Cancel</button>
          <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={create} disabled={busy || !title.trim()}>{busy? 'Creating.':'Create'}</button>
        </div>
      </div>
    </div>
  );
}

