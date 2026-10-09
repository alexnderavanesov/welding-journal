import { isTConnectionType } from '@/lib/connection-type'
import { parseDateLikeToIso } from '@/lib/date-format'
import type { DataListSettings } from '@/lib/data-list-settings'
import { checkTechnologyCardApplicability, createTechnologyCardMatcher } from '@/lib/technology-card-matching'
import type { TechnologyCardSnapshot } from '@/lib/technology-card-review'
import type { TechnologyCardWeld } from '@/lib/technology-card-types'
import { normalizeTechnologyCardName } from '@/lib/technology-card-name'

export const TK_ASSIGNMENT_ACTIONS = ['assign', 'reassign', 'rename'] as const
export type TechnologyCardAssignmentAction = typeof TK_ASSIGNMENT_ACTIONS[number]
export const TK_ASSIGNMENT_LABELS = {
  assign: 'Назначить', reassign: 'Заменить', rename: 'Обновить название', unchanged: 'Без изменений',
  ambiguous: 'Неоднозначные', none: 'Нет подходящей ТК', incomplete: 'Недостаточно данных', excluded: 'Без даты / Т-стыки',
} as const
export type TechnologyCardAssignmentKind = keyof typeof TK_ASSIGNMENT_LABELS
export type TechnologyCardAssignmentCounts = Record<TechnologyCardAssignmentKind | 'mismatch', number>
export type TechnologyCardAssignmentFilter = 'all' | 'changes' | keyof TechnologyCardAssignmentCounts
export function technologyCardAssignmentFilterCount(counts: TechnologyCardAssignmentCounts, filter: TechnologyCardAssignmentFilter) {
  if (filter === 'changes') return counts.assign + counts.reassign + counts.rename
  if (filter === 'all') return Object.entries(counts).reduce((sum, [key, count]) => sum + (key === 'mismatch' ? 0 : count), 0)
  return counts[filter]
}
export function matchesTechnologyCardAssignmentFilter(row: TechnologyCardAssignmentProposal, filter: TechnologyCardAssignmentFilter) {
  return filter === 'all' || (filter === 'changes' ? isTechnologyCardAssignmentAction(row.kind) : filter === 'mismatch' ? row.mismatch : row.kind === filter)
}
export const emptyTechnologyCardAssignmentCounts = (): TechnologyCardAssignmentCounts => ({
  assign: 0, reassign: 0, rename: 0, unchanged: 0, ambiguous: 0, none: 0, incomplete: 0, excluded: 0, mismatch: 0,
})
export type TechnologyCardAssignmentRow = TechnologyCardWeld & {
  id: number; projectTitle: string | null; subtitleCode: string | null; line: string | null; joint: string | null; version: string
}
export type TechnologyCardAssignmentProposal = {
  id: number; project: string; line: string; joint: string; oldName: string; newName: string;
  kind: TechnologyCardAssignmentKind; mismatch: boolean; reason: string
}
export function isTechnologyCardAssignmentAction(kind: string): kind is TechnologyCardAssignmentAction {
  return TK_ASSIGNMENT_ACTIONS.includes(kind as TechnologyCardAssignmentAction)
}

/** One compiled registry per batch. Applicable existing choices (including archived
 * ones) take precedence over other candidates; a rename is not a replacement. */
export function createTechnologyCardAssignmentClassifier(snapshot: TechnologyCardSnapshot, settings: DataListSettings) {
  const byId = new Map(snapshot.cards.map(card => [card.id, card]))
  const byName = new Map(snapshot.names.map(name => [name.name, byId.get(name.cardId)]))
  const matcher = createTechnologyCardMatcher(snapshot.cards, settings)
  return (row: TechnologyCardAssignmentRow): TechnologyCardAssignmentProposal => {
    const name = normalizeTechnologyCardName(row.technologyCardNumber)
    const base = { id: row.id, project: [row.projectTitle, row.subtitleCode].filter(Boolean).join(' / '),
      line: row.line ?? '', joint: row.joint ?? '', oldName: name, newName: '', mismatch: false }
    if (!String(row.weldDate ?? '').trim() || isTConnectionType(row.connectionType)) {
      return { ...base, kind: 'excluded', reason: 'Стык без даты сварки или Т-соединение: массовый подбор не выполняется.' }
    }
    const matches = matcher.match(row)
    if (!parseDateLikeToIso(row.weldDate) || matches.issues.length) {
      return { ...base, kind: 'incomplete', reason: matches.issues.map(issue => issue.message).join(' ') || 'Проверьте дату сварки.' }
    }
    const current = byName.get(name)
    const applicability = current ? checkTechnologyCardApplicability(current, row, settings) : null
    if (current && applicability?.applicable) {
      return { ...base, newName: current.name, kind: current.name === name ? 'unchanged' : 'rename',
        reason: current.name === name ? 'Назначенная карта соответствует стыку.' : 'Та же подходящая карта переименована в реестре.' }
    }
    const mismatch = Boolean(name)
    const reason = name ? (current ? [...applicability!.cardIssues, ...applicability!.mismatchIssues].map(issue => issue.message).join(' ') : 'Назначенной ТК нет в реестре.') : 'ТК не заполнена.'
    if (matches.cards.length === 1) return { ...base, mismatch, kind: name ? 'reassign' : 'assign', newName: matches.cards[0].name, reason: `${reason} Найдена единственная подходящая действующая ТК.` }
    return { ...base, mismatch, kind: matches.cards.length ? 'ambiguous' : 'none',
      reason: `${reason} ${matches.cards.length ? `Подходят несколько карт (${matches.cards.length}); выберите вручную в карточке стыка.` : 'Подходящей действующей карты нет.'}` }
  }
}

// Only small batch descriptors are retained by the browser, never the entire journal.
export const TK_ASSIGNMENT_CHUNK_SIZE = 500
export const TK_ASSIGNMENT_SCAN_SIZE = 5000
export type TechnologyCardAssignmentContext = { version: 1; fingerprint: string; upperId: number }
export type TechnologyCardAssignmentChunk = { afterId: number; throughId: number; fingerprint: string; counts: TechnologyCardAssignmentCounts; size: number }
export type TechnologyCardAssignmentScan = { context: TechnologyCardAssignmentContext; chunks: TechnologyCardAssignmentChunk[]; nextCursor: number | null }
export type TechnologyCardAssignmentApplyInput = {
  context: TechnologyCardAssignmentContext; chunk: TechnologyCardAssignmentChunk;
  actions: TechnologyCardAssignmentAction[]; excludedIds: number[]
}
