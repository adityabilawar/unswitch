/**
 * Unswitch - Tab Lock Chrome Extension
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
  lockedWindowId: null,
  pomodoroPhase: 0,
  pomodoroState: null,
  pomodoroEndTime: null,
  pomodoroBreakDuration: null,
};

let state = { ...DEFAULT_STATE };

async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  state = { ...DEFAULT_STATE, ...result[STORAGE_KEY] };
  return state;
}

async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function isTabLockActive() {
  return (
    (state.mode === "locked" || (state.mode === "pomodoro" && state.pomodoroState === "focus")) &&
    state.lockedTabId
  );
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

async function showOverlayAndSwitchBack(tabId) {
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
    // chrome:// or extension pages - can't inject, just switch back
  }

  setTimeout(async () => {
    try {
      await chrome.tabs.update(state.lockedTabId, { active: true });
      const tab = await chrome.tabs.get(state.lockedTabId);
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (e) {
      // Locked tab may have been closed
      await disableLock();
    }
  }, 300);
}

async function disableLock() {
  state.mode = "off";
  state.lockedTabId = null;
  state.lockedWindowId = null;
  await saveState();
  updateIcon();
  chrome.alarms.clear(ALARM_FOCUS);
  chrome.alarms.clear(ALARM_BREAK);
}

async function handleTabActivated(activeInfo) {
  if (!isTabLockActive()) return;
  if (activeInfo.tabId === state.lockedTabId) return;

  await showOverlayAndSwitchBack(activeInfo.tabId);
}

async function handleTabRemoved(tabId) {
  if (tabId === state.lockedTabId) {
    await disableLock();
  }
}

async function handleWindowFocusChanged(windowId) {
  if (!isTabLockActive()) return;
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId,
  });

  if (activeTab && activeTab.id !== state.lockedTabId) {
    await showOverlayAndSwitchBack(activeTab.id);
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
  } else if (alarm.name === ALARM_BREAK) {
    state.pomodoroState = "focus";
    schedulePomodoroAlarm();
    updateIcon();
  }
}

chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
chrome.alarms.onAlarm.addListener(handleAlarm);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    await loadState();

    switch (message.action) {
      case "getState":
        return { state, pomodoroCycle: POMODORO_CYCLE };

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
        state.lockedWindowId = tab.windowId;
        await saveState();
        updateIcon();
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
        state.lockedWindowId = tab.windowId;
        state.pomodoroPhase = 0;
        state.pomodoroState = "focus";
        schedulePomodoroAlarm();
        await saveState();
        updateIcon();
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

      case "getCurrentTab": {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        return tab
          ? { id: tab.id, title: tab.title || "Untitled" }
          : { error: "No active tab" };
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
});

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  updateIcon();
});
