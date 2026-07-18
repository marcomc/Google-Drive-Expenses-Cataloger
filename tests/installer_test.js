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
assert.equal(reconfigureOptions.automationConfig.archive_folder_name, 'Imported');
assert.doesNotThrow(() => context.validateInstallerGeminiAccess_(reconfigureOptions));

const italianOptions = context.validateInstallerOptions_({
  ...options,
  automationConfig: { ...options.automationConfig, locale: 'it' }
});
assert.equal(italianOptions.automationConfig.archive_folder_name, 'Importazioni');
assert.ok(italianOptions.automationConfig.excluded_root_folder_names.includes('_Imported'));
assert.ok(italianOptions.automationConfig.excluded_root_folder_names.includes('Importazioni'));

properties.clear();
assert.throws(
  () => context.validateInstallerGeminiAccess_(reconfigureOptions),
  /geminiSecretVersion is required/
);

function createPolicyFile(content, ignoreWrites = false) {
  let stored = content;
  return {
    getBlob: () => ({ getDataAsString: () => stored }),
    setContent: (next) => {
      if (!ignoreWrites) {
        stored = next;
      }
    },
    getUrl: () => 'https://example.test/policy',
    getContent: () => stored
  };
}

function createPolicyRoot(file) {
  return {
    getFilesByName: () => {
      let read = false;
      return {
        hasNext: () => !read,
        next: () => {
          read = true;
          return file;
        }
      };
    }
  };
}

const existingPolicy = [
  '# Expense import policy',
  '',
  'Local operators classify bar tabs as shared expenses.',
  '',
  '## Scope',
  '',
  '- Retain the existing local retention period.',
  '',
  '## Local operations',
  '',
  '- Send an operator a weekly reconciliation reminder.'
].join('\n');
const templatePolicy = [
  '# Expense import policy',
  '',
  'Template policy applies to every import.',
  '',
  '## Scope',
  '',
  '- Process matching JSON files in the configured root.',
  '- Archive only after ledger verification.',
  '',
  '## Import',
  '',
  '- Preserve canonical source coordinates.'
].join('\n');
const existingPolicyFile = createPolicyFile(existingPolicy);
context.ensureInstallerPolicyFile_(createPolicyRoot(existingPolicyFile), templatePolicy);
assert.match(existingPolicyFile.getContent(), /Template policy applies to every import\./);
assert.match(existingPolicyFile.getContent(), /Retain the existing local retention period\./);
assert.match(existingPolicyFile.getContent(), /weekly reconciliation reminder/);
assert.match(existingPolicyFile.getContent(), /Preserve canonical source coordinates\./);

const failedPolicyWrite = createPolicyFile(existingPolicy, true);
assert.throws(
  () => context.ensureInstallerPolicyFile_(createPolicyRoot(failedPolicyWrite), templatePolicy),
  /AGENTS\.md verification failed: missing template instructions/
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
