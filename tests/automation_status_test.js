#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const properties = new Map([
  ['GEMINI_API_KEY', 'configured-key'],
  ['GEMINI_BACKEND', 'gemini_api'],
  ['ROOT_FOLDER_ID', 'root-folder'],
  ['SPREADSHEET_ID', 'spreadsheet-id'],
  ['AUTOMATION_CONFIG_JSON', '{}'],
  ['GOOGLE_CLOUD_PROJECT_ID', 'cloud-project'],
  ['AUTO_PROCESSING', 'true']
]);
const events = [];
const dashboardTriggerSpreadsheetIds = [];
let activeTriggers = [];
let failCreationFor = '';
let failDeletionFor = '';
let triggerLockAvailable = true;
let triggerLockAcquisitions = 0;
let triggerLockReleases = 0;
const triggerLockTimeouts = [];

function makeTrigger(handler, id) {
  const trigger = {
    getHandlerFunction: () => handler,
    getUniqueId: () => id,
    deleteTrigger: () => {
      events.push(`delete:${id}`);
      if (id === failDeletionFor) {
        throw new Error(`cannot delete ${id}`);
      }
      activeTriggers = activeTriggers.filter((candidate) => candidate !== trigger);
    }
  };
  return trigger;
}

const context = {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || '',
      setProperty: (key, value) => properties.set(key, String(value))
    })
  },
  ScriptApp: {
    getProjectTriggers: () => activeTriggers.slice(),
    deleteTrigger: (trigger) => trigger.deleteTrigger(),
    newTrigger: (handler) => ({
      forSpreadsheet: (spreadsheetId) => ({
        onEdit: () => ({
          create: () => {
            dashboardTriggerSpreadsheetIds.push(spreadsheetId);
            return createTrigger(handler);
          }
        })
      }),
      timeBased: () => ({
        everyMinutes: () => ({
          create: () => createTrigger(handler)
        }),
        atHour: () => ({
          everyDays: () => ({
            create: () => createTrigger(handler)
          })
        })
      })
    })
  },
  LockService: {
    getScriptLock: () => ({
      tryLock: (timeout) => {
        triggerLockAcquisitions += 1;
        triggerLockTimeouts.push(timeout);
        return triggerLockAvailable;
      },
      releaseLock: () => { triggerLockReleases += 1; }
    })
  },
  console
};

function createTrigger(handler) {
  events.push(`create:${handler}`);
  if (handler === failCreationFor) {
    throw new Error(`cannot create ${handler}`);
  }
  const trigger = makeTrigger(handler, `new-${handler}`);
  activeTriggers.push(trigger);
  return trigger;
}

vm.createContext(context);
vm.runInContext(fs.readFileSync('Config.gs', 'utf8'), context);
vm.runInContext(fs.readFileSync('DriveEvents.gs', 'utf8'), context);
vm.runInContext(fs.readFileSync('Installer.gs', 'utf8'), context);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), context);

assert.equal(context.getSetupStatus().automaticProcessingEnabled, true);
assert.equal(context.getSetupStatus().applicationVersion, '0.2.2');
assert.equal(context.getApplicationVersion(), '0.2.2');

let fallbackUntil = Date.now() + 60000;
properties.set('GEMINI_AUTO_VERTEX_FALLBACK', 'true');
properties.set('GEMINI_VERTEX_FALLBACK_UNTIL', String(fallbackUntil));
let setupStatus = context.getSetupStatus();
assert.equal(setupStatus.geminiBackend, 'gemini_api');
assert.equal(setupStatus.geminiEffectiveBackend, 'vertex_ai');
assert.equal(setupStatus.geminiAutoVertexFallbackEnabled, true);
assert.equal(setupStatus.geminiVertexFallbackUntil, new Date(fallbackUntil).toISOString());

properties.set('GEMINI_VERTEX_FALLBACK_UNTIL', String(Date.now() - 1));
setupStatus = context.getSetupStatus();
assert.equal(setupStatus.geminiEffectiveBackend, 'gemini_api');
assert.equal(setupStatus.geminiVertexFallbackUntil, '');

properties.set('GEMINI_VERTEX_FALLBACK_UNTIL', String(fallbackUntil));
properties.set('GEMINI_AUTO_VERTEX_FALLBACK', 'false');
setupStatus = context.getSetupStatus();
assert.equal(setupStatus.geminiEffectiveBackend, 'gemini_api');
assert.equal(setupStatus.geminiAutoVertexFallbackEnabled, false);
assert.equal(setupStatus.geminiVertexFallbackUntil, new Date(fallbackUntil).toISOString());

properties.set('GEMINI_BACKEND', 'vertex_ai');
setupStatus = context.getSetupStatus();
assert.equal(setupStatus.geminiBackend, 'vertex_ai');
assert.equal(setupStatus.geminiEffectiveBackend, 'vertex_ai');
properties.set('GEMINI_BACKEND', 'gemini_api');
properties.delete('GEMINI_AUTO_VERTEX_FALLBACK');
properties.delete('GEMINI_VERTEX_FALLBACK_UNTIL');

context.assertCatalogConfiguration_ = () => {};
context.getRootFolderId_ = () => 'root-folder';
context.loadDriveAgentsPolicy_ = () => {};
context.DriveApp = { getFolderById: () => ({}) };
context.SpreadsheetApp = {
  openById: () => ({ getUrl: () => 'https://example.test/spreadsheet' })
};
context.getExpenseSheetLayout_ = () => ({ transactions: {}, imports: {} });

properties.delete('AUTO_PROCESSING');
assert.equal(context.getSetupStatus().automaticProcessingEnabled, false);
activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily'),
  makeTrigger('applyDashboardYearColorsOnEdit', 'existing-dashboard-edit')
];
assert.equal(context.validateCatalogerInstallation().installed, true);
assert.equal(context.enableExpenseCataloging().status, 'ENABLED');
assert.equal(properties.get('AUTO_PROCESSING'), 'true');
assert.equal(context.disableExpenseCataloging().status, 'DISABLED');
assert.equal(properties.get('AUTO_PROCESSING'), 'false');

activeTriggers = [makeTrigger('runDailyExpenseCataloging', 'existing-daily')];
assert.deepEqual(JSON.parse(JSON.stringify(context.validateCatalogerInstallation())), {
  installed: false,
  automaticProcessingEnabled: false,
  missingTriggerHandlers: ['processDriveEventQueue'],
  duplicateTriggerHandlers: [],
  triggerCounts: {
    processDriveEventQueue: 0,
    runDailyExpenseCataloging: 1
  },
  dashboardYearColorEditTriggerCount: 0,
  spreadsheetUrl: 'https://example.test/spreadsheet'
});
assert.throws(() => context.enableExpenseCataloging(), /Managed automation triggers are not healthy/);
assert.equal(properties.get('AUTO_PROCESSING'), 'false');

activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily')
];
assert.throws(() => context.enableExpenseCataloging(), /Managed automation triggers are not healthy/);
assert.equal(properties.get('AUTO_PROCESSING'), 'false');

activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily'),
  makeTrigger('applyDashboardYearColorsOnEdit', 'existing-dashboard-edit-one'),
  makeTrigger('applyDashboardYearColorsOnEdit', 'existing-dashboard-edit-two')
];
assert.throws(() => context.enableExpenseCataloging(), /Managed automation triggers are not healthy/);
assert.equal(properties.get('AUTO_PROCESSING'), 'false');

activeTriggers = [
  makeTrigger('processDriveEventQueue', 'duplicate-polling-one'),
  makeTrigger('processDriveEventQueue', 'duplicate-polling-two'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily')
];
const duplicateStatus = context.validateCatalogerInstallation();
assert.equal(duplicateStatus.installed, false);
assert.deepEqual(JSON.parse(JSON.stringify(duplicateStatus.duplicateTriggerHandlers)), [
  'processDriveEventQueue'
]);

events.length = 0;
triggerLockAcquisitions = 0;
triggerLockReleases = 0;
triggerLockTimeouts.length = 0;
activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily'),
  makeTrigger('applyDashboardYearColorsOnEdit', 'existing-dashboard-edit')
];
assert.deepEqual(JSON.parse(JSON.stringify(context.installAutomationTriggers())), {
  triggerCounts: { processDriveEventQueue: 1, runDailyExpenseCataloging: 1 },
  missingTriggerHandlers: [], duplicateTriggerHandlers: [],
  dashboardYearColorEditTriggerCount: 1
});
assert.deepEqual(events, [
  'create:processDriveEventQueue',
  'create:runDailyExpenseCataloging',
  'create:applyDashboardYearColorsOnEdit',
  'delete:existing-dashboard-edit',
  'delete:existing-polling',
  'delete:existing-daily'
]);
assert.deepEqual(activeTriggers.map((trigger) => trigger.getHandlerFunction()).sort(), [
  'applyDashboardYearColorsOnEdit',
  'processDriveEventQueue',
  'runDailyExpenseCataloging'
]);
assert.equal(triggerLockAcquisitions, 1);
assert.equal(triggerLockReleases, 1);
assert.deepEqual(triggerLockTimeouts, [280000]);

events.length = 0;
activeTriggers = [];
triggerLockAcquisitions = 0;
triggerLockReleases = 0;
triggerLockTimeouts.length = 0;
assert.deepEqual(JSON.parse(JSON.stringify(context.installDashboardYearColorEditTrigger())), {
  triggerCount: 1
});
assert.deepEqual(events, ['create:applyDashboardYearColorsOnEdit']);
assert.deepEqual(activeTriggers.map((trigger) => trigger.getHandlerFunction()), [
  'applyDashboardYearColorsOnEdit'
]);
assert.equal(triggerLockAcquisitions, 1);
assert.equal(triggerLockReleases, 1);
assert.deepEqual(triggerLockTimeouts, [280000]);

events.length = 0;
activeTriggers = [
  makeTrigger('applyDashboardYearColorsOnEdit', 'old-dashboard-edit'),
  makeTrigger('applyDashboardYearColorsOnEdit', 'duplicate-dashboard-edit')
];
context.installDashboardYearColorEditTrigger();
assert.deepEqual(events, [
  'create:applyDashboardYearColorsOnEdit',
  'delete:old-dashboard-edit',
  'delete:duplicate-dashboard-edit'
]);
assert.equal(context.getDashboardYearColorEditTriggerCount_(), 1);
properties.set('SPREADSHEET_ID', 'replacement-spreadsheet');
context.installDashboardYearColorEditTrigger();
assert.equal(dashboardTriggerSpreadsheetIds.at(-1), 'replacement-spreadsheet',
  'trigger reconciliation must bind a replacement to the configured spreadsheet');
properties.set('SPREADSHEET_ID', 'spreadsheet-id');

triggerLockAcquisitions = 0;
triggerLockReleases = 0;
triggerLockAvailable = false;
assert.throws(() => context.installDashboardYearColorEditTrigger(), /Could not acquire the automation trigger lock/);
triggerLockAvailable = true;

triggerLockAvailable = false;
assert.throws(() => context.installAutomationTriggers(), /Could not acquire the automation trigger lock/);
assert.equal(triggerLockReleases, 0);
triggerLockAvailable = true;

events.length = 0;
triggerLockAcquisitions = 0;
triggerLockReleases = 0;
activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily')
];
context.removeAutomationTriggers();
assert.deepEqual(events, [
  'delete:existing-polling',
  'delete:existing-daily'
]);
assert.deepEqual(activeTriggers, []);
assert.equal(triggerLockAcquisitions, 1);
assert.equal(triggerLockReleases, 1);

events.length = 0;
activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily')
];
failCreationFor = 'runDailyExpenseCataloging';
assert.throws(() => context.installAutomationTriggers(), /cannot create runDailyExpenseCataloging/);
assert.deepEqual(events, [
  'create:processDriveEventQueue',
  'create:runDailyExpenseCataloging',
  'delete:new-processDriveEventQueue'
]);
assert.deepEqual(activeTriggers.map((trigger) => trigger.getUniqueId()).sort(), [
  'existing-daily',
  'existing-polling'
]);

events.length = 0;
activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily'),
  makeTrigger('applyDashboardYearColorsOnEdit', 'existing-dashboard-edit')
];
failCreationFor = 'applyDashboardYearColorsOnEdit';
assert.throws(() => context.installAutomationTriggers(), /cannot create applyDashboardYearColorsOnEdit/);
assert.deepEqual(events, [
  'create:processDriveEventQueue',
  'create:runDailyExpenseCataloging',
  'create:applyDashboardYearColorsOnEdit',
  'delete:new-processDriveEventQueue',
  'delete:new-runDailyExpenseCataloging'
]);
assert.deepEqual(activeTriggers.map((trigger) => trigger.getUniqueId()).sort(), [
  'existing-daily', 'existing-dashboard-edit', 'existing-polling'
]);
failCreationFor = '';

events.length = 0;
activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily'),
  makeTrigger('applyDashboardYearColorsOnEdit', 'existing-dashboard-edit')
];
failDeletionFor = 'existing-dashboard-edit';
assert.throws(() => context.installAutomationTriggers(), /cannot delete existing-dashboard-edit/);
assert.equal(context.getDashboardYearColorEditTriggerCount_(), 2,
  'a failed stale-trigger deletion must retain both old and replacement coverage');
failDeletionFor = '';
assert.deepEqual(JSON.parse(JSON.stringify(context.installAutomationTriggers())), {
  triggerCounts: { processDriveEventQueue: 1, runDailyExpenseCataloging: 1 },
  missingTriggerHandlers: [], duplicateTriggerHandlers: [],
  dashboardYearColorEditTriggerCount: 1
});
assert.equal(context.getDashboardYearColorEditTriggerCount_(), 1,
  'a retry after partial trigger deletion must converge to one edit trigger');
