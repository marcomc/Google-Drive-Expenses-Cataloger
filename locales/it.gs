function getItalianLocalization_() {
  return {
    sheetNames: {
      transactions: 'Transazioni', imports: 'Importazioni', dashboard: 'Dashboard',
      configuration: 'Configurazione', balanceMovements: 'Movimenti saldi',
      monthlyBalances: 'Saldi mensili', sourceReconciliations: 'Riconciliazioni sorgenti',
      personalAnalysis: 'Analisi personali', technicalData: 'Dati tecnici'
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
    },
    initialBalanceConfiguration: {
      headers: ['Data saldo iniziale', 'Valuta', 'Partecipante', 'Saldo iniziale', 'Origine', 'Attivo', 'Note'],
      origins: { automatic: 'Automatico', manual: 'Manuale', assumedZero: 'Assunto: zero' },
      automaticNotePrefix: 'Rilevato dalla prima importazione disponibile: ',
      assumedZeroNote: 'Nessun saldo iniziale rilevato: il calcolo parte esplicitamente da zero.'
    },
    balanceDescriptions: {
      initialBalance: 'Saldo iniziale', configurationSource: 'Configurazione',
      roundingAdjustment: 'Allineamento arrotondamento checkpoint Tricount', checkpointSource: 'Checkpoint Tricount',
      allocationNote: 'Calcolato dalle quote esatte dei partecipanti conservate nel JSON Tricount.',
      monthlyNote: 'Calcolato dalle quote esatte; i riporti dichiarati sono controlli mensili indipendenti.'
    },
    dashboard: {
      title: 'Spese di HoStello', subtitle: 'Riepilogo dinamico basato sulle transazioni importate',
      totalSpend: 'Spesa complessiva', expenseCount: 'Transazioni di spesa',
      currentYearSpend: 'Spesa anno corrente', currentYearCount: 'Transazioni anno corrente',
      latestMonth: 'Ultimo mese importato', latestMonthSpend: 'Spesa ultimo mese',
      annualSpend: 'Spesa annua per categoria', monthlyComparison: 'Confronto spese mensili per anno',
      monthlySpend: 'Andamento mensile per categoria', payerSpend: 'Spesa per pagatore',
      topMerchants: 'Top 20 esercenti / fornitori', comparisonYears: 'Anni da confrontare', color: 'Colore',
      yearColors: { green: 'Verde', blue: 'Blu', orange: 'Arancione', purple: 'Viola', pink: 'Rosa', teal: 'Turchese', red: 'Rosso', lime: 'Lime' },
      detailYear: 'Anno di dettaglio', year: 'Anno', includeYear: 'Mostra',
      selectedYear: 'Visualizza dettagli per',
      merchantSort: 'Ordina esercenti', merchantSortBy: 'Ordina per',
      merchantSortBySpend: 'Per spesa', merchantSortAlphabetically: 'Alfabetico',
      monthNames: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
    },
    categoryLabels: {
      Dogs: 'Cani', 'Food and drink': 'Cibo e bevande', Groceries: 'Spesa alimentare',
      Health: 'Salute', 'Home and utilities': 'Casa e utenze',
      'Home purchases': 'Acquisti per la casa', 'Leisure and travel': 'Tempo libero e viaggi',
      Other: 'Altro', 'Personal and gifts': 'Personale e regali', Transport: 'Trasporti'
    }
  };
}
