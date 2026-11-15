import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('ships the advertised prewarm command in the runtime image without the source tree', () => {
  const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const command = manifest.scripts['maintenance:dispatcher-prewarm']
  expect(command).toBe('node scripts/prewarm-dispatcher.mjs')
  const runtime = readFileSync(resolve('Dockerfile'), 'utf8').split(' AS runtime')[1]
  expect(runtime).toContain('COPY --from=build /app/scripts/prewarm-dispatcher.mjs ./scripts/prewarm-dispatcher.mjs')
  // This maintenance client must work in the output-only image: it cannot
  // import source modules, tsx or development dependencies.
  expect(readFileSync(resolve('scripts/prewarm-dispatcher.mjs'), 'utf8')).not.toMatch(/^\s*(?:import\b|.*\brequire\()/m)
})
