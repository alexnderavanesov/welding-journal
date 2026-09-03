import { eq, max, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import { appSettings, generatedDocuments } from '@/db/schema'
import type { GeneratedDocumentType } from '@/lib/generated-document-types'

export type GeneratedDocumentsTransaction = Parameters<
  Parameters<ReturnType<typeof requireDb>['transaction']>[0]
>[0]

export type GeneratedDocumentNumberSequence = {
  take: () => number
  persist: () => Promise<void>
}

export async function lockGeneratedDocumentNumberSequence(
  tx: GeneratedDocumentsTransaction,
  type: GeneratedDocumentType,
): Promise<GeneratedDocumentNumberSequence> {
  await lockGeneratedDocumentNumberCounter(tx, type)
  let nextNumber = await readGeneratedDocumentNextNumber(tx, type)
  let changed = false

  return {
    take: () => {
      const value = nextNumber
      nextNumber += 1
      changed = true
      return value
    },
    persist: async () => {
      if (changed) await writeGeneratedDocumentNextNumber(tx, type, nextNumber)
    },
  }
}

export async function lockGeneratedDocumentNumberCounter(
  tx: GeneratedDocumentsTransaction,
  type: GeneratedDocumentType,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${generatedDocumentCounterKey(type)}))`)
}

export async function readGeneratedDocumentNextNumber(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
  type: GeneratedDocumentType,
) {
  const key = generatedDocumentCounterKey(type)
  const [setting] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1)
  const storedValue = parsePositiveIntegerSetting(setting?.value)
  if (storedValue) return storedValue

  const [record] = await db
    .select({ value: max(generatedDocuments.documentNumber) })
    .from(generatedDocuments)
    .where(eq(generatedDocuments.type, type))
  return Math.max(1, Number(record?.value ?? 0) + 1)
}

export async function writeGeneratedDocumentNextNumber(
  tx: GeneratedDocumentsTransaction,
  type: GeneratedDocumentType,
  nextNumber: number,
) {
  const value = JSON.stringify(Math.max(1, Math.floor(nextNumber)))
  await tx
    .insert(appSettings)
    .values({
      key: generatedDocumentCounterKey(type),
      value,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value,
        updatedAt: sql`now()`,
      },
    })
}

export function generatedDocumentCounterKey(type: GeneratedDocumentType) {
  return `generated-document-next-number:${type}`
}

function parsePositiveIntegerSetting(value: string | undefined) {
  if (!value) return null
  try {
    const parsed = Number(JSON.parse(value))
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}
