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
  const headers = transactions.getRange(1, 1, 1, transactions.getLastColumn()).getValues()[0];
  const checks = getRecordedOpeningBalanceChecks_(spreadsheet.getSheetByName(localization.sheetNames.imports));
  const ledgerRecords = readLedgerBalanceViewRecords_(transactions, headers, localization);
  const records = ledgerRecords.concat(getInitialOpeningBalanceMarkerRecords_(checks));
  const movements = buildBalanceMovementRows_(records);
  writeDerivedBalanceSheet_(movementsSheet, getBalanceMovementHeaders_(localization), movements.rows);
  writeDynamicMonthlyBalanceSheet_(monthlySheet, localization,
    buildMonthlyBalanceControlRows_(movements, checks));
  refreshTransactionBalanceImpactLabels_(transactions, headers, ledgerRecords, localization);
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
  return buildExactBalanceDeltas_(record).map(function (delta) {
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

function buildBalanceMovementRows_(records) {
  const balances = {};
  const participantNames = {};
  const sorted = sortBalanceRecords_(records);
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

function getInitialOpeningBalanceMarkerRecords_(checks) {
  const markers = {};
  (checks || []).forEach(function (check) {
    const record = check && check.record;
    if (!record || !record.date || !record.currency || !record.payer) {
      return;
    }
    const key = String(record.currency).toUpperCase();
    if (!markers[key] || String(record.date) < String(markers[key].date)) {
      markers[key] = {
        id: 'opening-marker-' + key + '-' + record.date, date: record.date,
        year: Number(String(record.date).slice(0, 4)), month: Number(String(record.date).slice(5, 7)),
        currency: key, payer: record.payer, beneficiaries: record.beneficiaries,
        amount: Number(record.amount), description: record.description || 'Opening balance baseline',
        transactionType: 'opening_balance', allocations: record.allocations || [],
        sourceFile: 'Opening balance audit marker', sourceRow: 0
      };
    }
  });
  return Object.keys(markers).map(function (key) { return markers[key]; });
}

function buildMonthlyBalanceRows_(movements, checks) {
  const records = movements.sortedRecords;
  if (records.length === 0) {
    return { rows: [] };
  }
  const participantNames = movements.participantNames;
  const checkByMonth = {};
  (checks || []).forEach(function (check) {
    if (!check || !check.record || !check.record.date || !check.record.currency) {
      return;
    }
    const closeDate = new Date(check.record.date + 'T00:00:00');
    closeDate.setMonth(closeDate.getMonth() - 1);
    const monthKey = Utilities.formatDate(closeDate, Session.getScriptTimeZone(), 'yyyy-MM');
    (check.differences || []).forEach(function (difference) {
      checkByMonth[monthKey + '|' + String(check.record.currency).toUpperCase() + '|' +
        normalizeParticipantName_(difference.name)] = {
        declared: Number(difference.expected), difference: Number(difference.difference), status: check.status
      };
    });
  });
  const firstMonth = String(records[0].date).slice(0, 7);
  const lastMonth = String(records[records.length - 1].date).slice(0, 7);
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

function buildMonthlyBalanceControlRows_(movements, checks) {
  return buildMonthlyBalanceRows_(movements, checks).rows.filter(function (row) {
    return row[5] !== '';
  }).map(function (row) {
    return [row[0], row[1], row[2], row[3], row[5]];
  });
}

function nextMonthKey_(monthKey) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return (month === 12 ? year + 1 : year) + '-' + String(month === 12 ? 1 : month + 1).padStart(2, '0');
}

function writeDerivedBalanceSheet_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setNote(
    'Calculated from the exact participant allocations preserved in the Tricount JSON source.'
  );
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
}

function writeDynamicMonthlyBalanceSheet_(sheet, localization, controls) {
  const headers = getMonthlyBalanceHeaders_(localization);
  const helperHeaders = ['Year', 'Month', 'Currency', 'Participant', 'Declared closing balance'];
  const movementName = localization.sheetNames.balanceMovements.replace(/'/g, "''");
  const keyFormula = '=SORT(UNIQUE(FILTER(HSTACK(\'' + movementName + '\'!C2:C,\'' + movementName +
    '\'!D2:D,\'' + movementName + '\'!E2:E,\'' + movementName + '\'!F2:F),\'' + movementName +
    '\'!A2:A<>"")),1,TRUE,2,TRUE,3,TRUE,4,TRUE)';
  const lastRow = sheet.getMaxRows();
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setNote(
    'Calculated from exact Tricount allocations. Declared carry-overs are independent monthly controls.'
  );
  sheet.getRange(1, 10, 1, helperHeaders.length).setValues([helperHeaders]);
  if (controls.length > 0) {
    sheet.getRange(2, 10, controls.length, helperHeaders.length).setValues(controls);
  }
  sheet.getRange('A2').setFormula(keyFormula);
  sheet.getRange(2, 5, lastRow - 1, 4).setFormulas(Array.from({ length: lastRow - 1 }, function (_, index) {
    const row = index + 2;
    const criteria = "'" + movementName + "'!$C$2:$C$" + lastRow + '=$A' + row + ',' +
      "'" + movementName + "'!$D$2:$D$" + lastRow + '=$B' + row + ',' +
      "'" + movementName + "'!$E$2:$E$" + lastRow + '=$C' + row + ',' +
      "'" + movementName + "'!$F$2:$F$" + lastRow + '=$D' + row;
    const values = "'" + movementName + "'!$H$2:$H$" + lastRow;
    const matches = 'FILTER(' + values + ',' + criteria + ')';
    const closing = '=IF($A' + row + '="","",IFERROR(INDEX(' + matches + ',ROWS(' + matches + ')),""))';
    const declared = '=IF($A' + row + '="","",IFERROR(INDEX(FILTER($N$2:$N$' + lastRow +
      ',$J$2:$J$' + lastRow + '=$A' + row + ',$K$2:$K$' + lastRow + '=$B' + row +
      ',$L$2:$L$' + lastRow + '=$C' + row + ',$M$2:$M$' + lastRow + '=$D' + row + '),1),""))';
    const difference = '=IF(OR($E' + row + '="",$F' + row + '=""),"",ROUND($E' + row + '-$F' + row + ',2))';
    const verification = '=IF($G' + row + '="","",IF(ABS($G' + row + ')<=0.01,"matched","mismatch"))';
    return [closing, declared, difference, verification];
  }));
  sheet.getRange('E:E').setNumberFormat('0.00');
  sheet.getRange('F:G').setNumberFormat('0.00');
  sheet.hideColumns(10, helperHeaders.length);
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
