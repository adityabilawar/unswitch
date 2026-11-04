const statusEl = document.getElementById("status");
const planList = document.getElementById("planList");
const licenseMessage = document.getElementById("licenseMessage");
const settingsMessage = document.getElementById("settingsMessage");
const protectionMessage = document.getElementById("protectionMessage");
const phasesEl = document.getElementById("phases");
const focusSetsEl = document.getElementById("focusSets");
const statsEl = document.getElementById("stats");
const daysEl = document.getElementById("days");
const settingsFields = document.getElementById("settingsFields");

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function sendMessage(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: "Reload Tab Lock and try again." });
        return;
      }
      resolve(response || { error: "Tab Lock returned no response." });
    });
  });
}

function gate() {
  return {
    password: document.getElementById("settingsPassword").value,
    challenge: document.getElementById("settingsChallenge").value,
  };
}

function addPhase(focus = 25, breakMinutes = 5) {
  const row = document.createElement("div");
  row.className = "phase-row";
  const focusInput = document.createElement("input");
  focusInput.type = "number";
  focusInput.min = "1";
  focusInput.max = "180";
  focusInput.value = String(focus);
  focusInput.setAttribute("aria-label", "Focus minutes");
  const breakInput = document.createElement("input");
  breakInput.type = "number";
  breakInput.min = "1";
  breakInput.max = "60";
  breakInput.value = String(breakMinutes);
  breakInput.setAttribute("aria-label", "Break minutes");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => row.remove());
  row.append(focusInput, breakInput, remove);
  phasesEl.append(row);
}

function readPhases() {
  return [...phasesEl.querySelectorAll(".phase-row")].map((row) => {
    const [focus, breakMinutes] = row.querySelectorAll("input");
    return { focus: Number(focus.value), break: Number(breakMinutes.value) };
  });
}

function renderPlans(plans) {
  planList.replaceChildren();
  for (const plan of plans || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "plan-button";
    const title = document.createElement("strong");
    title.textContent = plan.label;
    const detail = document.createElement("span");
    detail.textContent = plan.summary;
    button.append(title, detail);
    button.addEventListener("click", async () => {
      const res = await sendMessage("startCheckout", { plan: plan.id });
      licenseMessage.textContent = res.error || "Checkout opened in a new tab.";
    });
    planList.append(button);
  }
}

function renderDays(selected) {
  if (daysEl.childElementCount) return;
  DAY_LABELS.forEach((label, index) => {
    const wrap = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(index);
    input.checked = (selected || []).includes(index);
    wrap.append(input, document.createTextNode(label));
    daysEl.append(wrap);
  });
}

function renderSets(sets) {
  focusSetsEl.replaceChildren();
  if (!sets?.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "No saved sets yet.";
    focusSetsEl.append(empty);
    return;
  }
  for (const set of sets) {
    const row = document.createElement("div");
    row.className = "set-row";
    const name = document.createElement("div");
    name.textContent = `${set.name} · ${set.hosts.join(", ")}`;
    const actions = document.createElement("div");
    actions.className = "row";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore";
    restore.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await sendMessage("restoreFocusSet", { id: set.id, tabId: tab?.id, ...gate() });
      settingsMessage.textContent = res.error || `Restored ${set.name}.`;
      if (!res.error) await refresh();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      const res = await sendMessage("deleteFocusSet", { id: set.id, ...gate() });
      settingsMessage.textContent = res.error || "Deleted.";
      if (!res.error) await refresh();
    });
    actions.append(restore, remove);
    row.append(name, actions);
    focusSetsEl.append(row);
  }
}

function renderStats(stats) {
  const locked = Math.round((stats?.lockedMs || 0) / 60000);
  const cards = [
    ["Streak", stats?.streak || 0],
    ["Best streak", stats?.bestStreak || 0],
    ["Sessions", stats?.sessions || 0],
    ["Locked minutes", locked],
    ["Switch attempts", stats?.switchAttempts || 0],
  ];
  statsEl.replaceChildren();
  for (const [label, value] of cards) {
    const card = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    card.append(strong, document.createTextNode(label));
    statsEl.append(card);
  }
}

function fillForm(settings) {
  if (!settings || phasesEl.childElementCount) return;
  document.getElementById("useCustom").checked = settings.pomodoro.useCustom;
  for (const phase of settings.pomodoro.cycle) addPhase(phase.focus, phase.break);
  document.getElementById("sound").value = settings.pomodoro.sound;
  document.getElementById("strictMode").value = settings.strict.mode;
  document.getElementById("strictMinutes").value = String(settings.strict.durationMinutes);
  document.getElementById("strictPhrase").value = settings.strict.phrase || "";
  document.getElementById("scheduleEnabled").checked = settings.schedule.enabled;
  renderDays(settings.schedule.days);
  document.getElementById("scheduleStart").value = settings.schedule.start;
  document.getElementById("scheduleEnd").value = settings.schedule.end || "";
  document.getElementById("unlockAtEnd").checked = settings.schedule.unlockAtEnd;
  document.getElementById("quote").value = settings.blockedScreen.quote;
  document.getElementById("imageUrl").value = settings.blockedScreen.imageUrl;
  document.getElementById("redirectUrl").value = settings.blockedScreen.redirectUrl;
  document.getElementById("breathingStyle").value = settings.blockedScreen.breathingStyle;
  document.getElementById("syncEnabled").checked = settings.syncEnabled;
}

async function refresh() {
  const res = await sendMessage("getProState");
  const pro = res.pro;
  if (!pro) {
    statusEl.textContent = res.error || "Pro status is unavailable.";
    return;
  }
  const when = pro.currentPeriodEnd ? ` until ${new Date(pro.currentPeriodEnd).toLocaleDateString()}` : "";
  statusEl.textContent = pro.entitled
    ? `Pro is active (${pro.plan || "plan"}, ${pro.status || "active"})${when}${pro.stale ? ". The last server check is stale; reconnect when you can." : "."}`
    : "Free plan. Pro features below stay locked until a license is active.";
  settingsFields.disabled = !pro.entitled;
  if (!planList.childElementCount) renderPlans(pro.plans);
  if (!document.getElementById("apiBase").value) document.getElementById("apiBase").value = pro.apiBase || "";
  fillForm(pro.settings);
  renderSets(pro.settings?.focusSets || []);
  renderStats(pro.stats);
}

document.getElementById("addPhase").addEventListener("click", () => addPhase());

document.getElementById("saveApiBase").addEventListener("click", async () => {
  const res = await sendMessage("setApiBase", { value: document.getElementById("apiBase").value });
  licenseMessage.textContent = res.error || "License server saved on this device.";
  await refresh();
});

document.getElementById("activateKey").addEventListener("click", async () => {
  const res = await sendMessage("activateLicense", { token: document.getElementById("licenseKey").value });
  licenseMessage.textContent = res.error || "License updated.";
  await refresh();
});

document.getElementById("refreshLicense").addEventListener("click", async () => {
  const res = await sendMessage("refreshLicense");
  licenseMessage.textContent = res.pro?.error || (res.pro?.entitled ? "License refreshed." : "No active license for this install.");
  await refresh();
});

document.getElementById("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const res = await sendMessage("setProSettings", {
    ...gate(),
    patch: {
      pomodoro: {
        useCustom: document.getElementById("useCustom").checked,
        cycle: readPhases(),
        sound: document.getElementById("sound").value,
      },
      strict: {
        mode: document.getElementById("strictMode").value,
        durationMinutes: Number(document.getElementById("strictMinutes").value),
        phrase: document.getElementById("strictPhrase").value,
      },
      schedule: {
        enabled: document.getElementById("scheduleEnabled").checked,
        days: [...daysEl.querySelectorAll("input:checked")].map((input) => Number(input.value)),
        start: document.getElementById("scheduleStart").value,
        end: document.getElementById("scheduleEnd").value,
        unlockAtEnd: document.getElementById("unlockAtEnd").checked,
      },
      blockedScreen: {
        quote: document.getElementById("quote").value,
        imageUrl: document.getElementById("imageUrl").value,
        redirectUrl: document.getElementById("redirectUrl").value,
        breathingStyle: document.getElementById("breathingStyle").value,
      },
      syncEnabled: document.getElementById("syncEnabled").checked,
    },
  });
  settingsMessage.textContent = res.error || (res.synced ? "Saved and synced." : "Saved on this device.");
  if (res.syncError) settingsMessage.textContent += ` Sync: ${res.syncError}`;
});

document.getElementById("saveSet").addEventListener("click", async () => {
  const res = await sendMessage("saveFocusSet", { name: document.getElementById("setName").value, ...gate() });
  settingsMessage.textContent = res.error || "Focus set saved.";
  if (!res.error) await refresh();
});

document.getElementById("enableProtection").addEventListener("click", async () => {
  const res = await sendMessage("setProtection", {
    enabled: true,
    password: document.getElementById("newPassword").value,
    currentPassword: document.getElementById("currentPassword").value,
  });
  protectionMessage.textContent = res.error || "Protection is on.";
  await refresh();
});

document.getElementById("disableProtection").addEventListener("click", async () => {
  const res = await sendMessage("setProtection", {
    enabled: false,
    currentPassword: document.getElementById("currentPassword").value,
  });
  protectionMessage.textContent = res.error || "Protection is off.";
  await refresh();
});

async function copyOrDownload(kind) {
  const res = await sendMessage("exportStats");
  if (res.error) {
    settingsMessage.textContent = res.error;
    return;
  }
  if (kind === "json") {
    await navigator.clipboard.writeText(res.json);
    settingsMessage.textContent = "JSON copied.";
    return;
  }
  const blob = new Blob([res.csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "tab-lock-stats.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

document.getElementById("exportJson").addEventListener("click", () => copyOrDownload("json"));
document.getElementById("exportCsv").addEventListener("click", () => copyOrDownload("csv"));

refresh();
