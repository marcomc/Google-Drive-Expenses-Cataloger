const AUTOMATION_TRIGGER_HANDLERS = Object.freeze([
  'processDriveEventQueue',
  'runDailyExpenseCataloging'
]);
const DASHBOARD_YEAR_COLOR_EDIT_TRIGGER_HANDLER = 'applyDashboardYearColorsOnEdit';

function installDashboardYearColorEditTrigger() {
  return withAutomationTriggerLock_(installDashboardYearColorEditTrigger_);
}

function installDashboardYearColorEditTrigger_() {
  const existing = getDashboardYearColorEditTriggers_();
  ScriptApp.newTrigger(DASHBOARD_YEAR_COLOR_EDIT_TRIGGER_HANDLER)
    .forSpreadsheet(getSpreadsheetId_()).onEdit().create();
  const deletionErrors = deleteTriggersBestEffort_(existing);
  const status = getDashboardYearColorEditTriggerStatus_();
  if (status.triggerCount !== 1 || status.totalTriggerCount !== 1) {
    throw new Error('Dashboard edit-trigger reconciliation did not converge. State: ' +
      JSON.stringify(status) + formatTriggerDeletionErrors_(deletionErrors));
  }
  return { triggerCount: status.triggerCount };
}

function getDashboardYearColorEditTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === DASHBOARD_YEAR_COLOR_EDIT_TRIGGER_HANDLER &&
      trigger.getTriggerSource() === ScriptApp.TriggerSource.SPREADSHEETS &&
      trigger.getEventType() === ScriptApp.EventType.ON_EDIT;
  });
}

function getDashboardYearColorEditTriggerCount_() {
  return getDashboardYearColorEditTriggerStatus_().triggerCount;
}

function getDashboardYearColorEditTriggerStatus_(spreadsheetId) {
  const triggers = getDashboardYearColorEditTriggers_();
  const targetSpreadsheetId = spreadsheetId || getSpreadsheetId_();
  const triggerCount = triggers.filter(function (trigger) {
    return trigger.getTriggerSourceId() === targetSpreadsheetId;
  }).length;
  return {
    triggerCount: triggerCount,
    totalTriggerCount: triggers.length,
    staleTriggerCount: triggers.length - triggerCount
  };
}

function getDashboardYearColorEditTriggersForSpreadsheet_(spreadsheetId) {
  return getDashboardYearColorEditTriggers_().filter(function (trigger) {
    return trigger.getTriggerSourceId() === spreadsheetId;
  });
}

/**
 * Install an event-polling trigger plus an independent daily safety net.
 * Create both replacements before deleting existing triggers so a failed
 * recreation leaves the prior automation intact. The short overlap is safe:
 * the importer holds a script lock and persists per-source state.
 */
function installAutomationTriggers() {
  return withAutomationTriggerLock_(function () {
    const existing = getManagedAutomationTriggers_();
    const created = [];
    let dashboardTriggerStatus;
    try {
      created.push(ScriptApp.newTrigger('processDriveEventQueue').timeBased().everyMinutes(15).create());
      created.push(ScriptApp.newTrigger('runDailyExpenseCataloging').timeBased()
        .atHour(CONFIG.DAILY_TRIGGER_HOUR).everyDays(1).create());
      dashboardTriggerStatus = installDashboardYearColorEditTrigger_();
    } catch (error) {
      const cleanupErrors = deleteTriggersBestEffort_(created);
      throw new Error('Could not create replacement automation triggers: ' + error.message +
        formatTriggerDeletionErrors_(cleanupErrors, 'cleanup failures'));
    }
    const deletionErrors = deleteTriggersBestEffort_(existing);
    const status = getAutomationTriggerStatus_();
    status.dashboardYearColorEditTriggerCount = dashboardTriggerStatus.triggerCount;
    assertAutomationTriggerStatusHealthy_(status, deletionErrors);
    return status;
  });
}

function deleteTriggersBestEffort_(triggers) {
  const errors = [];
  (triggers || []).forEach(function (trigger) {
    try {
      ScriptApp.deleteTrigger(trigger);
    } catch (error) {
      errors.push(error.message);
    }
  });
  return errors;
}

function formatTriggerDeletionErrors_(errors, label) {
  return errors.length > 0 ? '; ' + (label || 'deletion failures') + ': ' + errors.join('; ') : '';
}

function assertAutomationTriggerStatusHealthy_(status, deletionErrors) {
  if (status.missingTriggerHandlers.length === 0 &&
    status.duplicateTriggerHandlers.length === 0 &&
    status.invalidTriggerHandlers.length === 0) {
    return;
  }
  throw new Error('Managed automation trigger reconciliation did not converge. State: ' +
    JSON.stringify(status) + formatTriggerDeletionErrors_(deletionErrors));
}

function removeAutomationTriggers() {
  return withAutomationTriggerLock_(function () {
    const managedTriggers = getManagedAutomationTriggers_()
      .concat(getDashboardYearColorEditTriggersForSpreadsheet_(getSpreadsheetId_()));
    const deletionErrors = deleteTriggersBestEffort_(managedTriggers);
    const triggerStatus = getAutomationTriggerStatus_();
    const dashboardTriggerStatus = getDashboardYearColorEditTriggerStatus_();
    if (triggerStatus.missingTriggerHandlers.length !== AUTOMATION_TRIGGER_HANDLERS.length ||
      triggerStatus.invalidTriggerHandlers.length > 0 ||
      dashboardTriggerStatus.triggerCount !== 0) {
      throw new Error('Could not remove every managed automation trigger. State: ' +
        JSON.stringify({
          automation: triggerStatus,
          dashboard: dashboardTriggerStatus
        }) + formatTriggerDeletionErrors_(deletionErrors));
    }
  });
}

function withAutomationTriggerLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.MAX_RUNTIME_MS)) {
    throw new Error('Could not acquire the automation trigger lock before the execution deadline.');
  }
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getManagedAutomationTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return AUTOMATION_TRIGGER_HANDLERS.indexOf(trigger.getHandlerFunction()) >= 0;
  });
}

function getAutomationTriggerStatus_() {
  const triggerCounts = AUTOMATION_TRIGGER_HANDLERS.reduce(function (counts, handler) {
    counts[handler] = 0;
    return counts;
  }, {});
  const invalidTriggerHandlers = [];
  getManagedAutomationTriggers_().forEach(function (trigger) {
    const handler = trigger.getHandlerFunction();
    if (trigger.getTriggerSource() === ScriptApp.TriggerSource.CLOCK &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK) {
      triggerCounts[handler] += 1;
    } else if (invalidTriggerHandlers.indexOf(handler) < 0) {
      invalidTriggerHandlers.push(handler);
    }
  });
  const missingTriggerHandlers = AUTOMATION_TRIGGER_HANDLERS.filter(function (handler) {
    return triggerCounts[handler] === 0;
  });
  const duplicateTriggerHandlers = AUTOMATION_TRIGGER_HANDLERS.filter(function (handler) {
    return triggerCounts[handler] > 1;
  });
  return {
    triggerCounts: triggerCounts,
    missingTriggerHandlers: missingTriggerHandlers,
    duplicateTriggerHandlers: duplicateTriggerHandlers,
    invalidTriggerHandlers: invalidTriggerHandlers
  };
}

/**
 * The polling path is also safe when a Workspace Event transport is not yet
 * provisioned or a subscription expires. Folder state prevents repeat work.
 */
function processDriveEventQueue() {
  if (!isAutomaticProcessingEnabled_()) {
    return { status: 'DISABLED' };
  }
  return withExpenseLock_('event-poll', function () {
    return runExpenseCataloging_('event-poll');
  });
}
