import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT } from './shared/ports.js'

// 4747/5173 are the learner's own dev session. Test runs (scripts/with-temp-data.ts) set PORT/WEB_PORT to the test pair.
const API_PORT = Number(process.env.PORT ?? DEFAULT_API_PORT)
const WEB_PORT = Number(process.env.WEB_PORT ?? DEFAULT_WEB_PORT)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src'), '@shared': path.resolve(import.meta.dirname, './shared') } },
  server: { host: '127.0.0.1', port: WEB_PORT, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } } },
})
