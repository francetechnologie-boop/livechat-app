import React from 'react';

export default function ProfilesList({ items, busy, onEdit, onTest, onDelete }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-1">Profiles</div>
      <div className="text-xs text-gray-500 mb-2">{busy ? 'Loading…' : ''}</div>
      <div className="border rounded divide-y">
        {(items || []).map((it) => (
          <div key={it.id} className="p-2 text-sm flex items-center justify-between">
            <div>
              <div className="font-semibold">{it.name}</div>
              <div className="text-xs text-gray-600">
                ssh://{it.username}@{it.host}:{it.port}
                {it.key_path ? <span className="ml-2">key: {it.key_path}</span> : null}
                {it.has_password ? <span className="ml-2">pwd: yes</span> : <span className="ml-2">pwd: no</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 border rounded text-xs" onClick={() => onEdit?.(it)}>Edit</button>
              <button className="px-2 py-1 border rounded text-xs" onClick={() => onTest?.(it)}>Test</button>
              <button className="px-2 py-1 border rounded text-xs" onClick={() => onDelete?.(it)}>Delete</button>
            </div>
          </div>
        ))}
        {(!items || !items.length) ? <div className="p-2 text-xs text-gray-500">No profiles</div> : null}
      </div>
    </div>
  );
}

