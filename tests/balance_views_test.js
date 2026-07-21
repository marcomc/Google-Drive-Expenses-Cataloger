#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), context);
const balanceViewsSource = fs.readFileSync('BalanceViews.gs', 'utf8');
vm.runInContext(balanceViewsSource, context);
assert.doesNotMatch(balanceViewsSource, /file\.getMimeType\(\) !== 'application\/json'/,
  'allocation restoration must use the filename and JSON structure contract, not Drive MIME metadata');
assert.match(balanceViewsSource, /const archivedIndex = unresolved \? buildArchivedTricountAllocationIndex_\(\) : \{\}/,
  'a complete direct allocation restoration must not scan the full archive');

const ledger = [{
  id: 'expense-1', date: '2026-01-10', year: 2026, month: 1, currency: 'EUR',
  payer: 'Marco', beneficiaries: 'Laura', amount: 10, description: 'Dinner',
  transactionType: 'expense', sourceFile: 'january.json', sourceRow: 1,
  allocations: [{ participant: 'Laura', amount: 10 }]
}];
assert.equal(context.getDriveFileIdFromUrl_('https://drive.google.com/open?id=source-file-id'), 'source-file-id');
assert.equal(context.findSourceRecordForLedgerBackfill_({ sourceTransactionId: '', sourceRow: 44 }, {}, {
  44: { sourceTransactionId: 'source-id', sourceRow: 44 }
}).sourceTransactionId, 'source-id');
assert.equal(context.buildLedgerAllocationMatchKey_('2026-02-01', 'eur', 'Laura', -12.5, ' Conad '),
  '2026-02-01|EUR|laura|12.5|conad');
assert.equal(context.findArchivedSourceRecordForLedgerBackfill_([
  '2026-02-01', 'EUR', 'Laura', 12.5, 'Conad', 3
], { Date: 0, Currency: 1, Payer: 2, Amount: 3, Description: 4, 'Source row': 5 }, {
  date: 'Date', currency: 'Currency', payer: 'Payer', amount: 'Amount', description: 'Description',
  sourceRow: 'Source row'
}, {
  '2026-02-01|EUR|laura|12.5|conad': [{ sourceRow: 3, sourceTransactionId: 'archived-id' }]
}).sourceTransactionId, 'archived-id');

const incomeHeaders = ['Transaction type', 'Source native type', 'Source custom category', 'Description',
  'Amount', 'Allocation details'];
const historicIncomeRows = [[
  'expense', 'INCOME', '', 'Historic refund', 25,
  JSON.stringify([{ participant: 'Laura', amount: 10 }, { participant: 'Marco', amount: 15 }])
], [
  'expense', 'NORMAL', '', 'Historic expense', 40,
  JSON.stringify([{ participant: 'Laura', amount: 40 }])
]];
const historicIncomeSheet = {
  getLastRow: () => historicIncomeRows.length + 1,
  getRange: (_row, column, _rowCount, columnCount) => ({
    getValues: () => column === 1 && columnCount === incomeHeaders.length ? historicIncomeRows : [],
    setValues: (values) => values.forEach((value, index) => { historicIncomeRows[index][column - 1] = value[0]; })
  })
};
const incomeLocalization = { headers: {
  transactionType: 'Transaction type', sourceNativeType: 'Source native type',
  sourceCustomCategory: 'Source custom category', description: 'Description', amount: 'Amount',
  allocationDetails: 'Allocation details'
} };
assert.equal(context.normalizeExistingLedgerTransactionTypes_(historicIncomeSheet, incomeHeaders, incomeLocalization), 1);
assert.deepEqual(JSON.parse(JSON.stringify(historicIncomeRows[0].slice(0, 5))),
  ['income', 'INCOME', '', 'Historic refund', -25]);
assert.deepEqual(JSON.parse(JSON.stringify(context.parseStoredAllocations_(historicIncomeRows[0][5]).map((entry) => [
  entry.participant, entry.amount
]))), [['Laura', -10], ['Marco', -15]]);
assert.equal(context.normalizeExistingLedgerTransactionTypes_(historicIncomeSheet, incomeHeaders, incomeLocalization), 0,
  'legacy income sign migration must be idempotent');
assert.equal(historicIncomeRows[1][4], 40, 'non-income rows must retain their stored amount');

assert.deepEqual(JSON.parse(JSON.stringify(context.buildParticipantBalanceDeltas_({
  payer: 'Marco', beneficiaries: 'Laura', amount: 20, allocations: []
}))), [
  { key: 'marco', name: 'Marco', amount: 20 }, { key: 'laura', name: 'Laura', amount: -20 }
]);
const laterCheckpoint = {
  record: {
    date: '2026-02-01', currency: 'EUR', payer: 'Marco', amount: 60,
    allocations: [{ participant: 'Laura', amount: 60 }]
  }
};
const zeroFallback = context.buildAutomaticInitialBalances_([laterCheckpoint], ledger);
assert.deepEqual(JSON.parse(JSON.stringify(zeroFallback)), [
  { date: '2026-01-10', currency: 'EUR', participant: 'Laura', amount: 0, source: '' },
  { date: '2026-01-10', currency: 'EUR', participant: 'Marco', amount: 0, source: '' }
]);

const initialCheckpoint = {
  record: {
    date: '2026-01-01', currency: 'EUR', payer: 'Marco', amount: 50,
    allocations: [{ participant: 'Laura', amount: 50 }], sourceFile: 'january.json'
  }
};
const automatic = context.buildAutomaticInitialBalances_([laterCheckpoint, initialCheckpoint], ledger);
assert.deepEqual(JSON.parse(JSON.stringify(automatic)), [
  { date: '2026-01-01', currency: 'EUR', participant: 'Laura', amount: -50, source: 'january.json' },
  { date: '2026-01-01', currency: 'EUR', participant: 'Marco', amount: 50, source: 'january.json' }
]);

const multiParticipantBaseline = context.buildAutomaticInitialBalances_([{
  records: [
    { date: '2026-01-01', currency: 'EUR', payer: 'Laura', amount: 30,
      allocations: [{ participant: 'Marco', amount: 10 }, { participant: 'Sara', amount: 20 }],
      sourceFile: 'january.json' }
  ]
}], ledger);
assert.deepEqual(JSON.parse(JSON.stringify(multiParticipantBaseline)), [
  { date: '2026-01-01', currency: 'EUR', participant: 'Laura', amount: 30, source: 'january.json' },
  { date: '2026-01-01', currency: 'EUR', participant: 'Marco', amount: -10, source: 'january.json' },
  { date: '2026-01-01', currency: 'EUR', participant: 'Sara', amount: -20, source: 'january.json' }
]);

const declaredControls = context.buildDeclaredMonthlyBalanceControls_([{
  records: [
    { date: '2026-02-01', currency: 'EUR', payer: 'Laura', amount: 30,
      allocations: [{ participant: 'Marco', amount: 10 }, { participant: 'Sara', amount: 20 }] }
  ]
}]);
assert.deepEqual(JSON.parse(JSON.stringify(declaredControls)), [
  [2026, 1, 'EUR', 'Laura', 30], [2026, 1, 'EUR', 'Marco', -10], [2026, 1, 'EUR', 'Sara', -20]
]);

const initialOpeningGroups = context.getInitialOpeningBalanceGroupKeys_([
  initialCheckpoint, laterCheckpoint
], ledger);
assert.deepEqual(JSON.parse(JSON.stringify(initialOpeningGroups)), { '2026-01-01|EUR': true });
assert.deepEqual(JSON.parse(JSON.stringify(context.buildDeclaredMonthlyBalanceControls_([
  initialCheckpoint, laterCheckpoint
], initialOpeningGroups))), [
  [2026, 1, 'EUR', 'Laura', -60], [2026, 1, 'EUR', 'Marco', 60]
]);

const effective = context.mergeInitialBalances_([{ date: '2026-01-02', currency: 'EUR',
  participant: 'Marco', amount: 75, origin: 'Manuale' }], automatic);
assert.equal(effective.find((entry) => entry.participant === 'Marco').amount, 75);

const movementRows = context.buildBalanceMovementRows_(ledger, automatic).rows;
assert.deepEqual(JSON.parse(JSON.stringify(movementRows.map((row) => [row[1], row[5], row[7]]))), [
  ['2026-01-01', 'Laura', -50],
  ['2026-01-01', 'Marco', 50],
  ['2026-01-10', 'Laura', -60],
  ['2026-01-10', 'Marco', 60]
]);
const monthlyWithoutOpeningMismatch = context.buildMonthlyBalanceRows_(
  context.buildBalanceMovementRows_(ledger, automatic), [initialCheckpoint, laterCheckpoint], initialOpeningGroups
).rows;
assert.equal(monthlyWithoutOpeningMismatch.some((row) => row[0] === 2025 && row[1] === 12), false,
  'the opening vector must not be rendered as a checkpoint in the previous month');

const roundingLedger = [{
  id: 'shared-expense', date: '2026-01-10', year: 2026, month: 1, currency: 'EUR',
  payer: 'Laura', amount: 10, transactionType: 'expense', sourceFile: 'january.json', sourceRow: 1,
  allocations: [{ participant: 'Laura', amount: 5 }, { participant: 'Marco', amount: 5 }]
}];
const roundingChecks = [{ records: [{
  date: '2026-02-01', currency: 'EUR', payer: 'Laura', amount: 5.05,
  allocations: [{ participant: 'Marco', amount: 5.05 }]
}]}];
const roundingAdjustments = context.buildCheckpointRoundingAdjustments_(roundingLedger, [], roundingChecks);
assert.deepEqual(JSON.parse(JSON.stringify(roundingAdjustments.map((record) => [
  record.date, record.initialBalanceDelta.name, record.initialBalanceDelta.amount
]))), [
  ['2026-01-31', 'Laura', 0.05], ['2026-01-31', 'Marco', -0.05]
]);

const carriedMovements = context.buildBalanceMovementRows_([{
  id: 'opening', date: '2026-01-10', year: 2026, month: 1, currency: 'EUR',
  transactionType: 'opening_balance', description: 'Opening', sourceFile: 'test', sourceRow: 1,
  initialBalanceDelta: { key: 'laura', name: 'Laura', amount: 10 }
}], [{ date: '2026-01-01', currency: 'EUR', participant: 'Laura', amount: 10 }]);
const marchCheckpoint = [{ records: [{
  date: '2026-04-01', currency: 'EUR', payer: 'Laura', amount: 10,
  allocations: []
}] }];
const carriedRows = context.buildMonthlyBalanceRows_(carriedMovements, marchCheckpoint).rows;
assert.deepEqual(JSON.parse(JSON.stringify(carriedRows.map((row) => [row[0], row[1], row[3], row[4], row[5]]))), [
  [2026, 1, 'Laura', 10, ''],
  [2026, 2, 'Laura', 10, ''],
  [2026, 3, 'Laura', 10, 10]
]);

const closingSettlement = {
  id: 'closing-settlement', date: '2026-01-31', year: 2026, month: 1, currency: 'EUR',
  payer: 'Laura', beneficiaries: 'Marco', amount: 50, transactionType: 'closing_balance',
  description: 'Bilancio fine mese', sourceFile: 'january.json', sourceRow: 2,
  allocations: [{ participant: 'Marco', amount: 50 }]
};
const preClosingExpense = {
  id: 'pre-closing-expense', date: '2026-01-10', year: 2026, month: 1, currency: 'EUR',
  payer: 'Marco', beneficiaries: 'Laura', amount: 50, transactionType: 'expense',
  description: 'Shared expense', sourceFile: 'january.json', sourceRow: 1,
  allocations: [{ participant: 'Laura', amount: 50 }]
};
const openingAfterClosing = [{ records: [{
  date: '2026-02-01', currency: 'EUR', payer: 'Marco', amount: 50,
  allocations: [{ participant: 'Laura', amount: 50 }]
}] }];
const resetMovements = context.buildBalanceMovementRows_([preClosingExpense, closingSettlement], []);
const resetRows = context.buildMonthlyBalanceRows_(resetMovements, openingAfterClosing).rows;
assert.equal(resetRows.filter((row) => row[0] === 2026 && row[1] === 1)
  .every((row) => row[7] === 'matched'), true,
  'a closing balance must not change the month-end checkpoint calculation');
assert.deepEqual(JSON.parse(JSON.stringify(resetRows.filter((row) => row[0] === 2026 && row[1] === 1)
  .map((row) => [row[3], row[4], row[5], row[6], row[7]]))), [
  ['Laura', -50, -50, 0, 'matched'], ['Marco', 50, 50, 0, 'matched']
]);

assert.equal(context.getOpeningBalanceMonthKey_({ date: '2025-05-31',
  balanceMonth: '2025-06' }), '2025-06',
  'a month-opening marker dated on the prior month end uses its Tricount month');
assert.equal(context.getOpeningBalanceMonthKey_({ date: '2025-05-31',
  sourceFileName: 'transactions-unrelated-202506.json' }), '2025-05',
  'an unmapped source filename cannot move an opening marker to another month');

const sourceConfig = { intake_keyword: 'Casa.+(Shared)' };
const sourceFiles = [
  { id: 'december', name: 'transactions-Casa.+(Shared)-202312.json' },
  { id: 'combined', name: 'transactions-Casa.+(Shared)-202305-202308.json' },
  { id: 'mistyped-april', name: 'transactions-Casa.+(Shared)-202304.json' },
  { id: 'ineligible', name: 'transactions-unrelated-202401.json' }
];
const sourceLedgerRecords = [{
  id: 'december-opening', date: '2023-12-01', year: 2023, month: 12, currency: 'EUR',
  payer: 'Laura', amount: 68.16, transactionType: 'opening_balance',
  sourceFile: 'https://drive.google.com/open?id=december', sourceRow: 35,
  allocations: [{ participant: 'Marco', amount: 68.16 }]
}, {
  id: 'backdated-december-expense', date: '2023-11-26', year: 2023, month: 11, currency: 'EUR',
  payer: 'Laura', amount: 3.8, transactionType: 'expense',
  sourceFile: 'https://drive.google.com/open?id=december', sourceRow: 31,
  allocations: [{ participant: 'Laura', amount: 1.9 }, { participant: 'Marco', amount: 1.9 }]
}, {
  id: 'combined-august-expense', date: '2023-08-20', year: 2023, month: 8, currency: 'EUR',
  payer: 'Laura', amount: 10, transactionType: 'expense',
  sourceFile: 'https://drive.google.com/open?id=combined', sourceRow: 1,
  allocations: [{ participant: 'Marco', amount: 10 }]
}, {
  id: 'mistyped-april-expense', date: '2025-05-02', year: 2025, month: 5, currency: 'EUR',
  payer: 'Laura', amount: 10, transactionType: 'expense',
  sourceFile: 'https://drive.google.com/open?id=mistyped-april', sourceRow: 1,
  allocations: [{ participant: 'Marco', amount: 10 }]
}, {
  id: 'ineligible-expense', date: '2024-02-02', year: 2024, month: 2, currency: 'EUR',
  payer: 'Laura', amount: 10, transactionType: 'expense',
  sourceFile: 'https://drive.google.com/open?id=ineligible', sourceRow: 1,
  allocations: [{ participant: 'Marco', amount: 10 }]
}];
context.enrichLedgerBalanceSourceMetadata_(sourceLedgerRecords, sourceFiles);
const sourceChecks = context.mergeLedgerOpeningBalanceChecks_([{
  record: {
    date: '2025-04-01', currency: 'EUR', payer: 'Marco', amount: 0.78,
    sourceFileId: 'mistyped-april', sourceFileName: 'transactions-Casa.+(Shared)-202304.json',
    transactionType: 'opening_balance', allocations: [{ participant: 'Laura', amount: 0.78 }]
  }
}], sourceLedgerRecords);
const sourcePeriods = context.buildLedgerBalanceSourcePeriods_(sourceFiles, sourceChecks, sourceConfig);
context.applyLedgerBalancePeriods_(sourceLedgerRecords, sourcePeriods);
context.applyLedgerBalancePeriods_(sourceChecks.flatMap(context.getOpeningBalanceRecordsFromCheck_), sourcePeriods);
assert.equal(sourceLedgerRecords[0].sourceFileName, 'transactions-Casa.+(Shared)-202312.json');
assert.equal(context.getBalanceMonthKey_(sourceLedgerRecords[1]), '2023-12',
  'a backdated transaction belongs to the monthly Tricount balance period');
assert.equal(context.getBalanceMonthKey_(sourceLedgerRecords[2]), '2023-08',
  'a combined multi-month source retains the transaction calendar month');
assert.equal(context.getBalanceMonthKey_(sourceLedgerRecords[3]), '2025-04',
  'an opening marker corrects a materially mistyped source filename period');
assert.equal(context.getBalanceMonthKey_(sourceLedgerRecords[4]), '2024-02',
  'an ineligible source retains the transaction calendar month');
assert.equal(sourcePeriods.combined, undefined, 'a combined-range source has no mapped balance period');
assert.equal(sourcePeriods.ineligible, undefined, 'an ineligible source has no mapped balance period');
assert.equal(context.getOpeningBalanceMonthKey_(sourceChecks[0].record), '2025-04',
  'opening-marker correction uses the mapped period for a configured non-default keyword');

const sourceOrderedLedger = [{
  id: 'november-movement', date: '2023-11-15', year: 2023, month: 11, currency: 'EUR',
  payer: 'Laura', amount: 791.48, transactionType: 'expense', sourceFile: 'november.json', sourceRow: 1,
  allocations: [{ participant: 'Marco', amount: 791.48 }]
}, {
  id: 'december-backdated', date: '2023-11-26', year: 2023, month: 11, balanceMonth: '2023-12',
  currency: 'EUR', payer: 'Laura', amount: 1.9, transactionType: 'expense',
  sourceFile: 'december.json', sourceRow: 1, allocations: [{ participant: 'Marco', amount: 1.9 }]
}, {
  id: 'december-movement', date: '2023-12-15', year: 2023, month: 12, currency: 'EUR',
  payer: 'Laura', amount: 215.23, transactionType: 'expense', sourceFile: 'december.json', sourceRow: 2,
  allocations: [{ participant: 'Marco', amount: 215.23 }]
}];
const sourceOrderedInitial = [
  { date: '2023-10-31', currency: 'EUR', participant: 'Laura', amount: -723.24 },
  { date: '2023-10-31', currency: 'EUR', participant: 'Marco', amount: 723.24 }
];
const sourceOrderedChecks = [{ records: [{
  date: '2023-12-01', currency: 'EUR', payer: 'Laura', amount: 68.16,
  allocations: [{ participant: 'Marco', amount: 68.16 }]
}] }, { records: [{
  date: '2024-01-01', currency: 'EUR', payer: 'Laura', amount: 285.25,
  allocations: [{ participant: 'Marco', amount: 285.25 }]
}] }];
const sourceOrderedAdjustments = context.buildCheckpointRoundingAdjustments_(
  sourceOrderedLedger, sourceOrderedInitial, sourceOrderedChecks
);
const sourceOrderedMonthly = context.buildMonthlyBalanceRows_(
  context.buildBalanceMovementRows_(sourceOrderedLedger.concat(sourceOrderedAdjustments), sourceOrderedInitial),
  sourceOrderedChecks
).rows;
assert.deepEqual(JSON.parse(JSON.stringify(sourceOrderedMonthly.filter((row) => row[3] === 'Laura' &&
  row[0] === 2023 && row[1] >= 11).map((row) => [row[1], row[4], row[5], row[7]]))), [
  [11, 68.16, 68.16, 'matched'], [12, 285.25, 285.25, 'matched']
]);

const brokenChainLedger = [{
  id: 'january-error', date: '2026-01-10', year: 2026, month: 1, currency: 'EUR',
  payer: 'Laura', amount: 10, transactionType: 'expense', sourceFile: 'january.json', sourceRow: 1,
  allocations: [{ participant: 'Marco', amount: 10 }]
}, {
  id: 'february-cancellation', date: '2026-02-10', year: 2026, month: 2, currency: 'EUR',
  payer: 'Marco', amount: 2, transactionType: 'expense', sourceFile: 'february.json', sourceRow: 1,
  allocations: [{ participant: 'Laura', amount: 2 }]
}];
const brokenChainChecks = [{ records: [{
  date: '2026-02-01', currency: 'EUR', payer: 'Laura', amount: 8,
  allocations: [{ participant: 'Marco', amount: 8 }]
}] }, { records: [{
  date: '2026-03-01', currency: 'EUR', payer: 'Laura', amount: 8.05,
  allocations: [{ participant: 'Marco', amount: 8.05 }]
}] }];
assert.equal(context.buildCheckpointRoundingAdjustments_(brokenChainLedger, [], brokenChainChecks).length, 0,
  'a later checkpoint cannot hide or round away an earlier material mismatch');
const brokenChainRows = context.buildMonthlyBalanceRows_(
  context.buildBalanceMovementRows_(brokenChainLedger, []), brokenChainChecks
).rows.filter((row) => row[3] === 'Laura' && row[7]);
assert.deepEqual(JSON.parse(JSON.stringify(brokenChainRows.map((row) => [row[1], row[6], row[7]]))), [
  [1, 2, 'mismatch'], [2, -0.05, 'mismatch']
]);

const controlOnlyRounding = context.buildCheckpointRoundingAdjustments_([{
  id: 'opening', date: '2026-01-10', year: 2026, month: 1, currency: 'EUR',
  transactionType: 'expense', description: 'Opening', sourceFile: 'test', sourceRow: 1,
  payer: 'Laura', amount: 10, allocations: [{ participant: 'Marco', amount: 10 }]
}], [], [{ records: [{
  date: '2026-04-01', currency: 'EUR', payer: 'Laura', amount: 10.05,
  allocations: [{ participant: 'Marco', amount: 10.05 }]
}] }]);
assert.deepEqual(JSON.parse(JSON.stringify(controlOnlyRounding.map((record) => [
  record.date, record.initialBalanceDelta.name, record.initialBalanceDelta.amount
]))), [
  ['2026-03-31', 'Laura', 0.05], ['2026-03-31', 'Marco', -0.05]
]);

let derivedSheetRows = 1000;
let insertedRows = 0;
let writtenRowCount = 0;
const derivedSheet = {
  getMaxRows: () => derivedSheetRows,
  insertRowsAfter: (_afterRow, count) => {
    insertedRows += count;
    derivedSheetRows += count;
  },
  clearContents: () => {},
  getRange: (_row, _column, rowCount) => {
    const range = {
      setValues: () => {
        writtenRowCount = Math.max(writtenRowCount, rowCount);
        return range;
      },
      setFontWeight: () => range,
      setNote: () => range
    };
    return range;
  },
  setFrozenRows: () => {}
};
context.writeDerivedBalanceSheet_(derivedSheet, ['Value'],
  Array.from({ length: 1005 }, (_, index) => [index]), 'Derived test');
assert.equal(insertedRows, 6);
assert.equal(derivedSheetRows, 1006);
assert.equal(writtenRowCount, 1005);

const recoveryCandidate = {
  date: '2026-04-15', currency: 'EUR', payer: 'Laura', beneficiaries: 'Marco', amount: 12,
  description: 'Historic cash settlement', transactionType: 'transfer', sourceFileId: 'source-file-id',
  sourceFileName: 'transactions-hostello-202604.json', sourceRow: 8, sourceFingerprint: 'tricount:recovery'
};
let recoveryImported = false;
let recoveryAudit = null;
let recoveryReconciliations = null;
context.getRecordedOpeningBalanceChecks_ = () => [{ records: [recoveryCandidate] }];
context.getHistoricalBalanceTransferCandidates_ = () => [recoveryCandidate];
context.getExistingLedgerFingerprints_ = () => recoveryImported ? [{ fingerprint: 'tricount:recovery' }] : [];
context.partitionIncomingRows_ = (records, existing) => ({
  unique: existing.length ? [] : records,
  duplicates: []
});
context.writeLedgerRows_ = (_layout, records) => {
  recoveryImported = true;
  return records.map((record, index) => Object.assign({}, record, { ledgerRow: index + 2 }));
};
context.verifyLedgerWrite_ = () => {};
context.sortLedgerTransactions_ = () => {};
context.buildSourceReconciliations_ = (records, _partition, imported, sourceFiles) => {
  assert.deepEqual(JSON.parse(JSON.stringify(sourceFiles)), [{
    id: 'source-file-id', name: 'transactions-hostello-202604.json', contentHash: ''
  }]);
  return records.map((record) => ({
    sourceFileId: record.sourceFileId, sourceFileName: record.sourceFileName,
    status: imported.length ? 'OK' : 'duplicate'
  }));
};
context.writeImportAudit_ = (_sheet, recovery, sourceResults, records, _partition, imported, _openingBalances,
  reconciliations) => {
  recoveryAudit = { recovery, sourceResults, records, imported, reconciliations };
};
context.writeSourceReconciliations_ = (_sheet, recovery, reconciliations) => {
  recoveryReconciliations = { recovery, reconciliations };
};
context.verifySourceReconciliations_ = (reconciliations) => {
  assert.equal(reconciliations[0].status, 'OK');
};
const recoveryLayout = { transactions: {}, headers: [], imports: {}, sourceReconciliations: {} };
assert.equal(context.recoverHistoricalBalanceTransfers_(recoveryLayout), 1);
assert.equal(recoveryAudit.recovery.name, 'Historical balance transfer recovery');
assert.equal(recoveryAudit.sourceResults[0].file.getName(), 'transactions-hostello-202604.json');
assert.equal(recoveryAudit.imported.length, 1);
assert.equal(recoveryReconciliations.reconciliations.length, 1);
assert.equal(context.recoverHistoricalBalanceTransfers_(recoveryLayout), 0,
  'a recovery retry must not duplicate a ledger, audit, or reconciliation decision');

const refreshEvents = [];
const refreshSpreadsheet = {
  getSheetByName: (name) => ({ name })
};
context.withExpenseLock_ = (source, callback) => {
  refreshEvents.push('lock:' + source);
  return callback();
};
context.assertCatalogConfiguration_ = () => refreshEvents.push('configuration');
context.getSpreadsheetId_ = () => 'spreadsheet-id';
context.SpreadsheetApp = { openById: () => refreshSpreadsheet };
context.getExpenseSheetLayout_ = () => ({ transactions: { name: 'Transactions' } });
context.sortLedgerTransactions_ = () => 3;
context.refreshBalanceViews_ = () => refreshEvents.push('views');
context.getLocalization_ = () => ({ sheetNames: { dashboard: 'Dashboard', transactions: 'Transactions' } });
context.buildDashboard_ = () => refreshEvents.push('dashboard');
context.applyInstallerSpreadsheetPresentation_ = () => refreshEvents.push('presentation');
context.orderInstallerSheets_ = () => refreshEvents.push('ordering');
assert.deepEqual(JSON.parse(JSON.stringify(context.refreshBalanceViews())), {
  status: 'REFRESHED', sortedRows: 3
});
assert.deepEqual(refreshEvents, [
  'lock:balance-view-refresh', 'configuration', 'views', 'dashboard', 'presentation', 'ordering'
], 'manual balance refresh must share the intake lock before it mutates the ledger');

console.log('balance view tests passed');
