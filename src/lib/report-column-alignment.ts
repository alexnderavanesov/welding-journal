import type { WeldFieldKey } from './weld-fields'

// Shared presentation policy for the welding journal, LNK and PSTO grids.
// Keep alignment stable by column, never by the length of an individual value.
export const REPORT_LEFT_ALIGNED_FIELDS: ReadonlySet<WeldFieldKey> = new Set<WeldFieldKey>([
  'projectTitle', 'subtitleCode', 'line', 'groupName', 'isometry', 'spool', 'spoolId',
  'preHeatTreatmentRequired',
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
  'jsrDocument', 'checklistDocument', 'zniDocument', 'custom1Document', 'custom2Document',
])
