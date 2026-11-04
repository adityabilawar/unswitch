const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function harness(storedState) {
  const nodes = new Map();
  const listeners = {};
  const timers = new Set();
  const document = {
    body: {
      appendChild(node) {
        node.parentNode = document.body;
        nodes.set(node.id, node);
      },
    },
    documentElement: {},
    getElementById(id) {
      return nodes.get(id) || null;
    },
    createElement() {
      const node = {
        id: "",
        className: "",
        classList: { toggle() {}, add() {}, remove() {} },
        innerHTML: "",
        querySelector() {
          return { textContent: "" };
        },
        remove() {
          nodes.delete(node.id);
        },
      };
      return node;
    },
  };
  const chrome = {
    storage: {
      local: {
        async get() {
          return { "unswitch-state": storedState };
        },
      },
      onChanged: {
        addListener(fn) {
          listeners.storage = fn;
        },
        removeListener() {},
      },
    },
    runtime: {
      sendMessage(_message, callback) {
        if (callback) callback();
      },
      onMessage: {
        addListener(fn) {
          listeners.message = fn;
        },
        removeListener() {},
      },
      lastError: null,
    },
  };
  const window = {
    addEventListener() {},
    setTimeout(fn, delay) {
      const id = setTimeout(fn, delay);
      timers.add(id);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
      clearTimeout(id);
    },
    setInterval(fn, delay) {
      const id = setInterval(fn, delay);
      timers.add(id);
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
      clearInterval(id);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../content/overlay.js"), "utf8"), {
    chrome,
    document,
    window,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    Date,
    Math,
    String,
  });
  return {
    listeners,
    isPresent: () => nodes.has("unswitch-overlay"),
    stop() {
      for (const id of timers) {
        clearTimeout(id);
        clearInterval(id);
      }
    },
  };
}

test("a session metadata write does not cancel the breathing ritual", async () => {
  const h = harness({
    mode: "locked",
    pomodoroState: null,
    taskText: "Write",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.isPresent(), true);

  h.listeners.storage(
    {
      "unswitch-state": {
        newValue: {
          mode: "locked",
          lockedTabRecords: [{ id: 4, url: "https://focus.example/next" }],
        },
      },
    },
    "local"
  );
  assert.equal(h.isPresent(), true);

  h.listeners.storage({ "unswitch-state": { newValue: { mode: "off" } } }, "local");
  assert.equal(h.isPresent(), false);
  h.stop();
});
