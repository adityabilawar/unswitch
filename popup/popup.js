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
const pomodoroDesc = document.getElementById("pomodoroDesc");
const sessionGate = document.getElementById("sessionGate");
const gatePassword = document.getElementById("gatePassword");
const gatePhrase = document.getElementById("gatePhrase");
const gateNote = document.getElementById("gateNote");
const proBadge = document.getElementById("proBadge");
const proLead = document.getElementById("proLead");
const proPlans = document.getElementById("proPlans");
const proMessage = document.getElementById("proMessage");
const licenseKey = document.getElementById("licenseKey");
const activateLicense = document.getElementById("activateLicense");
const openPro = document.getElementById("openPro");

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

/** The popup's current window is the window that opened it. The service worker's is not. */
async function currentWindowTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (_) {
    return null;
  }
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

  const cycle = data.pomodoroCycle || [];
  const phaseIndex = data.state.pomodoroPhase || 0;
  const nextFocus = cycle.length ? cycle[(phaseIndex + 1) % cycle.length]?.focus : null;
  if (data.state.pomodoroBreakDuration) {
    breakInfo.textContent = `Next break: ${data.state.pomodoroBreakDuration} min`;
  } else if (isBreak && nextFocus) {
    breakInfo.textContent = `Next focus: ${nextFocus} min`;
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
      const tab = await currentWindowTab();
      tabTitle = tab?.title || "No tab";
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
    updateProUI(res.pro, inSession);
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
  const intent = lockToggle.classList.contains("locked") ? "unlock" : "lock";

  lockToggle.disabled = true;
  ++refreshGeneration;
  try {
    let tabId;
    if (intent === "lock") {
      const tab = await currentWindowTab();
      tabId = tab?.id;
    }
    const res = await sendMessage(intent === "unlock" ? "unlockLock" : "toggleLock", {
      taskText: task,
      intent,
      tabId,
      ...gatePayload(),
    });
    if (res.error) {
      tabInfo.textContent = res.error;
      return;
    }
    await refreshState();
  } finally {
    lockToggle.disabled = false;
  }
});

startPomodoro.addEventListener("click", async () => {
  if (startPomodoro.disabled) return;
  const task = taskInput.value.trim();
  taskInput.classList.remove("error");
  startPomodoro.disabled = true;
  try {
    const tab = await currentWindowTab();
    const res = await sendMessage("startPomodoro", { taskText: task, tabId: tab?.id });
    if (res.error) {
      tabInfo.textContent = res.error;
      return;
    }
    await refreshState();
  } finally {
    startPomodoro.disabled = false;
  }
});

function resetLifelineVisual() {
  lifelineBtn.classList.remove("holding");
  lifelineHint.textContent = "Hold 5 sec to cancel";
}

const lifelineHold = createHoldTimer({
  durationMs: LIFELINE_HOLD_MS,
  now: () => Date.now(),
  schedule(tick) {
    return setInterval(tick, 100);
  },
  cancelSchedule(timerId) {
    clearInterval(timerId);
  },
  onTick(remaining) {
    lifelineBtn.classList.add("holding");
    lifelineHint.textContent = `Hold ${Math.ceil(remaining / 1000)}s...`;
  },
  onFire() {
    lifelineBtn.classList.remove("holding");
    lifelineHint.textContent = "Ending session...";
    sendMessage("lifeline", gatePayload()).then((res) => {
      if (res?.error && gateNote) gateNote.textContent = res.error;
      return refreshState();
    }).finally(resetLifelineVisual);
  },
});

function releaseLifelineHold() {
  const result = lifelineHold.release();
  if (result === "cancelled") resetLifelineVisual();
}

lifelineBtn.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (!lifelineHold.start()) return;
  try {
    lifelineBtn.setPointerCapture(event.pointerId);
  } catch (_) {
    lifelineBtn.addEventListener("pointerleave", releaseLifelineHold, { once: true });
  }
});

lifelineBtn.addEventListener("pointerup", releaseLifelineHold);
lifelineBtn.addEventListener("pointercancel", releaseLifelineHold);

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
    lifelineHold.start();
  }
});

lifelineBtn.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") releaseLifelineHold();
});

function gatePayload() {
  return {
    password: gatePassword?.value || "",
    challenge: gatePhrase?.value || "",
  };
}

function formatCycle(cycle) {
  if (!Array.isArray(cycle) || !cycle.length) return "60 min focus → 5/10/20 min breaks";
  const focus = cycle[0].focus;
  const sameFocus = cycle.every((phase) => phase.focus === focus);
  if (sameFocus) return `${focus} min focus → ${cycle.map((phase) => phase.break).join("/")} min breaks`;
  return cycle.map((phase) => `${phase.focus} focus / ${phase.break} break`).join(" → ");
}

function updateProUI(pro, inSession) {
  if (!pro || !proBadge) return;
  const gate = pro.sessionGate || {};
  const showGate = inSession && (gate.timedUntil || gate.phrase || gate.password);
  sessionGate?.classList.toggle("hidden", !showGate);
  gatePassword?.classList.toggle("hidden", !gate.password);
  gatePhrase?.classList.toggle("hidden", !gate.phrase);
  if (gate.timedUntil) {
    const clock = new Date(gate.timedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (gateNote) gateNote.textContent = `Strict mode is on until ${clock}. Closing the focus tab still ends the session.`;
    lifelineHint.textContent = "Strict mode is on";
  } else if (showGate && gateNote && !gateNote.textContent) {
    gateNote.textContent = "Ending this session needs the field above.";
  }

  proBadge.textContent = pro.entitled ? `Pro${pro.plan ? ` · ${pro.plan}` : ""}` : "Free";
  proPlans?.classList.toggle("hidden", Boolean(pro.entitled));
  document.querySelector(".pro-activate")?.classList.toggle("hidden", Boolean(pro.entitled));
  if (!showGate && gateNote) gateNote.textContent = "";
  if (pro.entitled) {
    proLead.textContent = "Pro is active on this browser. Open settings for timers, strict mode, schedules, focus sets, stats, and the blocked screen.";
  }
  if (pomodoroDesc && !inSession) pomodoroDesc.textContent = formatCycle(
    pro.entitled && pro.settings?.pomodoro?.useCustom ? pro.settings.pomodoro.cycle : null
  );

  if (proPlans && proPlans.childElementCount === 0 && Array.isArray(pro.plans)) {
    for (const plan of pro.plans) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "plan-button";
      const title = document.createElement("strong");
      title.textContent = plan.label;
      const detail = document.createElement("span");
      detail.textContent = plan.summary;
      button.append(title, detail);
      button.addEventListener("click", async () => {
        button.disabled = true;
        const res = await sendMessage("startCheckout", { plan: plan.id });
        if (proMessage) {
          proMessage.textContent = res.error || "Checkout opened in a new tab. Paste the license key here when it finishes.";
        }
        button.disabled = false;
      });
      proPlans.append(button);
    }
  }
}

openPro?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pro/pro.html") });
});

activateLicense?.addEventListener("click", async () => {
  const res = await sendMessage("activateLicense", { token: licenseKey?.value || "" });
  if (proMessage) proMessage.textContent = res.error || (res.pro?.entitled ? "Pro is active." : "License checked.");
  if (res.pro?.entitled && licenseKey) licenseKey.value = "";
  await refreshState();
});

refreshState();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes["unswitch-state"] || changes["unswitch-license"] || changes["unswitch-pro-settings"])) {
    refreshState();
  }
  if (area === "sync" && changes["unswitch-pro-settings"]) refreshState();
});
const timerInterval = setInterval(refreshState, 1000);

window.addEventListener("unload", () => clearInterval(timerInterval));
