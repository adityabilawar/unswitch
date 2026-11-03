/**
 * Tab Lock – Focus Mode - Popup UI logic
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
const leaveDomainWarning = document.getElementById("leaveDomainWarning");

const LIFELINE_HOLD_MS = 5000;
const MESSAGE_TIMEOUT_MS = 4000;

function sendMessage(action, data = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(response);
    };
    const timeoutId = window.setTimeout(() => {
      finish({ error: "Tab Lock did not respond. Reload the extension and try again." });
    }, MESSAGE_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          finish({ error: "Tab Lock could not start. Reload the extension and try again." });
          return;
        }
        finish(response || { error: "Tab Lock returned no response." });
      });
    } catch (_) {
      finish({ error: "Tab Lock could not start. Reload the extension and try again." });
    }
  });
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

let _prevInSession = false;

function updateLockUI(locked, tabTitle, taskText, inSession, mode, pomodoroState) {
  lockToggle.classList.toggle("locked", inSession);
  lockIcon.textContent =
    mode === "pomodoro" ? (pomodoroState === "break" ? "☕" : "⏱") : locked ? "🔒" : "🔓";
  lockLabel.textContent =
    mode === "pomodoro" ? "End Pomodoro" : inSession ? "Unlock Tab" : "Lock Tab";
  const tabPrefix = mode === "pomodoro" && pomodoroState === "break" ? "Focus resumes on" : "Focus tab";
  tabInfo.textContent = tabTitle ? `${tabPrefix}: ${tabTitle}` : "Select a tab to lock";

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

let refreshGeneration = 0;
async function refreshState() {
  const generation = ++refreshGeneration;
  try {
    const res = await sendMessage("getState");
    if (res.error) {
      tabInfo.textContent = res.error;
      return null;
    }

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

    if (generation !== refreshGeneration) return null;
    updateLockUI(
      isLocked,
      tabTitle,
      res.state.taskText || "",
      inSession,
      res.state.mode,
      res.state.pomodoroState
    );
    if (wrongTabInterstitial) {
      const serverVal = res.state.wrongTabInterstitial;
      const nextSelect = serverVal === "breathing" ? "breathing" : "none";
      wrongTabInterstitial.value = nextSelect;
    }
    if (leaveDomainWarning) {
      leaveDomainWarning.checked = Boolean(res.state.leaveDomainWarning);
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
  if (lockToggle.disabled) return;
  const task = taskInput.value.trim();
  taskInput.classList.remove("error");

  /** Matches refreshState / updateLockUI; avoids an extra getState round-trip per click. */
  const currentlyLocked = lockToggle.classList.contains("locked");

  lockToggle.disabled = true;
  ++refreshGeneration;
  const res = await sendMessage(currentlyLocked ? "unlockLock" : "toggleLock", { taskText: task });
  lockToggle.disabled = false;
  if (res.error) {
    tabInfo.textContent = res.error;
    return;
  }
  await refreshState();
});

startPomodoro.addEventListener("click", async () => {
  const task = taskInput.value.trim();
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
  taskInput.classList.remove("error");
});

wrongTabInterstitial?.addEventListener("change", async () => {
  const chosen = wrongTabInterstitial.value;
  if (chosen !== "breathing" && chosen !== "none") return;

  const res = await sendMessage("setWrongTabInterstitial", { value: chosen });

  if (res?.error && res.error !== "Unknown action") {
    tabInfo.textContent = res.error;
  }

  await refreshState();
});

leaveDomainWarning?.addEventListener("change", async () => {
  const res = await sendMessage("setLeaveDomainWarning", {
    value: leaveDomainWarning.checked,
  });
  if (res?.error) tabInfo.textContent = res.error;
  await refreshState();
});

lifelineBtn.addEventListener("keydown", (event) => {
  if ((event.key === " " || event.key === "Enter") && !event.repeat) {
    event.preventDefault();
    startLifelineHold();
  }
});

lifelineBtn.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") cancelLifelineHold();
});

refreshState();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["unswitch-state"]) refreshState();
});
const timerInterval = setInterval(refreshState, 1000);

window.addEventListener("unload", () => clearInterval(timerInterval));
