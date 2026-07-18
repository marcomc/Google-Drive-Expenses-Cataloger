/**
 * Pure import-policy helpers. Keep these functions free of Drive and Sheets
 * state so the import seam is testable before installing Apps Script.
 */
function isEligibleCandidateFolder_(candidate, config) {
  const name = String(candidate.name || '');
  if (isExcludedRootFolderName_(name, config)) {
    return false;
  }
  return (candidate.jsonNames || []).some(function (jsonName) {
    return isEligibleTricountJsonFileName_(jsonName, config);
  });
}

function isExcludedRootFolderName_(name, config) {
  const normalized = String(name || '').toLowerCase();
  const protectedNames = ['_Imported', 'Imported', 'Importazioni', config.archive_folder_name];
  return (config.excluded_root_folder_names || []).concat(protectedNames).some(function (entry) {
    return String(entry).toLowerCase() === normalized;
  });
}

/** Drive can report JSON uploads with inconsistent MIME types; trust the strict name, then parse. */
function isTricountJsonFileName_(name) {
  return /^transactions-.*\.json$/i.test(String(name || ''));
}

function isEligibleTricountJsonFileName_(name, config) {
  const keyword = String(config.intake_keyword || '').toLowerCase();
  return Boolean(keyword) && isTricountJsonFileName_(name) &&
    String(name || '').toLowerCase().indexOf(keyword) >= 0;
}

/** Pure state-machine helpers for the durable historical rebuild. */
function createJsonRebuildState_(runId, stagingFolderId, sources, startedAt) {
  return { version: 2, runId: String(runId), stagingFolderId: String(stagingFolderId),
    sources: (sources || []).map(function (source) { return Object.assign({}, source); }),
    nextIndex: 0, startedAt: String(startedAt) };
}

function isValidJsonRebuildState_(state) {
  return Boolean(state && state.version === 2 && String(state.runId || '') &&
    String(state.stagingFolderId || '') && Array.isArray(state.sources) &&
    state.sources.every(isValidJsonRebuildSource_) && Number.isInteger(state.nextIndex) &&
    state.nextIndex >= 0 && state.nextIndex <= state.sources.length);
}

function isValidJsonRebuildSource_(source) {
  const archiveType = String(source && source.archiveType || '');
  return Boolean(source && String(source.fileId || '') && String(source.folderId || '') &&
    String(source.name || '') && String(source.contentHash || '') &&
    (archiveType === 'file' || archiveType === 'folder') &&
    String(source.archiveContainerId || '') && Number.isInteger(source.archiveDepth) &&
    source.archiveDepth >= 0);
}

function getJsonRebuildStageFileName_(state, source) {
  return String(state.runId) + '-' + String(source.fileId) + '.json';
}

function advanceJsonRebuildState_(state) {
  if (!isValidJsonRebuildState_(state) || state.nextIndex >= state.sources.length) {
    throw new Error('Cannot advance an invalid or completed JSON rebuild state.');
  }
  return Object.assign({}, state, { nextIndex: state.nextIndex + 1 });
}

function isJsonRebuildReadyToCommit_(state) {
  return isValidJsonRebuildState_(state) && state.nextIndex === state.sources.length;
}

function isValidJsonRebuildStage_(staged, source) {
  const sourceFile = staged && staged.sourceFile;
  return Boolean(sourceFile && Array.isArray(staged.records) &&
    String(sourceFile.id || '') === String(source.fileId || '') &&
    String(sourceFile.name || '') === String(source.name || '') &&
    String(sourceFile.contentHash || '') === String(source.contentHash || ''));
}

/**
 * Converts a complete Tricount JSON export into factual, source-traceable
 * records. Classification is deliberately not performed here: the source
 * amounts, allocations, categories, and transaction type remain immutable.
 */
function parseTricountJsonExport_(document, file, folder) {
  const responses = document && Array.isArray(document.Response) ? document.Response : [];
  const entries = [];
  responses.forEach(function (response) {
    const registry = response && response.Registry;
    const records = registry && Array.isArray(registry.all_registry_entry) ?
      registry.all_registry_entry : [];
    records.forEach(function (wrapper) {
      if (wrapper && wrapper.RegistryEntry) {
        entries.push(wrapper.RegistryEntry);
      }
    });
  });
  if (responses.length === 0) {
    throw new Error('The JSON source is not a complete Tricount export.');
  }
  return entries.map(function (entry, index) {
    return normalizeTricountJsonEntry_(entry, index + 1, file, folder);
  });
}

function normalizeTricountJsonEntry_(entry, sourceRow, file, folder) {
  const sourceAmount = getTricountMoneyAmount_(entry.amount);
  const currency = getTricountMoneyCurrency_(entry.amount, entry.amount_local);
  const allocations = (entry.allocations || []).map(normalizeTricountAllocation_);
  const payer = getTricountMembershipName_(entry.membership_owned);
  const beneficiaries = allocations.map(function (allocation) {
    return allocation.participant;
  }).filter(Boolean).join(', ');
  const sourceNativeType = String(entry.type_transaction || 'NORMAL').toUpperCase();
  const description = String(entry.description || '');
  const sourceCustomCategory = String(entry.category_custom || '');
  const attachments = getTricountAttachmentReferences_(entry.attachment);
  return {
    sourceFileId: String(file.id || ''),
    sourceFileName: String(file.name || ''),
    sourceFolderId: String(folder.id || ''),
    sourceFolderName: String(folder.name || ''),
    sourceRow: sourceRow,
    sourceTransactionId: String(entry.uuid || entry.id || ''),
    sourceNativeType: sourceNativeType,
    sourceStatus: String(entry.status || ''),
    sourceCategory: String(entry.category || ''),
    sourceCustomCategory: sourceCustomCategory,
    date: normalizeTricountDate_(entry.date),
    payer: payer,
    beneficiaries: beneficiaries,
    amount: Math.abs(sourceAmount),
    currency: currency,
    description: description,
    transactionType: mapTricountTransactionType_(sourceNativeType, description, sourceCustomCategory),
    allocations: allocations,
    exchangeRate: normalizeTricountExchangeRate_(entry.exchange_rate),
    sourceCreatedAt: String(entry.created || ''),
    sourceUpdatedAt: String(entry.updated || ''),
    attachmentFileNames: attachments.fileNames,
    attachmentUrls: attachments.urls,
    sourceFingerprint: 'tricount:' + String(entry.uuid || entry.id || '')
  };
}

function getTricountAttachmentReferences_(attachments) {
  const fileNames = [];
  const urls = [];
  (attachments || []).forEach(function (attachment) {
    if (attachment && attachment.description) {
      fileNames.push(String(attachment.description));
    }
    (attachment && attachment.urls || []).forEach(function (entry) {
      if (entry && entry.url) {
        urls.push(String(entry.url));
      }
    });
  });
  return { fileNames: fileNames, urls: urls };
}

function normalizeTricountAllocation_(allocation) {
  const amount = getTricountMoneyAmount_(allocation && allocation.amount);
  return {
    participant: getTricountMembershipName_(allocation && allocation.membership),
    amount: Math.abs(amount),
    currency: getTricountMoneyCurrency_(allocation && allocation.amount,
      allocation && allocation.amount_local),
    type: String(allocation && allocation.type || ''),
    shareRatio: allocation && allocation.share_ratio === undefined ? null :
      (allocation && allocation.share_ratio === null ? null : Number(allocation.share_ratio))
  };
}

function getTricountMoneyAmount_(money) {
  const amount = Number(money && money.value);
  if (!isFinite(amount)) {
    throw new Error('A Tricount entry contains an invalid monetary amount.');
  }
  return amount;
}

function getTricountMoneyCurrency_(primary, fallback) {
  return String((primary && primary.currency) || (fallback && fallback.currency) || 'EUR').toUpperCase();
}

function getTricountMembershipName_(membership) {
  const member = membership && membership.RegistryMembershipNonUser;
  return String(member && member.alias && member.alias.display_name || '').trim();
}

function normalizeTricountDate_(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    throw new Error('A Tricount entry contains an invalid transaction date.');
  }
  return match[1];
}

function normalizeTricountExchangeRate_(value) {
  if (value === undefined || value === null || value === '') {
    return 1;
  }
  const exchangeRate = Number(value);
  if (!isFinite(exchangeRate)) {
    throw new Error('A Tricount entry contains an invalid exchange rate.');
  }
  return exchangeRate;
}

function mapTricountTransactionType_(sourceNativeType, description, customCategory) {
  if (sourceNativeType !== 'BALANCE') {
    return 'expense';
  }
  const marker = String(description || '') + ' ' + String(customCategory || '');
  return /\bbilancio\b/i.test(marker) ? 'opening_balance' : 'transfer';
}

/** Builds exact debt/credit deltas from the Tricount allocation amounts. */
function buildExactBalanceDeltas_(record) {
  const balances = {};
  const names = {};
  const add = function (name, amount) {
    const normalized = normalizeParticipantName_(name);
    if (!normalized) {
      return;
    }
    names[normalized] = String(name).trim();
    balances[normalized] = Number(balances[normalized] || 0) + Number(amount || 0);
  };
  add(record && record.payer, Number(record && record.amount || 0));
  (record && record.allocations || []).forEach(function (allocation) {
    add(allocation.participant, -Number(allocation.amount || 0));
  });
  return Object.keys(balances).sort(function (left, right) {
    return names[left].localeCompare(names[right]);
  }).map(function (key) {
    return { name: names[key], amount: roundBalanceAmount_(balances[key]) };
  }).filter(function (entry) { return Math.abs(entry.amount) > 0.000001; });
}

function serializeTricountAllocations_(allocations) {
  return JSON.stringify((allocations || []).map(function (allocation) {
    return {
      participant: String(allocation.participant || ''),
      amount: Number(allocation.amount || 0),
      currency: String(allocation.currency || '').toUpperCase(),
      type: String(allocation.type || ''),
      shareRatio: allocation.shareRatio === undefined ? null : allocation.shareRatio
    };
  }));
}

function parseStoredAllocations_(value) {
  try {
    const allocations = JSON.parse(String(value || '[]'));
    return Array.isArray(allocations) ? allocations : [];
  } catch (error) {
    return [];
  }
}

function buildTransactionFingerprint_(row) {
  const parts = [row.date, row.amount, row.currency, row.description, row.payer, row.beneficiaries]
    .map(normalizeFingerprintPart_);
  return sha256_(parts.join('|'));
}

function buildSourceTransactionFingerprint_(sourceRow) {
  const row = sourceRow || {};
  const parts = Object.keys(row).filter(function (key) {
    return key !== '__sourceRow';
  }).sort().map(function (key) {
    return normalizeFingerprintPart_(key) + '=' + normalizeFingerprintPart_(row[key]);
  });
  return sha256_(parts.join('|'));
}

function buildFingerprintTokens_(row) {
  const tokens = ['canonical:' + buildTransactionFingerprint_(row)];
  if (row && row.sourceFingerprint) {
    tokens.unshift('source:' + String(row.sourceFingerprint));
  }
  return tokens;
}

function parseStoredFingerprintTokens_(value) {
  const stored = String(value || '').trim();
  if (!stored) {
    return [];
  }
  if (stored.indexOf(':') < 0) {
    return ['canonical:' + stored];
  }
  return stored.split('|').filter(Boolean);
}

function normalizeFingerprintPart_(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function sha256_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function partitionIncomingRows_(incoming, existing) {
  const fingerprints = {};
  const incomingSourceFingerprints = {};
  (existing || []).forEach(function (row) {
    parseStoredFingerprintTokens_(row.fingerprint).forEach(function (token) {
      fingerprints[token] = true;
    });
  });
  const unique = [];
  const duplicates = [];
  (incoming || []).forEach(function (row) {
    const tokens = buildFingerprintTokens_(row);
    const sourceToken = tokens.find(function (token) { return token.indexOf('source:') === 0; });
    const duplicateToken = tokens.find(function (token) { return fingerprints[token]; }) ||
      (sourceToken && incomingSourceFingerprints[sourceToken] ? sourceToken : '');
    if (duplicateToken) {
      duplicates.push({ row: row, fingerprint: duplicateToken,
        reason: fingerprints[duplicateToken] ? 'existing_fingerprint' : 'incoming_source_fingerprint' });
      return;
    }
    unique.push(Object.assign({}, row, { fingerprint: tokens.join('|') }));
    if (sourceToken) {
      incomingSourceFingerprints[sourceToken] = true;
    }
  });
  return { unique: unique, duplicates: duplicates };
}

/**
 * Reconciles each source JSON document against the durable import decisions made for
 * every row. This deliberately uses source facts only, independently from
 * participant-balance reporting.
 */
function buildSourceReconciliations_(sourceRecords, partition, imported, sourceFiles) {
  const files = {};
  const grouped = {};
  (sourceFiles || []).forEach(function (file) {
    const sourceFileId = String(file.id || '');
    files[sourceFileId] = {
      sourceFileId: String(file.id || ''), sourceFileName: String(file.name || ''),
      sourceContentHash: String(file.contentHash || '')
    };
    grouped[sourceFileId] = Object.assign({}, files[sourceFileId], { records: [] });
  });
  const importedRows = {};
  (imported || []).forEach(function (record) {
    importedRows[buildSourceRowKey_(record)] = true;
  });
  const duplicates = {};
  ((partition && partition.duplicates) || []).forEach(function (entry) {
    duplicates[buildSourceRowKey_(entry.row)] = String(entry.reason || 'duplicate');
  });
  (sourceRecords || []).forEach(function (record) {
    const sourceFileId = String(record.sourceFileId || '');
    const metadata = files[sourceFileId] || {
      sourceFileId: sourceFileId,
      sourceFileName: String(record.sourceFileName || ''),
      sourceContentHash: ''
    };
    if (!grouped[sourceFileId]) {
      grouped[sourceFileId] = Object.assign({}, metadata, { records: [] });
    }
    grouped[sourceFileId].records.push(record);
  });
  return Object.keys(grouped).map(function (sourceFileId) {
    const group = grouped[sourceFileId];
    const sourceTotals = {};
    const accountedTotals = {};
    const counts = { imported: 0, duplicate: 0, openingBalance: 0, unaccounted: 0 };
    const decisions = group.records.map(function (record) {
      const key = buildSourceRowKey_(record);
      let status = 'unaccounted';
      let reason = '';
      if (isOpeningBalanceRecord_(record)) {
        status = 'opening_balance';
      } else if (duplicates[key]) {
        status = 'duplicate';
        reason = duplicates[key];
      } else if (importedRows[key]) {
        status = 'imported';
      }
      const currency = String(record.currency || '').toUpperCase();
      const amount = Number(record.amount);
      addReconciliationAmount_(sourceTotals, currency, amount);
      if (status === 'imported') {
        counts.imported += 1;
      } else if (status === 'duplicate') {
        counts.duplicate += 1;
      } else if (status === 'opening_balance') {
        counts.openingBalance += 1;
      } else {
        counts.unaccounted += 1;
      }
      if (status !== 'unaccounted') {
        addReconciliationAmount_(accountedTotals, currency, amount);
      }
      return {
        sourceRow: Number(record.sourceRow) || 0,
        status: status,
        amount: amount,
        currency: currency,
        reason: reason
      };
    }).sort(function (left, right) { return left.sourceRow - right.sourceRow; });
    const totalsMatch = haveMatchingReconciliationTotals_(sourceTotals, accountedTotals);
    return {
      sourceFileId: group.sourceFileId,
      sourceFileName: group.sourceFileName,
      sourceContentHash: group.sourceContentHash,
      sourceRows: group.records.length,
      importedRows: counts.imported,
      duplicateRows: counts.duplicate,
      openingBalanceRows: counts.openingBalance,
      unaccountedRows: counts.unaccounted,
      sourceTotals: sourceTotals,
      accountedTotals: accountedTotals,
      status: counts.unaccounted === 0 && totalsMatch ? 'OK' : 'UNRECONCILED',
      decisions: decisions
    };
  }).sort(function (left, right) {
    return left.sourceFileName.localeCompare(right.sourceFileName) ||
      left.sourceFileId.localeCompare(right.sourceFileId);
  });
}

function buildSourceRowKey_(record) {
  return [String(record && record.sourceFileId || ''), Number(record && record.sourceRow || 0)].join('|');
}

function addReconciliationAmount_(totals, currency, amount) {
  const key = String(currency || '').toUpperCase();
  totals[key] = Number(totals[key] || 0) + Number(amount || 0);
  totals[key] = Math.round(totals[key] * 100000000) / 100000000;
}

function haveMatchingReconciliationTotals_(expected, actual) {
  const currencies = Object.keys(expected || {}).concat(Object.keys(actual || {}))
    .filter(function (currency, index, values) { return values.indexOf(currency) === index; });
  return currencies.every(function (currency) {
    return Math.abs(Number(expected[currency] || 0) - Number(actual[currency] || 0)) < 0.000001;
  });
}

function isOpeningBalanceRecord_(record) {
  return String(record && record.transactionType || '') === 'opening_balance';
}

function splitBeneficiaryNames_(value) {
  return String(value || '').split(/[;,]/).map(function (name) {
    return name.trim();
  }).filter(function (name) {
    return name.length > 0;
  });
}

function normalizeParticipantName_(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function addParticipantBalance_(balances, names, name, amount) {
  const normalized = normalizeParticipantName_(name);
  if (!normalized) {
    return;
  }
  if (!balances[normalized]) {
    balances[normalized] = { name: String(name).trim(), amount: 0 };
  }
  balances[normalized].amount += Number(amount);
  names[normalized] = balances[normalized].name;
}

function buildBalanceVector_(records, options) {
  const balances = {};
  const names = {};
  let recordCount = 0;
  const cutoffDate = String(options.cutoffDate || '');
  const currency = String(options.currency || '').toUpperCase();
  (records || []).forEach(function (record) {
    if (isOpeningBalanceRecord_(record) || String(record.date || '') >= cutoffDate ||
      String(record.currency || '').toUpperCase() !== currency) {
      return;
    }
    if (!isFinite(Number(record.amount))) {
      return;
    }
    recordCount += 1;
    const deltas = Array.isArray(record.allocations) && record.allocations.length > 0 ?
      buildExactBalanceDeltas_(record) : buildLegacyBalanceDeltas_(record);
    deltas.forEach(function (delta) {
      addParticipantBalance_(balances, names, delta.name, delta.amount);
    });
  });
  return { balances: balances, names: names, recordCount: recordCount };
}

function buildLegacyBalanceDeltas_(record) {
  const amount = Number(record.amount);
  const deltas = [{ name: record.payer, amount: amount }];
  const beneficiaries = splitBeneficiaryNames_(record.beneficiaries);
  const share = beneficiaries.length > 0 ? amount / beneficiaries.length : 0;
  beneficiaries.forEach(function (beneficiary) {
    deltas.push({ name: beneficiary, amount: -share });
  });
  return deltas;
}

function findOpeningBalanceAnchor_(openingRecord, openingBalanceMarkers) {
  const currency = String(openingRecord.currency || '').toUpperCase();
  const date = String(openingRecord.date || '');
  return (openingBalanceMarkers || []).filter(function (marker) {
    return String(marker.date || '') < date &&
      String(marker.currency || '').toUpperCase() === currency;
  }).sort(function (left, right) {
    return String(right.date || '').localeCompare(String(left.date || ''));
  })[0] || null;
}

function evaluateOpeningBalance_(openingRecord, historicalRecords, tolerance, openingBalanceMarkers) {
  const expected = buildBalanceVector_([Object.assign({}, openingRecord, {
    date: '0000-01-01', transactionType: 'transfer'
  })], { cutoffDate: '9999-12-31', currency: openingRecord.currency });
  const anchor = findOpeningBalanceAnchor_(openingRecord, openingBalanceMarkers);
  const recordsSinceAnchor = (historicalRecords || []).filter(function (record) {
    return !anchor || String(record.date || '') >= String(anchor.date || '');
  });
  const recordsToCheck = (anchor ? [Object.assign({}, anchor, { transactionType: 'transfer' })] : [])
    .concat(recordsSinceAnchor);
  const actual = buildBalanceVector_(recordsToCheck, {
    cutoffDate: openingRecord.date,
    currency: openingRecord.currency
  });
  const participantKeys = {};
  Object.keys(expected.balances).concat(Object.keys(actual.balances)).forEach(function (key) {
    participantKeys[key] = true;
  });
  const differences = Object.keys(participantKeys).sort().map(function (key) {
    const expectedAmount = expected.balances[key] ? expected.balances[key].amount : 0;
    const actualAmount = actual.balances[key] ? actual.balances[key].amount : 0;
    return {
      name: (actual.names[key] || expected.names[key] || key),
      expected: roundBalanceAmount_(expectedAmount),
      actual: roundBalanceAmount_(actualAmount),
      difference: roundBalanceAmount_(actualAmount - expectedAmount)
    };
  });
  const maxDifference = differences.reduce(function (maximum, entry) {
    return Math.max(maximum, Math.abs(entry.difference));
  }, 0);
  const status = actual.recordCount === 0 ? 'unverifiable' :
    (maxDifference <= Number(tolerance || 0.01) ? 'matched' : 'mismatch');
  return {
    record: openingRecord,
    status: status,
    matched: status === 'matched',
    currency: String(openingRecord.currency || '').toUpperCase(),
    anchor: anchor ? {
      date: anchor.date,
      sourceFileId: anchor.sourceFileId || '',
      sourceRow: anchor.sourceRow || ''
    } : null,
    differences: differences
  };
}

function roundBalanceAmount_(amount) {
  const numeric = Number(amount);
  if (!isFinite(numeric)) {
    return 0;
  }
  const roundedCents = Math.floor(Math.abs(numeric) * 100 + 0.5 + 1e-9);
  return (numeric < 0 ? -roundedCents : roundedCents) / 100;
}

function deriveArchiveYear_(rows) {
  const years = (rows || []).map(function (row) { return String(row.date || '').slice(0, 4); })
    .filter(function (year) { return /^\d{4}$/.test(year); });
  return years.sort()[0] || String(new Date().getFullYear());
}
