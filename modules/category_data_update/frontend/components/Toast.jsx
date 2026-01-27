import React from 'react';

export default function Toast({ open, type='info', message, onClose }) {
  if (!open) return null;
  const color = type === 'error' ? 'bg-red-100 text-red-800 border-red-300' : (type === 'success' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-800 border-gray-300');
  return (
    <div className={`fixed bottom-4 right-4 border ${color} px-3 py-2 rounded shadow text-sm`}> 
      <div className="flex items-center gap-3">
        <div>{message}</div>
        <button className="text-xs underline" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

