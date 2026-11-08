export const TECHNOLOGY_CARD_MATERIAL_FIELDS = [
  ['weldingElectrodes', 'Сварочные электроды'],
  ['weldingElectrodesCertificateNumber', 'Номер сертификата (электроды)'],
  ['fillerWire', 'Присадочная проволока'],
  ['fillerWireCertificateNumber', 'Номер сертификата (проволока)'],
  ['shieldingGas', 'Защитный газ'],
  ['shieldingGasCertificateNumber', 'Номер сертификата (газ)'],
] as const

export type TechnologyCardMaterialField = typeof TECHNOLOGY_CARD_MATERIAL_FIELDS[number][0]
export type TechnologyCardMaterials = Partial<Record<TechnologyCardMaterialField, string | null>>

/** Empty card fields never erase a joint's manually entered material. A later
 * explicit card refresh replaces nonempty defaults, including manual overrides. */
export function getTechnologyCardMaterialChanges(row: Partial<Record<TechnologyCardMaterialField, unknown>>, card: TechnologyCardMaterials) {
  const changes: Partial<Record<TechnologyCardMaterialField, string>> = {}
  for (const [field] of TECHNOLOGY_CARD_MATERIAL_FIELDS) {
    const value = card[field]?.trim()
    if (value && value !== (row[field] ?? '')) changes[field] = value
  }
  return changes
}
