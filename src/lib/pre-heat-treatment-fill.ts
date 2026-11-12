import type { WeldRow } from './dispatcher-types'
import { isControlEnabledValue } from './control-availability-values'
import { getPreHeatTreatmentControl, isPreHeatTreatmentLnkAvailable, PRE_HEAT_TREATMENT_LNK_METHODS, type PreHeatTreatmentLnkMethodCode } from './lnk-control-stage'
import { buildSystemDocumentSplitGroups, getSystemDocumentSplitSettingId, type SystemDocumentSplitMode, type SystemDocumentSplitSettings } from './system-document-splitting'
import { normalizeSpecialistSelection, type SpecialistSelection } from './document-specialists'
import { parseDateLikeToIso } from './date-format'
import { isPendingLnkResultValue } from './report-value-utils'
import { getSystemLnkMethodOrder } from './lnk-system-order'

export type PreHeatTreatmentFillIssue = {
  message: string; rowId: number; itemKey?: string; method?: string; field?: 'date' | 'name'
}

export type PreHeatTreatmentFillOptions = {
  token?: string
  splitModes?: Partial<SystemDocumentSplitSettings>
  overrides?: Record<string, { date?: string; name?: string; specialists?: SpecialistSelection }>
  specialists?: Partial<Record<PreHeatTreatmentLnkMethodCode, SpecialistSelection>>
  confirmedGroups?: Array<{ key: string; name: string; date: string; itemKeys: string[] }>
}
export type PreHeatTreatmentFillItem = {
  key: string; rowId: number; joint: string; location: string; action: 'request' | 'result'; methods: PreHeatTreatmentLnkMethodCode[]
  date: string; manualDate: boolean; name?: string; manualName: boolean; specialists?: SpecialistSelection
}
export type PreHeatTreatmentFillGroup = {
  key: string; action: 'request' | 'result'; date: string; name: string; useSystemName: boolean
  items: PreHeatTreatmentFillItem[]; positions: Array<{ rowId: number; methodCode: PreHeatTreatmentLnkMethodCode }>
  splitMode: SystemDocumentSplitMode; splitSettingId: ReturnType<typeof getSystemDocumentSplitSettingId>
  specialists?: SpecialistSelection
}

/** Only new documents enter this plan. Partial factual history is never repaired
 * by silently replacing it with the requested good result. */
export function buildPreHeatTreatmentFillItems(rows: readonly WeldRow[], options: PreHeatTreatmentFillOptions) {
  const items: PreHeatTreatmentFillItem[] = [], errors: string[] = [], issues: PreHeatTreatmentFillIssue[] = []
  const report = (message: string, rowId: number, method?: string) => { errors.push(message); issues.push({ message, rowId, method }) }
  for (const row of rows) {
    if (!isPreHeatTreatmentLnkAvailable(row)) continue
    const firstItem = items.length
    const missingRequests: PreHeatTreatmentLnkMethodCode[] = []
    const add = (action: 'request' | 'result', methods: PreHeatTreatmentLnkMethodCode[]) => {
      const key = `${row.id}:${action}:${action === 'request' ? 'all' : methods[0]}`
      const override = options.overrides?.[key]
      items.push({ key, rowId: row.id, joint: String(row.joint ?? row.id), action, methods, location: [row.projectTitle, row.subtitleCode, row.line].filter(Boolean).join(' · '),
        date: override?.date ?? parseDateLikeToIso(row.weldDate) ?? '', manualDate: override?.date !== undefined,
        name: override?.name, manualName: override?.name !== undefined,
        ...(action === 'result' ? { specialists: normalizeSpecialistSelection(override?.specialists ?? options.specialists?.[methods[0]!]) } : {}),
      })
    }
    for (const method of PRE_HEAT_TREATMENT_LNK_METHODS) {
      if (!isControlEnabledValue(row[method.enabledKey])) continue
      const control = getPreHeatTreatmentControl(row, method.code)
      const result = String(control?.result ?? '').trim().toLowerCase()
      if (['годен', 'ремонт', 'вырез'].includes(result)) continue
      if (result && !isPendingLnkResultValue(result)) {
        report(`Стык ${row.joint ?? row.id}, ${method.code}: уже сохранён результат «${control!.result}». Проверьте его через управление результатами; быстрое заполнение его не изменяет.`, row.id, method.code)
        continue
      }
      if (control && [control.conclusionName, control.conclusionDate, control.rkExposureConfirmedDiameter, control.defectDescription].some(value => value != null && String(value).trim())) {
        report(`Стык ${row.joint ?? row.id}, ${method.code}: уже есть фактические реквизиты незавершённого результата. Исправьте их через управление результатами.`, row.id, method.code)
        continue
      }
      if (!String(control?.requestName ?? '').trim()) {
        if (control?.requestDate) {
          report(`Стык ${row.joint ?? row.id}, ${method.code}: дата заявки заполнена без названия. Исправьте существующие сведения.`, row.id, method.code)
          continue
        }
        missingRequests.push(method.code)
      }
      add('result', [method.code])
    }
    if (missingRequests.length) add('request', missingRequests)
    if (items.length > firstItem && !parseDateLikeToIso(row.weldDate)) report(`Стык ${row.joint ?? row.id}: сначала укажите дату сварки.`, row.id)
  }
  return { items, errors, issues }
}

export function groupPreHeatTreatmentFillItems(rows: readonly WeldRow[], items: readonly PreHeatTreatmentFillItem[], splitModes: SystemDocumentSplitSettings) {
  const byId = new Map(rows.map(row => [row.id, row])), groups = new Map<string, PreHeatTreatmentFillGroup>()
  const errors: string[] = [], issues: PreHeatTreatmentFillIssue[] = []
  for (const item of items) {
    const splitSettingId = getSystemDocumentSplitSettingId({ type: item.action === 'request' ? 'lnkRequest' : 'lnkConclusion', methodCode: item.methods[0] })
    const splitMode = splitModes[splitSettingId]
    const split = buildSystemDocumentSplitGroups([byId.get(item.rowId)!], splitMode)[0]!
    if (split.isMissingValueFallback) {
      const message = `Стык ${item.joint}: заполните ${split.missingFields.join(', ')} для выбранного разделения.`
      errors.push(message); issues.push({ message, rowId: item.rowId, itemKey: item.key })
    }
    const key = JSON.stringify([item.action, item.action === 'result' ? item.methods[0] : '', split.key, item.date, item.manualName ? item.name : null, item.specialists ?? null])
    let group = groups.get(key)
    if (!group) {
      group = { key, action: item.action, date: item.date, name: item.name ?? '', useSystemName: !item.manualName,
        items: [], positions: [], splitMode, splitSettingId, specialists: item.specialists }
      groups.set(key, group)
    }
    group.items.push(item)
    for (const methodCode of item.methods) group.positions.push({ rowId: item.rowId, methodCode })
  }
  return { groups: [...groups.values()].sort((a, b) => {
    if (a.action !== b.action) return a.action === 'request' ? -1 : 1
    const rank = (g: PreHeatTreatmentFillGroup) => getSystemLnkMethodOrder(g.positions[0]?.methodCode ?? '')
    return rank(a) - rank(b) || a.key.localeCompare(b.key)
  }), errors, issues }
}
