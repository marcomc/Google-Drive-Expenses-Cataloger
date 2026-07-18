function getItalianLocalization_() {
  return {
    sheetNames: {
      transactions: 'Transazioni', imports: 'Importazioni', dashboard: 'Dashboard',
      configuration: 'Configurazione', balanceMovements: 'Movimenti saldi',
      monthlyBalances: 'Saldi mensili', sourceReconciliations: 'Riconciliazioni sorgenti'
    },
    headers: {
      transactionId: 'ID transazione', date: 'Data', year: 'Anno', month: 'Mese',
      payer: 'Pagato da', beneficiaries: 'Beneficiari', amount: 'Importo',
      currency: 'Valuta', description: 'Descrizione', transactionType: 'Tipo',
      category: 'Categoria', subcategory: 'Sottocategoria', merchant: 'Esercente / fornitore',
      sourceCategory: 'Categoria sorgente', confidence: 'Confidenza AI', rationale: 'Motivazione AI',
      fingerprint: 'Impronta duplicato', sourceFolder: 'Cartella sorgente', sourceFile: 'JSON sorgente',
      sourceRow: 'Riga sorgente', importedAt: 'Importato il', balanceImpact: 'Impatto saldi',
      participant: 'Partecipante', balanceChange: 'Variazione saldo', runningBalance: 'Saldo progressivo',
      monthlyClosingBalance: 'Saldo fine mese', declaredOpeningBalance: 'Riporto dichiarato successivo',
      balanceDifference: 'Scostamento', balanceVerification: 'Verifica riporto',
      sourceFolderLink: 'Link cartella sorgente', sourceFileLink: 'Link JSON sorgente', sourceFileId: 'ID file sorgente',
      sourceContentHash: 'SHA-256 contenuto sorgente', sourceRows: 'Righe sorgente', importedRows: 'Righe importate',
      duplicateRows: 'Righe duplicate', openingBalanceRows: 'Righe riporto iniziale',
      unaccountedRows: 'Righe non contabilizzate', sourceTotals: 'Totali sorgente per valuta',
      accountedTotals: 'Totali contabilizzati per valuta', reconciliationStatus: 'Stato riconciliazione',
      sourceDecisions: 'Decisioni righe sorgente', sourceTransactionId: 'ID transazione sorgente',
      sourceNativeType: 'Tipo transazione sorgente', sourceStatus: 'Stato sorgente',
      sourceCustomCategory: 'Categoria personalizzata sorgente', allocationDetails: 'Quote partecipanti',
      exchangeRate: 'Tasso di cambio', sourceCreatedAt: 'Creato nella sorgente', sourceUpdatedAt: 'Aggiornato nella sorgente'
    }
  };
}
