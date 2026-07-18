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

function file(id, name) {
  return {
    getId: () => id,
    getName: () => name,
    getUrl: () => `https://example.test/file/${id}`,
    moveTo: (destination) => moves.push({ type: 'file', id, destination })
  };
}

function folder(id, name, files = [], folders = []) {
  return {
    getId: () => id,
    getName: () => name,
    getUrl: () => `https://example.test/folder/${id}`,
    getFiles: () => iterator(files),
    getFolders: () => iterator(folders),
    moveTo: (destination) => moves.push({ type: 'folder', id, destination })
  };
}

const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), context);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), context);

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
    source: { archiveType: 'folder', archiveContainerId: 'monthly', archiveDepth: 1 },
    records: [{ date: '2026-05-01' }]
  },
  {
    source: { archiveType: 'folder', archiveContainerId: 'child', archiveDepth: 2 },
    records: [{ date: '2026-06-01' }]
  },
  {
    source: { archiveType: 'file', archiveContainerId: 'root-json', archiveDepth: 0 },
    records: [{ date: '2026-07-01' }]
  }
]);
assert.deepEqual(moves.map((move) => ({ type: move.type, id: move.id, name: move.destination.name })), [
  { type: 'folder', id: 'child', name: '2026' },
  { type: 'folder', id: 'monthly', name: '2026' },
  { type: 'file', id: 'root-json', name: '2026' }
]);

console.log('intake source tests passed');
