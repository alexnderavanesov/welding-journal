import type { CoilCorrectionChecklist as Checklist } from '@/lib/coil-correction-checklist'
import type { WeldRow } from '@/lib/dispatcher-types'
import { Button } from './ui/button'

export type CoilCorrectionReportHandler = (rows: WeldRow[], report: 'weldingJournal' | 'lnk' | 'heatTreatment') => void

export function CoilCorrectionChecklist({ data, reason, onOpenReport, onEarlyCorrection }: {
  data: Checklist; reason: string | null; onOpenReport?: CoilCorrectionReportHandler; onEarlyCorrection: (id: number) => void
}) {
  const sidesRemain = data.replacementRows.length > 0
  const early = data.earlySources.length > 0
  const sourceReady = !sidesRemain && !reason
  const names = (rows: Checklist['sourceRows']) => rows.slice(0, 8).map(row => row.joint).join(', ') + (rows.length > 8 ? ` и ещё ${rows.length - 8}` : '')
  return <section aria-label="Шаги исправления ошибочной катушки" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
    <h3 className="font-semibold">Что осталось исправить</h3>
    <p>Это список действий, а не автоматическое удаление. После перехода исправьте данные в рабочем окне и нажмите «Вернуться к исправлению катушки» над отчётом. Также помощник можно снова открыть в картине исходного стыка. Он проверит сохранённые данные заново.</p>
    <ol className="space-y-4">
      <li>
        <p className="font-medium">1. Документы и факты сторон — {data.historyRows.length ? 'нужна проверка' : 'препятствий не найдено'}</p>
        {data.historyRows.length ? <p>Сохранены документы или история: {names(data.historyRows)}. Удаляйте только ошибочные сведения через рабочие окна НК, ПСТО и документов. Сначала заключения, затем заявки, с учётом зависимостей.</p> : <p>У оставшихся сторон и их продолжений нет сохранённых документов или истории контроля, требующих очистки.</p>}
        {early && data.weldedRows.length ? <p>Для отмены досрочного решения также очистите ошибочные даты сварки: {names(data.weldedRows)}.</p> : null}
        {onOpenReport && data.historyRows.length ? <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenReport(data.historyRows, 'lnk')}>Открыть НК сторон</Button>
          <Button variant="outline" size="sm" onClick={() => onOpenReport(data.historyRows, 'heatTreatment')}>Открыть ПСТО сторон</Button>
        </div> : null}
      </li>
      <li>
        <p className="font-medium">2. Ошибочная катушка — {sidesRemain ? `осталось записей: ${data.replacementRows.length}` : 'записи сторон удалены'}</p>
        {sidesRemain ? <p>{names(data.replacementRows)}. {early ? 'Продолжения удаляйте с конца. Очищенную пару удалит отдельная отмена досрочного решения.' : 'Удаляйте с конца цепочки либо всей выбранной веткой, если защиты допускают. Исходный стык и его ремонты удалять не нужно.'}</p> : null}
        {onOpenReport && sidesRemain ? <Button className="mt-2" variant="outline" size="sm" onClick={() => onOpenReport(data.replacementRows, 'weldingJournal')}>Открыть стороны в журнале</Button> : null}
        {data.earlySources.map(row => <Button className="mt-2" key={row.id} variant="outline" size="sm" onClick={() => onEarlyCorrection(row.id)}>Проверить отмену досрочного решения · {row.joint}</Button>)}
      </li>
      <li>
        <p className="font-medium">3. Исходная цепочка — {sidesRemain ? 'проверка после удаления сторон' : sourceReady ? 'готова к подтверждению' : 'нужны исправления'}</p>
        <p>{names(data.sourceRows)}. Нужен единственный официальный актуальный годный финал без нарушений цепочки. Исправляйте результаты только по фактическим данным; помощник не выставляет «годен».</p>
        {onOpenReport ? <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenReport(data.sourceRows, 'lnk')}>Открыть НК исходной цепочки</Button>
          <Button variant="outline" size="sm" onClick={() => onOpenReport(data.sourceRows, 'weldingJournal')}>Открыть исходную цепочку в журнале</Button>
        </div> : null}
      </li>
      <li><p className="font-medium">4. Восстановление количества — {sourceReady ? 'доступно ниже' : data.replacedByCoil ? 'пока недоступно' : 'не требуется: физическая замена не зафиксирована'}</p>
        <p>Удаление записей уже зафиксированной катушки само по себе не возвращает исходное соединение. Когда проверки пройдены, сравните количество ниже и отдельно подтвердите, что фактической врезки не было.</p>
      </li>
    </ol>
    <p>Закрытие помощника ничего не меняет и не отменяет отдельно сохранённые исправления.</p>
  </section>
}
