import { isTConnectionType } from '@/lib/connection-type'
import { isControlEnabledValue, isRecognizedControlAvailabilityValue } from '@/lib/control-availability-values'
import { normalizeDataListOption, type DataListSettings } from '@/lib/data-list-settings'
import { parseDateLikeToIso } from '@/lib/date-format'
import { parseTechnologyCardDimension, validateTechnologyCard } from '@/lib/technology-card-validation'
import { normalizeTechnologyCardName } from '@/lib/technology-card-name'
import { getWeldMaterialGroupsError, splitWeldMaterialGroups } from '@/lib/weld-material-groups'
import type { TechnologyCardIssue, TechnologyCardRecord, TechnologyCardWeld, TechnologyCardWeldIssue } from '@/lib/technology-card-types'

type WeldProfile = {
  weldingMethods: string[]
  connectionType: string
  materialGroups: string[]
  diameter: number | null
  thickness: number | null
  psto: boolean
  issues: TechnologyCardWeldIssue[]
}

function readWeldProfile(row: TechnologyCardWeld, settings: DataListSettings): WeldProfile {
  const issues: TechnologyCardWeldIssue[] = []
  const issue = (field: keyof TechnologyCardWeld, kind: 'missing' | 'invalid', message: string) => issues.push({ field, kind, message })
  const methodsText = String(row.weldingMethod ?? '').trim()
  const methodParts = methodsText.split('+').map(normalizeDataListOption)
  const weldingMethods = [...new Set(methodParts.filter(Boolean))]
  if (!methodsText) issue('weldingMethod', 'missing', 'Укажите способ сварки.')
  else if (methodParts.some(method => !settings.weldingTypes.includes(method))) issue('weldingMethod', 'invalid', `Проверьте способы сварки: «${methodsText}».`)

  const connectionType = normalizeDataListOption(row.connectionType)
  if (!connectionType) issue('connectionType', 'missing', 'Укажите тип соединения.')
  else if (isTConnectionType(connectionType)) issue('connectionType', 'invalid', 'Подбор ТК для Т-стыков пока не поддерживается.')
  else if (!settings.connectionTypes.includes(connectionType)) issue('connectionType', 'invalid', `Тип соединения «${connectionType}» отсутствует в справочнике.`)

  const materialGroups = splitWeldMaterialGroups(row.materialGroup)
  const groupsError = getWeldMaterialGroupsError(row.materialGroup, settings.materialGroups)
  if (!materialGroups.length) issue('materialGroup', 'missing', 'Укажите группу материалов.')
  else if (groupsError) issue('materialGroup', 'invalid', groupsError)

  const sizes = {} as Record<'d1' | 'd2' | 't1' | 't2', number | null>
  for (const field of ['d1', 'd2', 't1', 't2'] as const) {
    sizes[field] = parseTechnologyCardDimension(row[field])
    if (sizes[field] === null) {
      const empty = !String(row[field] ?? '').trim()
      issue(field, empty ? 'missing' : 'invalid', `${empty ? 'Укажите' : 'Проверьте'} ${field.toUpperCase()}.`)
    }
  }
  // Empty means not assigned in the existing journal. Performed PSTO is irrelevant.
  if (!isRecognizedControlAvailabilityValue(row.pstoRequired)) issue('pstoRequired', 'invalid', 'Проверьте назначение ПСТО.')
  return {
    weldingMethods, connectionType, materialGroups,
    diameter: sizes.d1 !== null && sizes.d2 !== null ? Math.min(sizes.d1, sizes.d2) : null,
    thickness: sizes.t1 !== null && sizes.t2 !== null ? Math.min(sizes.t1, sizes.t2) : null,
    psto: isControlEnabledValue(row.pstoRequired), issues,
  }
}

const setKey = (values: readonly string[]) => JSON.stringify([...values].sort())
const profileKey = (value: Pick<WeldProfile, 'weldingMethods' | 'connectionType' | 'materialGroups'>) =>
  JSON.stringify([setKey(value.weldingMethods), value.connectionType, setKey(value.materialGroups)])

function compareProfile(card: TechnologyCardRecord, profile: WeldProfile): TechnologyCardIssue[] {
  const issues: TechnologyCardIssue[] = []
  if (setKey(card.weldingMethods) !== setKey(profile.weldingMethods)) issues.push({ field: 'weldingMethods', message: `Способы сварки: ТК — ${card.weldingMethods.join(' + ')}, стык — ${profile.weldingMethods.join(' + ') || 'не указаны'}. Нужен одинаковый набор.` })
  if (card.connectionType !== profile.connectionType) issues.push({ field: 'connectionType', message: `Тип соединения: ТК — ${card.connectionType}, стык — ${profile.connectionType || 'не указан'}.` })
  if (setKey(card.materialGroups) !== setKey(profile.materialGroups)) issues.push({ field: 'materialGroups', message: `Группы материалов: ТК — ${card.materialGroups.join(' + ')}, стык — ${profile.materialGroups.join(' + ') || 'не указаны'}.` })
  if (profile.diameter !== null && (profile.diameter < card.diameterFrom || profile.diameter > card.diameterTo)) issues.push({ field: 'diameterFrom', message: `Меньший диаметр D${profile.diameter} вне диапазона ТК ${card.diameterFrom}–${card.diameterTo}.` })
  if (profile.thickness !== null && (profile.thickness < card.thicknessFrom || profile.thickness > card.thicknessTo)) issues.push({ field: 'thicknessFrom', message: `Меньшая толщина T${profile.thickness} вне диапазона ТК ${card.thicknessFrom}–${card.thicknessTo}.` })
  if (card.psto !== 'any' && (card.psto === 'required') !== profile.psto) issues.push({ field: 'psto', message: `ТК ${card.psto === 'required' ? 'требует назначения ПСТО' : 'предназначена для стыков без ПСТО'}; в стыке ПСТО ${profile.psto ? 'назначена' : 'не назначена'}.` })
  return issues
}

export type TechnologyCardApplicability = {
  applicable: boolean
  weldIssues: TechnologyCardWeldIssue[]
  cardIssues: TechnologyCardIssue[]
  mismatchIssues: TechnologyCardIssue[]
}

/** Archive prevents a new automatic choice; it does not invalidate past work. */
export function checkTechnologyCardApplicability(card: TechnologyCardRecord, row: TechnologyCardWeld, settings: DataListSettings): TechnologyCardApplicability {
  const profile = readWeldProfile(row, settings)
  const validated = validateTechnologyCard(card, settings)
  const mismatchIssues = validated.card ? compareProfile({ ...card, ...validated.card }, profile) : []
  return {
    applicable: !profile.issues.length && !validated.issues.length && !mismatchIssues.length,
    weldIssues: profile.issues, cardIssues: validated.issues, mismatchIssues,
  }
}

/** Compile once per registry snapshot/batch. No DB calls and no registry-wide scan
 * per joint: only the exact method/type/material bucket needs a range/PSTO check. */
export function createTechnologyCardMatcher(cards: readonly TechnologyCardRecord[], settings: DataListSettings) {
  const buckets = new Map<string, TechnologyCardRecord[]>()
  for (const card of cards) {
    if (card.archived) continue
    const validated = validateTechnologyCard(card, settings)
    if (!validated.card) continue
    const normalized = { ...card, ...validated.card }
    const key = profileKey(normalized)
    const bucket = buckets.get(key) ?? []
    bucket.push(normalized)
    buckets.set(key, bucket)
  }
  return {
    match(row: TechnologyCardWeld) {
      const profile = readWeldProfile(row, settings)
      return {
        issues: profile.issues,
        cards: profile.issues.length ? [] : (buckets.get(profileKey(profile)) ?? []).filter(card =>
          profile.diameter! >= card.diameterFrom && profile.diameter! <= card.diameterTo &&
          profile.thickness! >= card.thicknessFrom && profile.thickness! <= card.thicknessTo &&
          (card.psto === 'any' || (card.psto === 'required') === profile.psto)),
      }
    },
  }
}

/** Caller supplies the final merged record. This only proposes a name; it never
 * modifies inputs, materials, old choices or already dated historical joints. */
export function getTechnologyCardAutoAssignment(
  previous: TechnologyCardWeld | null,
  next: TechnologyCardWeld,
  matcher: ReturnType<typeof createTechnologyCardMatcher>,
): string | null {
  if (String(previous?.weldDate ?? '').trim() || !parseDateLikeToIso(next.weldDate) || normalizeTechnologyCardName(next.technologyCardNumber)) return null
  const result = matcher.match(next)
  return result.cards.length === 1 ? result.cards[0].name : null
}
