/**
 * Tab Lock – Focus Mode
 * Background service worker - core tab lock and pomodoro logic
 */

const POMODORO_CYCLE = [
  { focus: 60, break: 5 },
  { focus: 60, break: 10 },
  { focus: 60, break: 20 },
];

const ALARM_FOCUS = "pomodoro-focus";
const ALARM_BREAK = "pomodoro-break";
const ALARM_RECONCILE = "tab-lock-reconcile";
const STORAGE_KEY = "unswitch-state";
const LIVE_SESSION_KEY = "unswitch-live-session";
const RECONCILE_ATTEMPTS_KEY = "unswitch-reconcile-attempts";
const MAX_TAB_RECONCILE_ATTEMPTS = 5;

const DEFAULT_STATE = {
  mode: "off",
  lockedTabId: null,
  /** All tab IDs allowed while locked (primary tab plus any tabs added manually). */
  lockedTabIds: null,
  /** Stable identity for each allowed tab so a browser restart can rebind new ids. */
  lockedTabRecords: null,
  lockedWindowId: null,
  taskText: "",
  /** "breathing" = 10s inhale/exhale ritual; "none" = return immediately. */
  wrongTabInterstitial: "none",
  /** Confirm before leaving the current site from an allowed tab. Opt-in to avoid surprise dialogs. */
  leaveDomainWarning: false,
  pomodoroPhase: 0,
  pomodoroState: null,
  pomodoroEndTime: null,
  pomodoroBreakDuration: null,
};

let state = { ...DEFAULT_STATE };
/** False after a browser restart until saved tabs are rebound to live ids. */
let liveSessionKnown = false;

/**
 * Bumped when a session ends. Tab enforcement captures the value when it is
 * scheduled and bails out if an unlock arrived while it was waiting.
 */
let sessionEpoch = 0;

function invalidateEnforcement() {
  sessionEpoch += 1;
}

/** Serialize stateful events. MV3 may deliver tab, alarm, and popup events concurrently. */
let stateTaskChain = Promise.resolve();
function runStateTask(task, options = {}) {
  const scheduledEpoch = sessionEpoch;
  const run = stateTaskChain.then(async () => {
    await loadState();
    if (options.abortIfUnlocked && sessionEpoch !== scheduledEpoch) return null;
    return task(scheduledEpoch);
  });
  stateTaskChain = run.catch(() => {});
  return run;
}

function runStateEvent(task) {
  runStateTask(task).catch(() => {});
}

/**
 * Load the latest state in the serialized queue, then run browser/UI work outside it.
 * Content-script messaging can remain pending on restricted or discarded tabs; it must
 * never prevent popup commands from reaching the state queue.
 */
function runFreshStateEffect(effect) {
  runStateTask(() => undefined)
    .then(effect)
    .catch(() => {});
}

/** Serialize reminder injection / blocker sync so rapid toggles do not overlap. */
let deferredWorkChain = Promise.resolve();
function queueDeferredWork(fn) {
  deferredWorkChain = deferredWorkChain.then(fn).catch(() => {});
}

async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  state = { ...DEFAULT_STATE, ...result[STORAGE_KEY] };
  if (state.lockedTabId && (!state.lockedTabIds || state.lockedTabIds.length === 0)) {
    state.lockedTabIds = [state.lockedTabId];
  }
  liveSessionKnown = await hasLiveSession();
  return state;
}

function getLockedTabIdsArray() {
  if (state.lockedTabIds?.length) return state.lockedTabIds;
  return state.lockedTabId ? [state.lockedTabId] : [];
}

function getLockedTabIdSet() {
  return new Set(getLockedTabIdsArray());
}

function recordsFromState() {
  const ids = getLockedTabIdsArray();
  const previous = state.lockedTabRecords || [];
  return ids.map((id) => {
    let prev = null;
    for (const record of previous) {
      if (record && record.id === id) {
        prev = record;
        break;
      }
    }
    return {
      id,
      url: prev?.url || "",
      windowId: prev?.windowId ?? (id === state.lockedTabId ? state.lockedWindowId : null),
      index: typeof prev?.index === "number" ? prev.index : null,
      primary: id === state.lockedTabId,
    };
  });
}

function tabUrl(tab) {
  const url = tab?.url || "";
  // Restored tabs often report about:blank until pendingUrl is committed.
  if (!url || url === "about:blank") return tab?.pendingUrl || "";
  return url;
}

function tabLooksUnrestored(tab) {
  const url = tab?.url || "";
  return !url || url === "about:blank";
}

function recordFromTab(tab, primary) {
  return {
    id: tab.id,
    url: tabUrl(tab),
    windowId: tab.windowId ?? null,
    index: typeof tab.index === "number" ? tab.index : null,
    primary: Boolean(primary),
  };
}

function applyLockedRecords(records) {
  const primary = records.find((record) => record.primary) || records[0];
  state.lockedTabRecords = records.map((record) => ({
    id: record.id,
    url: record.url || "",
    windowId: record.windowId ?? null,
    index: typeof record.index === "number" ? record.index : null,
    primary: record.id === primary.id,
  }));
  state.lockedTabId = primary.id;
  state.lockedTabIds = state.lockedTabRecords.map((record) => record.id);
  state.lockedWindowId = primary.windowId ?? null;
}

function lockedIdentityChanged(nextRecords) {
  const current = recordsFromState();
  if (current.length !== nextRecords.length) return true;
  for (let i = 0; i < current.length; i += 1) {
    const left = current[i];
    const right = nextRecords[i];
    if (left.id !== right.id) return true;
    if ((left.url || "") !== (right.url || "")) return true;
    if ((left.windowId ?? null) !== (right.windowId ?? null)) return true;
  }
  return false;
}

async function saveState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const disk = result[STORAGE_KEY] || {};
  const patch = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined));
  const merged = { ...disk, ...patch };
  if (merged.lockedTabId && (!merged.lockedTabIds || merged.lockedTabIds.length === 0)) {
    merged.lockedTabIds = [merged.lockedTabId];
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  state = { ...DEFAULT_STATE, ...merged };
}

async function sessionGet(key) {
  if (!chrome.storage?.session?.get) return undefined;
  try {
    const result = await chrome.storage.session.get(key);
    return result ? result[key] : undefined;
  } catch (_) {
    return undefined;
  }
}

async function sessionSet(values) {
  if (!chrome.storage?.session?.set) return;
  try {
    await chrome.storage.session.set(values);
  } catch (_) {}
}

async function sessionRemove(key) {
  if (!chrome.storage?.session?.remove) return;
  try {
    await chrome.storage.session.remove(key);
  } catch (_) {}
}

/** Session storage dies with the browser, so a missing marker means tab ids may have been reused. */
async function hasLiveSession() {
  if (!chrome.storage?.session?.get) return true;
  return Boolean(await sessionGet(LIVE_SESSION_KEY));
}

async function markLiveSession() {
  await sessionSet({
    [LIVE_SESSION_KEY]: { ids: getLockedTabIdsArray().slice(), at: Date.now() },
  });
  await sessionRemove(RECONCILE_ATTEMPTS_KEY);
  liveSessionKnown = true;
}

async function clearLiveSession() {
  await sessionRemove(LIVE_SESSION_KEY);
  await sessionRemove(RECONCILE_ATTEMPTS_KEY);
  liveSessionKnown = false;
}

function isTabLockActive() {
  return (
    (state.mode === "locked" || (state.mode === "pomodoro" && state.pomodoroState === "focus")) &&
    state.lockedTabId
  );
}

function isSessionActive() {
  return state.mode === "locked" || state.mode === "pomodoro";
}

function shouldBlockTab(tabId) {
  // Stale ids from the previous browser session must not block whatever tab reused them.
  if (isSessionActive() && !liveSessionKnown) return false;
  return Boolean(isTabLockActive() && tabId && !getLockedTabIdSet().has(tabId));
}

function shouldWarnOnLeaveDomain(tabId) {
  return Boolean(
    state.leaveDomainWarning &&
      isTabLockActive() &&
      tabId &&
      getLockedTabIdSet().has(tabId)
  );
}

function isTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function phaseAt(index) {
  const normalized = typeof index === "number" && index >= 0 ? index % POMODORO_CYCLE.length : 0;
  return POMODORO_CYCLE[normalized];
}

/**
 * Move a due Pomodoro forward from its stored deadline.
 * Adding each phase to the previous deadline keeps the clock from drifting
 * when an alarm fires late or the worker was suspended.
 */
function completeDuePhases(now) {
  let changed = false;
  let guard = 0;
  while (isTimestamp(state.pomodoroEndTime) && state.pomodoroEndTime <= now && guard < 2000) {
    guard += 1;
    changed = true;
    if (state.pomodoroState === "break") {
      const current = typeof state.pomodoroPhase === "number" ? state.pomodoroPhase : 0;
      state.pomodoroPhase = (current + 1) % POMODORO_CYCLE.length;
      const phase = phaseAt(state.pomodoroPhase);
      state.pomodoroState = "focus";
      state.pomodoroBreakDuration = phase.break;
      state.pomodoroEndTime += phase.focus * 60 * 1000;
    } else {
      const phase = phaseAt(state.pomodoroPhase);
      state.pomodoroState = "break";
      state.pomodoroBreakDuration = null;
      state.pomodoroEndTime += phase.break * 60 * 1000;
    }
  }
  if (changed && guard >= 2000 && isTimestamp(state.pomodoroEndTime) && state.pomodoroEndTime <= now) {
    const phase = phaseAt(state.pomodoroPhase);
    const minutes = state.pomodoroState === "break" ? phase.break : phase.focus;
    state.pomodoroEndTime = now + minutes * 60 * 1000;
  }
  return changed;
}

async function readAlarm(name) {
  if (typeof chrome.alarms?.get !== "function") return null;
  try {
    return await chrome.alarms.get(name);
  } catch (_) {
    return null;
  }
}

async function clearPomodoroAlarms() {
  await Promise.all([
    chrome.alarms.clear(ALARM_FOCUS),
    chrome.alarms.clear(ALARM_BREAK),
    chrome.alarms.clear(ALARM_RECONCILE),
  ]);
}

/** Create the phase alarm at the stored deadline. Does not move that deadline. */
async function armPomodoroAlarm() {
  if (state.mode !== "pomodoro" || !isTimestamp(state.pomodoroEndTime)) return;
  const alarmName = state.pomodoroState === "break" ? ALARM_BREAK : ALARM_FOCUS;
  const otherName = alarmName === ALARM_FOCUS ? ALARM_BREAK : ALARM_FOCUS;
  await chrome.alarms.clear(otherName);
  const existing = await readAlarm(alarmName);
  const scheduled = existing?.scheduledTime;
  if (scheduled == null || Math.abs(scheduled - state.pomodoroEndTime) > 1000) {
    await chrome.alarms.clear(alarmName);
    await chrome.alarms.create(alarmName, { when: state.pomodoroEndTime });
  }
}

async function ensurePomodoroArmed() {
  if (state.mode !== "pomodoro") return false;
  const now = Date.now();
  let changed = false;
  if (state.pomodoroState !== "focus" && state.pomodoroState !== "break") {
    state.pomodoroState = "focus";
    changed = true;
  }
  if (!isTimestamp(state.pomodoroEndTime)) {
    const phase = phaseAt(state.pomodoroPhase);
    const minutes = state.pomodoroState === "break" ? phase.break : phase.focus;
    state.pomodoroEndTime = now + minutes * 60 * 1000;
    state.pomodoroBreakDuration = state.pomodoroState === "focus" ? phase.break : null;
    changed = true;
  } else if (completeDuePhases(now)) {
    changed = true;
  }
  if (changed) {
    await saveState();
    updateIcon();
    queueDeferredWork(syncBlockStateForAllTabs);
  }
  await armPomodoroAlarm();
  return changed;
}

function resolveLockedRecords(openTabs) {
  const records = recordsFromState();
  const tabs = [];
  for (const tab of openTabs || []) {
    if (tab && tab.id != null) tabs.push(tab);
  }
  const used = new Set();
  const resolved = [];
  const findTab = (predicate) => {
    for (const tab of tabs) {
      if (predicate(tab)) return tab;
    }
    return null;
  };

  let unmatched = 0;
  for (const record of records) {
    let match = findTab(
      (tab) => !used.has(tab.id) && tab.id === record.id && (!record.url || tabUrl(tab) === record.url)
    );
    if (!match && record.url) {
      match = findTab(
        (tab) =>
          !used.has(tab.id) &&
          record.index != null &&
          tab.index === record.index &&
          tabUrl(tab) === record.url
      );
      if (!match) {
        match = findTab((tab) => !used.has(tab.id) && tabUrl(tab) === record.url);
      }
    }
    if (!match) {
      unmatched += 1;
      continue;
    }
    used.add(match.id);
    resolved.push({
      id: match.id,
      url: tabUrl(match) || record.url || "",
      windowId: match.windowId ?? null,
      index: typeof match.index === "number" ? match.index : record.index,
      primary: record.primary,
    });
  }

  if (!resolved.some((record) => record.primary)) return null;
  // A background window may still be restoring. Dropping its allowed tab now would be permanent.
  if (unmatched > 0 && tabs.some(tabLooksUnrestored)) return null;
  return resolved;
}

async function scheduleReconcileRetry(openTabs) {
  const pending = await readAlarm(ALARM_RECONCILE);
  if (pending) return;
  const unrestored = (openTabs || []).some(tabLooksUnrestored);
  const currentAttempt = await sessionGet(RECONCILE_ATTEMPTS_KEY);
  const attempt = (typeof currentAttempt === "number" ? currentAttempt : 0) + 1;
  await sessionSet({ [RECONCILE_ATTEMPTS_KEY]: attempt });
  // Blank restored tabs are not evidence the focus tab is gone. Wait longer before ending it.
  const limit = unrestored ? 30 : MAX_TAB_RECONCILE_ATTEMPTS;
  if (attempt >= limit) {
    await disableLock();
    return;
  }
  await chrome.alarms.create(ALARM_RECONCILE, { when: Date.now() + (unrestored ? 2000 : 1000) });
}

async function reconcileTabsAfterRestart() {
  if (!isSessionActive() || (await hasLiveSession())) return false;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (_) {
    tabs = [];
  }
  const resolved = resolveLockedRecords(tabs);
  if (!resolved) {
    await scheduleReconcileRetry(tabs);
    return false;
  }
  if (lockedIdentityChanged(resolved)) {
    applyLockedRecords(resolved);
    await saveState();
  }
  await markLiveSession();
  await chrome.alarms.clear(ALARM_RECONCILE);
  return true;
}

async function refreshOpenLockedTabs() {
  if (!isSessionActive() || !(await hasLiveSession())) return false;
  const next = [];
  for (const record of recordsFromState()) {
    try {
      const tab = await chrome.tabs.get(record.id);
      next.push({
        id: tab.id,
        url: tabUrl(tab) || record.url || "",
        windowId: tab.windowId ?? record.windowId ?? null,
        primary: record.primary,
      });
    } catch (_) {
      // Closed while the worker was suspended, so the removal event never landed.
    }
  }
  if (!next.some((record) => record.id === state.lockedTabId)) {
    await disableLock();
    return true;
  }
  if (!lockedIdentityChanged(next)) return false;
  applyLockedRecords(next);
  await saveState();
  return true;
}

async function healTabs() {
  if (!isSessionActive()) return;
  if (await hasLiveSession()) {
    await refreshOpenLockedTabs();
    return;
  }
  await reconcileTabsAfterRestart();
}

async function sendTabMessage(tabId, message) {
  try {
    let timeoutId;
    await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Tab message timed out")), 1500);
      }),
    ]);
    clearTimeout(timeoutId);
    return true;
  } catch (_) {
    return false;
  }
}

async function syncBlockStateForTab(tabId) {
  if (!tabId) return;
  const blockMessage = {
    action: "unswitch-set-block-state",
    blocked: shouldBlockTab(tabId),
  };
  const warningMessage = {
    action: "unswitch-set-leave-domain-warning-state",
    enabled: shouldWarnOnLeaveDomain(tabId),
  };

  // Static content scripts handle normal pages. Only inject as a fallback for tabs that
  // were already open when the extension was installed or updated.
  if (!(await sendTabMessage(tabId, blockMessage))) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content/blocker.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/blocker.js", "content/leave-domain.js"],
      });
      await sendTabMessage(tabId, blockMessage);
    } catch (_) {
      // Restricted targets (chrome://, the Web Store, extension pages, etc.).
    }
  }
  await sendTabMessage(tabId, warningMessage);
}

async function syncBlockStateForAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => syncBlockStateForTab(tab.id)));
  } catch (_) {
    // Ignore sync errors
  }
}

function updateIcon() {
  const isLocked = isTabLockActive();
  const iconPrefix = isLocked ? "icon-locked" : "icon-unlocked";
  chrome.action.setIcon({
    path: {
      16: `icons/${iconPrefix}-16.png`,
      32: `icons/${iconPrefix}-32.png`,
      48: `icons/${iconPrefix}-48.png`,
      128: `icons/${iconPrefix}-128.png`,
    },
  });
  chrome.action.setBadgeText({ text: isLocked ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
}

function useBreathingRitualOnWrongTab() {
  return state.wrongTabInterstitial === "breathing";
}

function focusLockedTab(lockedTabId, lockedWindowId, epoch) {
  if (!lockedTabId) return;
  if (epoch != null && epoch !== sessionEpoch) return;
  chrome.tabs.update(lockedTabId, { active: true }).catch(() => {});
  if (lockedWindowId != null) {
    chrome.windows.update(lockedWindowId, { focused: true }).catch(() => {});
  }
}

function beginRedirect(tabId, epoch) {
  if (epoch !== sessionEpoch || !shouldBlockTab(tabId)) return null;
  const plan = {
    epoch,
    tabId,
    lockedTabId: state.lockedTabId,
    lockedWindowId: state.lockedWindowId,
    breathing: useBreathingRitualOnWrongTab(),
  };
  if (!plan.breathing) focusLockedTab(plan.lockedTabId, plan.lockedWindowId, epoch);
  return plan;
}

function continueRedirect(plan) {
  if (!plan || plan.epoch !== sessionEpoch) return;
  if (plan.breathing) {
    showWrongTabFeedback(plan.tabId, plan.epoch);
    return;
  }
  queueDeferredWork(() => syncBlockStateForTab(plan.tabId));
}

/** Sync blocker on wrong tab; optionally inject the breathing ritual overlay. */
async function showWrongTabFeedback(tabId, epoch) {
  if (epoch != null && epoch !== sessionEpoch) return;
  if (!useBreathingRitualOnWrongTab()) {
    focusLockedTab(state.lockedTabId, state.lockedWindowId, epoch);
    queueDeferredWork(() => syncBlockStateForTab(tabId));
    return;
  }
  await syncBlockStateForTab(tabId);
  if ((epoch != null && epoch !== sessionEpoch) || !shouldBlockTab(tabId)) return;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/overlay.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/overlay.js"],
    });
  } catch (e) {
    // chrome:// or extension pages cannot show the overlay, so fall back to an immediate bounce.
    if ((epoch != null && epoch !== sessionEpoch) || !shouldBlockTab(tabId)) return;
    focusLockedTab(state.lockedTabId, state.lockedWindowId, epoch);
  }
}

async function removeReminderFromTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.__unswitchReminderCleanup === "function") {
          window.__unswitchReminderCleanup();
        }
        const el = document.getElementById("unswitch-reminder");
        if (el) el.remove();
      },
    });
  } catch (_) {}
}

async function removeBreathingOverlayFromTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.__unswitchOverlayCleanup === "function") {
          window.__unswitchOverlayCleanup();
        }
        const el = document.getElementById("unswitch-overlay");
        if (el) el.remove();
      },
    });
  } catch (_) {}
}

async function injectReminderForTab(tabId) {
  if (!tabId || !String(state.taskText || "").trim()) return;
  if (!isTabLockActive() || !getLockedTabIdSet().has(tabId)) return;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/reminder.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/reminder.js"],
    });
  } catch (_) {}
}

async function injectReminderForLockedTabs() {
  if (!String(state.taskText || "").trim() || !state.lockedTabId) return;
  const ids = getLockedTabIdsArray();
  await Promise.all(ids.map((id) => injectReminderForTab(id)));
}

async function disableLock() {
  invalidateEnforcement();
  const tabIdsToClean = getLockedTabIdsArray();
  state.mode = "off";
  state.lockedTabId = null;
  state.lockedTabIds = null;
  state.lockedTabRecords = null;
  state.lockedWindowId = null;
  state.taskText = "";
  state.pomodoroState = null;
  state.pomodoroEndTime = null;
  state.pomodoroBreakDuration = null;
  state.pomodoroPhase = 0;
  await saveState();
  await clearLiveSession();
  updateIcon();
  await clearPomodoroAlarms();
  queueDeferredWork(async () => {
    for (const id of tabIdsToClean) {
      await removeReminderFromTab(id);
    }
    await syncBlockStateForAllTabs();
  });
}

async function enableLock(tab, taskText) {
  state.mode = "locked";
  state.lockedTabId = tab.id;
  state.lockedTabIds = [tab.id];
  state.lockedWindowId = tab.windowId ?? null;
  state.lockedTabRecords = [recordFromTab(tab, true)];
  state.taskText = String(taskText || "").trim();
  state.pomodoroState = null;
  state.pomodoroEndTime = null;
  state.pomodoroBreakDuration = null;
  state.pomodoroPhase = 0;
  await saveState();
  await markLiveSession();
  await clearPomodoroAlarms();
  updateIcon();
  queueDeferredWork(async () => {
    await injectReminderForLockedTabs();
    await syncBlockStateForAllTabs();
  });
}

async function resolveTargetTab(message) {
  if (message?.tabId != null) {
    try {
      return await chrome.tabs.get(message.tabId);
    } catch (_) {
      return null;
    }
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (_) {
    return null;
  }
}

function rememberTabUrl(tabId, url) {
  if (!url || !isSessionActive() || !getLockedTabIdSet().has(tabId)) return false;
  const records = recordsFromState();
  let changed = false;
  state.lockedTabRecords = records.map((record) => {
    if (record.id !== tabId || record.url === url) return record;
    changed = true;
    return { ...record, url };
  });
  return changed;
}

async function handleTabUpdated(tabId, changeInfo) {
  if (changeInfo.status !== "loading" && changeInfo.status !== "complete") return;
  await syncBlockStateForTab(tabId);
  if (changeInfo.status === "complete") {
    await injectReminderForTab(tabId);
  }
}

async function handleTabRemoved(tabId) {
  if (!isSessionActive()) return;
  const ids = getLockedTabIdsArray();
  if (!ids.includes(tabId)) return;
  if (tabId === state.lockedTabId) {
    await disableLock();
    return;
  }
  applyLockedRecords(recordsFromState().filter((record) => record.id !== tabId));
  await saveState();
  await syncBlockStateForAllTabs();
}

async function handleTabCreated(tab) {
  if (!isTabLockActive()) return;

  // New tabs should stay blocked unless the user explicitly adds them via Manage Tabs.
  await syncBlockStateForTab(tab.id);
}

async function handleTabReplaced(addedTabId, removedTabId) {
  if (!isSessionActive()) return;
  const ids = getLockedTabIdsArray();
  if (!ids.includes(removedTabId)) return;

  let addedTab = null;
  try {
    addedTab = await chrome.tabs.get(addedTabId);
  } catch (_) {}

  const wasPrimary = state.lockedTabId === removedTabId;
  const rebuilt = [];
  for (const record of recordsFromState()) {
    if (record.id !== removedTabId) {
      rebuilt.push(record);
      continue;
    }
    if (addedTab) {
      rebuilt.push(recordFromTab(addedTab, wasPrimary));
    } else {
      rebuilt.push({ ...record, id: addedTabId, primary: wasPrimary });
    }
  }
  applyLockedRecords(rebuilt);
  await saveState();
  queueDeferredWork(async () => {
    await syncBlockStateForAllTabs();
    await injectReminderForTab(addedTabId);
  });
}

async function handleTabAttached(tabId, attachInfo) {
  if (!isSessionActive() || !getLockedTabIdSet().has(tabId)) return;
  if (tabId === state.lockedTabId) state.lockedWindowId = attachInfo.newWindowId;
  let changed = false;
  const records = recordsFromState().map((record) => {
    if (record.id !== tabId || record.windowId === attachInfo.newWindowId) return record;
    changed = true;
    return { ...record, windowId: attachInfo.newWindowId };
  });
  if (tabId === state.lockedTabId) changed = true;
  if (!changed) return;
  state.lockedTabRecords = records;
  await saveState();
}

async function enforceActiveTab(tabId, scheduledEpoch) {
  await healTabs();
  await ensurePomodoroArmed();
  if (scheduledEpoch !== sessionEpoch) return null;
  return beginRedirect(tabId, scheduledEpoch);
}

async function enforceWindow(windowId, scheduledEpoch) {
  await healTabs();
  await ensurePomodoroArmed();
  if (scheduledEpoch !== sessionEpoch || !isTabLockActive()) return null;
  if (windowId === chrome.windows.WINDOW_ID_NONE) return null;
  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId,
  });
  if (scheduledEpoch !== sessionEpoch || !activeTab) return null;
  return beginRedirect(activeTab.id, scheduledEpoch);
}

async function handleAlarm(alarm) {
  if (alarm?.name === ALARM_RECONCILE) {
    await reconcileTabsAfterRestart();
    await ensurePomodoroArmed();
    updateIcon();
    queueDeferredWork(syncBlockStateForAllTabs);
    return;
  }
  if (alarm?.name !== ALARM_FOCUS && alarm?.name !== ALARM_BREAK) return;
  if (state.mode !== "pomodoro") return;
  await healTabs();
  if (state.mode !== "pomodoro") return;
  const expected = state.pomodoroState === "break" ? ALARM_BREAK : ALARM_FOCUS;
  if (alarm.name !== expected) return;

  const now = Date.now();
  // The alarm is the signal that this phase ended. If it arrives before the stored
  // deadline (clock skew, or a test firing it early), start the next phase from now.
  // If it arrives late, keep the original deadlines so later phases do not drift.
  if (!isTimestamp(state.pomodoroEndTime) || state.pomodoroEndTime > now) {
    state.pomodoroEndTime = now;
  }
  completeDuePhases(now);
  await saveState();
  await armPomodoroAlarm();
  updateIcon();
  const resumedFocus = state.pomodoroState === "focus";
  queueDeferredWork(async () => {
    if (resumedFocus) await injectReminderForLockedTabs();
    await syncBlockStateForAllTabs();
  });
}

function wakeSession() {
  runStateTask(async () => {
    await ensurePomodoroArmed();
    await healTabs();
    updateIcon();
  })
    .then(() => {
      queueDeferredWork(syncBlockStateForAllTabs);
    })
    .catch(() => {});
}

function requestEndsSession(message) {
  return (
    message?.action === "unlockLock" ||
    message?.action === "lifeline" ||
    (message?.action === "toggleLock" && message?.intent === "unlock")
  );
}

chrome.tabs.onActivated.addListener((info) => {
  runStateTask((scheduledEpoch) => enforceActiveTab(info.tabId, scheduledEpoch), {
    abortIfUnlocked: true,
  })
    .then(continueRedirect)
    .catch(() => {});
});
chrome.tabs.onCreated.addListener((tab) => {
  runFreshStateEffect(() => handleTabCreated(tab));
});
chrome.tabs.onRemoved.addListener((tabId) => {
  runStateEvent(() => handleTabRemoved(tabId));
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    runStateTask(async () => {
      if (rememberTabUrl(tabId, changeInfo.url)) await saveState();
    });
  }
  if (changeInfo.status !== "loading" && changeInfo.status !== "complete") return;
  runFreshStateEffect(() => handleTabUpdated(tabId, changeInfo));
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  runStateEvent(() => handleTabReplaced(addedTabId, removedTabId));
});
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  runStateEvent(() => handleTabAttached(tabId, attachInfo));
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  runStateTask((scheduledEpoch) => enforceWindow(windowId, scheduledEpoch), {
    abortIfUnlocked: true,
  })
    .then(continueRedirect)
    .catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  runStateEvent(() => handleAlarm(alarm));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Unlock has to invalidate enforcement before the first await, or a tab switch
  // that was already queued can pull the user back after the session ends.
  if (requestEndsSession(message)) invalidateEnforcement();

  runStateTask(async (scheduledEpoch) => {
    switch (message.action) {
      case "getState":
        await ensurePomodoroArmed();
        await healTabs();
        updateIcon();
        return { state, pomodoroCycle: POMODORO_CYCLE };

      case "unlockLock":
        await disableLock();
        return { locked: false };

      case "getTabBlockState": {
        await healTabs();
        const tabId = sender?.tab?.id;
        return { blocked: shouldBlockTab(tabId) };
      }

      case "getLeaveDomainWarningState": {
        const tabId = sender?.tab?.id;
        return { enabled: shouldWarnOnLeaveDomain(tabId) };
      }

      case "setWrongTabInterstitial": {
        const v = message.value;
        if (v !== "breathing" && v !== "none") {
          return { error: "Invalid value" };
        }
        state.wrongTabInterstitial = v;
        await saveState();
        return { success: true };
      }

      case "setLeaveDomainWarning": {
        state.leaveDomainWarning = Boolean(message.value);
        await saveState();
        queueDeferredWork(syncBlockStateForAllTabs);
        return { success: true };
      }

      case "toggleLock": {
        const active = isSessionActive();
        if (message.intent === "lock") {
          if (active) {
            return {
              locked: true,
              tabId: state.lockedTabId,
              mode: state.mode,
              already: true,
            };
          }
        } else if (active || message.intent === "unlock") {
          if (active) await disableLock();
          return { locked: false };
        }

        const tab = await resolveTargetTab(message);
        if (!tab?.id) return { error: "No active tab" };
        await enableLock(tab, message.taskText);
        return { locked: true, tabId: tab.id, tabTitle: tab.title || "" };
      }

      case "startPomodoro": {
        if (state.mode === "pomodoro") {
          await ensurePomodoroArmed();
          return {
            success: true,
            already: true,
            tabId: state.lockedTabId,
            phase: state.pomodoroPhase,
            state: state.pomodoroState,
            endTime: state.pomodoroEndTime,
          };
        }

        const incomingTask = String(message.taskText || "").trim();
        if (state.mode !== "locked") {
          const tab = await resolveTargetTab(message);
          if (!tab?.id) return { error: "No active tab" };
          state.lockedTabId = tab.id;
          state.lockedTabIds = [tab.id];
          state.lockedWindowId = tab.windowId ?? null;
          state.lockedTabRecords = [recordFromTab(tab, true)];
          state.taskText = incomingTask;
        } else if (incomingTask) {
          state.taskText = incomingTask;
        }

        state.mode = "pomodoro";
        state.pomodoroPhase = 0;
        state.pomodoroState = "focus";
        state.pomodoroBreakDuration = POMODORO_CYCLE[0].break;
        state.pomodoroEndTime = Date.now() + POMODORO_CYCLE[0].focus * 60 * 1000;
        await saveState();
        await markLiveSession();
        await armPomodoroAlarm();
        updateIcon();
        queueDeferredWork(async () => {
          await injectReminderForLockedTabs();
          await syncBlockStateForAllTabs();
        });
        return {
          success: true,
          tabId: state.lockedTabId,
          tabTitle: "",
          phase: state.pomodoroPhase,
          state: state.pomodoroState,
          endTime: state.pomodoroEndTime,
        };
      }

      case "lifeline": {
        await disableLock();
        return { success: true };
      }

      case "addTabToLock": {
        if (!isSessionActive()) return { error: "No active lock session" };
        const tabId = message.tabId;
        if (!tabId) return { error: "No tab ID provided" };
        const ids = getLockedTabIdsArray();
        if (ids.includes(tabId)) return { error: "Tab already in locked set" };
        let tab = null;
        try {
          tab = await chrome.tabs.get(tabId);
        } catch (_) {}
        const records = recordsFromState();
        records.push(
          tab
            ? recordFromTab(tab, false)
            : { id: tabId, url: "", windowId: null, primary: false }
        );
        applyLockedRecords(records);
        await saveState();
        await markLiveSession();
        queueDeferredWork(async () => {
          await syncBlockStateForAllTabs();
          await injectReminderForTab(tabId);
        });
        return { success: true };
      }

      case "removeTabFromLock": {
        if (!isSessionActive()) return { error: "No active lock session" };
        const tabId = message.tabId;
        if (!tabId) return { error: "No tab ID provided" };
        if (tabId === state.lockedTabId) return { error: "Cannot remove primary locked tab" };
        const ids = getLockedTabIdsArray();
        if (!ids.includes(tabId)) return { error: "Tab not in locked set" };
        applyLockedRecords(recordsFromState().filter((record) => record.id !== tabId));
        await saveState();
        queueDeferredWork(async () => {
          await removeReminderFromTab(tabId);
          await syncBlockStateForAllTabs();
        });
        return { success: true };
      }

      case "getLockedTabs": {
        await healTabs();
        if (!isSessionActive()) return { tabs: [] };
        const ids = getLockedTabIdsArray();
        const tabInfos = [];
        for (const id of ids) {
          try {
            const tab = await chrome.tabs.get(id);
            tabInfos.push({
              id: tab.id,
              title: tab.title || "Untitled",
              favIconUrl: tab.favIconUrl || "",
              isPrimary: tab.id === state.lockedTabId,
            });
          } catch (_) {
            // Tab no longer exists
          }
        }
        return { tabs: tabInfos };
      }

      case "getAllTabs": {
        const tabs = await chrome.tabs.query({});
        const lockedSet = getLockedTabIdSet();
        const available = tabs
          .filter((t) => !lockedSet.has(t.id))
          .map((t) => ({
            id: t.id,
            title: t.title || "Untitled",
            favIconUrl: t.favIconUrl || "",
            windowId: t.windowId,
          }));
        return { tabs: available };
      }

      case "getCurrentTab": {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        return tab
          ? { id: tab.id, title: tab.title || "Untitled" }
          : { error: "No active tab" };
      }

      case "focusLockedTabAfterBreathing": {
        if (scheduledEpoch !== sessionEpoch) return { success: false };
        await healTabs();
        const fromTabId = sender?.tab?.id;
        if (
          scheduledEpoch !== sessionEpoch ||
          !isTabLockActive() ||
          !state.lockedTabId ||
          !shouldBlockTab(fromTabId)
        ) {
          return { success: false };
        }
        const lockedTabId = state.lockedTabId;
        const lockedWindowId = state.lockedWindowId;
        try {
          await chrome.tabs.update(lockedTabId, { active: true });
          if (scheduledEpoch !== sessionEpoch || !shouldBlockTab(fromTabId)) {
            return { success: false };
          }
          if (lockedWindowId != null) {
            await chrome.windows.update(lockedWindowId, { focused: true });
          }
          if (fromTabId) {
            await removeBreathingOverlayFromTab(fromTabId);
            await syncBlockStateForTab(fromTabId);
          }
        } catch (_) {
          return { success: false };
        }
        return { success: true };
      }

      default:
        return { error: "Unknown action" };
    }
  })
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true;
});

/** Extension reload keeps tab ids. A browser restart does not, so only updates take this path. */
async function adoptExistingTabIds() {
  if (!isSessionActive() || (await hasLiveSession())) return false;
  const next = [];
  for (const record of recordsFromState()) {
    try {
      const tab = await chrome.tabs.get(record.id);
      next.push({
        id: tab.id,
        url: tabUrl(tab) || record.url || "",
        windowId: tab.windowId ?? record.windowId ?? null,
        index: typeof tab.index === "number" ? tab.index : record.index,
        primary: record.primary,
      });
    } catch (_) {}
  }
  if (!next.some((record) => record.id === state.lockedTabId)) return false;
  if (lockedIdentityChanged(next)) {
    applyLockedRecords(next);
    await saveState();
  }
  await markLiveSession();
  return true;
}

chrome.runtime.onStartup.addListener(() => {
  wakeSession();
});

chrome.runtime.onInstalled.addListener((details) => {
  const extensionUpdate = details?.reason === "update";
  runStateTask(async () => {
    if (extensionUpdate) await adoptExistingTabIds();
    await ensurePomodoroArmed();
    await healTabs();
    updateIcon();
  })
    .then(() => {
      queueDeferredWork(syncBlockStateForAllTabs);
    })
    .catch(() => {});
});
