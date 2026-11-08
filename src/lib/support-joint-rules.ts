import { isTConnectionType } from './connection-type'
import { splitWeldMaterialGroups } from './weld-material-groups'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'
import { parseJointName } from './joint-name'
import { getLnkMethodFamilyBlockReason } from './lnk-method-family'
import { isSupportRepair, normalizeSupportWeldLength, SUPPORT_REPAIR_LENGTH_REASON } from './support-weld-length'
import { getSupportWeldLengthError } from './support-length-value'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import type { WeldFieldKey, WeldInput } from './weld-fields'
import { shouldValidateOfficialStampCompatibilityForSave } from './welder-stamp-compatibility-validation'

export const SUPPORT_JOINT_SAVE_RULE_CODE = 'СП-13'
export type SupportJointRuleIssue = { fieldKeys: WeldFieldKey[]; message: string }
const text = (value: unknown) => String(value ?? '').trim()
const stamp = (value: unknown) => text(value).toLocaleLowerCase('ru') === 'пусто' ? '' : text(value).toLocaleLowerCase('ru')
export const isSupportJointName = (value: unknown) => /^ОП/i.test(text(value))

/** Family and physical shape are mandatory, including partial updates after merging.
 * Never infer the saved family from a client's new name or repair suffix. */
export function getSupportJointRuleIssues(
  record: WeldInput,
  previous?: WeldInput,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
): SupportJointRuleIssue[] {
  const issues: SupportJointRuleIssue[] = []
  const add = (fieldKeys: WeldFieldKey[], message: string) => issues.push({ fieldKeys, message: `${SUPPORT_JOINT_SAVE_RULE_CODE} · ${message}` })
  const support = isTConnectionType(record.connectionType)
  const previousFamilyKnown = previous && /^[СУТ]/i.test(text(previous.connectionType))
  if (previous?.id && previousFamilyKnown && isTConnectionType(previous.connectionType) !== support) {
    add(['joint', 'connectionType'], 'Сохранённое соединение нельзя переводить между Т и С/У, в том числе одновременно меняя номер и тип.')
  }
  if (support !== isSupportJointName(record.joint)) {
    if (support || isSupportJointName(record.joint)) add(['joint', 'connectionType'], 'Тип Т требует номер с кириллическим ОП; номер ОП разрешён только для типа Т.')
  }
  const length = record.weldLength
  if (text(length)) {
    if (!support) add(['weldLength', 'connectionType'], 'Длина шва заполняется только для соединений Т.')
    else {
      const error = getSupportWeldLengthError(length)
      if (error) add(['weldLength'], error)
    }
  }
  if (!support) return issues
  // Existing composition remains a dispatcher warning. Unrelated corrections
  // must not require rewriting old welding facts. New/copied joints and changes
  // to identity, physical or qualification inputs still undergo the full check.
  const unrelatedToStoredComposition = previous?.id != null && record.id === previous.id &&
    !shouldValidateOfficialStampCompatibilityForSave(record, previous) &&
    (['projectTitle', 'subtitleCode', 'line', 'joint', 'weldLength'] as const)
      .every(key => text(record[key]) === text(previous[key]))
  if (!unrelatedToStoredComposition) issues.push(...getSupportCompositionIssues(record))
  if (previous?.id && isSupportRepair(previous, settings) && normalizeSupportWeldLength(record.weldLength) !== normalizeSupportWeldLength(previous.weldLength)) {
    add(['weldLength'], SUPPORT_REPAIR_LENGTH_REASON)
  }
  for (const [label, keys] of [
    ['Официальные', ['stamp1K', 'stamp1Z', 'stamp1O']],
    ['Фактические', ['stamp1KFact', 'stamp1ZFact', 'stamp1OFact']],
  ] as const) {
    const filled = keys.filter(key => stamp(record[key]))
    if (new Set(filled.map(key => stamp(record[key]))).size > 1) add([...filled], `${label} клейма заполненных слоёв Т должны совпадать; пустые слои разрешены.`)
  }
  const second = (['stamp2K', 'stamp2Z', 'stamp2O', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'] as const).filter(key => stamp(record[key]))
  if (second.length) add([...second], 'Для Т все поля клейм с индексом 2 должны быть пустыми, даже при повторе того же клейма.')
  const rk = normalizeControlAvailabilityStorageText(record.hasRk)
  if (rk && rk !== 'пусто') add(['hasRk'], 'Для Т назначение РК запрещено.')
  const rkFields = (['rkRequest', 'rkRequestDate', 'rkResult', 'rkConclusionDate', 'rkConclusion',
    'lnkDefectDescription', 'rkExposureConfirmedDiameter', 'preRkRequest', 'preRkRequestDate',
    'preRkResult', 'preRkConclusionDate', 'preRkConclusion', 'preRkDefectDescription'] as const)
    .filter(key => text(record[key]))
  if (rkFields.length) add([...rkFields], 'Для Т заявки, результаты и реквизиты РК запрещены на обоих этапах.')
  const relations = record as WeldInput & {
    preHeatTreatmentControls?: { method: string }[]
    duplicateControls?: { method: string }[]
  }
  if (relations.preHeatTreatmentControls?.some(control => getLnkMethodFamilyBlockReason(record, control.method))) {
    add(['preRkRequest', 'preRkResult'], 'Для Т РК до ТО запрещён, включая позицию без результата.')
  }
  if (relations.duplicateControls?.some(control => getLnkMethodFamilyBlockReason(record, control.method))) {
    add(['hasRk'], 'Для Т дубль РК запрещён, включая позицию без результата.')
  }
  if (record.layeredControlAssigned || record.layeredControlRequest?.assigned) add(['connectionType'], 'Для Т послойный контроль запрещён.')
  if (parseJointName(record.joint, settings).segments.some(segment => segment.suffix !== 'R')) {
    add(['joint'], 'Для Т разрешены только ремонты R; вырез и катушка запрещены.')
  }
  return issues
}

export function assertSupportJointRules(record: WeldInput, previous?: WeldInput, settings?: SystemIndexSettings) {
  const issues = getSupportJointRuleIssues(record, previous, settings)
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('\n'))
}

/** Shared by card validation, matching and the educational example. */
export function getSupportCompositionIssues(record: WeldInput): SupportJointRuleIssue[] {
  if (!isTConnectionType(record.connectionType)) return []
  const issues: SupportJointRuleIssue[] = []
  const add = (fieldKeys: WeldFieldKey[], message: string) => issues.push({ fieldKeys, message: `${SUPPORT_JOINT_SAVE_RULE_CODE} · ${message}` })
  if (splitWeldMaterialGroups(record.materialGroup).length > 1) {
    add(['connectionType', 'materialGroup'], 'Для Т разнородное соединение запрещено. Оставьте одну группу материалов.')
  }
  if (new Set(text(record.weldingMethod).split(/[+,;]/).map(value => value.trim().toLocaleUpperCase('ru')).filter(Boolean)).size > 1) {
    add(['connectionType', 'weldingMethod'], 'Для Т комбинированная сварка запрещена. Оставьте один способ сварки.')
  }
  return issues
}
