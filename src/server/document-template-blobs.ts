import { randomUUID } from 'node:crypto'
import { cp } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export type DocumentTemplateBlobStore = {
  delete: (key: string) => Promise<void>
  list: (options: {
    prefix: string
    paginate: true
  }) => AsyncIterable<{
    blobs: Array<{ key: string }>
  }>
}

export function createDocumentTemplateBlobKey(templateId: string, fileType: string) {
  const extension = fileType.toLowerCase().replace(/[^a-z0-9]/g, '') || 'xlsx'
  return `${templateId}/${Date.now()}-${randomUUID()}.${extension}`
}

export function resolveLocalDocumentTemplateBlobDirectory(homeDirectory = homedir()) {
  return resolve(homeDirectory, '.welding-journal', 'blobs-serve')
}

export async function migrateLegacyLocalDocumentTemplateBlobs(
  legacyDirectory: string,
  targetDirectory: string,
) {
  if (resolve(legacyDirectory) === resolve(targetDirectory)) return

  try {
    await cp(legacyDirectory, targetDirectory, {
      recursive: true,
      force: false,
      errorOnExist: false,
    })
  } catch {
    // Legacy local files are best-effort only. A protected or missing source must
    // not prevent the new local store from starting.
  }
}

export async function deleteDocumentTemplateBlobVersions(
  store: DocumentTemplateBlobStore,
  templateId: string,
  options: {
    keepKey?: string
    activeKey?: string
  } = {},
) {
  const prefix = `${templateId}/`
  const keys = new Set<string>()
  for await (const page of store.list({ prefix, paginate: true })) {
    for (const blob of page.blobs) {
      const key = decodeBlobKey(blob.key)
      if (key.startsWith(prefix) && key !== options.keepKey) keys.add(key)
    }
  }

  const orderedKeys = Array.from(keys).sort((left, right) => {
    if (left === options.activeKey) return 1
    if (right === options.activeKey) return -1
    return left.localeCompare(right, 'ru', { numeric: true })
  })
  for (const key of orderedKeys) await store.delete(key)
  return orderedKeys
}

function decodeBlobKey(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
