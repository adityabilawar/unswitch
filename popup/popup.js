/**
 * Unswitch - Popup UI logic
 */

const lockToggle = document.getElementById("lockToggle");
const lockIcon = document.getElementById("lockIcon");
const lockLabel = document.getElementById("lockLabel");
const tabInfo = document.getElementById("tabInfo");
const taskInput = document.getElementById("taskInput");
const taskInputWrap = document.getElementById("taskInputWrap");
const taskDisplay = document.getElementById("taskDisplay");
const taskDisplayText = document.getElementById("taskDisplayText");
const pomodoroInactive = document.getElementById("pomodoroInactive");
const pomodoroActive = document.getElementById("pomodoroActive");
const startPomodoro = document.getElementById("startPomodoro");
const countdown = document.getElementById("countdown");
const phaseLabel = document.getElementById("phaseLabel");
const breakInfo = document.getElementById("breakInfo");
const tabManager = document.getElementById("tabManager");
const tabManagerToggle = document.getElementById("tabManagerToggle");
const tabManagerArrow = document.getElementById("tabManagerArrow");
const tabManagerBody = document.getElementById("tabManagerBody");
const lockedTabList = document.getElementById("lockedTabList");
const addTabBtn = document.getElementById("addTabBtn");
const addTabPicker = document.getElementById("addTabPicker");
const availableTabList = document.getElementById("availableTabList");
const lifelineBtn = document.getElementById("lifelineBtn");
const lifelineHint = document.getElementById("lifelineHint");
const wrongTabInterstitial = document.getElementById("wrongTabInterstitial");

const UNSWITCH_STATE_KEY = "unswitch-state";

const LIFELINE_HOLD_MS = 5000;

/** Merge preference into storage so it persists even if the service worker is stale. */
async function persistWrongTabInterstitial(value) {
  if (value !== "breathing" && value !== "none") return;
  const stored = await chrome.storage.local.get(UNSWITCH_STATE_KEY);
  const prev = stored[UNSWITCH_STATE_KEY] || {};
  await chrome.storage.local.set({
    [UNSWITCH_STATE_KEY]: { ...prev, wrongTabInterstitial: value },
  });
  await sendMessage("getState");
}

function sendMessage(action, data = {}) {
  return chrome.runtime.sendMessage({ action, ...data });
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

let _prevInSession = false;
/** First unlock click shows confirmation on the button; second click unlocks. */
let _unlockConfirmPending = false;

function updateLockUI(locked, tabTitle, taskText, inSession) {
  lockToggle.classList.toggle("locked", locked);
  lockToggle.classList.toggle("unlock-confirm", locked && _unlockConfirmPending);
  lockIcon.textContent = locked ? "🔒" : "🔓";
  if (!locked) {
    _unlockConfirmPending = false;
  }
  if (locked && _unlockConfirmPending) {
    lockLabel.textContent = "Are you sure? Tap again";
  } else {
    lockLabel.textContent = locked ? "Unlock Tab" : "Lock Tab";
  }
  tabInfo.textContent = tabTitle ? `Locked to: ${tabTitle}` : "Select a tab to lock";

  if (inSession) {
    taskInputWrap.classList.add("hidden");
    if (taskText) {
      taskDisplay.classList.remove("hidden");
      taskDisplayText.textContent = taskText;
    } else {
      taskDisplay.classList.add("hidden");
    }
  } else {
    taskInputWrap.classList.remove("hidden");
    taskDisplay.classList.add("hidden");
    if (_prevInSession) {
      taskInput.value = "";
    }
  }
  _prevInSession = inSession;

  if (inSession) {
    tabManager.classList.remove("hidden");
  } else {
    tabManager.classList.add("hidden");
    tabManagerBody.classList.add("hidden");
    tabManagerArrow.classList.remove("expanded");
    addTabPicker.classList.add("hidden");
    addTabBtn.classList.remove("active");
  }
}

function createFaviconEl(favIconUrl) {
  if (favIconUrl) {
    const img = document.createElement("img");
    img.className = "tab-favicon";
    img.src = favIconUrl;
    img.alt = "";
    img.onerror = () => {
      const placeholder = document.createElement("span");
      placeholder.className = "tab-favicon-placeholder";
      img.replaceWith(placeholder);
    };
    return img;
  }
  const placeholder = document.createElement("span");
  placeholder.className = "tab-favicon-placeholder";
  return placeholder;
}

async function renderLockedTabs() {
  const res = await sendMessage("getLockedTabs");
  if (!res || !res.tabs) return;
  lockedTabList.innerHTML = "";
  for (const tab of res.tabs) {
    const li = document.createElement("li");
    li.className = "locked-tab-item";

    li.appendChild(createFaviconEl(tab.favIconUrl));

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;
    li.appendChild(title);

    if (tab.isPrimary) {
      const badge = document.createElement("span");
      badge.className = "tab-primary-badge";
      badge.textContent = "primary";
      li.appendChild(badge);
    } else {
      const removeBtn = document.createElement("button");
      removeBtn.className = "tab-remove-btn";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove from locked tabs";
      removeBtn.addEventListener("click", async () => {
        await sendMessage("removeTabFromLock", { tabId: tab.id });
        await renderLockedTabs();
        await refreshState();
      });
      li.appendChild(removeBtn);
    }

    lockedTabList.appendChild(li);
  }
}

async function renderAvailableTabs() {
  const res = await sendMessage("getAllTabs");
  availableTabList.innerHTML = "";
  if (!res || !res.tabs || res.tabs.length === 0) {
    const empty = document.createElement("li");
    empty.className = "available-tab-list-empty";
    empty.textContent = "No other tabs available";
    availableTabList.appendChild(empty);
    return;
  }
  for (const tab of res.tabs) {
    const li = document.createElement("li");
    li.className = "available-tab-item";

    li.appendChild(createFaviconEl(tab.favIconUrl));

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;
    li.appendChild(title);

    li.addEventListener("click", async () => {
      await sendMessage("addTabToLock", { tabId: tab.id });
      addTabPicker.classList.add("hidden");
      addTabBtn.classList.remove("active");
      await renderLockedTabs();
      await refreshState();
    });

    availableTabList.appendChild(li);
  }
}

function updatePomodoroUI(data) {
  if (!data || data.state.mode !== "pomodoro") {
    pomodoroInactive.classList.remove("hidden");
    pomodoroActive.classList.add("hidden");
    return;
  }

  pomodoroInactive.classList.add("hidden");
  pomodoroActive.classList.remove("hidden");

  const endTime = data.state.pomodoroEndTime;
  const isBreak = data.state.pomodoroState === "break";
  phaseLabel.textContent = isBreak ? "Break" : "Focus";
  phaseLabel.classList.toggle("break", isBreak);

  if (data.state.pomodoroBreakDuration) {
    breakInfo.textContent = `Next break: ${data.state.pomodoroBreakDuration} min`;
  } else if (isBreak) {
    breakInfo.textContent = "Next focus: 60 min";
  } else {
    breakInfo.textContent = "";
  }

  if (endTime) {
    const remaining = endTime - Date.now();
    countdown.textContent = formatTime(remaining);
  }
}

async function refreshState() {
  try {
    const res = await sendMessage("getState");
    if (res.error) return null;

    const isLocked =
      res.state.mode === "locked" ||
      (res.state.mode === "pomodoro" && res.state.pomodoroState === "focus");
    const inSession = res.state.mode === "locked" || res.state.mode === "pomodoro";

    let tabTitle = "";
    if (res.state.lockedTabId) {
      try {
        const tab = await chrome.tabs.get(res.state.lockedTabId);
        tabTitle = tab.title || "Untitled";
        const extra =
          res.state.lockedTabIds?.length > 1 ? res.state.lockedTabIds.length - 1 : 0;
        if (extra > 0) tabTitle += ` (+${extra} more)`;
      } catch (_) {
        tabTitle = "Tab closed";
      }
    } else {
      const tabRes = await sendMessage("getCurrentTab");
      tabTitle = tabRes.title || "No tab";
    }

    updateLockUI(isLocked, tabTitle, res.state.taskText || "", inSession);
    if (wrongTabInterstitial) {
      const serverVal = res.state.wrongTabInterstitial;
      const nextSelect = serverVal === "none" ? "none" : "breathing";
      wrongTabInterstitial.value = nextSelect;
    }
    updatePomodoroUI(res);
    if (inSession && !tabManagerBody.classList.contains("hidden")) {
      await renderLockedTabs();
    }
    return res;
  } catch (e) {
    tabInfo.textContent = "Error loading state";
    return null;
  }
}

lockToggle.addEventListener("click", async () => {
  const task = taskInput.value.trim();
  if (!task && !_prevInSession) {
    taskInput.classList.add("error");
    taskInput.focus();
    taskInput.placeholder = "Please enter a task first";
    return;
  }
  taskInput.classList.remove("error");

  /** Matches refreshState / updateLockUI; avoids an extra getState round-trip per click. */
  const currentlyLocked = lockToggle.classList.contains("locked");

  if (currentlyLocked && !_unlockConfirmPending) {
    _unlockConfirmPending = true;
    lockToggle.classList.add("unlock-confirm");
    lockLabel.textContent = "Are you sure? Tap again";
    return;
  }

  if (currentlyLocked) {
    _unlockConfirmPending = false;
    lockToggle.classList.remove("unlock-confirm");
  }

  const res = await sendMessage("toggleLock", { taskText: task });
  if (res.error) {
    tabInfo.textContent = res.error;
    return;
  }
  await refreshState();
});

startPomodoro.addEventListener("click", async () => {
  const task = taskInput.value.trim();
  if (!task) {
    taskInput.classList.add("error");
    taskInput.focus();
    taskInput.placeholder = "Please enter a task first";
    return;
  }
  taskInput.classList.remove("error");
  const res = await sendMessage("startPomodoro", { taskText: task });
  if (res.error) {
    tabInfo.textContent = res.error;
    return;
  }
  await refreshState();
});

let lifelineHoldTimer = null;

function startLifelineHold() {
  lifelineBtn.classList.add("holding");
  let elapsed = 0;
  const interval = 100;

  lifelineHoldTimer = setInterval(() => {
    elapsed += interval;
    lifelineHint.textContent = `Hold ${Math.ceil((LIFELINE_HOLD_MS - elapsed) / 1000)}s...`;
    if (elapsed >= LIFELINE_HOLD_MS) {
      clearInterval(lifelineHoldTimer);
      lifelineHoldTimer = null;
      cancelLifeline();
    }
  }, interval);
}

function cancelLifelineHold() {
  if (lifelineHoldTimer) {
    clearInterval(lifelineHoldTimer);
    lifelineHoldTimer = null;
  }
  lifelineBtn.classList.remove("holding");
  lifelineHint.textContent = "Hold 5 sec to cancel";
}

async function cancelLifeline() {
  await sendMessage("lifeline");
  cancelLifelineHold();
  await refreshState();
}

lifelineBtn.addEventListener("mousedown", (e) => {
  if (e.button === 0) startLifelineHold();
});

lifelineBtn.addEventListener("mouseup", cancelLifelineHold);
lifelineBtn.addEventListener("mouseleave", cancelLifelineHold);

lifelineBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  startLifelineHold();
});

lifelineBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  cancelLifelineHold();
});

lifelineBtn.addEventListener("touchcancel", cancelLifelineHold);

tabManagerToggle.addEventListener("click", async () => {
  const isExpanding = tabManagerBody.classList.contains("hidden");
  tabManagerBody.classList.toggle("hidden");
  tabManagerArrow.classList.toggle("expanded");
  if (isExpanding) {
    await renderLockedTabs();
  } else {
    addTabPicker.classList.add("hidden");
    addTabBtn.classList.remove("active");
  }
});

addTabBtn.addEventListener("click", async () => {
  const isOpening = addTabPicker.classList.contains("hidden");
  addTabPicker.classList.toggle("hidden");
  addTabBtn.classList.toggle("active");
  if (isOpening) {
    await renderAvailableTabs();
  }
});

taskInput.addEventListener("input", () => {
  if (taskInput.value.trim()) {
    taskInput.classList.remove("error");
    taskInput.placeholder = "What do you need to finish?";
  }
});

wrongTabInterstitial?.addEventListener("change", async () => {
  const chosen = wrongTabInterstitial.value;
  if (chosen !== "breathing" && chosen !== "none") return;

  await persistWrongTabInterstitial(chosen);

  const res = await sendMessage("setWrongTabInterstitial", { value: chosen });

  if (res?.error && res.error !== "Unknown action") {
    tabInfo.textContent = res.error;
  }

  await refreshState();
});

refreshState();
const timerInterval = setInterval(refreshState, 1000);

window.addEventListener("unload", () => clearInterval(timerInterval));
