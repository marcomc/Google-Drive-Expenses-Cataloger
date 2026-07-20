function getEnglishLocalization_() {
  return {
    sheetNames: {
      transactions: 'Transactions', imports: 'Imports', dashboard: 'Dashboard',
      configuration: 'Configuration', balanceMovements: 'Balance movements',
      monthlyBalances: 'Monthly balances', sourceReconciliations: 'Source reconciliations',
      personalAnalysis: 'Personal analysis', technicalData: 'Calculation data'
    },
    headers: {
      transactionId: 'Transaction ID', date: 'Date', year: 'Year', month: 'Month',
      payer: 'Paid by', beneficiaries: 'Beneficiaries', amount: 'Amount',
      currency: 'Currency', description: 'Description', transactionType: 'Type',
      category: 'Category', subcategory: 'Subcategory', merchant: 'Merchant / supplier',
      sourceCategory: 'Source category', confidence: 'AI confidence', rationale: 'AI rationale',
      fingerprint: 'Duplicate fingerprint', sourceFolder: 'Source folder', sourceFile: 'Source JSON',
      sourceRow: 'Source row', importedAt: 'Imported at', balanceImpact: 'Balance impact',
      participant: 'Participant', balanceChange: 'Balance change', runningBalance: 'Running balance',
      monthlyClosingBalance: 'Month-end balance', declaredOpeningBalance: 'Next declared opening balance',
      balanceDifference: 'Difference', balanceVerification: 'Opening-balance check',
      sourceFolderLink: 'Source folder link', sourceFileLink: 'Source JSON link', sourceFileId: 'Source file ID',
      sourceContentHash: 'Source content SHA-256', sourceRows: 'Source rows', importedRows: 'Imported rows',
      duplicateRows: 'Duplicate rows', openingBalanceRows: 'Opening-balance rows',
      unaccountedRows: 'Unaccounted rows', sourceTotals: 'Source totals by currency',
      accountedTotals: 'Accounted totals by currency', reconciliationStatus: 'Reconciliation status',
      sourceDecisions: 'Source-row decisions', sourceTransactionId: 'Source transaction ID',
      sourceNativeType: 'Source transaction type', sourceStatus: 'Source status',
      sourceCustomCategory: 'Source custom category', allocationDetails: 'Participant allocations',
      exchangeRate: 'Exchange rate', sourceCreatedAt: 'Source created at', sourceUpdatedAt: 'Source updated at'
    },
    initialBalanceConfiguration: {
      headers: ['Initial-balance date', 'Currency', 'Participant', 'Initial balance', 'Origin', 'Active', 'Notes'],
      origins: { automatic: 'Automatic', manual: 'Manual', assumedZero: 'Assumed zero' },
      automaticNotePrefix: 'Detected from the earliest available import: ',
      assumedZeroNote: 'No initial balance detected: the calculation explicitly starts at zero.'
    },
    dashboard: {
      title: 'HoStello expenses', subtitle: 'Dynamic summary based on imported transactions',
      totalSpend: 'Total spending', expenseCount: 'Expense transactions',
      currentYearSpend: 'Current-year spending', currentYearCount: 'Current-year transactions',
      latestMonth: 'Latest imported month', latestMonthSpend: 'Latest-month spending',
      annualSpend: 'Annual spending by category', monthlyComparison: 'Monthly spending comparison by year',
      monthlySpend: 'Monthly spending by category', payerSpend: 'Spending by payer',
      topMerchants: 'Top 20 merchants / suppliers', comparisonYears: 'Years to compare', color: 'Color',
      yearColors: { green: 'Green', blue: 'Blue', orange: 'Orange', purple: 'Purple', pink: 'Pink', teal: 'Teal', red: 'Red', lime: 'Lime' },
      detailYear: 'Detail year', year: 'Year', includeYear: 'Show',
      selectedYear: 'Show details for',
      monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December']
    },
    categoryLabels: {
      Dogs: 'Dogs', 'Food and drink': 'Food and drink', Groceries: 'Groceries',
      Health: 'Health', 'Home and utilities': 'Home and utilities',
      'Home purchases': 'Home purchases', 'Leisure and travel': 'Leisure and travel',
      Other: 'Other', 'Personal and gifts': 'Personal and gifts', Transport: 'Transport'
    }
  };
}
