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

function iterator(values) {
  let index = 0;
  return { hasNext: () => index < values.length, next: () => values[index++] };
}

function jsonStagePayload(sourceFile, records) {
  return JSON.stringify({ sourceFile, records });
}

function createPropertyStore(values) {
  const stored = Object.assign({}, values);
  const deleted = [];
  const set = [];
  return {
    deleted,
    set,
    service: {
      getProperty: key => stored[key] || null,
      setProperty: (key, value) => {
        stored[key] = value;
        set.push([key, value]);
      },
      deleteProperty: key => {
        delete stored[key];
        deleted.push(key);
      }
    }
  };
}

const resetStages = {};
sources.forEach(source => {
  const stageName = context.getJsonRebuildStageFileName_(initial, source);
  resetStages[stageName] = [{ trashed: false, setTrashed(value) { this.trashed = value; } }];
});
const resetProperties = createPropertyStore({ JSON_REBUILD_STATE: JSON.stringify(initial) });
const resetContext = {
  CONFIG: { PROPERTY_KEYS: { JSON_REBUILD_STATE: 'JSON_REBUILD_STATE' } },
  PropertiesService: { getScriptProperties: () => resetProperties.service },
  DriveApp: {
    getFolderById: id => {
      assert.equal(id, initial.stagingFolderId);
      return { getFilesByName: name => iterator(resetStages[name] || []) };
    }
  }
};
vm.createContext(resetContext);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), resetContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), resetContext);
assert.deepEqual(JSON.parse(JSON.stringify(resetContext.resetTricountJsonRebuild())), { status: 'RESET' });
assert.deepEqual(resetProperties.deleted, [
  'EXPENSE_JSON_REBUILD_STAGE_DIGEST_run-1-march.json',
  'EXPENSE_JSON_REBUILD_STAGE_DIGEST_run-1-april.json',
  'JSON_REBUILD_STATE'
]);
Object.keys(resetStages).forEach(name => assert.equal(resetStages[name][0].trashed, true));

const missingStageFolderProperties = createPropertyStore({
  JSON_REBUILD_STATE: JSON.stringify(initial)
});
const missingStageFolderContext = {
  CONFIG: { PROPERTY_KEYS: { JSON_REBUILD_STATE: 'JSON_REBUILD_STATE' } },
  PropertiesService: { getScriptProperties: () => missingStageFolderProperties.service },
  DriveApp: { getFolderById: () => { throw new Error('Staging folder was deleted.'); } }
};
vm.createContext(missingStageFolderContext);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), missingStageFolderContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), missingStageFolderContext);
assert.deepEqual(JSON.parse(JSON.stringify(
  missingStageFolderContext.resetTricountJsonRebuild()
)), { status: 'RESET' });
assert.deepEqual(missingStageFolderProperties.deleted, [
  'EXPENSE_JSON_REBUILD_STAGE_DIGEST_run-1-march.json',
  'EXPENSE_JSON_REBUILD_STAGE_DIGEST_run-1-april.json',
  'JSON_REBUILD_STATE'
]);

const archiveReadyResetState = Object.assign({}, initial, {
  nextIndex: initial.sources.length,
  archiveReady: true,
  archiveYearsByFileId: { march: '2026', april: '2026' },
  rebuildSummary: { sourceEntries: 0, imported: 0, openingBalanceChecks: 0 }
});
const archiveReadyResetProperties = createPropertyStore({
  JSON_REBUILD_STATE: JSON.stringify(archiveReadyResetState)
});
const archiveReadyResetContext = {
  CONFIG: { PROPERTY_KEYS: { JSON_REBUILD_STATE: 'JSON_REBUILD_STATE' } },
  PropertiesService: { getScriptProperties: () => archiveReadyResetProperties.service },
  DriveApp: { getFolderById: () => { throw new Error('Archive-ready reset must not clean stages.'); } }
};
vm.createContext(archiveReadyResetContext);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), archiveReadyResetContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), archiveReadyResetContext);
assert.throws(
  () => archiveReadyResetContext.resetTricountJsonRebuild(),
  /ledger is already committed; rerun the rebuild to finish archival/
);
assert.deepEqual(archiveReadyResetProperties.deleted, []);

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

const stageSourceFile = {
  getId: () => 'stage-source-file',
  getName: () => 'transactions-hostello-202608.json',
  getUrl: () => 'https://example.test/file/stage-source-file',
  getBlob: () => ({ getDataAsString: () => '{}' })
};
const stageSource = {
  fileId: stageSourceFile.getId(), folderId: 'stage-root-folder', name: stageSourceFile.getName(),
  contentHash: '{}', archiveType: 'file', archiveContainerId: stageSourceFile.getId(), archiveDepth: 0
};
const stageCreationState = {
  version: 2, runId: 'run-stage', stagingFolderId: 'staging-stage', sources: [stageSource], nextIndex: 0,
  startedAt: '2026-07-18T00:00:00Z'
};
const createdStages = [];
const stageCreationProperties = createPropertyStore({});
const stageCreationContext = { MimeType: {} };
vm.createContext(stageCreationContext);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), stageCreationContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), stageCreationContext);
stageCreationContext.sha256_ = value => String(value);
stageCreationContext.DriveApp = {
  getFileById: id => {
    assert.equal(id, stageSource.fileId);
    return stageSourceFile;
  },
  getFolderById: id => {
    if (id === stageCreationState.stagingFolderId) {
      return {
        getFilesByName: () => iterator([]),
        createFile: (name, payload, mimeType) => {
          if (!mimeType) {
            throw new Error('Argument cannot be null: mimeType');
          }
          createdStages.push({ name, payload, mimeType });
        }
      };
    }
    assert.equal(id, stageSource.folderId);
    return { getId: () => stageSource.folderId, getName: () => 'stage-root-folder' };
  }
};
stageCreationContext.PropertiesService = { getScriptProperties: () => stageCreationProperties.service };
stageCreationContext.assertRebuildSourceFileSnapshot_ = () => {};
stageCreationContext.parseTricountJsonExport_ = () => [{ sourceTransactionId: 'entry-1' }];
stageCreationContext.normalizeExpenseJsonWithAi_ = () => [{ fingerprint: 'normalized-entry-1' }];
stageCreationContext.stageJsonRebuildSource_(stageCreationState, stageSource, {}, {});
const stageName = context.getJsonRebuildStageFileName_(stageCreationState, stageSource);
assert.deepEqual(createdStages, [{
  name: stageName,
  payload: jsonStagePayload({
    id: stageSource.fileId, name: stageSource.name, url: stageSourceFile.getUrl(), contentHash: '{}'
  }, [{ fingerprint: 'normalized-entry-1' }]),
  mimeType: 'application/json'
}]);
assert.deepEqual(stageCreationProperties.set, [[
  'EXPENSE_JSON_REBUILD_STAGE_DIGEST_' + stageName, createdStages[0].payload
]]);

let resumePayload = createdStages[0].payload;
let sourceLookups = 0;
const resumeProperties = createPropertyStore({
  ['EXPENSE_JSON_REBUILD_STAGE_DIGEST_' + stageName]: createdStages[0].payload
});
const resumeContext = {};
vm.createContext(resumeContext);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), resumeContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), resumeContext);
resumeContext.sha256_ = value => String(value);
resumeContext.PropertiesService = { getScriptProperties: () => resumeProperties.service };
resumeContext.DriveApp = {
  getFileById: () => {
    sourceLookups += 1;
    throw new Error('A matching durable stage must be reused without source processing.');
  },
  getFolderById: id => {
    assert.equal(id, stageCreationState.stagingFolderId);
    return { getFilesByName: () => iterator([{
      getBlob: () => ({ getDataAsString: () => resumePayload })
    }]) };
  }
};
resumeContext.stageJsonRebuildSource_(stageCreationState, stageSource, {}, {});
assert.equal(sourceLookups, 0);
resumePayload = jsonStagePayload({
  id: stageSource.fileId, name: stageSource.name, url: stageSourceFile.getUrl(), contentHash: '{}'
}, [{ fingerprint: 'tampered-record' }]);
assert.throws(
  () => resumeContext.stageJsonRebuildSource_(stageCreationState, stageSource, {}, {}),
  /Staged JSON rebuild data was modified/
);
assert.equal(sourceLookups, 0);

const finalStageFile = { trashed: false, setTrashed(value) { this.trashed = value; } };
const finalProperties = createPropertyStore({
  ['EXPENSE_JSON_REBUILD_STAGE_DIGEST_' + stageName]: createdStages[0].payload
});
const finalState = Object.assign({}, stageCreationState, {
  nextIndex: 1,
  commitStarted: true,
  archiveReady: true,
  archiveYearsByFileId: { [stageSource.fileId]: '2026' },
  rebuildSummary: { sourceEntries: 1, imported: 1, openingBalanceChecks: 0 }
});
let finalArchiveResults = null;
const finalContext = {
  CONFIG: { PROPERTY_KEYS: { JSON_REBUILD_STATE: 'JSON_REBUILD_STATE' } },
  PropertiesService: { getScriptProperties: () => finalProperties.service },
  DriveApp: {
    getFolderById: id => {
      assert.equal(id, finalState.stagingFolderId);
      return { getFilesByName: () => iterator([finalStageFile]) };
    }
  }
};
vm.createContext(finalContext);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), finalContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), finalContext);
finalContext.assertJsonRebuildDiscoveryUnchanged_ = () => {};
finalContext.assertJsonRebuildSourcesUnchanged_ = () => {};
finalContext.archiveRebuiltSources_ = (root, results) => {
  assert.equal(finalStageFile.trashed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(results)), [{
    source: finalState.sources[0], records: [{ date: '2026-01-01' }]
  }]);
  finalArchiveResults = results;
};
finalContext.saveSourceFolderState_ = () => {};
assert.deepEqual(JSON.parse(JSON.stringify(
  finalContext.finalizeJsonRebuildArchive_({}, finalState, {})
)), {
  status: 'REBUILT', sourceFiles: 1, sourceEntries: 1, imported: 1, openingBalanceChecks: 0
});
assert.ok(finalArchiveResults);
assert.deepEqual(finalProperties.deleted, [
  'EXPENSE_JSON_REBUILD_STAGE_DIGEST_' + stageName,
  'JSON_REBUILD_STATE'
]);

const commitState = {
  runId: 'run-2', stagingFolderId: 'staging-2', sources: [source], nextIndex: 1, commitStarted: true
};
const originalCommitStagePayload = jsonStagePayload({
  id: source.fileId, name: source.name, contentHash: source.contentHash
}, []);
let commitStagePayload = originalCommitStagePayload;
const stagedFile = { getBlob: () => ({ getDataAsString: () => commitStagePayload }) };
const commitStageName = context.getJsonRebuildStageFileName_(commitState, source);
const commitProperties = createPropertyStore({
  ['EXPENSE_JSON_REBUILD_STAGE_DIGEST_' + commitStageName]: originalCommitStagePayload
});
let cleared = false;
let wroteLedger = false;
const commitContext = { console };
vm.createContext(commitContext);
vm.runInContext(fs.readFileSync('ExpenseCore.gs', 'utf8'), commitContext);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), commitContext);
commitContext.sha256_ = value => String(value);
commitContext.PropertiesService = { getScriptProperties: () => commitProperties.service };
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

commitStagePayload = jsonStagePayload({
  id: source.fileId, name: source.name, contentHash: source.contentHash
}, [{ fingerprint: 'tampered-record' }]);
assert.throws(
  () => commitContext.commitJsonRebuild_(rootFolder, commitState),
  /Staged JSON rebuild data was modified/
);
assert.equal(cleared, false);
assert.equal(wroteLedger, false);

commitStagePayload = originalCommitStagePayload;
assert.throws(
  () => commitContext.commitJsonRebuild_(rootFolder, commitState),
  /Eligible JSON sources changed during rebuild staging/
);
assert.equal(cleared, false);
assert.equal(wroteLedger, false);

console.log('rebuild state tests passed');
