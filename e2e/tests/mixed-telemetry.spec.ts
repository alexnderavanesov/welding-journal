import { createServer, type ServerResponse } from 'node:http'
import { expect, test } from '@playwright/test'
import { observeMixedClient } from '../mixed-resource-telemetry'
import { rpcName } from '../rpc'

test('отмена чтения не путается с явно имитированным сбоем; настоящие ошибки записи не скрываются', async ({ browser }) => {
  const server = createServer((_request, response) => response.end('<html>telemetry fixture</html>'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE })
  const telemetry = observeMixedClient(context, 'writer')
  try {
    const page = await context.newPage(), address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a local ephemeral server')
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.route('**/_serverFn/**', async route => {
      if (rpcName(route.request().url()) === 'updateWeldJoint_injected') {
        telemetry.expectInjectedNetworkFailure(route.request())
      }
      await route.abort(route.request().method() === 'GET' || rpcName(route.request().url()).endsWith('_aborted') ? 'aborted' : 'failed')
    })
    const fail = async (name: string, method = 'POST') => {
      const url = '/_serverFn/' + Buffer.from(JSON.stringify({ export: name })).toString('base64url')
      await page.evaluate(async ({ url, method }) => { await fetch(url, { method }).catch(() => {}) }, { url, method })
      await expect.poll(() => telemetry.pending.size).toBe(0)
    }
    await fail('updateWeldJoint_realFirst')
    expect(telemetry.errors).toEqual(['updateWeldJoint_realFirst: net::ERR_FAILED'])
    await fail('getWeldReportSummary_obsolete', 'GET')
    await fail('readJournalGrid_aborted')
    await fail('getJournalReportSummary_aborted')
    await fail('updateWeldJoint_injected')
    expect(telemetry.expectedFailures).toEqual([
      'getWeldReportSummary_obsolete: net::ERR_ABORTED',
      'readJournalGrid_aborted: net::ERR_ABORTED',
      'getJournalReportSummary_aborted: net::ERR_ABORTED',
      'updateWeldJoint_injected: net::ERR_FAILED',
    ])
    await fail('updateWeldJoint_realLater')
    await fail('updateWeldJoint_aborted')
    await fail('readJournalGrid_realFailure')
    expect(telemetry.errors).toEqual([
      'updateWeldJoint_realFirst: net::ERR_FAILED',
      'updateWeldJoint_realLater: net::ERR_FAILED',
      'updateWeldJoint_aborted: net::ERR_ABORTED',
      'readJournalGrid_realFailure: net::ERR_FAILED',
    ])
  } finally {
    await context.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

for (const read of ['refreshDispatcherTaskSnapshot', 'getDispatcherTaskContext', 'readReportOutputSnapshot'])
test(`счётчик отличает уход со страницы от живого ${read} и не скрывает запись`, async ({ browser }) => {
  const held: ServerResponse[] = []
  let canceledSockets = 0
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/_serverFn/')) {
      held.push(response)
      response.on('close', () => { if (!response.writableEnded) canceledSockets++ })
    } else response.end('<html>telemetry fixture</html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE })
  const telemetry = observeMixedClient(context, 'telemetry-regression')
  try {
    const page = await context.newPage()
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a local ephemeral server')
    const origin = `http://127.0.0.1:${address.port}`
    const endpoint = (name: string) => '/_serverFn/' + Buffer.from(JSON.stringify({ export: name })).toString('base64url')
    await page.goto(origin + '/a')
    await page.evaluate(url => { void fetch(url, { method: 'POST' }).catch(() => {}) }, endpoint(`${read}_test`))
    await expect.poll(() => telemetry.pending.size).toBe(1)
    await page.evaluate(() => history.pushState({}, '', '/same-document'))
    expect(telemetry.pending.size).toBe(1)
    await page.goto(origin + '/b')
    await expect.poll(() => canceledSockets).toBe(1)
    expect(telemetry.pending.size).toBe(0)
    expect((await telemetry.summary()).abandonedOnNavigation).toEqual([`${read}_test`])

    await page.evaluate(url => { void fetch(url, { method: 'POST' }).catch(() => {}) }, endpoint(`${read}_test`))
    await expect.poll(() => telemetry.pending.size).toBe(1)
    held.at(-1)!.end('finished')
    await expect.poll(() => telemetry.pending.size).toBe(0)
    expect((await telemetry.summary()).rpc).toBe(1)

    await page.evaluate(url => { void fetch(url, { method: 'POST' }).catch(() => {}) }, endpoint('updateWeldJoint_test'))
    await expect.poll(() => telemetry.pending.size).toBe(1)
    await page.goto(origin + '/c')
    // A write with an unknown outcome must never disappear from the audit.
    expect(telemetry.pending.size + telemetry.errors.length).toBeGreaterThanOrEqual(1)
    expect((await telemetry.summary()).abandonedOnNavigation).toHaveLength(1)
  } finally {
    await context.close()
    for (const response of held) response.destroy()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('счётчик учитывает позднее чтение уходящей страницы и сохраняет живое чтение новой', async ({ browser }) => {
  const held: ServerResponse[] = []
  let navigationResponse: ServerResponse | undefined, canceled = 0
  const endpoint = (name: string) => '/_serverFn/' + Buffer.from(JSON.stringify({ export: name })).toString('base64url')
  const server = createServer((request, response) => {
    if (request.url === '/slow') navigationResponse = response
    else if (request.url?.startsWith('/_serverFn/')) {
      held.push(response)
      response.on('close', () => { if (!response.writableEnded) canceled++ })
    } else response.end('<html>old document</html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE }), telemetry = observeMixedClient(context, 'late-navigation-read')
  try {
    const page = await context.newPage(), address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a local ephemeral server')
    const origin = `http://127.0.0.1:${address.port}`
    await page.goto(origin)
    // Schedule on the departing document before navigation. Playwright's
    // evaluate itself waits for a pending navigation and cannot inject here.
    await page.evaluate(url => { setTimeout(() => { void fetch(url, { method: 'POST' }).catch(() => {}) }, 300) }, endpoint('getJournalReportSummary_old'))
    const navigation = page.goto(origin + '/slow').then(() => undefined, error => error)
    await expect.poll(() => Boolean(navigationResponse)).toBe(true)
    await expect.poll(() => telemetry.pending.size).toBe(1)
    navigationResponse!.end(`<html><script>fetch('${endpoint('getJournalReportSummary_live')}',{method:'POST'}).catch(()=>{})</script></html>`)
    expect(await navigation).toBeUndefined()
    await expect.poll(() => canceled).toBe(1)
    await expect.poll(() => [...telemetry.pending.keys()].map(request => rpcName(request.url()))).toEqual(['getJournalReportSummary_live'])
    expect((await telemetry.summary()).abandonedOnNavigation).toEqual(['getJournalReportSummary_old'])
    held.at(-1)!.end('finished')
    await expect.poll(() => telemetry.pending.size).toBe(0)
    expect(telemetry.errors).toEqual([])
  } finally {
    navigationResponse?.destroy()
    for (const response of held) response.destroy()
    server.closeAllConnections()
    await context.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
