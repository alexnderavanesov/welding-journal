#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function verifyClientRuntime(directory) {
  const files = []
  const visit = async folder => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) files.push(file)
    }
  }
  await visit(directory)
  if (!files.length) throw new Error('No client JavaScript assets found; cannot verify server runtime isolation.')
  const leaked = []
  for (const file of files) {
    // Node request-local state has no browser runtime. Vite can turn its import
    // into an empty external shim while retaining the constructor side effect.
    if (/\bAsyncLocalStorage\b|\bnode:async_hooks\b/.test(await readFile(file, 'utf8'))) leaked.push(path.relative(directory, file))
  }
  if (leaked.length) throw new Error(`Node request-local runtime leaked into client assets: ${leaked.join(', ')}`)
  return files.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyClientRuntime(path.resolve(process.argv[2] ?? '.output/public')).then(count => {
    console.log(`Verified ${count} client assets: no Node request-local runtime.`)
  }).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
