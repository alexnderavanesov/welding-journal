import { eq, sql } from 'drizzle-orm'

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
  assertPersistentDocumentTemplateStorage,
} from '@/server/document-template-files'
import {
  GENERATED_DOCUMENT_TYPES,
  isLayeredControlDocumentType,
} from '@/lib/generated-document-types'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '@/lib/system-document-template-types'
import { assertSecurityScope } from '@/server/security-functions'
import { rebuildLayeredControlDocumentsInTransaction } from '@/server/layered-control-documents'
import { lockControlProcessSettings } from '@/server/control-process-settings-lock'
import { getNextTimestampVersion } from '@/server/timestamp-version'
import { validateDocumentTemplateRecovery } from '@/lib/document-template-replacement'

const DOCUMENT_TEMPLATE_IDS = new Set<DocumentTemplateId>([
  ...GENERATED_DOCUMENT_TYPES,
  ...SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => profile.id),
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
  expectedVersion: string | null
  recoverMissingFile?: boolean
}

type UpdateDocumentTemplateInput = {
  id: DocumentTemplateId
  expectedVersion: string
  options?: DocumentTemplateOptions
  constructorConfig?: DocumentTemplateConstructorConfig
}

export async function listRemoteDocumentTemplatesWithFiles(): Promise<RemoteDocumentTemplate[]> {
  return (await getRemoteDocumentTemplateInventory()).templates
}

export async function getRemoteDocumentTemplateInventory() {
  await assertSecurityScope('entry')
  return requireDb().transaction(async tx => {
    // Keep metadata and file reads together: a concurrent replacement must not
    // delete the old file after we read its key but before we read its bytes.
    await lockDocumentTemplateReads(tx, [...DOCUMENT_TEMPLATE_IDS])
    const rows = await tx.select().from(documentTemplates)
    const entries = await Promise.all(rows.map(async (record) => {
      const fileData = await templateStore.get(record.blobKey)
      return { summary: toTemplateSummary(record), fileData }
    }))
    const activeKeys = new Map(rows.map(row => [row.id, row.blobKey]))
    const storageWarnings: Partial<Record<DocumentTemplateId, string>> = {}
    await Promise.all([...DOCUMENT_TEMPLATE_IDS].map(async id => {
      try {
        if ((await templateStore.list(`${id}/`)).some(key => key !== activeKeys.get(id))) {
          storageWarnings[id] = 'В хранилище остались лишние файлы. Можно очистить их, не меняя активный шаблон и настройки конструктора.'
        }
      } catch { storageWarnings[id] = 'Не удалось проверить очистку файлов. Проверьте доступность хранилища и повторите очистку.' }
    }))
    return {
      templates: entries.flatMap(({ summary, fileData }) => fileData ? [{ ...summary, fileDataBase64: Buffer.from(fileData).toString('base64') }] : []),
      missing: entries.flatMap(({ summary, fileData }) => fileData ? [] : [summary]),
      storageWarnings,
    }
  })
}

export async function listRemoteDocumentTemplateIds() {
  await assertSecurityScope('entry')
  const db = requireDb()
  return db
    .select({ id: documentTemplates.id })
    .from(documentTemplates)
    .then((rows) => rows.map((row) => row.id))
}

export async function getRemoteDocumentTemplate({
  data: input,
}: {
  data: { id: DocumentTemplateId }
}): Promise<RemoteDocumentTemplate | null> {
  const data = { id: requireTemplateId(input?.id) }
  await assertSecurityScope('entry')
  const db = requireDb()
  return db.transaction(async tx => {
    await lockDocumentTemplateReads(tx, [data.id])
    const [record] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, data.id)).limit(1)
    if (!record) return null

    const fileData = await templateStore.get(record.blobKey)
    if (!fileData) throw new Error('Файл шаблона не найден в общем хранилище.')

    return {
      ...toTemplateSummary(record),
      fileDataBase64: Buffer.from(fileData).toString('base64'),
    }
  })
}

export async function saveRemoteDocumentTemplate({
  data: input,
}: {
  data: SaveDocumentTemplateInput
}): Promise<RemoteDocumentTemplate> {
  const data = normalizeSaveTemplateInput(input)
  await assertSecurityScope('settings')
  const db = requireDb()
  const fileKey = createDocumentTemplateFileKey(data.id, data.fileType)
  await assertPersistentDocumentTemplateStorage(resolveDocumentTemplateStorageDirectory())
  const fileData = Buffer.from(data.fileDataBase64, 'base64')
  if (fileData.byteLength === 0) throw new Error('Файл шаблона пуст.')

  const metadata: DocumentTemplateMetadata = {
    sheetNames: data.sheetNames,
    fields: data.fields,
    markerCount: data.markerCount,
    locations: data.locations,
    warnings: data.warnings,
  }
  let wroteFile = false
  const saved = await db.transaction(async (tx) => {
    const isLayeredTemplate = isLayeredControlDocumentType(data.id)
    if (isLayeredTemplate) await lockControlProcessSettings(tx, 'layeredControl')
    await lockDocumentTemplate(tx, data.id)
    const [existing] = await tx
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.id, data.id))
      .for('update')
      .limit(1)
    assertExpectedDocumentTemplateVersion(existing, data.expectedVersion)
    if (data.recoverMissingFile) {
      if (!existing) throw new Error('Запись шаблона больше не существует. Обновите страницу настроек.')
      if (await templateStore.get(existing.blobKey)) throw new Error('Файл шаблона уже доступен. Обновите страницу настроек; для замены используйте обычную загрузку.')
      const issues = await validateDocumentTemplateRecovery(parseJson<DocumentTemplateConstructorConfig | undefined>(existing.constructorConfig, undefined), fileData)
      if (issues.length) throw new Error(`Файл не подходит для сохранённых настроек конструктора. ${issues.join(' ')} Настройки не изменены; загрузите исходный файл с прежней структурой.`)
    }
    // Retry unfinished cleanup before accepting another upload, bounding garbage
    // even after crashes. Do not remove possible recovery copies of a missing file.
    if (!existing || await templateStore.get(existing.blobKey)) {
      await deleteDocumentTemplateFileVersions(templateStore, data.id, { keepKey: existing?.blobKey })
    }
    const now = existing ? getNextTimestampVersion(existing.updatedAt) : new Date()

    wroteFile = true
    await templateStore.set(
      fileKey,
      fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength),
    )
    const storedFile = await templateStore.get(fileKey)
    if (!storedFile || storedFile.byteLength !== fileData.byteLength) {
      await templateStore.delete(fileKey).catch(() => undefined)
      throw new Error('Не удалось проверить сохраненный файл шаблона в общем хранилище.')
    }
    const constructorConfig =
      data.recoverMissingFile || data.constructorConfig === undefined
        ? existing?.constructorConfig ?? null
        : data.constructorConfig === null
          ? null
          : JSON.stringify(data.constructorConfig)
    const [savedRecord] = await tx
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
    if (!savedRecord) throw new Error('Не удалось сохранить шаблон документа.')
    if (isLayeredTemplate && !data.recoverMissingFile) {
      await rebuildLayeredControlDocumentsInTransaction(tx, { processSettingsLocked: true })
    }
    return savedRecord
  }).catch(async error => {
    if (wroteFile) {
      try {
        // A lost COMMIT acknowledgement does not prove rollback. Re-read under
        // the lock and never delete a file now referenced by the database.
        const committed = await db.transaction(async tx => {
          await lockDocumentTemplate(tx, data.id)
          const [active] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, data.id)).limit(1)
          if (active?.blobKey === fileKey) return active
          await templateStore.delete(fileKey)
          return null
        })
        if (committed) return committed
      } catch {
        throw new Error(`${error instanceof Error ? error.message : 'Не удалось сохранить шаблон.'} Не удалось проверить и очистить незавершённый файл; повторите очистку в настройках после восстановления хранилища.`)
      }
    }
    throw error
  })

  let storageWarning: string | undefined
  try { await cleanupDocumentTemplateFileVersions(db, data.id) } catch {
    storageWarning = 'Шаблон сохранён. Не удалось удалить лишние файлы. Повторите очистку; повторно загружать шаблон не нужно.'
  }
  return {
    ...toTemplateSummary(saved),
    fileDataBase64: data.fileDataBase64,
    ...(storageWarning ? { storageWarning } : {}),
  }
}

export async function updateRemoteDocumentTemplate({
  data: input,
}: {
  data: UpdateDocumentTemplateInput
}) {
  const data = normalizeUpdateTemplateInput(input)
  await assertSecurityScope('settings')
  const db = requireDb()

  const saved = await db.transaction(async (tx) => {
    const isLayeredTemplate = isLayeredControlDocumentType(data.id)
    if (isLayeredTemplate) await lockControlProcessSettings(tx, 'layeredControl')
    await lockDocumentTemplate(tx, data.id)
    const [current] = await tx
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.id, data.id))
      .for('update')
      .limit(1)
    if (!current) return null
    assertExpectedDocumentTemplateVersion(current, data.expectedVersion)
    const update: Partial<typeof documentTemplates.$inferInsert> = {
      updatedAt: getNextTimestampVersion(current.updatedAt),
    }
    if (data.options !== undefined) update.options = JSON.stringify(data.options)
    if (data.constructorConfig !== undefined) update.constructorConfig = JSON.stringify(data.constructorConfig)
    const [savedRecord] = await tx
      .update(documentTemplates)
      .set(update)
      .where(eq(documentTemplates.id, data.id))
      .returning()
    if (savedRecord && isLayeredTemplate) {
      await rebuildLayeredControlDocumentsInTransaction(tx, { processSettingsLocked: true })
    }
    return savedRecord
  })
  return saved ? toTemplateSummary(saved) : null
}

export async function deleteRemoteDocumentTemplate({
  data: input,
}: {
  data: { id: DocumentTemplateId; expectedVersion: string }
}) {
  const data = {
    id: requireTemplateId(input?.id),
    expectedVersion: String(input?.expectedVersion ?? '').trim(),
  }
  await assertSecurityScope('delete')
  const db = requireDb()
  await db.transaction(async (tx) => {
    const isLayeredTemplate = isLayeredControlDocumentType(data.id)
    if (isLayeredTemplate) await lockControlProcessSettings(tx, 'layeredControl')
    await lockDocumentTemplate(tx, data.id)
    const [record] = await tx
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.id, data.id))
      .for('update')
      .limit(1)
    if (!record) throw new Error('Шаблон больше не существует. Обновите страницу настроек.')
    assertExpectedDocumentTemplateVersion(record, data.expectedVersion)
    await tx.delete(documentTemplates).where(eq(documentTemplates.id, data.id))
    if (isLayeredTemplate) {
      await rebuildLayeredControlDocumentsInTransaction(tx, { processSettingsLocked: true })
    }
  })

  let deletedFileKeys: string[] = [], storageWarning: string | undefined
  try { deletedFileKeys = await cleanupDocumentTemplateFileVersions(db, data.id) } catch {
    storageWarning = 'Запись шаблона удалена, но файлы очистить не удалось. Повторите очистку в настройках.'
  }

  return { ok: true, deletedFileCount: deletedFileKeys.length, storageWarning }
}

export async function cleanupRemoteDocumentTemplateFiles({ data }: { data: { id: DocumentTemplateId } }) {
  await assertSecurityScope('settings')
  const id = requireTemplateId(data?.id)
  await assertPersistentDocumentTemplateStorage(resolveDocumentTemplateStorageDirectory())
  const deleted = await cleanupDocumentTemplateFileVersions(requireDb(), id)
  return { deletedFileCount: deleted.length }
}

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
    expectedVersion:
      data?.expectedVersion === null
        ? null
        : String(data?.expectedVersion ?? '').trim(),
    recoverMissingFile: data?.recoverMissingFile === true,
  }
}

function normalizeUpdateTemplateInput(data: UpdateDocumentTemplateInput): UpdateDocumentTemplateInput {
  return {
    id: requireTemplateId(data?.id),
    expectedVersion: String(data?.expectedVersion ?? '').trim(),
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
    version: record.updatedAt.toISOString(),
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

type DocumentTemplateTransaction = Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0]

async function lockDocumentTemplate(tx: DocumentTemplateTransaction, id: DocumentTemplateId) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`document-template:${id}`}))`)
}

async function lockDocumentTemplateReads(tx: DocumentTemplateTransaction, ids: DocumentTemplateId[]) {
  // One bounded statement for the catalog, not one database call per file.
  // Shared locks allow concurrent readers and serialize only file mutations.
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('document-template:' || item.id))
    from (select value as id from jsonb_array_elements_text(${JSON.stringify([...ids].sort())}::jsonb) order by value) item`)
}

export function assertExpectedDocumentTemplateVersion(
  record: Pick<typeof documentTemplates.$inferSelect, 'updatedAt'> | undefined,
  expectedVersion: string | null,
) {
  const currentVersion = record?.updatedAt.toISOString()
  if (
    (record && (!expectedVersion || expectedVersion !== currentVersion)) ||
    (!record && expectedVersion !== null)
  ) {
    throw new Error(
      'Шаблон уже изменен другим пользователем или в другом окне. Ничего не сохранено. Обновите страницу настроек и повторите действие.',
    )
  }
}

async function cleanupDocumentTemplateFileVersions(
  db: ReturnType<typeof requireDb>,
  id: DocumentTemplateId,
) {
  return db.transaction(async (tx) => {
    await lockDocumentTemplate(tx, id)
    const [active] = await tx
      .select({ blobKey: documentTemplates.blobKey })
      .from(documentTemplates)
      .where(eq(documentTemplates.id, id))
      .limit(1)
    if (active && !await templateStore.get(active.blobKey)) throw new Error('Сначала восстановите отсутствующий файл шаблона. Возможные резервные копии не удалены.')
    return deleteDocumentTemplateFileVersions(templateStore, id, {
      ...(active?.blobKey ? { keepKey: active.blobKey } : {}),
    })
  })
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
