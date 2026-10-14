import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

// Use the transport's installed serializer for forged-payload guard tests.
// Calling an uncompiled createServerFn directly has no Start request context.
const startRequire = createRequire(import.meta.resolve('@tanstack/react-start/client-rpc'))
const coreRequire = createRequire(startRequire.resolve('@tanstack/start-client-core/package.json'))
const { toJSONAsync } = coreRequire('seroval') as { toJSONAsync: (value: unknown) => Promise<unknown> }
export async function serializeRpcData(data: unknown): Promise<string> {
  return JSON.stringify(await toJSONAsync({ data }))
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
    const directory = resolve('.output/server')
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
