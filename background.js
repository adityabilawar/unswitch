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
const STORAGE_KEY = "unswitch-state";

const DEFAULT_STATE = {
  mode: "off",
  lockedTabId: null,
  /** All tab IDs allowed while locked (primary tab plus any tabs added manually). */
  lockedTabIds: null,
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

/** Serialize stateful events. MV3 may deliver tab, alarm, and popup events concurrently. */
let stateTaskChain = Promise.resolve();
function runStateTask(task) {
  const run = stateTaskChain.then(async () => {
    await loadState();
    return task();
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
  return state;
}

function getLockedTabIdsArray() {
  if (state.lockedTabIds?.length) return state.lockedTabIds;
  return state.lockedTabId ? [state.lockedTabId] : [];
}

function getLockedTabIdSet() {
  return new Set(getLockedTabIdsArray());
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

/** Sync blocker on wrong tab; optionally inject the breathing ritual overlay. */
async function showWrongTabFeedback(tabId) {
  if (!useBreathingRitualOnWrongTab()) {
    // Returning to work must not wait for a page's content scripts to respond.
    scheduleBounceToLockedTab();
    queueDeferredWork(() => syncBlockStateForTab(tabId));
    return;
  }
  await syncBlockStateForTab(tabId);
  // An unlock may have occurred while the page synchronization was pending.
  if (!shouldBlockTab(tabId)) return;
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
    scheduleBounceToLockedTab();
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

/** After the lock screen is shown on a wrong tab, focus the primary locked tab. */
function scheduleBounceToLockedTab() {
  const lockedTabId = state.lockedTabId;
  const lockedWindowId = state.lockedWindowId;
  if (!lockedTabId) return;
  // MV3 workers can be suspended before a timer fires, so perform the redirect now.
  chrome.tabs.update(lockedTabId, { active: true }).catch(() => {});
  if (lockedWindowId != null) {
    chrome.windows.update(lockedWindowId, { focused: true }).catch(() => {});
  }
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
  const tabIdsToClean = getLockedTabIdsArray();
  state.mode = "off";
  state.lockedTabId = null;
  state.lockedTabIds = null;
  state.lockedWindowId = null;
  state.taskText = "";
  state.pomodoroState = null;
  state.pomodoroEndTime = null;
  state.pomodoroBreakDuration = null;
  state.pomodoroPhase = 0;
  await saveState();
  updateIcon();
  await Promise.all([chrome.alarms.clear(ALARM_FOCUS), chrome.alarms.clear(ALARM_BREAK)]);
  queueDeferredWork(async () => {
    for (const id of tabIdsToClean) {
      await removeReminderFromTab(id);
    }
    await syncBlockStateForAllTabs();
  });
}

async function handleTabActivated(activeInfo) {
  if (!isTabLockActive()) return;
  if (getLockedTabIdSet().has(activeInfo.tabId)) return;

  await showWrongTabFeedback(activeInfo.tabId);
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
  state.lockedTabIds = ids.filter((id) => id !== tabId);
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

  state.lockedTabIds = ids.map((id) => (id === removedTabId ? addedTabId : id));
  if (state.lockedTabId === removedTabId) {
    state.lockedTabId = addedTabId;
    try {
      const tab = await chrome.tabs.get(addedTabId);
      state.lockedWindowId = tab.windowId;
    } catch (_) {}
  }
  await saveState();
  queueDeferredWork(async () => {
    await syncBlockStateForAllTabs();
    await injectReminderForTab(addedTabId);
  });
}

async function handleTabAttached(tabId, attachInfo) {
  if (!isSessionActive() || tabId !== state.lockedTabId) return;
  state.lockedWindowId = attachInfo.newWindowId;
  await saveState();
}

async function handleWindowFocusChanged(windowId) {
  if (!isTabLockActive()) return;
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId,
  });

  if (activeTab && !getLockedTabIdSet().has(activeTab.id)) {
    await showWrongTabFeedback(activeTab.id);
  }
}

async function schedulePomodoroAlarm() {
  const phase = POMODORO_CYCLE[state.pomodoroPhase];
  const isFocus = state.pomodoroState === "focus";
  const durationMinutes = isFocus ? phase.focus : phase.break;

  state.pomodoroEndTime = Date.now() + durationMinutes * 60 * 1000;
  state.pomodoroBreakDuration = isFocus ? phase.break : null;
  await saveState();

  const alarmName = isFocus ? ALARM_FOCUS : ALARM_BREAK;
  const staleAlarmName = isFocus ? ALARM_BREAK : ALARM_FOCUS;
  await chrome.alarms.clear(staleAlarmName);
  await chrome.alarms.create(alarmName, { when: state.pomodoroEndTime });
}

async function handleAlarm(alarm) {
  if (state.mode !== "pomodoro") return;
  if (alarm.name === ALARM_FOCUS && state.pomodoroState === "focus") {
    state.pomodoroState = "break";
    await schedulePomodoroAlarm();
    updateIcon();
    queueDeferredWork(syncBlockStateForAllTabs);
  } else if (alarm.name === ALARM_BREAK && state.pomodoroState === "break") {
    state.pomodoroPhase = (state.pomodoroPhase + 1) % POMODORO_CYCLE.length;
    state.pomodoroState = "focus";
    await schedulePomodoroAlarm();
    updateIcon();
    queueDeferredWork(async () => {
      await injectReminderForLockedTabs();
      await syncBlockStateForAllTabs();
    });
  }
}

chrome.tabs.onActivated.addListener((info) => {
  runFreshStateEffect(() => handleTabActivated(info));
});
chrome.tabs.onCreated.addListener((tab) => {
  runFreshStateEffect(() => handleTabCreated(tab));
});
chrome.tabs.onRemoved.addListener((tabId) => {
  runStateEvent(() => handleTabRemoved(tabId));
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  runFreshStateEffect(() => handleTabUpdated(tabId, changeInfo));
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  runStateEvent(() => handleTabReplaced(addedTabId, removedTabId));
});
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  runStateEvent(() => handleTabAttached(tabId, attachInfo));
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  runFreshStateEffect(() => handleWindowFocusChanged(windowId));
});
chrome.alarms.onAlarm.addListener((alarm) => {
  runStateEvent(() => handleAlarm(alarm));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  runStateTask(async () => {
    switch (message.action) {
      case "getState":
        return { state, pomodoroCycle: POMODORO_CYCLE };

      case "unlockLock":
        await disableLock();
        return { locked: false };

      case "getTabBlockState": {
        const tabId = _sender?.tab?.id;
        return { blocked: shouldBlockTab(tabId) };
      }

      case "getLeaveDomainWarningState": {
        const tabId = _sender?.tab?.id;
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
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab) return { error: "No active tab" };

        if (state.mode === "locked" || state.mode === "pomodoro") {
          await disableLock();
          return { locked: false };
        }

        state.mode = "locked";
        state.lockedTabId = tab.id;
        state.lockedTabIds = [tab.id];
        state.lockedWindowId = tab.windowId;
        state.taskText = (message.taskText || "").trim();
        await saveState();
        updateIcon();
        queueDeferredWork(async () => {
          await injectReminderForLockedTabs();
          await syncBlockStateForAllTabs();
        });
        return { locked: true, tabId: tab.id, tabTitle: tab.title };
      }

      case "startPomodoro": {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab) return { error: "No active tab" };

        state.mode = "pomodoro";
        state.lockedTabId = tab.id;
        state.lockedTabIds = [tab.id];
        state.lockedWindowId = tab.windowId;
        state.taskText = (message.taskText || "").trim();
        state.pomodoroPhase = 0;
        state.pomodoroState = "focus";
        await schedulePomodoroAlarm();
        updateIcon();
        queueDeferredWork(async () => {
          await injectReminderForLockedTabs();
          await syncBlockStateForAllTabs();
        });
        return {
          success: true,
          tabId: tab.id,
          tabTitle: tab.title,
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
        state.lockedTabIds = [...ids, tabId];
        await saveState();
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
        state.lockedTabIds = ids.filter((id) => id !== tabId);
        await saveState();
        queueDeferredWork(async () => {
          await removeReminderFromTab(tabId);
          await syncBlockStateForAllTabs();
        });
        return { success: true };
      }

      case "getLockedTabs": {
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
        const fromTabId = _sender?.tab?.id;
        if (!isTabLockActive() || !state.lockedTabId) {
          return { success: false };
        }
        try {
          await chrome.tabs.update(state.lockedTabId, { active: true });
          if (state.lockedWindowId != null) {
            await chrome.windows.update(state.lockedWindowId, { focused: true });
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

chrome.runtime.onStartup.addListener(() => {
  runFreshStateEffect(async () => {
    updateIcon();
    await syncBlockStateForAllTabs();
  });
});

chrome.runtime.onInstalled.addListener(() => {
  runFreshStateEffect(async () => {
    updateIcon();
    await syncBlockStateForAllTabs();
  });
});
