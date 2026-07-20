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
}], []);
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

console.log('balance view tests passed');
