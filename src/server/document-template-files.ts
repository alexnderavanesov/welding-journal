import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

export type DocumentTemplateFileStore = {
  delete: (key: string) => Promise<void>
  get: (key: string) => Promise<ArrayBuffer | null>
  list: (prefix: string) => Promise<string[]>
  set: (key: string, data: ArrayBuffer) => Promise<void>
}

export function createDocumentTemplateFileKey(templateId: string, fileType: string) {
  const extension = fileType.toLowerCase().replace(/[^a-z0-9]/g, '') || 'xlsx'
  return `${templateId}/${Date.now()}-${randomUUID()}.${extension}`
}

export function resolveDocumentTemplateStorageDirectory(
  workingDirectory = process.cwd(),
  configuredDirectory = process.env.DOCUMENT_TEMPLATE_STORAGE_PATH,
) {
  return resolve(workingDirectory, configuredDirectory?.trim() || 'data/document-templates')
}

export function createDocumentTemplateFileStore(directory: string): DocumentTemplateFileStore {
  const rootDirectory = resolve(directory)

  return {
    async delete(key) {
      await rm(resolveStoragePath(rootDirectory, key), { force: true })
    },
    async get(key) {
      try {
        return toArrayBuffer(await readFile(resolveStoragePath(rootDirectory, key)))
      } catch (error) {
        if (isMissingFileError(error)) return null
        throw error
      }
    },
    async list(prefix) {
      const prefixDirectory = resolveStoragePath(rootDirectory, prefix)
      try {
        return (await readdir(prefixDirectory, { withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) => relative(rootDirectory, resolve(prefixDirectory, entry.name)).split(sep).join('/'))
      } catch (error) {
        if (isMissingFileError(error)) return []
        throw error
      }
    },
    async set(key, data) {
      const path = resolveStoragePath(rootDirectory, key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, new Uint8Array(data))
    },
  }
}

export async function deleteDocumentTemplateFileVersions(
  store: DocumentTemplateFileStore,
  templateId: string,
  options: {
    keepKey?: string
    activeKey?: string
  } = {},
) {
  const prefix = `${templateId}/`
  const orderedKeys = (await store.list(prefix))
    .filter((key) => key.startsWith(prefix) && key !== options.keepKey)
    .sort((left, right) => {
      if (left === options.activeKey) return 1
      if (right === options.activeKey) return -1
      return left.localeCompare(right, 'ru', { numeric: true })
    })
  for (const key of orderedKeys) await store.delete(key)
  return orderedKeys
}

function resolveStoragePath(rootDirectory: string, key: string) {
  const path = resolve(rootDirectory, key)
  if (!path.startsWith(`${rootDirectory}${sep}`)) {
    throw new Error('Недопустимый путь файла шаблона.')
  }
  return path
}

function toArrayBuffer(value: Buffer) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
