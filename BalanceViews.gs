/** Rebuilds the derived per-participant balance sheets from the canonical ledger. */
function refreshBalanceViews() {
  assertCatalogConfiguration_();
  const spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  const layout = getExpenseSheetLayout_(spreadsheet);
  const sortedRows = sortLedgerTransactions_(layout);
  refreshBalanceViews_(spreadsheet);
  const localization = getLocalization_();
  buildDashboard_(spreadsheet.getSheetByName(localization.sheetNames.dashboard),
    spreadsheet.getSheetByName(localization.sheetNames.transactions), localization);
  applyInstallerSpreadsheetPresentation_(spreadsheet, localization);
  orderInstallerSheets_(spreadsheet, localization);
  return { status: 'REFRESHED', sortedRows: sortedRows };
}

function refreshBalanceViews_(spreadsheet) {
  const localization = getLocalization_();
  const transactions = ensureInstallerSheet_(spreadsheet, localization.sheetNames.transactions,
    getInstallerTransactionHeaders_(localization));
  const movementsSheet = ensureInstallerSheet_(spreadsheet, localization.sheetNames.balanceMovements,
    getBalanceMovementHeaders_(localization));
  const monthlySheet = ensureInstallerSheet_(spreadsheet, localization.sheetNames.monthlyBalances,
    getMonthlyBalanceHeaders_(localization));
  const configuration = ensureInstallerSheet_(spreadsheet, localization.sheetNames.configuration,
    ['Category', 'Subcategory']);
  const headers = transactions.getRange(1, 1, 1, transactions.getLastColumn()).getValues()[0];
  const imports = spreadsheet.getSheetByName(localization.sheetNames.imports);
  backfillOpeningBalanceAuditDetails_(imports);
  const checks = getRecordedOpeningBalanceChecks_(imports);
  normalizeExistingLedgerMerchants_(transactions, headers, localization);
  normalizeExistingLedgerTransactionTypes_(transactions, headers, localization);
  backfillMissingLedgerAllocations_(transactions, headers, localization);
  const ledgerRecords = readLedgerBalanceViewRecords_(transactions, headers, localization);
  const initialBalances = synchronizeInitialBalanceConfiguration_(configuration, localization, checks,
    ledgerRecords);
  const initialOpeningGroups = getInitialOpeningBalanceGroupKeys_(checks, ledgerRecords);
  const checkpointAdjustments = buildCheckpointRoundingAdjustments_(ledgerRecords, initialBalances, checks,
    localization, initialOpeningGroups);
  const movements = buildBalanceMovementRows_(ledgerRecords.concat(checkpointAdjustments), initialBalances,
    localization);
  writeDerivedBalanceSheet_(movementsSheet, getBalanceMovementHeaders_(localization), movements.rows,
    localization.balanceDescriptions.allocationNote);
  writeDerivedBalanceSheet_(monthlySheet, getMonthlyBalanceHeaders_(localization),
    buildMonthlyBalanceRows_(movements, checks, initialOpeningGroups).rows,
    localization.balanceDescriptions.monthlyNote);
  refreshTransactionBalanceImpactLabels_(transactions, headers, ledgerRecords, localization);
}

function normalizeExistingLedgerMerchants_(sheet, headers, localization) {
  if (sheet.getLastRow() < 2) {
    return 0;
  }
  const names = localization.headers;
  const merchantColumn = headers.indexOf(names.merchant);
  const descriptionColumn = headers.indexOf(names.description);
  const categoryColumn = headers.indexOf(names.category);
  const subcategoryColumn = headers.indexOf(names.subcategory);
  if ([merchantColumn, descriptionColumn, categoryColumn, subcategoryColumn].some(function (column) {
    return column < 0;
  })) {
    return 0;
  }
  const rowCount = sheet.getLastRow() - 1;
  const rows = sheet.getRange(2, 1, rowCount, headers.length).getValues();
  let changed = 0;
  const merchants = rows.map(function (row) {
    const current = row[merchantColumn];
    const resolved = resolveMerchant_(current, row[descriptionColumn], row[categoryColumn],
      row[subcategoryColumn]);
    if (String(current || '').trim() !== resolved) {
      changed += 1;
    }
    return [resolved];
  });
  if (changed > 0) {
    sheet.getRange(2, merchantColumn + 1, rowCount, 1).setValues(merchants);
  }
  return changed;
}

/**
 * Repairs historic rows using only immutable Tricount source metadata. This is
 * deliberately conservative: rows without source type/category metadata are
 * left untouched rather than guessed from their human description.
 */
function normalizeExistingLedgerTransactionTypes_(sheet, headers, localization) {
  if (sheet.getLastRow() < 2) {
    return 0;
  }
  const names = localization.headers;
  const typeColumn = headers.indexOf(names.transactionType);
  const sourceTypeColumn = headers.indexOf(names.sourceNativeType);
  const sourceCustomCategoryColumn = headers.indexOf(names.sourceCustomCategory);
  const descriptionColumn = headers.indexOf(names.description);
  if ([typeColumn, sourceTypeColumn, sourceCustomCategoryColumn, descriptionColumn]
    .some(function (column) { return column < 0; })) {
    return 0;
  }
  const rowCount = sheet.getLastRow() - 1;
  const rows = sheet.getRange(2, 1, rowCount, headers.length).getValues();
  let changed = 0;
  const types = rows.map(function (row) {
    const current = String(row[typeColumn] || 'expense');
    const sourceType = String(row[sourceTypeColumn] || '').trim();
    const customCategory = String(row[sourceCustomCategoryColumn] || '').trim();
    if (!sourceType && !customCategory) {
      return [current];
    }
    const normalized = mapTricountTransactionType_(sourceType, row[descriptionColumn], customCategory);
    if (normalized !== current) {
      changed += 1;
    }
    return [normalized];
  });
  if (changed > 0) {
    sheet.getRange(2, typeColumn + 1, rowCount, 1).setValues(types);
  }
  return changed;
}

/** Restores immutable Tricount allocations omitted by an older ledger schema. */
function backfillMissingLedgerAllocations_(sheet, headers, localization) {
  if (sheet.getLastRow() < 2) {
    return { filled: 0, missing: 0 };
  }
  const names = localization.headers;
  const required = [names.date, names.currency, names.payer, names.amount, names.description,
    names.sourceFile, names.sourceRow, names.sourceTransactionId, names.allocationDetails];
  const columns = {};
  required.forEach(function (name) {
    const index = headers.indexOf(name);
    if (index < 0) {
      throw new Error('The ledger is missing allocation-backfill column: ' + name);
    }
    columns[name] = index;
  });
  const rowCount = sheet.getLastRow() - 1;
  const rows = sheet.getRange(2, 1, rowCount, headers.length).getValues();
  const pendingByFile = {};
  const allocationValues = rows.map(function (row, index) {
    const current = String(row[columns[names.allocationDetails]] || '').trim();
    if (current) {
      return [current];
    }
    const sourceFileId = getDriveFileIdFromUrl_(row[columns[names.sourceFile]]);
    const sourceTransactionId = String(row[columns[names.sourceTransactionId]] || '');
    const sourceRow = Number(row[columns[names.sourceRow]]) || 0;
    if (!sourceFileId || (!sourceTransactionId && !sourceRow)) {
      return [''];
    }
    if (!pendingByFile[sourceFileId]) {
      pendingByFile[sourceFileId] = [];
    }
    pendingByFile[sourceFileId].push({
      index: index, row: row, sourceTransactionId: sourceTransactionId, sourceRow: sourceRow
    });
    return [''];
  });
  let filled = 0;
  Object.keys(pendingByFile).forEach(function (sourceFileId) {
    try {
      const file = DriveApp.getFileById(sourceFileId);
      if (!isTricountJsonFileName_(file.getName())) {
        return;
      }
      const records = parseTricountJsonExport_(JSON.parse(file.getBlob().getDataAsString()), {
        id: sourceFileId, name: file.getName()
      }, { id: '', name: '' });
      const byTransactionId = {};
      const bySourceRow = {};
      records.forEach(function (record) {
        byTransactionId[String(record.sourceTransactionId || '')] = record;
        bySourceRow[Number(record.sourceRow) || 0] = record;
      });
      pendingByFile[sourceFileId].forEach(function (pending) {
        const source = findSourceRecordForLedgerBackfill_(pending, byTransactionId, bySourceRow);
        if (!source || !isMatchingLedgerSourceRecord_(pending.row, source, columns, names)) {
          return;
        }
        allocationValues[pending.index] = [serializeTricountAllocations_(source.allocations)];
        filled += 1;
      });
    } catch (error) {
      console.warn('Cannot restore Tricount allocations from ' + sourceFileId + ': ' + error.message);
    }
  });
  const unresolved = Object.keys(pendingByFile).some(function (sourceFileId) {
    return pendingByFile[sourceFileId].some(function (pending) {
      return !allocationValues[pending.index][0];
    });
  });
  const archivedIndex = unresolved ? buildArchivedTricountAllocationIndex_() : {};
  Object.keys(pendingByFile).forEach(function (sourceFileId) {
    pendingByFile[sourceFileId].forEach(function (pending) {
      if (allocationValues[pending.index][0]) {
        return;
      }
      const source = findArchivedSourceRecordForLedgerBackfill_(pending.row, columns, names, archivedIndex);
      if (source) {
        allocationValues[pending.index] = [serializeTricountAllocations_(source.allocations)];
        filled += 1;
      }
    });
  });
  if (filled > 0) {
    sheet.getRange(2, columns[names.allocationDetails] + 1, rowCount, 1).setValues(allocationValues);
  }
  const pending = Object.keys(pendingByFile).reduce(function (count, key) {
    return count + pendingByFile[key].length;
  }, 0);
  return { filled: filled, missing: pending - filled };
}

function buildArchivedTricountAllocationIndex_() {
  const root = DriveApp.getFolderById(getRootFolderId_());
  const archive = getExistingArchiveFolder_(root, getAutomationConfig_());
  const index = {};
  if (!archive) {
    return index;
  }
  listJsonFilesRecursively_(archive).filter(function (file) {
    return isTricountJsonFileName_(file.getName());
  }).forEach(function (file) {
    try {
      const records = parseTricountJsonExport_(JSON.parse(file.getBlob().getDataAsString()), {
        id: file.getId(), name: file.getName()
      }, { id: '', name: '' });
      records.forEach(function (record) {
        const key = buildLedgerAllocationMatchKey_(record.date, record.currency, record.payer,
          record.amount, record.description);
        if (!index[key]) {
          index[key] = [];
        }
        index[key].push(record);
      });
    } catch (error) {
      console.warn('Cannot index archived Tricount JSON ' + file.getId() + ': ' + error.message);
    }
  });
  return index;
}

function buildLedgerAllocationMatchKey_(date, currency, payer, amount, description) {
  return [String(date || ''), String(currency || '').toUpperCase(), normalizeParticipantName_(payer),
    roundBalanceAmount_(Math.abs(Number(amount))), String(description || '').trim().toLocaleLowerCase()]
    .join('|');
}

function findArchivedSourceRecordForLedgerBackfill_(ledgerRow, columns, names, index) {
  const key = buildLedgerAllocationMatchKey_(formatBalanceViewLedgerDate_(ledgerRow[columns[names.date]]),
    ledgerRow[columns[names.currency]], ledgerRow[columns[names.payer]], ledgerRow[columns[names.amount]],
    ledgerRow[columns[names.description]]);
  const candidates = index[key] || [];
  if (candidates.length === 1) {
    return candidates[0];
  }
  const sourceRow = Number(ledgerRow[columns[names.sourceRow]]) || 0;
  const rowMatches = candidates.filter(function (candidate) { return Number(candidate.sourceRow) === sourceRow; });
  return rowMatches.length === 1 ? rowMatches[0] : null;
}

function formatBalanceViewLedgerDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '').slice(0, 10);
}

function findSourceRecordForLedgerBackfill_(pending, byTransactionId, bySourceRow) {
  return (pending.sourceTransactionId && byTransactionId[pending.sourceTransactionId]) ||
    bySourceRow[pending.sourceRow] || null;
}

function getDriveFileIdFromUrl_(value) {
  const match = String(value || '').match(/(?:[?&]id=|\/d\/)([-\w]+)/);
  return match ? match[1] : '';
}

function isMatchingLedgerSourceRecord_(ledgerRow, sourceRecord, columns, names) {
  return formatLedgerDate_(ledgerRow[columns[names.date]]) === String(sourceRecord.date || '') &&
    String(ledgerRow[columns[names.currency]] || '').toUpperCase() ===
      String(sourceRecord.currency || '').toUpperCase() &&
    Math.abs(Math.abs(Number(ledgerRow[columns[names.amount]])) - Math.abs(Number(sourceRecord.amount))) <= 0.01 &&
    normalizeParticipantName_(ledgerRow[columns[names.payer]]) === normalizeParticipantName_(sourceRecord.payer);
}

function readLedgerBalanceViewRecords_(sheet, headers, localization) {
  const names = localization.headers;
  const required = [names.transactionId, names.date, names.year, names.month, names.currency,
    names.payer, names.beneficiaries, names.amount, names.description, names.transactionType,
    names.sourceFile, names.sourceRow, names.allocationDetails];
  const columns = {};
  required.forEach(function (name) {
    const index = headers.indexOf(name);
    if (index < 0) {
      throw new Error('The ledger is missing balance-view column: ' + name);
    }
    columns[name] = index;
  });
  if (sheet.getLastRow() < 2) {
    return [];
  }
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function (row) {
    return {
      id: row[columns[names.transactionId]], date: formatLedgerDate_(row[columns[names.date]]),
      year: row[columns[names.year]], month: row[columns[names.month]],
      currency: String(row[columns[names.currency]] || '').toUpperCase(),
      payer: row[columns[names.payer]], beneficiaries: row[columns[names.beneficiaries]],
      amount: Number(row[columns[names.amount]]), description: row[columns[names.description]],
      transactionType: row[columns[names.transactionType]], sourceFile: row[columns[names.sourceFile]],
      sourceRow: Number(row[columns[names.sourceRow]]) || 0,
      allocations: parseStoredAllocations_(row[columns[names.allocationDetails]])
    };
  }).filter(function (record) {
    return record.date && record.currency && isFinite(record.amount) &&
      !isOpeningBalanceRecord_(record);
  });
}

function buildParticipantBalanceDeltas_(record) {
  if (record && record.initialBalanceDelta) {
    return [record.initialBalanceDelta];
  }
  const deltas = record && Array.isArray(record.allocations) && record.allocations.length > 0 ?
    buildExactBalanceDeltas_(record) : buildLegacyBalanceDeltas_(record);
  return deltas.map(function (delta) {
    return {
      key: normalizeParticipantName_(delta.name), name: delta.name,
      amount: delta.amount
    };
  });
}

function buildBalanceImpactLabel_(record) {
  return buildParticipantBalanceDeltas_(record).map(function (delta) {
    return delta.name + ' ' + (delta.amount >= 0 ? '+' : '') + delta.amount.toFixed(2);
  }).join(' · ');
}

function sortBalanceRecords_(records) {
  return (records || []).slice().sort(function (left, right) {
    return String(left.date).localeCompare(String(right.date)) ||
      String(left.sourceFile || '').localeCompare(String(right.sourceFile || '')) ||
      Number(left.sourceRow || 0) - Number(right.sourceRow || 0) || String(left.id).localeCompare(String(right.id));
  });
}

function buildBalanceMovementRows_(records, initialBalances, localization) {
  const balances = {};
  const participantNames = {};
  const sorted = sortBalanceRecords_((records || []).concat(buildInitialBalanceRecords_(initialBalances,
    localization)));
  const rows = [];
  sorted.forEach(function (record) {
    buildParticipantBalanceDeltas_(record).forEach(function (delta) {
      const balanceKey = record.currency + '|' + delta.key;
      balances[balanceKey] = Number(balances[balanceKey] || 0) + delta.amount;
      participantNames[balanceKey] = delta.name;
      rows.push([record.id, record.date, Number(record.year), Number(record.month), record.currency,
        delta.name, delta.amount, roundBalanceAmount_(balances[balanceKey]), record.transactionType,
        record.description, record.sourceFile, record.sourceRow]);
    });
  });
  return { rows: rows, sortedRecords: sorted, participantNames: participantNames };
}

/**
 * Reconcile a cent-level Tricount carry-over without altering the canonical
 * ledger. An opening-balance control is authoritative only for a small,
 * zero-sum rounding residual; a material discrepancy remains visible as a
 * mismatch in the monthly balance sheet.
 */
function buildCheckpointRoundingAdjustments_(records, initialBalances, checks, localization, excludedOpeningGroups) {
  const tolerance = 0.25;
  const controlsByMonth = {};
  buildDeclaredMonthlyBalanceControls_(checks, excludedOpeningGroups).forEach(function (control) {
    const monthKey = String(control[0]) + '-' + String(control[1]).padStart(2, '0');
    const currency = String(control[2]).toUpperCase();
    const groupKey = monthKey + '|' + currency;
    if (!controlsByMonth[groupKey]) {
      controlsByMonth[groupKey] = [];
    }
    controlsByMonth[groupKey].push({
      participant: String(control[3]), key: normalizeParticipantName_(control[3]), amount: Number(control[4])
    });
  });
  const balances = {};
  const adjustments = [];
  const descriptions = localization && localization.balanceDescriptions ? localization.balanceDescriptions : {
    roundingAdjustment: 'Tricount checkpoint rounding alignment', checkpointSource: 'Tricount checkpoint'
  };
  const sorted = sortBalanceRecords_((records || []).concat(buildInitialBalanceRecords_(initialBalances,
    localization)));
  const monthKeys = sorted.map(function (record) { return String(record.date).slice(0, 7); })
    .concat(Object.keys(controlsByMonth).map(function (key) { return key.slice(0, 7); }))
    .filter(function (value, position, values) { return values.indexOf(value) === position; }).sort();
  let index = 0;
  monthKeys.forEach(function (monthKey) {
    while (index < sorted.length && String(sorted[index].date).slice(0, 7) === monthKey) {
      const record = sorted[index];
      buildParticipantBalanceDeltas_(record).forEach(function (delta) {
        const key = String(record.currency).toUpperCase() + '|' + delta.key;
        balances[key] = Number(balances[key] || 0) + Number(delta.amount || 0);
      });
      index += 1;
    }
    Object.keys(controlsByMonth).filter(function (groupKey) {
      return groupKey.indexOf(monthKey + '|') === 0;
    }).forEach(function (groupKey) {
      const controls = controlsByMonth[groupKey];
      const currency = groupKey.split('|')[1];
      const deltas = controls.map(function (control) {
        return {
          participant: control.participant,
          key: control.key,
          amount: roundBalanceAmount_(control.amount - Number(balances[currency + '|' + control.key] || 0))
        };
      });
      const total = deltas.reduce(function (sum, delta) { return sum + delta.amount; }, 0);
      const isCentLevelResidual = deltas.some(function (delta) { return Math.abs(delta.amount) > 0.000001; }) &&
        deltas.every(function (delta) { return Math.abs(delta.amount) <= tolerance; }) &&
        Math.abs(total) <= 0.000001;
      if (!isCentLevelResidual) {
        return;
      }
      deltas.forEach(function (delta) {
        if (Math.abs(delta.amount) <= 0.000001) {
          return;
        }
        balances[currency + '|' + delta.key] = Number(balances[currency + '|' + delta.key] || 0) + delta.amount;
        adjustments.push({
          id: 'rounding-adjustment-' + monthKey + '-' + currency + '-' + delta.key,
          date: getMonthEndDate_(monthKey), year: Number(monthKey.slice(0, 4)), month: Number(monthKey.slice(5, 7)),
          currency: currency, transactionType: 'rounding_adjustment',
          description: descriptions.roundingAdjustment, sourceFile: descriptions.checkpointSource, sourceRow: 0,
          initialBalanceDelta: { key: delta.key, name: delta.participant, amount: delta.amount }
        });
      });
    });
  });
  return adjustments;
}

function getMonthEndDate_(monthKey) {
  const year = Number(String(monthKey).slice(0, 4));
  const month = Number(String(monthKey).slice(5, 7));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return monthKey + '-' + String(day).padStart(2, '0');
}

function getRecordedOpeningBalanceChecks_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }
  const markerColumn = getInstallerImportAuditHeaders_().indexOf('Opening balance checks') + 1;
  if (markerColumn <= 0 || sheet.getLastColumn() < markerColumn) {
    return [];
  }
  return sheet.getRange(2, markerColumn, sheet.getLastRow() - 1, 1).getValues().flatMap(function (row) {
    if (!row[0]) {
      return [];
    }
    try {
      const checks = JSON.parse(row[0]);
      return Array.isArray(checks) ? checks : [];
    } catch (error) {
      return [];
    }
  });
}

function backfillOpeningBalanceAuditDetails_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) {
    return;
  }
  const headers = getInstallerImportAuditHeaders_();
  const checksColumn = headers.indexOf('Opening balance checks') + 1;
  const detailsColumn = headers.indexOf('Opening balance details') + 1;
  if (!checksColumn || !detailsColumn || sheet.getLastColumn() < detailsColumn) {
    return;
  }
  const rowCount = sheet.getLastRow() - 1;
  const checks = sheet.getRange(2, checksColumn, rowCount, 1).getValues();
  const details = sheet.getRange(2, detailsColumn, rowCount, 1).getValues();
  const values = details.map(function (row, index) {
    if (row[0] || !checks[index][0]) {
      return row;
    }
    try {
      const parsed = JSON.parse(checks[index][0]);
      return [formatOpeningBalanceAuditDetails_(Array.isArray(parsed) ? parsed : [])];
    } catch (error) {
      return row;
    }
  });
  sheet.getRange(2, detailsColumn, rowCount, 1).setValues(values);
}

function getInitialBalanceConfigurationHeaders_(localization) {
  return localization.initialBalanceConfiguration.headers;
}

function getInitialBalanceConfigurationOrigin_(localization, origin) {
  return localization.initialBalanceConfiguration.origins[origin];
}

function synchronizeInitialBalanceConfiguration_(sheet, localization, checks, ledgerRecords) {
  ensureInitialBalanceConfigurationHeaders_(sheet, localization);
  const manualBalances = readConfiguredInitialBalances_(sheet, localization, 'manual');
  const automaticBalances = buildAutomaticInitialBalances_(checks, ledgerRecords);
  writeAutomaticInitialBalances_(sheet, localization, automaticBalances);
  const configuredAutomaticBalances = readConfiguredInitialBalances_(sheet, localization, 'automatic');
  return mergeInitialBalances_(manualBalances, configuredAutomaticBalances);
}

function ensureInitialBalanceConfigurationHeaders_(sheet, localization) {
  const headers = getInitialBalanceConfigurationHeaders_(localization);
  // The former side-by-side layout used J as its checkbox column. It is no
  // longer part of either vertical table, so remove its stale controls.
  const legacyControlRows = Math.max(1, sheet.getMaxRows() - 1);
  sheet.getRange(2, 9, legacyControlRows, 1).clearDataValidations();
  sheet.getRange(2, 10, legacyControlRows, 1).removeCheckboxes().clearContent();
  // Earlier versions styled the whole first row as a single table header.
  // The configuration now consists of two independent vertical tables, so
  // clear that residual header styling outside the taxonomy table.
  sheet.getRange(1, 3, 1, 9).clearFormat();
  const layout = ensureInitialBalanceConfigurationLayout_(sheet, headers);
  const range = sheet.getRange(layout.headerRow, 1, 1, headers.length);
  const existing = range.getDisplayValues()[0];
  if (existing.every(function (value) { return !value; })) {
    range.setValues([headers]);
  } else if (existing.join('|') !== headers.join('|')) {
    throw new Error('Existing initial-balance configuration has incompatible headers: ' + sheet.getName());
  }
  const balanceRows = getInitialBalanceConfigurationDataRowCount_(sheet, layout);
  const activeColumn = 6;
  sheet.getRange(layout.dataRow, activeColumn, Math.max(1, sheet.getMaxRows() - layout.dataRow + 1), 1)
    .clearDataValidations();
  if (balanceRows > 0) {
    sheet.getRange(layout.dataRow, activeColumn, balanceRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
  sheet.getRange(layout.dataRow, 5, Math.max(1, balanceRows), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([
      getInitialBalanceConfigurationOrigin_(localization, 'automatic'),
      getInitialBalanceConfigurationOrigin_(localization, 'manual'),
      getInitialBalanceConfigurationOrigin_(localization, 'assumedZero')
    ], true).setAllowInvalid(false).build());
  sheet.getRange(layout.dataRow, 4, Math.max(1, balanceRows), 1).setNumberFormat('0.00');
  applyConfigurationTableBorder_(sheet, layout.headerRow, 1, Math.max(1, balanceRows + 1), headers.length);
}

function readConfiguredInitialBalances_(sheet, localization, wantedOrigin) {
  const layout = getInitialBalanceConfigurationLayout_(sheet, getInitialBalanceConfigurationHeaders_(localization));
  const rowCount = getInitialBalanceConfigurationDataRowCount_(sheet, layout);
  if (!layout || rowCount === 0) {
    return [];
  }
  const origins = localization.initialBalanceConfiguration.origins;
  return sheet.getRange(layout.dataRow, 1, rowCount, 7).getValues().map(function (row) {
    return {
      date: formatLedgerDate_(row[0]), currency: String(row[1] || '').toUpperCase(),
      participant: String(row[2] || '').trim(), amount: Number(row[3]), origin: String(row[4] || ''),
      active: row[5] === true, notes: String(row[6] || '')
    };
  }).filter(function (row) {
    const matchesOrigin = wantedOrigin === 'automatic' ?
      (row.origin === origins.automatic || row.origin === origins.assumedZero) :
      row.origin === origins[wantedOrigin];
    return row.active && matchesOrigin && row.date && row.currency && row.participant &&
      isFinite(row.amount);
  });
}

function buildAutomaticInitialBalances_(checks, ledgerRecords) {
  const knownParticipants = {};
  (ledgerRecords || []).forEach(function (record) {
    buildParticipantBalanceDeltas_(record).forEach(function (delta) {
      const key = String(record.currency).toUpperCase() + '|' + delta.key;
      if (!knownParticipants[key] || String(record.date) < knownParticipants[key].date) {
        knownParticipants[key] = {
          date: String(record.date), currency: String(record.currency).toUpperCase(), participant: delta.name
        };
      }
    });
  });
  const openingRecords = uniqueOpeningBalanceRecords_((checks || []).flatMap(getOpeningBalanceRecordsFromCheck_));
  const firstGroups = {};
  groupOpeningBalanceRecords_(openingRecords).forEach(function (group) {
    if (!firstGroups[group.currency]) {
      firstGroups[group.currency] = group;
    }
  });
  const firstLedgerDateByCurrency = {};
  Object.keys(knownParticipants).forEach(function (key) {
    const entry = knownParticipants[key];
    if (!firstLedgerDateByCurrency[entry.currency] || entry.date < firstLedgerDateByCurrency[entry.currency]) {
      firstLedgerDateByCurrency[entry.currency] = entry.date;
    }
  });
  const automaticBalances = {};
  Object.keys(firstGroups).forEach(function (currency) {
    const group = firstGroups[currency];
    if (firstLedgerDateByCurrency[currency] && group.date > firstLedgerDateByCurrency[currency]) {
      return;
    }
    const vector = buildOpeningBalanceVector_(group.records, currency);
    const sources = group.records.map(function (record) {
      return String(record.sourceFile || record.sourceFileName || record.description || '');
    }).filter(Boolean).filter(function (value, index, values) { return values.indexOf(value) === index; });
    Object.keys(vector.balances).forEach(function (participant) {
      const entry = vector.balances[participant];
      const key = currency + '|' + participant;
      automaticBalances[key] = {
        date: group.date, currency: currency, participant: entry.name,
        amount: roundBalanceAmount_(entry.amount), source: sources.join(', ')
      };
    });
  });
  // Only when no opening-balance vector exists for a currency is zero an
  // assumption. A participant omitted by a real vector is simply neutral and
  // is not materialized as an artificial baseline row.
  Object.keys(knownParticipants).forEach(function (key) {
    const currency = key.split('|')[0];
    if (!automaticBalances[key] && (!firstGroups[currency] ||
      firstGroups[currency].date > firstLedgerDateByCurrency[currency])) {
      automaticBalances[key] = Object.assign({}, knownParticipants[key], { amount: 0, source: '' });
    }
  });
  return Object.keys(automaticBalances).sort().map(function (key) { return automaticBalances[key]; });
}

function writeAutomaticInitialBalances_(sheet, localization, balances) {
  const layout = getInitialBalanceConfigurationLayout_(sheet, getInitialBalanceConfigurationHeaders_(localization));
  const origins = localization.initialBalanceConfiguration.origins;
  const rowCount = getInitialBalanceConfigurationDataRowCount_(sheet, layout);
  const managedRows = rowCount ? sheet.getRange(layout.dataRow, 1, rowCount, 7).getValues() : [];
  const manualRows = managedRows.filter(function (row) { return String(row[4] || '') === origins.manual; });
  const automaticRows = (balances || []).map(function (balance) {
    const origin = Math.abs(Number(balance.amount)) <= 0.000001 ? origins.assumedZero : origins.automatic;
    const note = origin === origins.assumedZero ? localization.initialBalanceConfiguration.assumedZeroNote :
      localization.initialBalanceConfiguration.automaticNotePrefix + balance.source;
    return [balance.date, balance.currency, balance.participant, roundBalanceAmount_(balance.amount), origin, true, note];
  });
  const rows = manualRows.concat(automaticRows);
  sheet.getRange(layout.dataRow, 1, Math.max(1, sheet.getMaxRows() - layout.dataRow + 1), 7)
    .clearContent();
  if (rows.length > 0) {
    sheet.getRange(layout.dataRow, 1, rows.length, 7).setValues(rows);
  }
  ensureInitialBalanceConfigurationHeaders_(sheet, localization);
}

function ensureInitialBalanceConfigurationLayout_(sheet, headers) {
  const existing = getInitialBalanceConfigurationLayout_(sheet, headers);
  const taxonomyLastRow = getConfigurationTaxonomyLastRow_(sheet);
  const headerRow = taxonomyLastRow + 3;
  if (existing && existing.headerRow === headerRow && existing.startColumn === 1) {
    return existing;
  }
  const values = existing ? sheet.getRange(existing.dataRow, existing.startColumn,
    getInitialBalanceConfigurationDataRowCount_(sheet, existing), headers.length).getValues() : [];
  if (existing) {
    sheet.getRange(existing.headerRow, existing.startColumn,
      Math.max(1, sheet.getMaxRows() - existing.headerRow + 1), headers.length)
      .clearContent().clearDataValidations().clearFormat();
  }
  sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers]);
  if (values.length > 0) {
    sheet.getRange(headerRow + 1, 1, values.length, headers.length).setValues(values);
  }
  return { headerRow: headerRow, dataRow: headerRow + 1, startColumn: 1 };
}

function getInitialBalanceConfigurationLayout_(sheet, headers) {
  const rowCount = Math.max(1, sheet.getLastRow());
  const columnCount = Math.max(headers.length, sheet.getLastColumn());
  const values = sheet.getRange(1, 1, rowCount, columnCount).getDisplayValues();
  for (let row = 0; row < values.length; row += 1) {
    for (let column = 0; column <= columnCount - headers.length; column += 1) {
      if (values[row].slice(column, column + headers.length).join('|') === headers.join('|')) {
        return { headerRow: row + 1, dataRow: row + 2, startColumn: column + 1 };
      }
    }
  }
  return null;
}

function getInitialBalanceConfigurationDataRowCount_(sheet, layout) {
  if (!layout || sheet.getLastRow() < layout.dataRow) {
    return 0;
  }
  const values = sheet.getRange(layout.dataRow, layout.startColumn,
    sheet.getLastRow() - layout.dataRow + 1, 7).getDisplayValues();
  return values.reduce(function (lastRow, row, index) {
    return row.some(function (value) { return value !== ''; }) ? index + 1 : lastRow;
  }, 0);
}

function getConfigurationTaxonomyLastRow_(sheet) {
  if (sheet.getLastRow() < 2) {
    return 1;
  }
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  let lastRow = 1;
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index][0] && !values[index][1]) {
      break;
    }
    lastRow = index + 2;
  }
  return lastRow;
}

function applyConfigurationTableBorder_(sheet, row, column, rowCount, columnCount) {
  sheet.getRange(row, column, rowCount, columnCount).setBorder(
    true, true, true, true, false, false, '#64748B', SpreadsheetApp.BorderStyle.SOLID_MEDIUM
  );
}

function mergeInitialBalances_(manualBalances, automaticBalances) {
  const selected = {};
  (automaticBalances || []).forEach(function (balance) {
    const key = balance.currency + '|' + normalizeParticipantName_(balance.participant);
    selected[key] = balance;
  });
  const selectedManual = {};
  (manualBalances || []).forEach(function (balance) {
    const key = balance.currency + '|' + normalizeParticipantName_(balance.participant);
    if (!selectedManual[key] || String(balance.date) < String(selectedManual[key].date)) {
      selectedManual[key] = balance;
    }
  });
  Object.keys(selectedManual).forEach(function (key) { selected[key] = selectedManual[key]; });
  return Object.keys(selected).sort().map(function (key) { return selected[key]; });
}

function buildInitialBalanceRecords_(balances, localization) {
  const descriptions = localization && localization.balanceDescriptions ? localization.balanceDescriptions : {
    initialBalance: 'Initial balance', configurationSource: 'Configuration'
  };
  return (balances || []).map(function (balance) {
    return {
      id: 'initial-balance-' + balance.currency + '-' + normalizeParticipantName_(balance.participant),
      date: balance.date, year: Number(String(balance.date).slice(0, 4)),
      month: Number(String(balance.date).slice(5, 7)), currency: balance.currency,
      transactionType: 'opening_balance', description: descriptions.initialBalance + ' (' + balance.origin + ')',
      sourceFile: descriptions.configurationSource, sourceRow: 0,
      initialBalanceDelta: {
        key: normalizeParticipantName_(balance.participant), name: balance.participant,
        amount: roundBalanceAmount_(balance.amount)
      }
    };
  });
}

function buildMonthlyBalanceRows_(movements, checks, excludedOpeningGroups) {
  const records = movements.sortedRecords;
  const participantNames = Object.assign({}, movements.participantNames);
  const checkByMonth = {};
  const controls = buildDeclaredMonthlyBalanceControls_(checks, excludedOpeningGroups);
  controls.forEach(function (control) {
    const key = String(control[0]) + '-' + String(control[1]).padStart(2, '0') + '|' + control[2] + '|' +
      normalizeParticipantName_(control[3]);
    checkByMonth[key] = { declared: Number(control[4]) };
    participantNames[control[2] + '|' + normalizeParticipantName_(control[3])] = String(control[3]);
  });
  const months = records.map(function (record) { return String(record.date).slice(0, 7); })
    .concat(controls.map(function (control) {
      return String(control[0]) + '-' + String(control[1]).padStart(2, '0');
    })).sort();
  if (months.length === 0) {
    return { rows: [] };
  }
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const balances = {};
  const rows = [];
  let recordIndex = 0;
  for (let monthKey = firstMonth; monthKey <= lastMonth; monthKey = nextMonthKey_(monthKey)) {
    while (recordIndex < records.length && String(records[recordIndex].date).slice(0, 7) === monthKey) {
      const record = records[recordIndex];
      buildParticipantBalanceDeltas_(record).forEach(function (delta) {
        const key = record.currency + '|' + delta.key;
        balances[key] = Number(balances[key] || 0) + delta.amount;
      });
      recordIndex += 1;
    }
    Object.keys(participantNames).sort().forEach(function (key) {
      const split = key.split('|');
      const check = checkByMonth[monthKey + '|' + key];
      const closingBalance = roundBalanceAmount_(balances[key] || 0);
      const difference = check ? roundBalanceAmount_(closingBalance - check.declared) : '';
      rows.push([Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), split[0], participantNames[key],
        closingBalance, check ? check.declared : '', difference,
        check ? (Math.abs(difference) <= 0.01 ? 'matched' : 'mismatch') : '']);
    });
  }
  return { rows: rows };
}

function buildDeclaredMonthlyBalanceControls_(checks, excludedOpeningGroups) {
  return groupOpeningBalanceRecords_(uniqueOpeningBalanceRecords_((checks || [])
    .flatMap(getOpeningBalanceRecordsFromCheck_))).filter(function (group) {
    return !(excludedOpeningGroups && excludedOpeningGroups[group.date + '|' + group.currency]);
  }).flatMap(function (group) {
    const previousMonth = previousMonthKey_(group.date);
    const vector = buildOpeningBalanceVector_(group.records, group.currency);
    return Object.keys(vector.balances).sort().map(function (participant) {
      const entry = vector.balances[participant];
      return [Number(previousMonth.slice(0, 4)), Number(previousMonth.slice(5, 7)), group.currency,
        entry.name, roundBalanceAmount_(entry.amount)];
    });
  });
}

function getInitialOpeningBalanceGroupKeys_(checks, ledgerRecords) {
  const firstLedgerDateByCurrency = {};
  (ledgerRecords || []).forEach(function (record) {
    const currency = String(record.currency || '').toUpperCase();
    const date = String(record.date || '');
    if (currency && date && (!firstLedgerDateByCurrency[currency] ||
      date < firstLedgerDateByCurrency[currency])) {
      firstLedgerDateByCurrency[currency] = date;
    }
  });
  const firstGroupByCurrency = {};
  groupOpeningBalanceRecords_(uniqueOpeningBalanceRecords_((checks || [])
    .flatMap(getOpeningBalanceRecordsFromCheck_))).forEach(function (group) {
    if (!firstGroupByCurrency[group.currency]) {
      firstGroupByCurrency[group.currency] = group;
    }
  });
  return Object.keys(firstGroupByCurrency).reduce(function (result, currency) {
    const group = firstGroupByCurrency[currency];
    if (!firstLedgerDateByCurrency[currency] || group.date <= firstLedgerDateByCurrency[currency]) {
      result[group.date + '|' + currency] = true;
    }
    return result;
  }, {});
}

function previousMonthKey_(date) {
  const value = String(date || '');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  if (!isFinite(year) || !isFinite(month) || month < 1 || month > 12) {
    throw new Error('An opening-balance checkpoint has an invalid date: ' + value);
  }
  return (month === 1 ? year - 1 : year) + '-' + String(month === 1 ? 12 : month - 1).padStart(2, '0');
}

function nextMonthKey_(monthKey) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return (month === 12 ? year + 1 : year) + '-' + String(month === 12 ? 1 : month + 1).padStart(2, '0');
}

function writeDerivedBalanceSheet_(sheet, headers, rows, note) {
  const requiredRows = rows.length + 1;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setNote(note ||
    'Calculated from the exact participant allocations preserved in the Tricount JSON source.');
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
}

function refreshTransactionBalanceImpactLabels_(sheet, headers, records, localization) {
  const impactColumn = headers.indexOf(localization.headers.balanceImpact);
  if (impactColumn < 0 || records.length === 0) {
    return;
  }
  sheet.getRange(2, impactColumn + 1, records.length, 1).setValues(records.map(function (record) {
    return [buildBalanceImpactLabel_(record)];
  }));
}
