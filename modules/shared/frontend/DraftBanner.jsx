import React from 'react';

export default function DraftBanner({ text = 'Draft' }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-400 text-amber-900 text-center text-xs py-1 shadow">
      {text}
    </div>
  );
}

