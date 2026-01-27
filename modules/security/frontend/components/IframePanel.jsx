import React from 'react';

export default function IframePanel({ title, url, hint }) {
  return (
    <div className="h-full min-h-0 border rounded bg-white flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}</div>
        <a
          className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          Open
        </a>
      </div>
      {hint ? (
        <div className="px-3 py-2 text-xs text-gray-600 border-b bg-gray-50">
          {hint}
        </div>
      ) : null}
      <div className="flex-1 min-h-0">
        <iframe title={title} src={url} className="w-full h-full" />
      </div>
    </div>
  );
}

