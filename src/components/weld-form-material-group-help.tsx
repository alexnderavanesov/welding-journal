import { FieldHelp } from '@/components/field-help'

export function WeldFormMaterialGroupHelp() {
  return <FieldHelp label="Как выбрать группы материалов">
    <p>Одна группа с отметкой 1/2 — для обеих сторон.</p>
    <p>Две группы: 1 — D1/T1, 2 — D2/T2. Порядок выбора сохраняется.</p>
    <p className="mt-1 text-slate-300">↔ меняет только группы местами, не размеры. × очищает выбор.</p>
  </FieldHelp>
}
