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
  writeConfigurationTaxonomy_(configuration, config.categories);
  const dashboard = ensureInstallerSheet_(spreadsheet, localization.sheetNames.dashboard, []);
  buildDashboard_(dashboard, transactions, localization);
  transactions.setFrozenRows(1);
  transactions.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  imports.setFrozenRows(1);
  imports.getRange(1, 1, 1, imports.getLastColumn()).setFontWeight('bold');
  refreshBalanceViews_(spreadsheet);
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

function getInstallerImportAuditHeaders_() {
  return ['Imported at', 'Source folder', 'Source folder link', 'Source JSON files', 'Source rows',
    'Imported rows', 'Duplicate rows', 'Date start', 'Date end', 'Review rows',
    'Opening balance rows', 'Opening balance discrepancies', 'Opening balance checks',
    'Source reconciliation status', 'Source reconciliations'];
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

function writeConfigurationTaxonomy_(sheet, categories) {
  const values = Object.keys(categories).flatMap(function (category) {
    return categories[category].map(function (subcategory) { return [category, subcategory]; });
  });
  sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), 2).clearContent();
  if (values.length > 0) {
    sheet.getRange(2, 1, values.length, 2).setValues(values);
  }
}

function buildDashboard_(dashboard, transactions, localization) {
  dashboard.clear();
  dashboard.getCharts().forEach(function (chart) { dashboard.removeChart(chart); });
  dashboard.getRange('A1').setValue('Expense dashboard').setFontSize(16).setFontWeight('bold');
  const name = transactions.getName().replace(/'/g, "''");
  dashboard.getRange('A3').setFormula("=QUERY('" + name +
    "'!A:U,\"select C,sum(G) where J = 'expense' group by C pivot K label sum(G) ''\",1)");
  dashboard.getRange('A20').setFormula("=QUERY('" + name +
    "'!A:U,\"select C,D,sum(G) where J = 'expense' group by C,D pivot K label sum(G) ''\",1)");
  dashboard.getRange('A40').setFormula("=QUERY('" + name +
    "'!A:U,\"select C,K,L,sum(G) where J = 'expense' group by C,K,L label sum(G) ''\",1)");
  dashboard.getRange('A60').setFormula("=QUERY('" + name +
    "'!A:U,\"select C,sum(G) where J <> 'expense' group by C pivot J label sum(G) ''\",1)");
  dashboard.getRange('A80').setFormula("=QUERY('" + name +
    "'!A:U,\"select C,D,sum(G) where J = 'expense' and K = 'Dogs' group by C,D pivot L label sum(G) ''\",1)");
  dashboard.getRange('A100').setFormula("=QUERY('" + name +
    "'!A:U,\"select C,sum(G) where J = 'expense' group by C pivot E label sum(G) ''\",1)");
  const balanceName = localization.sheetNames.monthlyBalances.replace(/'/g, "''");
  dashboard.getRange('A120').setFormula("=QUERY('" + balanceName +
    "'!A:H,\"select A,B,sum(E) where C = 'EUR' group by A,B pivot D label sum(E) ''\",1)");
  [
    ['A3:Z18', 3, 28, 'Annual spending by category'],
    ['A20:Z38', 20, 28, 'Monthly spending by category'],
    ['A80:Z98', 80, 28, 'Dog spending by subcategory'],
    ['A100:Z118', 100, 28, 'Spending by payer'],
    ['A120:Z138', 120, 28, 'Exact monthly balances (EUR)']
  ].forEach(function (specification) {
    dashboard.insertChart(dashboard.newChart().asLineChart()
      .addRange(dashboard.getRange(specification[0]))
      .setPosition(specification[1], specification[2], 0, 0)
      .setOption('title', specification[3]).build());
  });
  dashboard.setFrozenRows(1);
}
