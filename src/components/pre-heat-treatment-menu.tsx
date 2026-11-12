import { useState } from 'react'
import { ReportShowMenu } from './report-show-menu'
import { useAccess } from '@/lib/security-context'
export const PRE_HEAT_ACTIONS = [
  { action: 'enable', label: 'Поставить отметку', permission: 'welding.edit' },
  { action: 'fill', label: 'Заполнить недостающее как «Годен»', permission: 'lnk.edit' },
  { action: 'disable', label: 'Снять отметку', permission: 'welding.edit' },
] as const
export type PreHeatTreatmentAction = typeof PRE_HEAT_ACTIONS[number]['action']
export function PreHeatTreatmentMenu({ selectedCount, onAction }: { selectedCount: number; onAction: (action: PreHeatTreatmentAction) => void }) {
  const [open, setOpen] = useState(false)
  const { can } = useAccess()
  return <span title={selectedCount ? `Выбрано стыков: ${selectedCount}` : 'Выберите стыки'}><ReportShowMenu label="НК до ТО" isOpen={open}
    disabled={!selectedCount} onToggle={() => setOpen(value => !value)} widthClassName="w-80"
    items={PRE_HEAT_ACTIONS.map(item => ({ label: item.label, disabled: !can(item.permission), onClick: () => { setOpen(false); onAction(item.action) } }))} /></span>
}
