#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SERVER_FUNCTION_HASH = '[a-f0-9]{64}'
const MANIFEST_FILE_MARKER = 'tanstack-start-server-fn-resolver'

async function listModuleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listModuleFiles(entryPath)))
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(entryPath)
    }
  }

  return files
}

function collectMatches(contents, pattern) {
  return new Set(Array.from(contents.matchAll(pattern), (match) => match[1]))
}

export async function verifyServerFunctionManifest(serverOutputDirectory) {
  const files = await listModuleFiles(serverOutputDirectory)
  const manifestFiles = files.filter((file) => path.basename(file).includes(MANIFEST_FILE_MARKER))

  if (manifestFiles.length !== 1) {
    throw new Error(
      `Expected exactly one TanStack server-function manifest, found ${manifestFiles.length}.`,
    )
  }

  const manifestContents = await readFile(manifestFiles[0], 'utf8')
  const manifestHashes = collectMatches(
    manifestContents,
    new RegExp(`["'](${SERVER_FUNCTION_HASH})["']\\s*:\\s*\\{`, 'g'),
  )

  if (manifestHashes.size === 0) {
    throw new Error('The TanStack server-function manifest contains no function hashes.')
  }

  const rpcLocations = new Map()
  const rpcPattern = new RegExp(
    `createSsrRpc\\(\\s*["'](${SERVER_FUNCTION_HASH})["']\\s*\\)`,
    'g',
  )

  for (const file of files) {
    const contents = await readFile(file, 'utf8')
    for (const hash of collectMatches(contents, rpcPattern)) {
      const locations = rpcLocations.get(hash) ?? []
      locations.push(path.relative(serverOutputDirectory, file))
      rpcLocations.set(hash, locations)
    }
  }

  if (rpcLocations.size === 0) {
    throw new Error(
      'No createSsrRpc references were found. The build format may have changed; update this verifier before releasing.',
    )
  }

  const unresolved = Array.from(rpcLocations.entries()).filter(
    ([hash]) => !manifestHashes.has(hash),
  )

  if (unresolved.length > 0) {
    const details = unresolved
      .map(([hash, locations]) => `  ${hash}: ${locations.join(', ')}`)
      .join('\n')
    throw new Error(
      `Found ${unresolved.length} server RPC reference(s) missing from the manifest:\n${details}`,
    )
  }

  return {
    manifestFunctionCount: manifestHashes.size,
    rpcReferenceCount: rpcLocations.size,
  }
}

async function main() {
  const serverOutputDirectory = path.resolve(process.argv[2] ?? '.output/server')
  const result = await verifyServerFunctionManifest(serverOutputDirectory)
  console.log(
    `Verified ${result.manifestFunctionCount} server functions; ${result.rpcReferenceCount} RPC references resolve.`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
