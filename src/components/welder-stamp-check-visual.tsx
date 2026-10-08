import { Fragment, type ReactNode } from 'react'
import { explainStampCheckExample, type StampCheckDimensionField, type StampCheckExample } from '@/lib/welder-stamp-check-explanation'

type CheckOwner = 'a' | 'b' | 'both' | 'unused'
const OWNER_STYLES: Record<CheckOwner, string> = {
  a: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  b: 'border-amber-200 bg-amber-50 text-amber-900',
  both: 'border-violet-200 bg-violet-50 text-violet-900',
  unused: 'border-slate-200 bg-slate-100 text-slate-600',
}
const OWNER_LABELS: Record<CheckOwner, string> = {
  a: 'Проверяется у А', b: 'Проверяется у Б', both: 'Проверяется отдельно у А и у Б', unused: 'Не участвует в проверке размеров',
}

export function StampCheckBadge({ owner, children, fields }: { owner: CheckOwner; children: ReactNode; fields?: StampCheckDimensionField[] }) {
  return <span data-check-owner={owner} data-check-fields={fields?.join(' ')} title={OWNER_LABELS[owner]} className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium leading-5 ${OWNER_STYLES[owner]}`}>
    <span className="sr-only">{OWNER_LABELS[owner]}: </span>{children}
  </span>
}

export function StampCheckColorLegend() {
  return <div aria-label="Цветовые обозначения примеров" className="mt-3 space-y-2 border-t border-slate-200 pt-3">
    <div className="flex flex-wrap gap-2">
      <StampCheckBadge owner="a">А · сварщик А</StampCheckBadge>
      <StampCheckBadge owner="b">Б · сварщик Б</StampCheckBadge>
      <StampCheckBadge owner="both">А + Б · у каждого отдельно</StampCheckBadge>
      <StampCheckBadge owner="unused">Не проверяется</StampCheckBadge>
    </div>
    <p className="text-xs leading-5">Цвет обозначает, у кого проверяется параметр, а не «годен / не годен». Фиолетовый — не общий допуск команды. Варианты через «ИЛИ» остаются равноправными.</p>
  </div>
}

function Dimension({ fields, alternatives, example, owner }: {
  fields: StampCheckDimensionField[]; alternatives: boolean; example: StampCheckExample; owner: CheckOwner
}) {
  if (!alternatives) return <StampCheckBadge owner={owner} fields={fields}>{fields.map(field => field.toUpperCase()).join(' = ')} = {example[fields[0]]}</StampCheckBadge>
  return <span className="inline-flex flex-wrap items-center gap-1" data-check-alternatives>
    <span className="text-slate-500">(</span>{fields.map((field, index) => <Fragment key={field}>
    {index > 0 ? <span className="text-xs font-semibold text-slate-600">ИЛИ</span> : null}
    <StampCheckBadge owner={owner} fields={[field]}>{field.toUpperCase()} = {example[field]}</StampCheckBadge>
  </Fragment>)}<span className="text-slate-500">)</span></span>
}

/** A visual explanation of requirements, never a verdict on real qualifications. */
export function WelderStampCheckVisual({ example }: { example: StampCheckExample }) {
  const explanation = explainStampCheckExample(example)
  if (explanation.errors.length) return null
  const owner = example.stampCount === 1 ? 'a' : 'both'
  const used = new Set(explanation.scopes.flatMap(scope => [...scope.diameterFields, ...scope.thicknessFields]))
  const unused = (['d1', 't1', 'd2', 't2'] as const).filter(field => !used.has(field))
  const material = example.group1 === example.group2 ? example.group1 : `${example.group1} + ${example.group2}`
  return <div data-stamp-check-visual className="space-y-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="font-semibold text-slate-900">{example.connectionType} · {material} · {example.d1}×{example.t1} + {example.d2}×{example.t2}</p>
      <div className="flex flex-wrap gap-1">{explanation.welders.map((welder, index) => <StampCheckBadge key={welder.name} owner={index === 0 ? 'a' : 'b'}>{index === 0 ? 'А' : 'Б'} · {welder.methods.replace('+', ' + ')}</StampCheckBadge>)}</div>
    </div>
    <div className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2">
      <p className="text-xs font-semibold text-slate-600">{owner === 'both' ? 'А + Б: у каждого отдельно' : 'У сварщика А'} · мм</p>
      {explanation.scopes.map((scope, index) => <div key={scope.group} data-check-scope className="flex flex-wrap items-center gap-1.5">
          {index > 0 ? <span className="text-xs font-bold text-slate-600">И<span className="sr-only"> другая группа:</span></span> : null}
          <StampCheckBadge owner={owner}>{scope.group}</StampCheckBadge>
          <span aria-hidden="true" className="text-slate-400">→</span>
          <Dimension fields={scope.diameterFields} alternatives={scope.alternatives} example={example} owner={owner} />
          <span className="text-xs font-bold text-slate-600">И</span>
          <Dimension fields={scope.thicknessFields} alternatives={scope.alternatives} example={example} owner={owner} />
      </div>)}
      {unused.length ? <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-1.5">
        <span className="text-xs text-slate-500">Не проверяются:</span>
        {unused.map(field => <StampCheckBadge key={field} owner="unused" fields={[field]}>{field.toUpperCase()} = {example[field]}</StampCheckBadge>)}
      </div> : null}
    </div>
  </div>
}
