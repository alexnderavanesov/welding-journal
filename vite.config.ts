import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/xlsx/')) return 'vendor-xlsx'
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          return undefined
        },
      },
    },
  },
  plugins: [tanstackStart(), react(), netlify()],
})
