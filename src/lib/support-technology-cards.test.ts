import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS } from './data-list-settings'
import { validateTechnologyCard } from './technology-card-validation'
import { checkTechnologyCardApplicability, createTechnologyCardMatcher, getTechnologyCardAutoAssignment } from './technology-card-matching'
import { createTechnologyCardAssignmentClassifier } from './technology-card-assignment'
import { createTechnologyCardReview } from './technology-card-review'
import { buildTechnologyCardTasks } from './technology-card-tasks'
import { buildVisibleDispatcherTasks } from './dispatcher-task-builder'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { parseDispatcherTaskIndexPayload, serializeDispatcherTaskIndexPayload } from './dispatcher-task-index-payload'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, getDispatcherTaskCode } from './dispatcher-settings'
import type { TechnologyCardRecord, TechnologyCardWeld } from './technology-card-types'
import type { WeldRow } from './dispatcher-types'

const settings = { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: [...DEFAULT_DATA_LIST_SETTINGS.connectionTypes, 'Т', 'Т1', 'Т3', 'Т4Д'] }
const card: TechnologyCardRecord = { id: 1, name: 'ТК-ОП', revision: 1, archived: false, connectionType: 'Т1',
  weldingMethods: ['РД'], materialGroups: ['М05'], diameterFrom: 57, diameterTo: 159,
  thicknessFrom: 3, thicknessTo: 6, psto: 'any' }
const row: TechnologyCardWeld = { connectionType: 'Т1', weldingMethod: 'РД', materialGroup: 'М05',
  d1: 57, t1: 6, d2: null, t2: null, pstoRequired: 'да' }
const snapshot = (cards: TechnologyCardRecord[]) => ({ cards, names: cards.map(value => ({ name: value.name, cardId: value.id })) })
const apply = (weld: TechnologyCardWeld, overrides: Partial<TechnologyCardRecord> = {}) => checkTechnologyCardApplicability({ ...card, ...overrides }, weld, settings)

describe('Т-05 full support technology-card process', () => {
  it('rejects dissimilar or combined support input even if an older card covers the full combination', () => {
    const broadCard = { ...card, materialGroups: ['М01', 'М05'], weldingMethods: ['РАД', 'РД'] }
    for (const invalid of [{ ...row, materialGroup: 'М01 + М05' }, { ...row, weldingMethod: 'РАД + РД' }]) {
      expect(checkTechnologyCardApplicability(broadCard, invalid, settings).applicable).toBe(false)
      expect(createTechnologyCardMatcher([broadCard], settings).match(invalid).cards).toEqual([])
    }
  })
  it.each(['Т', 'Т1', 'Т3', 'Т4Д'])('allows configured %s in the registry and matching', connectionType => {
    const supportCard = { ...card, connectionType }
    expect(validateTechnologyCard(supportCard, settings).issues).toEqual([])
    expect(createTechnologyCardMatcher([supportCard], settings).match({ ...row, connectionType }).cards).toEqual([supportCard])
  })

  it.each(['М01', 'М05'])('uses D1/T1 for %s without D2/T2 and ignores irrelevant hidden values', materialGroup => {
    const materialGroups = materialGroup.split(' + ')
    for (const hidden of [{ d2: null, t2: null }, { d2: 1, t2: 1 }, { d2: 'invalid', t2: -3 }]) {
      expect(apply({ ...row, materialGroup, ...hidden }, { materialGroups }).applicable).toBe(true)
      expect(apply({ ...row, materialGroup, ...hidden, d1: 160 }, { materialGroups }).applicable).toBe(false)
      expect(apply({ ...row, materialGroup, ...hidden, t1: 7 }, { materialGroups }).applicable).toBe(false)
    }
  })

  it.each([[57, 3, true], [159, 6, true], [56.999, 3, false], [159.001, 6, false], [57, 2.999, false], [159, 6.001, false]])(
    'checks exact inclusive support limits D%s/T%s', (d1, t1, expected) => {
      expect(apply({ ...row, d1, t1 }).applicable).toBe(expected)
    })

  it('keeps the single group, complete method set, exact type and PSTO in applicability', () => {
    expect(apply({ ...row, materialGroup: 'М01' }).mismatchIssues.map(value => value.field)).toEqual(['materialGroups'])
    expect(apply(row, { materialGroups: ['М01'] }).applicable).toBe(false)
    expect(apply({ ...row, weldingMethod: 'РАД' }).mismatchIssues.map(value => value.field)).toEqual(['weldingMethods'])
    expect(apply({ ...row, connectionType: 'Т3' }).mismatchIssues.map(value => value.field)).toEqual(['connectionType'])
    expect(apply({ ...row, pstoRequired: '' }, { psto: 'required' }).applicable).toBe(false)
    expect(apply({ ...row, pstoRequired: 'отменен' }, { psto: 'not-required' }).applicable).toBe(true)
  })

  it('reports all real missing/invalid profile values, never requests D2/T2', () => {
    const result = apply({ ...row, d1: null, t1: 0, materialGroup: 'М01 +', weldingMethod: '' })
    expect(result.weldIssues.map(value => value.field)).toEqual(['weldingMethod', 'materialGroup', 'd1', 't1'])
    expect(result.weldIssues.map(value => value.message).join(' ')).not.toMatch(/D2|T2/)
    expect(apply({ ...row, d1: 219, t1: 12 }).mismatchIssues.map(value => value.message).join(' ')).toMatch(/D1 = 219[\s\S]*T1 = 12/)
  })

  it('assigns exactly one active match on the first date only and preserves explicit choices', () => {
    const matcher = createTechnologyCardMatcher([card], settings)
    const dated = { ...row, weldDate: '2026-11-04' }
    expect(getTechnologyCardAutoAssignment(null, dated, matcher)).toBe(card.name)
    expect(getTechnologyCardAutoAssignment(row, dated, matcher)).toBe(card.name)
    expect(getTechnologyCardAutoAssignment(dated, { ...dated, weldDate: '2026-11-03' }, matcher)).toBeNull()
    expect(getTechnologyCardAutoAssignment(row, { ...dated, technologyCardNumber: 'Сохранить ручной выбор' }, matcher)).toBeNull()
    expect(getTechnologyCardAutoAssignment(row, dated, createTechnologyCardMatcher([], settings))).toBeNull()
    expect(getTechnologyCardAutoAssignment(row, dated, createTechnologyCardMatcher([card, { ...card, id: 2, name: 'ТК2' }], settings))).toBeNull()
    expect(getTechnologyCardAutoAssignment(row, dated, createTechnologyCardMatcher([{ ...card, archived: true }], settings))).toBeNull()
  })

  it('bulk assignment includes welded supports and preserves an applicable archived choice', () => {
    const archived = { ...card, archived: true }
    const alternative = { ...card, id: 2, name: 'Другой вариант' }
    const classify = createTechnologyCardAssignmentClassifier(snapshot([archived, alternative]), settings)
    const dated = { ...row, id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'ОП-1', version: 'v1', weldDate: '2026-11-04' }
    expect(classify(dated)).toMatchObject({ kind: 'assign', newName: alternative.name })
    expect(classify({ ...dated, technologyCardNumber: archived.name })).toMatchObject({ kind: 'unchanged', newName: archived.name })
    expect(classify({ ...dated, weldDate: null }).kind).toBe('excluded')
    expect(classify({ ...dated, d1: null }).kind).toBe('incomplete')
    expect(classify({ ...dated, technologyCardNumber: 'Неизвестная' })).toMatchObject({ kind: 'reassign', newName: alternative.name })
  })

  it('retains DZ-06 in dispatcher, persisted and virtual codes for an already stored support', () => {
    const stored: WeldRow = { ...row, id: 10, joint: 'ОП-10', weldDate: '2026-11-04' }
    const review = createTechnologyCardReview(snapshot([card]), settings)
    const tasks = buildTechnologyCardTasks([stored, { ...stored, id: 11, weldDate: null }], review)
    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-06')
    const saved = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks)).tasks
    const indices = buildDispatcherTaskCodeIndexRows(saved, [stored])
    expect(indices).toEqual([{ rowId: 10, code: 'ДЗ-06', taskKey: 'code:ДЗ-06' }])
    expect(buildMergedDispatcherTaskCodes(indices, []).allByRowId.get(stored.id)).toBe('ДЗ-06')
    const base = { acceptedDispatcherWarningKeys: new Set<string>(), dismissedRepeatedJointTaskKeys: new Set<string>(),
      dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS, rows: [stored], welderStamps: [], welderStampSuspensions: [], technologyCardReview: review }
    for (const enabled of [true, false, true]) {
      const visible = buildVisibleDispatcherTasks({ ...base, dispatcherSettings: { ...DEFAULT_DISPATCHER_SETTINGS, 'check-technology-card': enabled } })
      expect(visible.repeatedJointTasks.filter(task => getDispatcherTaskCode(task) === 'ДЗ-06')).toHaveLength(enabled ? 1 : 0)
    }
    expect(buildTechnologyCardTasks([{ ...stored, technologyCardNumber: card.name }], review)).toEqual([])
  })
})
