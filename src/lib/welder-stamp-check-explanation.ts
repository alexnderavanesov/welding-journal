import { getOfficialStampJointDimensionRequirements, getOfficialStampMaterialScopes } from './welder-stamp-compatibility-utils'
import { normalizeWeldMaterialGroups, splitWeldMaterialGroups } from './weld-material-groups'

export type ExampleWeldingMethod = 'РАД' | 'РД' | 'РАД+РД'
export type StampCheckExample = {
  connectionType: 'С17' | 'У19'
  group1: string
  group2: string
  d1: string
  t1: string
  d2: string
  t2: string
  stampCount: 1 | 2
  weldingMethod: ExampleWeldingMethod
  methodA: ExampleWeldingMethod
  methodB: ExampleWeldingMethod
}

export const DEFAULT_STAMP_CHECK_EXAMPLE: StampCheckExample = {
  connectionType: 'С17', group1: 'М01', group2: 'М01', d1: '108', t1: '4', d2: '108', t2: '6',
  stampCount: 1, weldingMethod: 'РАД', methodA: 'РАД', methodB: 'РД',
}

export type StampCheckDimensionField = 'd1' | 't1' | 'd2' | 't2'
export type StampCheckDimensionExplanation = {
  group: string
  diameter: string
  thickness: string
  note: string
  diameterFields: StampCheckDimensionField[]
  thicknessFields: StampCheckDimensionField[]
  alternatives: boolean
}

/** Explains the current dimension requirements, not an actual welder's eligibility.
 * Numeric requirements come from the same helpers as save/import validation. */
export function explainStampCheckExample(input: StampCheckExample) {
  const errors: string[] = []
  const numbers = {} as Record<'d1' | 't1' | 'd2' | 't2', number>
  for (const key of ['d1', 't1', 'd2', 't2'] as const) {
    const raw = input[key].trim().replace(',', '.')
    const number = Number(raw)
    if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(number) || number <= 0) {
      errors.push(`${key.toUpperCase()}: укажите положительное число в миллиметрах.`)
    }
    numbers[key] = number
  }
  for (const [index, value] of [input.group1, input.group2].entries()) {
    if (splitWeldMaterialGroups(value).length !== 1) errors.push(`Материал ${index + 1}: выберите одну группу.`)
  }
  const scopes: StampCheckDimensionExplanation[] = []
  const welders = (input.stampCount === 1 ? ['А'] : ['А', 'Б']).map((name, index) => ({
    name: `Сварщик ${name}`,
    methods: input.weldingMethod === 'РАД+РД' && input.stampCount === 2 ? (index === 0 ? input.methodA : input.methodB) : input.weldingMethod,
  }))
  const coveredMethods = new Set(welders.flatMap(welder => welder.methods.split('+')))
  const missingMethods = input.weldingMethod.split('+').filter(method => !coveredMethods.has(method))
  const teamWarning = missingMethods.length ? `В распределении не указан исполнитель способа ${missingMethods.join(', ')}. Для комбинированного стыка нужны оба способа.` : null
  if (errors.length) return { errors, scopes, welders, teamWarning }

  const record = { ...input, materialGroup: normalizeWeldMaterialGroups(`${input.group1} + ${input.group2}`) }
  if (splitWeldMaterialGroups(record.materialGroup).length === 2) {
    for (const scope of getOfficialStampMaterialScopes(record)) {
      scopes.push({ group: scope.group,
        diameterFields: [scope.side === 1 ? 'd1' : 'd2'], thicknessFields: [scope.side === 1 ? 't1' : 't2'], alternatives: false,
        diameter: `D${scope.side} = ${scope.dimensions.diameters[0]} мм`,
        thickness: `T${scope.side} = ${scope.dimensions.thicknesses[0]} мм`,
        note: `Материал ${scope.side}: нужны оба параметра этой стороны. Допуск другой группы их не заменяет.` })
    }
  } else {
    const requirements = getOfficialStampJointDimensionRequirements(record)
    if (requirements.diameterCoverage === 'any') {
      scopes.push({ group: record.materialGroup,
        diameterFields: ['d1', 'd2'], thicknessFields: ['t1', 't2'], alternatives: true,
        diameter: `D1 = ${numbers.d1} или D2 = ${numbers.d2} мм`,
        thickness: `T1 = ${numbers.t1} или T2 = ${numbers.t2} мм`,
        note: 'Нужен хотя бы один из диаметров И хотя бы одна из толщин. D и T могут быть от разных сторон.' })
    } else if (numbers.d1 === numbers.d2) {
      const thicknessField = numbers.t1 === numbers.t2 ? 'T1 = T2' : numbers.t1 < numbers.t2 ? 'T1' : 'T2'
      scopes.push({ group: record.materialGroup,
        diameterFields: ['d1', 'd2'], thicknessFields: numbers.t1 === numbers.t2 ? ['t1', 't2'] : [numbers.t1 < numbers.t2 ? 't1' : 't2'], alternatives: false,
        diameter: `D1 = D2 = ${requirements.diameters[0]} мм`,
        thickness: `${thicknessField} = ${requirements.thicknesses[0]} мм`,
        note: 'Диаметры равны: проверяется общий D и меньшая T. Большая толщина не участвует в этой проверке.' })
    } else {
      const side = numbers.d1 < numbers.d2 ? 1 : 2
      const other = side === 1 ? 2 : 1
      scopes.push({ group: record.materialGroup,
        diameterFields: [side === 1 ? 'd1' : 'd2'], thicknessFields: [side === 1 ? 't1' : 't2'], alternatives: false,
        diameter: `D${side} = ${requirements.diameters[0]} мм`,
        thickness: `T${side} = ${requirements.thicknesses[0]} мм`,
        note: `Сторона ${side} имеет меньший диаметр. D${other} и T${other} не участвуют в этой проверке; отдельно минимальная толщина не выбирается.` })
    }
  }
  return { errors, scopes, welders, teamWarning }
}
