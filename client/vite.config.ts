import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import sbom from 'rollup-plugin-sbom'

export default defineConfig(({command}) => ({
  plugins: [
    react(),
    command == "build" && sbom()
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://server:3001',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://server:3001',
        ws: true
      }
    }
  }
}));
