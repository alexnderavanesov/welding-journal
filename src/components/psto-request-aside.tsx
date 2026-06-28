import { DialogHelpNote } from '@/components/dialog-help-note'

export function PstoRequestAside() {
  return (
    <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
      <h3 className="text-sm font-semibold text-slate-800">Термообработка</h3>
      <p className="text-xs leading-5 text-slate-500">
        В заявку можно добавить один или несколько стыков, где ПСТО требуется и заявка еще не создана.
      </p>
      <DialogHelpNote>
        После создания наименование заявки попадет в столбец «Заявка ПСТО», а строка обновит дату «Внесен ПСТО».
      </DialogHelpNote>
    </section>
  )
}
