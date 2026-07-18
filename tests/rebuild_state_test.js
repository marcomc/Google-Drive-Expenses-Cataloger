#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), context);

const sources = [
  {
    fileId: 'march', folderId: '2026', name: 'transactions-hostello-202603.json',
    contentHash: 'march-hash', archiveType: 'folder', archiveContainerId: '2026', archiveDepth: 1
  },
  {
    fileId: 'april', folderId: '2026', name: 'transactions-hostello-202604.json',
    contentHash: 'april-hash', archiveType: 'folder', archiveContainerId: '2026', archiveDepth: 1
  }
];
const initial = context.createJsonRebuildState_('run-1', 'staging-1', sources, '2026-07-18T00:00:00Z');

assert.equal(context.isValidJsonRebuildState_(initial), true);
assert.equal(context.isJsonRebuildReadyToCommit_(initial), false);
assert.equal(context.getJsonRebuildStageFileName_(initial, sources[0]), 'run-1-march.json');

const afterMarch = context.advanceJsonRebuildState_(initial);
assert.equal(initial.nextIndex, 0);
assert.equal(afterMarch.nextIndex, 1);
assert.equal(context.getJsonRebuildStageFileName_(afterMarch, sources[0]), 'run-1-march.json');

const ready = context.advanceJsonRebuildState_(afterMarch);
assert.equal(context.isJsonRebuildReadyToCommit_(ready), true);
assert.throws(() => context.advanceJsonRebuildState_(ready), /completed JSON rebuild state/);
assert.equal(context.isValidJsonRebuildState_(Object.assign({}, initial, { nextIndex: 3 })), false);
assert.equal(context.isJsonRebuildReadyToCommit_(Object.assign({}, initial, { nextIndex: 3 })), false);
assert.equal(context.isValidJsonRebuildState_(Object.assign({}, initial, { version: 1 })), false);
assert.equal(context.isValidJsonRebuildState_(Object.assign({}, initial, {
  sources: [{ fileId: 'legacy', folderId: 'root', name: 'transactions-hostello-202607.json' }]
})), false);
assert.equal(context.isValidJsonRebuildStage_({
  sourceFile: { id: 'march', name: sources[0].name, contentHash: 'march-hash' }, records: []
}, sources[0]), true);
assert.equal(context.isValidJsonRebuildStage_({
  sourceFile: { id: 'march', name: sources[0].name, contentHash: 'changed' }, records: []
}, sources[0]), false);
assert.equal(context.isValidJsonRebuildStage_({
  sourceFile: { id: 'march', name: sources[0].name, contentHash: 'march-hash' }
}, sources[0]), false);

const deleted = [];
const resetContext = {
  CONFIG: { PROPERTY_KEYS: { JSON_REBUILD_STATE: 'JSON_REBUILD_STATE' } },
  PropertiesService: { getScriptProperties: () => ({ deleteProperty: key => deleted.push(key) }) }
};
vm.createContext(resetContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), resetContext);
assert.deepEqual(JSON.parse(JSON.stringify(resetContext.resetTricountJsonRebuild())), { status: 'RESET' });
assert.deepEqual(deleted, ['JSON_REBUILD_STATE']);

function iterator(values) {
  let index = 0;
  return { hasNext: () => index < values.length, next: () => values[index++] };
}

let sourceContent = 'initial-content';
const sourceFile = {
  getId: () => 'source-file',
  getName: () => 'transactions-hostello-202607.json',
  getUrl: () => 'https://example.test/file/source-file',
  getBlob: () => ({ getDataAsString: () => sourceContent })
};
const rootFolder = {
  getId: () => 'root-folder',
  getUrl: () => 'https://example.test/folder/root-folder',
  getFiles: () => iterator([sourceFile]),
  getFolders: () => iterator([])
};
const source = {
  fileId: sourceFile.getId(), folderId: rootFolder.getId(), name: sourceFile.getName(),
  contentHash: sourceContent, archiveType: 'file', archiveContainerId: sourceFile.getId(), archiveDepth: 0
};
const commitState = {
  runId: 'run-2', stagingFolderId: 'staging-2', sources: [source], nextIndex: 1, commitStarted: true
};
const stagedFile = {
  getBlob: () => ({ getDataAsString: () => JSON.stringify({
    sourceFile: { id: source.fileId, name: source.name, contentHash: source.contentHash }, records: []
  }) })
};
let cleared = false;
let wroteLedger = false;
const commitContext = { console };
vm.createContext(commitContext);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), commitContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), commitContext);
commitContext.sha256_ = value => String(value);
commitContext.getAutomationConfig_ = () => ({
  intake_keyword: 'hostello', archive_folder_name: 'Importazioni', excluded_root_folder_names: []
});
commitContext.DriveApp = {
  getFileById: id => {
    assert.equal(id, source.fileId);
    return sourceFile;
  },
  getFolderById: id => {
    assert.equal(id, commitState.stagingFolderId);
    return { getFilesByName: () => iterator([stagedFile]) };
  }
};
commitContext.getSpreadsheetId_ = () => 'spreadsheet-id';
commitContext.SpreadsheetApp = { openById: () => ({}) };
commitContext.getExpenseSheetLayout_ = () => {
  sourceContent = 'changed-after-initial-validation';
  return {};
};
commitContext.clearJsonRebuildTargets_ = () => { cleared = true; };
commitContext.writeLedgerRows_ = () => {
  wroteLedger = true;
  return [];
};

assert.throws(
  () => commitContext.commitJsonRebuild_(rootFolder, commitState),
  /Eligible JSON sources changed during rebuild staging/
);
assert.equal(cleared, false);
assert.equal(wroteLedger, false);

console.log('rebuild state tests passed');
