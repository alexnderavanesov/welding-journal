import { describe, expect, it } from 'vitest'
import { EXCEL_FIELDS, VISIBLE_FIELDS, VISIBLE_FIELD_SECTIONS, calculateFinalStatus, getFinalStatusErrorReason } from './weld-fields'
import { getAlwaysVisibleFieldKeys, getAvailableWeldTableSections, getFilteredWeldTableSections } from './weld-table-sections'
import {
  HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
  LNK_HIDDEN_FIELD_KEYS,
  WELDING_JOURNAL_BLOCKED_FIELD_KEYS,
  WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
} from './report-config'
import {
  formHiddenFieldKeys,
  secondaryWeldFormFieldKeys,
  weldingMaterialWeldFormFieldKeys,
} from './weld-form-field-sets'

describe('weld field order', () => {
  it('keeps table columns in the order defined by the section Excel file', () => {
    expect(VISIBLE_FIELDS.map((field) => field.label).slice(0, 15)).toEqual([
      'Проект',
      'Шифр',
      'Линия',
      'Группа трубопровода',
      'Категория трубопровода',
      'Контроль швов, (%)',
      'Изометрия',
      'Номер листа',
      'Номер ИЗМа',
      'Актуальность по ИЗМу',
      'Спул',
      'ID cпула',
      'Стык',
      'Статус',
      'Материал 1',
    ])
  })

  it('groups visible columns into section headers', () => {
    expect(VISIBLE_FIELD_SECTIONS.map((group) => group.section)).toEqual([
      'Проект',
      'Спул',
      'Стык',
      'Материалы',
      'Сварка',
      'Клейма',
      'Контроль',
      'Заявки',
      'Результат',
      'Заключения',
      'Испытания',
      'Документы',
      'Прочее',
      'Материал (дополнительно)',
      'Сварочный материал и ТК',
      'Код работ',
      'Закрытие',
    ])
  })

  it('shows JSR and Checklist document links only in the welding journal', () => {
    const journalSections = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const lnkSections = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const pstoSections = getAvailableWeldTableSections({
      hiddenFieldKeys: HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
      mergePstoSections: true,
    })

    expect(journalSections.find((group) => group.section === 'Документы')?.fields.map((field) => field.key)).toEqual([
      'jsrDocument',
      'checklistDocument',
      'zniDocument',
    ])
    expect(lnkSections.some((group) => group.section === 'Документы')).toBe(false)
    expect(pstoSections.some((group) => group.section === 'Документы')).toBe(false)
  })

  it('keeps document fields system-controlled and outside Excel imports', () => {
    expect(WELDING_JOURNAL_BLOCKED_FIELD_KEYS.has('jsrDocument')).toBe(true)
    expect(WELDING_JOURNAL_BLOCKED_FIELD_KEYS.has('checklistDocument')).toBe(true)
    expect(WELDING_JOURNAL_BLOCKED_FIELD_KEYS.has('zniDocument')).toBe(true)
    expect(EXCEL_FIELDS.some((field) => field.key === 'jsrDocument')).toBe(false)
    expect(EXCEL_FIELDS.some((field) => field.key === 'checklistDocument')).toBe(false)
    expect(EXCEL_FIELDS.some((field) => field.key === 'zniDocument')).toBe(false)
  })

  it('keeps virtual RK exposure state and its hidden metadata outside Excel imports', () => {
    expect(EXCEL_FIELDS.some((field) => field.key === 'rkExposureScheme')).toBe(false)
    expect(EXCEL_FIELDS.some((field) => field.key === 'rkExposureConfirmedDiameter')).toBe(false)
  })

  it('shows welding materials and technology card only in the welding journal', () => {
    const expectedFieldKeys = [
      'technologyCardNumber',
      'weldingElectrodes',
      'weldingElectrodesCertificateNumber',
      'fillerWire',
      'fillerWireCertificateNumber',
      'shieldingGas',
      'shieldingGasCertificateNumber',
    ]
    const journalSections = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const lnkSections = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const pstoSections = getAvailableWeldTableSections({
      hiddenFieldKeys: HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
      mergePstoSections: true,
    })

    expect(
      journalSections.find((group) => group.section === 'Сварочный материал и ТК')?.fields.map((field) => field.key),
    ).toEqual(expectedFieldKeys)
    expect(lnkSections.some((group) => group.section === 'Сварочный материал и ТК')).toBe(false)
    expect(pstoSections.some((group) => group.section === 'Сварочный материал и ТК')).toBe(false)
  })

  it('starts every user-facing field label with an uppercase letter or a number', () => {
    const lowercaseLabels = VISIBLE_FIELDS
      .map((field) => field.label)
      .filter((label) => /^[а-яёa-z]/u.test(label))

    expect(lowercaseLabels).toEqual([])
  })

  it('hides additional material fields from LNK and PSTO reports only', () => {
    const journalSections = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const lnkSections = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const pstoSections = getAvailableWeldTableSections({
      hiddenFieldKeys: HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
      mergePstoSections: true,
    })

    expect(journalSections.some((group) => group.section === 'Материал (дополнительно)')).toBe(true)
    expect(lnkSections.some((group) => group.section === 'Материал (дополнительно)')).toBe(false)
    expect(pstoSections.some((group) => group.section === 'Материал (дополнительно)')).toBe(false)
  })

  it('shows testing fields only in the welding journal report', () => {
    const journalSections = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const lnkSections = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const pstoSections = getAvailableWeldTableSections({
      hiddenFieldKeys: HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
      mergePstoSections: true,
    })

    expect(journalSections.some((group) => group.section === 'Испытания')).toBe(true)
    expect(journalSections.flatMap((group) => group.fields).map((field) => field.key)).toEqual(
      expect.arrayContaining(['testTypes', 'testContour', 'testDate', 'piDate', 'testBoq', 'piBoq', 'testKs3', 'piKs3']),
    )
    expect(lnkSections.flatMap((group) => group.fields).map((field) => field.key)).not.toEqual(
      expect.arrayContaining(['testTypes', 'testContour', 'testDate', 'piDate', 'testBoq', 'piBoq', 'testKs3', 'piKs3']),
    )
    expect(pstoSections.flatMap((group) => group.fields).map((field) => field.key)).not.toEqual(
      expect.arrayContaining(['testTypes', 'testContour', 'testDate', 'piDate', 'testBoq', 'piBoq', 'testKs3', 'piKs3']),
    )
  })

  it('keeps weld control percent visible when the project section is collapsed', () => {
    const alwaysVisibleFieldKeys = getAlwaysVisibleFieldKeys(false)
    const projectSection = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Проект')

    expect(projectSection).toBeDefined()

    const sections = getFilteredWeldTableSections({
      availableSections: [projectSection!],
      collapsedSections: new Set(['Проект']),
      alwaysVisibleFieldKeys,
    })

    expect(sections[0]?.fields.map((field) => field.key)).toEqual([
      'projectTitle',
      'subtitleCode',
      'line',
      'weldControlPercent',
    ])
  })

  it('shows LNK conclusion columns after result columns', () => {
    const conclusions = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Заключения')

    expect(conclusions?.fields.map((field) => field.label)).toEqual([
      'Заключение ВИК',
      'Дата ВИК',
      'Заключение РК',
      'Дата РК',
      'Снимки (координаты мерного пояса)',
      'Описание дефектов РК',
      'Заключение УЗК',
      'Дата УЗК',
      'Заключение ПВК',
      'Дата ПВК',
      'Заключение ТВМТ',
      'Дата ТВМТ',
      'Заключение РФА',
      'Дата РФА',
      'Заключение СТЛС',
      'Дата СТЛС',
      'Заключение МКК',
      'Дата МКК',
      'Примечание ЛНК',
    ])
  })

  it('shows welding customer work code and acceptance fields in separate sections', () => {
    const tests = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Испытания')
    const customerWorkCode = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Код работ')
    const acceptance = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Закрытие')

    expect(tests?.fields.map((field) => field.label)).toEqual([
      'Вид испытаний',
      'Контур',
      'Дата ГИ',
      'Дата ПИ',
    ])
    expect(customerWorkCode?.fields.map((field) => field.label)).toEqual([
      'BoQ сварка',
      'BoQ ПСТО',
      'BoQ ВИК',
      'BoQ РК',
      'BoQ УЗК',
      'BoQ ПВК',
      'BoQ ТВМТ',
      'BoQ РФА',
      'BoQ СТЛС',
      'BoQ МКК',
      'BoQ ГИ',
      'BoQ ПИ',
    ])
    expect(acceptance?.fields.map((field) => field.label)).toEqual([
      'КС3 сварка',
      'КС3 ПСТО',
      'КС3 ВИК',
      'КС3 РК',
      'КС3 УЗК',
      'КС3 ПВК',
      'КС3 ТВМТ',
      'КС3 РФА',
      'КС3 СТЛС',
      'КС3 МКК',
      'КС3 ГИ',
      'КС3 ПИ',
    ])
  })

  it('keeps work code and acceptance fields available in the weld form secondary tab', () => {
    expect([...secondaryWeldFormFieldKeys].some((fieldKey) => formHiddenFieldKeys.has(fieldKey))).toBe(false)
    expect(secondaryWeldFormFieldKeys.has('testTypes')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('testContour')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('testDate')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('piDate')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('boq')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('ks3')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('testBoq')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('piBoq')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('testKs3')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('piKs3')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('pstoBoq')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('pstoKs3')).toBe(true)
  })

  it('keeps welding materials available in their dedicated weld form tab', () => {
    expect([...weldingMaterialWeldFormFieldKeys].some((fieldKey) => formHiddenFieldKeys.has(fieldKey))).toBe(false)
    expect([...weldingMaterialWeldFormFieldKeys]).toEqual([
      'technologyCardNumber',
      'weldingElectrodes',
      'weldingElectrodesCertificateNumber',
      'fillerWire',
      'fillerWireCertificateNumber',
      'shieldingGas',
      'shieldingGasCertificateNumber',
    ])
  })

  it('keeps BoQ and KS3 fields visible in the welding journal report', () => {
    const sections = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const customerWorkCode = sections.find((group) => group.section === 'Код работ')
    const acceptance = sections.find((group) => group.section === 'Закрытие')
    const tests = sections.find((group) => group.section === 'Испытания')

    expect(tests?.fields.map((field) => field.label)).toEqual([
      'Вид испытаний',
      'Контур',
      'Дата ГИ',
      'Дата ПИ',
    ])
    expect(customerWorkCode?.fields.map((field) => field.label)).toEqual([
      'BoQ сварка',
      'BoQ ПСТО',
      'BoQ ВИК',
      'BoQ РК',
      'BoQ УЗК',
      'BoQ ПВК',
      'BoQ ТВМТ',
      'BoQ РФА',
      'BoQ СТЛС',
      'BoQ МКК',
      'BoQ ГИ',
      'BoQ ПИ',
    ])
    expect(acceptance?.fields.map((field) => field.label)).toEqual([
      'КС3 сварка',
      'КС3 ПСТО',
      'КС3 ВИК',
      'КС3 РК',
      'КС3 УЗК',
      'КС3 ПВК',
      'КС3 ТВМТ',
      'КС3 РФА',
      'КС3 СТЛС',
      'КС3 МКК',
      'КС3 ГИ',
      'КС3 ПИ',
    ])
  })

  it('shows service tracking fields in the misc section', () => {
    const misc = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Прочее')

    expect(misc?.fields.map((field) => field.label)).toEqual([
      'Номер записи',
      'Задачи диспетчера',
      'Примечание сварочный журнал',
      'Внесен сварка',
      'Обновлен сварка',
      'Внесен ПСТО',
      'Обновлен ПСТО',
      'Внесен ЛНК',
      'Обновлен ЛНК',
    ])
  })

  it('shows read-only system fields in all three reports', () => {
    const journalFields = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    }).flatMap((group) => group.fields)
    const lnkFields = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    }).flatMap((group) => group.fields)
    const pstoFields = getAvailableWeldTableSections({
      hiddenFieldKeys: HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
      mergePstoSections: true,
    }).flatMap((group) => group.fields)

    expect(journalFields.some((field) => field.key === 'id')).toBe(true)
    expect(lnkFields.some((field) => field.key === 'id')).toBe(true)
    expect(pstoFields.some((field) => field.key === 'id')).toBe(true)
    expect(journalFields.some((field) => field.key === 'dispatcherTasks')).toBe(true)
    expect(lnkFields.some((field) => field.key === 'dispatcherTasks')).toBe(true)
    expect(pstoFields.some((field) => field.key === 'dispatcherTasks')).toBe(true)
    expect(formHiddenFieldKeys.has('id')).toBe(true)
    expect(formHiddenFieldKeys.has('dispatcherTasks')).toBe(true)
    expect(journalFields.filter((field) => ['createdAt', 'weldingUpdatedAt'].includes(field.key)).map((field) => field.key)).toEqual([
      'createdAt',
      'weldingUpdatedAt',
    ])
    expect(journalFields.some((field) => field.key === 'lnkUpdatedAt' || field.key === 'pstoUpdatedAt')).toBe(false)
    expect(lnkFields.filter((field) => ['lnkCreatedAt', 'lnkUpdatedAt'].includes(field.key)).map((field) => field.key)).toEqual([
      'lnkCreatedAt',
      'lnkUpdatedAt',
    ])
    expect(lnkFields.some((field) => field.key === 'weldingUpdatedAt' || field.key === 'pstoUpdatedAt')).toBe(false)
    expect(pstoFields.filter((field) => ['pstoCreatedAt', 'pstoUpdatedAt'].includes(field.key)).map((field) => field.key)).toEqual([
      'pstoCreatedAt',
      'pstoUpdatedAt',
    ])
    expect(pstoFields.some((field) => field.key === 'weldingUpdatedAt' || field.key === 'lnkUpdatedAt')).toBe(false)
  })

  it('keeps every note in its own report and exposes the journal note in the weld form', () => {
    const journalFields = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    }).flatMap((group) => group.fields)
    const lnkFields = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    }).flatMap((group) => group.fields)
    const pstoFields = getAvailableWeldTableSections({
      hiddenFieldKeys: HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
      mergePstoSections: true,
    }).flatMap((group) => group.fields)

    expect(journalFields.some((field) => field.key === 'weldingJournalNote')).toBe(true)
    expect(journalFields.some((field) => field.key === 'lnkNote' || field.key === 'pstoNote')).toBe(false)
    expect(lnkFields.some((field) => field.key === 'lnkNote')).toBe(true)
    expect(lnkFields.some((field) => field.key === 'weldingJournalNote' || field.key === 'pstoNote')).toBe(false)
    expect(pstoFields.some((field) => field.key === 'pstoNote')).toBe(true)
    expect(pstoFields.some((field) => field.key === 'weldingJournalNote' || field.key === 'lnkNote')).toBe(false)
    expect(formHiddenFieldKeys.has('weldingJournalNote')).toBe(false)
    expect(formHiddenFieldKeys.has('lnkNote')).toBe(true)
    expect(formHiddenFieldKeys.has('pstoNote')).toBe(true)
  })

  it('shows request columns in the same control order as results', () => {
    const requests = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Заявки')

    expect(requests?.fields.map((field) => field.label)).toEqual([
      'Заявка ВИК',
      'Дата заявки ВИК',
      'Заявка РК',
      'Дата заявки РК',
      'Заявка УЗК',
      'Дата заявки УЗК',
      'Заявка ПВК',
      'Дата заявки ПВК',
      'Заявка ПСТО',
      'Дата заявки ПСТО',
      'Заявка ТВМТ',
      'Дата заявки ТВМТ',
      'Заявка РФА',
      'Дата заявки РФА',
      'Заявка СТЛС',
      'Дата заявки СТЛС',
      'Заявка МКК',
      'Дата заявки МКК',
      'Дата ПСТО',
    ])
  })

  it('shows heat treatment result before the generated diagram', () => {
    const results = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Результат')
    const labels = results?.fields.map((field) => field.label) ?? []

    expect(labels.indexOf('Результат ПСТО')).toBeLessThan(labels.indexOf('Диаграмма термообработки'))
  })

  it('does not treat cancelled controls with old results as an error', () => {
    expect(calculateFinalStatus({ hasPvk: 'отменен', pvkResult: 'годен' })).toBe('ожидает сварку')
    expect(calculateFinalStatus({ pstoRequired: 'отменен', pstoResult: 'проведено' })).toBe('ожидает сварку')
  })

  it('explains final status errors caused by result without active control', () => {
    expect(getFinalStatusErrorReason({ hasRk: null, rkResult: 'ожидает НК' })).toContain(
      'РК: результат «ожидает НК» заполнен, но назначение РК = «пусто»',
    )
    expect(getFinalStatusErrorReason({ hasRk: 'отменен', rkResult: 'ожидает НК' })).toBeNull()
  })

  it('skips cancelled controls when active controls still wait for NDT', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'отменен',
        vikRequest: 'Заявка-1',
        vikResult: 'отменен',
        hasRk: 'да',
        rkRequest: 'Заявка-2',
        rkResult: 'ожидает НК',
        pstoRequired: 'отменен',
        pstoResult: 'отменен',
      }),
    ).toBe('ожидает НК')
  })

  it('treats positive cancelled result as good when control is enabled again', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'да',
        vikResult: 'годен (отменен)',
      }),
    ).toBe('годен')
  })

  it('treats additional controls as active controls', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasRk: 'дополнительный',
        rkRequest: 'Заявка-1',
        rkResult: 'годен',
      }),
    ).toBe('годен')

    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasRk: 'дополнительный',
        rkRequest: 'Заявка-1',
        rkResult: 'ожидает НК',
      }),
    ).toBe('ожидает НК')
  })

  it('treats pending NDT results as waiting', () => {
    expect(calculateFinalStatus({ weldDate: '20.03.2025', hasPvk: true, pvkRequest: 'Заявка-1', pvkResult: 'ожидает НК' })).toBe(
      'ожидает НК',
    )
  })

  it('prioritizes waiting NDT over missing request in final status', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'да',
        vikRequest: '',
        vikResult: 'ожидает заявку',
        hasRk: 'да',
        rkRequest: 'Заявка-1',
        rkResult: 'ожидает НК',
      }),
    ).toBe('ожидает НК')
  })

  it('keeps waiting request when the other control is cancelled', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'да',
        vikRequest: '',
        vikResult: 'ожидает заявку',
        hasRk: 'отменен',
        rkResult: 'отменен',
      }),
    ).toBe('ожидает заявку')
  })

  it('does not let pending heat treatment keep a good NDT joint waiting', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'да',
        vikResult: 'годен',
        hasRk: 'да',
        rkResult: 'годен',
        pstoRequired: 'да',
        pstoResult: null,
      }),
    ).toBe('годен')
  })
})
