import { formatDateInputValue, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { parseJointChainName } from '@/lib/joint-chain'
import type { StatisticsUnit } from '@/lib/statistics-summary'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  getConfiguredBaseJointType,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

export type WeldingDynamicsUnit = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type WeldingDynamicsScaleSetting = WeldingDynamicsUnit | 'auto'

export type WeldingDynamicsMaterialGroup = {
  key: string
  label: string
  value: number
}

export type WeldingDynamicsProjectGroup = WeldingDynamicsMaterialGroup

export type WeldingDynamicsJointTypeKey = 's' | 'f' | 'unknown'

export type WeldingDynamicsJointType = {
  key: WeldingDynamicsJointTypeKey
  code: string
  label: string
  value: number
}

export type WeldingDynamicsMaterialJointTypeGroup = WeldingDynamicsMaterialGroup & {
  jointTypes: WeldingDynamicsJointType[]
  welderCount: number
  welderShiftCount: number
  valuePerWelderShift: number
}

export type WeldingDynamicsProjectJointTypeGroup = WeldingDynamicsMaterialJointTypeGroup

export type WeldingDynamicsBucket = {
  key: string
  label: string
  shortLabel: string
  value: number
  weldedJoints: number
  wdi: number
  welderCount: number
  welderShiftCount: number
  valuePerWelderShift: number
  materialGroups: WeldingDynamicsMaterialGroup[]
  projectGroups: WeldingDynamicsProjectGroup[]
  jointTypes: WeldingDynamicsJointType[]
  materialJointTypes: WeldingDynamicsMaterialJointTypeGroup[]
  projectJointTypes: WeldingDynamicsProjectJointTypeGroup[]
}

export type WeldingDynamicsSummary = {
  bucketUnit: WeldingDynamicsUnit
  bucketUnitLabel: string
  buckets: WeldingDynamicsBucket[]
  periodDays: number
  totalValue: number
  totalWelders: number
  welderShiftCount: number
  averageWeldersPerShift: number
  averageValuePerWelderShift: number
  peakValue: number
  peakWelders: number
  materialGroups: WeldingDynamicsMaterialGroup[]
  projectGroups: WeldingDynamicsProjectGroup[]
  jointTypes: WeldingDynamicsJointType[]
  materialJointTypes: WeldingDynamicsMaterialJointTypeGroup[]
  projectJointTypes: WeldingDynamicsProjectJointTypeGroup[]
}

const FACTUAL_STAMP_KEYS = [
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
] as const satisfies readonly (keyof WeldRow)[]

const MS_PER_DAY = 24 * 60 * 60 * 1000
export const WELDING_DYNAMICS_MISSING_MATERIAL_GROUP_KEY = '__missing_material_group__'
export const WELDING_DYNAMICS_OTHER_MATERIAL_GROUP_KEY = '__other_material_groups__'
export const WELDING_DYNAMICS_MISSING_PROJECT_GROUP_KEY = '__missing_project_group__'
export const WELDING_DYNAMICS_OTHER_PROJECT_GROUP_KEY = '__other_project_groups__'
const MAX_SEPARATE_DIMENSION_GROUPS = 6
const WELDING_DYNAMICS_JOINT_TYPE_ORDER: WeldingDynamicsJointTypeKey[] = ['s', 'unknown', 'f']
const WELDING_DYNAMICS_WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const

export function formatWeldingDynamicsBucketHeaderLabel(bucket: WeldingDynamicsBucket, unit: WeldingDynamicsUnit) {
  if (unit === 'week') return bucket.label.replace(/\s+-\s+/g, '–')
  if (unit !== 'day') return bucket.label

  const [year, month, day] = bucket.key.split('-').map(Number)
  if (!year || !month || !day) return bucket.shortLabel
  const weekday = WELDING_DYNAMICS_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${bucket.shortLabel} ${weekday}`
}

export function getStableWeldingDynamicsColorIndex(key: string, paletteLength: number) {
  if (!Number.isInteger(paletteLength) || paletteLength <= 0) return 0
  let hash = 2166136261
  for (const character of String(key).trim().toLocaleLowerCase('ru-RU')) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % paletteLength
}

export function buildWeldingDynamics(
  rows: readonly WeldRow[],
  from: string,
  to: string,
  unit: StatisticsUnit,
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
  scaleSetting: WeldingDynamicsScaleSetting = 'auto',
): WeldingDynamicsSummary {
  const datedRows = rows
    .map((row) => ({ row, date: parseDateLikeToIso(row.weldDate) }))
    .filter((item): item is { row: WeldRow; date: string } => Boolean(item.date))
    .sort((a, b) => a.date.localeCompare(b.date))

  const firstDate = from || datedRows[0]?.date || ''
  const lastDate = to || datedRows.at(-1)?.date || firstDate
  if (!firstDate || !lastDate) return createEmptyDynamics(scaleSetting === 'auto' ? 'day' : scaleSetting)

  const startIso = firstDate <= lastDate ? firstDate : lastDate
  const endIso = firstDate <= lastDate ? lastDate : firstDate
  const periodDays = getDaysBetween(parseIsoDate(startIso), parseIsoDate(endIso)) + 1
  const bucketUnit = scaleSetting === 'auto' ? chooseWeldingDynamicsUnit(startIso, endIso) : scaleSetting
  const bucketUnitLabel = getBucketUnitLabel(bucketUnit)
  const bucketMap = new Map<string, WeldingDynamicsBucket>()
  for (const bucket of createBuckets(startIso, endIso, bucketUnit)) {
    bucketMap.set(bucket.key, bucket)
  }

  const weldersByBucket = new Map<string, Set<string>>()
  const weldersByDate = new Map<string, Set<string>>()
  const allWelders = new Set<string>()
  const materialGroupsByBucket = new Map<string, Map<string, number>>()
  const materialGroupTotals = new Map<string, number>()
  const jointTypesByBucket = new Map<string, Map<WeldingDynamicsJointTypeKey, number>>()
  const jointTypeTotals = new Map<WeldingDynamicsJointTypeKey, number>()
  const materialJointTypesByBucket = new Map<string, Map<string, Map<WeldingDynamicsJointTypeKey, number>>>()
  const materialJointTypeTotals = new Map<string, Map<WeldingDynamicsJointTypeKey, number>>()
  const materialWeldersByBucket = new Map<string, GroupWelderParticipation>()
  const materialWelderTotals: GroupWelderParticipation = new Map()
  const projectGroupsByBucket = new Map<string, Map<string, number>>()
  const projectGroupTotals = new Map<string, number>()
  const projectJointTypesByBucket = new Map<string, Map<string, Map<WeldingDynamicsJointTypeKey, number>>>()
  const projectJointTypeTotals = new Map<string, Map<WeldingDynamicsJointTypeKey, number>>()
  const projectWeldersByBucket = new Map<string, GroupWelderParticipation>()
  const projectWelderTotals: GroupWelderParticipation = new Map()

  for (const { row, date } of datedRows) {
    if (date < startIso || date > endIso) continue
    const bucketKey = getBucketKey(date, startIso, bucketUnit)
    const bucket = bucketMap.get(bucketKey)
    if (!bucket) continue

    bucket.weldedJoints += 1
    bucket.wdi += getWdiValue(row)
    bucket.value = unit === 'wdi' ? bucket.wdi : bucket.weldedJoints

    const materialGroupKey = getMaterialGroupKey(row.materialGroup)
    const materialGroupValue = unit === 'wdi' ? getWdiValue(row) : 1
    const bucketMaterialGroups = materialGroupsByBucket.get(bucketKey) ?? new Map<string, number>()
    bucketMaterialGroups.set(materialGroupKey, (bucketMaterialGroups.get(materialGroupKey) ?? 0) + materialGroupValue)
    materialGroupsByBucket.set(bucketKey, bucketMaterialGroups)
    materialGroupTotals.set(materialGroupKey, (materialGroupTotals.get(materialGroupKey) ?? 0) + materialGroupValue)

    const projectGroupKey = getProjectGroupKey(row.projectTitle)
    const bucketProjectGroups = projectGroupsByBucket.get(bucketKey) ?? new Map<string, number>()
    bucketProjectGroups.set(projectGroupKey, (bucketProjectGroups.get(projectGroupKey) ?? 0) + materialGroupValue)
    projectGroupsByBucket.set(bucketKey, bucketProjectGroups)
    projectGroupTotals.set(projectGroupKey, (projectGroupTotals.get(projectGroupKey) ?? 0) + materialGroupValue)

    const jointTypeKey = getWeldingDynamicsJointTypeKey(row, systemIndexSettings)
    const bucketJointTypes = jointTypesByBucket.get(bucketKey) ?? new Map<WeldingDynamicsJointTypeKey, number>()
    bucketJointTypes.set(jointTypeKey, (bucketJointTypes.get(jointTypeKey) ?? 0) + materialGroupValue)
    jointTypesByBucket.set(bucketKey, bucketJointTypes)
    jointTypeTotals.set(jointTypeKey, (jointTypeTotals.get(jointTypeKey) ?? 0) + materialGroupValue)

    addGroupJointTypeValue(materialJointTypeTotals, materialGroupKey, jointTypeKey, materialGroupValue)
    const bucketMaterialJointTypes = materialJointTypesByBucket.get(bucketKey) ?? new Map<string, Map<WeldingDynamicsJointTypeKey, number>>()
    addGroupJointTypeValue(bucketMaterialJointTypes, materialGroupKey, jointTypeKey, materialGroupValue)
    materialJointTypesByBucket.set(bucketKey, bucketMaterialJointTypes)

    addGroupJointTypeValue(projectJointTypeTotals, projectGroupKey, jointTypeKey, materialGroupValue)
    const bucketProjectJointTypes = projectJointTypesByBucket.get(bucketKey) ?? new Map<string, Map<WeldingDynamicsJointTypeKey, number>>()
    addGroupJointTypeValue(bucketProjectJointTypes, projectGroupKey, jointTypeKey, materialGroupValue)
    projectJointTypesByBucket.set(bucketKey, bucketProjectJointTypes)

    const factualStamps = getFactualStamps(row)
    addGroupWelderParticipation(materialWelderTotals, materialGroupKey, date, factualStamps)
    const bucketMaterialWelders = materialWeldersByBucket.get(bucketKey) ?? new Map()
    addGroupWelderParticipation(bucketMaterialWelders, materialGroupKey, date, factualStamps)
    materialWeldersByBucket.set(bucketKey, bucketMaterialWelders)
    addGroupWelderParticipation(projectWelderTotals, projectGroupKey, date, factualStamps)
    const bucketProjectWelders = projectWeldersByBucket.get(bucketKey) ?? new Map()
    addGroupWelderParticipation(bucketProjectWelders, projectGroupKey, date, factualStamps)
    projectWeldersByBucket.set(bucketKey, bucketProjectWelders)

    const bucketWelders = weldersByBucket.get(bucketKey) ?? new Set<string>()
    const dateWelders = weldersByDate.get(date) ?? new Set<string>()
    for (const stamp of factualStamps) {
      bucketWelders.add(stamp)
      dateWelders.add(stamp)
      allWelders.add(stamp)
    }
    weldersByBucket.set(bucketKey, bucketWelders)
    weldersByDate.set(date, dateWelders)
    bucket.welderCount = bucketWelders.size
  }

  const buckets = Array.from(bucketMap.values())
  for (const [date, welders] of weldersByDate) {
    const bucket = bucketMap.get(getBucketKey(date, startIso, bucketUnit))
    if (bucket) bucket.welderShiftCount += welders.size
  }
  const materialGroupLayout = buildMaterialGroupLayout(materialGroupTotals)
  const projectGroupLayout = buildProjectGroupLayout(projectGroupTotals)
  for (const bucket of buckets) {
    bucket.valuePerWelderShift = divideOrZero(bucket.value, bucket.welderShiftCount)
    bucket.materialGroups = buildBucketMaterialGroups(
      materialGroupsByBucket.get(bucket.key) ?? new Map<string, number>(),
      materialGroupLayout,
    )
    bucket.jointTypes = buildJointTypes(
      jointTypesByBucket.get(bucket.key) ?? new Map<WeldingDynamicsJointTypeKey, number>(),
      systemIndexSettings,
    )
    bucket.materialJointTypes = buildMaterialJointTypeGroups(
      materialJointTypesByBucket.get(bucket.key) ?? new Map<string, Map<WeldingDynamicsJointTypeKey, number>>(),
      materialGroupLayout,
      systemIndexSettings,
      materialWeldersByBucket.get(bucket.key) ?? new Map(),
    )
    bucket.projectGroups = buildBucketProjectGroups(
      projectGroupsByBucket.get(bucket.key) ?? new Map<string, number>(),
      projectGroupLayout,
    )
    bucket.projectJointTypes = buildProjectJointTypeGroups(
      projectJointTypesByBucket.get(bucket.key) ?? new Map<string, Map<WeldingDynamicsJointTypeKey, number>>(),
      projectGroupLayout,
      systemIndexSettings,
      projectWeldersByBucket.get(bucket.key) ?? new Map(),
    )
  }
  const totalValue = buckets.reduce((total, bucket) => total + bucket.value, 0)
  const welderShiftCount = buckets.reduce((total, bucket) => total + bucket.welderShiftCount, 0)
  return {
    bucketUnit,
    bucketUnitLabel,
    buckets,
    periodDays,
    totalValue,
    totalWelders: allWelders.size,
    welderShiftCount,
    averageWeldersPerShift: divideOrZero(welderShiftCount, periodDays),
    averageValuePerWelderShift: divideOrZero(totalValue, welderShiftCount),
    peakValue: Math.max(0, ...buckets.map((bucket) => bucket.value)),
    peakWelders: Math.max(0, ...buckets.map((bucket) => bucket.welderCount)),
    materialGroups: materialGroupLayout.groups,
    projectGroups: projectGroupLayout.groups,
    jointTypes: buildJointTypes(jointTypeTotals, systemIndexSettings, true),
    materialJointTypes: buildMaterialJointTypeGroups(
      materialJointTypeTotals,
      materialGroupLayout,
      systemIndexSettings,
      materialWelderTotals,
    ),
    projectJointTypes: buildProjectJointTypeGroups(
      projectJointTypeTotals,
      projectGroupLayout,
      systemIndexSettings,
      projectWelderTotals,
    ),
  }
}

function chooseWeldingDynamicsUnit(from: string, to: string): WeldingDynamicsUnit {
  const days = getDaysBetween(parseIsoDate(from), parseIsoDate(to)) + 1
  if (days <= 45) return 'day'
  if (days <= 180) return 'week'
  if (days <= 900) return 'month'
  if (days <= 1825) return 'quarter'
  return 'year'
}

function createEmptyDynamics(bucketUnit: WeldingDynamicsUnit): WeldingDynamicsSummary {
  return {
    bucketUnit,
    bucketUnitLabel: getBucketUnitLabel(bucketUnit),
    buckets: [],
    periodDays: 0,
    totalValue: 0,
    totalWelders: 0,
    welderShiftCount: 0,
    averageWeldersPerShift: 0,
    averageValuePerWelderShift: 0,
    peakValue: 0,
    peakWelders: 0,
    materialGroups: [],
    projectGroups: [],
    jointTypes: [],
    materialJointTypes: [],
    projectJointTypes: [],
  }
}

function createBuckets(from: string, to: string, unit: WeldingDynamicsUnit) {
  const buckets: WeldingDynamicsBucket[] = []
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)

  if (unit === 'day') {
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const iso = formatDateInputValue(date)
      buckets.push(createBucket(iso, formatDayLabel(iso), formatShortDayLabel(iso)))
    }
    return buckets
  }

  if (unit === 'week') {
    for (let date = start; date <= end; date = addDays(date, 7)) {
      const bucketEnd = minDate(addDays(date, 6), end)
      const startIso = formatDateInputValue(date)
      const endIso = formatDateInputValue(bucketEnd)
      buckets.push(createBucket(startIso, `${formatDayLabel(startIso)} - ${formatDayLabel(endIso)}`, formatShortDayLabel(startIso)))
    }
    return buckets
  }

  if (unit === 'month') {
    for (let date = startOfMonth(start); date <= end; date = addMonths(date, 1)) {
      const iso = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
      buckets.push(createBucket(iso, formatMonthLabel(date), formatMonthLabel(date)))
    }
    return buckets
  }

  if (unit === 'quarter') {
    for (let date = startOfQuarter(start); date <= end; date = addMonths(date, 3)) {
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1
      const iso = `${date.getUTCFullYear()}-Q${quarter}`
      buckets.push(createBucket(iso, `${quarter} кв. ${date.getUTCFullYear()}`, `${quarter} кв.`))
    }
    return buckets
  }

  for (let date = startOfYear(start); date <= end; date = addYears(date, 1)) {
    const iso = String(date.getUTCFullYear())
    buckets.push(createBucket(iso, iso, iso))
  }
  return buckets
}

function createBucket(key: string, label: string, shortLabel: string): WeldingDynamicsBucket {
  return {
    key,
    label,
    shortLabel,
    value: 0,
    weldedJoints: 0,
    wdi: 0,
    welderCount: 0,
    welderShiftCount: 0,
    valuePerWelderShift: 0,
    materialGroups: [],
    projectGroups: [],
    jointTypes: [],
    materialJointTypes: [],
    projectJointTypes: [],
  }
}

function divideOrZero(value: number, divisor: number) {
  return divisor > 0 ? value / divisor : 0
}

type DimensionGroupLayout = {
  groups: WeldingDynamicsMaterialGroup[]
  retainedKeys: Set<string>
  collapsedKeys: Set<string>
}

function buildMaterialGroupLayout(totals: Map<string, number>) {
  return buildDimensionGroupLayout(
    totals,
    WELDING_DYNAMICS_MISSING_MATERIAL_GROUP_KEY,
    WELDING_DYNAMICS_OTHER_MATERIAL_GROUP_KEY,
    getMaterialGroupLabel,
  )
}

function buildProjectGroupLayout(totals: Map<string, number>) {
  return buildDimensionGroupLayout(
    totals,
    WELDING_DYNAMICS_MISSING_PROJECT_GROUP_KEY,
    WELDING_DYNAMICS_OTHER_PROJECT_GROUP_KEY,
    getProjectGroupLabel,
  )
}

function buildDimensionGroupLayout(
  totals: Map<string, number>,
  missingKey: string,
  otherKey: string,
  getLabel: (key: string) => string,
): DimensionGroupLayout {
  const entries = Array.from(totals.entries())
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ key, label: getLabel(key), value }))
  const missing = entries.find((entry) => entry.key === missingKey)
  const named = entries
    .filter((entry) => entry.key !== missingKey)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'ru', { numeric: true }))
  const totalValue = named.reduce((total, entry) => total + entry.value, 0)
  const significant = named.filter((entry) => totalValue <= 0 || entry.value / totalValue >= 0.03)
  const retained = named.length <= MAX_SEPARATE_DIMENSION_GROUPS
    ? named
    : (significant.length > 0 ? significant : named).slice(0, MAX_SEPARATE_DIMENSION_GROUPS)
  const retainedKeys = new Set(retained.map((entry) => entry.key))
  const collapsed = named.filter((entry) => !retainedKeys.has(entry.key))
  const collapsedKeys = new Set(collapsed.map((entry) => entry.key))
  const collapsedValue = collapsed.reduce((total, entry) => total + entry.value, 0)
  const groups: WeldingDynamicsMaterialGroup[] = [
    ...retained,
    ...(collapsedValue > 0 ? [{ key: otherKey, label: 'Прочие', value: collapsedValue }] : []),
    ...(missing ? [missing] : []),
  ]
  return { groups, retainedKeys, collapsedKeys }
}

function buildBucketMaterialGroups(
  values: Map<string, number>,
  layout: DimensionGroupLayout,
): WeldingDynamicsMaterialGroup[] {
  return buildBucketDimensionGroups(values, layout, WELDING_DYNAMICS_OTHER_MATERIAL_GROUP_KEY)
}

function buildBucketProjectGroups(
  values: Map<string, number>,
  layout: DimensionGroupLayout,
): WeldingDynamicsProjectGroup[] {
  return buildBucketDimensionGroups(values, layout, WELDING_DYNAMICS_OTHER_PROJECT_GROUP_KEY)
}

function buildBucketDimensionGroups(
  values: Map<string, number>,
  layout: DimensionGroupLayout,
  otherKey: string,
) {
  return layout.groups.flatMap((group) => {
    const value = group.key === otherKey
      ? Array.from(layout.collapsedKeys).reduce((total, key) => total + (values.get(key) ?? 0), 0)
      : values.get(group.key) ?? 0
    return value > 0 ? [{ ...group, value }] : []
  })
}

function addGroupJointTypeValue(
  target: Map<string, Map<WeldingDynamicsJointTypeKey, number>>,
  materialGroupKey: string,
  jointTypeKey: WeldingDynamicsJointTypeKey,
  value: number,
) {
  const jointTypes = target.get(materialGroupKey) ?? new Map<WeldingDynamicsJointTypeKey, number>()
  jointTypes.set(jointTypeKey, (jointTypes.get(jointTypeKey) ?? 0) + value)
  target.set(materialGroupKey, jointTypes)
}

function buildJointTypes(
  values: Map<WeldingDynamicsJointTypeKey, number>,
  systemIndexSettings: SystemIndexSettings,
  includeKnownEmptyTypes = false,
): WeldingDynamicsJointType[] {
  const jointTypes: WeldingDynamicsJointType[] = []
  for (const key of WELDING_DYNAMICS_JOINT_TYPE_ORDER) {
    const value = values.get(key) ?? 0
    if (value <= 0 && !(includeKnownEmptyTypes && (key === 's' || key === 'f'))) continue
    if (key === 'f') {
      jointTypes.push({ key, code: systemIndexSettings.fieldJoint, label: `${systemIndexSettings.fieldJoint} · поле`, value })
      continue
    }
    if (key === 's') {
      jointTypes.push({ key, code: systemIndexSettings.shopJoint, label: `${systemIndexSettings.shopJoint} · база`, value })
      continue
    }
    jointTypes.push({ key, code: '—', label: 'Тип не определен', value })
  }
  return jointTypes
}

function buildMaterialJointTypeGroups(
  values: Map<string, Map<WeldingDynamicsJointTypeKey, number>>,
  layout: DimensionGroupLayout,
  systemIndexSettings: SystemIndexSettings,
  welderParticipation: GroupWelderParticipation,
): WeldingDynamicsMaterialJointTypeGroup[] {
  return buildDimensionJointTypeGroups(
    values,
    layout,
    systemIndexSettings,
    welderParticipation,
    WELDING_DYNAMICS_OTHER_MATERIAL_GROUP_KEY,
  )
}

function buildProjectJointTypeGroups(
  values: Map<string, Map<WeldingDynamicsJointTypeKey, number>>,
  layout: DimensionGroupLayout,
  systemIndexSettings: SystemIndexSettings,
  welderParticipation: GroupWelderParticipation,
): WeldingDynamicsProjectJointTypeGroup[] {
  return buildDimensionJointTypeGroups(
    values,
    layout,
    systemIndexSettings,
    welderParticipation,
    WELDING_DYNAMICS_OTHER_PROJECT_GROUP_KEY,
  )
}

function buildDimensionJointTypeGroups(
  values: Map<string, Map<WeldingDynamicsJointTypeKey, number>>,
  layout: DimensionGroupLayout,
  systemIndexSettings: SystemIndexSettings,
  welderParticipation: GroupWelderParticipation,
  otherKey: string,
) {
  return layout.groups.flatMap((group) => {
    const jointTypeValues = new Map<WeldingDynamicsJointTypeKey, number>()
    const sourceKeys = group.key === otherKey
      ? Array.from(layout.collapsedKeys)
      : [group.key]
    for (const sourceKey of sourceKeys) {
      const sourceValues = values.get(sourceKey)
      if (!sourceValues) continue
      for (const [jointTypeKey, value] of sourceValues) {
        jointTypeValues.set(jointTypeKey, (jointTypeValues.get(jointTypeKey) ?? 0) + value)
      }
    }
    const jointTypes = buildJointTypes(jointTypeValues, systemIndexSettings)
    const value = jointTypes.reduce((total, jointType) => total + jointType.value, 0)
    const participation = summarizeGroupWelderParticipation(welderParticipation, sourceKeys)
    return value > 0
      ? [{
          ...group,
          value,
          jointTypes,
          welderCount: participation.welderCount,
          welderShiftCount: participation.welderShiftCount,
          valuePerWelderShift: divideOrZero(value, participation.welderShiftCount),
        }]
      : []
  })
}

type GroupWelderParticipation = Map<string, Map<string, Set<string>>>

function addGroupWelderParticipation(
  target: GroupWelderParticipation,
  groupKey: string,
  date: string,
  stamps: ReadonlySet<string>,
) {
  if (stamps.size === 0) return
  const dates = target.get(groupKey) ?? new Map<string, Set<string>>()
  const dateStamps = dates.get(date) ?? new Set<string>()
  for (const stamp of stamps) dateStamps.add(stamp)
  dates.set(date, dateStamps)
  target.set(groupKey, dates)
}

function summarizeGroupWelderParticipation(
  participation: GroupWelderParticipation,
  sourceKeys: readonly string[],
) {
  const stampsByDate = new Map<string, Set<string>>()
  const allStamps = new Set<string>()
  for (const sourceKey of sourceKeys) {
    for (const [date, stamps] of participation.get(sourceKey) ?? []) {
      const dateStamps = stampsByDate.get(date) ?? new Set<string>()
      for (const stamp of stamps) {
        dateStamps.add(stamp)
        allStamps.add(stamp)
      }
      stampsByDate.set(date, dateStamps)
    }
  }
  return {
    welderCount: allStamps.size,
    welderShiftCount: Array.from(stampsByDate.values()).reduce((total, stamps) => total + stamps.size, 0),
  }
}

function getWeldingDynamicsJointTypeKey(
  row: WeldRow,
  systemIndexSettings: SystemIndexSettings,
): WeldingDynamicsJointTypeKey {
  const baseJoint = parseJointChainName(String(row.joint ?? ''), systemIndexSettings).base.trim().toUpperCase()
  return getConfiguredBaseJointType(baseJoint, systemIndexSettings) ?? 'unknown'
}

function getMaterialGroupKey(value: unknown) {
  return String(value ?? '').trim() || WELDING_DYNAMICS_MISSING_MATERIAL_GROUP_KEY
}

function getMaterialGroupLabel(key: string) {
  return key === WELDING_DYNAMICS_MISSING_MATERIAL_GROUP_KEY ? 'Не указано' : key
}

function getProjectGroupKey(value: unknown) {
  return String(value ?? '').trim() || WELDING_DYNAMICS_MISSING_PROJECT_GROUP_KEY
}

function getProjectGroupLabel(key: string) {
  return key === WELDING_DYNAMICS_MISSING_PROJECT_GROUP_KEY ? 'Не указан' : key
}

function getBucketKey(date: string, from: string, unit: WeldingDynamicsUnit) {
  if (unit === 'day') return date
  const parsed = parseIsoDate(date)
  if (unit === 'week') {
    const offset = Math.floor(getDaysBetween(parseIsoDate(from), parsed) / 7) * 7
    return formatDateInputValue(addDays(parseIsoDate(from), offset))
  }
  if (unit === 'month') return date.slice(0, 7)
  if (unit === 'quarter') {
    const quarter = Math.floor(parsed.getUTCMonth() / 3) + 1
    return `${parsed.getUTCFullYear()}-Q${quarter}`
  }
  return String(parsed.getUTCFullYear())
}

function getFactualStamps(row: WeldRow) {
  const stamps = new Set<string>()
  for (const key of FACTUAL_STAMP_KEYS) {
    const value = String(row[key] ?? '').trim()
    if (value) stamps.add(value)
  }
  return stamps
}

function getWdiValue(row: WeldRow) {
  const value = Number(String(row.wdi ?? '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function getBucketUnitLabel(unit: WeldingDynamicsUnit) {
  if (unit === 'day') return 'день'
  if (unit === 'week') return 'неделя'
  if (unit === 'month') return 'месяц'
  if (unit === 'quarter') return 'квартал'
  return 'год'
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1))
}

function getDaysBetween(from: Date, to: Date) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY))
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

function addYears(date: Date, years: number) {
  const next = new Date(date)
  next.setUTCFullYear(next.getUTCFullYear() + years)
  return next
}

function minDate(a: Date, b: Date) {
  return a.getTime() <= b.getTime() ? a : b
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function startOfQuarter(date: Date) {
  const month = Math.floor(date.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(date.getUTCFullYear(), month, 1))
}

function startOfYear(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
}

function formatDayLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}.${month}`
}

function formatShortDayLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}.${month}`
}

function formatMonthLabel(date: Date) {
  return `${pad(date.getUTCMonth() + 1)}.${String(date.getUTCFullYear()).slice(2)}`
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}
