import { checkTechnologyCardApplicability, createTechnologyCardMatcher } from '@/lib/technology-card-matching'
import { normalizeTechnologyCardName } from '@/lib/technology-card-name'
import type { TechnologyCardRecord, TechnologyCardWeld } from '@/lib/technology-card-types'
import type { DataListSettings } from '@/lib/data-list-settings'

export type TechnologyCardSnapshot = { cards: TechnologyCardRecord[]; names: Array<{ name: string; cardId: number }> }

export function createTechnologyCardReview(snapshot: TechnologyCardSnapshot, settings: DataListSettings) {
  const byId = new Map(snapshot.cards.map(card => [card.id, card]))
  const byName = new Map(snapshot.names.map(item => [item.name, byId.get(item.cardId)]))
  const matcher = createTechnologyCardMatcher(snapshot.cards, settings)
  return (row: TechnologyCardWeld) => {
    const selection = matcher.match(row)
    const name = normalizeTechnologyCardName(row.technologyCardNumber)
    if (name) {
      const card = byName.get(name)
      if (!card) return { status: 'unknown' as const, message: `ТК «${name}» отсутствует в реестре. Проверьте название или добавьте карту с её параметрами.`, cards: selection.cards }
      const result = checkTechnologyCardApplicability(card, row, settings)
      const messages = [...result.weldIssues, ...result.cardIssues, ...result.mismatchIssues].map(issue => issue.message)
      return { status: result.applicable ? 'valid' as const : 'mismatch' as const,
        message: result.applicable ? `ТК «${name}» соответствует параметрам стыка.${name !== card.name ? ` Текущее название: «${card.name}».` : ''}${card.archived ? ' Карта в архиве; прежнее назначение сохраняется.' : ''}` : `ТК «${name}»: ${messages.join(' ')}`,
        cards: selection.cards }
    }
    if (selection.issues.length) return { status: 'incomplete' as const, message: `Для подбора ТК: ${selection.issues.map(issue => issue.message).join(' ')}`, cards: selection.cards }
    if (!selection.cards.length) return { status: 'none' as const, message: 'Подходящей действующей ТК нет. Проверьте параметры стыка и реестр технологических карт.', cards: selection.cards }
    if (selection.cards.length === 1) return { status: 'single' as const, message: `Подходит «${selection.cards[0].name}» — необходимо назначить.`, cards: selection.cards }
    return { status: 'multiple' as const, message: `Подходят несколько ТК (${selection.cards.length}). Выберите карту из подходящих.`, cards: selection.cards }
  }
}
