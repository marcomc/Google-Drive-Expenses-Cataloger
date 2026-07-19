function getEnglishLocalization_() {
  return {
    sheetNames: {
      transactions: 'Transactions', imports: 'Imports', dashboard: 'Dashboard',
      configuration: 'Configuration', balanceMovements: 'Balance movements',
      monthlyBalances: 'Monthly balances', sourceReconciliations: 'Source reconciliations',
      personalAnalysis: 'Personal analysis'
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
    dashboard: {
      title: 'HoStello expenses', subtitle: 'Dynamic summary based on imported transactions',
      totalSpend: 'Total spending', latestMonth: 'Latest imported month',
      latestMonthSpend: 'Latest-month spending', expenseCount: 'Expense transactions',
      annualSpend: 'Annual spending by category', monthlySpend: 'Monthly spending by category',
      dogSpend: 'Dog spending by subcategory', payerSpend: 'Spending by payer',
      monthlyBalances: 'Exact monthly balances (EUR)'
    }
  };
}
