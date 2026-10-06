import { execFileSync, spawn } from 'node:child_process'

const memory = Number(process.env.AUDIT_CONTAINER_MEMORY_MIB)
if (![2048, 4096].includes(memory)) throw new Error('Explicit local memory limit required')
const defaultHeap = process.env.AUDIT_CONTAINER_DEFAULT_HEAP === '1'
const name = `welding-release-resource-${memory}`
const image = 'welding-journal:release-resource-local-20261003'
const existing = execFileSync('docker', ['container', 'ls', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim()
if (existing) throw new Error(`Refuse existing container ${name}`)
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  try {
    const metadata = JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0]
    if (metadata.Config.Image !== image || metadata.Config.Labels?.['welding.local-audit'] !== 'release-resource') return
    try {
      if (metadata.State.Running) {
        const usage = execFileSync('docker', ['exec', name, 'sh', '-c', 'cat /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events'], { encoding: 'utf8' })
        // Playwright captures web-server stderr even without DEBUG=pw:webserver.
        console.error(JSON.stringify({ resourceLimitMiB: memory, defaultHeap, cgroupPeakAndEvents: usage.trim() }))
      } else {
        console.error(JSON.stringify({ resourceLimitMiB: memory, defaultHeap, exitCode: metadata.State.ExitCode, kernelOomKilled: metadata.State.OOMKilled }))
      }
    } finally {
      if (metadata.State.Running) execFileSync('docker', ['stop', '--timeout', '1', metadata.Id], { stdio: 'ignore', timeout: 10_000 })
      execFileSync('docker', ['rm', metadata.Id], { stdio: 'ignore', timeout: 10_000 })
    }
  } catch (error) {
    console.error('Local resource-container cleanup/measurement:', error.message)
  }
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
const child = spawn('docker', ['run', '--pull=never', '--name', name,
  '--label', 'welding.local-audit=release-resource', '--memory', `${memory}m`, '--memory-swap', `${memory}m`,
  '--cpus', '2', '--pids-limit', '128', '--read-only', '--tmpfs', '/tmp:rw,size=64m',
  '-p', '127.0.0.1:3100:3000', '-w', '/app',
  '-e', 'DATABASE_URL=postgresql://welding:welding@host.docker.internal:5432/welding_tracker_e2e',
  '-e', 'WELDING_ENV_LOADED=1', '-e', 'NODE_ENV=production', '-e', 'HOST=0.0.0.0', '-e', 'PORT=3000',
  '-e', 'DATABASE_POOL_MAX=5', '-e', 'DOCUMENT_TEMPLATE_STORAGE_PATH=/tmp/templates',
  ...(defaultHeap ? [] : ['-e', `NODE_OPTIONS=--max-old-space-size=${memory === 2048 ? 1536 : 3072}`]),
  image, 'node', '.output/server/index.mjs'], { stdio: 'inherit', detached: true })
try {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
  process.exitCode = stopping ? 0 : code ?? 1
} finally { stop() }
