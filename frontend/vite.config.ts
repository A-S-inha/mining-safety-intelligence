import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mastraTarget = env.VITE_MASTRA_PROXY_TARGET || 'http://localhost:4111';

  const longPollMs = 600_000; // 10m — MUE workflow is multiple NIM calls + big JSON

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/find-mues': {
          target: mastraTarget,
          changeOrigin: true,
          timeout: longPollMs,
          proxyTimeout: longPollMs,
        },
        '/find-controls': {
          target: mastraTarget,
          changeOrigin: true,
          timeout: longPollMs,
          proxyTimeout: longPollMs,
        },
      },
    },
  };
});
