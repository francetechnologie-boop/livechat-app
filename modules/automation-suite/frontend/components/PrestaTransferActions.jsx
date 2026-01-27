import React from 'react';

export default function PrestaTransferActions({ domain, row, busy, onSend, onResend, onResendImages }) {
  if (!row) return null;
  return (
    <div className="inline-flex gap-1">
      <button className="px-2 py-0.5 border rounded" disabled={busy} onClick={()=> onSend && onSend(row)}>Send to Presta</button>
      <button className="px-2 py-0.5 border rounded" disabled={busy} title="Re-send product (upsert in Presta)" onClick={()=> onResend && onResend(row)}>Re-send product</button>
      <button className="px-2 py-0.5 border rounded" disabled={busy} title="Re-send images only" onClick={()=> onResendImages && onResendImages(row)}>Re-send images</button>
      {!!domain && (
        <a className="px-2 py-0.5 border rounded" href={`/api/grabbings/jerome/domains/url/ready?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(row.url||'')}`} target="_blank" rel="noreferrer">View JSON</a>
      )}
    </div>
  );
}

