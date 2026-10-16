import type { WeldFieldKey } from './weld-fields'

// Shared presentation policy for report fields. Applied only by the welding
// journal for now; LNK/PSTO adopt it when their AG Grid migration is authorised.
// Keep alignment stable by column, never by the length of an individual value.
export const REPORT_LEFT_ALIGNED_FIELDS: ReadonlySet<WeldFieldKey> = new Set<WeldFieldKey>([
  'projectTitle', 'subtitleCode', 'line', 'groupName', 'isometry', 'spool', 'spoolId',
  'element1', 'element2', 'material1', 'material2', 'materialId1', 'materialId2',
  'orderCode1', 'orderCode2', 'materialUniqueNumber1', 'materialUniqueNumber2',
  'materialFullName1', 'materialFullName2', 'materialNormativeDocument1', 'materialNormativeDocument2',
  'materialCertificateNumber1', 'materialCertificateNumber2', 'responsible',
  'technologyCardNumber', 'weldingElectrodes', 'weldingElectrodesCertificateNumber',
  'fillerWire', 'fillerWireCertificateNumber', 'shieldingGas', 'shieldingGasCertificateNumber',
  'controlBasisSummary', 'vikControlBasis', 'rkControlBasis', 'uzkControlBasis', 'pvkControlBasis', 'pstoControlBasis', 'tvmtControlBasis',
  'vikRequest', 'rkRequest', 'uzkRequest', 'pvkRequest', 'pstoRequest', 'tvmtRequest',
  'vikConclusion', 'rkConclusion', 'uzkConclusion', 'pvkConclusion', 'tvmtConclusion',
  'preVikRequest', 'preRkRequest', 'preUzkRequest', 'prePvkRequest',
  'preVikConclusion', 'preRkConclusion', 'preUzkConclusion', 'prePvkConclusion',
  'vikDefectDescription', 'lnkDefectDescription', 'uzkDefectDescription', 'pvkDefectDescription',
  'preVikDefectDescription', 'preRkDefectDescription', 'preUzkDefectDescription', 'prePvkDefectDescription',
  'rkExposureScheme', 'preRkExposureScheme', 'heatTreatmentDiagram',
  'weldingJournalNote', 'lnkNote', 'pstoNote', 'testContour',
  'jsrDocument', 'checklistDocument', 'zniDocument',
])
