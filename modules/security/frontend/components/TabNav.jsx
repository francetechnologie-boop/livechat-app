import React from 'react';

export default function TabNav({ tabs, value, onChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(tabs || []).map((t) => (
        <button
          key={t.id}
          onClick={() => onChange?.(t.id)}
          className={`px-3 py-1.5 rounded border text-sm ${
            value === t.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

