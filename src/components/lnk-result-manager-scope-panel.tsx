import { DialogHelpNote } from '@/components/dialog-help-note'
import { DialogSummaryPanel, DialogSummaryStat } from '@/components/dialog-summary-panel'
import type { LnkResultMethod } from '@/components/lnk-result-manager-entry'
import { Select } from '@/components/ui/select'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultManagerScopePanelProps = {
  selectedRowsCount: number
  methods: LnkResultMethod[]
  methodKey: WeldFieldKey | ''
  onMethodChange: (methodKey: WeldFieldKey | '') => void
}

export function LnkResultManagerScopePanel({
  selectedRowsCount,
  methods,
  methodKey,
  onMethodChange,
}: LnkResultManagerScopePanelProps) {
  return (
    <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
      <DialogSummaryPanel title="Что редактируем">
        <div className="space-y-3">
          <DialogSummaryStat label="Выбрано стыков" value={selectedRowsCount} />

          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
            <Select
              value={methodKey}
              onChange={(event) => onMethodChange(event.target.value as WeldFieldKey)}
              disabled={methods.length === 0}
            >
              <option value="">Все методы</option>
              {methods.map((method) => (
                <option key={method.requestKey} value={method.requestKey}>
                  {method.code}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </DialogSummaryPanel>
      <DialogHelpNote>
        Замена меняет только результат и сохраняет существующее заключение. Наименование заключения редактируется отдельно у
        конкретного стыка. Удаление очищает результат, дату контроля и заключение.
      </DialogHelpNote>
    </section>
  )
}
