import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

function tanstackClientRpcDevCompatibility(): Plugin {
  return {
    name: 'tanstack-client-rpc-dev-compatibility',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (
        !id.includes('@tanstack/start-client-core') ||
        !id.includes('/client-rpc/createClientRpc') ||
        !code.includes('process.env.TSS_SERVER_FN_BASE')
      ) {
        return null
      }

      return code.replaceAll('process.env.TSS_SERVER_FN_BASE', JSON.stringify('/_serverFn/'))
    },
  }
}

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
  plugins: [tanstackClientRpcDevCompatibility(), tanstackStart(), nitro(), react()],
})
