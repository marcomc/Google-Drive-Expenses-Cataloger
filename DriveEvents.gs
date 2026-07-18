/**
 * Install an event-polling trigger plus an independent daily safety net.
 * The local installer can add Workspace Events transport without changing the
 * processing contract; both paths call the same folder-scoped importer.
 */
function installAutomationTriggers() {
  removeAutomationTriggers();
  ScriptApp.newTrigger('processDriveEventQueue').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('runDailyExpenseCataloging').timeBased()
    .atHour(CONFIG.DAILY_TRIGGER_HOUR).everyDays(1).create();
}

function removeAutomationTriggers() {
  const handlers = ['processDriveEventQueue', 'runDailyExpenseCataloging'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
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
