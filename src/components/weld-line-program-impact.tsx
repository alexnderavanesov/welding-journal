import { useMutation } from '@tanstack/react-query'
import type { WeldInput } from '@/lib/weld-fields'
import { getProgramImpactInput } from '@/lib/line-program-card-impact'
import { getWeldLineProgramImpact } from '@/server/line-program-card-impact'

export function WeldLineProgramImpact({ draft }: { draft: WeldInput }) {
  const input = getProgramImpactInput(draft), key = JSON.stringify(input)
  const preview = useMutation({ mutationFn: async () => ({ key, value: await getWeldLineProgramImpact({ data: input }) }) })
  const value = preview.data?.key === key ? preview.data.value : null
  return <div className="mt-2 text-xs text-slate-600">
    <button type="button" disabled={preview.isPending} onClick={() => preview.mutate()} className="rounded px-1 py-1 text-sky-700 hover:bg-sky-50 disabled:opacity-50">{preview.isPending ? 'Проверяем влияние…' : 'Влияние изменений на линию'}</button>
    {value ? <p role="status">К назначению: {value.before.missing} → {value.after.missing}; лишнее: {value.before.excess} → {value.after.excess}. {value.after.missing < value.before.missing ? 'Изменение закрывает недобор. ' : ''}{value.after.excess > value.before.excess ? 'Появятся лишние назначения. ' : ''}Предварительный расчёт; ничего не сохранено.</p> : null}
    {preview.data && !value ? <p>Черновик изменён — пересчитайте влияние.</p> : null}
    {preview.error ? <p role="alert">{preview.error.message}</p> : null}
  </div>
}
