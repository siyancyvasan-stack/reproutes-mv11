import fs from 'fs';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({ mode }) => {
  const backendEnv = loadEnv(mode, path.resolve(__dirname, '../backend'), '');
  const port = Number(backendEnv.FACTORY_PORT || '4003');
  const target = `http://127.0.0.1:${backendEnv.PORT || '4000'}`;
  const appVersion = backendEnv.VITE_APP_VERSION || backendEnv.APP_VERSION || '';

  // Automatically sync package.json version with backend .env
  try {
    const pkgPath = path.resolve(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (appVersion && pkg.version !== appVersion) {
        pkg.version = appVersion;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      }
    }
  } catch {}

  const envDefines: Record<string, string> = {
    'import.meta.env.APP_VERSION': JSON.stringify(backendEnv.APP_VERSION || appVersion),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_FACTORY_APP_VERSION': JSON.stringify(backendEnv.VITE_FACTORY_APP_VERSION || appVersion),
  };

  for (const [key, val] of Object.entries(backendEnv)) {
    if (key.startsWith('VITE_') && !envDefines[`import.meta.env.${key}`]) {
      envDefines[`import.meta.env.${key}`] = JSON.stringify(val);
    }
  }

  return {
    define: envDefines,
    // Vite/esbuild compiles the project's react-jsx TypeScript directly. The
    // Fast Refresh plugin is intentionally omitted because it requires the HMR
    // preamble/WebSocket that is disabled for this standalone frontend.
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    server: {
      host: '0.0.0.0',
      port,
      strictPort: true,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
        '/health': {
          target,
          changeOrigin: true,
        },
        '/api-docs': {
          target,
          changeOrigin: true,
        },
        '/socket.io': {
          target,
          changeOrigin: true,
          ws: true,
        },
        '/uploads': {
          target,
          changeOrigin: true,
        },
        '/media': {
          target,
          changeOrigin: true,
        },
      },
      // This project runs as a standalone frontend. Disabling HMR prevents the
      // stale injected WebSocket endpoint from reconnecting to port 24680.
      hmr: false,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE' || warning.message?.includes('use client')) {
            return;
          }
          warn(warning);
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('html2canvas') || id.includes('jspdf') || id.includes('canvg') || id.includes('dompurify')) {
                return 'vendor-export';
              }
              if (id.includes('recharts') || id.includes('d3')) {
                return 'vendor-charts';
              }
              if (id.includes('leaflet')) {
                return 'vendor-maps';
              }
            }
          }
        }
      }
    },
  };
});
