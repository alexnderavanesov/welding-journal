/** Opt-in test-bucket smoke check. No server-env, application server or database imports. */
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { PDFDocument } from 'pdf-lib'
import { readSchemeS3Config } from '../src/server/line-scheme-storage'
import { createS3SchemeFileStore } from '../src/server/line-scheme-s3'
import { schemeFileResponse } from '../src/server/line-scheme-file-response'

async function main() {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--allow-test-writes') {
    throw new Error('Run explicitly with --allow-test-writes; this creates and deletes only its own synthetic PDF in the test bucket.')
  }
  // Parse ONLY this ignored local file. Never inherit an AWS profile or runtime storage settings.
  const env = parse(await readFile(resolve('.env.s3-test.local')))
  const config = readSchemeS3Config(env, 'S3_TEST')
  assert.equal(config.endpoint, 'https://s3.ru-1.storage.selcloud.ru')
  assert.equal(config.region, 'ru-1')
  assert.equal(config.bucket, 'welding-journal-schemes-test')
  assert.equal(env.S3_TEST_FORCE_PATH_STYLE, 'false')
  const store = createS3SchemeFileStore(config), key = `${randomUUID()}.pdf`
  const steps: string[] = []
  let attemptedUpload = false, completed = false, currentStep = 'initial absence', failedStep: string | undefined
  const check = (step: string) => { steps.push(step); console.log(`PASS ${step}`) }
  const missing = async () => assert.rejects(() => store.size(key), /Файл PDF не найден/)
  const request = (headers: Record<string, string> = {}, method = 'GET') => new Request('http://127.0.0.1/pdf-check', { method, headers })
  const body = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close() } })
  try {
    await missing(); check(currentStep)
    const pdf = await PDFDocument.create(); pdf.addPage([300, 200]).drawText('Synthetic S3 adapter check')
    const bytes = await pdf.save(), digest = createHash('sha256').update(bytes).digest('hex')
    currentStep = 'validated upload'; attemptedUpload = true
    const uploaded = await store.upload(key, body(bytes))
    assert.deepEqual(uploaded, { size: bytes.length, pageCount: 1, digest }); check(currentStep)
    const revision = { fileKey: key, fileName: 'Проверка S3.pdf', size: uploaded.size }
    currentStep = 'full original bytes through HTTP response helper'
    const full = await schemeFileResponse(request(), revision, store)
    assert.equal(full.status, 200); assert.equal(full.headers.get('Cache-Control'), 'private, no-cache')
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), Buffer.from(bytes)); check(currentStep)
    currentStep = 'range 206'
    const range = await schemeFileResponse(request({ Range: 'bytes=10-29' }), revision, store)
    assert.equal(range.status, 206); assert.equal(range.headers.get('Content-Range'), `bytes 10-29/${bytes.length}`)
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), Buffer.from(bytes.subarray(10, 30))); check(currentStep)
    currentStep = 'HEAD and conditional 304'
    const head = await schemeFileResponse(request({}, 'HEAD'), revision, store)
    assert.equal(head.status, 200); assert.equal(head.body, null); assert.equal(head.headers.get('Content-Length'), String(bytes.length))
    assert.equal((await schemeFileResponse(request({ 'If-None-Match': `"${key}"` }), revision, store)).status, 304); check(currentStep)
    currentStep = 'immutable-key collision preserves original'
    pdf.addPage()
    const replacement = await pdf.save()
    await assert.rejects(() => store.upload(key, body(replacement)), /уже существует/)
    const unchanged = await schemeFileResponse(request(), revision, store)
    assert.deepEqual(Buffer.from(await unchanged.arrayBuffer()), Buffer.from(bytes)); check(currentStep)
    currentStep = 'anonymous read denied'
    const anonymous = await fetch(`https://${config.bucket}.${new URL(config.endpoint).host}/${key}`, { signal: AbortSignal.timeout(30_000) })
    assert.equal(anonymous.status, 403); await anonymous.body?.cancel(); check(currentStep)
    completed = true
  } catch (error) {
    failedStep = currentStep
    throw error
  } finally {
    try {
      if (attemptedUpload) {
        currentStep = 'ordinary deletion and retry'
        await store.remove(key); await missing(); await store.remove(key); await missing(); check(currentStep)
      }
    } catch (error) {
      completed = false; failedStep ??= currentStep
      throw error
    } finally {
      const directory = resolve('outputs/s3-adapter-2026-11-10')
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, `${key.slice(0, -4)}.json`), JSON.stringify({ at: new Date().toISOString(),
        endpoint: config.endpoint, bucket: config.bucket, key, completed, failedStep, steps,
        note: 'No database or production access. Ordinary deletion only; historical S3 versions may remain.' }, null, 2) + '\n', { mode: 0o600 })
    }
  }
}

main().catch(() => {
  // SDK/transport exceptions can include sensitive request details. Do not print them.
  console.error('S3 adapter check failed. See the last PASS above and the local report; credentials and provider errors are intentionally omitted.')
  process.exitCode = 1
})
