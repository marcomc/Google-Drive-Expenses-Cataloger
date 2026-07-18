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
    archiveType: 'folder', archiveContainerId: '2026', archiveDepth: 1
  },
  {
    fileId: 'april', folderId: '2026', name: 'transactions-hostello-202604.json',
    archiveType: 'folder', archiveContainerId: '2026', archiveDepth: 1
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

const deleted = [];
const resetContext = {
  CONFIG: { PROPERTY_KEYS: { JSON_REBUILD_STATE: 'JSON_REBUILD_STATE' } },
  PropertiesService: { getScriptProperties: () => ({ deleteProperty: key => deleted.push(key) }) }
};
vm.createContext(resetContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), resetContext);
assert.deepEqual(JSON.parse(JSON.stringify(resetContext.resetTricountJsonRebuild())), { status: 'RESET' });
assert.deepEqual(deleted, ['JSON_REBUILD_STATE']);

console.log('rebuild state tests passed');
