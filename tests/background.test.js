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
    [1, { id: 1, windowId: 10, title: "Focus", active: true }],
    [2, { id: 2, windowId: 10, title: "Other", active: false }],
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
    },
    tabs: {
      onActivated: events.activated,
      onCreated: events.created,
      onRemoved: events.removed,
      onUpdated: events.updated,
      onReplaced: events.replaced,
      onAttached: events.attached,
      async query(queryInfo) {
        if (queryInfo?.active) return [...tabs.values()].filter((tab) => tab.active);
        return [...tabs.values()];
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
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { alarms, chrome, events, flush, message, storage, tabs, tabUpdates };
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
