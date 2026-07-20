const INSTALLER_SECRET_PREFIX = 'drive-expenses-cataloger-';

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
  const spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  const layout = getExpenseSheetLayout_(spreadsheet);
  const triggerStatus = getAutomationTriggerStatus_();
  return {
    installed: Boolean(layout.transactions && layout.imports &&
      triggerStatus.missingTriggerHandlers.length === 0 &&
      triggerStatus.duplicateTriggerHandlers.length === 0),
    automaticProcessingEnabled: isAutomaticProcessingEnabled_(),
    missingTriggerHandlers: triggerStatus.missingTriggerHandlers,
    duplicateTriggerHandlers: triggerStatus.duplicateTriggerHandlers,
    triggerCounts: triggerStatus.triggerCounts,
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

/** Reapply the managed layout, reporting formulas, and presentation explicitly. */
function refreshSpreadsheetLayoutAndPresentation() {
  assertCatalogConfiguration_();
  const spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  initializeInstallerSheets_(spreadsheet, getAutomationConfig_());
  SpreadsheetApp.flush();
  return { status: 'REFRESHED', spreadsheetUrl: spreadsheet.getUrl() };
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
  const balanceLayout = getInitialBalanceConfigurationLayout_(sheet,
    getInitialBalanceConfigurationHeaders_(localization));
  const clearUntil = balanceLayout ? balanceLayout.headerRow - 1 : sheet.getMaxRows();
  sheet.getRange(2, 1, Math.max(1, clearUntil - 1), 2).clearContent();
  if (values.length > 0) {
    sheet.getRange(2, 1, values.length, 2).setValues(values);
  }
  applyConfigurationTableBorder_(sheet, 1, 1, values.length + 1, 2);
}

function buildDashboard_(dashboard, transactions, localization) {
  const labels = localization.dashboard;
  const transactionsName = transactions.getName().replace(/'/g, "''");
  const technicalData = ensureInstallerSheet_(dashboard.getParent(), localization.sheetNames.technicalData, []);
  const selectionState = getDashboardSelectionState_(dashboard);
  const years = getDashboardAvailableYears_(transactions);
  const chartLayouts = captureDashboardChartLayouts_(dashboard, labels);
  writeDashboardTechnicalData_(technicalData, transactionsName, dashboard.getName(), localization);
  dashboard.clear();
  dashboard.getRange('A1:V40').breakApart();
  dashboard.getCharts().forEach(function (chart) { dashboard.removeChart(chart); });
  dashboard.getRange('A1:O1').merge().setValue(labels.title);
  dashboard.getRange('A2:O2').merge().setValue(labels.subtitle);
  writeDashboardKpiCard_(dashboard, 'A4:D4', 'A5:D7', labels.totalSpend,
    getDashboardSpendingSumFormula_(transactionsName), true, 'cumulative');
  writeDashboardKpiCard_(dashboard, 'E4:H4', 'E5:H7', labels.expenseCount,
    getDashboardSpendingCountFormula_(transactionsName), false, 'cumulative');
  writeDashboardKpiCard_(dashboard, 'J4:L4', 'J5:L7', labels.latestMonth,
    getDashboardLatestMonthLabelFormula_(transactionsName, labels.monthNames), false);
  writeDashboardKpiCard_(dashboard, 'M4:O4', 'M5:O7', labels.latestMonthSpend,
    getDashboardLatestMonthSpendFormula_(transactionsName), true);
  writeDashboardYearControls_(dashboard, years, selectionState, labels);
  // Charts capture their source range at creation time. Wait until every
  // dynamic pivot has settled, otherwise a late-arriving payer or category is
  // permanently omitted from the newly-created chart.
  waitForDashboardChartSources_(technicalData);
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 1, 25),
    getDashboardChartLayout_(chartLayouts, 'annualSpend'), labels.annualSpend, 'column', false);
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 30, 55),
    getDashboardChartLayout_(chartLayouts, 'monthlyComparison'), labels.monthlyComparison, 'line', false);
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 60, 85),
    getDashboardChartLayout_(chartLayouts, 'monthlySpend'), labels.monthlySpend, 'column', false, {
      hAxis: { showTextEvery: 1 }
    });
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 90, 115),
    getDashboardChartLayout_(chartLayouts, 'payerSpend'), labels.payerSpend, 'column', false);
  insertDashboardChart_(dashboard, getDashboardChartSourceRange_(technicalData, 120, 145),
    getDashboardChartLayout_(chartLayouts, 'topMerchants'), labels.topMerchants, 'bar', false);
  if (dashboard.getMaxColumns() > 22) {
    dashboard.deleteColumns(23, dashboard.getMaxColumns() - 22);
  }
  dashboard.setFrozenRows(1);
}

function writeDashboardTechnicalData_(technicalData, transactionsName, dashboardName, localization) {
  technicalData.getRange('A1:Z145').clearContent();
  technicalData.getRange('A200:B220').clearContent();
  writeDashboardStaticCategoryHeaders_(technicalData, localization);
  getDashboardDataSpecifications_(transactionsName, dashboardName, localization)
    .forEach(function (specification) {
    technicalData.getRange(specification.anchor).setFormula(specification.formula);
    technicalData.getRange(specification.anchor).setFontWeight('bold');
  });
  technicalData.setFrozenRows(1);
}

function writeDashboardStaticCategoryHeaders_(technicalData, localization) {
  const labels = localization.categoryLabels || {};
  const categories = Object.keys(labels).sort();
  const categoryHeaders = categories.map(function (category) { return labels[category]; });
  technicalData.getRange(1, 1, 1, categoryHeaders.length + 1)
    .setValues([[localization.dashboard.year].concat(categoryHeaders)]);
  technicalData.getRange(60, 1, 1, categoryHeaders.length + 1)
    .setValues([[localization.headers.month].concat(categoryHeaders)]);
}

function getDashboardSelectionState_(dashboard) {
  const selectedYears = dashboard.getRange('Q3:R100').getValues().reduce(function (years, row) {
    const year = Number(row[0]);
    if (year && row[1] === true) {
      years.push(year);
    }
    return years;
  }, []);
  const detailYear = Number(dashboard.getRange('V3').getValue());
  return { selectedYears: selectedYears, detailYear: detailYear };
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

function writeDashboardYearControls_(dashboard, years, selectionState, labels) {
  const selectedYears = selectionState.selectedYears.length ? selectionState.selectedYears : years;
  const detailYear = years.indexOf(selectionState.detailYear) >= 0 ? selectionState.detailYear : years[years.length - 1];
  dashboard.getRange('Q1:R1').merge().setValue(labels.comparisonYears);
  dashboard.getRange('T1:V1').merge().setValue(labels.detailYear);
  dashboard.getRange('Q2:R2').setValues([[labels.year, labels.includeYear]]);
  dashboard.getRange('T2:U2').merge().setValue(labels.selectedYear);
  dashboard.getRange('V3').setValue(detailYear);
  dashboard.getRange('V3').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(years.map(String), true).setAllowInvalid(false).build());
  const yearRows = years.map(function (year) { return [year, selectedYears.indexOf(year) >= 0]; });
  const values = dashboard.getRange(3, 17, yearRows.length, 2);
  dashboard.getRange(3, 18, yearRows.length, 1).insertCheckboxes();
  values.setValues(yearRows);
  dashboard.getRange('Q1:R1').setBackground('#1A1B1F').setFontColor('#FFFFFF')
    .setFontFamily('Montserrat').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('T1:V1').setBackground('#1A1B1F').setFontColor('#FFFFFF')
    .setFontFamily('Montserrat').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('Q2:R2').setBackground('#EAF7F2').setFontColor('#1A1B1F')
    .setFontFamily('Montserrat').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange('T2:U2').setBackground('#EAF7F2').setFontColor('#1A1B1F')
    .setFontFamily('Montserrat').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  dashboard.getRange(3, 17, Math.max(1, yearRows.length), 2).setFontFamily('Montserrat')
    .setFontSize(10).setHorizontalAlignment('center');
  dashboard.getRange('V3').setBackground('#EAF7F2').setFontColor('#1A1B1F').setFontFamily('Montserrat')
    .setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center');
}

function getDashboardDataSpecifications_(transactionsName, dashboardName, localization) {
  const ledger = "'" + transactionsName + "'!A:AD";
  const dashboard = "'" + String(dashboardName || 'Dashboard').replace(/'/g, "''") + "'!";
  const dashboardLabels = localization && localization.dashboard ? localization.dashboard : {};
  const monthNames = Array.isArray(dashboardLabels.monthNames) ? dashboardLabels.monthNames :
    ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
  const selectedYears = 'TEXTJOIN(" or ",TRUE,FILTER("C = "&' + dashboard +
    '$Q$3:$Q,' + dashboard + '$R$3:$R=TRUE))';
  const withoutPivotHeaders = function (query) {
    return 'FILTER(' + query + ',SEQUENCE(ROWS(' + query + '))>1)';
  };
  const monthChoices = monthNames.map(function (name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }).join(',');
  const monthName = function (monthIndex) {
    return 'MAP(' + monthIndex + ',LAMBDA(month,CHOOSE(month,' + monthChoices + ')))';
  };
  const monthLabels = function (query) {
    return '=IFERROR(LET(summary,' + query + ',labels,' + monthName('INDEX(summary,,1)') +
      ',values,CHOOSECOLS(summary,SEQUENCE(1,COLUMNS(summary)-1,2)),totals,' +
      'BYROW(values,LAMBDA(row,TEXT(SUM(row),"#,##0.00")&" EUR")),HSTACK(' +
      'MAP(labels,totals,LAMBDA(label,total,label&" · "&total)),values)),"")';
  };
  const annualSummary = withoutPivotHeaders('QUERY(' + ledger +
    ",\"select C,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and (\"&" + selectedYears +
    "&\") group by C pivot K label sum(G) ''\",0)");
  const annualCategoryValues = 'CHOOSECOLS(summary,SEQUENCE(1,COLUMNS(summary)-1,2))';
  const annualChartRows = 'LET(years,INDEX(summary,,1),values,' + annualCategoryValues +
    ',totals,BYROW(values,LAMBDA(row,TEXT(SUM(row),"#,##0.00")&" EUR")),' +
      'HSTACK(MAP(years,totals,LAMBDA(year,total,year&IF(ROWS(years)=1," · ",CHAR(10))&total)),' +
      'values))';
  const monthlyComparison = '=IFERROR(LET(summary,QUERY(' + ledger +
    ",\"select D,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and (\"&" + selectedYears +
    "&\") group by D pivot C order by D label sum(G) ''\",0),HSTACK(VSTACK(\"" +
    (localization && localization.headers && localization.headers.month ? localization.headers.month : 'Month') + '\",' + monthName('INDEX(summary,,1)') + '),' +
    'VSTACK(TRANSPOSE(FILTER(' + dashboard + '$Q$3:$Q,' + dashboard +
      '$R$3:$R=TRUE)),CHOOSECOLS(summary,SEQUENCE(1,COLUMNS(summary)-1,2))))),"")';
  return [
    { anchor: 'A2', formula: '=IFERROR(LET(summary,' + annualSummary +
      ',' + annualChartRows + '),"")' },
    { anchor: 'A30', formula: monthlyComparison },
    { anchor: 'A61', formula: monthLabels(withoutPivotHeaders('QUERY(' + ledger +
      ",\"select D,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and C = \"&" + dashboard +
        '$V$3&" group by D pivot K order by D label sum(G) \'\'",0)')) },
    { anchor: 'A90', formula: '=QUERY(' + ledger +
      ",\"select C,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and (\"&" + selectedYears +
      "&\") group by C pivot E label sum(G) ''\",1)" },
    { anchor: 'A120', formula: '=IFERROR(LET(summary,QUERY(' + ledger +
      ",\"select M,sum(G) where (J = 'expense' or J = 'income') and H = 'EUR' and C = \"&" + dashboard +
        '$V$3&" and M is not null and M <> \'Unknown\' and M <> \'N/A\' group by M order by sum(G) desc limit 10 label sum(G) \'\'",0),HSTACK(VSTACK("Year",' +
        dashboard + '$V$3),VSTACK(TRANSPOSE(INDEX(summary,,1)),TRANSPOSE(INDEX(summary,,2))))),"")' }
  ];
}

function waitForDashboardChartSources_(technicalData) {
  const sourceRows = [2, 30, 61, 90, 120];
  let previousWidths = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    SpreadsheetApp.flush();
    const widths = sourceRows.map(function (row) {
      const values = technicalData.getRange(row, 1, 1, 26).getDisplayValues()[0];
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

function getDashboardChartSourceRange_(sheet, startRow, endRow) {
  const values = sheet.getRange(startRow, 1, endRow - startRow + 1, 26).getValues();
  let dataRows = 1;
  let dataColumns = 1;
  values.forEach(function (row, rowIndex) {
    row.forEach(function (value, columnIndex) {
      if (value !== '') {
        dataRows = Math.max(dataRows, rowIndex + 1);
        dataColumns = Math.max(dataColumns, columnIndex + 1);
      }
    });
  });
  return sheet.getRange(startRow, 1, Math.max(2, dataRows), Math.max(2, dataColumns));
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
  }
}

// These values reproduce the dashboard layout approved for a new spreadsheet.
// Existing dashboards always retain the user-adjusted geometry captured before a refresh.
const DASHBOARD_CHART_LAYOUT_DEFAULTS = {
  annualSpend: { row: 9, column: 1, offsetX: 0, offsetY: 0, width: 684, height: 371 },
  topMerchants: { row: 9, column: 8, offsetX: 59, offsetY: 0, width: 684, height: 371 },
  payerSpend: { row: 9, column: 16, offsetX: 24, offsetY: 0, width: 600, height: 371 },
  monthlySpend: { row: 29, column: 1, offsetX: 0, offsetY: 0, width: 1395, height: 371 },
  monthlyComparison: { row: 49, column: 1, offsetX: 0, offsetY: 0, width: 1395, height: 371 }
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
  return capturedLayouts[key] || DASHBOARD_CHART_LAYOUT_DEFAULTS[key];
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

const INSTALLER_PRESENTATION_VERSION = '1';

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
  if (properties.getProperty('SPREADSHEET_PRESENTATION_VERSION') ===
    INSTALLER_PRESENTATION_VERSION) {
    return;
  }
  const names = localization.sheetNames;
  const transactions = spreadsheet.getSheetByName(names.transactions);
  const imports = spreadsheet.getSheetByName(names.imports);
  const reconciliations = spreadsheet.getSheetByName(names.sourceReconciliations);
  if (transactions) {
    const rules = transactions.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('expense')
      .setBackground('#EAF7F2').setRanges([transactions.getRange('J2:J')]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('transfer')
      .setBackground('#EEF2FF').setRanges([transactions.getRange('J2:J')]).build());
    transactions.setConditionalFormatRules(rules);
  }
  if (imports) {
    const rules = imports.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK')
      .setBackground('#DCFCE7').setRanges([imports.getRange('N2:N')]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('mismatch')
      .setBackground('#FEE2E2').setRanges([imports.getRange('N2:N')]).build());
    imports.setConditionalFormatRules(rules);
  }
  if (reconciliations) {
    const rules = reconciliations.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK')
      .setBackground('#DCFCE7').setRanges([reconciliations.getRange('O2:O')]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('mismatch')
      .setBackground('#FEE2E2').setRanges([reconciliations.getRange('O2:O')]).build());
    reconciliations.setConditionalFormatRules(rules);
  }
  properties.setProperty('SPREADSHEET_PRESENTATION_VERSION', INSTALLER_PRESENTATION_VERSION);
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
