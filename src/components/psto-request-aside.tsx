export function PstoRequestAside() {
  return (
    <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
      <h3 className="text-sm font-semibold text-slate-800">Термообработка</h3>
      <p className="text-xs leading-5 text-slate-500">
        В заявку можно добавить один или несколько стыков, где ПСТО требуется и заявка еще не создана.
      </p>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
        После создания наименование заявки попадет в столбец «Заявка ПСТО», а строка обновит дату «Внесен ПСТО».
      </div>
    </section>
  )
}
