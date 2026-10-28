// Explicit opt-in, local-only. e2e/run.ts owns the fresh disposable database.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { dirname, resolve, basename } from 'node:path'
import { mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

assert.equal(process.env.AUDIT_MIXED_LOAD, '1')
assert.equal(process.env.AUDIT_SQL_COUNTS, '1')
assert.equal(process.env.E2E_USE_PRODUCTION_BUILD, '1')
const name = 'welding-mixed-resource-20261009'
const image = process.env.AUDIT_CONTAINER_IMAGE || 'welding-journal:mixed-audit-20261009'
assert(['welding-journal:mixed-audit-20261009', 'welding-journal:systemic-baseline-20261027'].includes(image),
  'Only explicitly built local audit images are allowed')
const memoryMiB = Number(process.env.AUDIT_CONTAINER_MEMORY_MIB || 2048)
const cpus = Number(process.env.AUDIT_CONTAINER_CPUS || 2)
assert([2048, 4096].includes(memoryMiB), 'Choose an explicit supported local memory budget')
assert([2, 4].includes(cpus), 'Choose an explicit supported local CPU budget')
const counts = process.env.AUDIT_SQL_COUNTS_FILE
assert(counts && basename(counts) === 'counts.json')
const directory = realpathSync(dirname(counts))
assert(directory.startsWith(realpathSync(tmpdir()) + '/welding-e2e-sql-'))
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', ...options })
assert.equal(docker(['context', 'show']).trim(), 'desktop-linux', 'This audit is only authorized on local Docker Desktop')
const endpoint = JSON.parse(docker(['context', 'inspect', 'desktop-linux']))[0].Endpoints.docker.Host
assert.match(endpoint, /^unix:\/\//, 'Refuse a remote Docker endpoint')
assert(!process.env.DOCKER_HOST || process.env.DOCKER_HOST === endpoint, 'Refuse an overridden Docker endpoint')
assert.equal(docker(['ps', '-aq', '--filter', `name=^/${name}$`]).trim(), '', 'Refuse an existing container')
// Complete 200k-row files exceed the ordinary small-workflow 64 MiB tmpfs.
// Use a new subdirectory of this run's already owned diagnostic directory;
// this changes test storage, not an application limit or production setting.
const diskExports = process.env.AUDIT_EXPORT_CONCURRENCY === '1'
if (diskExports) mkdirSync(resolve(directory, 'report-tmp'))
let id, stopping = false
function stop() {
  if (stopping) return
  stopping = true
  if (!id) return
  try {
    const current = JSON.parse(docker(['inspect', id]))[0]
    assert.equal(current.Config.Image, image)
    assert.equal(current.Config.Labels?.['welding.local-audit'], 'mixed-20261009')
    console.error(JSON.stringify({ mixedContainerExit: current.State }))
    if (current.State.Running) docker(['stop', '--timeout', '2', id], { timeout: 10_000 })
    docker(['rm', id], { timeout: 10_000 })
  } catch (error) { console.error('Owned mixed container cleanup failed:', error.message); process.exitCode = 1 }
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
// No repository, .env, production credentials, or working database mounted.
id = docker(['create', '--pull=never', '--name', name, '--label', 'welding.local-audit=mixed-20261009',
  '--memory', `${memoryMiB}m`, '--memory-swap', `${memoryMiB}m`, '--cpus', String(cpus), '--pids-limit', '128', '--read-only',
  '--tmpfs', '/tmp:rw,size=64m', '-p', '127.0.0.1:3100:3000', '-w', '/app',
  '--mount', `type=bind,source=${resolve('e2e/audit-server.mjs')},target=/app/audit-server.mjs,readonly`,
  '--mount', `type=bind,source=${directory},target=/audit-counts`,
  '-e', 'DATABASE_URL=postgresql://welding:welding@host.docker.internal:5432/welding_tracker_e2e',
  '-e', 'WELDING_ENV_LOADED=1', '-e', 'NODE_ENV=production', '-e', 'HOST=0.0.0.0', '-e', 'PORT=3000',
  '-e', 'DATABASE_POOL_MAX=5', '-e', 'DOCUMENT_TEMPLATE_STORAGE_PATH=/tmp/templates',
  '-e', 'AUDIT_RESOURCE_CONTAINER=1', '-e', 'AUDIT_SQL_COUNTS_FILE=/audit-counts/counts.json',
  ...(diskExports ? ['-e', 'TMPDIR=/audit-counts/report-tmp'] : []),
  ...(['1', 'peak'].includes(process.env.AUDIT_HEAP_PROFILE) ? ['-e', `AUDIT_HEAP_PROFILE=${process.env.AUDIT_HEAP_PROFILE}`] : []),
  ...(process.env.AUDIT_CPU_PROFILE === '1' ? ['-e', 'AUDIT_CPU_PROFILE=1'] : []),
  '-e', 'E2E_USE_PRODUCTION_BUILD=1', image, 'node', 'audit-server.mjs']).trim()
try {
  const metadata = JSON.parse(docker(['inspect', id]))[0]
  assert.equal(metadata.HostConfig.Memory, memoryMiB * 1024 ** 2)
  assert.equal(metadata.HostConfig.MemorySwap, metadata.HostConfig.Memory)
  assert.equal(metadata.HostConfig.NanoCpus, cpus * 1e9)
  console.error(JSON.stringify({ mixedContainer: id, imageId: metadata.Image, memoryBytes: metadata.HostConfig.Memory,
    memoryAndSwapBytes: metadata.HostConfig.MemorySwap, nanoCpus: metadata.HostConfig.NanoCpus, heap: 'Node default',
    exportTemporaryStorage: diskExports ? 'owned host disk' : '64 MiB tmpfs' }))
  const child = spawn('docker', ['start', '--attach', id], { stdio: 'inherit', detached: true })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  process.exitCode = stopping ? process.exitCode ?? 0 : code ?? 1
} finally { stop() }
