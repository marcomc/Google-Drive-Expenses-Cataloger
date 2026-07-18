const AUTOMATION_TRIGGER_HANDLERS = Object.freeze([
  'processDriveEventQueue',
  'runDailyExpenseCataloging'
]);

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
    try {
      created.push(ScriptApp.newTrigger('processDriveEventQueue').timeBased().everyMinutes(15).create());
      created.push(ScriptApp.newTrigger('runDailyExpenseCataloging').timeBased()
        .atHour(CONFIG.DAILY_TRIGGER_HOUR).everyDays(1).create());
    } catch (error) {
      created.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
      throw error;
    }
    existing.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    return getAutomationTriggerStatus_();
  });
}

function removeAutomationTriggers() {
  return withAutomationTriggerLock_(function () {
    getManagedAutomationTriggers_().forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
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
  getManagedAutomationTriggers_().forEach(function (trigger) {
    const handler = trigger.getHandlerFunction();
    triggerCounts[handler] += 1;
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
    duplicateTriggerHandlers: duplicateTriggerHandlers
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
