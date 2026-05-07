import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'

// Suppress harmless broken-pipe noise from the WS proxy
const logger = createLogger()
const _error = logger.error.bind(logger)
logger.error = (msg, opts) => {
  if (typeof msg === 'string' && (msg.includes('EPIPE') || msg.includes('ECONNRESET'))) return
  _error(msg, opts)
}

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  preview: {
    port: 3001,
    host: '0.0.0.0',
    strictPort: true,
    cors: true
  },
  server: {
    port: 3001,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1')
      },
      '/ws': {
        target: 'ws://127.0.0.1:18789',
        ws: true,
        changeOrigin: true,
        rewrite: () => '/',
        headers: {
          Origin: 'http://127.0.0.1:18789'
        }
      }
    }
  }
})
