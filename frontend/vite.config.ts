import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The public edge currently has a stale route for /assets/ that serves an
    // unrelated legacy frontend. Keep this app's Vite bundles on a distinct
    // path until that edge route is removed.
    assetsDir: "oyuns-static",
  },
  server: {
    port: 5173,
    proxy: {
      // Forward /api requests to the local FastAPI backend
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
