import { Info } from 'lucide-react'
import { WelderStampCheckExample } from './welder-stamp-check-example'
import { StampCheckColorLegend, WelderStampCheckVisual } from './welder-stamp-check-visual'
import { type StampCheckExample } from '@/lib/welder-stamp-check-explanation'

type CheckScenario = {
  stamps: 1 | 2
  combined: boolean
  sample: [type: 'С17' | 'У19', group1: string, group2: string, d1: number, t1: number, d2: number, t2: number]
  result: string
}

function scenarioExample(scenario: CheckScenario): StampCheckExample {
  const [connectionType, group1, group2, d1, t1, d2, t2] = scenario.sample
  return { connectionType, group1, group2, d1: String(d1), t1: String(t1), d2: String(d2), t2: String(t2),
    stampCount: scenario.stamps, weldingMethod: scenario.combined ? 'РАД+РД' : scenario.stamps === 1 ? 'РАД' : 'РД', methodA: 'РАД', methodB: 'РД' }
}
const CHECK_GROUPS: Array<{ id: string; title: string; materials: string; checks: string[]; note: string; scenarios: CheckScenario[] }> = [
  {
    id: 'homogeneous-c', title: 'С-стык · например С17', materials: 'Одна группа',
    checks: ['Диаметр: D1 ИЛИ D2', 'Толщина: T1 ИЛИ T2'],
    note: 'Должны пройти обе проверки: хотя бы один диаметр И хотя бы одна толщина. D и T могут относиться к разным сторонам.',
    scenarios: [
      { stamps: 1, combined: false, sample: ['С17', 'М01', 'М01', 108, 4, 108, 6], result: 'А, РАД: проверяется D = 108 и T1 = 4 или T2 = 6. Допуска на D108 и T4 достаточно.' },
      { stamps: 2, combined: false, sample: ['С17', 'М05', 'М05', 159, 6, 159, 8], result: 'А и Б, РД: каждый проверяется на D159 и хотя бы одну из T6/T8. А может покрывать T6, Б — T8.' },
      { stamps: 1, combined: true, sample: ['С17', 'М01', 'М01', 219, 8, 219, 10], result: 'А имеет РАД и РД на М01. Для D219 и хотя бы одной из T8/T10 подходят его допуски в совокупности: например, D по РД, T8 по РАД.' },
      { stamps: 2, combined: true, sample: ['С17', 'М11', 'М11', 325, 10, 325, 12], result: 'А — РАД, Б — РД; у обоих М11. Каждый покрывает D325 и хотя бы одну из T10/T12 своими допусками.' },
    ],
  },
  {
    id: 'homogeneous-u', title: 'У-стык · например У19', materials: 'Одна группа',
    checks: ['Если D1 < D2 → D1 И T1', 'Если D2 < D1 → D2 И T2', 'Если D1 = D2 → общий D И меньшая T'],
    note: 'При разных диаметрах толщина берётся с той же стороны, что и меньший диаметр. Отдельно минимальную толщину не выбираем.',
    scenarios: [
      { stamps: 1, combined: false, sample: ['У19', 'М01', 'М01', 57, 6, 159, 3], result: 'А, РАД: D1 = 57 и T1 = 6. D2 = 159 и T2 = 3 не участвуют. Допуска только на 57×3 недостаточно.' },
      { stamps: 2, combined: false, sample: ['У19', 'М05', 'М05', 219, 8, 89, 12], result: 'А и Б, РД: каждый покрывает D2 = 89 и T2 = 12. D1 = 219 и T1 = 8 не участвуют.' },
      { stamps: 1, combined: true, sample: ['У19', 'М01', 'М01', 159, 6, 159, 3], result: 'А имеет РАД и РД на М01. Диаметры равны: проверяется общий D159 и T2 = 3. T1 = 6 не участвует.' },
      { stamps: 2, combined: true, sample: ['У19', 'М11', 'М11', 32, 4, 108, 6], result: 'А — РАД, Б — РД; у обоих М11. Каждый покрывает D1 = 32 и T1 = 4. Размеры второго сварщика не дополняют допуски первого.' },
    ],
  },
  {
    id: 'dissimilar', title: 'Разнородный С- или У-стык', materials: 'Две группы',
    checks: ['Группа 1 → D1 И T1', 'Группа 2 → D2 И T2'],
    note: 'Проверяются обе стороны у каждого сварщика, даже если диаметры равны. Правила «достаточно одного размера» и «меньшая сторона» здесь не применяются.',
    scenarios: [
      { stamps: 1, combined: false, sample: ['С17', 'М01', 'М05', 108, 6, 108, 8], result: 'А, РАД: М01 на D1 = 108, T1 = 6 И М05 на D2 = 108, T2 = 8. Обе группы нужны на РАД.' },
      { stamps: 2, combined: false, sample: ['У19', 'М05', 'М01', 57, 6, 159, 3], result: 'А и Б, РД: каждый покрывает М05 на D1 = 57, T1 = 6 И М01 на D2 = 159, T2 = 3. Нельзя разделить группы между А и Б.' },
      { stamps: 1, combined: true, sample: ['С17', 'М01', 'М11', 159, 8, 159, 10], result: 'А: РАД на обе группы и РД на обе группы. Собственные допуски покрывают М01 на D1 = 159, T1 = 8 И М11 на D2 = 159, T2 = 10.' },
      { stamps: 2, combined: true, sample: ['У19', 'М05', 'М11', 219, 8, 89, 12], result: 'А — РАД на обе группы, Б — РД на обе группы. Каждый покрывает М05 на D1 = 219, T1 = 8 И М11 на D2 = 89, T2 = 12.' },
    ],
  },
]

export function WelderStampCheckParameters() {
  return (
    <section aria-labelledby="stamp-check-heading" className="min-w-0 space-y-5">
      <div>
        <h2 id="stamp-check-heading" className="text-lg font-semibold text-slate-900">Как проверяется допуск клейма</h2>
        <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">Сначала определяем, какие размеры нужны для выбранного соединения. Затем проверяем их у каждого уникального официального клейма по подходящим допускам НАКС и, когда требуется, ДЛС.</p>
      </div>

      <WelderStampCheckExample />

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
        <p><strong className="text-slate-800">Как читать таблицу:</strong> D1/T1 — диаметр и толщина материала 1, D2/T2 — материала 2. Все размеры в миллиметрах. А и Б — разные сварщики.</p>
        <p className="mt-1"><strong className="text-slate-800">И</strong> — нужны оба параметра. <strong className="text-slate-800">ИЛИ</strong> — достаточно одного из перечисленных. При двух клеймах весь набор проверяется <strong className="text-slate-800">отдельно у А и отдельно у Б</strong>.</p>
        <StampCheckColorLegend />
      </div>

      <div role="region" aria-label="Таблица параметров проверки клейм" className="min-w-0 rounded-lg border border-slate-200 bg-white">
        <table className="block w-full border-separate border-spacing-0 text-left text-sm leading-6 xl:table xl:table-fixed">
          <caption className="sr-only">Проверка клейм по типу соединения, материалам, количеству сварщиков и способам сварки</caption>
          <colgroup className="hidden xl:table-column-group"><col className="w-[17%]" /><col className="w-[38%]" /><col className="w-[45%]" /></colgroup>
          <thead className="sticky top-14 z-20 hidden bg-slate-100 text-xs text-slate-700 xl:table-header-group">
            <tr>{['Сварщики и способ', 'Какие параметры проверяются', 'Пример'].map(label => <th key={label} scope="col" className="border-b border-slate-200 px-4 py-3 font-semibold">{label}</th>)}</tr>
          </thead>
          {CHECK_GROUPS.map(group => (
            <tbody key={group.id} aria-labelledby={'stamp-check-' + group.id} className="block xl:table-row-group">
              <tr className="block xl:table-row"><th id={'stamp-check-' + group.id} scope="rowgroup" colSpan={3} className="block border-b border-sky-100 bg-sky-50 px-4 py-3 font-normal xl:table-cell">
                <div className="flex flex-wrap items-center gap-3"><span className="font-semibold text-sky-950">{group.title}</span><span className="rounded border border-sky-200 bg-white px-2 text-xs font-medium text-sky-800">{group.materials}</span></div>
              </th></tr>
              {group.scenarios.map(scenario => (
                <tr key={scenario.stamps + '-' + scenario.combined} data-stamp-check-scenario className="block border-b border-slate-200 last:border-b-0 xl:table-row">
                  <th scope="row" className="block px-4 pb-2 pt-4 align-top font-normal xl:table-cell xl:border-b xl:border-slate-200 xl:py-4">
                    <span className="font-semibold text-slate-900">{scenario.stamps === 1 ? '1 клеймо · А' : '2 клейма · А и Б'}</span>
                    <span className="mt-1 block text-slate-700">{scenario.combined ? 'РАД + РД' : 'РАД или РД'}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{scenario.combined ? 'Комбинированный' : 'Один способ'}</span>
                    {scenario.combined ? <p className="mt-2 text-xs leading-5 text-slate-500">{scenario.stamps === 1 ? 'Оба способа у А.' : 'У каждого хотя бы один способ; вместе — оба.'}</p> : null}
                  </th>
                  <td className="block px-4 py-3 align-top text-slate-700 xl:table-cell xl:border-b xl:border-slate-200 xl:py-4">
                    <span className="mb-2 block text-xs font-semibold text-slate-500 xl:hidden">Какие параметры проверяются</span>
                    <div className="stamp-check-rules-container">
                      <div className="stamp-check-rules-layout grid gap-x-4 gap-y-2" data-stamp-check-rules>
                        <div data-stamp-check-conditions>
                          <p className="mb-2 text-xs font-semibold text-sky-800">{scenario.stamps === 1 ? 'У сварщика А' : 'У каждого: А и Б'}</p>
                          <ul className="space-y-1">{group.checks.map(check => <li key={check} className="font-semibold text-slate-900">{check}</li>)}</ul>
                        </div>
                        <div className="space-y-2 text-xs leading-5 text-slate-600" data-stamp-check-notes>
                          <p>{group.note}</p>
                          <p>{group.id === 'dissimilar' ? 'Обе группы нужны по каждому участвующему способу сварщика.' : 'Группа стыка нужна по каждому участвующему способу сварщика.'} {scenario.combined ? 'Его собственные подходящие допуски можно объединять по размерам.' : 'Допуски другого способа не участвуют.'}</p>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="block bg-slate-50/70 px-4 py-4 align-top text-slate-700 xl:table-cell xl:border-b xl:border-l xl:border-slate-200">
                    <span className="mb-2 block text-xs font-semibold text-slate-500 xl:hidden">Пример</span>
                    <WelderStampCheckVisual example={scenarioExample(scenario)} />
                    <p className="mt-3 text-xs leading-5">{scenario.result}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <aside aria-label="Важно при проверке клейм" className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Info aria-hidden="true" className="h-4 w-4 text-sky-700" />Что ещё важно</h3>
        <ul className="mt-3 grid list-disc gap-x-8 gap-y-3 pl-5 text-sm leading-6 text-slate-600 lg:grid-cols-2">
          <li><strong className="text-slate-800">Группы привязаны к сторонам.</strong> М01 + М05 и М05 + М01 — разные условия проверки. Одна группа относится к обеим сторонам.</li>
          <li><strong className="text-slate-800">Клейма считаются без повторов.</strong> Одно клеймо в корне, заполнении и облицовке — один сварщик. Номер поля не назначает ему РАД или РД автоматически.</li>
          <li><strong className="text-slate-800">Диапазоны не складываются арифметически.</strong> Два допуска до 3 мм не дают допуск до 6 мм. D и T могут покрываться разными подходящими допусками одного сварщика.</li>
          <li><strong className="text-slate-800">Нет «общего допуска команды».</strong> Способы распределять можно, но недостающую группу, D или T нельзя взять у другого сварщика. НАКС также не заменяет требуемый ДЛС.</li>
          <li><strong className="text-slate-800">Важна дата сварки, не сегодняшняя дата.</strong> Архивный допуск может учитываться для исторического стыка внутри своего срока. Отстранение проверяется отдельно и относится ко всем допускам клейма.</li>
          <li><strong className="text-slate-800">Фактическое клеймо не равно официальному допуску.</strong> Таблица описывает проверки официальных клейм. Запись факта сама по себе не подтверждает соответствие НАКС/ДЛС; без нужных исходных данных полный вывод сделать нельзя.</li>
        </ul>
      </aside>
    </section>
  )
}
