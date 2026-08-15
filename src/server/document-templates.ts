import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { requireDb } from '@/db'
import { documentTemplates } from '@/db/schema'
import type {
  DocumentTemplateConstructorConfig,
  DocumentTemplateId,
  DocumentTemplateOptions,
  StoredDocumentTemplate,
  TemplateMarkerLocation,
} from '@/lib/document-template-storage'
import {
  createDocumentTemplateFileStore,
  createDocumentTemplateFileKey,
  deleteDocumentTemplateFileVersions,
  resolveDocumentTemplateStorageDirectory,
} from '@/server/document-template-files'
import { assertSecurityScope } from '@/server/security-functions'

const DOCUMENT_TEMPLATE_IDS = new Set<DocumentTemplateId>([
  'weldingJournal',
  'checklist',
  'zni',
  'lnkRequest',
  'lnkConclusionVik',
  'lnkConclusionRk',
  'lnkConclusionUzk',
  'lnkConclusionPvk',
  'lnkConclusionOther',
  'pstoRequest',
  'pstoConclusion',
])
const templateStore = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())

type DocumentTemplateMetadata = {
  sheetNames?: string[]
  fields: string[]
  markerCount: number
  locations: TemplateMarkerLocation[]
  warnings: string[]
}

export type RemoteDocumentTemplate = Omit<StoredDocumentTemplate, 'fileData'> & {
  fileDataBase64: string
}

export type RemoteDocumentTemplateSummary = Omit<StoredDocumentTemplate, 'fileData'>

type SaveDocumentTemplateInput = {
  id: DocumentTemplateId
  fileName: string
  fileType: string
  fileSize: number
  fileDataBase64: string
  sheetNames?: string[]
  fields: string[]
  markerCount: number
  locations: TemplateMarkerLocation[]
  warnings: string[]
  constructorConfig?: DocumentTemplateConstructorConfig | null
}

type UpdateDocumentTemplateInput = {
  id: DocumentTemplateId
  options?: DocumentTemplateOptions
  constructorConfig?: DocumentTemplateConstructorConfig
}

export const listRemoteDocumentTemplates = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  const db = requireDb()
  const rows = await db.select().from(documentTemplates)
  return rows.map(toTemplateSummary)
})

export const listRemoteDocumentTemplateIds = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  const db = requireDb()
  return db
    .select({ id: documentTemplates.id })
    .from(documentTemplates)
    .then((rows) => rows.map((row) => row.id))
})

export const getRemoteDocumentTemplate = createServerFn({ method: 'GET' })
  .validator((data: { id: DocumentTemplateId }) => ({ id: requireTemplateId(data?.id) }))
  .handler(async ({ data }): Promise<RemoteDocumentTemplate | null> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const [record] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, data.id)).limit(1)
    if (!record) return null

    const fileData = await templateStore.get(record.blobKey)
    if (!fileData) throw new Error('Файл шаблона не найден в общем хранилище.')

    return {
      ...toTemplateSummary(record),
      fileDataBase64: Buffer.from(fileData).toString('base64'),
    }
  })

export const saveRemoteDocumentTemplate = createServerFn({ method: 'POST' })
  .validator(normalizeSaveTemplateInput)
  .handler(async ({ data }): Promise<RemoteDocumentTemplate> => {
    await assertSecurityScope('settings')
    const db = requireDb()
    const [existing] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, data.id)).limit(1)
    const fileKey = createDocumentTemplateFileKey(data.id, data.fileType)
    const fileData = Buffer.from(data.fileDataBase64, 'base64')
    if (fileData.byteLength === 0) throw new Error('Файл шаблона пуст.')

    await templateStore.set(fileKey, fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength))
    const storedFile = await templateStore.get(fileKey)
    if (!storedFile || storedFile.byteLength !== fileData.byteLength) {
      await templateStore.delete(fileKey).catch(() => undefined)
      throw new Error('Не удалось проверить сохраненный файл шаблона в общем хранилище.')
    }

    const metadata: DocumentTemplateMetadata = {
      sheetNames: data.sheetNames,
      fields: data.fields,
      markerCount: data.markerCount,
      locations: data.locations,
      warnings: data.warnings,
    }
    const now = new Date()
    const constructorConfig =
      data.constructorConfig === undefined
        ? existing?.constructorConfig ?? null
        : data.constructorConfig === null
          ? null
          : JSON.stringify(data.constructorConfig)

    let saved: typeof documentTemplates.$inferSelect
    try {
      const savedRows = await db
        .insert(documentTemplates)
        .values({
          id: data.id,
          blobKey: fileKey,
          fileName: data.fileName,
          fileType: data.fileType,
          fileSize: fileData.byteLength,
          metadata: JSON.stringify(metadata),
          options: existing?.options ?? null,
          constructorConfig,
          uploadedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: documentTemplates.id,
          set: {
            blobKey: fileKey,
            fileName: data.fileName,
            fileType: data.fileType,
            fileSize: fileData.byteLength,
            metadata: JSON.stringify(metadata),
            constructorConfig,
            uploadedAt: now,
            updatedAt: now,
          },
        })
        .returning()
      const savedRecord = savedRows[0]
      if (!savedRecord) throw new Error('Не удалось сохранить шаблон документа.')
      saved = savedRecord
    } catch (error) {
      await templateStore.delete(fileKey).catch(() => undefined)
      throw error
    }

    // The database already points to the verified new file. Stale versions can be
    // cleaned up by the next replacement or deletion if storage cleanup is unavailable.
    await deleteDocumentTemplateFileVersions(templateStore, data.id, { keepKey: fileKey }).catch(() => undefined)
    return {
      ...toTemplateSummary(saved),
      fileDataBase64: data.fileDataBase64,
    }
  })

export const updateRemoteDocumentTemplate = createServerFn({ method: 'POST' })
  .validator(normalizeUpdateTemplateInput)
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const db = requireDb()
    const update: Partial<typeof documentTemplates.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (data.options !== undefined) update.options = JSON.stringify(data.options)
    if (data.constructorConfig !== undefined) update.constructorConfig = JSON.stringify(data.constructorConfig)

    const [saved] = await db
      .update(documentTemplates)
      .set(update)
      .where(eq(documentTemplates.id, data.id))
      .returning()
    return saved ? toTemplateSummary(saved) : null
  })

export const deleteRemoteDocumentTemplate = createServerFn({ method: 'POST' })
  .validator((data: { id: DocumentTemplateId }) => ({ id: requireTemplateId(data?.id) }))
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    const db = requireDb()
    const [record] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, data.id)).limit(1)
    const backup = record?.blobKey
      ? await templateStore.get(record.blobKey).catch(() => null)
      : null
    const deletedFileKeys = await deleteDocumentTemplateFileVersions(templateStore, data.id, {
      activeKey: record?.blobKey,
    })

    try {
      await db.delete(documentTemplates).where(eq(documentTemplates.id, data.id))
    } catch (error) {
      if (record?.blobKey && backup && deletedFileKeys.includes(record.blobKey)) {
        await templateStore.set(record.blobKey, backup)
      }
      throw error
    }

    return { ok: true, deletedFileCount: deletedFileKeys.length }
  })

function normalizeSaveTemplateInput(data: SaveDocumentTemplateInput): SaveDocumentTemplateInput {
  const fileType = String(data?.fileType ?? '').trim().toLowerCase()
  if (fileType !== 'xlsx' && fileType !== 'xls') {
    throw new Error('Поддерживаются только шаблоны Excel в форматах .xlsx и .xls.')
  }
  return {
    id: requireTemplateId(data?.id),
    fileName: String(data?.fileName ?? '').trim(),
    fileType,
    fileSize: Math.max(0, Math.floor(Number(data?.fileSize) || 0)),
    fileDataBase64: String(data?.fileDataBase64 ?? ''),
    sheetNames: Array.isArray(data?.sheetNames) ? data.sheetNames.map(String) : [],
    fields: Array.isArray(data?.fields) ? data.fields.map(String) : [],
    markerCount: Math.max(0, Math.floor(Number(data?.markerCount) || 0)),
    locations: Array.isArray(data?.locations) ? data.locations : [],
    warnings: Array.isArray(data?.warnings) ? data.warnings.map(String) : [],
    constructorConfig:
      data?.constructorConfig === null
        ? null
        : data?.constructorConfig
          ? data.constructorConfig
          : undefined,
  }
}

function normalizeUpdateTemplateInput(data: UpdateDocumentTemplateInput): UpdateDocumentTemplateInput {
  return {
    id: requireTemplateId(data?.id),
    options: data?.options,
    constructorConfig: data?.constructorConfig,
  }
}

function requireTemplateId(value: unknown): DocumentTemplateId {
  const id = String(value ?? '') as DocumentTemplateId
  if (!DOCUMENT_TEMPLATE_IDS.has(id)) throw new Error('Неизвестный тип шаблона.')
  return id
}

function toTemplateSummary(record: typeof documentTemplates.$inferSelect): RemoteDocumentTemplateSummary {
  const metadata = parseJson<DocumentTemplateMetadata>(record.metadata, {
    fields: [],
    markerCount: 0,
    locations: [],
    warnings: [],
  })
  return {
    id: requireTemplateId(record.id),
    fileName: record.fileName,
    fileType: record.fileType,
    fileSize: record.fileSize,
    uploadedAt: record.uploadedAt.toISOString(),
    sheetNames: metadata.sheetNames ?? [],
    fields: metadata.fields,
    markerCount: metadata.markerCount,
    locations: metadata.locations,
    warnings: metadata.warnings,
    options: parseJson<DocumentTemplateOptions | undefined>(record.options, undefined),
    constructorConfig: parseJson<DocumentTemplateConstructorConfig | undefined>(record.constructorConfig, undefined),
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
