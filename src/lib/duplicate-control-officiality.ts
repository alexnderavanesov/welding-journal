import { getDuplicateControls } from '@/lib/duplicate-control-utils'
import { isUnofficialJoint } from '@/lib/joint-display'
import type { WeldInput } from '@/lib/weld-fields'

export function getDuplicateControlOfficialityBlockReason(row: WeldInput) {
  return isUnofficialJoint(row)
    ? 'Дубль-контроль недоступен для неофициального стыка, независимо от метода и результата. Сначала верните стыку официальность через ЛНК → «Официальность».'
    : null
}

/** Presence matters, including incomplete legacy controls, not just a rejected result. */
export function getUnofficialDuplicateControlBlockReason(row: WeldInput) {
  return getDuplicateControls(row).length > 0
    ? 'Нельзя сделать стык неофициальным: на нём есть дубль-контроль. Ограничение действует для любого метода и результата. Ошибочную запись дубля сначала удалите через ЛНК → «Дубль контроль».'
    : null
}
