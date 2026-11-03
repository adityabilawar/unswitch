const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function harness() {
  let blocker = null;
  const requests = [];
  const listeners = {};
  const classes = new Set();
  const classList = {
    remove(name) { classes.delete(name); },
    toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
  };
  const document = {
    getElementById() { return blocker; },
    documentElement: { classList, appendChild(node) { blocker = node; } },
    body: { classList },
    createElement() {
      return { classList, setAttribute() {}, querySelector() { return null; },
        remove() { blocker = null; } };
    },
  };
  const chrome = {
    runtime: {
      onMessage: { addListener(fn) { listeners.message = fn; } },
      sendMessage(message, callback) { requests.push(callback); },
    },
    storage: {
      local: { async get() { return {}; } },
      onChanged: { addListener(fn) { listeners.storage = fn; } },
    },
  };
  const window = { addEventListener(name, fn) { listeners[name] = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../content/blocker.js"), "utf8"),
    { chrome, document, window });
  return { chrome, requests, listeners, isBlocked: () => Boolean(blocker), classes };
}

test("a missing runtime on page focus clears stale UI without crashing", () => {
  const h = harness();
  h.requests.shift()({ blocked: true });
  h.chrome.runtime = undefined;
  assert.doesNotThrow(() => h.listeners.focus());
  assert.equal(h.isBlocked(), false);
});

test("an invalidated extension context clears stale UI without crashing", () => {
  const h = harness();
  h.requests.shift()({ blocked: true });
  h.chrome.runtime.sendMessage = () => { throw new Error("Extension context invalidated"); };
  assert.doesNotThrow(() => h.listeners.focus());
  assert.equal(h.isBlocked(), false);
});

test("unlock removes an existing overlay without waiting for background sync", () => {
  const h = harness();
  h.requests.shift()({ blocked: true });
  assert.equal(h.isBlocked(), true);
  h.listeners.storage({ "unswitch-state": { newValue: { mode: "off" } } }, "local");
  assert.equal(h.isBlocked(), false);
  assert.equal(h.classes.has("unswitch-blocked"), false);
});

test("a pre-unlock response cannot restore the locked screen", () => {
  const h = harness();
  const stale = h.requests.shift();
  h.listeners.storage({ "unswitch-state": { newValue: { mode: "off" } } }, "local");
  stale({ blocked: true });
  assert.equal(h.isBlocked(), false);
});

test("late lock messages consult authoritative state instead of re-locking", () => {
  const h = harness();
  h.requests.shift()({ blocked: false });
  h.listeners.message({ action: "unswitch-set-block-state", blocked: true });
  assert.equal(h.isBlocked(), false);
  h.requests.shift()({ blocked: false });
  assert.equal(h.isBlocked(), false);
});

test("tab focus refresh and Pomodoro break both clear stale overlays", () => {
  const h = harness();
  h.requests.shift()({ blocked: true });
  h.listeners.focus();
  h.requests.shift()({ blocked: false });
  assert.equal(h.isBlocked(), false);
  h.listeners.storage({ "unswitch-state": { newValue: { mode: "pomodoro", pomodoroState: "focus" } } }, "local");
  h.requests.shift()({ blocked: true });
  h.listeners.storage({ "unswitch-state": { newValue: { mode: "pomodoro", pomodoroState: "break" } } }, "local");
  assert.equal(h.isBlocked(), false);
});
