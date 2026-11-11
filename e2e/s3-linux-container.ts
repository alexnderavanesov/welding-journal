import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const image = 'welding-journal:s3-linux-node22-20261111'
const label = 'welding.local-audit=s3-linux-node22'
const docker = (args: string[]) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  // Never emit Docker inspect (it contains environment credentials).
  stdio: ['ignore', 'pipe', 'pipe'],
})

export async function startS3LinuxContainer(counts: string, fixtures: string, output: string) {
  const recovery = process.env.E2E_DATABASE_PROFILE === 'line-scheme-s3-restore'
  assert(['line-scheme-s3', 'line-scheme-s3-restore'].includes(process.env.E2E_DATABASE_PROFILE ?? ''))
  const database = recovery ? 'welding_tracker_s3_restore_20261111' : 'welding_tracker_s3_e2e_20261111'
  const port = recovery ? 3109 : 3107
  assert.equal(process.env.DATABASE_URL, `postgresql://welding:welding@127.0.0.1:5432/${database}`)
  assert.equal(process.env.BETTER_AUTH_URL, `http://127.0.0.1:${port}`)
  assert.equal(process.env.LINE_SCHEME_S3_BUCKET, 'welding-journal-schemes-test')
  const name = `welding-s3-linux-${randomUUID()}`
  let id: string | undefined
  const stop = async () => {
    if (!id) return
    const metadata = JSON.parse(docker(['inspect', id]))[0]
    assert.equal(metadata.Config.Image, image)
    assert.equal(metadata.Config.Labels?.['welding.local-audit'], 's3-linux-node22')
    // Application errors are already sanitized; don't persist environment/inspect.
    const logs = spawnSync('docker', ['logs', id], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })
    await writeFile(join(output, 'container.log'), (logs.stdout ?? '') + (logs.stderr ?? ''), { mode: 0o600 })
    if (metadata.State.Running) docker(['stop', '--time', '10', id])
    const stopped = JSON.parse(docker(['inspect', id]))[0]
    await writeFile(join(output, 'container-exit.json'), JSON.stringify({
      nodeImage: image, memoryMiB: 4096, cpus: 2, temporaryMemoryMiB: 512,
      exitCode: stopped.State.ExitCode, oomKilled: stopped.State.OOMKilled,
    }, null, 2) + '\n')
    docker(['rm', id]); id = undefined
  }
  const execute = (script: string) => docker(['exec', id!, 'node', script])
  try {
    // Only the already verified output is sent to Docker. Network is disabled
    // during build; no .env, source checkout or working data enter the image.
    docker(['build', '--network=none', '--pull=false', '-f', resolve('e2e/Dockerfile.resource'), '-t', image, resolve('.output')])
    const inherited = ['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'LINE_SCHEME_S3_ENDPOINT', 'LINE_SCHEME_S3_REGION',
      'LINE_SCHEME_S3_BUCKET', 'LINE_SCHEME_S3_ACCESS_KEY_ID', 'LINE_SCHEME_S3_SECRET_ACCESS_KEY']
    id = docker(['create', '--pull=never', '--name', name, '--label', label,
      '--memory', '4096m', '--memory-swap', '4096m', '--cpus', '2', '--pids-limit', '128',
      '--read-only', '--tmpfs', '/tmp:rw,size=512m', '-p', `127.0.0.1:${port}:3000`, '-w', '/app',
      '--mount', `type=bind,source=${resolve('e2e/audit-server.mjs')},target=/app/audit-server.mjs,readonly`,
      '--mount', `type=bind,source=${resolve('e2e/s3-linux-probe.mjs')},target=/app/s3-linux-probe.mjs,readonly`,
      '--mount', `type=bind,source=${fixtures},target=/audit-fixtures,readonly`,
      '--mount', `type=bind,source=${counts},target=/audit-counts`,
      '-e', `DATABASE_URL=postgresql://welding:welding@host.docker.internal:5432/${database}`,
      '-e', 'WELDING_ENV_LOADED=1', '-e', 'NODE_ENV=production', '-e', 'HOST=0.0.0.0', '-e', 'PORT=3000',
      '-e', 'DATABASE_POOL_MAX=5', '-e', 'DOCUMENT_TEMPLATE_STORAGE_PATH=/tmp/templates',
      '-e', 'AUTH_MAIL_MODE=local', '-e', 'SMTP_HOST=127.0.0.1', '-e', 'AUTH_MAIL_LOCAL_DIR=/tmp/auth-mail',
      '-e', `E2E_DATABASE_PROFILE=${process.env.E2E_DATABASE_PROFILE}`, '-e', 'E2E_S3_LINUX=1', '-e', 'LINE_SCHEME_STORAGE_DRIVER=s3',
      '-e', 'E2E_USE_PRODUCTION_BUILD=1', '-e', 'AUDIT_RESOURCE_CONTAINER=1', '-e', 'AUDIT_SQL_COUNTS_FILE=/audit-counts/counts.json',
      ...inherited.flatMap(key => ['-e', key]), image, 'node', 'audit-server.mjs']).trim()
    assert.match(id, /^[a-f0-9]{64}$/)
    docker(['start', id])
    for (let i = 0; i < 120; i++) {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(1_000) }).catch(() => null)
      if (response?.ok) { await response.body?.cancel(); break }
      await response?.body?.cancel()
      assert.equal(JSON.parse(docker(['inspect', id]))[0].State.Running, true, 'Linux server exited during startup')
      assert(i < 119, 'Linux server did not start'); await delay(250)
    }
    console.log(`S3 Linux: isolated Node 22 server ready on 127.0.0.1:${port} (2 CPU / 4 GiB, /tmp 512 MiB)`)
    return {
      stop,
      probe: () => console.log(execute('/app/s3-linux-probe.mjs').trim()),
      inspectTemporaryFiles: async () => {
        const script = `const fs=require('node:fs');const pending=fs.readdirSync('/tmp').filter(n=>n.startsWith('.scheme-upload-'));const workers=fs.readdirSync('/proc').filter(n=>/^\\d+$/.test(n)&&n!==String(process.pid)).filter(n=>{try{return fs.readFileSync('/proc/'+n+'/cmdline','utf8').includes('line-scheme-pdf-worker-')}catch{return false}});console.log(JSON.stringify({pending,workers,node:process.version,platform:process.platform,arch:process.arch}))`
        const report = JSON.parse(docker(['exec', id!, 'node', '-e', script]))
        assert.deepEqual(report.pending, [])
        assert.deepEqual(report.workers, [])
        await writeFile(join(output, 'temporary-files.json'), JSON.stringify(report, null, 2) + '\n')
      },
    }
  } catch (error) { await stop(); throw error }
}
