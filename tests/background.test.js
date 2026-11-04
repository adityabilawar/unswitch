const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "..", "background.js"),
  "utf8"
);

function event() {
  return {
    listener: null,
    addListener(listener) {
      this.listener = listener;
    },
  };
}

function createHarness(initialState = {}, options = {}) {
  const storage = { "unswitch-state": { ...initialState } };
  const session = {};
  const alarms = new Map();
  const tabUpdates = [];
  const events = {
    activated: event(),
    created: event(),
    removed: event(),
    updated: event(),
    replaced: event(),
    attached: event(),
    focused: event(),
    alarm: event(),
    message: event(),
    startup: event(),
    installed: event(),
  };
  const tabs = new Map([
    [1, { id: 1, windowId: 10, title: "Focus", url: "https://focus.example/", active: true }],
    [2, { id: 2, windowId: 10, title: "Other", url: "https://other.example/", active: false }],
  ]);

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: storage[keys] };
          return Object.fromEntries((keys || []).map((key) => [key, storage[key]]));
        },
        async set(values) {
          Object.assign(storage, structuredClone(values));
        },
      },
      session: {
        async get(key) {
          return { [key]: session[key] };
        },
        async set(values) {
          Object.assign(session, structuredClone(values));
        },
        async remove(key) {
          delete session[key];
        },
      },
    },
    tabs: {
      onActivated: events.activated,
      onCreated: events.created,
      onRemoved: events.removed,
      onUpdated: events.updated,
      onReplaced: events.replaced,
      onAttached: events.attached,
      async query(queryInfo = {}) {
        let list = [...tabs.values()];
        if (queryInfo.windowId != null) {
          list = list.filter((tab) => tab.windowId === queryInfo.windowId);
        }
        if (queryInfo.active) list = list.filter((tab) => tab.active);
        if (queryInfo.currentWindow && list.length) {
          const windowId = list[0].windowId;
          list = list.filter((tab) => tab.windowId === windowId);
        }
        return list;
      },
      async get(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error("No tab");
        return tab;
      },
      async update(tabId, changes) {
        tabUpdates.push({ tabId, changes });
        const tab = await this.get(tabId);
        Object.assign(tab, changes);
        return tab;
      },
      async sendMessage() {
        if (options.stallTabMessages) return new Promise(() => {});
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.focused,
      async update() {},
    },
    alarms: {
      onAlarm: events.alarm,
      async create(name, options) {
        alarms.set(name, options);
      },
      async clear(name) {
        return alarms.delete(name);
      },
      async get(name) {
        const alarm = alarms.get(name);
        return alarm ? { name, scheduledTime: alarm.when } : undefined;
      },
    },
    scripting: {
      async insertCSS() {},
      async executeScript() {},
    },
    action: {
      setIcon() {},
      setBadgeText() {},
      setBadgeBackgroundColor() {},
    },
    runtime: {
      onMessage: events.message,
      onStartup: events.startup,
      onInstalled: events.installed,
    },
  };

  vm.runInNewContext(backgroundSource, {
    chrome,
    console,
    Date,
    Promise,
    Set,
    Object,
    String,
    Boolean,
    clearTimeout,
    setTimeout,
    Math,
    Number,
    Map,
    Error,
  });

  async function message(action, data = {}, sender = {}) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out: ${action}`)), 1000);
      events.message.listener({ action, ...data }, sender, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  async function flush() {
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return { alarms, chrome, events, flush, message, session, storage, tabs, tabUpdates };
}

test("instant return does not wait for unresponsive content scripts", async () => {
  const h = createHarness({}, { stallTabMessages: true });
  await h.message("toggleLock");
  h.events.activated.listener({ tabId: 2, windowId: 10 });
  await h.flush();
  assert.ok(h.tabUpdates.some(({ tabId, changes }) => tabId === 1 && changes.active));
});

test("instant return respects allowed tabs and stops after unlock", async () => {
  const h = createHarness();
  await h.message("toggleLock");
  await h.message("addTabToLock", { tabId: 2 });
  h.events.activated.listener({ tabId: 2, windowId: 10 });
  await h.flush();
  assert.equal(h.tabUpdates.length, 0);
  await h.message("unlockLock");
  h.events.activated.listener({ tabId: 2, windowId: 10 });
  await h.flush();
  assert.equal(h.tabUpdates.length, 0);
});

test("starts a lock without requiring task text", async () => {
  const h = createHarness();
  const response = await h.message("toggleLock", { taskText: "" });
  assert.equal(response.locked, true);
  assert.equal(h.storage["unswitch-state"].mode, "locked");
  assert.equal(h.storage["unswitch-state"].taskText, "");
});

test("unlock is idempotent and clears all Pomodoro state", async () => {
  const h = createHarness();
  await h.message("startPomodoro");
  await h.message("unlockLock");
  await h.message("unlockLock");
  const state = h.storage["unswitch-state"];
  assert.equal(state.mode, "off");
  assert.equal(state.lockedTabId, null);
  assert.equal(state.pomodoroState, null);
  assert.equal(state.pomodoroEndTime, null);
  assert.equal(h.alarms.size, 0);
});

test("switching tabs after unlock cannot block or re-enable the session", async () => {
  const h = createHarness();
  await h.message("toggleLock");
  await h.message("unlockLock");
  h.events.activated.listener({ tabId: 2, windowId: 10 });
  await h.flush();
  assert.equal((await h.message("getTabBlockState", {}, { tab: { id: 2 } })).blocked, false);
  assert.equal((await h.message("getState")).state.mode, "off");
});

test("the first Pomodoro break is 5 minutes, then advances the cycle", async () => {
  const h = createHarness();
  await h.message("startPomodoro", { taskText: "Write" });

  h.events.alarm.listener({ name: "pomodoro-focus" });
  await h.flush();
  let state = h.storage["unswitch-state"];
  assert.equal(state.pomodoroState, "break");
  assert.equal(state.pomodoroPhase, 0);
  assert.ok(state.pomodoroEndTime - Date.now() > 4.9 * 60_000);
  assert.ok(state.pomodoroEndTime - Date.now() <= 5 * 60_000);

  h.events.alarm.listener({ name: "pomodoro-break" });
  await h.flush();
  state = h.storage["unswitch-state"];
  assert.equal(state.pomodoroState, "focus");
  assert.equal(state.pomodoroPhase, 1);
  assert.equal(state.pomodoroBreakDuration, 10);
});

test("an alarm wake loads persisted state before transitioning", async () => {
  const now = Date.now();
  const h = createHarness({
    mode: "pomodoro",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
    pomodoroPhase: 0,
    pomodoroState: "focus",
    pomodoroEndTime: now,
  });

  h.events.alarm.listener({ name: "pomodoro-focus" });
  await h.flush();
  assert.equal(h.storage["unswitch-state"].pomodoroState, "break");
  assert.equal(h.storage["unswitch-state"].mode, "pomodoro");
});

test("closing the primary focus tab during a break ends the session", async () => {
  const h = createHarness({
    mode: "pomodoro",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
    pomodoroPhase: 0,
    pomodoroState: "break",
  });

  h.tabs.delete(1);
  h.events.removed.listener(1);
  await h.flush();
  assert.equal(h.storage["unswitch-state"].mode, "off");
  assert.equal(h.storage["unswitch-state"].lockedTabId, null);
});

test("allowed tabs can be managed during a Pomodoro break", async () => {
  const h = createHarness({
    mode: "pomodoro",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
    pomodoroPhase: 0,
    pomodoroState: "break",
  });

  const response = await h.message("addTabToLock", { tabId: 2 });
  assert.equal(response.success, true);
  assert.deepEqual(h.storage["unswitch-state"].lockedTabIds, [1, 2]);
});

test("Chrome tab replacement preserves the primary focus tab", async () => {
  const h = createHarness({
    mode: "locked",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
  });
  h.tabs.set(3, { id: 3, windowId: 20, title: "Prerendered", active: true });
  h.tabs.delete(1);

  h.events.replaced.listener(3, 1);
  await h.flush();
  const state = h.storage["unswitch-state"];
  assert.equal(state.lockedTabId, 3);
  assert.deepEqual(state.lockedTabIds, [3]);
  assert.equal(state.lockedWindowId, 20);
});

test("leave-site warnings are opt-in and persist", async () => {
  const h = createHarness();
  assert.equal((await h.message("getState")).state.leaveDomainWarning, false);
  assert.equal((await h.message("setLeaveDomainWarning", { value: true })).success, true);
  assert.equal(h.storage["unswitch-state"].leaveDomainWarning, true);
});

test("a stalled content-script sync cannot block popup state requests", async () => {
  const h = createHarness({}, { stallTabMessages: true });

  h.events.installed.listener();
  const response = await h.message("getState");

  assert.equal(response.state.mode, "off");
});

test("a repeated lock request does not unlock the session", async () => {
  const h = createHarness();
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  const second = await h.message("toggleLock", { intent: "lock", tabId: 2 });
  assert.equal(second.locked, true);
  assert.equal(second.already, true);
  assert.equal(h.storage["unswitch-state"].mode, "locked");
  assert.equal(h.storage["unswitch-state"].lockedTabId, 1);
});

test("lock uses the tab from the popup window", async () => {
  const h = createHarness();
  h.tabs.set(3, {
    id: 3,
    windowId: 11,
    title: "Other window",
    url: "https://window.example/",
    active: true,
  });
  const response = await h.message("toggleLock", { intent: "lock", tabId: 3 });
  assert.equal(response.tabId, 3);
  assert.equal(h.storage["unswitch-state"].lockedTabId, 3);
  assert.equal(h.storage["unswitch-state"].lockedWindowId, 11);
});

test("starting Pomodoro twice does not move the deadline", async () => {
  const h = createHarness();
  await h.message("startPomodoro", { tabId: 1, taskText: "Write" });
  const end = h.storage["unswitch-state"].pomodoroEndTime;
  await new Promise((resolve) => setTimeout(resolve, 15));
  const second = await h.message("startPomodoro", { tabId: 2, taskText: "Other" });
  assert.equal(second.already, true);
  assert.equal(h.storage["unswitch-state"].pomodoroEndTime, end);
  assert.equal(h.storage["unswitch-state"].lockedTabId, 1);
  assert.equal(h.storage["unswitch-state"].taskText, "Write");
});

test("starting Pomodoro from a plain lock keeps the allowed tabs", async () => {
  const h = createHarness();
  await h.message("toggleLock", { intent: "lock", tabId: 1, taskText: "Write" });
  await h.message("addTabToLock", { tabId: 2 });
  await h.message("startPomodoro", { tabId: 2, taskText: "" });
  const state = h.storage["unswitch-state"];
  assert.equal(state.mode, "pomodoro");
  assert.equal(state.lockedTabId, 1);
  assert.deepEqual(state.lockedTabIds, [1, 2]);
  assert.equal(state.taskText, "Write");
  assert.equal(h.alarms.get("pomodoro-focus").when, state.pomodoroEndTime);
});

test("a missing Pomodoro alarm is restored without moving the deadline", async () => {
  const end = Date.now() + 30 * 60 * 1000;
  const h = createHarness({
    mode: "pomodoro",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
    lockedTabRecords: [{ id: 1, url: "https://focus.example/", windowId: 10, primary: true }],
    pomodoroPhase: 0,
    pomodoroState: "focus",
    pomodoroEndTime: end,
    pomodoroBreakDuration: 5,
  });

  const response = await h.message("getState");
  assert.equal(response.state.pomodoroEndTime, end);
  assert.equal(response.state.pomodoroState, "focus");
  assert.equal(h.alarms.get("pomodoro-focus").when, end);
  assert.equal(h.alarms.has("pomodoro-break"), false);
});

test("overdue Pomodoro time catches up on the original schedule", async () => {
  const end = Date.now() - 20 * 60 * 1000;
  const h = createHarness({
    mode: "pomodoro",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
    lockedTabRecords: [{ id: 1, url: "https://focus.example/", windowId: 10, primary: true }],
    pomodoroPhase: 0,
    pomodoroState: "focus",
    pomodoroEndTime: end,
    pomodoroBreakDuration: 5,
  });

  const response = await h.message("getState");
  assert.equal(response.state.pomodoroState, "focus");
  assert.equal(response.state.pomodoroPhase, 1);
  assert.equal(response.state.pomodoroBreakDuration, 10);
  assert.equal(response.state.pomodoroEndTime, end + 5 * 60 * 1000 + 60 * 60 * 1000);
  assert.equal(h.alarms.get("pomodoro-focus").when, response.state.pomodoroEndTime);
});

test("a late focus alarm keeps the original break deadline", async () => {
  const end = Date.now() - 10_000;
  const h = createHarness({
    mode: "pomodoro",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
    pomodoroPhase: 0,
    pomodoroState: "focus",
    pomodoroEndTime: end,
    pomodoroBreakDuration: 5,
  });

  h.events.alarm.listener({ name: "pomodoro-focus" });
  await h.flush();
  const state = h.storage["unswitch-state"];
  assert.equal(state.pomodoroState, "break");
  assert.equal(state.pomodoroPhase, 0);
  assert.equal(state.pomodoroEndTime, end + 5 * 60 * 1000);
});

test("an unlock requested before a tab switch is applied does not pull focus back", async () => {
  const h = createHarness();
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  h.tabUpdates.length = 0;
  h.events.activated.listener({ tabId: 2, windowId: 10 });
  await h.message("unlockLock");
  await h.flush();
  assert.equal(h.tabUpdates.length, 0);
  assert.equal(h.storage["unswitch-state"].mode, "off");
  assert.equal((await h.message("getTabBlockState", {}, { tab: { id: 2 } })).blocked, false);
});

test("focusing another window on an allowed tab does not bounce", async () => {
  const h = createHarness();
  h.tabs.set(3, {
    id: 3,
    windowId: 11,
    title: "Reference",
    url: "https://docs.example/",
    active: true,
  });
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  await h.message("addTabToLock", { tabId: 3 });
  h.tabUpdates.length = 0;
  h.events.focused.listener(11);
  await h.flush();
  assert.equal(h.tabUpdates.length, 0);
});

test("a disallowed tab in another window is sent back to the focus tab", async () => {
  const h = createHarness();
  h.tabs.set(3, {
    id: 3,
    windowId: 11,
    title: "Elsewhere",
    url: "https://elsewhere.example/",
    active: true,
  });
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  h.tabUpdates.length = 0;
  h.events.focused.listener(11);
  await h.flush();
  assert.ok(h.tabUpdates.some(({ tabId, changes }) => tabId === 1 && changes.active));
});

test("navigating the locked tab in the same browser session keeps the lock", async () => {
  const h = createHarness();
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  h.tabs.get(1).url = "https://focus.example/next";
  h.events.updated.listener(1, { url: "https://focus.example/next" });
  await h.flush();
  const response = await h.message("getState");
  assert.equal(response.state.mode, "locked");
  assert.equal(response.state.lockedTabId, 1);
  assert.equal(response.state.lockedTabRecords[0].url, "https://focus.example/next");
});

test("a browser restart rebinds allowed tabs by URL across windows", async () => {
  const h = createHarness({
    mode: "locked",
    lockedTabId: 100,
    lockedTabIds: [100, 101],
    lockedWindowId: 1,
    lockedTabRecords: [
      { id: 100, url: "https://notes.example/a", windowId: 1, primary: true },
      { id: 101, url: "https://docs.example/b", windowId: 2, primary: false },
    ],
  });
  h.tabs.set(5, {
    id: 5,
    windowId: 11,
    title: "Docs",
    url: "https://docs.example/b",
    active: false,
  });
  h.tabs.set(6, {
    id: 6,
    windowId: 12,
    title: "Notes",
    url: "https://notes.example/a",
    active: true,
  });

  h.events.startup.listener();
  await h.flush();
  const state = h.storage["unswitch-state"];
  assert.equal(state.mode, "locked");
  assert.equal(state.lockedTabId, 6);
  assert.deepEqual(state.lockedTabIds, [6, 5]);
  assert.equal(state.lockedWindowId, 12);

  const listed = await h.message("getLockedTabs");
  assert.equal(listed.tabs.length, 2);
  assert.equal(listed.tabs[0].id, 6);
  assert.equal(listed.tabs[1].id, 5);
  assert.equal(listed.tabs[0].isPrimary, true);

  await h.message("lifeline");
  assert.equal(h.storage["unswitch-state"].mode, "off");
  assert.equal(h.alarms.size, 0);
  assert.equal((await h.message("getTabBlockState", {}, { tab: { id: 2 } })).blocked, false);
});

test("a browser restart keeps a Pomodoro deadline while rebinding its tab", async () => {
  const end = Date.now() + 25 * 60 * 1000;
  const h = createHarness({
    mode: "pomodoro",
    lockedTabId: 50,
    lockedTabIds: [50],
    lockedWindowId: 3,
    pomodoroPhase: 0,
    pomodoroState: "focus",
    pomodoroEndTime: end,
    pomodoroBreakDuration: 5,
    lockedTabRecords: [{ id: 50, url: "https://focus.example/", windowId: 3, primary: true }],
  });

  h.events.startup.listener();
  await h.flush();
  const state = h.storage["unswitch-state"];
  assert.equal(state.mode, "pomodoro");
  assert.equal(state.lockedTabId, 1);
  assert.equal(state.pomodoroEndTime, end);
  assert.equal(state.pomodoroState, "focus");
  assert.equal(h.alarms.get("pomodoro-focus").when, end);
});

test("a browser restart drops a lock that no longer matches an open tab", async () => {
  const h = createHarness({
    mode: "locked",
    lockedTabId: 100,
    lockedTabIds: [100],
    lockedWindowId: 1,
    lockedTabRecords: [{ id: 100, url: "https://gone.example/", windowId: 1, primary: true }],
  });
  h.session["unswitch-reconcile-attempts"] = 4;

  h.events.startup.listener();
  await h.flush();
  assert.equal(h.storage["unswitch-state"].mode, "off");
  assert.equal(h.storage["unswitch-state"].lockedTabId, null);
  assert.equal((await h.message("getTabBlockState", {}, { tab: { id: 2 } })).blocked, false);
});

test("restart waits until restored tabs have targets before dropping a session", async () => {
  const h = createHarness({
    mode: "locked",
    lockedTabId: 100,
    lockedTabIds: [100],
    lockedWindowId: 1,
    lockedTabRecords: [{ id: 100, url: "https://focus.example/deep", windowId: 1, primary: true }],
  });
  for (const tab of h.tabs.values()) tab.url = "";

  h.events.startup.listener();
  await h.flush();
  assert.equal(h.storage["unswitch-state"].mode, "locked");
  assert.equal(h.alarms.get("tab-lock-reconcile").when > Date.now(), true);
  h.tabUpdates.length = 0;
  h.events.activated.listener({ tabId: 2, windowId: 10 });
  await h.flush();
  assert.equal(h.tabUpdates.length, 0);
  assert.equal((await h.message("getTabBlockState", {}, { tab: { id: 2 } })).blocked, false);

  h.tabs.get(1).url = "https://focus.example/deep";
  h.events.alarm.listener({ name: "tab-lock-reconcile" });
  await h.flush();
  assert.equal(h.storage["unswitch-state"].mode, "locked");
  assert.equal(h.storage["unswitch-state"].lockedTabId, 1);
  assert.equal(h.alarms.has("tab-lock-reconcile"), false);
  assert.equal((await h.message("getTabBlockState", {}, { tab: { id: 2 } })).blocked, true);
});

test("a partial restore does not drop an allowed tab that is not back yet", async () => {
  const h = createHarness({
    mode: "locked",
    lockedTabId: 100,
    lockedTabIds: [100, 101],
    lockedWindowId: 1,
    lockedTabRecords: [
      { id: 100, url: "https://notes.example/a", windowId: 1, primary: true },
      { id: 101, url: "https://docs.example/b", windowId: 2, primary: false },
    ],
  });
  for (const tab of h.tabs.values()) tab.url = "";
  h.tabs.set(6, {
    id: 6,
    windowId: 12,
    title: "Notes",
    url: "https://notes.example/a",
    active: true,
  });

  await h.message("getState");
  assert.equal(h.storage["unswitch-state"].mode, "locked");
  assert.deepEqual(h.storage["unswitch-state"].lockedTabIds, [100, 101]);

  h.tabs.set(5, {
    id: 5,
    windowId: 11,
    title: "Docs",
    url: "https://docs.example/b",
    active: false,
  });
  h.events.alarm.listener({ name: "tab-lock-reconcile" });
  await h.flush();
  assert.deepEqual(h.storage["unswitch-state"].lockedTabIds, [6, 5]);
  assert.equal(h.storage["unswitch-state"].lockedTabId, 6);
});

test("a restoring tab is matched by pendingUrl without clearing the Pomodoro", async () => {
  const end = Date.now() + 40 * 60 * 1000;
  const h = createHarness({
    mode: "pomodoro",
    lockedTabId: 100,
    lockedTabIds: [100],
    lockedWindowId: 1,
    pomodoroPhase: 0,
    pomodoroState: "focus",
    pomodoroEndTime: end,
    pomodoroBreakDuration: 5,
    lockedTabRecords: [{ id: 100, url: "https://focus.example/deep", windowId: 1, primary: true }],
  });
  h.tabs.set(7, {
    id: 7,
    windowId: 10,
    title: "Restoring",
    url: "about:blank",
    pendingUrl: "https://focus.example/deep",
    active: true,
  });

  h.events.startup.listener();
  await h.flush();
  const state = h.storage["unswitch-state"];
  assert.equal(state.mode, "pomodoro");
  assert.equal(state.lockedTabId, 7);
  assert.equal(state.pomodoroEndTime, end);
  assert.equal(h.alarms.get("pomodoro-focus").when, end);
});

test("an extension update keeps the open tab when its URL changed", async () => {
  const h = createHarness({
    mode: "locked",
    lockedTabId: 1,
    lockedTabIds: [1],
    lockedWindowId: 10,
    lockedTabRecords: [{ id: 1, url: "https://focus.example/old", windowId: 10, primary: true }],
  });
  h.tabs.get(1).url = "https://focus.example/now";
  h.tabs.set(4, {
    id: 4,
    windowId: 10,
    title: "Old copy",
    url: "https://focus.example/old",
    active: false,
  });

  h.events.installed.listener({ reason: "update" });
  await h.flush();
  const state = h.storage["unswitch-state"];
  assert.equal(state.mode, "locked");
  assert.equal(state.lockedTabId, 1);
  assert.equal(state.lockedTabRecords[0].url, "https://focus.example/now");
});

test("a breathing redirect queued before unlock does not pull focus back", async () => {
  const h = createHarness();
  await h.message("toggleLock", { intent: "lock", tabId: 1 });
  h.tabUpdates.length = 0;
  const pending = h.message("focusLockedTabAfterBreathing", {}, { tab: { id: 2 } });
  await h.message("unlockLock");
  const response = await pending;
  await h.flush();
  assert.equal(response.success, false);
  assert.equal(h.tabUpdates.length, 0);
  assert.equal(h.storage["unswitch-state"].mode, "off");
});
