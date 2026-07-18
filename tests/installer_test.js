#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const properties = new Map();
const context = {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || '',
      setProperties: (values) => {
        Object.entries(values).forEach(([key, value]) => properties.set(key, value));
      },
      deleteProperty: (key) => properties.delete(key)
    })
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('Config.gs', 'utf8'), context);
vm.runInContext(fs.readFileSync('Installer.gs', 'utf8'), context);

const options = {
  projectId: 'project',
  rootFolderId: 'folder',
  spreadsheetTitle: 'Expenses',
  notificationRecipient: 'test@example.com',
  geminiBackend: 'gemini_api',
  geminiModel: 'gemini-3.5-flash',
  vertexLocation: 'global',
  agentsPolicy: 'policy',
  timeZone: 'Europe/Rome',
  automationConfig: {
    locale: 'en',
    intake_keyword: 'HoStello',
    archive_folder_name: '_Imported',
    test_fixture_folder_name: '_Test-fixtures',
    excluded_root_folder_names: [],
    categories: { Other: ['Other'] }
  }
};

assert.throws(
  () => context.validateInstallerGeminiAccess_(context.validateInstallerOptions_(options)),
  /geminiSecretVersion is required/
);

properties.set('GEMINI_API_KEY', 'persisted-key');
const reconfigureOptions = context.validateInstallerOptions_({
  ...options,
  reuseExistingGeminiApiKey: true
});
assert.equal(reconfigureOptions.reuseExistingGeminiApiKey, true);
assert.doesNotThrow(() => context.validateInstallerGeminiAccess_(reconfigureOptions));

properties.clear();
assert.throws(
  () => context.validateInstallerGeminiAccess_(reconfigureOptions),
  /geminiSecretVersion is required/
);

context.ensureInstallerPolicyFile_ = () => ({ getUrl: () => 'https://example.test/policy' });
context.ensureInstallerSpreadsheet_ = () => ({
  getId: () => 'spreadsheet',
  getUrl: () => 'https://example.test/spreadsheet'
});
context.assertCatalogConfiguration_ = () => {};
context.getOrCreateChildFolder_ = () => {};
context.installAutomationTriggers = () => {};
context.getGeminiBackend_ = () => 'vertex_ai';
context.DriveApp = { getFolderById: () => ({ getUrl: () => 'https://example.test/root' }) };
properties.set('AUTO_PROCESSING', 'true');
context.bootstrapCatalogerInstallation({
  ...options,
  geminiBackend: 'vertex_ai',
  preserveAutomaticProcessing: true
});
assert.equal(properties.get('AUTO_PROCESSING'), 'true');

console.log('installer tests passed');
