const CONFIG = Object.freeze({
  APP_VERSION: '0.2.2',
  DEFAULT_MODEL: 'gemini-3.5-flash',
  DAILY_TRIGGER_HOUR: 7,
  MAX_RUNTIME_MS: 280000,
  MAX_AGENTS_FILE_BYTES: 100 * 1024,
  GEMINI_MAX_OUTPUT_TOKENS: 16384,
  TRICOUNT_JSON_NORMALIZATION_BATCH_SIZE: 25,
  GEMINI_TRANSIENT_RETRY_DELAYS_MS: Object.freeze([500, 1500]),
  GEMINI_VERTEX_FALLBACK_COOLDOWN_MS: 60 * 60 * 1000,
  DRIVE_AGENTS_FILE_NAME: 'AGENTS.md',
  PROPERTY_KEYS: Object.freeze({
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    GEMINI_BACKEND: 'GEMINI_BACKEND',
    GEMINI_MODEL: 'GEMINI_MODEL',
    GEMINI_AUTO_VERTEX_FALLBACK: 'GEMINI_AUTO_VERTEX_FALLBACK',
    GEMINI_VERTEX_FALLBACK_UNTIL: 'GEMINI_VERTEX_FALLBACK_UNTIL',
    JSON_REBUILD_STATE: 'JSON_REBUILD_STATE',
    VERTEX_AI_LOCATION: 'VERTEX_AI_LOCATION',
    NOTIFICATION_RECIPIENT: 'NOTIFICATION_RECIPIENT',
    ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    AUTOMATION_CONFIG_JSON: 'AUTOMATION_CONFIG_JSON',
    GOOGLE_CLOUD_PROJECT_ID: 'GOOGLE_CLOUD_PROJECT_ID',
    AUTO_PROCESSING: 'AUTO_PROCESSING',
    SOURCE_FOLDER_STATE: 'SOURCE_FOLDER_STATE'
  })
});

function getSetupStatus() {
  const property = CONFIG.PROPERTY_KEYS;
  const properties = PropertiesService.getScriptProperties();
  return {
    applicationVersion: CONFIG.APP_VERSION,
    geminiApiKeyConfigured: Boolean(properties.getProperty(property.GEMINI_API_KEY)),
    geminiBackend: getGeminiBackend_(),
    rootFolderConfigured: Boolean(properties.getProperty(property.ROOT_FOLDER_ID)),
    spreadsheetConfigured: Boolean(properties.getProperty(property.SPREADSHEET_ID)),
    automationConfigConfigured: Boolean(properties.getProperty(property.AUTOMATION_CONFIG_JSON)),
    cloudProjectConfigured: Boolean(properties.getProperty(property.GOOGLE_CLOUD_PROJECT_ID)),
    automaticProcessingEnabled: isAutomaticProcessingEnabled_()
  };
}

function getApplicationVersion() {
  return CONFIG.APP_VERSION;
}

/** Enable the configured Vertex project when Gemini Developer API quota is exhausted. */
function enableAutomaticVertexFallback() {
  assertCatalogConfiguration_();
  PropertiesService.getScriptProperties().setProperty(
    CONFIG.PROPERTY_KEYS.GEMINI_AUTO_VERTEX_FALLBACK,
    'true'
  );
  return {
    status: 'ENABLED',
    geminiBackend: getGeminiBackend_(),
    geminiModel: getGeminiModel_()
  };
}

function getScriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function getAutomationConfig_() {
  const raw = getScriptProperty_(CONFIG.PROPERTY_KEYS.AUTOMATION_CONFIG_JSON);
  if (!raw) {
    throw new Error('Configure AUTOMATION_CONFIG_JSON first.');
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error('AUTOMATION_CONFIG_JSON is invalid JSON: ' + error.message);
  }
  validateAutomationConfig_(config);
  return normalizeAutomationConfig_(config);
}

function normalizeAutomationConfig_(config) {
  const normalized = JSON.parse(JSON.stringify(config));
  normalized.archive_folder_name = getArchiveFolderName_(normalized);
  const excluded = Array.isArray(normalized.excluded_root_folder_names) ?
    normalized.excluded_root_folder_names.map(String) : [];
  [normalized.archive_folder_name, '_Imported', 'Imported', 'Importazioni'].forEach(function (name) {
    if (excluded.indexOf(name) < 0) {
      excluded.push(name);
    }
  });
  normalized.excluded_root_folder_names = excluded;
  return normalized;
}

function getArchiveFolderName_(config) {
  const configured = String(config.archive_folder_name || '').trim();
  if (['_Imported', 'Imported', 'Importazioni'].indexOf(configured) >= 0) {
    return config.locale === 'it' ? 'Importazioni' : 'Imported';
  }
  return configured;
}

function validateAutomationConfig_(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Automation configuration must be an object.');
  }
  ['locale', 'intake_keyword', 'archive_folder_name', 'test_fixture_folder_name'].forEach(
    function (key) {
      if (!String(config[key] || '').trim()) {
        throw new Error('Automation configuration requires ' + key + '.');
      }
    }
  );
  if (['en', 'it'].indexOf(config.locale) < 0) {
    throw new Error('locale must be en or it.');
  }
  if (!Array.isArray(config.excluded_root_folder_names)) {
    throw new Error('excluded_root_folder_names must be an array.');
  }
  if (!config.categories || typeof config.categories !== 'object' ||
    Array.isArray(config.categories)) {
    throw new Error('categories must be an object.');
  }
  if (Object.keys(config.categories).length > 25) {
    throw new Error('categories supports at most 25 dashboard series.');
  }
  Object.keys(config.categories).forEach(function (category) {
    if (!Array.isArray(config.categories[category]) ||
      config.categories[category].length === 0) {
      throw new Error('Each category requires at least one subcategory: ' + category);
    }
  });
}

function getGeminiBackend_() {
  const backend = getScriptProperty_(CONFIG.PROPERTY_KEYS.GEMINI_BACKEND) || 'gemini_api';
  if (['gemini_api', 'vertex_ai'].indexOf(backend) < 0) {
    throw new Error('GEMINI_BACKEND must be gemini_api or vertex_ai.');
  }
  return backend;
}

function getEffectiveGeminiBackend_() {
  const until = Number(getScriptProperty_(CONFIG.PROPERTY_KEYS.GEMINI_VERTEX_FALLBACK_UNTIL));
  if (getGeminiBackend_() === 'gemini_api' &&
    getScriptProperty_(CONFIG.PROPERTY_KEYS.GEMINI_AUTO_VERTEX_FALLBACK) === 'true' &&
    until > Date.now()) {
    return 'vertex_ai';
  }
  return getGeminiBackend_();
}

function getGeminiModel_() {
  return getScriptProperty_(CONFIG.PROPERTY_KEYS.GEMINI_MODEL) || CONFIG.DEFAULT_MODEL;
}

function getRootFolderId_() {
  return getScriptProperty_(CONFIG.PROPERTY_KEYS.ROOT_FOLDER_ID);
}

function getSpreadsheetId_() {
  return getScriptProperty_(CONFIG.PROPERTY_KEYS.SPREADSHEET_ID);
}

function assertCatalogConfiguration_() {
  const key = CONFIG.PROPERTY_KEYS;
  const required = [key.NOTIFICATION_RECIPIENT, key.ROOT_FOLDER_ID, key.SPREADSHEET_ID,
    key.AUTOMATION_CONFIG_JSON];
  const missing = required.filter(function (name) { return !getScriptProperty_(name); });
  if (missing.length > 0) {
    throw new Error('Missing Script Properties: ' + missing.join(', '));
  }
  if (getGeminiBackend_() === 'gemini_api' && !getScriptProperty_(key.GEMINI_API_KEY)) {
    throw new Error('GEMINI_API_KEY is required for Gemini Developer API.');
  }
  if ((getGeminiBackend_() === 'vertex_ai' ||
    getScriptProperty_(key.GEMINI_AUTO_VERTEX_FALLBACK) === 'true') &&
    !getScriptProperty_(key.GOOGLE_CLOUD_PROJECT_ID)) {
    throw new Error('GOOGLE_CLOUD_PROJECT_ID is required for Vertex AI.');
  }
  getAutomationConfig_();
}

function isAutomaticProcessingEnabled_() {
  return getScriptProperty_(CONFIG.PROPERTY_KEYS.AUTO_PROCESSING) === 'true';
}
