import { describe, expect, it, vi } from 'vitest'
import * as matching from '@/lib/technology-card-matching'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { createTechnologyCardReview } from '@/lib/technology-card-review'
import { buildTechnologyCardTasks } from '@/lib/technology-card-tasks'
import { buildVisibleDispatcherTasks } from '@/lib/dispatcher-task-builder'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, getDispatcherTaskCode, isMandatoryDispatcherTask } from '@/lib/dispatcher-settings'
import { buildDispatcherTaskCodeIndexRows } from '@/lib/dispatcher-task-row-codes'
import type { TechnologyCardRecord } from '@/lib/technology-card-types'
import type { WeldRow } from '@/lib/dispatcher-types'

const card: TechnologyCardRecord = { id: 1, revision: 2, name: 'Новое название', weldingMethods: ['РАД'], connectionType: 'С17',
  materialGroups: ['М01'], diameterFrom: 57, diameterTo: 159, thicknessFrom: 3, thicknessTo: 8, psto: 'any', archived: false }
const row: WeldRow = { id: 10, joint: 'F10', weldDate: '2026-10-01', weldingMethod: 'РАД', connectionType: 'С17', materialGroup: 'М01', d1: 57, d2: 159, t1: 6, t2: 3 }
const review = (cards = [card]) => createTechnologyCardReview({ cards, names: [{ name: 'Старое название', cardId: 1 }, { name: card.name, cardId: 1 }] }, DEFAULT_DATA_LIST_SETTINGS)

describe('DZ-06 technology cards', () => {
  it('reuses equivalent applicability checks but observes every changed input and a new snapshot', () => {
    const spy = vi.spyOn(matching, 'checkTechnologyCardApplicability')
    try {
      const check = review()
      const stored = { ...row, technologyCardNumber: card.name }
      const first = check(stored)
      for (let i = 0; i < 200; i++) expect(check({ ...stored })).toEqual(first)
      expect(spy).toHaveBeenCalledTimes(1)
      for (const change of [{ technologyCardNumber: 'Неизвестная' }, { weldingMethod: 'РД' }, { connectionType: 'У19' },
        { materialGroup: 'М03' }, { d1: 1 }, { d2: 1 }, { t1: 1 }, { t2: 1 }, { pstoRequired: 'неизвестно' }]) {
        Object.assign(stored, row, { technologyCardNumber: card.name, pstoRequired: undefined }, change)
        expect(check(stored)).toEqual(review()(stored))
        expect(check(stored).status).not.toBe('valid')
      }
      expect(review([{ ...card, diameterFrom: 100 }])({ ...row, technologyCardNumber: card.name }).status).toBe('mismatch')
      expect(createTechnologyCardReview({ cards: [card], names: [{ name: card.name, cardId: card.id }] },
        { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: [] })({ ...row, technologyCardNumber: card.name }).status).toBe('mismatch')
      first.cards.length = 0
      expect(check({ ...row, technologyCardNumber: card.name }).cards).toHaveLength(1)
    } finally { spy.mockRestore() }
  })

  it('does not equate invalid numeric names with string identifiers', () => {
    const numericName = { ...card, name: '123' }
    const check = createTechnologyCardReview({ cards: [numericName], names: [{ name: '123', cardId: card.id }] }, DEFAULT_DATA_LIST_SETTINGS)
    expect(check({ ...row, technologyCardNumber: '123' }).status).toBe('valid')
    expect(check({ ...row, technologyCardNumber: 123 as never }).status).toBe('single')
  })

  it('bounds retained applicability profiles without skipping checks beyond the bound', () => {
    const spy = vi.spyOn(matching, 'checkTechnologyCardApplicability')
    try {
      const check = review()
      for (let i = 0; i < 520; i++) check({ ...row, technologyCardNumber: card.name, d1: i + 1 })
      expect(spy).toHaveBeenCalledTimes(520)
      check({ ...row, technologyCardNumber: card.name, d1: 1 })
      expect(spy).toHaveBeenCalledTimes(520)
      check({ ...row, technologyCardNumber: card.name, d1: 520 })
      expect(spy).toHaveBeenCalledTimes(521)
    } finally { spy.mockRestore() }
  })

  it('explains none / one / several / incomplete / unknown without modifying saved facts', () => {
    const before = structuredClone(row)
    expect(review([])(row).status).toBe('none')
    expect(review()(row).status).toBe('single')
    expect(review([card, { ...card, id: 2, name: 'Другая' }])(row).status).toBe('multiple')
    expect(review()({ ...row, d1: null, t2: null }).message).toMatch(/D1[\s\S]*T2/)
    expect(review()({ ...row, technologyCardNumber: 'Неизвестная' }).status).toBe('unknown')
    expect(row).toEqual(before)
  })
  it('preserves renamed and archived historical applicability but excludes archive from new choice', () => {
    const archived = review([{ ...card, archived: true }])
    expect(archived({ ...row, technologyCardNumber: 'Старое название' }).status).toBe('valid')
    expect(archived(row).status).toBe('none')
    expect(review()({ ...row, technologyCardNumber: 'Старое название', weldingMethod: 'РД', connectionType: 'У19', d1: 219, d2: 219 }).message).toMatch(/Способы[\s\S]*соединени[\s\S]*диаметр/)
  })
  it('checks only welded non-T joints and persists the optional task code per row', () => {
    const tasks = buildTechnologyCardTasks([row, { ...row, id: 11, weldDate: null }, { ...row, id: 12, connectionType: 'Т1' }], review())
    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-06')
    expect(isMandatoryDispatcherTask(tasks[0])).toBe(false)
    expect(buildDispatcherTaskCodeIndexRows(tasks, [row])).toEqual([{ rowId: 10, code: 'ДЗ-06', taskKey: 'code:ДЗ-06' }])
  })
  it('flags a legacy three-method card and excludes it from new selection without rewriting the joint', () => {
    const legacy = { ...card, weldingMethods: ['РАД', 'РД', 'АФ'] }
    const settings = { ...DEFAULT_DATA_LIST_SETTINGS, weldingTypes: legacy.weldingMethods }
    const check = createTechnologyCardReview({ cards: [legacy], names: [{ name: legacy.name, cardId: legacy.id }] }, settings)
    const stored = { ...row, technologyCardNumber: legacy.name }
    const before = structuredClone(stored)
    expect(check(stored).message).toContain('не больше двух')
    expect(check(stored).cards).toEqual([])
    const tasks = buildTechnologyCardTasks([stored], check)
    expect(tasks).toHaveLength(1)
    expect(buildDispatcherTaskCodeIndexRows(tasks, [stored])).toEqual([{ rowId: 10, code: 'ДЗ-06', taskKey: 'code:ДЗ-06' }])
    expect(stored).toEqual(before)
  })
  it('switches the reminder off and on without changing the saved joint', () => {
    const input = { acceptedDispatcherWarningKeys: new Set<string>(), dismissedRepeatedJointTaskKeys: new Set<string>(),
      dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS, dispatcherSettings: DEFAULT_DISPATCHER_SETTINGS,
      rows: [row], welderStamps: [], welderStampSuspensions: [], technologyCardReview: review() }
    const dz = (enabled: boolean) => buildVisibleDispatcherTasks({ ...input, dispatcherSettings: { ...input.dispatcherSettings, 'check-technology-card': enabled } }).repeatedJointTasks.filter(task => getDispatcherTaskCode(task) === 'ДЗ-06')
    expect(dz(true)).toHaveLength(1)
    expect(dz(false)).toHaveLength(0)
    expect(dz(true)).toHaveLength(1)
    expect(row.technologyCardNumber).toBeUndefined()
  })
})
