import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
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
      // Publish only a complete, durable file. A reader never sees a half upload.
      const temporaryPath = `${path}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporaryPath, 'wx')
        try { await handle.writeFile(new Uint8Array(data)); await handle.sync() } finally { await handle.close() }
        await rename(temporaryPath, path)
        const directoryHandle = await open(dirname(path), 'r')
        try { await directoryHandle.sync() } finally { await directoryHandle.close() }
      } finally {
        await rm(temporaryPath, { force: true })
      }
    },
  }
}

/** Container writable layers disappear on redeploy. Check before any file mutation. */
export async function assertPersistentDocumentTemplateStorage(directory: string) {
  if (process.env.NODE_ENV !== 'production') return
  if (!process.env.DOCUMENT_TEMPLATE_STORAGE_PATH?.trim()) {
    throw new Error('Не задано постоянное хранилище шаблонов (DOCUMENT_TEMPLATE_STORAGE_PATH). Загрузка остановлена: файл не должен храниться внутри обновляемого приложения.')
  }
  if (process.platform !== 'linux') return // Local production-mode browser tests, not a container deployment.
  let mounts: string
  try { mounts = await readFile('/proc/self/mountinfo', 'utf8') } catch {
    throw new Error('Не удалось проверить постоянное хранилище шаблонов. Файлы не изменены.')
  }
  // Resolve existing ancestors so a symlink cannot hide an ephemeral destination.
  let existing = resolve(directory), suffix = ''
  while (true) {
    try { existing = await realpath(existing); break } catch (error) {
      if (!isMissingFileError(error) || dirname(existing) === existing) throw error
      suffix = `${existing.slice(dirname(existing).length)}/${suffix}`
      existing = dirname(existing)
    }
  }
  const target = resolve(existing, `.${suffix}`)
  if (!hasPersistentTemplateMount(target, mounts)) {
    throw new Error('Папка шаблонов не подключена к постоянному диску. Подключите volume для неё перед загрузкой: иначе обновление приложения удалит файлы. Ничего не изменено.')
  }
}

export function hasPersistentTemplateMount(directory: string, mountInfo: string) {
  const decode = (value: string) => value.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
  const mounts = mountInfo.split('\n').flatMap(line => {
    const [details, storage] = line.split(' - ')
    if (!storage) return []
    const target = decode(details.split(' ')[4] ?? '')
    return target && (directory === target || directory.startsWith(target === '/' ? '/' : `${target}/`))
      ? [{ target, type: storage.split(' ')[0] }] : []
  }).sort((a, b) => b.target.length - a.target.length)
  const mount = mounts[0]
  return Boolean(mount && !['overlay', 'tmpfs', 'ramfs', 'aufs', 'rootfs', 'squashfs'].includes(mount.type))
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
