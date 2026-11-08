import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

// Use the transport's installed serializer for forged-payload guard tests.
// Calling an uncompiled createServerFn directly has no Start request context.
const startRequire = createRequire(import.meta.resolve('@tanstack/react-start/client-rpc'))
const coreRequire = createRequire(startRequire.resolve('@tanstack/start-client-core/package.json'))
const { toJSONAsync, fromJSON, fromCrossJSON } = coreRequire('seroval') as {
  toJSONAsync: (value: unknown) => Promise<unknown>
  fromJSON: (value: unknown) => unknown
  fromCrossJSON: (value: unknown, options: { plugins: unknown[] }) => unknown
}
export async function serializeRpcData(data: unknown): Promise<string> {
  return serializeRpcPayload({ data })
}

export async function serializeRpcPayload(payload: unknown): Promise<string> {
  return JSON.stringify(await toJSONAsync(payload))
}

/** Inspect the actual typed request when asserting bounded browser RPC scopes. */
export function deserializeRpcPayload(payload: string): unknown {
  return fromJSON(JSON.parse(payload))
}

let productionNames: Map<string, string> | undefined

/** Count actual RPCs in both dev and production; production IDs are hashes, not JSON. */
export function rpcName(url: string): string {
  const id = new URL(url).pathname.split('/_serverFn/')[1]
  if (!id) return ''
  const decoded = decodeURIComponent(id)
  if (!/^[a-f0-9]{64}$/.test(decoded)) {
    return JSON.parse(Buffer.from(decoded, 'base64url').toString()).export as string
  }
  if (!productionNames) {
    const directory = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
    const resolvers = readdirSync(directory).filter(name => name.includes('tanstack-start-server-fn-resolver') && name.endsWith('.mjs'))
    if (resolvers.length !== 1) throw new Error('Expected one production server-function manifest')
    const source = readFileSync(resolve(directory, resolvers[0]), 'utf8')
    productionNames = new Map([...source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName:\s*"([^"\n]+)"/g)]
      .map(match => [match[1], match[2]]))
  }
  const name = productionNames.get(decoded)
  if (!name) throw new Error(`Unknown production RPC: ${decoded}`)
  return name
}

/** Resolve another export from an observed server-function module. */
export function siblingRpcUrl(observedUrl: string, exportName: string): string {
  const url = new URL(observedUrl)
  const id = decodeURIComponent(url.pathname.split('/_serverFn/')[1])
  if (/^[a-f0-9]{64}$/.test(id)) {
    rpcName(observedUrl)
    const match = [...productionNames!].find(([, name]) => name === exportName)
    if (!match) throw new Error(`Missing production RPC: ${exportName}`)
    url.pathname = '/_serverFn/' + match[0]
  } else {
    const metadata = JSON.parse(Buffer.from(id, 'base64url').toString())
    metadata.export = exportName
    url.pathname = '/_serverFn/' + Buffer.from(JSON.stringify(metadata)).toString('base64url')
  }
  url.search = ''
  return url.toString()
}

export async function deserializeRpcResponse(payload: string): Promise<unknown> {
  // The app has no custom serialization adapters. Use the transport's default
  // router plugins directly: Start's wrapper expects a live request context.
  const routerPackage = coreRequire('@tanstack/router-core/package.json')
  const location = resolve(dirname(coreRequire.resolve('@tanstack/router-core/package.json')), routerPackage.exports['./ssr/client'].import.default)
  const { createDefaultSerovalPlugins } = await import(pathToFileURL(location).href)
  return fromCrossJSON(JSON.parse(payload), { plugins: createDefaultSerovalPlugins() })
}

/** Decode the real Start transport, including RawStream responses. Keep the
 * installed frame parser and serializer plugins as the protocol authority. */
export async function deserializeRpcHttpResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/x-tss-framed')) return deserializeRpcResponse(await response.text())
  const version = /;\s*v=(\d+)/.exec(contentType)?.[1]
  if (version && version !== '1') throw new Error(`Unsupported E2E framed protocol version ${version}`)
  if (!response.body) throw new Error('Framed E2E response has no body')
  const clientDirectory = dirname(coreRequire.resolve('@tanstack/start-client-core/package.json'))
  const { createFrameDecoder } = await import(pathToFileURL(resolve(clientDirectory, 'dist/esm/client-rpc/frame-decoder.js')).href)
  const routerPackage = coreRequire('@tanstack/router-core/package.json')
  const routerClient = resolve(dirname(coreRequire.resolve('@tanstack/router-core/package.json')), routerPackage.exports['./ssr/client'].import.default)
  const { createDefaultSerovalPlugins, createRawStreamDeserializePlugin } = await import(pathToFileURL(routerClient).href)
  const [records, getStream] = createFrameDecoder(response.body) as [ReadableStream<string>, (id: number) => ReadableStream<Uint8Array>]
  const reader = records.getReader()
  const options = { refs: new Map(), plugins: [createRawStreamDeserializePlugin(getStream), ...createDefaultSerovalPlugins()] }
  try {
    const first = await reader.read()
    if (first.done) throw new Error('Framed E2E response ended before its first record')
    const result = fromCrossJSON(JSON.parse(first.value), options)
    // The raw stream follows the initial JSON record. Drain later records
    // concurrently, just as Start's client does, so backpressure can advance.
    void (async () => {
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) return
          fromCrossJSON(JSON.parse(next.value), options)
        }
      } catch (error) {
        // Cancelling the JSON lane propagates failure to every raw stream.
        await reader.cancel(error).catch(() => {})
      } finally { reader.releaseLock() }
    })()
    return result
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    reader.releaseLock()
    throw error
  }
}

/** A visible tab records activity while checking identity; a hidden tab only checks identity. */
export function isAccountRefreshRpc(name: string): boolean {
  return /^(getCurrentAccount|refreshAccountActivity)(?:_|$)/.test(name)
}
