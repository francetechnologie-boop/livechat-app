import React, { useEffect, useRef } from 'react';

export default function RichEditor({ value = '', onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.value = value || '' }, [value]);
  return (
    <textarea ref={ref} className="w-full min-h-[140px] border rounded p-2 text-sm"
      onChange={(e)=> onChange && onChange(e.target.value)} />
  );
}

