import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: (() => {
        const buildId = process.env.VITE_BUILD_ID ? String(process.env.VITE_BUILD_ID) : '';
        const dir = buildId ? `assets/${buildId}` : 'assets';
        return {
          entryFileNames: `${dir}/[name]-[hash].js`,
          chunkFileNames: `${dir}/[name]-[hash].js`,
          assetFileNames: `${dir}/[name]-[hash][extname]`,
          manualChunks(id) {
            try {
              const p = id.replace(/\\/g, '/');
              // Quick fix: avoid a separate React vendor chunk to prevent TDZ during eval
              // Bundle React, React-DOM, and scheduler into the main entry chunk
              if (p.includes('/node_modules/react')) return 'index';
              if (p.includes('/node_modules/react-dom')) return 'index';
              if (p.includes('/node_modules/scheduler')) return 'index';
              // Let Rollup split GS like other modules (no special grouping)
            } catch {}
            return undefined;
          },
        };
      })()
    }
  },
  resolve: {
    alias: {
      '@modules': path.resolve(__dirname, '../modules'),
      '@shared-modules': path.resolve(__dirname, '../modules/shared/frontend'),
      '@modules/shared/frontend': path.resolve(__dirname, '../modules/shared/frontend'),
      'modules/shared/frontend': path.resolve(__dirname, '../modules/shared/frontend'),
      '@system-modules': path.resolve(__dirname, '../modules/system/frontend'),
      '@app-lib': path.resolve(__dirname, 'src/lib'),
      '@app-utils': path.resolve(__dirname, 'src/utils'),
      '@tiptap': path.resolve(__dirname, 'node_modules/@tiptap'),
      '@emoji-mart': path.resolve(__dirname, 'node_modules/@emoji-mart'),
      'tinymce': path.resolve(__dirname, 'node_modules/tinymce'),
    },
  },
});
