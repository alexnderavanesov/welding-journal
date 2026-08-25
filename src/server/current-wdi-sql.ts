import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import type {
  OtherSettings,
  WdiConnectionCalculationRule,
} from '@/lib/other-settings'

type CurrentWdiSqlColumns = {
  connectionType: SQLWrapper
  d1: SQLWrapper
  d2: SQLWrapper
  t1: SQLWrapper
  t2: SQLWrapper
  wdi: SQLWrapper
}

export function buildCurrentWdiSqlExpression(
  settings: OtherSettings,
  columns: CurrentWdiSqlColumns,
): SQL<number | null> {
  if (settings.wdiCalculationMode === 'manual') {
    return sql<number | null>`${columns.wdi}`
  }

  const diameter = buildRuleAwareDimensionExpression(
    columns,
    settings.wdiCalculationRules,
    (rule) => buildDiameterExpression(columns, rule),
  )
  if (settings.wdiCalculationMode === 'formula') {
    return sql<number | null>`round(${diameter} / 25.4, 2)`
  }

  const table = settings.wdiTable
  if (!table || table.diameters.length === 0 || table.thicknesses.length === 0) {
    return sql<number | null>`null::numeric`
  }
  const thickness = buildRuleAwareDimensionExpression(
    columns,
    settings.wdiCalculationRules,
    (rule) => buildThicknessExpression(columns, rule),
  )
  const diameterBoundaries = buildNumericSqlArray(table.diameters)
  const thicknessBoundaries = buildNumericSqlArray(table.thicknesses)
  const flatValues = buildNumericSqlArray(
    table.diameters.flatMap((_, diameterIndex) =>
      table.thicknesses.map((__, thicknessIndex) =>
        table.values[diameterIndex]?.[thicknessIndex] ?? null,
      ),
    ),
  )
  const thicknessCount = table.thicknesses.length

  return sql<number | null>`(
    select round(
      (${flatValues})[
        (("diameter_boundary"."position" - 1) * ${thicknessCount}
          + "thickness_boundary"."position")::integer
      ],
      2
    )
    from unnest(${diameterBoundaries}) with ordinality
      as "diameter_boundary"("value", "position")
    cross join unnest(${thicknessBoundaries}) with ordinality
      as "thickness_boundary"("value", "position")
    where "diameter_boundary"."value" <= ${diameter}
      and "thickness_boundary"."value" <= ${thickness}
    order by
      "diameter_boundary"."position" desc,
      "thickness_boundary"."position" desc
    limit 1
  )`
}

function buildRuleAwareDimensionExpression(
  columns: CurrentWdiSqlColumns,
  rules: OtherSettings['wdiCalculationRules'],
  buildForRule: (rule: WdiConnectionCalculationRule) => SQL<number | null>,
) {
  return sql<number | null>`case
    when upper(btrim(coalesce(${columns.connectionType}, ''))) like 'У%'
      then ${buildForRule(rules.branch)}
    else ${buildForRule(rules.other)}
  end`
}

function buildDiameterExpression(
  columns: CurrentWdiSqlColumns,
  rule: WdiConnectionCalculationRule,
) {
  const d1 = positiveNumber(columns.d1)
  const d2 = positiveNumber(columns.d2)
  const both = rule.diameter === 'min'
    ? sql<number>`least(${d1}, ${d2})`
    : sql<number>`greatest(${d1}, ${d2})`
  return sql<number | null>`case
    when ${d1} is null then ${d2}
    when ${d2} is null then ${d1}
    else ${both}
  end`
}

function buildThicknessExpression(
  columns: CurrentWdiSqlColumns,
  rule: WdiConnectionCalculationRule,
) {
  const d1 = positiveNumber(columns.d1)
  const d2 = positiveNumber(columns.d2)
  const t1 = positiveNumber(columns.t1)
  const t2 = positiveNumber(columns.t2)
  if (rule.thickness !== 'linked') {
    return buildIndependentValueExpression(t1, t2, rule.thickness)
  }

  const equalDiameterThickness = buildIndependentValueExpression(
    t1,
    t2,
    rule.equalDiameterThickness,
  )
  const selectedThickness = rule.diameter === 'min'
    ? sql<number | null>`case when ${d1} < ${d2} then ${t1} else ${t2} end`
    : sql<number | null>`case when ${d1} > ${d2} then ${t1} else ${t2} end`
  return sql<number | null>`case
    when ${d1} is null then ${t2}
    when ${d2} is null then ${t1}
    when ${d1} = ${d2} then ${equalDiameterThickness}
    else ${selectedThickness}
  end`
}

function buildIndependentValueExpression(
  first: SQL<number | null>,
  second: SQL<number | null>,
  selection: 'min' | 'max',
) {
  const both = selection === 'min'
    ? sql<number>`least(${first}, ${second})`
    : sql<number>`greatest(${first}, ${second})`
  return sql<number | null>`case
    when ${first} is null then ${second}
    when ${second} is null then ${first}
    else ${both}
  end`
}

function positiveNumber(column: SQLWrapper) {
  return sql<number | null>`case when ${column} > 0 then ${column} else null end`
}

function buildNumericSqlArray(values: Array<number | null>) {
  const items = values.map((value) => value === null ? sql`null` : sql`${value}`)
  return sql`array[${sql.join(items, sql`, `)}]::numeric[]`
}
