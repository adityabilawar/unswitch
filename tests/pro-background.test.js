const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./harness");
const settings = require("../shared/pro-settings");

function license(plan = "lifetime") {
  return {
    plan,
    status: "active",
    currentPeriodEnd: plan === "lifetime" ? null : Date.now() + 86400000,
    checkedAt: Date.now(),
    token: "cached.token",
  };
}

function proHarness(extra = {}, state = {}) {
  return createHarness(state, {
    storage: {
      "unswitch-license": license(),
      ...extra,
    },
  });
}

test("free installs keep the 60 minute cycle even if custom settings are stored", async () => {
  const h = createHarness({}, {
    storage: {
      "unswitch-pro-settings": {
        pomodoro: { useCustom: true, cycle: [{ focus: 25, break: 3 }], sound: "ding" },
        strict: { mode: "phrase", phrase: "stay with it", durationMinutes: 50 },
      },
    },
  });
  const stateResponse = await h.message("getState");
  assert.equal(stateResponse.pro.entitled, false);
  assert.equal(stateResponse.pro.plans[1].amountCents, 1999);
  await h.message("startPomodoro", { tabId: 1 });
  const remaining = h.storage["unswitch-state"].pomodoroEndTime - Date.now();
  assert.ok(remaining > 59 * 60 * 1000);
  assert.equal(h.storage["unswitch-state"].pomodoroSound, null);
  const lifeline = await h.message("lifeline");
  assert.equal(lifeline.success, true);
  assert.equal(h.storage["unswitch-state"].mode, "off");
});

test("Pro custom Pomodoro uses the saved cycle and plays its sound", async () => {
  const h = proHarness({
    "unswitch-pro-settings": {
      pomodoro: { useCustom: true, cycle: [{ focus: 25, break: 3 }], sound: "chime" },
    },
  });
  await h.message("startPomodoro", { tabId: 1, taskText: "Write" });
  const remaining = h.storage["unswitch-state"].pomodoroEndTime - Date.now();
  assert.ok(remaining > 24.5 * 60 * 1000 && remaining <= 25 * 60 * 1000);
  assert.equal(h.storage["unswitch-state"].pomodoroBreakDuration, 3);
  h.events.alarm.listener({ name: "pomodoro-focus" });
  await h.flush();
  assert.equal(h.storage["unswitch-state"].pomodoroState, "break");
  assert.ok(h.scriptCalls.some((call) => Array.isArray(call.args) && call.args[0][0] === 523.25));
});

test("strict mode blocks Lifeline until the phrase is typed, and a closed focus tab still ends", async () => {
  const h = proHarness({
    "unswitch-pro-settings": {
      strict: { mode: "phrase", phrase: "stay with it", durationMinutes: 50 },
    },
  });
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  const blocked = await h.message("lifeline");
  assert.equal(blocked.code, "strict");
  assert.equal(h.storage["unswitch-state"].mode, "locked");
  const allowed = await h.message("lifeline", { challenge: "stay with it" });
  assert.equal(allowed.success, true);

  const timed = proHarness({
    "unswitch-pro-settings": { strict: { mode: "timed", durationMinutes: 50, phrase: "" } },
    "unswitch-strict-until": Date.now() + 20 * 60 * 1000,
  }, {
    mode: "locked",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
    lockedTabRecords: [{ id: 1, url: "https://focus.example/", windowId: 10, primary: true }],
  });
  assert.equal((await timed.message("unlockLock")).code, "strict");
  timed.tabs.delete(1);
  timed.events.removed.listener(1);
  await timed.flush();
  assert.equal(timed.storage["unswitch-state"].mode, "off");
});

test("protection requires the password to unlock and settings cannot replace the verifier", async () => {
  const protection = await settings.createProtection("secret-pass", 1000);
  const h = proHarness({
    "unswitch-pro-settings": { protection },
  });
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  assert.equal((await h.message("unlockLock", { password: "nope" })).code, "protection");
  assert.equal(h.storage["unswitch-state"].mode, "locked");
  assert.equal((await h.message("unlockLock", { password: "secret-pass" })).locked, false);

  const saved = await h.message("setProSettings", {
    patch: { protection: { enabled: false, hash: "", salt: "" }, pomodoro: { sound: "bell" } },
  });
  assert.equal(saved.code, "protection");
  const changed = await h.message("setProSettings", {
    password: "secret-pass",
    patch: { pomodoro: { sound: "bell" } },
  });
  assert.equal(changed.success, true);
  assert.equal(h.storage["unswitch-pro-settings"].pomodoro.sound, "bell");
  assert.equal(h.storage["unswitch-pro-settings"].protection.hash, protection.hash);
  assert.equal(h.syncStorage["unswitch-pro-settings"].pomodoro.sound, "bell");
});

test("a focus set restores matching sites and a schedule locks the active tab once", async () => {
  const h = proHarness();
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  const saved = await h.message("saveFocusSet", { name: "Writing" });
  assert.equal(saved.set.hosts.join(","), "focus.example");
  await h.message("unlockLock");
  h.tabs.set(4, { id: 4, windowId: 10, title: "Notes", url: "https://www.focus.example/docs", active: false, index: 3 });
  const restored = await h.message("restoreFocusSet", { id: saved.set.id, tabId: 1 });
  assert.equal(restored.success, true);
  assert.equal(h.storage["unswitch-state"].lockedTabIds.includes(4), true);
  assert.equal(h.storage["unswitch-state"].allowedHosts.join(","), "focus.example");

  const start = new Date();
  const hhmm = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  const scheduled = proHarness({
    "unswitch-pro-settings": {
      schedule: { enabled: true, days: [start.getDay()], start: hhmm, end: "", unlockAtEnd: false },
    },
  });
  scheduled.events.alarm.listener({ name: "tab-lock-schedule" });
  await scheduled.flush();
  assert.equal(scheduled.storage["unswitch-state"].mode, "locked");
  assert.match(scheduled.storage["unswitch-schedule-cursor"], new RegExp(`${hhmm}$`));
  scheduled.events.alarm.listener({ name: "tab-lock-schedule" });
  await scheduled.flush();
  assert.equal(scheduled.storage["unswitch-state"].mode, "locked");

  const free = createHarness({}, {
    storage: {
      "unswitch-pro-settings": {
        schedule: { enabled: true, days: [start.getDay()], start: hhmm, end: "", unlockAtEnd: false },
      },
    },
  });
  free.events.alarm.listener({ name: "tab-lock-schedule" });
  await free.flush();
  assert.notEqual(free.storage["unswitch-state"].mode, "locked");
});

test("stats count a switch attempt and a redirect only applies on Pro", async () => {
  const h = proHarness({
    "unswitch-pro-settings": {
      blockedScreen: { redirectUrl: "https://focus.example/return", quote: "Stay with the work." },
    },
  });
  await h.message("setProSettings", {
    patch: { blockedScreen: { redirectUrl: "https://focus.example/return", quote: "Stay with the work." } },
  });
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  h.events.activated.listener({ tabId: 2, windowId: 10 });
  await h.flush();
  assert.equal(h.storage["unswitch-stats"].switchAttempts, 1);
  assert.equal(h.storage["unswitch-stats"].sessions, 1);
  assert.ok(h.tabUpdates.some((update) => update.tabId === 2 && update.changes.url === "https://focus.example/return"));
  const exported = await h.message("exportStats");
  assert.match(exported.csv, /switch_attempts/);
  assert.match(exported.json, /"switchAttempts": 1/);

  const free = createHarness();
  await free.message("setProSettings", {
    patch: { blockedScreen: { redirectUrl: "https://focus.example/return" } },
  });
  assert.equal((await free.message("setProSettings", { patch: {} })).code, "pro");
  await free.message("toggleLock", { intent: "lock", tabId: 1 });
  free.tabUpdates.length = 0;
  free.events.activated.listener({ tabId: 2, windowId: 10 });
  await free.flush();
  assert.equal(free.tabUpdates.some((update) => update.changes.url), false);
});
