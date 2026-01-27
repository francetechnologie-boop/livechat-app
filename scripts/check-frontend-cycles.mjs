#!/usr/bin/env node
import madge from 'madge';

async function main() {
  const targets = [
    'modules/grabbing-sensorex/frontend/**/*.{js,jsx,ts,tsx}',
  ];
  const opts = {
    baseDir: process.cwd(),
    fileExtensions: ['js', 'jsx', 'ts', 'tsx'],
    detectiveOptions: {
      es6: { mixedImports: true },
      jsx: true,
      ts: { skipTypeImports: true },
    },
    tsConfig: null,
    webpackConfig: null,
    includeNpm: false,
  };
  const result = await madge(targets, opts);
  const cycles = result.circular();
  if (cycles && cycles.length) {
    console.log('Found circular dependencies in grabbing-sensorex frontend:');
    for (const c of cycles) console.log('- ' + c.join(' -> '));
    process.exitCode = 1;
    return;
  }
  console.log('No circular dependencies detected in grabbing-sensorex frontend.');
}

main().catch((err) => {
  console.error('madge failed:', err && (err.stack || err.message || err));
  process.exitCode = 2;
});

