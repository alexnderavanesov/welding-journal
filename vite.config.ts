import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { devTransportCancellation } from './scripts/vite-dev-transport.ts'
import { pdfAssets } from './scripts/vite-pdf-assets.ts'

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
    // Generated HTML reports must not reload the open application when tests,
    // builds or local file synchronization update their artifacts.
    watch: {
      ignored: ['**/outputs/**', '**/test-results/**', '**/test-results [0-9]*/**', '**/playwright-report/**', '**/.output/**'],
    },
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
  plugins: [tanstackClientRpcDevCompatibility(), tanstackStart({ start: { entry: './start.ts' } }), nitro(), react(), devTransportCancellation(), pdfAssets()],
})
