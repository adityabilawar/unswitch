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
  /** "breathing" = 10s inhale/exhale ritual then locked UI; "none" = full-screen tab lock only. */
  wrongTabInterstitial: "breathing",
  pomodoroPhase: 0,
  pomodoroState: null,
  pomodoroEndTime: null,
  pomodoroBreakDuration: null,
};

let state = { ...DEFAULT_STATE };

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

function shouldBlockTab(tabId) {
  return Boolean(isTabLockActive() && tabId && !getLockedTabIdSet().has(tabId));
}

function shouldWarnOnLeaveDomain(tabId) {
  return Boolean(isTabLockActive() && tabId && getLockedTabIdSet().has(tabId));
}

async function ensureBlockerInjected(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/blocker.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/blocker.js"],
    });
  } catch (_) {
    // Restricted targets (chrome://, extension pages, etc)
  }
}

async function syncBlockStateForTab(tabId) {
  if (!tabId) return;
  await ensureBlockerInjected(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "unswitch-set-block-state",
      blocked: shouldBlockTab(tabId),
    });
  } catch (_) {
    // Content script unavailable in this tab
  }
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "unswitch-set-leave-domain-warning-state",
      enabled: shouldWarnOnLeaveDomain(tabId),
    });
  } catch (_) {
    // Leave-domain script unavailable in this tab
  }
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
  return (state.wrongTabInterstitial || "breathing") === "breathing";
}

/** Sync blocker on wrong tab; optionally inject the breathing ritual overlay. */
async function showWrongTabFeedback(tabId) {
  await syncBlockStateForTab(tabId);
  if (!useBreathingRitualOnWrongTab()) {
    scheduleBounceToLockedTab();
    return;
  }
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
        const el = document.getElementById("unswitch-overlay");
        if (el) el.remove();
      },
    });
  } catch (_) {}
}

/** Time to show the full-screen lock UI on a wrong tab before focusing the locked tab again. */
const TAB_LOCK_ONLY_BOUNCE_MS = 900;

/** After the lock screen is shown on a wrong tab, focus the primary locked tab. */
function scheduleBounceToLockedTab() {
  const lockedTabId = state.lockedTabId;
  const lockedWindowId = state.lockedWindowId;
  if (!lockedTabId) return;
  setTimeout(() => {
    chrome.tabs.update(lockedTabId, { active: true }).catch(() => {});
    if (lockedWindowId != null) {
      chrome.windows.update(lockedWindowId, { focused: true }).catch(() => {});
    }
  }, TAB_LOCK_ONLY_BOUNCE_MS);
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
  await saveState();
  updateIcon();
  chrome.alarms.clear(ALARM_FOCUS);
  chrome.alarms.clear(ALARM_BREAK);
  queueDeferredWork(async () => {
    for (const id of tabIdsToClean) {
      await removeReminderFromTab(id);
    }
    await syncBlockStateForAllTabs();
  });
}

async function handleTabActivated(activeInfo) {
  await loadState();
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
  await loadState();
  if (!isTabLockActive()) return;
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
  await loadState();
  if (!isTabLockActive()) return;

  // New tabs should stay blocked unless the user explicitly adds them via Manage Tabs.
  await syncBlockStateForTab(tab.id);
}

async function handleWindowFocusChanged(windowId) {
  await loadState();
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

function schedulePomodoroAlarm() {
  const phase = POMODORO_CYCLE[state.pomodoroPhase];
  const isFocus = state.pomodoroState === "focus";
  const durationMinutes = isFocus ? phase.focus : phase.break;

  state.pomodoroEndTime = Date.now() + durationMinutes * 60 * 1000;
  state.pomodoroBreakDuration = isFocus ? phase.break : null;
  saveState();

  const alarmName = isFocus ? ALARM_FOCUS : ALARM_BREAK;
  chrome.alarms.create(alarmName, { when: state.pomodoroEndTime });
}

async function handleAlarm(alarm) {
  if (alarm.name === ALARM_FOCUS) {
    state.pomodoroState = "break";
    state.pomodoroPhase = (state.pomodoroPhase + 1) % POMODORO_CYCLE.length;
    schedulePomodoroAlarm();
    updateIcon();
    await syncBlockStateForAllTabs();
  } else if (alarm.name === ALARM_BREAK) {
    state.pomodoroState = "focus";
    schedulePomodoroAlarm();
    updateIcon();
    await injectReminderForLockedTabs();
    await syncBlockStateForAllTabs();
  }
}

chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.tabs.onCreated.addListener(handleTabCreated);
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.tabs.onUpdated.addListener(handleTabUpdated);
chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
chrome.alarms.onAlarm.addListener(handleAlarm);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    await loadState();

    switch (message.action) {
      case "getState":
        return { state, pomodoroCycle: POMODORO_CYCLE };

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
        schedulePomodoroAlarm();
        await saveState();
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
        if (!isTabLockActive()) return { error: "No active lock session" };
        const tabId = message.tabId;
        if (!tabId) return { error: "No tab ID provided" };
        const ids = getLockedTabIdsArray();
        if (ids.includes(tabId)) return { error: "Tab already in locked set" };
        state.lockedTabIds = [...ids, tabId];
        await saveState();
        await syncBlockStateForAllTabs();
        await injectReminderForTab(tabId);
        return { success: true };
      }

      case "removeTabFromLock": {
        if (!isTabLockActive()) return { error: "No active lock session" };
        const tabId = message.tabId;
        if (!tabId) return { error: "No tab ID provided" };
        if (tabId === state.lockedTabId) return { error: "Cannot remove primary locked tab" };
        const ids = getLockedTabIdsArray();
        if (!ids.includes(tabId)) return { error: "Tab not in locked set" };
        state.lockedTabIds = ids.filter((id) => id !== tabId);
        await saveState();
        await removeReminderFromTab(tabId);
        await syncBlockStateForAllTabs();
        return { success: true };
      }

      case "getLockedTabs": {
        if (!isTabLockActive()) return { tabs: [] };
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
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true;
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  updateIcon();
  await syncBlockStateForAllTabs();
});

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  updateIcon();
  await syncBlockStateForAllTabs();
});
