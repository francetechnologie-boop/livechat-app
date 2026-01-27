import React from 'react';

export default function EmailRelancePlaceholderPanel({ title, children }) {
  return (
    <div className="border rounded bg-white p-4">
      <div className="text-sm font-semibold mb-2">{title}</div>
      <div className="text-sm text-gray-600">{children}</div>
    </div>
  );
}

