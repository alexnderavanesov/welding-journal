import { requireDb } from '@/db'
import { technologyCardNames, technologyCards } from '@/db/schema'
import { assertSecurityScope } from '@/server/security-functions'
import { lockTechnologyCardRegistry } from '@/server/technology-card-registry-lock'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import {
  createTechnologyCardInTransaction, deleteTechnologyCardInTransaction, readTechnologyCardPage,
  setTechnologyCardArchivedInTransaction, toTechnologyCardRecord, updateTechnologyCardInTransaction,
  type TechnologyCardPageRequest,
} from '@/server/technology-card-registry'
import type { TechnologyCardChange } from '@/server/technology-cards-api'
import { applyTechnologyCardAssignments, readTechnologyCardAssignmentDetails, scanTechnologyCardAssignments } from '@/server/technology-card-assignment'

export async function getPage(input: TechnologyCardPageRequest) {
  await assertSecurityScope('entry')
  return requireDb().transaction(tx => readTechnologyCardPage(tx, input))
}

export async function getSnapshot() {
  await assertSecurityScope('entry')
  return requireDb().transaction(async tx => {
    await lockTechnologyCardRegistry(tx)
    const cards = await tx.select().from(technologyCards)
    const names = await tx.select({ name: technologyCardNames.name, cardId: technologyCardNames.technologyCardId }).from(technologyCardNames)
    return { cards: cards.map(toTechnologyCardRecord), names }
  })
}

export async function changeCard(input: TechnologyCardChange) {
  await assertSecurityScope('settings')
  return requireDb().transaction(async tx => {
    const saved = input?.action === 'create' ? await createTechnologyCardInTransaction(tx, input.card)
      : input?.action === 'update' ? await updateTechnologyCardInTransaction(tx, input)
      : input?.action === 'archive' ? await setTechnologyCardArchivedInTransaction(tx, input)
      : input?.action === 'delete' ? await deleteTechnologyCardInTransaction(tx, input)
      : null
    if (!saved) throw new Error('Неизвестное действие с технологической картой.')
    await markDispatcherTaskIndexDirty(tx)
    return saved
  })
}

export async function previewAssignments(input: Parameters<typeof scanTechnologyCardAssignments>[1]) {
  await assertSecurityScope('entry')
  return requireDb().transaction(tx => scanTechnologyCardAssignments(tx, input))
}
export async function assignmentDetails(input: Parameters<typeof readTechnologyCardAssignmentDetails>[1]) {
  await assertSecurityScope('entry')
  return requireDb().transaction(tx => readTechnologyCardAssignmentDetails(tx, input))
}
export async function applyAssignments(input: Parameters<typeof applyTechnologyCardAssignments>[1]) {
  await assertSecurityScope('edit')
  return requireDb().transaction(tx => applyTechnologyCardAssignments(tx, input))
}
