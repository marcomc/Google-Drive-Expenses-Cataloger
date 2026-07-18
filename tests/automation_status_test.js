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
let activeTriggers = [];
let failCreationFor = '';
let triggerLockAvailable = true;
let triggerLockAcquisitions = 0;
let triggerLockReleases = 0;

function makeTrigger(handler, id) {
  return {
    getHandlerFunction: () => handler,
    getUniqueId: () => id,
    deleteTrigger: () => {
      events.push(`delete:${id}`);
      activeTriggers = activeTriggers.filter((trigger) => trigger.getUniqueId() !== id);
    }
  };
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
      tryLock: () => {
        triggerLockAcquisitions += 1;
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
  makeTrigger('runDailyExpenseCataloging', 'existing-daily')
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
  spreadsheetUrl: 'https://example.test/spreadsheet'
});
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
activeTriggers = [
  makeTrigger('processDriveEventQueue', 'existing-polling'),
  makeTrigger('runDailyExpenseCataloging', 'existing-daily')
];
context.installAutomationTriggers();
assert.deepEqual(events, [
  'create:processDriveEventQueue',
  'create:runDailyExpenseCataloging',
  'delete:existing-polling',
  'delete:existing-daily'
]);
assert.deepEqual(activeTriggers.map((trigger) => trigger.getHandlerFunction()).sort(), [
  'processDriveEventQueue',
  'runDailyExpenseCataloging'
]);
assert.equal(triggerLockAcquisitions, 1);
assert.equal(triggerLockReleases, 1);

triggerLockAvailable = false;
assert.throws(() => context.installAutomationTriggers(), /Another automation trigger operation is already running/);
assert.equal(triggerLockReleases, 1);
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
