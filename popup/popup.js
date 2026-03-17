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
const lifelineBtn = document.getElementById("lifelineBtn");
const lifelineHint = document.getElementById("lifelineHint");

const LIFELINE_HOLD_MS = 5000;

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

function updateLockUI(locked, tabTitle, taskText, inSession) {
  lockToggle.classList.toggle("locked", locked);
  lockIcon.textContent = locked ? "🔒" : "🔓";
  lockLabel.textContent = locked ? "Unlock Tab" : "Lock Tab";
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
    if (res.error) return;

    const isLocked =
      res.state.mode === "locked" ||
      (res.state.mode === "pomodoro" && res.state.pomodoroState === "focus");
    const inSession = res.state.mode === "locked" || res.state.mode === "pomodoro";

    let tabTitle = "";
    if (res.state.lockedTabId) {
      try {
        const tab = await chrome.tabs.get(res.state.lockedTabId);
        tabTitle = tab.title || "Untitled";
      } catch (_) {
        tabTitle = "Tab closed";
      }
    } else {
      const tabRes = await sendMessage("getCurrentTab");
      tabTitle = tabRes.title || "No tab";
    }

    updateLockUI(isLocked, tabTitle, res.state.taskText || "", inSession);
    updatePomodoroUI(res);
  } catch (e) {
    tabInfo.textContent = "Error loading state";
  }
}

lockToggle.addEventListener("click", async () => {
  const res = await sendMessage("toggleLock", {
    taskText: taskInput.value.trim(),
  });
  if (res.error) {
    tabInfo.textContent = res.error;
    return;
  }
  await refreshState();
});

startPomodoro.addEventListener("click", async () => {
  const res = await sendMessage("startPomodoro", {
    taskText: taskInput.value.trim(),
  });
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

refreshState();
const timerInterval = setInterval(refreshState, 1000);

window.addEventListener("unload", () => clearInterval(timerInterval));
