import {
  FIELD_BY_KEY,
  FINAL_STATUS_OPTIONS,
  RESULT_STATUS_OPTIONS,
  type WeldFieldKey,
  type WeldInput,
  calculateFinalStatus,
} from '@/lib/weld-fields'
import { withAutoVikForWeldDate } from '@/lib/weld-import-export'
import { hasReservedJointSystemPart, normalizeJointName, validateManualJointName } from '@/lib/joint-name'

export const yesEmptyFieldKeys = new Set([
  'pstoRequired',
  'hasVik',
  'hasRk',
  'hasPvk',
  'hasUzk',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
])

export const weldingMethodOptions = ['РАД', 'РД', 'МП'] as const

const factualWelderStampFieldKeys = new Set<WeldFieldKey>([
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
])

export const formHiddenFieldKeys = new Set<WeldFieldKey>([
  'status',
  'createdAt',
  'vikRequest',
  'rkRequest',
  'pvkRequest',
  'uzkRequest',
  'pstoRequest',
  'tvmtRequest',
  'rfaRequest',
  'stlsRequest',
  'mkkRequest',
  'pstoDate',
  'heatTreatmentDiagram',
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'pstoResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'pstoNote',
  'finalStatus',
  'pstoBoq',
  'pstoKs3',
  'pstoCreatedAt',
  'lnkCreatedAt',
  'vikBoq',
  'vikKs3',
  'rkBoq',
  'rkKs3',
  'pvkBoq',
  'pvkKs3',
  'uzkBoq',
  'uzkKs3',
  'tvmtBoq',
  'tvmtKs3',
  'rfaBoq',
  'rfaKs3',
  'stlsBoq',
  'stlsKs3',
  'mkkBoq',
  'mkkKs3',
  'vikConclusionDate',
  'vikConclusion',
  'rkConclusionDate',
  'rkConclusion',
  'pvkConclusionDate',
  'pvkConclusion',
  'uzkConclusionDate',
  'uzkConclusion',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'rfaConclusionDate',
  'rfaConclusion',
  'stlsConclusionDate',
  'stlsConclusion',
  'mkkConclusionDate',
  'mkkConclusion',
  'lnkDefectDescription',
  'lnkNote',
])

export type StampSelectOption = {
  value: string
  disabled?: boolean
  reason?: string
}

export type StampSelectOptions = Partial<Record<WeldFieldKey, readonly StampSelectOption[]>>

export function isYesValue(value: unknown) {
  if (value === true) return true
  return String(value ?? '').toLowerCase() === 'да'
}

export function getSelectedWeldingMethods(value: unknown) {
  const selected = new Set(
    String(value ?? '')
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  return weldingMethodOptions.filter((option) => selected.has(option))
}

export function toggleWeldingMethodValue(value: unknown, option: (typeof weldingMethodOptions)[number]) {
  const selected = new Set(getSelectedWeldingMethods(value))
  if (selected.has(option)) {
    selected.delete(option)
  } else {
    selected.add(option)
  }

  const next = weldingMethodOptions.filter((item) => selected.has(item)).join('+')
  return next || null
}

export function getResultStatusValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  const option = RESULT_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? ''
}

export function getFinalStatusValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  const option = FINAL_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? ''
}

export function OfficialityBadge({ value }: { value: WeldInput }) {
  if (String(value.status ?? '').trim().toLowerCase() !== 'неофициальный') return null
  return (
    <span className="inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
      неофициальный
    </span>
  )
}

export function withCalculatedFinalStatus(value: WeldInput) {
  const nextValue = withAutoVikForWeldDate(value)
  return { ...nextValue, finalStatus: calculateFinalStatus(nextValue) }
}

export function getJointTitle(value: WeldInput) {
  const project = String(value.projectTitle ?? '').trim()
  const subtitle = String(value.subtitleCode ?? '').trim()
  const line = String(value.line ?? '').trim()
  const joint = String(value.joint ?? '').trim()

  if (!project && !subtitle && !line && !joint) return 'Проект, шифр, линия и стык появятся после заполнения.'
  return `${project || '-'} · ${subtitle || '-'} · ${line || '-'} · ${joint || '-'}`
}

export function getWeldFormSaveBlockReason(draft: WeldInput, initialValue: WeldInput & { id?: number }) {
  if (isFutureWeldDate(draft.weldDate)) {
    return 'дата сварки не может быть позже сегодняшней.'
  }

  const currentJoint = normalizeJointName(draft.joint)
  const initialJoint = normalizeJointName(initialValue.joint)
  if (initialValue.id && currentJoint === initialJoint) return null

  if (initialValue.id && hasReservedJointSystemPart(initialValue.joint)) {
    return 'стык с системными индексами R/W/Y нельзя переименовывать вручную. Используйте подсказки диспетчера задач.'
  }

  return validateManualJointName(draft.joint)
}

export function getWeldStampSaveBlockReason(
  draft: WeldInput,
  stampSelectOptions: StampSelectOptions | undefined,
) {
  if (!stampSelectOptions) return null

  for (const [fieldKey, options] of Object.entries(stampSelectOptions) as Array<[WeldFieldKey, readonly StampSelectOption[]]>) {
    if (factualWelderStampFieldKeys.has(fieldKey)) continue

    const value = getStampSelectValue(draft[fieldKey])
    if (!value) continue

    const selectedOption = options.find((option) => option.value.trim() === value)
    if (!selectedOption) {
      return `${FIELD_BY_KEY.get(fieldKey)?.label ?? 'поле клейма'} должно быть выбрано из активного реестра клейм.`
    }
    if (selectedOption.disabled) {
      const reason = selectedOption.reason ? `: ${selectedOption.reason}` : ''
      return `${FIELD_BY_KEY.get(fieldKey)?.label ?? 'поле клейма'} не подходит по реестру клейм${reason}.`
    }
  }

  return null
}

export function getStampSelectValue(value: unknown) {
  const text = String(value ?? '').trim()
  return text.toLowerCase() === 'пусто' ? '' : text
}

function isFutureWeldDate(value: unknown) {
  const date = String(value ?? '').trim()
  if (!date) return false
  return date > getTodayIsoDate()
}

function getTodayIsoDate() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
