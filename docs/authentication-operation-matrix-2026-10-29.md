# Матрица доступа — реализация 29.10.2026

Статус: локальная реализация, не выпуск. Better Auth 1.7.14; использованы официальные MCP и четыре skills. Реестр содержит 181 RPC, включая обновление активности; результаты реализации и границы проверок — в [отчёте](authentication-implementation-2026-10-30.md). Итоговая предкоммитная проверка описана отдельно.

Каждый RPC внесён в явный реестр; неизвестный обработчик закрыт. Динамические политики разрешают только известную область отчёта/изменения, ключ настроек или вид документа. Файловый HTTP API проверяется отдельно. Внутренние проверки бизнес-правил сохраняются. Владелец и администратор имеют рабочие разрешения; управление администраторами доступно только владельцу.

`@identity` — общие справочные правила, необходимые уже вошедшему пользователю для интерфейса; они не разрешают изменения настроек. `@account` — собственные проверки владельца/администратора, версии и неизменяемых полей. Старые RPC общих паролей удалены.

`@lineIdentity` — только общие свойства одной линии: просмотр линий **или** сварочного журнала (для автозаполнения карточки). `@weldDataUsage` — агрегаты использования справочных значений: просмотр настроек данных, системных индексов **или** журнала. Эти исключения не открывают полный отчёт другой области; сервер проверяет одно из явно разрешённых прав.

Ответы фильтруются с учётом предметной области операции (`access-response.ts`). Параметры ТК, настройки программы линии и агрегаты статистики не являются полями конкретного стыка, даже при совпадении названия ключа. История использует собственную проверку области сущности и полей стыка. Списки стыков, включая вложенную таблицу программы, сохраняют фильтрацию скрытых рабочих полей. Поиск программы по линии/клейму не относится к общему поиску по полям стыков.

| RPC | Правило |
| --- | --- |
| `activity-api.ts#listActivityHistory` | `@identity` |
| `activity-api.ts#getActivityDetails` | `@identity` |
| `activity-api.ts#getActivityFilters` | `@identity` |
| `app-settings.ts#listAppSettingsSnapshot` | `@identity` |
| `app-settings.ts#saveAppSetting` | `@settingEdit` |
| `dispatcher-task-pages.ts#searchDispatcherTaskPages` | `@workingViews` |
| `dispatcher-task-pages.ts#getDispatcherTaskBatch` | `@workingViews` |
| `psto-chain-exceptions.ts#getPstoChainExceptionPreview` | `psto.view` |
| `psto-chain-exceptions.ts#savePstoChainException` | `psto.edit` |
| `psto-chain-exceptions.ts#searchPstoExceptionJoints` | `psto.view` |
| `psto-chain-exceptions.ts#listPstoChainExceptions` | `psto.view` |
| `psto-chain-exceptions.ts#listPstoExceptionFilterOptions` | `psto.view` |
| `psto-chain-exceptions.ts#getPstoExceptionRowId` | `psto.view` |
| `psto-chain-exceptions.ts#closeEmptyPstoChainException` | `psto.edit` |
| `weld-mutations-api.ts#createEarlyCoilDecision` | `welding.edit` |
| `weld-mutations-api.ts#createWeldJoint` | `welding.edit` |
| `weld-mutations-api.ts#updateWeldJoint` | `@mutation` |
| `weld-mutations-api.ts#previewLnkOfficialityChange` | `lnk.view` |
| `weld-mutations-api.ts#applyLnkOfficialityChange` | `lnk.edit` |
| `weld-mutations-api.ts#moveWeldJointChain` | `welding.edit` |
| `weld-mutations-api.ts#updateSystemWeldJoint` | `welding.edit` |
| `weld-mutations-api.ts#createWeldJoints` | `welding.edit` |
| `weld-mutations-api.ts#updateWeldJoints` | `@mutation` |
| `weld-mutations-api.ts#extendLnkRequest` | `lnk.edit` |
| `weld-mutations-api.ts#clearLnkRequestPosition` | `lnk.delete` |
| `weld-mutations-api.ts#updateLnkDefectDescription` | `lnk.edit` |
| `weld-mutations-api.ts#manageLnkRequestDocument` | `lnk.edit` |
| `weld-mutations-api.ts#managePstoRequestDocument` | `psto.edit` |
| `weld-mutations-api.ts#changeSystemDocumentDate` | `@documentEdit` |
| `weld-mutations-api.ts#deleteWeldJoint` | `welding.delete` |
| `weld-mutations-api.ts#deleteObsoleteRepeatedJoint` | `welding.delete` |
| `weld-mutations-api.ts#deleteWeldJoints` | `welding.delete` |
| `line-program-report.ts#getLineProgramReport` | `lines.export` |
| `system-document-sequences.ts#getSystemDocumentSequences` | `@identity` |
| `system-document-sequences.ts#previewSystemDocumentNames` | `@identity` |
| `system-document-sequences.ts#getSystemDocumentSequence` | `@identity` |
| `system-document-sequences.ts#resetSystemDocumentSequence` | `numbering.edit` |
| `statistics.ts#getStatisticsServerResult` | `statistics.view` |
| `system-documents.ts#listSystemDocumentHistoryGrid` | `documents.view` |
| `system-documents.ts#checkSystemDocumentNameConflict` | `documents.view` |
| `system-documents.ts#listSystemDocumentHistoryFilterOptions` | `documents.view` |
| `system-documents.ts#getSystemDocumentRows` | `documents.view` |
| `system-documents.ts#getSystemDocumentSpecialists` | `documents.view` |
| `system-documents.ts#getSystemDocumentDateContext` | `documents.view` |
| `weld-import-api.ts#listWeldingJournalImportScope` | `welding.view` |
| `weld-import-api.ts#massFillWeldJoints` | `welding.import` |
| `weld-import-api.ts#replaceWeldJoints` | `@replace` |
| `weld-import-api.ts#importWeldJoints` | `welding.import` |
| `line-program-control.ts#applyLineProgramControl` | `lines.edit` |
| `line-program-control.ts#previewLineProgramControl` | `lines.view` |
| `line-program-control.ts#changeLayeredControl` | `lines.edit` |
| `dispatcher-warnings.ts#acceptDispatcherWarning` | `exceptions.edit` |
| `dispatcher-warnings.ts#listDispatcherAcceptedWarnings` | `exceptions.view` |
| `dispatcher-warnings.ts#revokeDispatcherAcceptedWarning` | `exceptions.edit` |
| `pre-heat-treatment-lnk-workflow.ts#savePreHeatTreatmentLnkWorkflow` | `lnk.edit` |
| `pre-heat-treatment-lnk-workflow.ts#updatePreHeatTreatmentRkExposure` | `lnk.edit` |
| `pre-heat-treatment-lnk-workflow.ts#savePreHeatTreatmentLnkResultEdits` | `lnk.edit` |
| `pre-heat-treatment-lnk-workflow.ts#correctPreHeatTreatmentLnkResult` | `lnk.edit` |
| `control-process-settings-api.ts#getControlProcessSettingsOverview` | `processes.view` |
| `control-process-settings-api.ts#getPreHeatTreatmentDisableBlockerRowIds` | `processes.view` |
| `document-operations.ts#planDocumentOperationBatches` | `documents.view` |
| `document-operations.ts#previewDocumentOperation` | `documents.view` |
| `document-operations.ts#applyDocumentOperation` | `@documentEdit` |
| `document-operations.ts#getDocumentOperationResult` | `documents.view` |
| `document-operations.ts#getDocumentOperationComposition` | `documents.view` |
| `journal-grid-api.ts#readJournalGrid` | `@report` |
| `journal-grid-api.ts#readJournalGridBlocks` | `@report` |
| `journal-grid-api.ts#selectJournalGridRows` | `@report` |
| `journal-grid-api.ts#selectJournalGridRange` | `@report` |
| `journal-grid-api.ts#summarizeJournalGridRange` | `@report` |
| `journal-grid-api.ts#copyJournalGridRange` | `@report` |
| `journal-grid-api.ts#countJournalGridSelection` | `@report` |
| `journal-grid-api.ts#summarizeJournalGridSelection` | `@report` |
| `journal-grid-api.ts#summarizeJournalGridArea` | `@report` |
| `journal-grid-api.ts#listJournalReportRows` | `@report` |
| `journal-grid-api.ts#getJournalReportSummary` | `@report` |
| `journal-grid-api.ts#listJournalFilterOptions` | `@report` |
| `journal-grid-api.ts#readJournalFilterPage` | `@report` |
| `journal-grid-api.ts#selectJournalFilterValues` | `@report` |
| `dispatcher-background-task-functions.ts#getDispatcherBackgroundStatus` | `@identity` |
| `dispatcher-background-task-functions.ts#refreshDispatcherBackgroundNow` | `indexes.edit` |
| `line-program-approvals.ts#changeLineProgramApprovals` | `lines.edit` |
| `welder-stamps.ts#loadWelderStampRegistrySnapshot` | `references.view` |
| `welder-stamps.ts#saveWelderStampRecords` | `references.edit` |
| `welder-stamps.ts#saveWelderStampSuspensionRecords` | `references.edit` |
| `dispatcher-task-context.ts#getDispatcherTaskContext` | `@workingViews` |
| `specialists.ts#listSpecialists` | `references.view` |
| `specialists.ts#archiveSpecialist` | `references.delete` |
| `specialists.ts#saveSpecialist` | `references.edit` |
| `specialists.ts#assignDocumentSpecialists` | `@documentEdit` |
| `psto-repeat-workflow.ts#savePstoRepeatWorkflow` | `psto.edit` |
| `psto-repeat-workflow.ts#correctPstoCycleStage` | `psto.edit` |
| `psto-repeat-workflow.ts#correctPstoTvmtAndRemoveLaterCycles` | `psto.delete` |
| `line-program-card-impact.ts#getWeldLineProgramImpact` | `lines.view` |
| `technology-cards-api.ts#getTechnologyCardPage` | `references.view` |
| `technology-cards-api.ts#getTechnologyCardSnapshot` | `references.view` |
| `technology-cards-api.ts#changeTechnologyCard` | `@referenceChange` — создание/правка: `references.edit`; архив/удаление: `references.delete` |
| `technology-cards-api.ts#previewTechnologyCardAssignments` | `references.view` |
| `technology-cards-api.ts#getTechnologyCardAssignmentDetails` | `references.view` |
| `technology-cards-api.ts#applyTechnologyCardAssignmentBatch` | `welding.edit` |
| `chain-actuality.ts#previewChainActuality` | `welding.view` |
| `chain-actuality.ts#setChainActuality` | `welding.edit` |
| `duplicate-controls.ts#listDuplicateControlCandidatePage` | `lnk.view` |
| `duplicate-controls.ts#listDuplicateControlCandidateIds` | `lnk.view` |
| `duplicate-controls.ts#listDuplicateControlCandidateRowsByIds` | `lnk.view` |
| `duplicate-controls.ts#listDuplicateControlRegistryPage` | `lnk.view` |
| `duplicate-controls.ts#saveDuplicateControl` | `lnk.edit` |
| `duplicate-controls.ts#saveDuplicateControls` | `lnk.edit` |
| `duplicate-controls.ts#deleteDuplicateControl` | `lnk.delete` |
| `coil-restoration.ts#previewEarlyCoilCorrection` | `welding.view` |
| `coil-restoration.ts#cancelErroneousEarlyCoil` | `welding.delete` |
| `coil-restoration.ts#previewCoilRestoration` | `welding.view` |
| `coil-restoration.ts#restoreErroneousCoil` | `welding.edit` |
| `coil-restoration.ts#getCoilRestorationHistory` | `welding.view` |
| `account-api.ts#getCurrentAccount` | `@account` |
| `account-api.ts#refreshAccountActivity` | `@account` |
| `account-api.ts#listAccounts` | `@account` |
| `account-api.ts#inviteAccount` | `@account` |
| `account-api.ts#changeAccount` | `@account` |
| `account-api.ts#sendManagedLink` | `@account` |
| `account-api.ts#deleteAccount` | `@account` |
| `account-api.ts#completeAccountLink` | `@account` |
| `account-api.ts#updateOwnProfile` | `@account` |
| `account-api.ts#changeOwnPassword` | `@account` |
| `document-templates-api.ts#listRemoteDocumentTemplatesWithFiles` | `@templateRead` |
| `document-templates-api.ts#getRemoteDocumentTemplateInventory` | `templates.view` |
| `document-templates-api.ts#cleanupRemoteDocumentTemplateFiles` | `templates.delete` |
| `document-templates-api.ts#listRemoteDocumentTemplateIds` | `@templateRead` |
| `document-templates-api.ts#getRemoteDocumentTemplate` | `@templateRead` |
| `document-templates-api.ts#saveRemoteDocumentTemplate` | `templates.edit` |
| `document-templates-api.ts#updateRemoteDocumentTemplate` | `templates.edit` |
| `document-templates-api.ts#deleteRemoteDocumentTemplate` | `templates.delete` |
| `generated-documents.ts#listRemoteGeneratedDocumentHistoryGrid` | `documents.view` |
| `generated-documents.ts#listRemoteGeneratedDocumentHistoryFilterOptions` | `documents.view` |
| `generated-documents.ts#getRemoteGeneratedDocument` | `documents.export` |
| `generated-documents.ts#saveRemoteGeneratedDocuments` | `documents.generate` |
| `generated-documents.ts#getRemoteGeneratedDocumentSequence` | `@documentSequenceRead` |
| `generated-documents.ts#resetRemoteGeneratedDocumentSequence` | `numbering.edit` |
| `generated-documents.ts#getRemoteGeneratedDocumentRows` | `documents.view` |
| `generated-documents.ts#deleteRemoteGeneratedDocument` | `documents.delete` |
| `dispatcher-task-snapshot.ts#getDispatcherTaskVersion` | `@identity` |
| `dispatcher-task-snapshot.ts#getDispatcherTaskSnapshot` | `@workingViews` |
| `dispatcher-task-snapshot.ts#refreshDispatcherTaskSnapshot` | `@workingViews` |
| `document-specialist-transfer-preview.ts#previewSpecialistTransfer` | `documents.view` |
| `psto-line-assignment.ts#listPstoLineAssignmentPage` | `psto.view` |
| `psto-line-assignment.ts#listPstoLineFilterOptions` | `psto.view` |
| `psto-line-assignment.ts#getPstoLineRemovalPreview` | `psto.view` |
| `psto-line-assignment.ts#getPstoWeldLineMovePreview` | `psto.view` |
| `psto-line-assignment.ts#savePstoLineAssignment` | `psto.edit` |
| `wdi-recalculation.ts#previewWdiRecalculation` | `wdi.view` |
| `wdi-recalculation.ts#recalculateWdi` | `wdi.edit` |
| `document-grouping-preferences.ts#getDocumentGroupingDefaults` | `@identity` |
| `line-program.ts#findLineProgram` | `@lineIdentity` |
| `line-program.ts#getLineProgramSection` | `lines.view` |
| `line-program.ts#getLineProgramPage` | `lines.view` |
| `line-program.ts#getLineProgramsForImport` | `lines.view` |
| `line-program.ts#getLineProgramCalculation` | `lines.view` |
| `line-program.ts#getLineProgramJointPage` | `lines.view` |
| `line-program.ts#getLineProgramExplanation` | `lines.view` |
| `line-program.ts#saveLineProgram` | `lines.edit` |
| `weld-read-api.ts#getLnkWorkflowSummary` | `lnk.view` |
| `weld-read-api.ts#getLnkWorkflowRequestSummary` | `lnk.view` |
| `weld-read-api.ts#listLnkWorkflowRows` | `lnk.view` |
| `weld-read-api.ts#getPstoWorkflowSummary` | `psto.view` |
| `weld-read-api.ts#getPstoWorkflowRequestOptions` | `psto.view` |
| `weld-read-api.ts#listPstoWorkflowRows` | `psto.view` |
| `weld-read-api.ts#listWeldJointSnapshotPage` | `welding.view` |
| `weld-read-api.ts#readReportOutputSnapshot` | `@reportExport` |
| `weld-read-api.ts#listWeldReportContextRows` | `@report` |
| `weld-read-api.ts#listWeldFinalStatusContextKeys` | `@workingViews` |
| `weld-read-api.ts#listWeldFormSuggestions` | `welding.view` |
| `weld-read-api.ts#listWeldJointChain` | `welding.view` |
| `weld-read-api.ts#getWeldJointById` | `welding.view` |
| `weld-read-api.ts#listWeldingJournalPage` | `welding.view` |
| `weld-read-api.ts#getWeldReportSummary` | `@report` |
| `weld-read-api.ts#listLnkReportPage` | `lnk.view` |
| `weld-read-api.ts#listHeatTreatmentReportPage` | `psto.view` |
| `weld-read-api.ts#listWeldColumnFilterOptions` | `@report` |
| `weld-read-api.ts#getDocumentGenerationData` | `documents.generate` |
| `weld-read-api.ts#getWeldDataUsageSummary` | `@weldDataUsage` |
| `weld-read-api.ts#listWeldJointRowsByIds` | `welding.view` |

`@workingViews` требует просмотра журнала, ЛНК и ПСТО для общей сводки диспетчера. `@templateRead` разрешает шаблон при просмотре шаблонов либо формировании/выгрузке документов. `@documentEdit` проверяет сохранённые типы документов и права каждой затронутой специальности.

Ранняя катушка и её отмена требуют `exceptions.edit`; отмена заявки — `.delete` соответствующей специальности; создание пользовательских документов — `documents.generate` и `.generate` соответствующей области; архив/удаление ТК — `references.delete`. Общий поиск требует просмотра трёх рабочих областей; фильтры доступных столбцов сохраняются.

`@replace` требует `welding.import` и добавляет `welding.delete`, только когда действительно удаляются записи. Импорт изменённых исторических фактов ЛНК/ПСТО дополнительно требует `.edit` соответствующей специальности. Запрещённая часть отклоняет весь запрос.

Удаление этапа ПСТО/НК до ТВМТ требует `.delete` специальности; снятие послойного контроля — `lines.delete`. Принятие превышений программы и изменение согласований требуют `exceptions.edit`. Удаление/архив клейма, снятие его запрета и архив специалиста требуют `references.delete`; проверки выполняются по сохранённым данным внутри операции.

Чтение следующего номера пользовательского документа доступно с просмотром документов, шаблонов либо настроек нумерации. Изменение счётчика по-прежнему требует `numbering.edit`; удаление шаблона и очистка его файлов — `templates.delete`, независимо от `templates.edit`.

Ответы собственных реестров, профиля и общих настроек сохраняют свои идентификаторы, версии, параметры допусков и конфигурацию шаблонов. Совпадение имени свойства с полем стыка не превращает его в рабочий факт. История проверяет видимость областей и полей до выдачи списка/подробностей; повторная фильтрация по именам полей стыка не применяется к уже разрешённым событиям. Смешанные ответы программы линий сохраняют настройки линии, но по-прежнему скрывают закрытые поля вложенных стыков. Неизвестные операции автоматически не освобождаются от фильтрации.
