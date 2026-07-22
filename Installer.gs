const INSTALLER_SECRET_PREFIX = 'drive-expenses-cataloger-';
// V11:X100 provides 90 comparison-year controls. The corresponding chart
// sources need one label column plus one series column for every control row.
const DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW = 11;
const DASHBOARD_COMPARISON_YEAR_CONTROL_ROW_COUNT = 90;
const DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW = DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW +
  DASHBOARD_COMPARISON_YEAR_CONTROL_ROW_COUNT - 1;
const DASHBOARD_DETAIL_YEAR_HEADER_ROW = DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW + 2;
const DASHBOARD_DETAIL_YEAR_VALUE_ROW = DASHBOARD_DETAIL_YEAR_HEADER_ROW + 1;
const DASHBOARD_MERCHANT_SORT_HEADER_ROW = DASHBOARD_DETAIL_YEAR_VALUE_ROW + 2;
const DASHBOARD_MERCHANT_SORT_VALUE_ROW = DASHBOARD_MERCHANT_SORT_HEADER_ROW + 1;
const DASHBOARD_CONTROL_LAST_ROW = DASHBOARD_MERCHANT_SORT_VALUE_ROW;
const DASHBOARD_COMPARISON_CHART_COLUMN_COUNT = DASHBOARD_COMPARISON_YEAR_CONTROL_ROW_COUNT + 1;
const DASHBOARD_BOUNDED_CHART_COLUMN_COUNT = 26;
const DASHBOARD_TOP_MERCHANT_CHART_COLUMN_COUNT = 2;

/** Owner-only bootstrap invoked by the resumable local installer. */
function bootstrapCatalogerInstallation(options) {
  const validated = validateInstallerOptions_(options);
  if (validated.geminiSecretVersion) {
    validated.geminiApiKey = readInstallerGeminiApiKey_(validated);
  }
  validateInstallerGeminiAccess_(validated);
  const root = DriveApp.getFolderById(validated.rootFolderId);
  const policy = ensureInstallerPolicyFile_(root, validated.agentsPolicy);
  const spreadsheet = ensureInstallerSpreadsheet_(root, validated.spreadsheetId,
    validated.spreadsheetTitle, validated.automationConfig, validated.timeZone);
  const properties = PropertiesService.getScriptProperties();
  const automaticProcessing = validated.preserveAutomaticProcessing &&
    properties.getProperty(CONFIG.PROPERTY_KEYS.AUTO_PROCESSING) === 'true' ? 'true' : 'false';
  const values = {
    GEMINI_BACKEND: validated.geminiBackend,
    GEMINI_MODEL: validated.geminiModel,
    GEMINI_AUTO_VERTEX_FALLBACK: String(validated.autoVertexFallback),
    VERTEX_AI_LOCATION: validated.vertexLocation,
    NOTIFICATION_RECIPIENT: validated.notificationRecipient,
    ROOT_FOLDER_ID: validated.rootFolderId,
    SPREADSHEET_ID: spreadsheet.getId(),
    AUTOMATION_CONFIG_JSON: JSON.stringify(validated.automationConfig),
    GOOGLE_CLOUD_PROJECT_ID: validated.projectId,
    AUTO_PROCESSING: automaticProcessing,
    INSTALLER_COMPLETED_AT: new Date().toISOString()
  };
  if (validated.geminiApiKey) {
    values.GEMINI_API_KEY = validated.geminiApiKey;
  }
  properties.setProperties(values, false);
  properties.deleteProperty(CONFIG.PROPERTY_KEYS.GEMINI_VERTEX_FALLBACK_UNTIL);
  assertCatalogConfiguration_();
  getOrCreateChildFolder_(root, validated.automationConfig.test_fixture_folder_name);
  getOrCreateChildFolder_(root, validated.automationConfig.archive_folder_name);
  installAutomationTriggers();
  return {
    installed: true,
    rootFolderUrl: root.getUrl(),
    policyFileUrl: policy.getUrl(),
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    geminiBackend: getGeminiBackend_()
  };
}

function validateCatalogerInstallation() {
  assertCatalogConfiguration_();
  const root = DriveApp.getFolderById(getRootFolderId_());
  loadDriveAgentsPolicy_(root);
  const spreadsheetId = getSpreadsheetId_();
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const layout = getExpenseSheetLayout_(spreadsheet);
  const triggerStatus = getAutomationTriggerStatus_();
  const dashboardTriggerStatus = getDashboardYearColorEditTriggerStatus_(spreadsheetId);
  const dashboardYearColorEditTriggerCount = dashboardTriggerStatus.triggerCount;
  return {
    installed: Boolean(layout.transactions && layout.imports &&
      triggerStatus.missingTriggerHandlers.length === 0 &&
      triggerStatus.duplicateTriggerHandlers.length === 0 &&
      triggerStatus.invalidTriggerHandlers.length === 0 &&
      dashboardYearColorEditTriggerCount === 1 &&
      dashboardTriggerStatus.totalTriggerCount === 1),
    automaticProcessingEnabled: isAutomaticProcessingEnabled_(),
    missingTriggerHandlers: triggerStatus.missingTriggerHandlers,
    duplicateTriggerHandlers: triggerStatus.duplicateTriggerHandlers,
    invalidTriggerHandlers: triggerStatus.invalidTriggerHandlers,
    triggerCounts: triggerStatus.triggerCounts,
    dashboardYearColorEditTriggerCount: dashboardYearColorEditTriggerCount,
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

/** Reapply the managed layout, reporting formulas, and presentation explicitly. */
function refreshSpreadsheetLayoutAndPresentation() {
  return withAutomationTriggerLock_(function () {
    assertCatalogConfiguration_();
    const spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
    initializeInstallerSheets_(spreadsheet, getAutomationConfig_());
    SpreadsheetApp.flush();
    return { status: 'REFRESHED', spreadsheetUrl: spreadsheet.getUrl() };
  });
}

function validateInstallerOptions_(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Installer options must be an object.');
  }
  ['projectId', 'rootFolderId', 'spreadsheetTitle', 'notificationRecipient',
    'geminiBackend', 'geminiModel', 'vertexLocation', 'agentsPolicy', 'timeZone'].forEach(
    function (key) {
      if (!String(options[key] || '').trim()) {
        throw new Error('Installer option is required: ' + key);
      }
    }
  );
  if (['gemini_api', 'vertex_ai'].indexOf(options.geminiBackend) < 0) {
    throw new Error('geminiBackend must be gemini_api or vertex_ai.');
  }
  validateAutomationConfig_(options.automationConfig);
  const automationConfig = normalizeAutomationConfig_(options.automationConfig);
  return {
    projectId: String(options.projectId).trim(), rootFolderId: String(options.rootFolderId).trim(),
    spreadsheetId: String(options.spreadsheetId || '').trim(),
    spreadsheetTitle: String(options.spreadsheetTitle).trim(),
    notificationRecipient: String(options.notificationRecipient).trim(),
    geminiBackend: options.geminiBackend, geminiModel: String(options.geminiModel).trim(),
    autoVertexFallback: options.autoVertexFallback === true,
    vertexLocation: String(options.vertexLocation).trim(),
    automationConfig: automationConfig, agentsPolicy: String(options.agentsPolicy),
    geminiSecretVersion: String(options.geminiSecretVersion || '').trim(), geminiApiKey: '',
    reuseExistingGeminiApiKey: options.reuseExistingGeminiApiKey === true,
    preserveAutomaticProcessing: options.preserveAutomaticProcessing === true,
    timeZone: String(options.timeZone).trim()
  };
}

function readInstallerGeminiApiKey_(options) {
  const secretId = INSTALLER_SECRET_PREFIX + ScriptApp.getScriptId();
  const expectedPrefix = 'projects/' + options.projectId + '/secrets/' + secretId + '/versions/';
  if (options.geminiSecretVersion.indexOf(expectedPrefix) !== 0) {
    throw new Error('The Gemini transfer secret does not belong to this installation.');
  }
  const response = UrlFetchApp.fetch(
    'https://secretmanager.googleapis.com/v1/' + options.geminiSecretVersion + ':access',
    { method: 'get', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('Could not access the temporary Gemini credential.');
  }
  const encoded = JSON.parse(response.getContentText()).payload.data;
  const value = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString().trim();
  if (!value) {
    throw new Error('The temporary Gemini credential is empty.');
  }
  return value;
}

function validateInstallerGeminiAccess_(options) {
  if (options.geminiBackend === 'gemini_api') {
    if (options.geminiSecretVersion) {
      return;
    }
    if (options.reuseExistingGeminiApiKey &&
      PropertiesService.getScriptProperties().getProperty(CONFIG.PROPERTY_KEYS.GEMINI_API_KEY)) {
      return;
    }
    throw new Error('geminiSecretVersion is required for Gemini Developer API.');
  }
  if (!options.projectId) {
    throw new Error('projectId is required for Vertex AI.');
  }
}

function ensureInstallerPolicyFile_(root, text) {
  const matches = [];
  const files = root.getFilesByName(CONFIG.DRIVE_AGENTS_FILE_NAME);
  while (files.hasNext()) {
    matches.push(files.next());
  }
  if (matches.length > 1) {
    throw new Error('The intake root contains multiple AGENTS.md files.');
  }
  const policy = matches.length === 1 ? matches[0] :
    root.createFile(CONFIG.DRIVE_AGENTS_FILE_NAME, text, MimeType.PLAIN_TEXT);
  const existing = matches.length === 1 ? readInstallerPolicyFile_(policy) : '';
  const merged = mergeInstallerPolicyText_(existing, text);
  policy.setContent(merged);
  verifyInstallerPolicyFile_(policy, merged);
  return policy;
}

function readInstallerPolicyFile_(file) {
  return file.getBlob().getDataAsString('UTF-8');
}

function mergeInstallerPolicyText_(existing, template) {
  const managedTemplate = getInstallerManagedPolicyText_(template);
  const existingText = String(existing || '').trim();
  if (!existingText) {
    return managedTemplate;
  }
  const existingMarkers = getInstallerPolicyMarkers_(existingText);
  if (existingMarkers.hasMarkers) {
    return renderInstallerPolicyParts_([
      existingMarkers.before,
      managedTemplate,
      existingMarkers.after
    ]);
  }
  const customText = extractInstallerLegacyCustomPolicyText_(existingText,
    getInstallerManagedPolicyContent_(managedTemplate));
  return renderInstallerPolicyParts_([managedTemplate, customText]);
}

const INSTALLER_POLICY_MANAGED_BEGIN =
  '<!-- BEGIN Google Drive Expenses Cataloger managed policy -->';
const INSTALLER_POLICY_MANAGED_END =
  '<!-- END Google Drive Expenses Cataloger managed policy -->';

function getInstallerManagedPolicyText_(template) {
  const templateText = String(template || '').trim();
  const markers = getInstallerPolicyMarkers_(templateText);
  const content = markers.hasMarkers ? markers.managed : templateText;
  return renderInstallerPolicyParts_([
    INSTALLER_POLICY_MANAGED_BEGIN,
    content,
    INSTALLER_POLICY_MANAGED_END
  ]);
}

function getInstallerManagedPolicyContent_(text) {
  const markers = getInstallerPolicyMarkers_(text);
  return markers.hasMarkers ? markers.managed : String(text || '').trim();
}

function getInstallerPolicyMarkers_(text) {
  const policyText = String(text || '');
  const begin = policyText.indexOf(INSTALLER_POLICY_MANAGED_BEGIN);
  const end = policyText.indexOf(INSTALLER_POLICY_MANAGED_END);
  const duplicateBegin = begin >= 0 && policyText.indexOf(INSTALLER_POLICY_MANAGED_BEGIN,
    begin + INSTALLER_POLICY_MANAGED_BEGIN.length) >= 0;
  const duplicateEnd = end >= 0 && policyText.indexOf(INSTALLER_POLICY_MANAGED_END,
    end + INSTALLER_POLICY_MANAGED_END.length) >= 0;
  if (begin < 0 && end < 0) {
    return { hasMarkers: false };
  }
  if (begin < 0 || end < 0 || end < begin || duplicateBegin || duplicateEnd) {
    throw new Error('AGENTS.md has incomplete or ambiguous managed policy markers.');
  }
  return {
    hasMarkers: true,
    before: policyText.slice(0, begin).trim(),
    managed: policyText.slice(begin + INSTALLER_POLICY_MANAGED_BEGIN.length, end).trim(),
    after: policyText.slice(end + INSTALLER_POLICY_MANAGED_END.length).trim()
  };
}

function extractInstallerLegacyCustomPolicyText_(existing, template) {
  const knownBlocks = getInstallerKnownManagedPolicyBlocks_(template);
  const customSections = splitInstallerPolicySections_(existing).map(function (section) {
    const managedBlocks = knownBlocks[section.heading] || [];
    return {
      heading: section.heading,
      blocks: section.blocks.filter(function (block) {
        return managedBlocks.indexOf(normalizeInstallerPolicyBlock_(block)) < 0;
      })
    };
  }).filter(function (section) {
    return section.blocks.length > 0;
  });
  return renderInstallerPolicySections_(customSections);
}

function getInstallerKnownManagedPolicyBlocks_(template) {
  const knownBlocks = {};
  const addBlock = function (heading, block) {
    if (!knownBlocks[heading]) {
      knownBlocks[heading] = [];
    }
    const normalized = normalizeInstallerPolicyBlock_({ text: block });
    if (knownBlocks[heading].indexOf(normalized) < 0) {
      knownBlocks[heading].push(normalized);
    }
  };
  splitInstallerPolicySections_(template).forEach(function (section) {
    section.blocks.forEach(function (block) {
      addBlock(section.heading, block.text);
    });
  });
  getInstallerLegacyManagedPolicyBlocks_().forEach(function (block) {
    addBlock(block.heading, block.text);
  });
  return knownBlocks;
}

function getInstallerLegacyManagedPolicyBlocks_() {
  return [
    {
      heading: '',
      text: 'Copy this file to the root of the configured Drive folder as `AGENTS.md`.\n' +
        'The runtime reads that Drive copy for each import. Do not include credentials.'
    },
    {
      heading: '',
      text: 'Use this file as the initial `AGENTS.md` policy in the configured Drive root.\n' +
        'For an existing installation, merge new template instructions into the Drive\n' +
        'file without removing Drive-only instructions or user customizations. The\n' +
        'runtime reads that Drive copy for each import. Do not include credentials.'
    },
    {
      heading: '## Scope',
      text: '- Process only direct child folders of the configured root folder.'
    },
    {
      heading: '## Scope',
      text: '- A candidate folder is eligible only when its name, or the name of at least\n' +
        'one direct `transactions-*.json` file it contains, includes the configured\n' +
        'household keyword.'
    },
    {
      heading: '## Scope',
      text: '- Read complete Tricount JSON exports recursively inside an eligible candidate\n' +
        'folder. Treat images,\nPDFs, and other attachments only as evidence for an otherwise ambiguous\n' +
        'classification.'
    },
    {
      heading: '## Scope',
      text: '- Persist and validate the source snapshot before the first AI call. Reuse\n' +
        'completed normalized stages on retry, and remove transient stages only after\n' +
        'successful archival.'
    },
    {
      heading: '## Import',
      text: '- Keep `transfer` records in the ledger but exclude them from spending totals\n' +
        'and spending charts. Treat Tricount `Bilancio` records as opening-balance\n' +
        'controls rather than ledger rows. Exact participant allocations in the JSON\n' +
        'are the balance-control source of truth.'
    },
    {
      heading: '## Review and archive',
      text: '- Archive a successfully processed source folder only after ledger and audit\n' +
        'verification. Never delete the source folder or its attachments.'
    }
  ];
}

function renderInstallerPolicyParts_(parts) {
  return parts.map(function (part) {
    return String(part || '').trim();
  }).filter(Boolean).join('\n\n');
}

function splitInstallerPolicySections_(text) {
  const sections = [];
  let heading = '';
  let lines = [];
  const addSection = function () {
    const blocks = splitInstallerPolicyBlocks_(lines);
    if (heading || blocks.length > 0) {
      sections.push({ heading: heading, blocks: blocks });
    }
  };
  String(text || '').trim().split(/\r?\n/).forEach(function (line) {
    if (/^##\s+/.test(line)) {
      addSection();
      heading = line.trim();
      lines = [];
      return;
    }
    lines.push(line);
  });
  addSection();
  return sections;
}

function splitInstallerPolicyBlocks_(lines) {
  const blocks = [];
  let block = [];
  const addBlock = function () {
    if (block.length > 0) {
      blocks.push({ text: block.join('\n') });
      block = [];
    }
  };
  lines.forEach(function (line) {
    if (!line.trim()) {
      addBlock();
      return;
    }
    if (/^[-*+]\s+/.test(line) || /^#{1,6}\s+/.test(line)) {
      addBlock();
    }
    block.push(line.trim());
  });
  addBlock();
  return blocks;
}

function normalizeInstallerPolicyBlock_(block) {
  return block.text.replace(/\s+/g, ' ').trim();
}

function renderInstallerPolicySections_(sections) {
  return sections.map(function (section) {
    const content = section.blocks.map(function (block) { return block.text; }).join('\n\n');
    return [section.heading, content].filter(Boolean).join('\n\n');
  }).join('\n\n').trim();
}

function verifyInstallerPolicyFile_(file, expected) {
  const actual = readInstallerPolicyFile_(file).replace(/\r\n/g, '\n').trim();
  const expectedText = String(expected || '').replace(/\r\n/g, '\n').trim();
  if (actual !== expectedText) {
    throw new Error('AGENTS.md verification failed: policy content does not match ' +
      'the expected merged policy.');
  }
}

function ensureInstallerSpreadsheet_(root, spreadsheetId, title, config, timeZone) {
  const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) :
    SpreadsheetApp.create(title);
  if (!spreadsheetId) {
    DriveApp.getFileById(spreadsheet.getId()).moveTo(root);
  }
  spreadsheet.setSpreadsheetTimeZone(timeZone);
  initializeInstallerSheets_(spreadsheet, config);
  return spreadsheet;
}

function initializeInstallerSheets_(spreadsheet, config) {
  const localization = getInstallerLocalization_(config.locale);
  migrateInstallerHeadersToJson_(spreadsheet, localization);
  migrateInstallerImportAuditHeaders_(spreadsheet, localization);
  const headers = getInstallerTransactionHeaders_(localization);
  const transactions = ensureInstallerSheet_(spreadsheet, localization.sheetNames.transactions, headers);
  const imports = ensureInstallerSheet_(spreadsheet, localization.sheetNames.imports,
    getInstallerImportAuditHeaders_());
  ensureInstallerSheet_(spreadsheet, localization.sheetNames.sourceReconciliations,
    getSourceReconciliationHeaders_(localization));
  const configuration = ensureInstallerSheet_(spreadsheet, localization.sheetNames.configuration,
    ['Category', 'Subcategory']);
  ensureInstallerSheet_(spreadsheet, localization.sheetNames.balanceMovements,
    getBalanceMovementHeaders_(localization));
  ensureInstallerSheet_(spreadsheet, localization.sheetNames.monthlyBalances,
    getMonthlyBalanceHeaders_(localization));
  writeConfigurationTaxonomy_(configuration, config.categories, localization);
  ensureInitialBalanceConfigurationHeaders_(configuration, localization);
  const dashboard = ensureInstallerSheet_(spreadsheet, localization.sheetNames.dashboard, []);
  ensureInstallerSheet_(spreadsheet, localization.sheetNames.personalAnalysis, []);
  ensureInstallerSheet_(spreadsheet, localization.sheetNames.technicalData, []);
  buildDashboard_(dashboard, transactions, localization);
  refreshBalanceViews_(spreadsheet);
  applyInstallerSpreadsheetPresentation_(spreadsheet, localization);
  orderInstallerSheets_(spreadsheet, localization);
}

/** One-way display migration for the former delimited-source header labels. */
function migrateInstallerHeadersToJson_(spreadsheet, localization) {
  const transactions = spreadsheet.getSheetByName(localization.sheetNames.transactions);
  if (transactions && transactions.getLastColumn() >= 19) {
    transactions.getRange(1, 19).setValue(localization.headers.sourceFile);
  }
  const imports = spreadsheet.getSheetByName(localization.sheetNames.imports);
  if (imports && imports.getLastColumn() >= 4) {
    imports.getRange(1, 4).setValue(getInstallerImportAuditHeaders_()[3]);
  }
  const reconciliations = spreadsheet.getSheetByName(localization.sheetNames.sourceReconciliations);
  if (reconciliations && reconciliations.getLastColumn() >= 5) {
    reconciliations.getRange(1, 4, 1, 2).setValues([[
      localization.headers.sourceFile, localization.headers.sourceFileLink
    ]]);
  }
  const movements = spreadsheet.getSheetByName(localization.sheetNames.balanceMovements);
  if (movements && movements.getLastColumn() >= 11) {
    movements.getRange(1, 11).setValue(localization.headers.sourceFile);
  }
}

/** One-way schema migration which keeps historical audit rows aligned. */
function migrateInstallerImportAuditHeaders_(spreadsheet, localization) {
  const imports = spreadsheet.getSheetByName(localization.sheetNames.imports);
  if (!imports || imports.getLastColumn() < 15) {
    return;
  }
  const header = imports.getRange(1, 1, 1, imports.getLastColumn()).getDisplayValues()[0];
  if (header[13] === 'Source reconciliation status' && header[14] === 'Source reconciliations') {
    imports.insertColumnAfter(13);
    imports.getRange(1, 14).setValue('Opening balance details');
  }
}

function getInstallerImportAuditHeaders_() {
  return ['Imported at', 'Source folder', 'Source folder link', 'Source JSON files', 'Source rows',
    'Imported rows', 'Duplicate rows', 'Date start', 'Date end', 'Review rows',
    'Opening balance rows', 'Opening balance discrepancies', 'Opening balance checks',
    'Opening balance details', 'Source reconciliation status', 'Source reconciliations'];
}

function getSourceReconciliationHeaders_(localization) {
  const header = localization.headers;
  return [header.importedAt, header.sourceFolder, header.sourceFolderLink, header.sourceFile,
    header.sourceFileLink, header.sourceFileId, header.sourceContentHash, header.sourceRows,
    header.importedRows, header.duplicateRows, header.openingBalanceRows, header.unaccountedRows,
    header.sourceTotals, header.accountedTotals, header.reconciliationStatus, header.sourceDecisions];
}

function ensureImportAuditHeaders_(sheet) {
  const headers = getInstallerImportAuditHeaders_();
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(15, sheet.getLastColumn())).getDisplayValues()[0];
  if (currentHeaders[13] === 'Source reconciliation status' &&
    currentHeaders[14] === 'Source reconciliations') {
    sheet.insertColumnAfter(13);
    sheet.getRange(1, 14).setValue('Opening balance details');
  }
  const width = Math.max(headers.length, sheet.getLastColumn());
  const firstRow = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].slice(0, headers.length);
  if (firstRow.every(function (value) { return !value; })) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  const existingHeaderCount = firstRow.reduce(function (count, value, index) {
    return value ? index + 1 : count;
  }, 0);
  const existingHeaders = firstRow.slice(0, existingHeaderCount);
  if (headers.slice(0, existingHeaders.length).join('|') !== existingHeaders.join('|')) {
    throw new Error('Existing sheet has incompatible headers: ' + sheet.getName());
  }
  if (existingHeaders.length < headers.length) {
    sheet.getRange(1, existingHeaders.length + 1, 1, headers.length - existingHeaders.length)
      .setValues([headers.slice(existingHeaders.length)]);
  }
}

function getInstallerLocalization_(locale) {
  return getLocalizationRegistry_()[locale];
}

function getInstallerTransactionHeaders_(localization) {
  const header = localization.headers;
  return [header.transactionId, header.date, header.year, header.month, header.payer,
    header.beneficiaries, header.amount, header.currency, header.description,
    header.transactionType, header.category, header.subcategory, header.merchant,
    header.sourceCategory, header.confidence, header.rationale, header.fingerprint,
    header.sourceFolder, header.sourceFile, header.sourceRow, header.importedAt, header.balanceImpact,
    header.sourceTransactionId, header.sourceNativeType, header.sourceStatus, header.sourceCustomCategory,
    header.allocationDetails, header.exchangeRate, header.sourceCreatedAt, header.sourceUpdatedAt];
}

function getBalanceMovementHeaders_(localization) {
  const header = localization.headers;
  return [header.transactionId, header.date, header.year, header.month, header.currency,
    header.participant, header.balanceChange, header.runningBalance, header.transactionType,
    header.description, header.sourceFile, header.sourceRow];
}

function getMonthlyBalanceHeaders_(localization) {
  const header = localization.headers;
  return [header.year, header.month, header.currency, header.participant, header.monthlyClosingBalance,
    header.declaredOpeningBalance, header.balanceDifference, header.balanceVerification];
}

function ensureInstallerSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (headers.length === 0) {
    return sheet;
  }
  const firstRow = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn()))
    .getDisplayValues()[0].slice(0, headers.length);
  if (firstRow.every(function (value) { return !value; })) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  const existingHeaderCount = firstRow.reduce(function (count, value, index) {
    return value ? index + 1 : count;
  }, 0);
  const existingHeaders = firstRow.slice(0, existingHeaderCount);
  if (headers.slice(0, existingHeaders.length).join('|') !== existingHeaders.join('|')) {
    throw new Error('Existing sheet has incompatible headers: ' + name);
  }
  if (existingHeaders.length < headers.length) {
    sheet.getRange(1, existingHeaders.length + 1, 1, headers.length - existingHeaders.length)
      .setValues([headers.slice(existingHeaders.length)]);
  }
  return sheet;
}

function writeConfigurationTaxonomy_(sheet, categories, localization) {
  const values = Object.keys(categories).flatMap(function (category) {
    return categories[category].map(function (subcategory) { return [category, subcategory]; });
  });
  const balanceHeaders = getInitialBalanceConfigurationHeaders_(localization);
  const balanceLayout = getInitialBalanceConfigurationLayout_(sheet, balanceHeaders);
  const balanceRowCount = balanceLayout ? getInitialBalanceConfigurationDataRowCount_(sheet, balanceLayout) : 0;
  const balanceRows = balanceRowCount ? sheet.getRange(balanceLayout.dataRow, balanceLayout.startColumn,
    balanceRowCount, balanceHeaders.length).getValues() : [];
  if (balanceLayout) {
    sheet.getRange(balanceLayout.headerRow, balanceLayout.startColumn,
      Math.max(1, sheet.getMaxRows() - balanceLayout.headerRow + 1), balanceHeaders.length)
      .clearContent().clearDataValidations().clearFormat();
  }
  sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), 2).clearContent();
  if (values.length > 0) {
    sheet.getRange(2, 1, values.length, 2).setValues(values);
  }
  if (balanceLayout) {
    const headerRow = values.length + 4;
    sheet.getRange(headerRow, 1, 1, balanceHeaders.length).setValues([balanceHeaders]);
    if (balanceRows.length > 0) {
      sheet.getRange(headerRow + 1, 1, balanceRows.length, balanceHeaders.length).setValues(balanceRows);
    }
  }
  applyConfigurationTableBorder_(sheet, 1, 1, values.length + 1, 2);
}

function buildDashboard_(dashboard, transactions, localization) {
  const labels = localization.dashboard;
  const transactionsName = transactions.getName().replace(/'/g, "''");
  const years = getDashboardAvailableYears_(transactions);
  assertDashboardYearControlCapacity_(years);
  const technicalData = ensureInstallerSheet_(dashboard.getParent(), localization.sheetNames.technicalData, []);
  if (dashboard.getMaxColumns() < 24) {
    dashboard.insertColumnsAfter(dashboard.getMaxColumns(), 24 - dashboard.getMaxColumns());
  }
  if (dashboard.getMaxRows() < DASHBOARD_CONTROL_LAST_ROW) {
    dashboard.insertRowsAfter(dashboard.getMaxRows(), DASHBOARD_CONTROL_LAST_ROW - dashboard.getMaxRows());
  }
  const selectionState = getDashboardSelectionState_(dashboard);
  const chartLayouts = captureDashboardChartLayouts_(dashboard, labels);
  writeDashboardTechnicalData_(technicalData, transactionsName, dashboard.getName(), localization);
  dashboard.clear();
  dashboard.getRange('A1:X' + DASHBOARD_CONTROL_LAST_ROW).breakApart();
  dashboard.getRange('Q3:X' + DASHBOARD_CONTROL_LAST_ROW).removeCheckboxes();
  dashboard.getRange('Q3:X' + DASHBOARD_CONTROL_LAST_ROW).clearDataValidations();
  dashboard.getCharts().forEach(function (chart) { dashboard.removeChart(chart); });
  dashboard.getRange('A1:X1').merge().setValue(labels.title);
  dashboard.getRange('A2:X2').merge().setValue(labels.subtitle);
  writeDashboardKpiCard_(dashboard, 'A4:D4', 'A5:D7', labels.totalSpend,
    getDashboardSpendingSumFormula_(transactionsName), true, 'cumulative');
  writeDashboardKpiCard_(dashboard, 'E4:H4', 'E5:H7', labels.expenseCount,
    getDashboardSpendingCountFormula_(transactionsName), false, 'cumulative');
  writeDashboardKpiCard_(dashboard, 'I4:L4', 'I5:L7', labels.currentYearSpend,
    getDashboardCurrentYearSpendFormula_(transactionsName), true, 'currentYear');
  writeDashboardKpiCard_(dashboard, 'M4:P4', 'M5:P7', labels.currentYearCount,
    getDashboardCurrentYearCountFormula_(transactionsName), false, 'currentYear');
  writeDashboardKpiCard_(dashboard, 'Q4:T4', 'Q5:T7', labels.latestMonth,
    getDashboardLatestMonthLabelFormula_(transactionsName, labels.monthNames), false, 'monthly');
  writeDashboardKpiCard_(dashboard, 'U4:X4', 'U5:X7', labels.latestMonthSpend,
    getDashboardLatestMonthSpendFormula_(transactionsName), true, 'monthly');
  writeDashboardYearControls_(dashboard, years, selectionState, labels);
  const yearColors = getDashboardSelectedYearChartColors_(dashboard, labels);
  // Charts capture their source range at creation time. Wait until every
  // dynamic pivot has settled, otherwise a late-arriving payer or category is
  // permanently omitted from the newly-created chart.
  waitForDashboardChartSources_(technicalData);
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 1, 25,
    DASHBOARD_BOUNDED_CHART_COLUMN_COUNT),
    getDashboardChartLayout_(chartLayouts, 'annualSpend'), labels.annualSpend, 'column', false, {
      focusTarget: 'datum', hAxis: { slantedText: false }
    });
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 30, 55,
    DASHBOARD_COMPARISON_CHART_COLUMN_COUNT),
    getDashboardChartLayout_(chartLayouts, 'monthlyComparison'), labels.monthlyComparison, 'line', false, {
      hAxis: { showTextEvery: 1 }, colors: yearColors
    });
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 60, 85,
    DASHBOARD_BOUNDED_CHART_COLUMN_COUNT),
    getDashboardChartLayout_(chartLayouts, 'monthlySpend'), labels.monthlySpend, 'column', false, {
      hAxis: { showTextEvery: 1 }
    });
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 90, 115,
    DASHBOARD_COMPARISON_CHART_COLUMN_COUNT),
    getDashboardChartLayout_(chartLayouts, 'payerSpend'), labels.payerSpend, 'column', false, {
      colors: yearColors
    });
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 120, 145,
    DASHBOARD_TOP_MERCHANT_CHART_COLUMN_COUNT),
    getDashboardChartLayout_(chartLayouts, 'topMerchants'), labels.topMerchants, 'bar', false, {
      colors: ['#20B486'], legend: { position: 'none' }, bar: { groupWidth: '85%' }
    });
  applyDashboardTopMerchantPointColors_(dashboard, labels.topMerchants,
    technicalData.getRange('A121:A140').getDisplayValues().filter(function (row) { return row[0]; }).length);
  if (dashboard.getMaxColumns() > 24) {
    dashboard.deleteColumns(25, dashboard.getMaxColumns() - 24);
  }
  dashboard.setFrozenRows(1);
}

function writeDashboardTechnicalData_(technicalData, transactionsName, dashboardName, localization) {
  const currentColumnCount = technicalData.getMaxColumns();
  if (currentColumnCount < DASHBOARD_COMPARISON_CHART_COLUMN_COUNT) {
    technicalData.insertColumnsAfter(currentColumnCount,
      DASHBOARD_COMPARISON_CHART_COLUMN_COUNT - currentColumnCount);
  }
  technicalData.getRange(1, 1, 145, DASHBOARD_COMPARISON_CHART_COLUMN_COUNT).clearContent();
  technicalData.getRange('A200:B220').clearContent();
  getDashboardDataSpecifications_(transactionsName, dashboardName, localization)
    .forEach(function (specification) {
    technicalData.getRange(specification.anchor).setFormula(specification.formula);
    technicalData.getRange(specification.anchor).setFontWeight('bold');
  });
  technicalData.hideColumns(DASHBOARD_BOUNDED_CHART_COLUMN_COUNT + 1,
    DASHBOARD_COMPARISON_CHART_COLUMN_COUNT - DASHBOARD_BOUNDED_CHART_COLUMN_COUNT);
  technicalData.setFrozenRows(1);
}

function getDashboardSelectionState_(dashboard) {
  const extractSelectedYears = function (rows) {
    return rows.reduce(function (years, row) {
      const year = Number(row[0]);
      if (year && row[1] === true) {
        years.push(year);
      }
      return years;
    }, []);
  };
  const maxColumns = dashboard.getMaxColumns ? dashboard.getMaxColumns() : 27;
  const currentLayout = 'V' + DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW + ':X' +
    DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW;
  const layouts = [dashboard.getRange(currentLayout).getValues()];
  if (maxColumns >= 25) {
    layouts.push(dashboard.getRange('W11:Y100').getValues());
    layouts.push(dashboard.getRange('W51:Y100').getValues());
  }
  layouts.push(dashboard.getRange('Q51:S100').getValues());
  layouts.push(dashboard.getRange('Q3:S100').getValues());
  const currentRows = layouts.find(function (rows) {
    return rows.some(function (row) { return Number(row[0]); });
  }) || [];
  const selectedYears = extractSelectedYears(currentRows);
  const detailYear = Number(dashboard.getRange('X' + DASHBOARD_DETAIL_YEAR_VALUE_ROW).getValue()) ||
    Number(dashboard.getRange('X48').getValue()) || Number(dashboard.getRange('X50').getValue()) ||
    (maxColumns >= 27 ? Number(dashboard.getRange('AA50').getValue()) : 0) ||
    Number(dashboard.getRange('V30').getValue()) ||
    Number(dashboard.getRange('V2').getValue()) || Number(dashboard.getRange('V3').getValue());
  const merchantSort = String(dashboard.getRange('X' + DASHBOARD_MERCHANT_SORT_VALUE_ROW).getValue() ||
    dashboard.getRange('X51').getValue() || '');
  const yearColors = currentRows.reduce(function (colors, row) {
    const year = Number(row[0]);
    if (year && row[2]) {
      colors[year] = String(row[2]);
    }
    return colors;
  }, {});
  return {
    selectedYears: selectedYears,
    detailYear: detailYear,
    yearColors: yearColors,
    merchantSort: merchantSort
  };
}

function getDashboardAvailableYears_(transactions) {
  const dataRows = Math.max(0, transactions.getLastRow() - 1);
  if (!dataRows) {
    return [new Date().getFullYear()];
  }
  const years = transactions.getRange(2, 3, dataRows, 1).getValues().reduce(function (result, row) {
    const year = Number(row[0]);
    if (year && result.indexOf(year) < 0) {
      result.push(year);
    }
    return result;
  }, []);
  return years.sort(function (left, right) { return left - right; });
}

function assertDashboardYearControlCapacity_(years) {
  if (years.length > DASHBOARD_COMPARISON_YEAR_CONTROL_ROW_COUNT) {
    throw new Error('Dashboard supports at most ' + DASHBOARD_COMPARISON_YEAR_CONTROL_ROW_COUNT +
      ' distinct years; found ' + years.length + '.');
  }
}

function writeDashboardYearControls_(dashboard, years, selectionState, labels) {
  assertDashboardYearControlCapacity_(years);
  const selectedYears = selectionState.selectedYears.length ? selectionState.selectedYears : years;
  const detailYear = years.indexOf(selectionState.detailYear) >= 0 ? selectionState.detailYear : years[years.length - 1];
  const merchantSortOptions = [
    labels.merchantSortBySpend || 'By spending',
    labels.merchantSortAlphabetically || 'Alphabetical'
  ];
  const merchantSort = merchantSortOptions.indexOf(selectionState.merchantSort) >= 0 ?
    selectionState.merchantSort : merchantSortOptions[0];
  const colorOptions = getDashboardYearColorOptions_(labels);
  const colorNames = colorOptions.map(function (option) { return option.name; });
  const colorByName = colorOptions.reduce(function (result, option) {
    result[option.name] = option.hex;
    return result;
  }, {});
  dashboard.getRange('V9:X9').merge().setValue(labels.comparisonYears);
  dashboard.getRange('V' + DASHBOARD_DETAIL_YEAR_HEADER_ROW + ':X' + DASHBOARD_DETAIL_YEAR_HEADER_ROW)
    .merge().setValue(labels.detailYear);
  dashboard.getRange('V' + DASHBOARD_MERCHANT_SORT_HEADER_ROW + ':X' + DASHBOARD_MERCHANT_SORT_HEADER_ROW)
    .merge().setValue(labels.merchantSort || 'Sort merchants');
  dashboard.getRange('V10:X10').setValues([[labels.year, labels.includeYear, labels.color || 'Color']]);
  dashboard.getRange('V' + DASHBOARD_DETAIL_YEAR_VALUE_ROW + ':W' + DASHBOARD_DETAIL_YEAR_VALUE_ROW)
    .merge().setValue(labels.selectedYear);
  dashboard.getRange('X' + DASHBOARD_DETAIL_YEAR_VALUE_ROW).setValue(detailYear);
  dashboard.getRange('V' + DASHBOARD_MERCHANT_SORT_VALUE_ROW + ':W' + DASHBOARD_MERCHANT_SORT_VALUE_ROW)
    .merge().setValue(labels.merchantSortBy || 'Sort by');
  dashboard.getRange('X' + DASHBOARD_MERCHANT_SORT_VALUE_ROW).setValue(merchantSort);
  dashboard.getRange('X' + DASHBOARD_DETAIL_YEAR_VALUE_ROW).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(years.map(String), true).setAllowInvalid(false).build());
  dashboard.getRange('X' + DASHBOARD_MERCHANT_SORT_VALUE_ROW).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(merchantSortOptions, true).setAllowInvalid(false).build());
  const yearRows = years.map(function (year, index) {
    const colorName = selectionState.yearColors && selectionState.yearColors[year];
    return [year, selectedYears.indexOf(year) >= 0, colorByName[colorName] ? colorName : colorNames[index % colorNames.length]];
  });
  const values = dashboard.getRange(DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW, 22, yearRows.length, 3);
  const colorCells = dashboard.getRange(DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW, 24, yearRows.length, 1);
  dashboard.getRange(DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW, 23, yearRows.length, 1).insertCheckboxes();
  values.setValues(yearRows);
  colorCells.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(colorNames, true).setAllowInvalid(false).build());
  colorCells.setBackgrounds(yearRows.map(function (row) { return [colorByName[row[2]]]; }))
    .setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('V9:X9').setBackground('#1A1B1F').setFontColor('#FFFFFF')
    .setFontFamily('Montserrat').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('V' + DASHBOARD_DETAIL_YEAR_HEADER_ROW + ':X' + DASHBOARD_DETAIL_YEAR_HEADER_ROW)
    .setBackground('#1A1B1F').setFontColor('#FFFFFF')
    .setFontFamily('Montserrat').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('V' + DASHBOARD_MERCHANT_SORT_HEADER_ROW + ':X' + DASHBOARD_MERCHANT_SORT_HEADER_ROW)
    .setBackground('#1A1B1F').setFontColor('#FFFFFF')
    .setFontFamily('Montserrat').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('V10:X10').setBackground('#EAF7F2').setFontColor('#1A1B1F')
    .setFontFamily('Montserrat').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('V' + DASHBOARD_DETAIL_YEAR_VALUE_ROW + ':W' + DASHBOARD_DETAIL_YEAR_VALUE_ROW)
    .setBackground('#EAF7F2').setFontColor('#1A1B1F')
    .setFontFamily('Montserrat').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('V' + DASHBOARD_MERCHANT_SORT_VALUE_ROW + ':W' + DASHBOARD_MERCHANT_SORT_VALUE_ROW)
    .setBackground('#EAF7F2').setFontColor('#1A1B1F')
    .setFontFamily('Montserrat').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange(DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW, 22, Math.max(1, yearRows.length), 3)
    .setFontFamily('Montserrat')
    .setFontSize(10).setHorizontalAlignment('center');
  dashboard.getRange('X' + DASHBOARD_DETAIL_YEAR_VALUE_ROW).setBackground('#EAF7F2')
    .setFontColor('#1A1B1F').setFontFamily('Montserrat')
    .setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('X' + DASHBOARD_MERCHANT_SORT_VALUE_ROW).setBackground('#EAF7F2')
    .setFontColor('#1A1B1F').setFontFamily('Montserrat')
    .setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');
}

const DASHBOARD_YEAR_COLOR_PALETTE = Object.freeze([
  { key: 'green', hex: '#20B486' }, { key: 'blue', hex: '#4F7CAC' },
  { key: 'orange', hex: '#F59E0B' }, { key: 'purple', hex: '#A855F7' },
  { key: 'pink', hex: '#EF476F' }, { key: 'teal', hex: '#06B6D4' },
  { key: 'red', hex: '#F97316' }, { key: 'lime', hex: '#84CC16' }
]);

const DASHBOARD_TOP_MERCHANT_COLORS = [
  '#20B486', '#4F7CAC', '#F59E0B', '#A855F7', '#EF476F', '#06B6D4',
  '#F97316', '#84CC16', '#6366F1', '#EC4899', '#14B8A6', '#7DD3FC',
  '#A5B4FC', '#FCA5A5', '#FDE68A', '#A7F3D0', '#FED7AA', '#BDE5E8',
  '#E5EDF7', '#FDE8E7'
];

function applyDashboardTopMerchantPointColors_(dashboard, title, merchantCount) {
  if (merchantCount < 1) {
    return { status: 'SKIPPED', reason: 'NO_MERCHANTS' };
  }
  try {
    applyDashboardTopMerchantPointColorsUnsafe_(dashboard, title, merchantCount);
    return { status: 'APPLIED', merchantCount: merchantCount };
  } catch (error) {
    return { status: 'SKIPPED', reason: String(error && error.message ? error.message : error) };
  }
}

function applyDashboardTopMerchantPointColorsUnsafe_(dashboard, title, merchantCount) {
  SpreadsheetApp.flush();
  const token = ScriptApp.getOAuthToken();
  const endpoint = 'https://sheets.googleapis.com/v4/spreadsheets/' + dashboard.getParent().getId();
  const response = UrlFetchApp.fetch(endpoint + '?fields=sheets(properties(sheetId,title),charts(chartId,spec))', {
    method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token }
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Could not read the Top 20 chart specification.');
  }
  const sheet = (JSON.parse(response.getContentText()).sheets || []).find(function (candidate) {
    return candidate.properties && candidate.properties.sheetId === dashboard.getSheetId();
  });
  const chart = sheet && (sheet.charts || []).find(function (candidate) {
    return candidate.spec && candidate.spec.title === title && candidate.spec.basicChart;
  });
  if (!chart || !chart.spec.basicChart.series || chart.spec.basicChart.series.length !== 1) {
    throw new Error('Could not find the Top 20 chart to colour.');
  }
  chart.spec.basicChart.series[0].styleOverrides = DASHBOARD_TOP_MERCHANT_COLORS
    .slice(0, merchantCount).map(function (hex, index) {
      return { index: index, colorStyle: { rgbColor: getSheetsRgbColor_(hex) } };
    });
  const update = UrlFetchApp.fetch(endpoint + ':batchUpdate', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ requests: [{ updateChartSpec: { chartId: chart.chartId, spec: chart.spec } }] })
  });
  if (update.getResponseCode() !== 200) {
    throw new Error('Could not apply the Top 20 chart colours.');
  }
}

function getSheetsRgbColor_(hex) {
  const value = String(hex).replace('#', '');
  return {
    red: parseInt(value.slice(0, 2), 16) / 255,
    green: parseInt(value.slice(2, 4), 16) / 255,
    blue: parseInt(value.slice(4, 6), 16) / 255
  };
}

function getDashboardYearColorOptions_(labels) {
  const names = labels && labels.yearColors ? labels.yearColors : {};
  return DASHBOARD_YEAR_COLOR_PALETTE.map(function (color) {
    return { name: names[color.key] || color.key, hex: color.hex };
  });
}

function getDashboardSelectedYearChartColors_(dashboard, labels) {
  const options = getDashboardYearColorOptions_(labels);
  const colorByName = options.reduce(function (result, option) {
    result[option.name] = option.hex;
    return result;
  }, {});
  return dashboard.getRange('V' + DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW + ':X' +
    DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW).getValues().reduce(function (colors, row) {
    if (Number(row[0]) && row[1] === true) {
      colors.push(colorByName[String(row[2])] || options[colors.length % options.length].hex);
    }
    return colors;
  }, []);
}

function refreshDashboardYearChartColors() {
  return withAutomationTriggerLock_(function () {
    assertCatalogConfiguration_();
    const spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
    const localization = getLocalization_();
    return applyDashboardYearChartColors_(
      spreadsheet.getSheetByName(localization.sheetNames.dashboard), localization.dashboard
    );
  });
}

function applyDashboardYearColorsOnEdit(event) {
  if (!event || !event.range) {
    return { status: 'IGNORED' };
  }
  const range = event.range;
  const sheet = range.getSheet();
  const localization = getLocalization_();
  const lastRow = range.getRow() + range.getNumRows() - 1;
  const lastColumn = range.getColumn() + range.getNumColumns() - 1;
  const intersectsYearControls = sheet.getName() === localization.sheetNames.dashboard &&
    range.getRow() <= DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW &&
    lastRow >= DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW &&
    range.getColumn() <= 24 && lastColumn >= 23;
  const firstManagedRow = Math.max(DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW, range.getRow());
  const lastManagedRow = Math.min(DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW, lastRow);
  const isYearControlEdit = intersectsYearControls && sheet
    .getRange(firstManagedRow, 22, lastManagedRow - firstManagedRow + 1, 1)
    .getValues().some(function (row) { return Number(row[0]); });
  if (!isYearControlEdit) {
    return { status: 'IGNORED' };
  }
  return withAutomationTriggerLock_(function () {
    return applyDashboardYearChartColors_(sheet, localization.dashboard);
  });
}

function applyDashboardYearChartColors_(dashboard, labels) {
  const colorOptions = getDashboardYearColorOptions_(labels);
  const colorByName = colorOptions.reduce(function (result, option) {
    result[option.name] = option.hex;
    return result;
  }, {});
  const colorCells = dashboard.getRange('X' + DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW + ':X' +
    DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW);
  colorCells.setBackgrounds(colorCells.getValues().map(function (row) {
    return [colorByName[String(row[0])] || '#FFFFFF'];
  }));
  const colors = getDashboardSelectedYearChartColors_(dashboard, labels);
  const configuredTitles = [labels.monthlyComparison, labels.payerSpend];
  let updatedCharts = 0;
  dashboard.getCharts().forEach(function (chart) {
    if (configuredTitles.indexOf(chart.getOptions().get('title')) >= 0) {
      dashboard.updateChart(chart.modify().setOption('colors', colors).build());
      updatedCharts += 1;
    }
  });
  return { status: 'UPDATED', updatedCharts: updatedCharts, colors: colors };
}

function getDashboardDataSpecifications_(transactionsName, dashboardName, localization) {
  const ledger = "'" + transactionsName + "'!A:AD";
  const dashboard = "'" + String(dashboardName || 'Dashboard').replace(/'/g, "''") + "'!";
  const dashboardLabels = localization && localization.dashboard ? localization.dashboard : {};
  const monthNames = Array.isArray(dashboardLabels.monthNames) ? dashboardLabels.monthNames :
    ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
  const comparisonYearRange = '$V$' + DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW + ':$V$' +
    DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW;
  const comparisonYearCheckboxRange = '$W$' + DASHBOARD_COMPARISON_YEAR_CONTROL_START_ROW + ':$W$' +
    DASHBOARD_COMPARISON_YEAR_CONTROL_END_ROW;
  const detailYearCell = '$X$' + DASHBOARD_DETAIL_YEAR_VALUE_ROW;
  const merchantSortCell = '$X$' + DASHBOARD_MERCHANT_SORT_VALUE_ROW;
  const selectedYears = 'IFERROR(TEXTJOIN(" or ",TRUE,FILTER("C = "&' + dashboard +
    comparisonYearRange + ',' + dashboard + comparisonYearCheckboxRange + '=TRUE)),"C = -1")';
  const selectedYearValues = 'FILTER(' + dashboard + comparisonYearRange + ',' + dashboard +
    comparisonYearCheckboxRange + '=TRUE)';
  const withoutPivotHeaders = function (query) {
    return 'FILTER(' + query + ',SEQUENCE(ROWS(' + query + '))>1)';
  };
  const monthChoices = monthNames.map(function (name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }).join(',');
  const monthName = function (monthIndex) {
    return 'ARRAYFORMULA(CHOOSE(' + monthIndex + ',' + monthChoices + '))';
  };
  const categoryLabels = localization && localization.categoryLabels ? localization.categoryLabels : {};
  const categorySwitch = Object.keys(categoryLabels).reduce(function (parts, category) {
    parts.push('"' + String(category).replace(/"/g, '""') + '"');
    parts.push('"' + String(categoryLabels[category]).replace(/"/g, '""') + '"');
    return parts;
  }, []).join(',');
  const localizedHeaders = function (summary) {
    return categorySwitch ? 'MAP(INDEX(' + summary + ',1,),LAMBDA(header,SWITCH(TRIM(header),' +
      categorySwitch + ',TRIM(header))))' : 'ARRAYFORMULA(TRIM(INDEX(' + summary + ',1,)))';
  };
  const monthLabels = function (query) {
    return '=IFERROR(LET(summary,' + query + ',data,FILTER(summary,SEQUENCE(ROWS(summary))>1),labels,' +
      monthName('INDEX(data,,1)') + ',values,CHOOSECOLS(data,SEQUENCE(1,COLUMNS(data)-1,2,1)),totals,' +
      'BYROW(values,LAMBDA(row,TEXT(SUM(row),"#,##0.00")&" EUR")),VSTACK(' +
      localizedHeaders('summary') + ',HSTACK(MAP(labels,totals,LAMBDA(label,total,label&" · "&total)),' +
      'values))),"")';
  };
  const annualSummary = 'QUERY(' + ledger +
    ",\"select C,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and (\"&" + selectedYears +
    "&\") group by C pivot K label sum(G) ''\",1)";
  const annualCategoryValues = 'CHOOSECOLS(data,SEQUENCE(1,COLUMNS(data)-1,2,1))';
  const annualChartRows = 'LET(years,INDEX(data,,1),values,' + annualCategoryValues +
    ',totals,BYROW(values,LAMBDA(row,TEXT(SUM(row),"#,##0.00")&" EUR")),' +
    'HSTACK(MAP(years,totals,LAMBDA(year,total,year&" · "&total)),values))';
  const transactionYear = "'" + transactionsName + "'!C:C";
  const transactionMonth = "'" + transactionsName + "'!D:D";
  const transactionAmount = "'" + transactionsName + "'!G:G";
  const transactionCurrency = "'" + transactionsName + "'!H:H";
  const transactionType = "'" + transactionsName + "'!J:J";
  const merchantHeader = localization && localization.headers && localization.headers.merchant ?
    localization.headers.merchant : 'Merchant / supplier';
  const amountHeader = localization && localization.headers && localization.headers.amount ?
    localization.headers.amount : 'Amount';
  const alphabeticalMerchantSort = String(dashboardLabels.merchantSortAlphabetically || 'Alphabetical')
    .replace(/"/g, '""');
  const merchantOrderBy = 'IF(' + dashboard + merchantSortCell + '="' + alphabeticalMerchantSort +
    '","order by M asc","order by sum(G) desc")';
  const monthlyComparison = '=IFERROR(LET(years,' + selectedYearValues +
    ',monthIndexes,SEQUENCE(12),HSTACK(VSTACK("' +
    (localization && localization.headers && localization.headers.month ? localization.headers.month : 'Month') + '\",' + monthName('monthIndexes') + '),' +
    'VSTACK(TRANSPOSE(years),MAKEARRAY(12,ROWS(years),LAMBDA(monthIndex,yearIndex,SUM(' +
    'SUMIFS(' + transactionAmount + ',' + transactionYear + ',INDEX(years,yearIndex),' +
    transactionMonth + ',monthIndex,' + transactionType + ',"expense",' + transactionCurrency + ',"EUR"),' +
    'SUMIFS(' + transactionAmount + ',' + transactionYear + ',INDEX(years,yearIndex),' +
    transactionMonth + ',monthIndex,' + transactionType + ',"income",' + transactionCurrency + ',"EUR"))))),"")))';
  return [
    { anchor: 'A1', formula: '=IFERROR(LET(summary,' + annualSummary +
      ',data,FILTER(summary,SEQUENCE(ROWS(summary))>1),VSTACK(' + localizedHeaders('summary') + ',' +
      annualChartRows + ')),"")' },
    { anchor: 'A30', formula: monthlyComparison },
    { anchor: 'A60', formula: monthLabels('QUERY(' + ledger +
      ",\"select D,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and C = \"&" + dashboard +
        detailYearCell + '&" group by D pivot K order by D label sum(G) \'\'",1)') },
    { anchor: 'A90', formula: '=QUERY(' + ledger +
      ",\"select E,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and (\"&" + selectedYears +
      "&\") group by E pivot C order by E label sum(G) ''\",1)" },
    { anchor: 'A120', formula: '=IFERROR(LET(summary,QUERY(' + ledger +
      ",\"select M,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and C = \"&" + dashboard +
        detailYearCell + '&" and M is not null and M <> \'Unknown\' and M <> \'N/A\' group by M "&' + merchantOrderBy +
        '&" limit 20 label sum(G) \'\'",0),VSTACK({"' +
        String(merchantHeader).replace(/"/g, '""') + '","' + String(amountHeader).replace(/"/g, '""') +
        '"},HSTACK(INDEX(summary,,1),INDEX(summary,,2)))),"")' }
  ];
}

function waitForDashboardChartSources_(technicalData) {
  const sources = [
    { row: 1, columnCount: DASHBOARD_BOUNDED_CHART_COLUMN_COUNT },
    { row: 30, columnCount: DASHBOARD_COMPARISON_CHART_COLUMN_COUNT },
    { row: 60, columnCount: DASHBOARD_BOUNDED_CHART_COLUMN_COUNT },
    { row: 90, columnCount: DASHBOARD_COMPARISON_CHART_COLUMN_COUNT },
    { row: 120, columnCount: DASHBOARD_TOP_MERCHANT_CHART_COLUMN_COUNT }
  ];
  let previousWidths = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    SpreadsheetApp.flush();
    const widths = sources.map(function (source) {
      const values = technicalData.getRange(source.row, 1, 1, source.columnCount).getDisplayValues()[0];
      return values.reduce(function (width, value, index) {
        return value !== '' ? index + 1 : width;
      }, 0);
    });
    const ready = widths.every(function (width) { return width >= 2; });
    const stable = previousWidths && widths.every(function (width, index) {
      return width === previousWidths[index];
    });
    if (ready && stable) {
      return;
    }
    previousWidths = widths;
    Utilities.sleep(500);
  }
}

function getDashboardChartSourceRange_(sheet, startRow, endRow, columnCount) {
  // Charts retain the supplied range, while the formulas inside it expand and
  // contract as dashboard controls change. Keep the full source block so a
  // newly selected year cannot fall outside a chart created with fewer rows.
  return sheet.getRange(startRow, 1, endRow - startRow + 1, columnCount);
}

function getDashboardLatestMonthSpendFormula_(transactionsName) {
  const date = "'" + transactionsName + "'!B2:B";
  const type = "'" + transactionsName + "'!J2:J";
  const currency = "'" + transactionsName + "'!H2:H";
  const amount = "'" + transactionsName + "'!G2:G";
  const spendingType = getDashboardSpendingTypeFilter_(type);
  const latestDate = 'MAX(FILTER(' + date + ',' + spendingType + ',' + currency + '="EUR"))';
  return '=IFERROR(SUM(FILTER(' + amount + ',' + spendingType + ',' + currency +
    '="EUR",YEAR(' + date + ')=YEAR(' + latestDate + '),MONTH(' + date + ')=MONTH(' + latestDate + '))),0)';
}

function getDashboardSpendingSumFormula_(transactionsName) {
  const amount = "'" + transactionsName + "'!G:G";
  const type = "'" + transactionsName + "'!J:J";
  const currency = "'" + transactionsName + "'!H:H";
  return '=SUM(SUMIFS(' + amount + ',' + type + ',"expense",' + currency + ',"EUR"),' +
    'SUMIFS(' + amount + ',' + type + ',"income",' + currency + ',"EUR"))';
}

function getDashboardSpendingCountFormula_(transactionsName) {
  const type = "'" + transactionsName + "'!J:J";
  const currency = "'" + transactionsName + "'!H:H";
  return '=SUM(COUNTIFS(' + type + ',"expense",' + currency + ',"EUR"),' +
    'COUNTIFS(' + type + ',"income",' + currency + ',"EUR"))';
}

function getDashboardCurrentYearSpendFormula_(transactionsName) {
  const amount = "'" + transactionsName + "'!G:G";
  const year = "'" + transactionsName + "'!C:C";
  const type = "'" + transactionsName + "'!J:J";
  const currency = "'" + transactionsName + "'!H:H";
  return '=SUM(SUMIFS(' + amount + ',' + type + ',"expense",' + currency + ',"EUR",' +
    year + ',YEAR(TODAY())),SUMIFS(' + amount + ',' + type + ',"income",' + currency +
    ',"EUR",' + year + ',YEAR(TODAY())))';
}

function getDashboardCurrentYearCountFormula_(transactionsName) {
  const year = "'" + transactionsName + "'!C:C";
  const type = "'" + transactionsName + "'!J:J";
  const currency = "'" + transactionsName + "'!H:H";
  return '=SUM(COUNTIFS(' + type + ',"expense",' + currency + ',"EUR",' + year +
    ',YEAR(TODAY())),COUNTIFS(' + type + ',"income",' + currency + ',"EUR",' + year +
    ',YEAR(TODAY())))';
}

function getDashboardSpendingTypeFilter_(typeRange) {
  return 'REGEXMATCH(' + typeRange + ',"^(expense|income)$")';
}

function getDashboardLatestMonthLabelFormula_(transactionsName, monthNames) {
  const names = Array.isArray(monthNames) && monthNames.length === 12 ? monthNames : [
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'
  ];
  const date = "'" + transactionsName + "'!B2:B";
  const type = "'" + transactionsName + "'!J2:J";
  const currency = "'" + transactionsName + "'!H2:H";
  const localizedMonths = names.map(function (name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }).join(',');
  return '=IFERROR(LET(latestDate,MAX(FILTER(' + date + ',' + getDashboardSpendingTypeFilter_(type) + ',' +
    currency + '="EUR")),CHOOSE(MONTH(latestDate),' + localizedMonths + ')&" "&YEAR(latestDate)),"-")';
}

function writeDashboardKpiCard_(dashboard, labelRange, valueRange, label, formula, currency, emphasis) {
  const palettes = {
    cumulative: { label: '#1E3A5F', value: '#E8F1FA' },
    currentYear: { label: '#5B3A8C', value: '#F3E8FF' },
    monthly: { label: '#1A1B1F', value: '#EAF7F2' }
  };
  const palette = palettes[emphasis] || palettes.monthly;
  dashboard.getRange(labelRange).merge().setValue(label);
  dashboard.getRange(valueRange).merge().setFormula(formula);
  const labelCell = dashboard.getRange(labelRange);
  const valueCell = dashboard.getRange(valueRange);
  labelCell.setBackground(palette.label).setFontColor('#FFFFFF').setFontFamily('Montserrat')
    .setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');
  valueCell.setBackground(palette.value).setFontColor('#1A1B1F').setFontFamily('Montserrat')
    .setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  if (currency) {
    valueCell.setNumberFormat('#,##0.00 [$EUR]');
  } else {
    valueCell.setNumberFormat('#,##0');
  }
}

// These values reproduce the dashboard layout approved for a new spreadsheet.
// Existing dashboards always retain the user-adjusted geometry captured before a refresh.
const DASHBOARD_CHART_LAYOUT_DEFAULTS = {
  annualSpend: { row: 28, column: 1, offsetX: 0, offsetY: 1, width: 1489, height: 371 },
  topMerchants: { row: 47, column: 1, offsetX: 0, offsetY: 2, width: 473, height: 371 },
  payerSpend: { row: 28, column: 17, offsetX: 21, offsetY: 1, width: 684, height: 371 },
  monthlySpend: { row: 47, column: 6, offsetX: 27, offsetY: 2, width: 1423, height: 371 },
  monthlyComparison: { row: 8, column: 1, offsetX: 0, offsetY: 19, width: 1925, height: 371 }
};

function captureDashboardChartLayouts_(dashboard, labels) {
  const titleToKey = {};
  ['annualSpend', 'monthlyComparison', 'monthlySpend', 'payerSpend', 'topMerchants']
    .forEach(function (key) { titleToKey[labels[key]] = key; });
  return dashboard.getCharts().reduce(function (layouts, chart) {
    const key = titleToKey[chart.getOptions().get('title')];
    if (!key) {
      return layouts;
    }
    const container = chart.getContainerInfo();
    const options = chart.getOptions();
    layouts[key] = {
      row: container.getAnchorRow(),
      column: container.getAnchorColumn(),
      offsetX: container.getOffsetX(),
      offsetY: container.getOffsetY(),
      width: Number(options.get('width')) || DASHBOARD_CHART_LAYOUT_DEFAULTS[key].width,
      height: Number(options.get('height')) || DASHBOARD_CHART_LAYOUT_DEFAULTS[key].height
    };
    return layouts;
  }, {});
}

function getDashboardChartLayout_(capturedLayouts, key) {
  const layout = capturedLayouts[key] || DASHBOARD_CHART_LAYOUT_DEFAULTS[key];
  if (key === 'topMerchants') {
    const monthlySpendLayout = capturedLayouts.monthlySpend || DASHBOARD_CHART_LAYOUT_DEFAULTS.monthlySpend;
    return Object.assign({}, layout, { height: monthlySpendLayout.height });
  }
  return layout;
}

function insertDashboardChart_(dashboard, sourceRange, layout, title, type, switchRowsAndColumns, options) {
  const builder = type === 'bar' ? dashboard.newChart().asBarChart() :
    type === 'line' ? dashboard.newChart().asLineChart() : dashboard.newChart().asColumnChart();
  const palette = ['#20B486', '#4F7CAC', '#F59E0B', '#A855F7', '#EF476F', '#06B6D4',
    '#F97316', '#84CC16', '#6366F1', '#EC4899'];
  let configured = builder.addRange(sourceRange)
    .setNumHeaders(1)
    .setTransposeRowsAndColumns(Boolean(switchRowsAndColumns))
    .setPosition(layout.row, layout.column, layout.offsetX, layout.offsetY)
    .setOption('title', title)
    .setOption('width', layout.width)
    .setOption('height', layout.height)
    .setOption('colors', palette);
  if (type === 'line') {
    configured = configured.setOption('pointSize', 7).setOption('lineWidth', 2)
      .setOption('legend', { position: 'right' });
  }
  Object.keys(options || {}).forEach(function (option) {
    configured = configured.setOption(option, options[option]);
  });
  dashboard.insertChart(configured.build());
}

const INSTALLER_PRESENTATION_VERSION = '2';

function applyInstallerSpreadsheetPresentation_(spreadsheet, localization) {
  const names = localization.sheetNames;
  [
    [names.transactions, '#20B486'], [names.imports, '#4F7CAC'],
    [names.sourceReconciliations, '#4F7CAC'], [names.configuration, '#F59E0B'],
    [names.balanceMovements, '#A855F7'], [names.monthlyBalances, '#A855F7'],
    [names.technicalData, '#64748B']
  ].forEach(function (specification) {
    const sheet = spreadsheet.getSheetByName(specification[0]);
    if (sheet) {
      if (specification[0] === names.configuration) {
        styleConfigurationSheet_(sheet, localization, specification[1]);
      } else {
        styleManagedDataSheet_(sheet, specification[1]);
      }
    }
  });
  styleDashboardSheet_(spreadsheet.getSheetByName(names.dashboard));
  const personalAnalysis = spreadsheet.getSheetByName(names.personalAnalysis);
  if (personalAnalysis) {
    personalAnalysis.setTabColor('#94A3B8');
    personalAnalysis.setHiddenGridlines(true);
  }
  protectTechnicalDataSheet_(spreadsheet.getSheetByName(names.technicalData));
  applyManagedConditionalFormatting_(spreadsheet, localization);
}

function styleManagedDataSheet_(sheet, tabColor) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const lastRow = Math.max(2, sheet.getLastRow());
  const header = sheet.getRange(1, 1, 1, lastColumn);
  sheet.setTabColor(tabColor);
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);
  header.setBackground('#1A1B1F').setFontColor('#FFFFFF').setFontFamily('Montserrat')
    .setFontSize(10).setFontWeight('bold').setVerticalAlignment('middle');
  sheet.getRange(2, 1, lastRow - 1, lastColumn).setFontFamily('Montserrat')
    .setFontSize(10).setFontColor('#1A1B1F').setVerticalAlignment('middle');
}

function styleConfigurationSheet_(sheet, localization, tabColor) {
  styleManagedDataSheet_(sheet, tabColor);
  // The generic data-sheet styling colours the first row.  This tab has two
  // separate vertical tables, therefore its unused former side-by-side area
  // must remain visually empty even when it contains only residual formats.
  sheet.getRange(1, 3, 1, 9).clearFormat();
  const taxonomyLastRow = getConfigurationTaxonomyLastRow_(sheet);
  applyConfigurationTableBorder_(sheet, 1, 1, taxonomyLastRow, 2);
  const layout = getInitialBalanceConfigurationLayout_(sheet,
    getInitialBalanceConfigurationHeaders_(localization));
  if (!layout) {
    return;
  }
  const dataRows = getInitialBalanceConfigurationDataRowCount_(sheet, layout);
  sheet.getRange(layout.headerRow, 1, 1, 7).setBackground('#1A1B1F').setFontColor('#FFFFFF')
    .setFontFamily('Montserrat').setFontSize(10).setFontWeight('bold');
  applyConfigurationTableBorder_(sheet, layout.headerRow, 1, Math.max(1, dataRows + 1), 7);
}

function protectTechnicalDataSheet_(sheet) {
  if (!sheet || sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 0) {
    return;
  }
  sheet.protect().setDescription('Managed calculation data: formulas update automatically.');
}

function styleDashboardSheet_(dashboard) {
  if (!dashboard) {
    return;
  }
  dashboard.setTabColor('#20B486');
  dashboard.setHiddenGridlines(true);
  dashboard.setFrozenRows(2);
  dashboard.getRange('A1:O1').setBackground('#1A1B1F').setFontColor('#FFFFFF')
    .setFontFamily('Montserrat').setFontSize(20).setFontWeight('bold')
    .setVerticalAlignment('middle');
  dashboard.getRange('A2:O2').setBackground('#1A1B1F').setFontColor('#CBD5E1')
    .setFontFamily('Montserrat').setFontSize(10).setFontStyle('italic');
  dashboard.setRowHeight(1, 40);
  dashboard.setRowHeight(2, 24);
  dashboard.setColumnWidths(1, 15, 92);
  dashboard.setColumnWidths(17, 6, 88);
}

function applyManagedConditionalFormatting_(spreadsheet, localization) {
  const properties = PropertiesService.getScriptProperties();
  const presentationMarker = JSON.stringify({
    version: INSTALLER_PRESENTATION_VERSION,
    spreadsheetId: spreadsheet.getId()
  });
  if (properties.getProperty('SPREADSHEET_PRESENTATION_VERSION') === presentationMarker) {
    return;
  }
  const names = localization.sheetNames;
  const transactions = spreadsheet.getSheetByName(names.transactions);
  const imports = spreadsheet.getSheetByName(names.imports);
  const reconciliations = spreadsheet.getSheetByName(names.sourceReconciliations);
  if (transactions) {
    const rules = removeManagedTextFormatRules_(transactions, ['J2:J'], ['expense', 'transfer']);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('expense')
      .setBackground('#EAF7F2').setRanges([transactions.getRange('J2:J')]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('transfer')
      .setBackground('#EEF2FF').setRanges([transactions.getRange('J2:J')]).build());
    transactions.setConditionalFormatRules(rules);
  }
  if (imports) {
    const statusColumn = getInstallerImportAuditHeaders_().indexOf('Source reconciliation status') + 1;
    const statusRange = imports.getRange(2, statusColumn, Math.max(1, imports.getMaxRows() - 1), 1);
    const rules = removeManagedTextFormatRules_(imports, ['N2:N', statusRange.getA1Notation()], ['OK', 'mismatch']);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK')
      .setBackground('#DCFCE7').setRanges([statusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('mismatch')
      .setBackground('#FEE2E2').setRanges([statusRange]).build());
    imports.setConditionalFormatRules(rules);
  }
  if (reconciliations) {
    const rules = removeManagedTextFormatRules_(reconciliations, ['O2:O'], ['OK', 'mismatch']);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK')
      .setBackground('#DCFCE7').setRanges([reconciliations.getRange('O2:O')]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('mismatch')
      .setBackground('#FEE2E2').setRanges([reconciliations.getRange('O2:O')]).build());
    reconciliations.setConditionalFormatRules(rules);
  }
  properties.setProperty('SPREADSHEET_PRESENTATION_VERSION', presentationMarker);
}

function removeManagedTextFormatRules_(sheet, managedRanges, managedValues) {
  return sheet.getConditionalFormatRules().filter(function (rule) {
    const condition = rule.getBooleanCondition();
    const values = condition ? condition.getCriteriaValues() : [];
    const hasManagedValue = values.length === 1 && managedValues.indexOf(String(values[0])) >= 0;
    const hasManagedRange = rule.getRanges().some(function (range) {
      return managedRanges.indexOf(range.getA1Notation()) >= 0;
    });
    return !hasManagedValue || !hasManagedRange;
  });
}

function orderInstallerSheets_(spreadsheet, localization) {
  const names = localization.sheetNames;
  [names.dashboard, names.transactions, names.imports, names.sourceReconciliations,
    names.configuration, names.balanceMovements, names.monthlyBalances, names.personalAnalysis,
    names.technicalData]
    .forEach(function (name, index) {
      const sheet = spreadsheet.getSheetByName(name);
      if (sheet) {
        spreadsheet.setActiveSheet(sheet);
        spreadsheet.moveActiveSheet(index + 1);
      }
    });
  const dashboard = spreadsheet.getSheetByName(names.dashboard);
  if (dashboard) {
    spreadsheet.setActiveSheet(dashboard);
  }
}
