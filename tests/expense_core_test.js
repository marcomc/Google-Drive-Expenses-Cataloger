#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  Utilities: {
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_algorithm, value) => crypto.createHash('sha256').update(value).digest(),
    DigestAlgorithm: { SHA_256: 'SHA_256' }
  },
  console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), context);

const config = {
  intake_keyword: 'HoStello',
  excluded_root_folder_names: ['Ricevute', '_Test-fixtures', '_Imported']
};

assert.equal(context.isEligibleCandidateFolder_({
  name: 'HoStello---202606',
  jsonNames: ['transactions-hostello-202606.json']
}, config), true);
assert.equal(context.isEligibleCandidateFolder_({
  name: 'HoStello---202606',
  jsonNames: ['transactions-london-202606.json']
}, config), false);
assert.equal(context.isEligibleCandidateFolder_({
  name: 'London',
  jsonNames: ['transactions-london.json']
}, config), false);
assert.equal(context.isEligibleCandidateFolder_({
  name: 'misc',
  jsonNames: ['transactions-hostello-202606.json']
}, config), true);
assert.equal(context.isEligibleCandidateFolder_({
  name: '_Test-fixtures',
  jsonNames: ['transactions-hostello-202606.json']
}, config), false);
assert.equal(context.isExcludedRootFolderName_('_Imported', config), true);
assert.equal(context.isExcludedRootFolderName_('HoStello---202606', config), false);
assert.equal(context.isTricountJsonFileName_('transactions-hostello-202603.json'), true);
assert.equal(context.isTricountJsonFileName_('tricount-info.json'), false);
assert.equal(context.isTricountJsonFileName_('transactions-hostello-202603.txt'), false);
assert.equal(context.isEligibleTricountJsonFileName_('transactions-hostello-202603.json', config), true);
assert.equal(context.isEligibleTricountJsonFileName_('transactions-london-202603.json', config), false);
assert.equal(context.isExcludedRootFolderName_('Importazioni', config), true);

const tricountJson = {
  Response: [{ Registry: { all_registry_entry: [
    { RegistryEntry: {
      id: 177000001, uuid: 'brasserie-uuid', date: '2026-03-29 19:00:00.000000',
      description: 'Brasserie - birra e patatine', amount: { currency: 'EUR', value: '-36.00' },
      amount_local: { currency: 'EUR', value: '-36.00' }, exchange_rate: '1.00',
      category: 'FOOD_AND_DRINK', category_custom: null, type: 'MANUAL',
      type_transaction: 'NORMAL', status: 'ACTIVE', created: '2026-03-29 19:00:00.000000',
      updated: '2026-03-29 19:01:00.000000',
      membership_owned: { RegistryMembershipNonUser: { alias: { display_name: 'Marco' } } },
      allocations: [
        { type: 'AMOUNT', share_ratio: null, amount: { currency: 'EUR', value: '-29.00' },
          amount_local: { currency: 'EUR', value: '-29.00' },
          membership: { RegistryMembershipNonUser: { alias: { display_name: 'Laura' } } } },
        { type: 'RATIO', share_ratio: 1, amount: { currency: 'EUR', value: '-7.00' },
          amount_local: { currency: 'EUR', value: '-7.00' },
          membership: { RegistryMembershipNonUser: { alias: { display_name: 'Marco' } } } }
      ]
    } },
    { RegistryEntry: {
      id: 177000002, uuid: 'opening-uuid', date: '2026-03-01 00:00:00.000000',
      description: 'Bilancio inizio mese', amount: { currency: 'EUR', value: '-293.01' },
      amount_local: { currency: 'EUR', value: '-293.01' }, category: 'OTHER',
      category_custom: 'Bilancio ⚖️', type: 'MANUAL', type_transaction: 'BALANCE', status: 'ACTIVE',
      membership_owned: { RegistryMembershipNonUser: { alias: { display_name: 'Laura' } } },
      allocations: [
        { type: 'RATIO', share_ratio: 1, amount: { currency: 'EUR', value: '-293.01' },
          amount_local: { currency: 'EUR', value: '-293.01' },
          membership: { RegistryMembershipNonUser: { alias: { display_name: 'Marco' } } } },
        { type: 'AMOUNT', amount: { currency: 'EUR', value: '0.00' },
          amount_local: { currency: 'EUR', value: '0.00' },
          membership: { RegistryMembershipNonUser: { alias: { display_name: 'Laura' } } } }
      ]
    } }
  ] } }]
};
const jsonRecords = context.parseTricountJsonExport_(tricountJson, {
  id: 'json-file', name: 'transactions-hostello-202603.json', url: 'https://example.test/json'
}, { id: 'folder-id', name: 'HoStello---202603' });
assert.equal(jsonRecords.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(jsonRecords[0])), {
  sourceFileId: 'json-file', sourceFileName: 'transactions-hostello-202603.json',
  sourceFolderId: 'folder-id', sourceFolderName: 'HoStello---202603', sourceRow: 1,
  sourceTransactionId: 'brasserie-uuid', sourceNativeType: 'NORMAL', sourceStatus: 'ACTIVE',
  sourceCategory: 'FOOD_AND_DRINK', sourceCustomCategory: '', date: '2026-03-29',
  payer: 'Marco', beneficiaries: 'Laura, Marco', amount: 36, currency: 'EUR',
  description: 'Brasserie - birra e patatine', transactionType: 'expense',
  allocations: [
    { participant: 'Laura', amount: 29, currency: 'EUR', type: 'AMOUNT', shareRatio: null },
    { participant: 'Marco', amount: 7, currency: 'EUR', type: 'RATIO', shareRatio: 1 }
  ],
  exchangeRate: 1, sourceCreatedAt: '2026-03-29 19:00:00.000000',
  sourceUpdatedAt: '2026-03-29 19:01:00.000000', attachmentFileNames: [], attachmentUrls: [],
  sourceFingerprint: 'tricount:brasserie-uuid'
});
assert.equal(jsonRecords[1].transactionType, 'opening_balance');
assert.deepEqual(JSON.parse(JSON.stringify(context.buildExactBalanceDeltas_(jsonRecords[0]))), [
  { name: 'Laura', amount: -29 }, { name: 'Marco', amount: 29 }
]);

const sourceFingerprint = context.buildSourceTransactionFingerprint_({
  'Who paid': 'Marco', Description: 'Spesa comune', Amount: '20.00', __sourceRow: 2
});
assert.equal(sourceFingerprint, context.buildSourceTransactionFingerprint_({
  Amount: '20.00', Description: 'Spesa comune', 'Who paid': 'Marco', __sourceRow: 99
}));

const existing = [{ fingerprint: context.buildTransactionFingerprint_({
  date: '2026-06-01', amount: 20.25, currency: 'EUR', description: 'Bilancio inizio mese',
  payer: 'Marco', beneficiaries: 'Laura'
}) }];
const incoming = [
  { date: '2026-06-01', amount: 20.25, currency: 'EUR', description: 'Bilancio inizio mese',
    payer: 'Marco', beneficiaries: 'Laura' },
  { date: '2026-06-02', amount: 40, currency: 'EUR', description: 'HippoDog - cibo cani',
    payer: 'Laura', beneficiaries: 'Laura, Marco' }
];
const result = context.partitionIncomingRows_(incoming, existing);
assert.equal(result.unique.length, 1);
assert.equal(result.duplicates.length, 1);
assert.equal(result.unique[0].description, 'HippoDog - cibo cani');

const sourceStableDuplicate = context.partitionIncomingRows_([
  { date: '2026-06-02', amount: 40, currency: 'EUR', description: 'HippoDog - cibo cani',
    payer: 'Laura', beneficiaries: 'Laura, Marco', sourceFingerprint: 'same-source-row' }
], [{ fingerprint: 'source:same-source-row|canonical:unrelated' }]);
assert.equal(sourceStableDuplicate.unique.length, 0);
assert.equal(sourceStableDuplicate.duplicates.length, 1);

const sameDayDuplicate = context.partitionIncomingRows_([
  { date: '2026-06-26', amount: 10, currency: 'EUR', description: 'Carburante - metano',
    payer: 'Laura', beneficiaries: 'Laura, Marco' },
  { date: '2026-06-26', amount: 10, currency: 'EUR', description: 'Carburante - metano',
    payer: 'Laura', beneficiaries: 'Laura, Marco' }
], []);
assert.equal(sameDayDuplicate.unique.length, 2);
assert.equal(sameDayDuplicate.duplicates.length, 0);

const overlappingJsonDuplicate = context.partitionIncomingRows_([
  { date: '2026-03-29', amount: 36, currency: 'EUR', description: 'Brasserie',
    payer: 'Marco', beneficiaries: 'Laura, Marco', sourceFingerprint: 'tricount:brasserie-uuid' },
  { date: '2026-03-29', amount: 36, currency: 'EUR', description: 'Brasserie',
    payer: 'Marco', beneficiaries: 'Laura, Marco', sourceFingerprint: 'tricount:brasserie-uuid' }
], []);
assert.equal(overlappingJsonDuplicate.unique.length, 1);
assert.equal(overlappingJsonDuplicate.duplicates.length, 1);
assert.equal(overlappingJsonDuplicate.duplicates[0].reason, 'incoming_source_fingerprint');

const priorMonth = [
  { date: '2026-01-12', amount: 100, currency: 'EUR', description: 'Spesa comune',
    payer: 'Marco', beneficiaries: 'Marco, Laura', transactionType: 'expense' },
  { date: '2026-01-15', amount: 10, currency: 'EUR', description: 'Solo Laura',
    payer: 'Marco', beneficiaries: 'Laura', transactionType: 'expense' }
];
const openingBalance = { date: '2026-02-01', amount: 60, currency: 'EUR',
  payer: 'Marco', beneficiaries: 'Laura', transactionType: 'opening_balance' };
const matchingBalance = context.evaluateOpeningBalance_(openingBalance, priorMonth, 0.01);
assert.equal(matchingBalance.matched, true);
assert.deepEqual(JSON.parse(JSON.stringify(matchingBalance.differences)), [
  { name: 'Laura', expected: -60, actual: -60, difference: 0 },
  { name: 'Marco', expected: 60, actual: 60, difference: 0 }
]);
const mismatchingBalance = context.evaluateOpeningBalance_(Object.assign({}, openingBalance, { amount: 55 }),
  priorMonth, 0.01);
assert.equal(mismatchingBalance.matched, false);
assert.equal(mismatchingBalance.differences[0].difference, -5);
assert.equal(context.roundBalanceAmount_(293.005), 293.01);
assert.equal(context.roundBalanceAmount_(-293.005), -293.01);
const unverifiableBalance = context.evaluateOpeningBalance_(openingBalance, [], 0.01);
assert.equal(unverifiableBalance.status, 'unverifiable');

const carriedOpeningBalance = { date: '2026-01-01', amount: 50, currency: 'EUR',
  payer: 'Marco', beneficiaries: 'Laura', transactionType: 'opening_balance' };
const monthAfterCarry = [
  { date: '2025-12-31', amount: 100, currency: 'EUR', description: 'Previous period',
    payer: 'Laura', beneficiaries: 'Marco', transactionType: 'expense' },
  { date: '2026-01-12', amount: 20, currency: 'EUR', description: 'Spesa comune',
    payer: 'Marco', beneficiaries: 'Marco, Laura', transactionType: 'expense' }
];
const anchoredBalance = context.evaluateOpeningBalance_(
  Object.assign({}, openingBalance, { amount: 60 }), monthAfterCarry, 0.01, [carriedOpeningBalance]
);
assert.equal(anchoredBalance.matched, true);
assert.equal(anchoredBalance.anchor.date, '2026-01-01');

const reconciliationRecords = [
  { sourceFileId: 'march', sourceFileName: 'march.json', sourceRow: 2, amount: 36,
    currency: 'EUR', transactionType: 'expense' },
  { sourceFileId: 'march', sourceFileName: 'march.json', sourceRow: 3, amount: 20,
    currency: 'EUR', transactionType: 'opening_balance' },
  { sourceFileId: 'april', sourceFileName: 'april.json', sourceRow: 2, amount: 25,
    currency: 'EUR', transactionType: 'expense' }
];
const reconciliation = context.buildSourceReconciliations_(reconciliationRecords, {
  unique: [reconciliationRecords[0], reconciliationRecords[1]],
  duplicates: [{ row: reconciliationRecords[2], reason: 'existing_fingerprint' }]
}, [reconciliationRecords[0]], [
  { id: 'march', name: 'march.json', contentHash: 'march-hash' },
  { id: 'april', name: 'april.json', contentHash: 'april-hash' }
]);
assert.equal(reconciliation.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(reconciliation[0])), {
  sourceFileId: 'april', sourceFileName: 'april.json', sourceContentHash: 'april-hash',
  sourceRows: 1, importedRows: 0, duplicateRows: 1, openingBalanceRows: 0, unaccountedRows: 0,
  sourceTotals: { EUR: 25 }, accountedTotals: { EUR: 25 }, status: 'OK', decisions: [
    { sourceRow: 2, status: 'duplicate', amount: 25, currency: 'EUR', reason: 'existing_fingerprint' }
  ]
});
assert.deepEqual(JSON.parse(JSON.stringify(reconciliation[1])), {
  sourceFileId: 'march', sourceFileName: 'march.json', sourceContentHash: 'march-hash',
  sourceRows: 2, importedRows: 1, duplicateRows: 0, openingBalanceRows: 1, unaccountedRows: 0,
  sourceTotals: { EUR: 56 }, accountedTotals: { EUR: 56 }, status: 'OK', decisions: [
    { sourceRow: 2, status: 'imported', amount: 36, currency: 'EUR', reason: '' },
    { sourceRow: 3, status: 'opening_balance', amount: 20, currency: 'EUR', reason: '' }
  ]
});
const unreconciled = context.buildSourceReconciliations_([reconciliationRecords[0]], {
  unique: [], duplicates: []
}, [], [{ id: 'march', name: 'march.json', contentHash: 'march-hash' }]);
assert.equal(unreconciled[0].status, 'UNRECONCILED');
assert.equal(unreconciled[0].unaccountedRows, 1);
const emptyReconciliation = context.buildSourceReconciliations_([], { unique: [], duplicates: [] }, [], [
  { id: 'empty', name: 'empty.json', contentHash: 'empty-hash' }
]);
assert.deepEqual(JSON.parse(JSON.stringify(emptyReconciliation)), [{
  sourceFileId: 'empty', sourceFileName: 'empty.json', sourceContentHash: 'empty-hash',
  sourceRows: 0, importedRows: 0, duplicateRows: 0, openingBalanceRows: 0, unaccountedRows: 0,
  sourceTotals: {}, accountedTotals: {}, status: 'OK', decisions: []
}]);

console.log('expense core tests passed');
