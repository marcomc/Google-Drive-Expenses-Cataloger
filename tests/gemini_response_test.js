#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const properties = new Map([
  ['GEMINI_BACKEND', 'gemini_api'],
  ['GEMINI_AUTO_VERTEX_FALLBACK', 'true']
]);
const sleepDelays = [];
const context = vm.createContext({
  console,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || '',
      setProperty: (key, value) => properties.set(key, String(value))
    })
  },
  Utilities: {
    sleep: (delay) => sleepDelays.push(delay)
  }
});

vm.runInContext(fs.readFileSync('Config.gs', 'utf8'), context);
vm.runInContext(fs.readFileSync('ExpensesCataloging.gs', 'utf8'), context);

assert.deepEqual(JSON.parse(JSON.stringify(context.applyIncomeRefundClassificationToRow_(
  ['unchanged', '', '', '', '', 'tail'],
  { category: 1, subcategory: 2, merchant: 3, confidence: 4, rationale: 5 },
  { category: 'Groceries', subcategory: 'General groceries', merchant: 'Conad', confidence: 0.9,
    rationale: 'Refund from supplier' }
))), ['unchanged', 'Groceries', 'General groceries', 'Conad', 0.9, 'Refund from supplier']);

const incomeHeaders = ['Transaction type', 'Category', 'Subcategory', 'Merchant', 'Confidence', 'Rationale',
  'Date', 'Payer', 'Beneficiaries', 'Amount', 'Currency', 'Description', 'Source category',
  'Source custom category'];
const incomeColumns = Object.fromEntries(incomeHeaders.map((header, index) => [header, index]));
const incomeRows = [
  ['income', '', '', '', '', '', '2026-04-01', 'Laura', 'Marco', -25, 'EUR', 'Historic refund', 'OTHER', ''],
  ['income', 'Food and drink', 'Restaurant', 'Bar', 0.9, 'Already categorized', '2026-04-02', 'Laura', 'Marco',
    -15, 'EUR', 'Known refund', 'FOOD_AND_DRINK', ''],
  ['expense', '', '', '', '', '', '2026-04-03', 'Marco', 'Laura', 30, 'EUR', 'Expense', 'OTHER', '']
];
const incomeUpdates = [];
const incomeTransactions = {
  getLastRow: () => incomeRows.length + 1,
  getRange: (row, _column, _rowCount, columnCount) => ({
    getValues: () => columnCount === incomeHeaders.length ? incomeRows.map((entry) => entry.slice()) : [],
    setValues: (values) => {
      incomeRows[row - 2] = values[0].slice();
      incomeUpdates.push({ row, values: values[0].slice() });
    }
  })
};
let geminiIncomeCalls = 0;
let dashboardRefreshes = 0;
let presentationRefreshes = 0;
let orderingRefreshes = 0;
context.withExpenseLock_ = (_source, callback) => callback();
context.assertCatalogConfiguration_ = () => {};
context.getAutomationConfig_ = () => ({ categories: { 'Food and drink': {} } });
context.getRootFolderId_ = () => 'root-folder';
context.DriveApp = { getFolderById: () => ({}) };
context.loadDriveAgentsPolicy_ = () => ({});
context.getSpreadsheetId_ = () => 'spreadsheet-id';
context.SpreadsheetApp = { openById: () => ({ getSheetByName: () => ({}) }) };
context.getExpenseSheetLayout_ = () => ({ headers: incomeHeaders, transactions: incomeTransactions });
context.getLocalization_ = () => ({ headers: {
  transactionType: 'Transaction type', category: 'Category', subcategory: 'Subcategory', merchant: 'Merchant',
  confidence: 'Confidence', rationale: 'Rationale', date: 'Date', payer: 'Payer', beneficiaries: 'Beneficiaries',
  amount: 'Amount', currency: 'Currency', description: 'Description', sourceCategory: 'Source category',
  sourceCustomCategory: 'Source custom category'
}, sheetNames: { dashboard: 'Dashboard' } });
context.buildExpenseJsonNormalizationPrompt_ = (records) => records;
context.callGeminiJson_ = (records) => {
  geminiIncomeCalls += 1;
  assert.equal(records.length, 1, 'only uncategorized income rows may reach Gemini');
  return { records: [{ category: 'Food and drink', subcategory: 'Restaurant', merchant: 'Restaurant',
    confidence: 0.8, rationale: 'Historic refund' }] };
};
context.applyJsonExpenseClassification_ = (classification) => classification;
context.buildDashboard_ = () => { dashboardRefreshes += 1; };
context.applyInstallerSpreadsheetPresentation_ = () => { presentationRefreshes += 1; };
context.orderInstallerSheets_ = () => { orderingRefreshes += 1; };
assert.deepEqual(JSON.parse(JSON.stringify(context.categorizeIncomeRefunds())), {
  status: 'CATEGORIZED', categorized: 1
});
assert.equal(geminiIncomeCalls, 1);
assert.equal(incomeUpdates.length, 1);
assert.deepEqual(incomeRows[0].slice(incomeColumns.Date),
  ['2026-04-01', 'Laura', 'Marco', -25, 'EUR', 'Historic refund', 'OTHER', ''],
  'classification must leave immutable ledger and source values untouched');
assert.equal(dashboardRefreshes, 1);
assert.equal(presentationRefreshes, 1);
assert.equal(orderingRefreshes, 1);
assert.deepEqual(JSON.parse(JSON.stringify(context.categorizeIncomeRefunds())), {
  status: 'UP_TO_DATE', categorized: 0
});
assert.equal(geminiIncomeCalls, 1, 'an idempotent retry must not reclassify configured income refunds');
assert.equal(dashboardRefreshes, 1, 'no-op runs must not rebuild derived spreadsheet state');
function generationResponse(finishReason, text) {
  return {
    candidates: [{
      finishReason,
      content: { parts: [{ text }] }
    }]
  };
}

function httpResponse(status, body) {
  return {
    getResponseCode: () => status,
    getContentText: () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseGeminiJsonResponse_(
    generationResponse('STOP', '{"accepted":true}')
  ))),
  { accepted: true }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseGeminiJsonResponse_(
    generationResponse('STOP', '{"accepted":true}\nGenerated by Gemini')
  ))),
  { accepted: true },
  'A complete JSON value must remain usable when Gemini appends non-JSON text.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseGeminiJsonResponse_(
    generationResponse('STOP', 'Here is the requested result:\n{"accepted":true}')
  ))),
  { accepted: true },
  'Leading model prose must not hide a complete JSON value.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseGeminiJsonResponse_(
    generationResponse('STOP', 'Result:\n```json\n[{"accepted":true}]\n```')
  ))),
  [{ accepted: true }],
  'A fenced JSON value after leading prose must remain usable.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseGeminiJsonResponse_(
    generationResponse('STOP', 'Do not use {placeholder}. Result: {"accepted":true}')
  ))),
  { accepted: true },
  'An earlier balanced non-JSON snippet must not hide a later valid value.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseGeminiJsonResponse_(generationResponse(
    'STOP',
    'Result: {not: "json"}\n' +
      '{"records":[{"text":"escaped quote: \\\"; braces: { } and brackets: [ ]",' +
      '"nested":{"values":[1,{"ok":true}]}}]}\nDone.'
  )))),
  {
    records: [{
      text: 'escaped quote: "; braces: { } and brackets: [ ]',
      nested: { values: [1, { ok: true }] }
    }]
  },
  'Nested delimiters and escaped string content must be scanned without truncation.'
);
assert.throws(
  () => context.parseGeminiJsonResponse_(
    generationResponse('STOP', 'Result: {"accepted":')
  ),
  /Gemini returned invalid JSON:.*incomplete/
);
assert.throws(
  () => context.parseGeminiJsonResponse_(
    generationResponse('STOP', 'Result: {accepted: true} and [still invalid]')
  ),
  /Gemini returned invalid JSON:.*no complete valid object or array/
);
assert.throws(
  () => context.parseGeminiJsonResponse_(
    generationResponse('MAX_TOKENS', '{"accepted":true}')
  ),
  /finish reason: MAX_TOKENS/
);
assert.throws(
  () => context.parseGeminiJsonResponse_({
    candidates: [{ content: { parts: [{ text: '{"accepted":true}' }] } }]
  }),
  /finish reason: UNSPECIFIED/
);

const dailyQuota = httpResponse(429, {
  error: { message: 'GenerateRequestsPerDay quota exceeded.' }
});
const fallback = context.parseGeminiHttpResponse_(dailyQuota, 'Gemini Developer API');
assert.equal(fallback.__retryWithVertex, true);
assert.ok(Number(properties.get('GEMINI_VERTEX_FALLBACK_UNTIL')) > Date.now());

properties.delete('GEMINI_VERTEX_FALLBACK_UNTIL');
const prepaidQuota = httpResponse(429, {
  error: { message: 'Your prepayment credits are depleted.' }
});
assert.equal(
  context.parseGeminiHttpResponse_(prepaidQuota, 'Gemini Developer API').__retryWithVertex,
  true
);

properties.delete('GEMINI_VERTEX_FALLBACK_UNTIL');
properties.set('GEMINI_AUTO_VERTEX_FALLBACK', 'false');
assert.throws(
  () => context.parseGeminiHttpResponse_(dailyQuota, 'Gemini Developer API'),
  /HTTP 429/
);
assert.equal(properties.has('GEMINI_VERTEX_FALLBACK_UNTIL'), false);
properties.set('GEMINI_AUTO_VERTEX_FALLBACK', 'true');

properties.delete('GEMINI_VERTEX_FALLBACK_UNTIL');
const genericRateLimit = httpResponse(429, {
  error: { message: 'Too many requests. Retry shortly.' }
});
assert.throws(
  () => context.parseGeminiHttpResponse_(genericRateLimit, 'Gemini Developer API'),
  /HTTP 429/
);
assert.equal(properties.has('GEMINI_VERTEX_FALLBACK_UNTIL'), false);

const vertexDailyQuota = httpResponse(429, {
  error: { message: 'GenerateRequestsPerDay quota exceeded on Vertex.' }
});
assert.throws(
  () => context.parseGeminiHttpResponse_(vertexDailyQuota, 'Vertex AI'),
  /Vertex AI failed \(HTTP 429\)/
);
assert.equal(properties.has('GEMINI_VERTEX_FALLBACK_UNTIL'), false);

let fetchCount = 0;
sleepDelays.length = 0;
const transientResult = context.callGeminiWithTransientRetry_(() => {
  fetchCount += 1;
  return fetchCount === 1 ? genericRateLimit : httpResponse(200, { ok: true });
}, 'Gemini Developer API');
assert.deepEqual(JSON.parse(JSON.stringify(transientResult)), { ok: true });
assert.deepEqual(sleepDelays, [500]);

fetchCount = 0;
sleepDelays.length = 0;
context.callGeminiWithTransientRetry_(() => {
  fetchCount += 1;
  return dailyQuota;
}, 'Gemini Developer API');
assert.equal(fetchCount, 1);
assert.deepEqual(sleepDelays, []);

fetchCount = 0;
sleepDelays.length = 0;
assert.throws(
  () => context.callGeminiWithTransientRetry_(() => {
    fetchCount += 1;
    return vertexDailyQuota;
  }, 'Vertex AI'),
  /Vertex AI failed \(HTTP 429\)/
);
assert.equal(fetchCount, 3);
assert.deepEqual(sleepDelays, [500, 1500]);

fetchCount = 0;
sleepDelays.length = 0;
const networkRetryResult = context.callGeminiWithTransientRetry_(() => {
  fetchCount += 1;
  if (fetchCount === 1) {
    throw new Error('temporary transport failure');
  }
  return httpResponse(200, { ok: true });
}, 'Gemini Developer API');
assert.deepEqual(JSON.parse(JSON.stringify(networkRetryResult)), { ok: true });
assert.equal(fetchCount, 2);
assert.deepEqual(sleepDelays, [500]);

fetchCount = 0;
sleepDelays.length = 0;
assert.throws(
  () => context.callGeminiWithTransientRetry_(() => {
    fetchCount += 1;
    throw new Error('persistent transport failure');
  }, 'Vertex AI'),
  /Vertex AI network request failed after retry: persistent transport failure/
);
assert.equal(fetchCount, 3);
assert.deepEqual(sleepDelays, [500, 1500]);

const generationRequests = [];
context.UrlFetchApp = {
  fetch: (url, options) => {
    generationRequests.push({ url, options: JSON.parse(JSON.stringify(options)) });
    return httpResponse(200, generationResponse('STOP', '{"accepted":true}'));
  }
};
properties.set('GEMINI_API_KEY', 'test-key');
context.callGeminiDeveloperApi_([{ text: 'classify this expense' }]);
properties.set('GOOGLE_CLOUD_PROJECT_ID', 'test-project');
context.ScriptApp = { getOAuthToken: () => 'test-token' };
context.callVertexAi_([{ text: 'classify this expense' }]);
assert.equal(generationRequests.length, 2);
generationRequests.forEach(({ options }) => {
  assert.deepEqual(options.payload && JSON.parse(options.payload).generationConfig, {
    responseMimeType: 'application/json', maxOutputTokens: 16384
  }, 'Gemini 3.6 requests must omit deprecated sampling parameters');
});
assert.match(generationRequests[0].url, /models\/gemini-3\.6-flash:generateContent$/);
assert.match(generationRequests[1].url,
  /publishers\/google\/models\/gemini-3\.6-flash:generateContent$/);
console.log('Gemini response tests passed.');
