#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function iterator(values) {
  let index = 0;
  return { hasNext: () => index < values.length, next: () => values[index++] };
}

const moves = [];

function file(id, name, initialContent = `${id}-content`) {
  let content = initialContent;
  let trashed = false;
  const parents = [];
  const sourceFile = {
    getId: () => id,
    getName: () => name,
    getUrl: () => `https://example.test/file/${id}`,
    getSize: () => content.length,
    getLastUpdated: () => new Date(0),
    getParents: () => iterator(parents),
    getBlob: () => ({
      getDataAsString: () => content,
      getContentType: () => 'image/jpeg',
      getBytes: () => [1, 2, 3]
    }),
    setContent: value => { content = value; },
    setTrashed: value => { trashed = value; },
    isTrashed: () => trashed,
    setParent: parentFolder => {
      parents.length = 0;
      parents.push(parentFolder);
    },
    moveTo: (destination) => moves.push({ type: 'file', id, destination })
  };
  return sourceFile;
}

function folder(id, name, initialFiles = [], initialFolders = []) {
  const files = [...initialFiles];
  const folders = [...initialFolders];
  const parents = [];
  const sourceFolder = {
    getId: () => id,
    getName: () => name,
    getUrl: () => `https://example.test/folder/${id}`,
    getFiles: () => iterator(files),
    getFolders: () => iterator(folders),
    getFoldersByName: folderName => iterator(folders.filter(childFolder => childFolder.getName() === folderName)),
    getFilesByName: fileName => iterator(files.filter(sourceFile =>
      sourceFile.getName() === fileName && !sourceFile.isTrashed())),
    getParents: () => iterator(parents),
    addFile: sourceFile => {
      files.push(sourceFile);
      sourceFile.setParent(sourceFolder);
    },
    addFolder: childFolder => {
      folders.push(childFolder);
      childFolder.setParent(sourceFolder);
    },
    createFile: (fileName, content, mimeType) => {
      if (!mimeType) {
        throw new Error('Argument cannot be null: mimeType');
      }
      const created = file(`created-${files.length}`, fileName, content);
      sourceFolder.addFile(created);
      return created;
    },
    createFolder: folderName => {
      const created = folder(`created-folder-${folders.length}`, folderName);
      sourceFolder.addFolder(created);
      return created;
    },
    setParent: parentFolder => {
      parents.length = 0;
      parents.push(parentFolder);
    },
    moveTo: (destination) => moves.push({ type: 'folder', id, destination })
  };
  files.forEach(sourceFile => sourceFile.setParent(sourceFolder));
  folders.forEach(childFolder => childFolder.setParent(sourceFolder));
  return sourceFolder;
}

const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), context);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), context);
context.sha256_ = value => String(value);
context.MimeType = {};
const scriptProperties = {};
context.getScriptProperty_ = key => scriptProperties[key] || '';
context.PropertiesService = { getScriptProperties: () => ({
  setProperty: (key, value) => { scriptProperties[key] = String(value); },
  deleteProperty: key => { delete scriptProperties[key]; },
  getProperties: () => Object.assign({}, scriptProperties)
}) };
const nativeNormalizeExpenseJsonWithAi = context.normalizeExpenseJsonWithAi_;
const nativeCleanupIntakeStages = context.cleanupIntakeStages_;

const config = {
  intake_keyword: 'HoStello',
  archive_folder_name: 'Importazioni',
  excluded_root_folder_names: ['Ricevute', '_Test-fixtures', 'Importazioni']
};
const nested = folder('nested', 'Nested', [file('nested-json', 'transactions-hostello-202604.json')]);
const parent = folder('parent', 'Collection', [], [nested]);
const child = folder('child', 'Child', [file('child-json', 'transactions-hostello-202606.json')]);
const monthly = folder('monthly', 'Monthly', [file('monthly-json', 'transactions-hostello-202605.json')], [child]);
const ignored = folder('ignored', 'Importazioni', [file('ignored-json', 'transactions-hostello-202601.json')]);
const root = folder('root', 'Spese', [file('root-json', 'transactions-hostello-202607.json')],
  [parent, monthly, ignored]);

const sources = context.listEligibleIntakeSources_(root, config);
assert.deepEqual(JSON.parse(JSON.stringify(sources.map((source) => ({
  archiveType: source.archiveType,
  displayName: source.displayName,
  fileIds: source.files.map((sourceFile) => sourceFile.getId())
})))), [
  { archiveType: 'folder', displayName: 'Child', fileIds: ['child-json'] },
  { archiveType: 'folder', displayName: 'Nested', fileIds: ['nested-json'] },
  { archiveType: 'folder', displayName: 'Monthly', fileIds: ['monthly-json'] },
  { archiveType: 'file', displayName: 'transactions-hostello-202607.json', fileIds: ['root-json'] }
]);

const historicalSources = context.listHistoricalTricountJsonSources_(root, config);
assert.deepEqual(JSON.parse(JSON.stringify(historicalSources.map((source) => ({
  archiveType: source.archiveType,
  archiveContainerId: source.archiveContainerId,
  fileId: source.file.getId(),
  folderId: source.folder.getId()
})))), [
  { archiveType: 'folder', archiveContainerId: 'nested', fileId: 'nested-json', folderId: 'nested' },
  { archiveType: 'folder', archiveContainerId: 'child', fileId: 'child-json', folderId: 'child' },
  { archiveType: 'folder', archiveContainerId: 'monthly', fileId: 'monthly-json', folderId: 'monthly' },
  { archiveType: 'file', archiveContainerId: 'root-json', fileId: 'root-json', folderId: 'root' }
]);

context.getAutomationConfig_ = () => config;
context.getArchiveFolderName_ = () => 'Importazioni';
context.getOrCreateChildFolder_ = (parentFolder, name) => ({ parentFolder, name });

const rootFileSource = sources.find((source) => source.archiveType === 'file');
const rootFileSnapshot = context.getDriveJsonFileSnapshot_(rootFileSource.files[0]);
assert.doesNotThrow(() => context.assertIntakeSourceUnchanged_(rootFileSource, root, config, [rootFileSnapshot]));
rootFileSource.files[0].setContent('changed-content');
assert.throws(
  () => context.assertIntakeSourceUnchanged_(rootFileSource, root, config, [rootFileSnapshot]),
  /root JSON changed during import/
);
rootFileSource.files[0].setContent('root-json-content');
context.archiveIntakeSource_(rootFileSource, root, [{ date: '2026-07-01' }]);
assert.deepEqual(moves.map((move) => ({ type: move.type, id: move.id, name: move.destination.name })), [
  { type: 'file', id: 'root-json', name: '2026' }
]);

moves.length = 0;
const filesById = {
  'root-json': rootFileSource.files[0]
};
const foldersById = { child, monthly, nested };
context.DriveApp = {
  getFileById: (id) => filesById[id],
  getFolderById: (id) => foldersById[id]
};
context.archiveRebuiltSources_(root, [
  {
    source: {
      fileId: 'monthly-json', name: 'transactions-hostello-202605.json',
      contentHash: 'monthly-json-content', archiveType: 'folder',
      archiveContainerId: 'monthly', archiveDepth: 1
    },
    records: [{ date: '2026-05-01' }]
  },
  {
    source: {
      fileId: 'child-json', name: 'transactions-hostello-202606.json',
      contentHash: 'child-json-content', archiveType: 'folder',
      archiveContainerId: 'child', archiveDepth: 2
    },
    records: [{ date: '2026-06-01' }]
  },
  {
    source: {
      fileId: 'root-json', name: 'transactions-hostello-202607.json',
      contentHash: 'root-json-content', archiveType: 'file',
      archiveContainerId: 'root-json', archiveDepth: 0
    },
    records: [{ date: '2026-07-01' }]
  }
], config);
assert.deepEqual(moves.map((move) => ({ type: move.type, id: move.id, name: move.destination.name })), [
  { type: 'folder', id: 'child', name: '2026' },
  { type: 'folder', id: 'monthly', name: '2026' },
  { type: 'file', id: 'root-json', name: '2026' }
]);

moves.length = 0;
monthly.addFile(file('late-json', 'transactions-hostello-202608.json'));
assert.throws(() => context.archiveRebuiltSources_(root, [
  {
    source: {
      fileId: 'monthly-json', name: 'transactions-hostello-202605.json',
      contentHash: 'monthly-json-content', archiveType: 'folder',
      archiveContainerId: 'monthly', archiveDepth: 1
    },
    records: [{ date: '2026-05-01' }]
  }
], config), /changed before archival/);
assert.deepEqual(moves, []);

const nestedReceipt = file('nested-receipt', 'receipt.jpg');
const evidenceFolder = folder('evidence', 'Evidence', [], [folder('attachments', 'Attachments', [nestedReceipt])]);
assert.equal(context.findNamedFile_(evidenceFolder, ['receipt.jpg'], false), null);
assert.equal(context.findNamedFile_(evidenceFolder, ['receipt.jpg'], true), nestedReceipt);
const directReceipt = file('direct-receipt', 'receipt.jpg');
evidenceFolder.addFile(directReceipt);
assert.equal(context.findNamedFile_(evidenceFolder, ['receipt.jpg'], false), directReceipt);

const childSourceReceipt = file('child-source-receipt', 'shared-receipt.jpg');
const childSourceFolder = folder('child-source-evidence', 'Child source', [
  file('child-source-json', 'transactions-hostello-202612.json'), childSourceReceipt
]);
const parentEvidenceFolder = folder('parent-evidence', 'Parent evidence', [
  file('parent-source-json', 'transactions-hostello-202611.json')
], [childSourceFolder]);
assert.equal(context.findNamedFileWithinSourceUnit_(
  parentEvidenceFolder, ['shared-receipt.jpg'], config
), null);
const supportingReceipt = file('supporting-receipt', 'supporting.jpg');
parentEvidenceFolder.addFolder(folder('supporting-files', 'Supporting files', [supportingReceipt]));
assert.equal(context.findNamedFileWithinSourceUnit_(
  parentEvidenceFolder, ['supporting.jpg'], config
), supportingReceipt);

const stableJson = file('stable-json', 'transactions-hostello-202609.json');
const stableFolder = folder('stable', 'Stable', [stableJson]);
root.addFolder(stableFolder);
const stableSource = context.createFolderIntakeSource_(stableFolder, [stableJson], 1);
const stableSnapshot = context.getDriveJsonFileSnapshot_(stableJson);
assert.doesNotThrow(() => context.assertIntakeSourceUnchanged_(
  stableSource, root, config, [stableSnapshot]
));
stableFolder.addFolder(folder('late-child', 'Late child', [
  file('late-child-json', 'transactions-hostello-202610.json')
]));
assert.throws(() => context.assertIntakeSourceUnchanged_(
  stableSource, root, config, [stableSnapshot]
), /gained an unprocessed nested JSON/);

context.withExpenseLock_ = (source, callback) => ({ source, result: callback() });
context.runExpenseCataloging_ = source => `processed:${source}`;
assert.deepEqual(JSON.parse(JSON.stringify(context.processExpenseIntake())), {
  source: 'manual-scan', result: 'processed:manual'
});

const fixtureFolder = folder('fixture-folder', '_Test-fixtures', [
  file('fixture-json', 'transactions-hostello-202612.json')
]);
root.addFolder(fixtureFolder);
context.assertCatalogConfiguration_ = () => {};
context.getRootFolderId_ = () => 'root';
context.DriveApp = {
  getFolderById: id => ({ root, 'fixture-folder': fixtureFolder })[id]
};
assert.throws(() => context.processExpenseFolder('fixture-folder'), /excluded from expense intake/);

function rebuildRootSourceDescriptor(sourceFile, rootFolder) {
  return {
    fileId: sourceFile.getId(), folderId: rootFolder.getId(), name: sourceFile.getName(),
    contentHash: `${sourceFile.getId()}-content`, archiveType: 'file',
    archiveContainerId: sourceFile.getId(), archiveDepth: 0
  };
}

const retryRootJson = file('retry-root-json', 'transactions-hostello-202701.json');
const retryRoot = folder('retry-root', 'Retry root', [retryRootJson]);
const retryExpected = [rebuildRootSourceDescriptor(retryRootJson, retryRoot)];
context.DriveApp = {
  getFileById: id => ({ 'retry-root-json': retryRootJson })[id],
  getFolderById: () => null
};
assert.doesNotThrow(() => context.assertJsonRebuildDiscoveryUnchanged_(
  retryRoot, config, retryExpected, true
));
retryRoot.addFile(file('new-retry-json', 'transactions-hostello-202702.json'));
assert.throws(() => context.assertJsonRebuildDiscoveryUnchanged_(
  retryRoot, config, retryExpected, true
), /Eligible JSON sources changed during rebuild staging/);

const archivedJson = file('archived-json', 'transactions-hostello-202703.json');
const archiveYear = folder('archive-year', '2027', [archivedJson]);
const archiveFolder = folder('archive', 'Importazioni', [], [archiveYear]);
const archivedRoot = folder('archived-root', 'Archived root', [], [archiveFolder]);
const archivedExpected = [rebuildRootSourceDescriptor(archivedJson, archivedRoot)];
context.DriveApp = {
  getFileById: id => ({ 'archived-json': archivedJson })[id],
  getFolderById: () => null
};
assert.doesNotThrow(() => context.assertJsonRebuildDiscoveryUnchanged_(
  archivedRoot, config, archivedExpected, true
));
const outsideFolder = folder('outside', 'Outside', [archivedJson]);
archivedJson.setParent(outsideFolder);
assert.throws(() => context.assertJsonRebuildDiscoveryUnchanged_(
  archivedRoot, config, archivedExpected, true
), /moved outside intake or archive/);

context.CONFIG = { TRICOUNT_JSON_NORMALIZATION_BATCH_SIZE: 1 };
const batchRecords = [
  { sourceTransactionId: 'batch-1', transactionType: 'expense' },
  { sourceTransactionId: 'batch-2', transactionType: 'expense' }
];
const batchStages = {};
const batchController = {
  load: batchIndex => batchStages[batchIndex] || null,
  save: (batchIndex, sourceRecords, records) => { batchStages[batchIndex] = records; }
};
let batchGeminiCalls = 0;
context.callGeminiJson_ = () => {
  batchGeminiCalls += 1;
  if (batchGeminiCalls === 2) {
    throw new Error('batch 2 timeout');
  }
  return { records: [{
    category: 'Other', subcategory: 'Other', merchant: '', confidence: 1,
    rationale: 'test', conflict: false
  }] };
};
const batchConfig = { categories: { Other: ['Other'] } };
assert.throws(() => nativeNormalizeExpenseJsonWithAi(
  batchRecords, file('batch-json', 'transactions-hostello-batch.json'),
  folder('batch-folder', 'Batch'), '', batchConfig, true, batchController
), /batch 2 timeout/);
assert.equal(batchGeminiCalls, 2);
batchStages[0][0].merchant = 'Amazon.it';
const resumedBatchRecords = nativeNormalizeExpenseJsonWithAi(
  batchRecords, file('batch-json', 'transactions-hostello-batch.json'),
  folder('batch-folder', 'Batch'), '', batchConfig, true, batchController
);
assert.equal(batchGeminiCalls, 3);
assert.deepEqual(resumedBatchRecords.map(record => record.sourceTransactionId), ['batch-1', 'batch-2']);
assert.deepEqual(resumedBatchRecords.map(record => record.merchant), ['amazon', '']);

const incomeRefundRecord = {
  sourceTransactionId: 'income-refund', transactionType: 'income', amount: -10,
  incomeReportingType: 'refund', description: 'Rimborso spesa grocery'
};
const nonSpendingIncomeRecord = {
  sourceTransactionId: 'income-funding', transactionType: 'income', amount: -10,
  incomeReportingType: 'non_spending', description: 'Rimborso deposito'
};
const transferRecord = {
  sourceTransactionId: 'cash-settlement', transactionType: 'transfer', amount: 10
};
context.CONFIG = { TRICOUNT_JSON_NORMALIZATION_BATCH_SIZE: 10 };
let incomeClassificationCalls = 0;
context.callGeminiJson_ = prompt => {
  incomeClassificationCalls += 1;
  assert.match(prompt, /negative income refunds/);
  return { records: [{
    category: 'Groceries', subcategory: 'Supermarket', merchant: 'Conad', confidence: 1,
    rationale: 'refund', conflict: false
  }] };
};
const categorizedIncome = nativeNormalizeExpenseJsonWithAi(
  [incomeRefundRecord, nonSpendingIncomeRecord, transferRecord], file('income-json', 'transactions-hostello-income.json'),
  folder('income-folder', 'Income'), '', { categories: { Groceries: ['Supermarket'] } }, true, null
);
assert.equal(incomeClassificationCalls, 1);
assert.equal(categorizedIncome.find(record => record.sourceTransactionId === 'income-refund').category,
  'Groceries');
assert.equal(categorizedIncome.find(record => record.sourceTransactionId === 'income-refund').amount, -10);
assert.equal(categorizedIncome.find(record => record.sourceTransactionId === 'income-funding').category, '');
assert.equal(categorizedIncome.find(record => record.sourceTransactionId === 'income-funding').merchant, '');
assert.equal(categorizedIncome.find(record => record.sourceTransactionId === 'cash-settlement').category, '');
assert.equal(context.isConfiguredIncomeRefundCategory_('Groceries', {
  categories: { Groceries: ['Supermarket'] }
}), true);
assert.equal(context.isConfiguredIncomeRefundCategory_('', {
  categories: { Groceries: ['Supermarket'] }
}), false);

const orchestrationEvents = [];
const orchestrationJson = file('orchestration-json', 'transactions-hostello-202611.json', '{}');
const orchestrationFolder = folder('orchestration-folder', 'Orchestration', [orchestrationJson]);
root.addFolder(orchestrationFolder);
const orchestrationSource = context.createFolderIntakeSource_(orchestrationFolder, [orchestrationJson], 1);
const normalizedRecord = {
  date: '2026-11-01', confidence: 1, conflict: false, transactionType: 'expense'
};
context.getAutomationConfig_ = () => config;
context.getLocalization_ = () => ({ sheetNames: { dashboard: 'Dashboard' } });
context.buildDashboard_ = () => orchestrationEvents.push('dashboard-rebuilt');
let orchestrationState = {};
context.loadSourceFolderState_ = () => orchestrationState;
context.getSpreadsheetId_ = () => 'spreadsheet';
context.SpreadsheetApp = { openById: () => ({ getSheetByName: () => ({}) }) };
context.getExpenseSheetLayout_ = () => ({
  transactions: {}, imports: {}, sourceReconciliations: {}, headers: []
});
context.parseTricountJsonExport_ = () => [normalizedRecord];
let normalizationCalls = 0;
context.normalizeExpenseJsonWithAi_ = (records, sourceFile, sourceFolder, policy, automationConfig,
  recursiveAttachmentSearch, stageController) => {
  const staged = stageController.load(0, records);
  if (staged) {
    return staged;
  }
  normalizationCalls += 1;
  orchestrationEvents.push('ai-normalized');
  stageController.save(0, records, [normalizedRecord]);
  return [normalizedRecord];
};
context.getExistingLedgerFingerprints_ = () => [];
context.getExistingLedgerBalanceRecords_ = () => [];
context.getRecordedOpeningBalanceMarkers_ = () => [];
context.getExistingLedgerOpeningBalanceRecords_ = () => [];
context.partitionIncomingRows_ = rows => ({ unique: rows, duplicates: [] });
context.isOpeningBalanceRecord_ = () => false;
context.assertIntakeSourceUnchanged_ = () => orchestrationEvents.push('source-validated');
context.saveSourceFolderState_ = state => {
  orchestrationState = JSON.parse(JSON.stringify(state));
  orchestrationEvents.push('state-saved');
};
context.writeLedgerRows_ = (layout, rows) => {
  orchestrationEvents.push('ledger-write');
  return rows;
};
context.verifyLedgerWrite_ = () => { throw new Error('ledger verification failed'); };
assert.throws(() => context.processExpenseSource_(
  orchestrationSource, root, 'policy', 'manual'
), /ledger verification failed/);
assert.equal(normalizationCalls, 1);
assert.deepEqual(orchestrationEvents, [
  'state-saved', 'source-validated', 'ai-normalized', 'source-validated', 'ledger-write'
]);

orchestrationEvents.length = 0;
context.verifyLedgerWrite_ = () => orchestrationEvents.push('ledger-verified');
context.sortLedgerTransactions_ = () => orchestrationEvents.push('ledger-sorted');
context.buildSourceReconciliations_ = () => [{ status: 'OK' }];
context.writeImportAudit_ = () => orchestrationEvents.push('audit-written');
context.writeSourceReconciliations_ = () => orchestrationEvents.push('reconciliation-written');
context.verifySourceReconciliations_ = () => orchestrationEvents.push('reconciliation-verified');
context.refreshBalanceViews_ = () => orchestrationEvents.push('views-refreshed');
context.getLocalization_ = () => ({ sheetNames: { dashboard: 'Dashboard', transactions: 'Transazioni' } });
context.buildDashboard_ = () => orchestrationEvents.push('dashboard-refreshed');
context.applyInstallerSpreadsheetPresentation_ = () => orchestrationEvents.push('presentation-refreshed');
context.orderInstallerSheets_ = () => orchestrationEvents.push('sheets-ordered');
context.archiveIntakeSource_ = () => orchestrationEvents.push('source-archived');
const orchestrationResult = context.processExpenseSource_(
  orchestrationSource, root, 'policy', 'manual'
);
assert.equal(orchestrationResult.archived, true);
assert.equal(normalizationCalls, 1);
assert.deepEqual(orchestrationEvents, [
  'state-saved', 'source-validated', 'source-validated', 'ledger-write', 'ledger-verified',
  'ledger-sorted', 'audit-written',
  'reconciliation-written', 'reconciliation-verified', 'views-refreshed',
  'dashboard-refreshed', 'presentation-refreshed', 'sheets-ordered',
  'source-validated', 'state-saved', 'source-validated', 'source-archived', 'state-saved'
]);
assert.deepEqual(orchestrationState, {});
const intakeStaging = root.getFoldersByName('.Cataloger-intake-staging').next();
assert.equal(intakeStaging.getFiles().next().isTrashed(), true);

const archiveRetryJson = file('archive-retry-json', 'transactions-hostello-202613.json', '{}');
const archiveRetryFolder = folder('archive-retry-folder', 'Archive retry', [archiveRetryJson]);
root.addFolder(archiveRetryFolder);
const archiveRetrySource = context.createFolderIntakeSource_(archiveRetryFolder, [archiveRetryJson], 1);
orchestrationState = {};
normalizationCalls = 0;
context.assertIntakeSourceUnchanged_ = () => {};
let archiveAttempts = 0;
context.archiveIntakeSource_ = () => {
  archiveAttempts += 1;
  if (archiveAttempts === 1) {
    throw new Error('archive unavailable');
  }
};
assert.throws(() => context.processExpenseSource_(
  archiveRetrySource, root, 'policy', 'manual'
), /archive unavailable/);
const processedRetryState = orchestrationState[archiveRetrySource.stateKey];
assert.equal(processedRetryState.status, 'processed');
assert.equal(processedRetryState.sourceFiles.length, 1);
const retryStageName = context.getIntakeStageFileName_(
  archiveRetrySource, processedRetryState, processedRetryState.sourceFiles[0], 0
);
assert.equal(intakeStaging.getFilesByName(retryStageName).hasNext(), false);
const retryResult = context.processExpenseSource_(archiveRetrySource, root, 'policy', 'manual');
assert.equal(retryResult.status, 'UNCHANGED');
assert.equal(intakeStaging.getFilesByName(retryStageName).hasNext(), false);
assert.deepEqual(orchestrationState, {});

const cleanupRetryJson = file('cleanup-retry-json', 'transactions-hostello-202614.json', '{}');
const cleanupRetryFolder = folder('cleanup-retry-folder', 'Cleanup retry', [cleanupRetryJson]);
root.addFolder(cleanupRetryFolder);
const cleanupRetrySource = context.createFolderIntakeSource_(cleanupRetryFolder, [cleanupRetryJson], 1);
orchestrationState = {};
archiveAttempts = 0;
const stablePropertiesService = context.PropertiesService;
let cleanupFailures = 1;
context.PropertiesService = { getScriptProperties: () => {
  const properties = stablePropertiesService.getScriptProperties();
  return Object.assign({}, properties, {
    getProperties: () => {
      if (cleanupFailures > 0) {
        cleanupFailures -= 1;
        throw new Error('cleanup unavailable');
      }
      return properties.getProperties();
    }
  });
} };
context.archiveIntakeSource_ = () => { archiveAttempts += 1; };
assert.throws(() => context.processExpenseSource_(
  cleanupRetrySource, root, 'policy', 'manual'
), /cleanup unavailable/);
assert.equal(archiveAttempts, 0);
assert.equal(orchestrationState[cleanupRetrySource.stateKey].status, 'processed');
const cleanupRetryResult = context.processExpenseSource_(cleanupRetrySource, root, 'policy', 'manual');
assert.equal(cleanupRetryResult.status, 'UNCHANGED');
assert.equal(archiveAttempts, 1);
assert.deepEqual(orchestrationState, {});
context.PropertiesService = stablePropertiesService;

const cleanupDriftJson = file('cleanup-drift-json', 'transactions-hostello-202615.json', '{}');
const cleanupDriftFolder = folder('cleanup-drift-folder', 'Cleanup drift', [cleanupDriftJson]);
root.addFolder(cleanupDriftFolder);
const cleanupDriftSource = context.createFolderIntakeSource_(cleanupDriftFolder, [cleanupDriftJson], 1);
orchestrationState = {};
let driftedDuringCleanup = false;
archiveAttempts = 0;
context.cleanupIntakeStages_ = () => { driftedDuringCleanup = true; };
context.assertIntakeSourceUnchanged_ = () => {
  if (driftedDuringCleanup) {
    throw new Error('source drifted during cleanup');
  }
};
context.archiveIntakeSource_ = () => { archiveAttempts += 1; };
assert.throws(() => context.processExpenseSource_(
  cleanupDriftSource, root, 'policy', 'manual'
), /source drifted during cleanup/);
assert.equal(archiveAttempts, 0);
context.cleanupIntakeStages_ = nativeCleanupIntakeStages;

const tamperState = { signature: 'tamper-signature' };
const tamperSourceFile = {
  id: 'tamper-json', name: 'transactions-hostello-tamper.json', contentHash: 'tamper-hash'
};
const tamperSource = { stateKey: 'file:tamper-json' };
const tamperController = context.createIntakeStageController_(
  root, tamperSource, tamperState, tamperSourceFile
);
const tamperRecords = [{ sourceTransactionId: 'tamper-1' }];
tamperController.save(0, tamperRecords, tamperRecords);
const tamperStageName = context.getIntakeStageFileName_(tamperSource, tamperState, tamperSourceFile, 0);
intakeStaging.getFilesByName(tamperStageName).next().setContent('{"modified":true}');
assert.throws(() => tamperController.load(0, tamperRecords), /was modified/);

const largeState = {
  status: 'processing', signature: 'large-signature',
  sourceFiles: [{ id: 'large-json', name: 'transactions-hostello-large.json', contentHash: 'large-hash' }]
};
const largeSource = { stateKey: 'file:large-json' };
const largeController = context.createIntakeStageController_(
  root, largeSource, largeState, largeState.sourceFiles[0]
);
for (let batchIndex = 0; batchIndex < 100; batchIndex += 1) {
  const sourceBatch = [{ sourceTransactionId: `large-${batchIndex}` }];
  largeController.save(batchIndex, sourceBatch, sourceBatch);
}
assert.ok(JSON.stringify(largeState).length < 500);
assert.equal(Object.keys(scriptProperties).filter(key =>
  key.startsWith('EXPENSE_INTAKE_STAGE_DIGEST_')).length >= 100, true);

const driftJson = file('drift-json', 'transactions-hostello-202612.json', '{}');
const driftFolder = folder('drift-folder', 'Drift', [driftJson]);
root.addFolder(driftFolder);
const driftSource = context.createFolderIntakeSource_(driftFolder, [driftJson], 1);
orchestrationEvents.length = 0;
const abandonedState = {
  status: 'processing', signature: 'old-signature', startedAt: 'earlier',
  sourceFiles: [{ id: 'old', name: 'old.json', contentHash: 'old-hash' }]
};
const abandonedName = context.getIntakeStageFileName_(
  driftSource, abandonedState, abandonedState.sourceFiles[0], 0
);
const abandonedStage = file('abandoned-stage', abandonedName, '{}');
intakeStaging.addFile(abandonedStage);
orchestrationState = { [driftSource.stateKey]: abandonedState };
normalizationCalls = 0;
context.assertIntakeSourceUnchanged_ = () => { throw new Error('source drifted before AI'); };
assert.throws(() => context.processExpenseSource_(driftSource, root, 'policy', 'manual'),
  /source drifted before AI/);
assert.equal(normalizationCalls, 0);
assert.deepEqual(orchestrationEvents, ['state-saved']);
assert.equal(abandonedStage.isTrashed(), true);

console.log('intake source tests passed');
