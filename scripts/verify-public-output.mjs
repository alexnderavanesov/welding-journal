import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'

const require = createRequire(import.meta.url)
const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))
const pdfVersion = require('pdfjs-dist/package.json').version
const assetName = /^assets\/[\w.$-]+-[\w-]{8}\.(?:js|mjs|css|svg|png|ico)$/
const credential = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{30,}|postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i
const sensitiveName = /PASSWORD|SECRET|TOKEN|PRIVATE_KEY|DATABASE_URL|ACCESS_KEY/i
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function privateValues() {
  const variables = [process.env]
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    try { variables.push(parse(await readFile(name))) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return [...new Set(variables.flatMap(env => Object.entries(env)
    .filter(([key, value]) => sensitiveName.test(key) && value?.length >= 12)
    .map(([, value]) => value)))]
}

export async function verifyPublicOutput(root, { secrets, fingerprints } = {}) {
  secrets ??= await privateValues()
  fingerprints ??= new Set(JSON.parse(await readFile(new URL('./private-fixture-fingerprints.json', import.meta.url), 'utf8')))
  let count = 0
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), relative = path.relative(root, file).split(path.sep).join('/')
      if (entry.isDirectory()) { await visit(file); continue }
      if (!entry.isFile()) throw new Error('Unexpected link or special file in public output: ' + relative)
      const bytes = await readFile(file)
      if (relative.startsWith('pdfjs/' + pdfVersion + '/')) {
        const suffix = relative.slice(('pdfjs/' + pdfVersion + '/').length)
        if (!/^(?:LICENSE|(?:cmaps|standard_fonts|wasm|iccs)\/[^/]+)$/.test(suffix) ||
          !bytes.equals(await readFile(path.join(pdfRoot, suffix)))) throw new Error('Unexpected PDF.js asset: ' + relative)
      } else {
        if (!assetName.test(relative)) throw new Error('Unexpected public file: ' + relative)
        const source = bytes.toString('utf8')
        const signature = bytes.subarray(0, 5).toString('hex')
        if (signature.startsWith('504b0304') || signature.startsWith('1f8b') || signature === '255044462d' ||
          bytes.subarray(0, 5).toString() === 'PGDMP' || /PostgreSQL database dump/i.test(source) ||
          credential.test(source) || secrets.some(secret => bytes.includes(Buffer.from(secret)))) {
          throw new Error('Private data detected in public output: ' + relative)
        }
        for (const [token] of source.matchAll(/[\w.-]{8,}(?:\/[\w.-]+)*/g)) {
          if (/[-/]/.test(token) && fingerprints.has(sha256(token))) throw new Error('Private fixture detected in public output: ' + relative)
        }
      }
      count++
    }
  }
  await visit(root)
  if (!count) throw new Error('Empty public output')
  return count
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyPublicOutput(path.resolve(process.argv[2] ?? '.output/public')).then(count => console.log('Verified ' + count + ' public files.'))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
