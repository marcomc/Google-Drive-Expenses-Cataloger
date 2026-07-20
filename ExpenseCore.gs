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

function isUnspecifiedMerchant_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || ['unknown', 'n/a', 'na', 'none', 'null', '-'].indexOf(normalized) >= 0;
}

function inferMerchantFallback_(description, category, subcategory) {
  const text = [description, category, subcategory].join(' ').toLowerCase();
  if (/\b(delia|sigari?|sigarette|tabacco)\b/.test(text)) {
    return 'Tabaccheria';
  }
  if (/\bfarmaco\s+veterinari|\bmedicin[ae]\s+(per\s+)?cani/.test(text)) {
    return 'Farmacia veterinaria';
  }
  if (/\bveterinari|\bforasacchi\b/.test(text)) {
    return 'Veterinario';
  }
  if (/\bmetano\b/.test(text)) {
    return 'Distributore di metano';
  }
  if (/\bcarburante|\bbenzina|\bdiesel\b/.test(text)) {
    return 'Distributore di carburante';
  }
  if (/\bterapi[ae]\b|\bpsicoterapi/.test(text)) {
    return 'Studio di psicoterapia';
  }
  if (/\btatuagg/.test(text)) {
    return 'Studio tatuaggi';
  }
  if (/\bcondominial/.test(text)) {
    return 'Condominio';
  }
  if (/\blavaggio\s+(auto|macchina)|\bautolavaggio/.test(text)) {
    return 'Autolavaggio';
  }
  if (/\b(colazione|aperitiv\w*|merenda\s+al\s+bar|caff[eè])\b/.test(text)) {
    return 'Bar';
  }
  if (/\bpiadine\b/.test(text)) {
    return 'Piadineria';
  }
  if (/\b(pranzo|cena)\b/.test(text)) {
    return 'Ristorante';
  }
  return '';
}

function resolveMerchant_(merchant, description, category, subcategory) {
  const value = String(merchant || '').trim();
  return isUnspecifiedMerchant_(value) ?
    inferMerchantFallback_(description, category, subcategory) : value;
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
  const sourceNativeType = String(entry.type_transaction || 'NORMAL').toUpperCase();
  const sourceAmount = normalizeTricountLedgerAmount_(entry.amount, sourceNativeType);
  const currency = getTricountMoneyCurrency_(entry.amount, entry.amount_local);
  const allocations = (entry.allocations || []).map(function (allocation) {
    return normalizeTricountAllocation_(allocation, sourceNativeType);
  });
  const payer = getTricountMembershipName_(entry.membership_owned);
  const beneficiaries = allocations.map(function (allocation) {
    return allocation.participant;
  }).filter(Boolean).join(', ');
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
    amount: sourceAmount,
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

function normalizeTricountLedgerAmount_(money, sourceNativeType) {
  const amount = Math.abs(getTricountMoneyAmount_(money));
  // Tricount serializes expenses as negative amounts and incoming money as
  // positive amounts. Canonical ledger convention is the converse: expenses
  // are positive, whereas income and refunds are negative so their balance
  // effects are not reversed by the payer-minus-allocation calculation.
  return String(sourceNativeType || '').toUpperCase() === 'INCOME' ? -amount : amount;
}

function normalizeTricountAllocation_(allocation, sourceNativeType) {
  const amount = normalizeTricountLedgerAmount_(allocation && allocation.amount, sourceNativeType);
  return {
    participant: getTricountMembershipName_(allocation && allocation.membership),
    amount: amount,
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
  const nativeType = String(sourceNativeType || '').toUpperCase();
  const marker = String(description || '') + ' ' + String(customCategory || '');
  if (/\bbilancio\s+in(?:izio|\s+io)\s+mese\b/i.test(marker)) {
    return 'opening_balance';
  }
  if (/\bbilancio\s+fine\s+mese\b/i.test(marker)) {
    return 'closing_balance';
  }
  if (nativeType === 'INCOME') {
    return 'income';
  }
  // Tricount has exported cash settlements both as BALANCE and as NORMAL
  // entries with the custom category "Contanti". Both settle a debt between
  // participants: preserve them in the ledger and balance calculation, but
  // never treat them as household spending.
  if (nativeType === 'BALANCE' || isTricountCashSettlementCategory_(customCategory)) {
    return 'transfer';
  }
  if (nativeType === 'INCOME') {
    return 'income';
  }
  return 'expense';
}

function isTricountCashSettlementCategory_(customCategory) {
  return /\b(contanti|cash|trasferiment[oi]|transfer)\b/i.test(String(customCategory || ''));
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
    // Keep source allocation precision through the full balance computation.
    // Values are rounded only at persisted/display boundaries, otherwise small
    // fractional splits accumulate into artificial month-end mismatches.
    return { name: names[key], amount: balances[key] };
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
      } else if (isClosingBalanceRecord_(record)) {
        status = 'closing_balance';
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
      } else if (status === 'closing_balance') {
        // Closing-balance markers are intentionally ignored by the ledger, but
        // they are still fully accounted for in the source reconciliation.
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

function isClosingBalanceRecord_(record) {
  return String(record && record.transactionType || '') === 'closing_balance';
}

function isBalanceControlRecord_(record) {
  return isOpeningBalanceRecord_(record) || isClosingBalanceRecord_(record);
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

/** Return a stable display name for merchants and suppliers. */
function normalizeMerchantName_(value) {
  const source = String(value || '').trim().replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');
  if (!source) {
    return '';
  }
  return source.split('-').map(function (hyphenPart) {
    return hyphenPart.split(' ').map(function (word) {
      const lower = word.toLocaleLowerCase();
      return lower ? lower.charAt(0).toLocaleUpperCase() + lower.slice(1) : '';
    }).join(' ');
  }).join('-');
}

/** Normalize one-column ledger values and report case variants that collapse. */
function normalizeMerchantValues_(values) {
  const variants = {};
  let changedRows = 0;
  const normalizedValues = (values || []).map(function (row) {
    const original = String(row && row[0] || '');
    const normalized = normalizeMerchantName_(original);
    if (original !== normalized) {
      changedRows += 1;
    }
    if (original && normalized) {
      variants[normalized] = variants[normalized] || [];
      if (variants[normalized].indexOf(original) < 0) {
        variants[normalized].push(original);
      }
    }
    return [normalized];
  });
  return {
    values: normalizedValues,
    changedRows: changedRows,
    variantGroups: Object.keys(variants).map(function (normalized) {
      return { normalized: normalized, variants: variants[normalized].sort() };
    }).filter(function (group) { return group.variants.length > 1; })
      .sort(function (left, right) { return left.normalized.localeCompare(right.normalized); })
  };
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
    if (isBalanceControlRecord_(record) || String(record.date || '') >= cutoffDate ||
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

function getOpeningBalanceRecordsFromCheck_(check) {
  const records = Array.isArray(check && check.records) ? check.records : [check && check.record];
  return records.map(normalizeStoredBalanceControlRecord_).filter(function (record) {
    return record && record.date && record.currency &&
      (!record.transactionType || isOpeningBalanceRecord_(record));
  });
}

function normalizeStoredBalanceControlRecord_(record) {
  if (!record || (!record.sourceNativeType && !record.sourceCustomCategory)) {
    return record;
  }
  const transactionType = mapTricountTransactionType_(record.sourceNativeType, record.description,
    record.sourceCustomCategory);
  return Object.assign({}, record, { transactionType: transactionType });
}

function getHistoricalBalanceTransferCandidates_(checks) {
  const selected = {};
  (checks || []).flatMap(function (check) {
    const records = Array.isArray(check && check.records) ? check.records : [check && check.record];
    return records || [];
  }).map(normalizeStoredBalanceControlRecord_).filter(function (record) {
    return record && String(record.sourceNativeType || '').toUpperCase() === 'BALANCE' &&
      String(record.transactionType || '') === 'transfer';
  }).forEach(function (record) {
    const key = String(record.sourceFingerprint || '') ||
      [record.sourceFileId, record.sourceRow].join('|');
    if (key && !selected[key]) {
      selected[key] = record;
    }
  });
  return Object.keys(selected).sort().map(function (key) { return selected[key]; });
}

function uniqueOpeningBalanceRecords_(records) {
  const selected = {};
  (records || []).forEach(function (record) {
    if (!record || !record.date || !record.currency) {
      return;
    }
    // CSV and JSON exports of the same monthly carry-over are distinct Drive
    // records but one economic checkpoint. Prefer the richer JSON record.
    const allocationKey = (record.allocations || []).map(function (allocation) {
      return [normalizeParticipantName_(allocation.participant),
        roundBalanceAmount_(Number(allocation.amount))].join(':');
    }).sort().join(',');
    const baseKey = [record.date, String(record.currency).toUpperCase(), normalizeParticipantName_(record.payer),
      roundBalanceAmount_(Math.abs(Number(record.amount))), allocationKey].join('|');
    const sourceTransactionId = String(record.sourceTransactionId || '');
    let key = baseKey;
    if (selected[key] && sourceTransactionId && selected[key].sourceTransactionId &&
      sourceTransactionId !== String(selected[key].sourceTransactionId)) {
      key += '|source:' + sourceTransactionId;
    }
    const current = selected[key];
    const quality = (Array.isArray(record.allocations) && record.allocations.length > 0 ? 2 : 0) +
      (record.sourceTransactionId ? 1 : 0);
    const currentQuality = current ? (Array.isArray(current.allocations) && current.allocations.length > 0 ? 2 : 0) +
      (current.sourceTransactionId ? 1 : 0) : -1;
    if (!current || quality > currentQuality) {
      selected[key] = record;
    }
  });
  return Object.keys(selected).map(function (key) { return selected[key]; });
}

function groupOpeningBalanceRecords_(records) {
  const grouped = {};
  uniqueOpeningBalanceRecords_(records).forEach(function (record) {
    const key = String(record.date) + '|' + String(record.currency).toUpperCase();
    if (!grouped[key]) {
      grouped[key] = { date: String(record.date), currency: String(record.currency).toUpperCase(), records: [] };
    }
    grouped[key].records.push(record);
  });
  return Object.keys(grouped).map(function (key) { return grouped[key]; }).sort(function (left, right) {
    return left.date.localeCompare(right.date) || left.currency.localeCompare(right.currency);
  });
}

function buildOpeningBalanceVector_(records, currency) {
  return buildBalanceVector_((records || []).map(function (record) {
    return Object.assign({}, record, { date: '0000-01-01', transactionType: 'transfer' });
  }), { cutoffDate: '9999-12-31', currency: currency });
}

function findOpeningBalanceAnchor_(openingRecord, openingBalanceMarkers) {
  const currency = String(openingRecord.currency || '').toUpperCase();
  const date = String(openingRecord.date || '');
  const anchors = (openingBalanceMarkers || []).filter(function (marker) {
    return String(marker.date || '') < date &&
      String(marker.currency || '').toUpperCase() === currency;
  }).sort(function (left, right) {
    return String(right.date || '').localeCompare(String(left.date || ''));
  });
  if (anchors.length === 0) {
    return null;
  }
  const anchorDate = String(anchors[0].date || '');
  return { date: anchorDate, records: anchors.filter(function (marker) {
    return String(marker.date || '') === anchorDate;
  }) };
}

function evaluateOpeningBalanceGroup_(openingRecords, historicalRecords, tolerance, openingBalanceMarkers) {
  const records = uniqueOpeningBalanceRecords_(openingRecords);
  if (records.length === 0) {
    throw new Error('An opening-balance check requires at least one valid record.');
  }
  const openingRecord = records[0];
  const expected = buildOpeningBalanceVector_(records, openingRecord.currency);
  const anchor = findOpeningBalanceAnchor_(openingRecord, openingBalanceMarkers);
  const recordsSinceAnchor = (historicalRecords || []).filter(function (record) {
    return !anchor || String(record.date || '') >= String(anchor.date || '');
  });
  const recordsToCheck = (anchor ? anchor.records.map(function (record) {
    return Object.assign({}, record, { transactionType: 'transfer' });
  }) : [])
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
    record: openingRecord, records: records,
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

function evaluateOpeningBalance_(openingRecord, historicalRecords, tolerance, openingBalanceMarkers) {
  return evaluateOpeningBalanceGroup_([openingRecord], historicalRecords, tolerance, openingBalanceMarkers);
}

function evaluateOpeningBalanceGroups_(openingRecords, historicalRecords, tolerance, openingBalanceMarkers) {
  const markers = uniqueOpeningBalanceRecords_(openingBalanceMarkers);
  return groupOpeningBalanceRecords_(openingRecords).map(function (group) {
    const check = evaluateOpeningBalanceGroup_(group.records, historicalRecords, tolerance, markers);
    group.records.forEach(function (record) { markers.push(record); });
    return check;
  });
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
