const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");

function event() {
  return {
    listener: null,
    addListener(listener) {
      this.listener = listener;
    },
  };
}

function createHarness(initialState = {}, options = {}) {
  const storage = {
    "unswitch-state": { ...initialState },
    ...structuredClone(options.storage || {}),
  };
  const syncStorage = {};
  const session = {};
  const alarms = new Map();
  const tabUpdates = [];
  const scriptCalls = [];
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
    storage: event(),
  };
  const tabs = new Map(
    options.tabs || [
      [1, { id: 1, windowId: 10, title: "Focus", url: "https://focus.example/", active: true, index: 0 }],
      [2, { id: 2, windowId: 10, title: "Other", url: "https://other.example/", active: false, index: 1 }],
    ]
  );

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
      sync: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: syncStorage[keys] };
          return Object.fromEntries((keys || []).map((key) => [key, syncStorage[key]]));
        },
        async set(values) {
          Object.assign(syncStorage, structuredClone(values));
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
      onChanged: events.storage,
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
        if (queryInfo.lastFocusedWindow) list = list.filter((tab) => tab.active);
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
      async create() {
        return { id: 99 };
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
      async create(name, alarmOptions) {
        alarms.set(name, alarmOptions);
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
      async executeScript(details) {
        scriptCalls.push(details);
      },
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
      id: "tablocktest",
      getURL(file) {
        return `chrome-extension://tablocktest/${file}`;
      },
      setUninstallURL() {},
    },
  };

  const context = vm.createContext({
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
    URL,
    crypto: globalThis.crypto,
    TextEncoder: globalThis.TextEncoder,
    Uint8Array: globalThis.Uint8Array,
    fetch: options.fetch || (async () => {
      throw new Error("offline");
    }),
  });
  context.importScripts = (...urls) => {
    for (const url of urls) {
      vm.runInContext(fs.readFileSync(path.join(root, url), "utf8"), context, { filename: url });
    }
  };
  vm.runInContext(backgroundSource, context, { filename: "background.js" });

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

  return {
    alarms,
    chrome,
    events,
    flush,
    message,
    scriptCalls,
    session,
    storage,
    syncStorage,
    tabs,
    tabUpdates,
  };
}

module.exports = { createHarness };
