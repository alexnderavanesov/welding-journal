import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { formHiddenFieldKeys } from '@/lib/weld-form-field-sets'
import { WELD_FIELDS, isVirtualWeldField } from '@/lib/weld-fields'
import {
  SYSTEM_FIELD_KEYS,
  WELD_MUTATION_FIELD_KEYS,
  restrictWeldMutationRecord,
} from '@/server/weld-mutation-policy'

describe('weld mutation policy', () => {
  it('keeps the obsolete exemption only in the schema and client-write denylist', () => {
    const root = resolve(process.cwd(), 'src')
    const scan = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) return scan(path)
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) &&
        /preHeatTreatmentLnkExempt|pre_heat_treatment_lnk_exempt/.test(readFileSync(path, 'utf8'))
        ? [relative(root, path).replaceAll('\\', '/')] : []
    })
    expect(scan(root).sort()).toEqual(['db/schema.ts', 'server/weld-mutation-policy.ts'])
  })
  it('persists every visible editable field from the weld form', () => {
    const allowed = new Set(WELD_MUTATION_FIELD_KEYS.welding)
    const silentlyDropped = WELD_FIELDS
      .filter((field) => !isVirtualWeldField(field) && !formHiddenFieldKeys.has(field.key))
      .filter((field) => !allowed.has(field.key))
      .map((field) => field.key)

    expect(silentlyDropped).toEqual([])
  })

  it('keeps system-managed fields outside an ordinary weld save', () => {
    const payload = Object.fromEntries(
      [...SYSTEM_FIELD_KEYS]
        .filter((fieldKey) => fieldKey !== 'id')
        .map((fieldKey) => [fieldKey, 'changed']),
    )
    const restricted = restrictWeldMutationRecord({ id: 7, ...payload }, 'welding')

    expect(restricted).toEqual({ id: 7 })
  })

  it.each(['welding', 'lnk', 'psto'] as const)('does not accept client-supplied pre-TO policy through %s', (scope) => {
    const payload = { id: 7, preHeatTreatmentLnkEnabled: false, preHeatTreatmentLnkExempt: true }
    expect(restrictWeldMutationRecord(payload, scope)).toEqual({ id: 7 })
    expect(WELD_FIELDS.some((field) => String(field.key) === 'preHeatTreatmentLnkEnabled')).toBe(false)
  })

  it('allows work-code fields shared with LNK and PSTO reports', () => {
    const restricted = restrictWeldMutationRecord({
      id: 7,
      vikBoq: 'ВИК-BoQ',
      rkKs3: 'РК-КС3',
      pstoBoq: 'ПСТО-BoQ',
      tvmtKs3: 'ТВМТ-КС3',
    }, 'welding')

    expect(restricted).toEqual({
      id: 7,
      vikBoq: 'ВИК-BoQ',
      rkKs3: 'РК-КС3',
      pstoBoq: 'ПСТО-BoQ',
      tvmtKs3: 'ТВМТ-КС3',
    })
  })
})
