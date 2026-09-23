import { sql, type SQL } from 'drizzle-orm'

import { duplicateControls, weldJoints } from '@/db/schema'
import type {
  OtherSettings,
  WdiConnectionCalculationRule,
  WdiTableSettings,
} from '@/lib/other-settings'

const WDI_DIAMETER = sql.raw('"current_wdi_dimensions"."diameter"')
const WDI_THICKNESS = sql.raw('"current_wdi_dimensions"."thickness"')

export function buildAcceptedWdiTotalQuery(
  where: SQL | undefined,
  settings: OtherSettings,
) {
  const acceptedWhere = sql`
    (${where ?? sql`true`})
    and lower(btrim(coalesce(${weldJoints.finalStatus}, ''))) = 'годен'
    and not exists (
      select 1
      from ${duplicateControls}
      where ${duplicateControls.weldJointId} = ${weldJoints.id}
        and lower(btrim(coalesce(${duplicateControls.result}, ''))) in ('ремонт', 'вырез')
    )
  `

  if (settings.wdiCalculationMode === 'manual' || !settings.wdiTable && settings.wdiCalculationMode === 'table') {
    return sql`
      select coalesce(sum(coalesce(${weldJoints.wdi}, 0)), 0)::text as "total"
      from ${weldJoints}
      where ${acceptedWhere}
    `
  }

  const diameter = buildCurrentWdiDiameter(settings)
  if (settings.wdiCalculationMode === 'formula') {
    return sql`
      select coalesce(sum(
        case
          when ${WDI_DIAMETER} is null then 0
          else round(${WDI_DIAMETER} / 25.4, 2)
        end
      ), 0)::text as "total"
      from ${weldJoints}
      cross join lateral (
        select ${diameter} as "diameter"
      ) as "current_wdi_dimensions"
      where ${acceptedWhere}
    `
  }

  const thickness = buildCurrentWdiThickness(settings)
  const tableValue = buildWdiTableValue(settings.wdiTable!)
  return sql`
    select coalesce(sum(coalesce(round(${tableValue}, 2), 0)), 0)::text as "total"
    from ${weldJoints}
    cross join lateral (
      select
        ${diameter} as "diameter",
        ${thickness} as "thickness"
    ) as "current_wdi_dimensions"
    where ${acceptedWhere}
  `
}

function buildCurrentWdiDiameter(settings: OtherSettings) {
  const branch = buildSelectedDiameter(settings.wdiCalculationRules.branch)
  const other = buildSelectedDiameter(settings.wdiCalculationRules.other)
  return sql<number | null>`case
    when upper(btrim(coalesce(${weldJoints.connectionType}, ''))) like 'У%'
      then ${branch}
    else ${other}
  end`
}

function buildCurrentWdiThickness(settings: OtherSettings) {
  const branch = buildSelectedThickness(settings.wdiCalculationRules.branch)
  const other = buildSelectedThickness(settings.wdiCalculationRules.other)
  return sql<number | null>`case
    when upper(btrim(coalesce(${weldJoints.connectionType}, ''))) like 'У%'
      then ${branch}
    else ${other}
  end`
}

function buildSelectedDiameter(rule: WdiConnectionCalculationRule) {
  const d1 = positiveNumber(weldJoints.d1)
  const d2 = positiveNumber(weldJoints.d2)
  return rule.diameter === 'min'
    ? sql<number | null>`least(${d1}, ${d2})`
    : sql<number | null>`greatest(${d1}, ${d2})`
}

function buildSelectedThickness(rule: WdiConnectionCalculationRule) {
  const d1 = positiveNumber(weldJoints.d1)
  const d2 = positiveNumber(weldJoints.d2)
  const t1 = positiveNumber(weldJoints.t1)
  const t2 = positiveNumber(weldJoints.t2)
  if (rule.thickness === 'min') return sql<number | null>`least(${t1}, ${t2})`
  if (rule.thickness === 'max') return sql<number | null>`greatest(${t1}, ${t2})`

  const equalThickness = rule.equalDiameterThickness === 'min'
    ? sql<number | null>`least(${t1}, ${t2})`
    : sql<number | null>`greatest(${t1}, ${t2})`
  const firstDiameterSelected = rule.diameter === 'min'
    ? sql`${d1} < ${d2}`
    : sql`${d1} > ${d2}`
  return sql<number | null>`case
    when ${d1} is null then case when ${d2} is not null then ${t2} else null end
    when ${d2} is null then ${t1}
    when ${d1} = ${d2} then ${equalThickness}
    when ${firstDiameterSelected} then ${t1}
    else ${t2}
  end`
}

function buildWdiTableValue(table: WdiTableSettings) {
  const clauses: SQL[] = []
  for (let diameterIndex = table.diameters.length - 1; diameterIndex >= 0; diameterIndex -= 1) {
    for (let thicknessIndex = table.thicknesses.length - 1; thicknessIndex >= 0; thicknessIndex -= 1) {
      const value = table.values[diameterIndex]?.[thicknessIndex]
      clauses.push(sql`
        when ${WDI_DIAMETER} >= ${table.diameters[diameterIndex]}
          and ${WDI_THICKNESS} >= ${table.thicknesses[thicknessIndex]}
          then ${value === null || value === undefined ? sql`null::numeric` : sql`${value}::numeric`}
      `)
    }
  }
  return sql<number | null>`case ${sql.join(clauses, sql` `)} else null::numeric end`
}

function positiveNumber(column: typeof weldJoints.d1) {
  return sql<number | null>`case when ${column} > 0 then ${column}::numeric else null::numeric end`
}
