import type { WeldInput } from '@/lib/weld-fields'
import { getTechnologyCardAutoAssignment } from '@/lib/technology-card-matching'
import { normalizeTechnologyCardName } from '@/lib/technology-card-name'
import { loadTechnologyCardMatcher, markTechnologyCardsUsed, resolveTechnologyCardNames } from '@/server/technology-card-registry'
import { lockTechnologyCardRegistry } from '@/server/technology-card-registry-lock'
import { lockWeldValidationSettings } from '@/server/weld-validation-settings-lock'
import type { SystemDocumentSequenceTransaction as Transaction } from '@/server/system-document-sequences'

/** Final merged and validated records only. No queries for unrelated edits.
 * The registry lock is held through commit; individual joints are never queried. */
export async function prepareTechnologyCardWeldWrites(tx: Transaction, records: readonly WeldInput[], previousRows: ReadonlyMap<number, WeldInput>) {
  const autoRows = records.filter(row => !String(previousRows.get(Number(row.id))?.weldDate ?? '').trim() &&
    String(row.weldDate ?? '').trim() && !normalizeTechnologyCardName(row.technologyCardNumber))
  const selected = records.filter(row => row.technologyCardSelection)
  const changed = records.filter(row => normalizeTechnologyCardName(row.technologyCardNumber) !== normalizeTechnologyCardName(previousRows.get(Number(row.id))?.technologyCardNumber))
  if (!autoRows.length && !selected.length && !changed.length) return
  await lockWeldValidationSettings(tx)
  await lockTechnologyCardRegistry(tx)
  if (selected.length) {
    const resolved = await resolveTechnologyCardNames(tx, selected.map(row => String(row.technologyCardNumber ?? '')))
    for (const row of selected) {
      const card = resolved.get(normalizeTechnologyCardName(row.technologyCardNumber))
      const choice = row.technologyCardSelection!
      if (!card || card.archived || card.id !== choice.id || card.revision !== choice.revision || card.name !== normalizeTechnologyCardName(row.technologyCardNumber)) {
        throw new Error('Выбранная технологическая карта уже изменена или архивирована. Обновите список ТК и повторите выбор. Черновик стыка сохранён.')
      }
    }
  }
  if (autoRows.length) {
    const matcher = await loadTechnologyCardMatcher(tx)
    for (const row of autoRows) {
      const name = getTechnologyCardAutoAssignment(previousRows.get(Number(row.id)) ?? null, row, matcher)
      if (name) row.technologyCardNumber = name
    }
  }
  await markTechnologyCardsUsed(tx, [...changed.flatMap(row => [row, previousRows.get(Number(row.id)) ?? {}]), ...autoRows, ...selected])
}
