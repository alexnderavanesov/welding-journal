import { boolean, date, index, integer, numeric, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core'

const numericNumber = (name: string) => numeric(name, { precision: 12, scale: 3, mode: 'number' })

export const weldJoints = pgTable(
  'weld_joints',
  {
    id: serial('id').primaryKey(),
    weldDate: date('weld_date'),
    projectTitle: text('project_title'),
    subtitleCode: text('subtitle_code'),
    line: text('line'),
    groupName: text('group_name'),
    category: text('category'),
    pstoRequired: text('psto_required'),
    weldControlPercent: numericNumber('weld_control_percent'),
    isometry: text('isometry'),
    sheet: numericNumber('sheet'),
    revisionNumber: numericNumber('revision_number'),
    joint: text('joint'),
    spool: text('spool'),
    spoolId: text('spool_id'),
    status: text('status'),
    revisionActuality: text('revision_actuality'),
    orderCode1: text('order_code_1'),
    orderCode2: text('order_code_2'),
    materialUniqueNumber1: text('material_unique_number_1'),
    materialUniqueNumber2: text('material_unique_number_2'),
    element1: text('element_1'),
    element2: text('element_2'),
    materialId1: text('material_id_1'),
    materialId2: text('material_id_2'),
    material1: text('material_1'),
    material2: text('material_2'),
    materialFullName1: text('material_full_name_1'),
    materialFullName2: text('material_full_name_2'),
    materialNormativeDocument1: text('material_normative_document_1'),
    materialNormativeDocument2: text('material_normative_document_2'),
    materialCertificateNumber1: text('material_certificate_number_1'),
    materialCertificateNumber2: text('material_certificate_number_2'),
    weldingMethod: text('welding_method'),
    connectionType: text('connection_type'),
    materialGroup: text('material_group'),
    d1: numericNumber('d1'),
    d2: numericNumber('d2'),
    t1: numericNumber('t1'),
    t2: numericNumber('t2'),
    wdi: numericNumber('wdi'),
    responsible: text('responsible'),
    technologyCardNumber: text('technology_card_number'),
    weldingElectrodes: text('welding_electrodes'),
    weldingElectrodesCertificateNumber: text('welding_electrodes_certificate_number'),
    fillerWire: text('filler_wire'),
    fillerWireCertificateNumber: text('filler_wire_certificate_number'),
    shieldingGas: text('shielding_gas'),
    shieldingGasCertificateNumber: text('shielding_gas_certificate_number'),
    stamp1K: text('stamp_1_k'),
    stamp1Z: text('stamp_1_z'),
    stamp1O: text('stamp_1_o'),
    stamp2K: text('stamp_2_k'),
    stamp2Z: text('stamp_2_z'),
    stamp2O: text('stamp_2_o'),
    stamp1KFact: text('stamp_1_k_fact'),
    stamp1ZFact: text('stamp_1_z_fact'),
    stamp1OFact: text('stamp_1_o_fact'),
    stamp2KFact: text('stamp_2_k_fact'),
    stamp2ZFact: text('stamp_2_z_fact'),
    stamp2OFact: text('stamp_2_o_fact'),
    hasVik: text('has_vik'),
    hasRk: text('has_rk'),
    hasPvk: text('has_pvk'),
    hasUzk: text('has_uzk'),
    hasTvmt: text('has_tvmt'),
    hasRfa: text('has_rfa'),
    hasStls: text('has_stls'),
    hasMkk: text('has_mkk'),
    vikRequest: text('vik_request'),
    vikRequestDate: date('vik_request_date'),
    rkRequest: text('rk_request'),
    rkRequestDate: date('rk_request_date'),
    pvkRequest: text('pvk_request'),
    pvkRequestDate: date('pvk_request_date'),
    uzkRequest: text('uzk_request'),
    uzkRequestDate: date('uzk_request_date'),
    pstoRequest: text('psto_request'),
    pstoRequestDate: date('psto_request_date'),
    tvmtRequest: text('tvmt_request'),
    tvmtRequestDate: date('tvmt_request_date'),
    rfaRequest: text('rfa_request'),
    rfaRequestDate: date('rfa_request_date'),
    stlsRequest: text('stls_request'),
    stlsRequestDate: date('stls_request_date'),
    mkkRequest: text('mkk_request'),
    mkkRequestDate: date('mkk_request_date'),
    pstoDate: date('psto_date'),
    heatTreatmentDiagram: text('heat_treatment_diagram'),
    pstoResult: text('psto_result'),
    pstoNote: text('psto_note'),
    vikResult: text('vik_result'),
    rkResult: text('rk_result'),
    pvkResult: text('pvk_result'),
    uzkResult: text('uzk_result'),
    tvmtResult: text('tvmt_result'),
    rfaResult: text('rfa_result'),
    stlsResult: text('stls_result'),
    mkkResult: text('mkk_result'),
    vikConclusionDate: date('vik_conclusion_date'),
    vikConclusion: text('vik_conclusion'),
    rkConclusionDate: date('rk_conclusion_date'),
    rkConclusion: text('rk_conclusion'),
    pvkConclusionDate: date('pvk_conclusion_date'),
    pvkConclusion: text('pvk_conclusion'),
    uzkConclusionDate: date('uzk_conclusion_date'),
    uzkConclusion: text('uzk_conclusion'),
    tvmtConclusionDate: date('tvmt_conclusion_date'),
    tvmtConclusion: text('tvmt_conclusion'),
    rfaConclusionDate: date('rfa_conclusion_date'),
    rfaConclusion: text('rfa_conclusion'),
    stlsConclusionDate: date('stls_conclusion_date'),
    stlsConclusion: text('stls_conclusion'),
    mkkConclusionDate: date('mkk_conclusion_date'),
    mkkConclusion: text('mkk_conclusion'),
    lnkDefectDescription: text('lnk_defect_description'),
    rkExposureConfirmedDiameter: numericNumber('rk_exposure_confirmed_diameter'),
    lnkNote: text('lnk_note'),
    weldingJournalNote: text('welding_journal_note'),
    finalStatus: text('final_status'),
    testTypes: text('test_types'),
    testContour: text('test_contour'),
    testDate: date('test_date'),
    piDate: date('pi_date'),
    boq: text('boq'),
    testBoq: text('test_boq'),
    piBoq: text('pi_boq'),
    ks3: text('ks3'),
    testKs3: text('test_ks3'),
    piKs3: text('pi_ks3'),
    pstoBoq: text('psto_boq'),
    pstoKs3: text('psto_ks3'),
    pstoCreatedAt: timestamp('psto_created_at', { withTimezone: true }),
    lnkCreatedAt: timestamp('lnk_created_at', { withTimezone: true }),
    vikBoq: text('vik_boq'),
    vikKs3: text('vik_ks3'),
    rkBoq: text('rk_boq'),
    rkKs3: text('rk_ks3'),
    pvkBoq: text('pvk_boq'),
    pvkKs3: text('pvk_ks3'),
    uzkBoq: text('uzk_boq'),
    uzkKs3: text('uzk_ks3'),
    tvmtBoq: text('tvmt_boq'),
    tvmtKs3: text('tvmt_ks3'),
    rfaBoq: text('rfa_boq'),
    rfaKs3: text('rfa_ks3'),
    stlsBoq: text('stls_boq'),
    stlsKs3: text('stls_ks3'),
    mkkBoq: text('mkk_boq'),
    mkkKs3: text('mkk_ks3'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('weld_joints_weld_date_idx').on(table.weldDate),
    index('weld_joints_project_title_idx').on(table.projectTitle),
    index('weld_joints_subtitle_code_idx').on(table.subtitleCode),
    index('weld_joints_line_idx').on(table.line),
    index('weld_joints_joint_idx').on(table.joint),
    index('weld_joints_final_status_idx').on(table.finalStatus),
    index('weld_joints_psto_required_idx').on(table.pstoRequired),
    index('weld_joints_line_joint_idx').on(table.line, table.joint),
    index('weld_joints_journal_order_idx').on(
      table.createdAt.desc().nullsLast(),
      table.weldDate.desc().nullsLast(),
      table.line.asc(),
      table.joint.asc(),
    ),
    index('weld_joints_lnk_order_idx').on(
      table.lnkCreatedAt.desc().nullsLast(),
      table.line.asc(),
      table.spool.asc(),
      table.joint.asc(),
    ),
    index('weld_joints_psto_order_idx').on(
      table.pstoCreatedAt.desc().nullsLast(),
      table.line.asc(),
      table.spool.asc(),
      table.joint.asc(),
    ),
  ],
)

export type WeldJoint = typeof weldJoints.$inferSelect
export type NewWeldJoint = typeof weldJoints.$inferInsert

export const welderStamps = pgTable('welder_stamps', {
  id: serial('id').primaryKey(),
  naksStamp: text('naks_stamp'),
  welderName: text('welder_name'),
  internalStamp: text('internal_stamp'),
  weldType: text('weld_type'),
  materialGroups: text('material_groups'),
  diameterFrom: text('diameter_from'),
  diameterTo: text('diameter_to'),
  thicknessFrom: text('thickness_from'),
  thicknessTo: text('thickness_to'),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  naksPermits: text('naks_permits'),
  dlsPermits: text('dls_permits'),
  archived: boolean('archived').default(false).notNull(),
  archivedAt: date('archived_at'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type WelderStamp = typeof welderStamps.$inferSelect
export type NewWelderStamp = typeof welderStamps.$inferInsert

export const welderStampSuspensions = pgTable('welder_stamp_suspensions', {
  id: serial('id').primaryKey(),
  naksStamp: text('naks_stamp').notNull(),
  suspendedFrom: date('suspended_from').notNull(),
  suspendedTo: date('suspended_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type WelderStampSuspension = typeof welderStampSuspensions.$inferSelect
export type NewWelderStampSuspension = typeof welderStampSuspensions.$inferInsert

export const duplicateControls = pgTable('duplicate_controls', {
  id: serial('id').primaryKey(),
  weldJointId: integer('weld_joint_id')
    .notNull()
    .references(() => weldJoints.id, { onDelete: 'cascade' }),
  method: text('method').notNull(),
  result: text('result').notNull(),
  controlDate: date('control_date'),
  conclusion: text('conclusion'),
  conclusionDate: date('conclusion_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type DuplicateControl = typeof duplicateControls.$inferSelect
export type NewDuplicateControl = typeof duplicateControls.$inferInsert

export const dispatcherAcceptedWarnings = pgTable('dispatcher_accepted_warnings', {
  key: text('key').primaryKey(),
  kind: text('kind').notNull(),
  code: text('code'),
  title: text('title'),
  context: text('context'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow().notNull(),
})

export type DispatcherAcceptedWarning = typeof dispatcherAcceptedWarnings.$inferSelect
export type NewDispatcherAcceptedWarning = typeof dispatcherAcceptedWarnings.$inferInsert

export const dispatcherTaskIndexState = pgTable('dispatcher_task_index_state', {
  id: integer('id').primaryKey(),
  sourceRevision: integer('source_revision').default(0).notNull(),
  computedRevision: integer('computed_revision').default(-1).notNull(),
  repeatedTasks: text('repeated_tasks').default('[]').notNull(),
  welderStampExpiryTasks: text('welder_stamp_expiry_tasks').default('[]').notNull(),
  duplicateKeys: text('duplicate_keys').default('[]').notNull(),
  dirtyScopes: text('dirty_scopes').default('[]').notNull(),
  fullRebuild: boolean('full_rebuild').default(true).notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type DispatcherTaskIndexState = typeof dispatcherTaskIndexState.$inferSelect

export const dispatcherRowTasks = pgTable(
  'dispatcher_row_tasks',
  {
    weldJointId: integer('weld_joint_id')
      .notNull()
      .references(() => weldJoints.id, { onDelete: 'cascade' }),
    taskKey: text('task_key').notNull(),
    code: text('code').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.weldJointId, table.taskKey] }),
    index('dispatcher_row_tasks_code_idx').on(table.code),
    index('dispatcher_row_tasks_task_key_idx').on(table.taskKey),
  ],
)

export type DispatcherRowTask = typeof dispatcherRowTasks.$inferSelect

export const dispatcherBackgroundTaskIndexState = pgTable('dispatcher_background_task_index_state', {
  id: integer('id').primaryKey(),
  status: text('status').default('idle').notNull(),
  computedSourceRevision: integer('computed_source_revision').default(-1).notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type DispatcherBackgroundTaskIndexState = typeof dispatcherBackgroundTaskIndexState.$inferSelect

export const dispatcherBackgroundRowTasks = pgTable(
  'dispatcher_background_row_tasks',
  {
    weldJointId: integer('weld_joint_id')
      .notNull()
      .references(() => weldJoints.id, { onDelete: 'cascade' }),
    taskKey: text('task_key').notNull(),
    code: text('code').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.weldJointId, table.taskKey] }),
    index('dispatcher_background_row_tasks_code_idx').on(table.code),
    index('dispatcher_background_row_tasks_task_key_idx').on(table.taskKey),
  ],
)

export type DispatcherBackgroundRowTask = typeof dispatcherBackgroundRowTasks.$inferSelect

export const derivedCalculationState = pgTable('derived_calculation_state', {
  id: integer('id').primaryKey(),
  sourceRevision: integer('source_revision').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type DerivedCalculationState = typeof derivedCalculationState.$inferSelect

export const derivedCalculationCache = pgTable(
  'derived_calculation_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    sourceRevision: integer('source_revision').notNull(),
    payload: text('payload').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('derived_calculation_cache_source_revision_idx').on(table.sourceRevision),
  ],
)

export type DerivedCalculationCache = typeof derivedCalculationCache.$inferSelect

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type AppSetting = typeof appSettings.$inferSelect
export type NewAppSetting = typeof appSettings.$inferInsert

export const documentTemplates = pgTable('document_templates', {
  id: text('id').primaryKey(),
  blobKey: text('blob_key').notNull(),
  fileName: text('file_name').notNull(),
  fileType: text('file_type').notNull(),
  fileSize: integer('file_size').notNull(),
  metadata: text('metadata').notNull(),
  options: text('options'),
  constructorConfig: text('constructor_config'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type DocumentTemplate = typeof documentTemplates.$inferSelect
export type NewDocumentTemplate = typeof documentTemplates.$inferInsert

export const generatedDocuments = pgTable(
  'generated_documents',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    periodFrom: date('period_from'),
    periodTo: date('period_to'),
    rowCount: integer('row_count').notNull().default(0),
    wdiTotal: numericNumber('wdi_total'),
    documentNumber: integer('document_number'),
    sourceMetadata: text('source_metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('generated_documents_type_created_at_idx').on(table.type, table.createdAt),
    index('generated_documents_type_period_title_idx').on(table.type, table.periodFrom, table.title),
  ],
)

export type GeneratedDocument = typeof generatedDocuments.$inferSelect
export type NewGeneratedDocument = typeof generatedDocuments.$inferInsert

export const generatedDocumentWeldJoints = pgTable(
  'generated_document_weld_joints',
  {
    documentId: integer('document_id')
      .notNull()
      .references(() => generatedDocuments.id, { onDelete: 'cascade' }),
    weldJointId: integer('weld_joint_id')
      .notNull()
      .references(() => weldJoints.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.weldJointId] }),
    index('generated_document_weld_joints_weld_joint_idx').on(table.weldJointId),
  ],
)

export type GeneratedDocumentWeldJoint = typeof generatedDocumentWeldJoints.$inferSelect
export type NewGeneratedDocumentWeldJoint = typeof generatedDocumentWeldJoints.$inferInsert
