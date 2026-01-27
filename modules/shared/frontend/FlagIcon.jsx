import React from 'react';

export default function FlagIcon({ country = 'cz', className = '' }) {
  return <span className={`inline-block h-3 w-4 bg-slate-300 ${className}`} title={country.toUpperCase()} aria-hidden/>;
}

