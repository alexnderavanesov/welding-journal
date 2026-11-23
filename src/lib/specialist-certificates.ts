import { parseDateLikeToIso } from './date-format'
import type { SpecialistCertificate, SpecialistDocumentProfile, SpecialistKind, SpecialistRecord, SpecialistMethod } from './document-specialists'

export type SpecialistDateRequirement = { date: string; methods: readonly string[] }

/** Null is the unchanged legacy card, not an empty collection of certificates. */
export function getSpecialistCertificates(record: Pick<SpecialistRecord, 'certificate' | 'certificates' | 'methods'>): SpecialistCertificate[] {
  return record.certificates ?? [{ number: record.certificate, validFrom: null, validTo: null, methods: record.methods }]
}

export function validateSpecialistCertificates(certificates: SpecialistCertificate[], kind: SpecialistKind, allowedMethods: readonly string[]): SpecialistCertificate[] {
  if (!Array.isArray(certificates) || !certificates.length) throw new Error('Добавьте хотя бы одно удостоверение.')
  const normalized = certificates.map((certificate, index) => {
    const label = `Удостоверение ${index + 1}`
    const number = String(certificate?.number ?? '').trim()
    if (!number || number.length > 200) throw new Error(`${label}: укажите номер (до 200 символов).`)
    const from = String(certificate.validFrom ?? '').trim(), to = String(certificate.validTo ?? '').trim()
    const validFrom = parseDateLikeToIso(from), validTo = parseDateLikeToIso(to)
    if ((from || to) && (!validFrom || !validTo)) throw new Error(`${label}: заполните обе даты корректно или оставьте обе пустыми.`)
    if (validFrom && validTo && validFrom > validTo) throw new Error(`${label}: дата начала не может быть позже даты окончания.`)
    const methods = kind === 'thermist' ? [] : [...new Set(Array.isArray(certificate.methods) ? certificate.methods : [])]
    if (kind === 'inspector' && (!methods.length || methods.some(method => !allowedMethods.includes(method)))) throw new Error(`${label}: выберите виды контроля.`)
    return { number, validFrom, validTo, methods }
  })
  for (let i = 0; i < normalized.length; i++) for (let j = 0; j < i; j++) {
    const a = normalized[i]!, b = normalized[j]!
    if (kind !== 'thermist' && !a.methods.some(method => b.methods.includes(method))) continue
    if (!a.validFrom && !b.validFrom) throw new Error(`Удостоверения ${j + 1} и ${i + 1}: для одного вида контроля допускается только одно удостоверение без дат.`)
    if (a.validFrom && b.validFrom && a.validFrom <= b.validTo! && b.validFrom <= a.validTo!) throw new Error(`Удостоверения ${j + 1} и ${i + 1}: периоды для одного вида контроля пересекаются. Даты начала и окончания включаются в период.`)
  }
  return normalized
}

export function selectSpecialistCertificate(record: SpecialistRecord, profile: SpecialistDocumentProfile, date: string): SpecialistCertificate | undefined {
  const iso = parseDateLikeToIso(date)
  if (!iso || record.archived || record.kind !== profile.kind) return undefined
  const eligible = getSpecialistCertificates(record).filter(certificate => profile.methods.every(method => certificate.methods.includes(method as SpecialistMethod)))
  return eligible.find(certificate => certificate.validFrom && certificate.validTo && certificate.validFrom <= iso && iso <= certificate.validTo)
    ?? eligible.find(certificate => !certificate.validFrom && !certificate.validTo)
}

export function specialistMeetsDates(record: SpecialistRecord, profile: SpecialistDocumentProfile, requirements: readonly SpecialistDateRequirement[]) {
  return requirements.every(requirement => Boolean(selectSpecialistCertificate(record, { ...profile, methods: requirement.methods }, requirement.date)))
}
